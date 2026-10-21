/**
 * Loads the unpacked extension in Chrome and plays a local chess.com-shaped
 * board at https://www.chess.com/play/computer (host-mapped to this process).
 * The allowlist is not changed: a non-computer chess.com path stays blocked,
 * and a localhost URL never receives the content script.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:https";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const chromeBin =
  process.env.CHESSLY_CHROME || "/tmp/chrome-dl/chrome-linux64/chrome";
const port = 8443;
const debugPort = 9333;

const certDir = mkdtempSync(join(tmpdir(), "chessly-cert-"));
execFileSync("openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-keyout",
  join(certDir, "key.pem"),
  "-out",
  join(certDir, "cert.pem"),
  "-days",
  "1",
  "-nodes",
  "-subj",
  "/CN=www.chess.com",
  "-addext",
  "subjectAltName=DNS:www.chess.com",
]);

const pages = {
  "/play/computer": readFileSync(join(root, "tests/fixtures/play-computer.html")),
  "/play/online": readFileSync(join(root, "tests/fixtures/play-online.html")),
};

const server = createServer(
  {
    key: readFileSync(join(certDir, "key.pem")),
    cert: readFileSync(join(certDir, "cert.pem")),
  },
  (request, response) => {
    const path = (request.url || "/").split("?")[0];
    const body = pages[path];
    if (!body) {
      response.writeHead(404);
      response.end("missing");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(body);
  },
);

await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const profile = mkdtempSync(join(tmpdir(), "chessly-profile-"));
const chrome = spawn(
  chromeBin,
  [
    `--user-data-dir=${profile}`,
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--load-extension=${root}`,
    "--ignore-certificate-errors",
    `--host-resolver-rules=MAP www.chess.com:443 127.0.0.1:${port}`,
    "--window-size=1280,900",
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let chromeLog = "";
chrome.stdout.on("data", (chunk) => {
  chromeLog += chunk.toString();
});
chrome.stderr.on("data", (chunk) => {
  chromeLog += chunk.toString();
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function browserVersion() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) return response.json();
    } catch {
      /* Chrome is still starting. */
    }
    await sleep(100);
  }
  throw new Error(`Chrome did not open a debugging port.\n${chromeLog.slice(-1500)}`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error(`websocket failed ${wsUrl}`)));
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    } else {
      for (const listener of listeners) listener(message);
    }
  });
  return {
    ready,
    on(listener) {
      listeners.push(listener);
    },
    send(method, params = {}) {
      const msgId = ++id;
      ws.send(JSON.stringify({ id: msgId, method, params }));
      return new Promise((resolve, reject) => pending.set(msgId, { resolve, reject }));
    },
    close() {
      ws.close();
    },
  };
}

async function targets() {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  return response.json();
}

