/** Map a chess square to pixel rect on an 8×8 board. */
export function squareRect(square, { width, height, flipped = false } = {}) {
  if (typeof square !== "string" || !/^[a-h][1-8]$/.test(square)) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const col = flipped ? 7 - file : file;
  const row = flipped ? rank : 7 - rank;
  const squareWidth = width / 8;
  const squareHeight = height / 8;
  return {
    x: col * squareWidth,
    y: row * squareHeight,
    w: squareWidth,
    h: squareHeight,
  };
}

export function uciSquares(uci) {
  if (typeof uci !== "string" || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci[4] || null,
  };
}
