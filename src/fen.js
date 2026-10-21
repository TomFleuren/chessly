import { Chess } from "chess.js";

const PIECE_LETTER = {
  wp: "P",
  wn: "N",
  wb: "B",
  wr: "R",
  wq: "Q",
  wk: "K",
  bp: "p",
  bn: "n",
  bb: "b",
  br: "r",
  bq: "q",
  bk: "k",
};

const FIGURINES = {
  king: "K",
  queen: "Q",
  rook: "R",
  bishop: "B",
  knight: "N",
  k: "K",
  q: "Q",
  r: "R",
  b: "B",
  n: "N",
};

const SAN_PATTERN =
  /^(?:O-O-O|O-O)[+#]?$|^[KQRBN][a-h]?[1-8]?x?[a-h][1-8][+#]?$|^[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?$|^[a-h][1-8](?:=[QRBN])?[+#]?$/;

const START_PLACEMENT = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

export function squareFromClass(className) {
  const match = String(className).match(/\bsquare-([1-8])([1-8])\b/);
  if (!match) return null;
  return `abcdefgh`[Number(match[1]) - 1] + match[2];
}

export function pieceMapFromElements(elements) {
  const map = {};
  for (const element of elements || []) {
    const className =
      typeof element?.className === "string"
        ? element.className
        : String(element?.className?.baseVal || element || "");
    const tokens = className.split(/\s+/);
    const pieceToken = tokens.find((token) => PIECE_LETTER[token]);
    const squareToken = tokens.find((token) => /^square-[1-8][1-8]$/.test(token));
    const square = squareToken ? squareFromClass(squareToken) : element?.square || null;
    if (!pieceToken || !/^[a-h][1-8]$/.test(square || "")) continue;
    map[square] = PIECE_LETTER[pieceToken];
  }
  return map;
}

export function pieceSignature(elements) {
  const map = pieceMapFromElements(elements);
  return Object.keys(map)
    .sort()
    .map((square) => `${square}${map[square]}`)
    .join(",");
}

export function placementFromMap(map) {
  const ranks = [];
  for (let rank = 8; rank >= 1; rank -= 1) {
    let row = "";
    let empty = 0;
    for (let file = 0; file < 8; file += 1) {
      const piece = map[`abcdefgh`[file] + rank];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty) {
        row += empty;
        empty = 0;
      }
      row += piece;
    }
    if (empty) row += empty;
    ranks.push(row);
  }
  return ranks.join("/");
}

export function placementOfFen(fen) {
  return String(fen || "").split(/\s+/)[0] || "";
}

export function placementMatches(fen, pieceMap) {
  if (!pieceMap || Object.keys(pieceMap).length === 0) return false;
  return placementOfFen(fen) === placementFromMap(pieceMap);
}

/** Run a FEN through chess.js so illegal en-passant squares are stripped. */
export function normalizeFen(fen) {
  if (typeof fen !== "string" || !fen.trim()) return null;
  try {
    return new Chess(fen.trim()).fen();
  } catch {
    return null;
  }
}

export function cleanSan(raw) {
  let text = String(raw || "").replace(/\s+/g, "");
  text = text.replace(/^\d+\.(?:\.\.)?/, "");
  text = text.replace(/[?!]+$/g, "");
  text = text.replace(/0-0-0/g, "O-O-O").replace(/0-0/g, "O-O");
  return text;
}

export function figurineFromNode(node) {
  const marked = node?.querySelector?.("[data-figurine]");
  const attr = marked?.getAttribute?.("data-figurine") || "";
  if (FIGURINES[attr.toLowerCase()]) return FIGURINES[attr.toLowerCase()];
  if (/^[KQRBN]$/.test(attr)) return attr;
  const icon = node?.querySelector?.(".icon-font-chess") || marked;
  const className = String(icon?.className || "");
  for (const [name, letter] of Object.entries(FIGURINES)) {
    if (name.length > 1 && className.includes(name)) return letter;
  }
  return "";
}

export function sanFromMoveNode({ text = "", figurine = "" } = {}) {
  const cleaned = cleanSan(text);
  if (figurine && !/^[KQRBN]/.test(cleaned) && !cleaned.startsWith("O-")) {
    return cleanSan(figurine + cleaned);
  }
  return cleaned;
}

export function sansFromNodes(nodes) {
  const moves = [];
  for (const node of nodes || []) {
    const san = typeof node === "string" ? cleanSan(node) : sanFromMoveNode(node);
    if (SAN_PATTERN.test(san)) moves.push(san);
  }
  return moves;
}

