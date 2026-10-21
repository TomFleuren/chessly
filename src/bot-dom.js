import { isBotGameUrl } from "./allowlist.js";

/**
 * Visible markers that mean "this is a human game" (live, daily, online).
 * A hit vetoes the engine even if the URL is still /play/computer.
 */
export const HUMAN_SELECTORS = [
  "#board-live",
  "#board-daily",
  "#board-play-online",
  ".live-game-buttons-component",
  ".daily-game-footer-component",
  "[data-cy='live-game']",
  "[data-game-type='live']",
  "[data-game-type='daily']",
];

/**
 * Positive signals that the opponent is a chess.com computer bot.
 * These never override a failed URL allowlist.
 */
export const BOT_SELECTORS = [
  "#board-play-computer",
  "#board-single",
  "[data-cy='bot-name']",
  "[data-cy='computer-game']",
  ".bot-component",
  ".computer-player-component",
  "[class*='bot-player']",
  "[class*='computer-game']",
  "[data-bot='true']",
];

export function isPresent(element) {
  if (!element || element.hidden) return false;
  if (typeof element.getBoundingClientRect === "function") {
    const rect = element.getBoundingClientRect();
    return rect.width >= 8 && rect.height >= 8;
  }
  return true;
}

export function rowIsBot(element) {
  if (!element) return false;
  const className = String(element.className || "");
  if (/\b(?:bot|computer)[-_](?:player|avatar|component)\b/i.test(className)) return true;
  if (typeof element.querySelector !== "function") return false;
  if (
    element.querySelector(
      "[data-cy='bot-name'], [data-bot], [class*='bot-player'], [class*='bot-avatar'], [class*='computer-player'], [class*='computer-avatar']",
    )
  ) {
    return true;
  }
  const images = element.querySelectorAll ? [...element.querySelectorAll("img")] : [];
  for (const image of images) {
    const src = image.getAttribute?.("src") || "";
    if (/\/bots\/|bot-avatar|computer-avatar|\/komodo/i.test(src)) return true;
  }
  const links = element.querySelectorAll ? [...element.querySelectorAll("a")] : [];
  for (const link of links) {
    const href = link.getAttribute?.("href") || "";
    if (/\/play\/computer(?:\/|$|\?|#)/i.test(href)) return true;
  }
  return false;
}

export function botSeatFromPlayers({ topIsBot = false, bottomIsBot = false } = {}) {
  if (topIsBot && !bottomIsBot) return "top";
  if (bottomIsBot && !topIsBot) return "bottom";
  return null;
}

/**
 * Bottom of the board is white unless the board element is flipped.
 * The user sits opposite the bot.
 */
export function inferPlayingAs({ botSeat, flipped = false } = {}) {
  if (botSeat !== "top" && botSeat !== "bottom") return null;
  const bottomColor = flipped ? "b" : "w";
  if (botSeat === "top") return bottomColor;
  return bottomColor === "w" ? "b" : "w";
}

export function readDomSignals(doc) {
  const present = (selector) => isPresent(doc?.querySelector?.(selector));
  const hasHumanMarker = HUMAN_SELECTORS.some(present);
  const hasBotMarker = BOT_SELECTORS.some(present);
  const top = playerCard(doc?.querySelector?.(".player-top, .clock-top"));
  const bottom = playerCard(doc?.querySelector?.(".player-bottom, .clock-bottom"));
  const botSeat = botSeatFromPlayers({
    topIsBot: rowIsBot(top),
    bottomIsBot: rowIsBot(bottom),
  });
  return { hasHumanMarker, hasBotMarker, botSeat };
}

/**
 * URL allowlist first. A visible human-game marker is a second veto.
 * A bot marker confirms the page. If the DOM is inconclusive, the allowlisted
 * URL still permits activation — a human URL never does.
 */
export function classifySignals({
  url,
  hasHumanMarker = false,
  hasBotMarker = false,
  botSeat = null,
} = {}) {
  if (!isBotGameUrl(url)) {
    return { activate: false, reason: "not-bot-page", botSeat: null, domUnconfirmed: false };
  }
  if (hasHumanMarker) {
    return { activate: false, reason: "human-game-dom", botSeat: null, domUnconfirmed: false };
  }
  if (hasBotMarker) {
    return { activate: true, reason: "bot-dom", botSeat, domUnconfirmed: false };
  }
  return { activate: true, reason: "url-allowlist", botSeat: null, domUnconfirmed: true };
}

function playerCard(element) {
  if (!element) return null;
  if (typeof element.closest === "function") {
    return element.closest(".player-component, [class*='player-component']") || element;
  }
  return element;
}
