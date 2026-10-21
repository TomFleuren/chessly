/**
 * Fair-play gate (FAIR_PLAY_ALLOWLIST_ONLY).
 *
 * Chessly may run only on chess.com's Play vs Computer pages. This is an
 * allowlist: every other URL is denied. No setting, flag, query parameter,
 * or message field can widen it.
 */

const BOT_HOSTS = new Set(["www.chess.com", "chess.com"]);

/**
 * Decode and resolve "." / ".." so encoded traversals cannot sneak onto the
 * allowlist. Returns null when the path is malformed.
 */
export function normalizeChessPath(pathname) {
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

/** True only for https://chess.com/play/computer and its sub-routes. */
export function isBotGameUrl(input) {
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

/**
 * Engine IPC is allowed only when the browser tab URL is on the allowlist.
 * A page-supplied URL may veto a request. It can never grant one.
 */
export function engineRequestAllowed({ tabUrl, pageUrl } = {}) {
  if (!isBotGameUrl(tabUrl)) return false;
  if (typeof pageUrl === "string" && pageUrl.length > 0 && !isBotGameUrl(pageUrl)) {
    return false;
  }
  return true;
}

export const BOT_ONLY_NOTICE = "Chessly is only available against bots";