export function replaySans(sans) {
  const chess = new Chess();
  for (const san of sans || []) {
    let played = null;
    try {
      played = chess.move(san);
    } catch {
      played = null;
    }
    if (!played) return null;
  }
  return chess.fen();
}

export function inferCastling(map) {
  let rights = "";
  if (map.e1 === "K" && map.h1 === "R") rights += "K";
  if (map.e1 === "K" && map.a1 === "R") rights += "Q";
  if (map.e8 === "k" && map.h8 === "r") rights += "k";
  if (map.e8 === "k" && map.a8 === "r") rights += "q";
  return rights || "-";
}

/**
 * If the side to move is facing a pawn that just double-stepped, return the
 * en-passant square. chess.js drops the square again when nobody can capture.
 */
export function inferEp(map, highlights, turn) {
  if (!Array.isArray(highlights) || highlights.length !== 2) return "-";
  if (turn !== "w" && turn !== "b") return "-";
  const [first, second] = highlights;
  if (!/^[a-h][1-8]$/.test(first) || !/^[a-h][1-8]$/.test(second)) return "-";
  if (first[0] !== second[0]) return "-";
  if (Math.abs(Number(first[1]) - Number(second[1])) !== 2) return "-";
  const pawnSquare = [first, second].find((square) => {
    const piece = map[square];
    return piece === "P" || piece === "p";
  });
  const emptySquare = [first, second].find((square) => !map[square]);
  if (!pawnSquare || !emptySquare) return "-";
  const rank = Number(pawnSquare[1]);
  if (map[pawnSquare] === "P" && rank === 4 && turn === "b") return `${pawnSquare[0]}3`;
  if (map[pawnSquare] === "p" && rank === 5 && turn === "w") return `${pawnSquare[0]}6`;
  return "-";
}

export function turnFromClocks({ bottomActive = false, topActive = false, flipped = false } = {}) {
  if (Boolean(bottomActive) === Boolean(topActive)) return null;
  const bottomColor = flipped ? "b" : "w";
  if (bottomActive) return bottomColor;
  return bottomColor === "w" ? "b" : "w";
}

/**
 * Build a FEN from a chess.com-shaped snapshot.
 *
 * Preference order:
 *  1. board.game.getFEN(), if chess.js accepts it and it matches the pieces
 *  2. SAN move list replay, if it matches the pieces
 *  3. Piece classes, with castling and en passant inferred
 */
export function extractFen(snapshot = {}) {
  const pieces = snapshot.pieces ? pieceMapFromElements(snapshot.pieces) : null;
  const hasPieces = pieces && Object.keys(pieces).length > 0;

  if (snapshot.apiFen) {
    const normalized = normalizeFen(snapshot.apiFen);
    if (normalized && (!hasPieces || placementMatches(normalized, pieces))) {
      return { fen: normalized, turn: normalized.split(" ")[1], source: "api" };
    }
  }

  const sans = Array.isArray(snapshot.sans) ? snapshot.sans : sansFromNodes(snapshot.moveNodes);
  if (sans?.length) {
    const replayed = replaySans(sans);
    if (replayed && (!hasPieces || placementMatches(replayed, pieces))) {
      return { fen: replayed, turn: replayed.split(" ")[1], source: "moves" };
    }
  }

  if (!hasPieces) return null;
  const turn = resolveTurn(snapshot, pieces, sans);
  if (turn !== "w" && turn !== "b") return null;
  const castling = inferCastling(pieces);
  const ep = inferEp(pieces, snapshot.highlights, turn);
  const fullmove = resolveFullmove(snapshot, sans);
  const normalized = normalizeFen(
    `${placementFromMap(pieces)} ${turn} ${castling} ${ep} 0 ${fullmove}`,
  );
  if (!normalized) return null;
  return { fen: normalized, turn: normalized.split(" ")[1], source: "dom" };
}

function resolveTurn(snapshot, pieces, sans) {
  if (snapshot.turn === "w" || snapshot.turn === "b") return snapshot.turn;
  if (placementFromMap(pieces) === START_PLACEMENT && !(snapshot.highlights || []).length) {
    return "w";
  }
  if (sans?.length) return sans.length % 2 === 0 ? "w" : "b";
  return null;
}

function resolveFullmove(snapshot, sans) {
  if (Number.isInteger(snapshot.fullmove) && snapshot.fullmove > 0) return snapshot.fullmove;
  if (sans?.length) return Math.floor(sans.length / 2) + 1;
  return 1;
}
