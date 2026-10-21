/**
 * Chess.com board reading, adapted from A.C.A.S (GPL-3.0) by Hakorr / Psyyke.
 * https://github.com/Psyyke/A.C.A.S  (acas.user.js, the chess.com site block
 * and updateGameState / getBoardChanges).
 *
 * Only the standard chess.com board is implemented. Variants and other sites
 * from A.C.A.S are not included.
 *
 * Board: `#board-layout-chessboard > .board`, then wc-chess-board / chess-board.
 * Pieces: `.piece` whose class matches `(b|w)[prnbqk]` and `square-(\d)(\d)`.
 * Orientation: the `flipped` class means Black is at the bottom. A.C.A.S treats
 * that orientation as the player's color on chess.com when the site does not
 * expose a separate player-color field.
 *
 * Castling, en passant, and the move clocks follow one legal move at a time.
 * A frame where a single piece vanishes and nothing else changes is ignored,
 * which is the transient DOM A.C.A.S refuses to send to an engine.
 */

import { inferCastling, normalizeFen, pieceMapFromElements, placementFromMap } from "./fen.js";

const START_BASIC = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

export function findChessComBoard(doc) {
  if (!doc?.querySelector) return null;
  return (
    doc.querySelector("#board-layout-chessboard > .board") ||
    doc.querySelector("wc-chess-board") ||
    doc.querySelector("chess-board") ||
    doc.querySelector("#board-play-computer chess-board") ||
    doc.querySelector("[data-cy='board']")
  );
}

/** 'b' when Black sits at the bottom, otherwise 'w'. */
export function boardOrientation(board) {
  return board?.classList?.contains("flipped") ? "b" : "w";
}

export function readPieceElements(board) {
  if (!board?.querySelectorAll) return [];
  return [...board.querySelectorAll(".piece")].map((element) => ({
    className: elementClassName(element),
    square: element.getAttribute?.("data-square") || null,
  }));
}

export function basicFromPieces(elements) {
  const map = pieceMapFromElements(elements);
  if (Object.keys(map).length < 2) return null;
  return { map, basic: placementFromMap(map) };
}

/**
 * Track one chess.com game. `note(basic, turnHint)` returns the latest full
 * FEN, or the previous FEN when this frame is a rejected flicker.
 */
export function createPositionTracker() {
  let history = [];
  let lostCastling = [];
  let halfmoveClock = 0;
  let plyCount = 0;

  function reset(basic) {
    history = [];
    lostCastling = [];
    halfmoveClock = 0;
    plyCount = 0;
    seedLostCastling(basic);
  }

  function seedLostCastling(basic) {
    const possible = castlingFromBasic(basic);
    for (const right of ["K", "Q", "k", "q"]) {
      if (!possible.includes(right) && !lostCastling.includes(right)) lostCastling.push(right);
    }
  }

  return {
    reset,
    current() {
      return history[0] || null;
    },
    note(basic, turnHint) {
      if (typeof basic !== "string" || !basic.includes("/")) return history[0] || null;
      if (history[0]?.basic === basic) return history[0];

      const previous = history[0]?.basic || null;
      const changes = previous ? boardChanges(previous, basic) : emptyChanges();
      if (
        previous &&
        changes.pieceAmountChange === -1 &&
        changes.changedSquaresAmount === 1
      ) {
        return { ...history[0], rejected: true };
      }

      const freshGame =
        history.length > 0 &&
        (changes.changedSquaresAmount > 6 ||
          (basic === START_BASIC && changes.changedSquaresAmount > 1));
      const first = !history.length || freshGame;
      if (freshGame || !history.length) reset(basic);

      const moved = changes.movedPieceColor;
      let turn = turnHint === "w" || turnHint === "b" ? turnHint : null;
      if (!turn) {
        if (moved === "w") turn = "b";
        else if (moved === "b") turn = "w";
        else if (!history.length || freshGame) turn = basic === START_BASIC ? "w" : null;
        else turn = history[0]?.turn || null;
      }
      if (turn !== "w" && turn !== "b") return history[0] || null;

      if (!first) applyRights(changes);
      const capture = changes.pieceAmountChange === -1 || changes.isEnPassant;
      const pawnMove = changes.movedPiece?.toLowerCase() === "p";
      if (first) {
        halfmoveClock = 0;
        plyCount = turn === "w" ? 0 : 1;
      } else {
        halfmoveClock = capture || pawnMove ? 0 : halfmoveClock + 1;
        plyCount += 1;
      }
      const fullmove = Math.floor(plyCount / 2) + 1;
      const ep = enPassantTarget(changes);
      const rights = ["K", "Q", "k", "q"].filter((right) => !lostCastling.includes(right)).join("") || "-";
      const normalized = normalizeFen(`${basic} ${turn} ${rights} ${ep} 0 ${fullmove}`);
      if (!normalized) return history[0] || null;
      // chess.js may correct the halfmove; keep its FEN, but remember the clock we track.
      const entry = {
        basic: normalized.split(" ")[0],
        fen: normalized.replace(/ \d+ (\d+)$/, ` ${halfmoveClock} $1`),
        turn: normalized.split(" ")[1],
        source: "dom",
        rejected: false,
        fresh: first,
      };
      const checked = normalizeFen(entry.fen);
      if (checked) entry.fen = checked;
      history.unshift(entry);
      return entry;
    },
    /** Trust a FEN that already came from the game API or a move-list replay. */
    adopt(fen) {
      const normalized = normalizeFen(fen);
      if (!normalized) return null;
      if (history[0]?.fen === normalized) return history[0];
      const parts = normalized.split(" ");
      const basic = parts[0];
      const turn = parts[1];
      const rights = parts[2] || "-";
      reset(basic);
      lostCastling = ["K", "Q", "k", "q"].filter((right) => rights === "-" || !rights.includes(right));
      const entry = { basic, fen: normalized, turn, source: "adopted", rejected: false, fresh: false };
      history = [entry];
      return entry;
    },
  };

  function applyRights(changes) {
    const piece = changes.movedPiece;
    const lose = (...rights) => {
      for (const right of rights) {
        if (!lostCastling.includes(right)) lostCastling.push(right);
      }
    };
    if (piece === "K") lose("K", "Q");
    if (piece === "k") lose("k", "q");
    if ((piece === "R" && changes.from === "h1") || (changes.capturedPiece === "R" && changes.capturedSquare === "h1")) {
      lose("K");
    }
    if ((piece === "R" && changes.from === "a1") || (changes.capturedPiece === "R" && changes.capturedSquare === "a1")) {
      lose("Q");
    }
    if ((piece === "r" && changes.from === "h8") || (changes.capturedPiece === "r" && changes.capturedSquare === "h8")) {
      lose("k");
    }
    if ((piece === "r" && changes.from === "a8") || (changes.capturedPiece === "r" && changes.capturedSquare === "a8")) {
      lose("q");
    }
  }
}

