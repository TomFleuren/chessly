/** chrome.storage.local key. Only the fields in DEFAULT_SETTINGS are kept. */
export const STORAGE_KEY = "chessly-settings";

export const DEFAULT_SETTINGS = Object.freeze({
  mode: "best",
  lines: 1,
  elo: 1700,
  analyzeOpponent: false,
  hintDelaySec: 10,
});

const MODES = new Set(["best", "human"]);

/**
 * Copy only known hint preferences. Unknown fields are dropped, including
 * anything that might try to widen where Chessly is allowed to run.
 */
export function sanitizeSettings(raw) {
  const settings = {
    mode: DEFAULT_SETTINGS.mode,
    lines: DEFAULT_SETTINGS.lines,
    elo: DEFAULT_SETTINGS.elo,
    analyzeOpponent: DEFAULT_SETTINGS.analyzeOpponent,
    hintDelaySec: DEFAULT_SETTINGS.hintDelaySec,
  };
  if (!raw || typeof raw !== "object") return settings;
  if (MODES.has(raw.mode)) settings.mode = raw.mode;
  if (raw.lines === 1 || raw.lines === 2 || raw.lines === 3) settings.lines = raw.lines;
  if (typeof raw.elo === "number" && Number.isFinite(raw.elo)) {
    const elo = Math.round(raw.elo);
    if (elo >= 800 && elo <= 2500) settings.elo = elo;
  }
  if (typeof raw.analyzeOpponent === "boolean") {
    settings.analyzeOpponent = raw.analyzeOpponent;
  }
  if (typeof raw.hintDelaySec === "number" && Number.isFinite(raw.hintDelaySec)) {
    settings.hintDelaySec = Math.min(30, Math.max(1, Math.round(raw.hintDelaySec)));
  }
  return settings;
}

export function sameSettings(a, b) {
  const left = sanitizeSettings(a);
  const right = sanitizeSettings(b);
  return (
    left.mode === right.mode &&
    left.lines === right.lines &&
    left.elo === right.elo &&
    left.analyzeOpponent === right.analyzeOpponent &&
    left.hintDelaySec === right.hintDelaySec
  );
}
