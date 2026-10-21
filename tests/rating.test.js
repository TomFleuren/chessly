import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { depthFromElo, searchCommands, strengthPlan } from "../src/rating.js";

const FEN = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

describe("A.C.A.S-style rating limits", () => {
  it("uses the same depth steps as A.C.A.S GET_DEPTH_FROM_ELO", () => {
    assert.equal(depthFromElo(800), 1);
    assert.equal(depthFromElo(1700), 3);
    assert.equal(depthFromElo(2310), 6);
    assert.equal(depthFromElo(2500), 7);
  });

  it("limits strength only inside this build's UCI_Elo range and at or below 2300", () => {
    assert.deepEqual(strengthPlan(800), { depth: 1, uciElo: null, limitStrength: false });
    assert.deepEqual(strengthPlan(1700), { depth: 3, uciElo: 1700, limitStrength: true });
    assert.deepEqual(strengthPlan(2310), { depth: 6, uciElo: 2310, limitStrength: false });
  });

  it("never sends an out-of-range UCI_Elo", () => {
    const low = searchCommands({ mode: "human", elo: 800, lines: 1, fen: FEN });
    assert.equal(low.commands.some((command) => command.includes("UCI_Elo")), false);
    assert.equal(low.commands.at(-1), "go depth 1");

    const rated = searchCommands({ mode: "human", elo: 2310, lines: 1, fen: FEN });
    assert.ok(rated.commands.includes("setoption name UCI_Elo value 2310"));
    assert.equal(rated.commands.at(-1), "go depth 6");
    const mid = searchCommands({ mode: "human", elo: 1700, lines: 1, fen: FEN });
    const eloAt = mid.commands.indexOf("setoption name UCI_Elo value 1700");
    const limitAt = mid.commands.indexOf("setoption name UCI_LimitStrength value true");
    assert.ok(eloAt >= 0 && limitAt > eloAt);
    assert.equal(mid.commands.at(-1), "go depth 3");

    const best = searchCommands({ mode: "best", elo: 2310, lines: 2, fen: FEN });
    assert.equal(best.commands.some((command) => command.includes("UCI_Elo")), false);
    assert.equal(best.commands.at(-1), "go movetime 700");
    assert.ok(best.commands.includes("setoption name MultiPV value 2"));
  });
});
