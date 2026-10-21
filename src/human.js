/**
 * Human-move selection.
 *
 * Best-move mode shows Stockfish's top line(s). Human-move mode still searches
 * at full strength (so the badge is a real evaluation) and then samples one
 * MultiPV candidate with a softmax over centipawn gaps. The temperature is
 * tied to a Lichess-style Elo, not to Stockfish's UCI_Elo option: that option
 * on this build only accepts 1320–3190 and is a different scale from the slider.
 *
 *   temperature(elo) = 15 + 145 * exp(-(elo - 800) / 700)
 *   weight(move)     = exp(-(bestCp - moveCp) / temperature)
 *
 * Approx. temperatures: 800 → 160cp, 1700 → 55cp, 2500 → 28cp.
 */

export const ELO_MIN = 800;
export const ELO_MAX = 2500;

export function temperatureForElo(elo) {
  const clamped = Math.min(ELO_MAX, Math.max(ELO_MIN, Number(elo) || 1700));
  return 15 + 145 * Math.exp(-(clamped - 800) / 700);
}

export function candidateValue(candidate) {
  if (candidate?.mate != null && Number.isFinite(candidate.mate)) {
    return candidate.mate > 0 ? 100_000 - candidate.mate : -100_000 - candidate.mate;
  }
  return Number.isFinite(candidate?.cp) ? candidate.cp : 0;
}

export function chooseHumanMove(candidates, elo, rng = Math.random) {
  if (!candidates?.length) return null;
  const temperature = temperatureForElo(elo);
  const values = candidates.map(candidateValue);
  const best = Math.max(...values);
  const weights = values.map((value) => Math.exp(-(best - value) / temperature));
  const sum = weights.reduce((total, weight) => total + weight, 0);
  if (!Number.isFinite(sum) || sum <= 0) return candidates[0];
  let roll = rng() * sum;
  for (let i = 0; i < candidates.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

export function selectDisplayedMoves({ mode, lines, candidates, elo, rng }) {
  const pool = (candidates || []).filter((candidate) => typeof candidate?.uci === "string");
  const count = lines === 2 || lines === 3 ? lines : 1;
  if (!pool.length) return [];
  if (mode === "human") {
    const chosen = chooseHumanMove(pool, elo, rng) || pool[0];
    const rest = pool.filter((candidate) => candidate.uci !== chosen.uci);
    return [chosen, ...rest].slice(0, count).map((candidate, index) => ({
      ...candidate,
      emphasis: index === 0 ? "primary" : "secondary",
    }));
  }
  return pool.slice(0, count).map((candidate, index) => ({
    ...candidate,
    emphasis: index === 0 ? "primary" : "secondary",
  }));
}