function castlingFromBasic(basic) {
  const map = {};
  const ranks = basic.split("/");
  ranks.forEach((rank, index) => {
    let file = 0;
    for (const char of rank) {
      if (char >= "1" && char <= "8") {
        file += Number(char);
        continue;
      }
      map[`${"abcdefgh"[file]}${8 - index}`] = char;
      file += 1;
    }
  });
  return inferCastling(map);
}

function emptyChanges() {
  return {
    changedSquaresAmount: 0,
    pieceAmountChange: 0,
    movedPiece: null,
    movedPieceColor: null,
    from: null,
    to: null,
    capturedPiece: null,
    capturedSquare: null,
    isEnPassant: false,
  };
}

/** Diff two placement strings. One added piece is a normal move, capture, or promotion. */
export function boardChanges(previousBasic, nextBasic) {
  const changes = emptyChanges();
  const before = expand(previousBasic);
  const after = expand(nextBasic);
  const removed = [];
  const added = [];
  for (let i = 0; i < 64; i += 1) {
    if (before[i] === after[i]) continue;
    changes.changedSquaresAmount += 1;
    const square = `${"abcdefgh"[i % 8]}${8 - Math.floor(i / 8)}`;
    if (before[i]) removed.push({ square, piece: before[i] });
    if (after[i]) added.push({ square, piece: after[i] });
  }
  changes.pieceAmountChange = added.length - removed.length;

  if (removed.length === 2 && added.length === 2) {
    const kingFrom = removed.find((entry) => entry.piece.toLowerCase() === "k");
    const kingTo = added.find((entry) => entry.piece.toLowerCase() === "k");
    if (kingFrom && kingTo) {
      changes.from = kingFrom.square;
      changes.to = kingTo.square;
      changes.movedPiece = kingFrom.piece;
    }
  }

  if (!changes.to && added.length === 1) {
    const destination = added[0];
    changes.to = destination.square;
    const source = removed.find(
      (entry) => entry.piece === destination.piece && entry.square !== destination.square,
    );
    if (source) {
      changes.from = source.square;
      changes.movedPiece = source.piece;
    } else if (destination.piece.toLowerCase() !== "p") {
      const pawn = removed.find((entry) => entry.piece.toLowerCase() === "p");
      if (pawn) {
        changes.from = pawn.square;
        changes.movedPiece = pawn.piece;
      }
    }
  }

  if (changes.to) {
    const capture = removed.find((entry) => entry.square === changes.to);
    if (capture) {
      changes.capturedPiece = capture.piece;
      changes.capturedSquare = capture.square;
    }
  }

  if (
    changes.movedPiece?.toLowerCase() === "p" &&
    removed.length === 2 &&
    added.length === 1 &&
    !changes.capturedPiece
  ) {
    const capturedPawn = removed.find(
      (entry) => entry.piece.toLowerCase() === "p" && entry.square !== changes.from,
    );
    if (capturedPawn) {
      changes.capturedPiece = capturedPawn.piece;
      changes.capturedSquare = capturedPawn.square;
      changes.isEnPassant = true;
    }
  }

  if (changes.movedPiece) {
    changes.movedPieceColor = changes.movedPiece === changes.movedPiece.toUpperCase() ? "w" : "b";
  }
  return changes;
}

function enPassantTarget(changes) {
  if (changes.movedPiece?.toLowerCase() !== "p" || !changes.from || !changes.to) return "-";
  if (changes.from[0] !== changes.to[0]) return "-";
  if (Math.abs(Number(changes.from[1]) - Number(changes.to[1])) !== 2) return "-";
  const mid = (Number(changes.from[1]) + Number(changes.to[1])) / 2;
  return `${changes.from[0]}${mid}`;
}

function expand(basic) {
  const squares = [];
  for (const rank of basic.split("/")) {
    for (const char of rank) {
      if (char >= "1" && char <= "8") {
        for (let i = 0; i < Number(char); i += 1) squares.push("");
      } else squares.push(char);
    }
  }
  return squares;
}

function elementClassName(element) {
  if (typeof element.className === "string") return element.className;
  return element.getAttribute?.("class") || "";
}
