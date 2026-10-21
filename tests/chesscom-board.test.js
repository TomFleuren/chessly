import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boardChanges, boardOrientation, createPositionTracker } from "../src/chesscom-board.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR";
const AFTER_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR";

describe("chess.com position tracking", () => {
  it("follows 1.e4 e5 and leaves White to move", () => {
    const tracker = createPositionTracker();
    tracker.note(START, "w");
    const afterE4 = tracker.note(AFTER_E4);
    assert.equal(afterE4.turn, "b");
    const afterE5 = tracker.note(AFTER_E5);
    assert.equal(afterE5.turn, "w");
    assert.match(afterE5.fen, /^rnbqkbnr\/pppp1ppp\/8\/4p3\/4P3\/8\/PPPP1PPP\/RNBQKBNR w KQkq/);
    assert.match(afterE5.fen, / 2$/);
  });

  it("ignores a frame where one piece disappears and nothing else changes", () => {
    const tracker = createPositionTracker();
    tracker.note(START, "w");
    const flicker = "rnbqkbnr/pppppppp/8/8/8/8/PPPP1PPP/RNBQKBNR";
    const kept = tracker.note(flicker);
    assert.equal(kept.rejected, true);
    assert.equal(kept.basic, START);
  });

  it("treats the flipped class as Black at the bottom", () => {
    assert.equal(boardOrientation({ classList: { contains: (name) => name === "flipped" } }), "b");
    assert.equal(boardOrientation({ classList: { contains: () => false } }), "w");
  });

  it("sees e2-e4 as a white pawn move", () => {
    const changes = boardChanges(START, AFTER_E4);
    assert.equal(changes.movedPiece, "P");
    assert.equal(changes.from, "e2");
    assert.equal(changes.to, "e4");
    assert.equal(changes.movedPieceColor, "w");
  });
});
