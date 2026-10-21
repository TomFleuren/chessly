/**
 * Isolated Stockfish page. Chess.com never sees this worker.
 * The worker URL hash is the wasm file, which is how Stockfish.js 19 resolves
 * its module when it is not sitting next to a guessed pathname.
 *
 * Every message is answered. A listener that does not call sendResponse makes
 * chrome.runtime.sendMessage reject, and the content script used to treat that
 * as a failed command and shut the engine down.
 */

const LOG = "[Chessly]";
let worker = null;

function post(type, extra = {}) {
  chrome.runtime.sendMessage({ target: "background", source: "offscreen", type, ...extra }).catch((error) => {
    console.error(LOG, "offscreen post failed", type, error?.message || error);
  });
}

function destroy() {
  if (!worker) return;
  try {
    worker.postMessage("quit");
  } catch {
    /* Worker already stopped. */
  }
  try {
    worker.terminate();
  } catch {
    /* Worker already stopped. */
  }
  worker = null;
}

function boot() {
  if (worker) return;
  const jsUrl = chrome.runtime.getURL("engine/stockfish-19-lite-single.js");
  const wasmUrl = chrome.runtime.getURL("engine/stockfish-19-lite-single.wasm");
  console.info(LOG, "offscreen worker", jsUrl);
  try {
    worker = new Worker(`${jsUrl}#${encodeURIComponent(wasmUrl)}`);
  } catch (error) {
    const detail = `worker failed to start: ${error?.message || error}`;
    console.error(LOG, detail);
    post("ENGINE_ERROR", { detail });
    throw error;
  }
  worker.onmessage = (event) => {
    const line = typeof event.data === "string" ? event.data : "";
    if (!line) return;
    if (
      line.startsWith("bestmove") ||
      line.startsWith("uciok") ||
      line.startsWith("readyok") ||
      line.startsWith("id name") ||
      /error|failed|CRITICAL/i.test(line)
    ) {
      console.info(LOG, "uci <", line);
    }
    post("LINE", { line });
    if (line.includes("CRITICAL ERROR") || line.includes("failed to asynchronously prepare wasm")) {
      post("ENGINE_ERROR", { detail: line });
      destroy();
    }
  };
  worker.onerror = (event) => {
    const detail = `worker error: ${event?.message || "unknown"} ${event?.filename || ""}:${event?.lineno || 0}`;
    console.error(LOG, detail);
    post("ENGINE_ERROR", { detail });
    destroy();
  };
}

function exec(commands) {
  boot();
  for (const command of commands) {
    if (typeof command === "string" && command) worker.postMessage(command);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== "offscreen") return undefined;
  try {
    if (message.type === "SHUTDOWN") {
      destroy();
      sendResponse({ ok: true });
      return undefined;
    }
    if (message.type === "PING") {
      sendResponse({ ok: true, worker: Boolean(worker) });
      return undefined;
    }
    if (message.type === "CMD") {
      exec(message.commands || []);
      sendResponse({ ok: true });
      return undefined;
    }
    sendResponse({ ok: false, reason: "unknown" });
  } catch (error) {
    sendResponse({ ok: false, reason: String(error?.message || error) });
  }
  return undefined;
});

post("READY");
console.info(LOG, "offscreen document ready");
