/** Talks to Stockfish via the offscreen worker, or a direct worker on Firefox. */
export function createEngineClient() {
  const handlers = new Set();
  let mode = null;
  let worker = null;
  let started = false;
  let runtimeListener = null;

  function emit(line) {
    for (const handler of handlers) handler(line);
  }

  return {
    get started() {
      return started;
    },
    addHandler(handler) {
      handlers.add(handler);
    },
    removeHandler(handler) {
      handlers.delete(handler);
    },
    async start(pageUrl) {
      if (started) return;
      if (typeof chrome !== "undefined" && chrome.offscreen) {
        runtimeListener = (message) => {
          if (message?.target !== "content") return;
          if (message.type === "LINE" && typeof message.line === "string") emit(message.line);
        };
        chrome.runtime.onMessage.addListener(runtimeListener);
        const response = await chrome.runtime.sendMessage({
          target: "background",
          source: "content",
          type: "START",
          pageUrl,
        });
        if (!response?.ok) {
          chrome.runtime.onMessage.removeListener(runtimeListener);
          runtimeListener = null;
          throw new Error(response?.reason || "engine-start-failed");
        }
        mode = "offscreen";
        started = true;
        return;
      }
      worker = new Worker(chrome.runtime.getURL("engine/stockfish-19-lite-single.js"));
      worker.onmessage = (event) => {
        if (typeof event.data === "string") emit(event.data);
      };
      mode = "worker";
      started = true;
    },
    async command(commands, pageUrl) {
      if (!started) await this.start(pageUrl);
      if (mode === "offscreen") {
        const response = await chrome.runtime.sendMessage({
          target: "background",
          source: "content",
          type: "CMD",
          pageUrl,
          commands,
        });
        if (!response?.ok) throw new Error(response?.reason || "engine-cmd-failed");
        return;
      }
      for (const command of commands) worker.postMessage(command);
    },
    async stop(pageUrl) {
      if (!started) return;
      started = false;
      handlers.clear();
      if (mode === "offscreen") {
        if (runtimeListener) chrome.runtime.onMessage.removeListener(runtimeListener);
        runtimeListener = null;
        try {
          await chrome.runtime.sendMessage({
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
