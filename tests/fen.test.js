import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import {
  extractFen,
  inferCastling,
  inferEp,
  pieceMapFromElements,
  placementFromMap,
  replaySans,
  sanFromMoveNode,
  sansFromNodes,
  squareFromClass,
  turnFromClocks,
} from "../src/fen.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function piece(colorType, squareClass) {
  return { className: `piece ${colorType} ${squareClass}` };
}

function startPieces() {
  const pieces = [];
  const back = ["r", "n", "b", "q", "k", "b", "n", "r"];
  for (let file = 1; file <= 8; file += 1) {
    pieces.push(piece(`w${back[file - 1]}`, `square-${file}1`));
    pieces.push(piece("wp", `square-${file}2`));
    pieces.push(piece("bp", `square-${file}7`));
    pieces.push(piece(`b${back[file - 1]}`, `square-${file}8`));
  }
  return pieces;
}

describe("square and piece parsing", () => {
  it("maps chess.com square classes to algebraic squares", () => {
    assert.equal(squareFromClass("highlight square-52"), "e2");
    assert.equal(squareFromClass("square-81"), "h1");
    assert.equal(squareFromClass("square-18"), "a8");
    assert.equal(squareFromClass("not-a-square"), null);
  });

  it("reads a starting position from piece classes", () => {
    const map = pieceMapFromElements(startPieces());
    assert.equal(placementFromMap(map), START.split(" ")[0]);
    assert.equal(map.e1, "K");
    assert.equal(map.e8, "k");
    assert.equal(map.a2, "P");
    assert.equal(map.h7, "p");
  });

  it("accepts a data-square when the class is missing", () => {
    const map = pieceMapFromElements([{ className: "piece wk", square: "e4" }]);
    assert.equal(map.e4, "K");
  });
});

describe("extractFen", () => {
  it("returns the standard start FEN from piece classes", () => {
    const result = extractFen({ pieces: startPieces() });
    assert.equal(result.fen, START);
    assert.equal(result.turn, "w");
    assert.equal(result.source, "dom");
  });

  it("does not change the FEN when the board graphic is flipped", () => {
    const upright = extractFen({ pieces: startPieces(), flipped: false });
    const flipped = extractFen({ pieces: startPieces(), flipped: true });
    assert.equal(upright.fen, flipped.fen);
  });

  it("infers black to move and a legal en-passant square after e4", () => {
    const pieces = startPieces().map((entry) =>
      entry.className.includes("square-52")
        ? { className: "piece wp square-54" }
        : entry,
    );
    const result = extractFen({
      pieces,
      highlights: ["e2", "e4"],
      turn: "b",
    });
    assert.equal(result.source, "dom");
    assert.equal(result.turn, "b");
    assert.equal(
      result.fen,
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    );
  });

  it("keeps a legal en-passant square when a pawn can capture", () => {
    const afterE4 = new Chess("rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2");
    assert.match(afterE4.fen(), / d6 /);
    const map = {};
    afterE4.board().forEach((rank, rankIndex) => {
      rank.forEach((pieceOnSquare, fileIndex) => {
        if (!pieceOnSquare) return;
        const square = "abcdefgh"[fileIndex] + (8 - rankIndex);
        map[square] = pieceOnSquare.color === "w" ? pieceOnSquare.type.toUpperCase() : pieceOnSquare.type;
      });
    });
    assert.equal(inferEp(map, ["d7", "d5"], "w"), "d6");
    const elements = Object.entries(map).map(([square, letter]) => ({
      className: `piece ${letter === letter.toUpperCase() ? "w" : "b"}${letter.toLowerCase()} square-${square.charCodeAt(0) - 96}${square[1]}`,
    }));
    const result = extractFen({ pieces: elements, highlights: ["d7", "d5"], turn: "w" });
    assert.match(result.fen, / w KQkq d6 /);
  });

  it("drops castling rights once the king has left its square", () => {
    const pieces = startPieces()
      .filter((entry) => !entry.className.includes("wb square-61"))
      .map((entry) =>
        entry.className.includes("wk ") ? { className: "piece wk square-61" } : entry,
      );
    const map = pieceMapFromElements(pieces);
    assert.equal(inferCastling(map).includes("K"), false);
    assert.equal(inferCastling(map).includes("Q"), false);
    const result = extractFen({ pieces, turn: "b" });
    assert.match(result.fen, / kq /);
  });

  it("prefers an API FEN that matches the pieces", () => {
    const apiFen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const pieces = startPieces().map((entry) =>
      entry.className.includes("square-52")
        ? { className: "piece wp square-54" }
        : entry,
    );
    const result = extractFen({ apiFen, pieces, turn: "w" });
    assert.equal(result.source, "api");
    assert.equal(result.fen, apiFen);
  });

  it("ignores a stale API FEN that disagrees with the board", () => {
    const result = extractFen({
      apiFen: START,
      pieces: startPieces().map((entry) =>
        entry.className.includes("square-52")
          ? { className: "piece wp square-54" }
          : entry,
      ),
      turn: "b",
    });
    assert.equal(result.source, "dom");
    assert.match(result.fen, /4P3/);
    assert.equal(result.turn, "b");
  });

  it("replays a SAN move list, including figurine nodes", () => {
    const nodes = [
      { text: "e4" },
      { text: "e5" },
      { text: "f3", figurine: "N" },
    ];
    assert.deepEqual(sansFromNodes(nodes), ["e4", "e5", "Nf3"]);
    assert.equal(sanFromMoveNode({ text: "1.e4" }), "e4");
    const replayed = replaySans(["e4", "e5", "Nf3"]);
    const chess = new Chess();
    chess.move("e4");
    chess.move("e5");
    chess.move("Nf3");
    assert.equal(replayed, chess.fen());
    const result = extractFen({
      sans: ["e4", "e6", "e5", "d5"],
    });
    assert.equal(result.source, "moves");
    assert.match(result.fen, / d6 /);
  });

  it("reads the side to move from the running clock", () => {
    assert.equal(turnFromClocks({ bottomActive: true, flipped: false }), "w");
    assert.equal(turnFromClocks({ topActive: true, flipped: false }), "b");
    assert.equal(turnFromClocks({ bottomActive: true, flipped: true }), "b");
    assert.equal(turnFromClocks({ topActive: true, flipped: true }), "w");
    assert.equal(turnFromClocks({ bottomActive: true, topActive: true }), null);
  });
});
