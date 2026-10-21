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
  var engineTabId = null;
  var engineGeneration = 0;
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
    await chrome.offscreen.createDocument({
      url: "dist/offscreen.html",
      reasons: ["WORKERS"],
      justification: "Run the local Stockfish worker for hints in chess.com bot games."
    });
  }
  async function closeEngine() {
    engineGeneration += 1;
    engineTabId = null;
    try {
      await chrome.runtime.sendMessage({ target: "offscreen", type: "SHUTDOWN" });
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
    if (message.source === "offscreen") {
      if (engineTabId == null) return void 0;
      if (message.type === "LINE") {
        chrome.tabs.sendMessage(engineTabId, { target: "content", type: "LINE", line: message.line }).catch(() => {
        });
      } else if (message.type === "ENGINE_ERROR") {
        chrome.tabs.sendMessage(engineTabId, {
          target: "content",
          type: "ENGINE_ERROR",
          detail: message.detail || ""
        }).catch(() => {
        });
      }
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
      engineTabId = tabId;
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
        sendResponse({ ok: true });
      }).catch((error) => sendResponse({ ok: false, reason: String(error?.message || error) }));
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
      engineTabId = tabId;
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
        await chrome.runtime.sendMessage({ target: "offscreen", type: "CMD", commands });
        sendResponse({ ok: true });
      }).catch((error) => sendResponse({ ok: false, reason: String(error?.message || error) }));
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
