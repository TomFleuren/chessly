/** Status text the panel is allowed to show. An error sticks until the position changes. */

export function hintStatusText({
  phase = "idle",
  errorText = "",
  userToMove = false,
  playingAs = null,
  remainSec = 0,
  hasMoves = false,
  showing = false,
} = {}) {
  if (phase === "error") return { text: errorText || "Engine error", state: "error" };
  if (!userToMove) {
    return {
      text: playingAs ? "Opponent's turn" : "Detecting your color…",
      state: "",
    };
  }
  if (showing || phase === "ready") return { text: "Hint ready", state: "" };
  if (remainSec > 0) return { text: `Hint in ${remainSec}s`, state: "" };
  if (!hasMoves) return { text: "Calculating hint…", state: "" };
  return { text: "Hint ready", state: "" };
}

export function statusMayRefresh(phase) {
  return phase !== "error" && phase !== "ready";
}

export function failureText(error) {
  const text = String(error?.message || error || "");
  if (/uciok-timeout|readyok-timeout|did not respond/i.test(text)) return "Engine did not respond";
  if (/search-timeout|timed out|Hint timed out/i.test(text)) return "Hint timed out";
  if (/wasm|failed to (asynchronously )?prepare|worker error|engine-start|offscreen|message-timeout/i.test(text)) {
    return "Engine failed to start";
  }
  if (/CRITICAL ERROR|illegal/i.test(text)) return "Engine rejected the position";
  if (/no-move|no legal/i.test(text)) return "No hint for this position";
  return "Engine error";
}
