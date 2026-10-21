(() => {
  // src/allowlist.js
  var BOT_HOSTS = /* @__PURE__ */ new Set(["www.chess.com", "chess.com"]);
  function normalizeChessPath(pathname) {
    if (typeof pathname !== "string" || !pathname.startsWith("/")) return null;
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    const parts = [];
    for (const segment of decoded.split("/")) {
      if (segment === "" || segment === ".") continue;
      if (segment === "..") {
        parts.pop();
        continue;
      }
      parts.push(segment);
    }
    return `/${parts.join("/")}`;
  }
  function isBotGameUrl(input) {
    let url;
    try {
      url = input instanceof URL ? input : new URL(String(input));
    } catch {
      return false;
    }
    if (url.protocol !== "https:") return false;
    if (!BOT_HOSTS.has(url.hostname)) return false;
    const path = normalizeChessPath(url.pathname);
    if (!path) return false;
    return path === "/play/computer" || path.startsWith("/play/computer/");
  }
  function engineRequestAllowed({ tabUrl, pageUrl } = {}) {
    if (!isBotGameUrl(tabUrl)) return false;
    if (typeof pageUrl === "string" && pageUrl.length > 0 && !isBotGameUrl(pageUrl)) {
      return false;
    }
    return true;
  }

  // src/background.js
  var LOG = "[Chessly]";
  var engineTabId = null;
  var engineGeneration = 0;
  var tabRestore = chrome.storage?.session ? chrome.storage.session.get("chesslyEngineTab").then((data) => {
    if (engineTabId == null && typeof data?.chesslyEngineTab === "number") {
      engineTabId = data.chesslyEngineTab;
    }
  }) : Promise.resolve();
  function rememberTab(tabId) {
    engineTabId = tabId;
    chrome.storage?.session?.set({ chesslyEngineTab: tabId }).catch(() => {
    });
  }
  function forgetTab() {
    engineTabId = null;
    chrome.storage?.session?.remove("chesslyEngineTab").catch(() => {
    });
  }
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function sendToOffscreen(message, timeoutMs = 4e3) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("offscreen-timeout")), timeoutMs);
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
  function requestAllowed(sender, message) {
    return engineRequestAllowed({
      tabUrl: sender?.tab?.url || "",
      pageUrl: typeof message?.pageUrl === "string" ? message.pageUrl : ""
    });
  }
  async function offscreenOpen() {
    if (!chrome.offscreen?.hasDocument) return false;
    return chrome.offscreen.hasDocument();
  }
  async function ensureOffscreen() {
    if (!chrome.offscreen?.createDocument) {
      throw new Error("offscreen-unavailable");
    }
    if (await offscreenOpen()) return;
    try {
      await chrome.offscreen.createDocument({
        url: "dist/offscreen.html",
        reasons: ["WORKERS"],
        justification: "Run the local Stockfish worker for hints in chess.com bot games."
      });
    } catch (error) {
      if (!await offscreenOpen()) throw error;
    }
  }
  async function pingOffscreen() {
    const deadline = Date.now() + 5e3;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const response = await sendToOffscreen({ target: "offscreen", type: "PING" }, 1e3);
        if (response?.ok) return;
      } catch (error) {
        lastError = error;
      }
      await delay(40);
    }
    throw new Error(lastError?.message || "offscreen-not-ready");
  }
  async function closeEngine() {
    engineGeneration += 1;
    forgetTab();
    try {
      await sendToOffscreen({ target: "offscreen", type: "SHUTDOWN" }, 1500);
    } catch {
    }
    try {
      if (await offscreenOpen()) await chrome.offscreen.closeDocument();
    } catch {
    }
  }
  function deactivateTab(tabId) {
    if (tabId == null) return;
    chrome.tabs.sendMessage(tabId, { target: "content", type: "DEACTIVATE" }).catch(() => {
    });
  }
  async function tabStillAllowed(tabId, pageUrl) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!isBotGameUrl(tab.url || "")) return false;
    } catch {
      return false;
    }
    if (typeof pageUrl === "string" && pageUrl && !isBotGameUrl(pageUrl)) return false;
    return true;
  }
  function watchUrl(tabId, url) {
    if (tabId !== engineTabId || !url || isBotGameUrl(url)) return;
    const leaving = engineTabId;
    void closeEngine();
    deactivateTab(leaving);
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.target !== "background") return void 0;
    if (message.source !== "offscreen") {
      console.info(LOG, "background", message.type, sender.tab?.url || "");
    }
    if (message.source === "offscreen") {
      const forward = () => {
        if (engineTabId == null) return;
        if (message.type === "LINE") {
          chrome.tabs.sendMessage(engineTabId, { target: "content", type: "LINE", line: message.line }).catch(() => {
          });
        } else if (message.type === "ENGINE_ERROR") {
          console.error(LOG, "engine error", message.detail || "");
          chrome.tabs.sendMessage(engineTabId, {
            target: "content",
            type: "ENGINE_ERROR",
            detail: message.detail || ""
          }).catch(() => {
          });
        }
      };
      if (message.type === "READY") {
        console.info(LOG, "offscreen ready");
        forward();
      } else {
        tabRestore.then(forward);
      }
      sendResponse({ ok: true });
      return void 0;
    }
    if (!sender.tab?.id) {
      sendResponse({ ok: false, reason: "no-tab" });
      return void 0;
    }
    if (!requestAllowed(sender, message)) {
      if (sender.tab.id === engineTabId) {
        const tabId = engineTabId;
        void closeEngine();
        deactivateTab(tabId);
      }
      sendResponse({ ok: false, reason: "not-bot-page" });
      return void 0;
    }
    if (message.type === "START") {
      const generation = engineGeneration;
      const tabId = sender.tab.id;
      rememberTab(tabId);
      ensureOffscreen().then(async () => {
        if (generation !== engineGeneration) {
          sendResponse({ ok: false, reason: "stopped" });
          return;
        }
        if (!await tabStillAllowed(tabId, message.pageUrl)) {
          await closeEngine();
          sendResponse({ ok: false, reason: "not-bot-page" });
          return;
        }
        await pingOffscreen();
        console.info(LOG, "engine started for tab", tabId);
        sendResponse({ ok: true, transport: "offscreen" });
      }).catch((error) => {
        console.error(LOG, "engine start failed", error?.message || error);
        sendResponse({ ok: false, reason: String(error?.message || error) });
      });
      return true;
    }
    if (message.type === "STOP") {
      if (sender.tab.id === engineTabId) void closeEngine();
      sendResponse({ ok: true });
      return void 0;
    }
    if (message.type === "CMD") {
      const commands = Array.isArray(message.commands) ? message.commands.filter((command) => typeof command === "string") : [];
      const generation = engineGeneration;
      const tabId = sender.tab.id;
      rememberTab(tabId);
      ensureOffscreen().then(async () => {
        if (generation !== engineGeneration) {
          sendResponse({ ok: false, reason: "stopped" });
          return;
        }
        if (!await tabStillAllowed(tabId, message.pageUrl)) {
          await closeEngine();
          sendResponse({ ok: false, reason: "not-bot-page" });
          return;
        }
        await pingOffscreen();
        const response = await sendToOffscreen({ target: "offscreen", type: "CMD", commands });
        if (!response?.ok) throw new Error(response?.reason || "engine-cmd-failed");
        sendResponse({ ok: true });
      }).catch((error) => {
        console.error(LOG, "engine command failed", error?.message || error);
        sendResponse({ ok: false, reason: String(error?.message || error) });
      });
      return true;
    }
    sendResponse({ ok: false, reason: "unknown" });
    return void 0;
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) watchUrl(tabId, changeInfo.url);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === engineTabId) void closeEngine();
  });
  if (chrome.webNavigation?.onHistoryStateUpdated) {
    chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
      if (details.frameId !== 0) return;
      watchUrl(details.tabId, details.url);
    });
  }
})();
