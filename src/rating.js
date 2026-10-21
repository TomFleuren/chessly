/**
 * Rated-move limits adapted from A.C.A.S (GPL-3.0) by Hakorr / Psyyke.
 * https://github.com/Psyyke/A.C.A.S
 *
 * depthFromElo is GET_DEPTH_FROM_ELO. limitStrength is their rule
 * `0 < elo && elo <= 2300` from setEngineElo: at or below that rating they
 * enable UCI_LimitStrength and cap the search depth; above it they search a
 * bit deeper at full strength.
 *
 * This Stockfish 19 Lite build only accepts UCI_Elo from 1320 to 3190.
 * Ratings outside that range are not sent. Skill Level was removed from
 * Stockfish 16 and is not sent either.
 */

export const STOCKFISH_ELO_MIN = 1320;
export const STOCKFISH_ELO_MAX = 3190;
export const LIMIT_STRENGTH_MAX = 2300;
export const BEST_MOVETIME_MS = 700;

export function depthFromElo(elo) {
  const rating = Number(elo) || 0;
  if (rating >= 3100) return 18;
  if (rating >= 3000) return 16;
  if (rating >= 2900) return 14;
  if (rating >= 2800) return 12;
  if (rating >= 2700) return 10;
  if (rating >= 2600) return 8;
  if (rating >= 2400) return 7;
  if (rating >= 2200) return 6;
  if (rating >= 2000) return 5;
  if (rating >= 1800) return 4;
  if (rating >= 1600) return 3;
  if (rating >= 1400) return 2;
  return 1;
}

/**
 * How a Human-move search should talk to this Stockfish build.
 * Best-move mode ignores the plan and searches at full strength.
 */
export function strengthPlan(elo) {
  const rating = Math.round(Number(elo) || 0);
  const depth = depthFromElo(rating);
  const uciElo =
    rating >= STOCKFISH_ELO_MIN && rating <= STOCKFISH_ELO_MAX ? rating : null;
  return {
    depth,
    uciElo,
    limitStrength: uciElo != null && rating > 0 && rating <= LIMIT_STRENGTH_MAX,
  };
}

export function searchCommands({ mode, elo, lines, fen }) {
  const count = lines === 2 || lines === 3 ? lines : 1;
  const plan = strengthPlan(elo);
  const commands = ["setoption name UCI_LimitStrength value false"];
  if (mode === "human" && plan.uciElo != null) {
    commands.push(`setoption name UCI_Elo value ${plan.uciElo}`);
    commands.push(
      `setoption name UCI_LimitStrength value ${plan.limitStrength ? "true" : "false"}`,
    );
  }
  commands.push(`setoption name MultiPV value ${count}`);
  commands.push(`position fen ${fen}`);
  if (mode === "human") commands.push(`go depth ${plan.depth}`);
  else commands.push(`go movetime ${BEST_MOVETIME_MS}`);
  return { commands, plan, multipv: count };
}
