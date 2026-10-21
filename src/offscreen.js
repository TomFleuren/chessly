let worker = null;

function post(type, extra = {}) {
  chrome.runtime.sendMessage({ target: "background", source: "offscreen", type, ...extra });
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
  worker = new Worker(chrome.runtime.getURL("engine/stockfish-19-lite-single.js"));
  worker.onmessage = (event) => {
    const line = typeof event.data === "string" ? event.data : "";
    if (!line) return;
    post("LINE", { line });
    if (line.includes("CRITICAL ERROR")) {
      post("ENGINE_ERROR", { detail: line });
      destroy();
    }
  };
  worker.onerror = (event) => {
    post("ENGINE_ERROR", { detail: String(event?.message || "worker error") });
  };
}

function exec(commands) {
  boot();
  for (const command of commands) {
    if (typeof command === "string" && command) worker.postMessage(command);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.target !== "offscreen") return;
  if (message.type === "SHUTDOWN") {
    destroy();
    return;
  }
  if (message.type === "CMD") exec(message.commands || []);
});
