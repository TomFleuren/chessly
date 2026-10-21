/**
 * Display helpers. The rating limit itself is in rating.js (A.C.A.S depth and
 * UCI_LimitStrength). These softmax helpers are not used to pick the hint.
 *
 *   temperature(elo) = 15 + 145 * exp(-(elo - 800) / 700)
 *   weight(move)     = exp(-(bestCp - moveCp) / temperature)
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

/**
 * Both modes draw engine order. Human-move mode already asked Stockfish for a
 * rating-limited line (depth and UCI_Elo, same idea as A.C.A.S setEngineElo),
 * so the first MultiPV line is the move to show.
 */
export function selectDisplayedMoves({ lines, candidates }) {
  const pool = (candidates || []).filter((candidate) => typeof candidate?.uci === "string");
  const count = lines === 2 || lines === 3 ? lines : 1;
  if (!pool.length) return [];
  return pool.slice(0, count).map((candidate, index) => ({
    ...candidate,
    emphasis: index === 0 ? "primary" : "secondary",
  }));
}
