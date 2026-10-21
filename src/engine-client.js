/**
 * Talks to Stockfish running in the extension's offscreen document.
 *
 * A.C.A.S keeps the engine in a different tab from the chess site so the
 * page CSP cannot block the WASM worker. Chrome has no second tab here; the
 * offscreen document is that isolated extension page. Content scripts do not
 * expose chrome.offscreen, so this client always asks the service worker.
 * A direct worker is only used when the browser has no offscreen API (Firefox).
 */

const LOG = "[Chessly]";

function canMessageExtension() {
  return (
    typeof chrome !== "undefined" &&
    Boolean(chrome.runtime?.id) &&
    typeof chrome.runtime?.sendMessage === "function"
  );
}

function sendExtensionMessage(message, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    console.info(LOG, "ipc", message.type);
    const timer = setTimeout(() => {
      console.error(LOG, "ipc timeout", message.type);
      reject(new Error("message-timeout"));
    }, timeoutMs);
    try {
      chrome.runtime.sendMessage(message, (response) => {
        clearTimeout(timer);
        const reason = chrome.runtime.lastError?.message;
        if (reason) reject(new Error(reason));
        else resolve(response);
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

export function createEngineClient() {
  const handlers = new Set();
  let mode = null;
  let worker = null;
  let started = false;
  let runtimeListener = null;

  function emit(line) {
    for (const handler of handlers) handler(line);
  }

  function attachRuntimeListener() {
    runtimeListener = (message) => {
      if (message?.target !== "content") return;
      if (message.type === "LINE" && typeof message.line === "string") emit(message.line);
      if (message.type === "ENGINE_ERROR") {
        const detail = message.detail || "engine error";
        console.error(LOG, "engine error", detail);
        emit(`info string Chessly engine error: ${detail}`);
      }
    };
    chrome.runtime.onMessage.addListener(runtimeListener);
  }

  return {
    get started() {
      return started;
    },
    get transport() {
      return mode;
    },
    addHandler(handler) {
      handlers.add(handler);
    },
    removeHandler(handler) {
      handlers.delete(handler);
    },
    async start(pageUrl) {
      if (started) return mode;
      if (canMessageExtension()) {
        attachRuntimeListener();
        let response;
        try {
          response = await sendExtensionMessage({
            target: "background",
            source: "content",
            type: "START",
            pageUrl,
          });
        } catch (error) {
          response = { ok: false, reason: error?.message || "engine-start-failed" };
        }
        if (response?.ok) {
          mode = "offscreen";
          started = true;
          console.info(LOG, "engine transport: offscreen");
          return mode;
        }
        chrome.runtime.onMessage.removeListener(runtimeListener);
        runtimeListener = null;
        if (response?.reason !== "offscreen-unavailable") {
          throw new Error(response?.reason || "engine-start-failed");
        }
        console.info(LOG, "offscreen API missing, starting a direct worker");
      }

      const url = chrome.runtime.getURL("engine/stockfish-19-lite-single.js");
      const wasm = chrome.runtime.getURL("engine/stockfish-19-lite-single.wasm");
      console.info(LOG, "engine transport: worker", url);
      worker = new Worker(`${url}#${encodeURIComponent(wasm)}`);
      worker.onmessage = (event) => {
        if (typeof event.data === "string") emit(event.data);
      };
      worker.onerror = (event) => {
        const detail = event?.message || "worker error";
        console.error(LOG, "worker error", detail);
        emit(`info string Chessly engine error: ${detail}`);
      };
      mode = "worker";
      started = true;
      return mode;
    },
    async command(commands, pageUrl) {
      if (!started) await this.start(pageUrl);
      const list = (commands || []).filter((command) => typeof command === "string" && command);
      console.info(LOG, "uci >", list.join(" | "));
      if (mode === "offscreen") {
        const response = await sendExtensionMessage({
          target: "background",
          source: "content",
          type: "CMD",
          pageUrl,
          commands: list,
        });
        if (!response?.ok) throw new Error(response?.reason || "engine-cmd-failed");
        return;
      }
      for (const command of list) worker.postMessage(command);
    },
    async stop(pageUrl) {
      if (!started) return;
      started = false;
      handlers.clear();
      if (mode === "offscreen") {
        if (runtimeListener) chrome.runtime.onMessage.removeListener(runtimeListener);
        runtimeListener = null;
        try {
          await sendExtensionMessage({
            target: "background",
            source: "content",
            type: "STOP",
            pageUrl,
          });
        } catch {
          /* The extension context can disappear during navigation. */
        }
      } else if (worker) {
        try {
          worker.postMessage("quit");
        } catch {
          /* Worker already stopped. */
        }
        worker.terminate();
        worker = null;
      }
      mode = null;
    },
  };
}