try {
  const version = await browserVersion();
  if (/load-extension is not allowed/i.test(chromeLog)) {
    throw new Error("This Chrome build refused --load-extension");
  }
  console.log("browser", version.Browser);

  let worker = null;
  const workerDeadline = Date.now() + 10000;
  while (Date.now() < workerDeadline) {
    const list = await targets();
    worker = list.find(
      (target) =>
        target.type === "service_worker" && String(target.url).startsWith("chrome-extension://"),
    );
    if (worker) break;
    await sleep(100);
  }
  if (!worker) {
    throw new Error(`Extension service worker did not start.\n${chromeLog.slice(-2000)}`);
  }
  const extensionId = worker.url.split("/")[2];
  console.log("extension", extensionId);

  const sw = connect(worker.webSocketDebuggerUrl);
  await sw.ready;
  await sw.send("Runtime.enable");
  const swLogs = [];
  sw.on((message) => {
    if (message.method === "Runtime.consoleAPICalled") {
      const text = (message.params.args || [])
        .map((arg) => arg.value ?? arg.description ?? "")
        .join(" ");
      swLogs.push(text);
    }
  });
  const stored = await sw.send("Runtime.evaluate", {
    expression: `chrome.storage.local.set(${JSON.stringify({
      "chessly-settings": {
        mode: "best",
        lines: 1,
        elo: 1700,
        analyzeOpponent: false,
        hintDelaySec: 1,
      },
    })})`,
    awaitPromise: true,
  });
  if (stored.exceptionDetails) throw new Error(JSON.stringify(stored.exceptionDetails));

  const pageTarget = (await targets()).find((target) => target.type === "page");
  const page = connect(pageTarget.webSocketDebuggerUrl);
  await page.ready;
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  const logs = [];
  page.on((message) => {
    if (message.method === "Runtime.consoleAPICalled") {
      const text = (message.params.args || [])
        .map((arg) => arg.value ?? arg.description ?? "")
        .join(" ");
      logs.push(text);
    }
  });

  async function evaluate(expression) {
    const result = await page.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }

  async function goto(url) {
    await page.send("Page.navigate", { url });
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const href = await evaluate("location.href");
      if (href.startsWith(url)) return;
      await sleep(50);
    }
    throw new Error(`navigation did not reach ${url}, at ${await evaluate("location.href")}`);
  }

  async function waitFor(predicate, label, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      last = await evaluate(`(${predicate})()`);
      if (last?.ok) return last;
      await sleep(150);
    }
    throw new Error(`${label} failed: ${JSON.stringify(last)}\npage:\n${logs.filter((line) => line.includes("[Chessly]")).join("\n")}\nsw:\n${swLogs.join("\n")}\nchrome:\n${chromeLog.slice(-800)}`);
  }

  await goto("https://www.chess.com/play/computer");
  const best = await waitFor(
    `() => {
      const status = document.querySelector("#chessly-panel .chessly-status")?.textContent || "";
      const moves = document.querySelector(".chessly-overlay")?.dataset.moves || "";
      const badge = document.querySelector(".chessly-overlay text")?.textContent || "";
      const brackets = document.querySelectorAll(".chessly-overlay path").length;
      return {
        ok: status === "Hint ready" && /^[a-h][1-8][a-h][1-8]/.test(moves) && brackets >= 8 && badge.length > 0,
        status,
        moves,
        badge,
        brackets,
      };
    }`,
    "best move",
  );
  console.log("best", best);
  const shotDir = "/opt/cursor/artifacts";
  mkdirSync(shotDir, { recursive: true });
  async function shot(name) {
    const image = await page.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${shotDir}/${name}.png`, Buffer.from(image.data, "base64"));
  }
  await shot("chessly-best");

  await evaluate(`(() => {
    document.querySelector('#chessly-panel button[data-value="human"]').click();
    const slider = document.querySelector('#chessly-panel input[aria-label="Hint level (Lichess Elo)"]');
    slider.value = "2310";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    const analyze = document.querySelector("#chessly-panel .chessly-switch");
    if (analyze.getAttribute("aria-checked") !== "true") analyze.click();
  })()`);
  const human = await waitFor(
    `() => {
      const status = document.querySelector("#chessly-panel .chessly-status")?.textContent || "";
      const moves = document.querySelector(".chessly-overlay")?.dataset.moves || "";
      const badge = document.querySelector(".chessly-overlay text")?.textContent || "";
      const mode = document.querySelector('#chessly-panel button[data-value="human"]')?.getAttribute("aria-pressed");
      const elo = document.querySelector("#chessly-elo")?.textContent || "";
      const state = document.querySelector("#chessly-panel .chessly-status")?.dataset.state || "";
      return {
        ok: mode === "true" && elo.includes("2310") && status === "Hint ready" && /^[a-h][1-8][a-h][1-8]/.test(moves) && badge.length > 0 && state !== "error",
        status,
        moves,
        badge,
        mode,
        elo,
        state,
      };
    }`,
    "human move",
  );
  console.log("human", human);
  await shot("chessly-human");

  await goto("https://www.chess.com/play/online");
  const blocked = await waitFor(
    `() => {
      const notice = document.querySelector("#chessly-panel .chessly-notice");
      const controls = document.querySelector("#chessly-panel .chessly-controls");
      const overlay = document.querySelector(".chessly-overlay");
      return {
        ok: notice && notice.hidden === false && /only available against bots/.test(notice.textContent || "") && controls?.hidden === true && !overlay,
        notice: notice?.textContent || "",
        controlsHidden: controls?.hidden ?? null,
        overlay: Boolean(overlay),
      };
    }`,
    "live page stays blocked",
    8000,
  );
  console.log("blocked", blocked);

  await goto(`https://127.0.0.1:${port}/play/computer`);
  await sleep(1000);
  const local = await evaluate(`({
    href: location.href,
    panel: Boolean(document.querySelector("#chessly-panel")),
  })`);
  if (local.panel) throw new Error(`content script ran off the allowlist: ${JSON.stringify(local)}`);
  console.log("localhost has no panel", local.href);

  const chesslyLogs = logs.filter((line) => line.includes("[Chessly]"));
  if (!chesslyLogs.some((line) => line.includes("offscreen"))) {
    throw new Error(`missing offscreen log\n${chesslyLogs.join("\n")}`);
  }
  if (!chesslyLogs.some((line) => line.includes("bestmove"))) {
    throw new Error(`missing bestmove log\n${chesslyLogs.join("\n")}`);
  }
  console.log("logs", chesslyLogs.length);
  console.log("e2e ok");
} finally {
  chrome.kill("SIGTERM");
  server.close();
  await sleep(200);
}
