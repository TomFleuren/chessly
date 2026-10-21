import { squareRect, uciSquares } from "./geometry.js";

const LABEL_PATTERN = /^(?:[+-]M\d+|0\.0|[+-]\d+\.\d)$/;

/**
 * Inner SVG markup for hint brackets and secondary arrows.
 * Primary move: dark grey focus brackets on the from-square and to-square,
 * plus an eval badge on the to-square. Extra lines: lighter arrows.
 */
export function renderOverlaySvg({ width, height, flipped = false, moves = [] } = {}) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "";
  }
  const parts = [];
  for (const move of moves) {
    if (move?.emphasis !== "secondary") continue;
    const squares = uciSquares(move.uci);
    if (!squares) continue;
    const from = squareRect(squares.from, { width, height, flipped });
    const to = squareRect(squares.to, { width, height, flipped });
    if (!from || !to) continue;
    parts.push(arrow(from, to));
  }
  for (const move of moves) {
    if (move?.emphasis === "secondary") continue;
    const squares = uciSquares(move.uci);
    if (!squares) continue;
    const from = squareRect(squares.from, { width, height, flipped });
    const to = squareRect(squares.to, { width, height, flipped });
    if (!from || !to) continue;
    parts.push(brackets(from, 1));
    parts.push(brackets(to, 1));
    if (typeof move.label === "string" && LABEL_PATTERN.test(move.label)) {
      parts.push(badge(to, move.label));
    }
  }
  return parts.join("");
}

function brackets(rect, opacity) {
  const length = Math.min(rect.w, rect.h) * 0.28;
  const inset = Math.min(rect.w, rect.h) * 0.07;
  const stroke = Math.max(2.25, Math.min(rect.w, rect.h) * 0.045);
  const x0 = rect.x + inset;
  const y0 = rect.y + inset;
  const x1 = rect.x + rect.w - inset;
  const y1 = rect.y + rect.h - inset;
  const corners = [
    `M ${n(x0)} ${n(y0 + length)} L ${n(x0)} ${n(y0)} L ${n(x0 + length)} ${n(y0)}`,
    `M ${n(x1 - length)} ${n(y0)} L ${n(x1)} ${n(y0)} L ${n(x1)} ${n(y0 + length)}`,
    `M ${n(x0)} ${n(y1 - length)} L ${n(x0)} ${n(y1)} L ${n(x0 + length)} ${n(y1)}`,
    `M ${n(x1 - length)} ${n(y1)} L ${n(x1)} ${n(y1)} L ${n(x1)} ${n(y1 - length)}`,
  ];
  return corners
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="#f4f4f5" stroke-width="${n(stroke + 1.8)}" stroke-linecap="square" stroke-linejoin="miter" opacity="${opacity}"/>` +
        `<path d="${d}" fill="none" stroke="#2a2a2a" stroke-width="${n(stroke)}" stroke-linecap="square" stroke-linejoin="miter" opacity="${opacity}"/>`,
    )
    .join("");
}

function badge(rect, label) {
  const height = clamp(rect.h * 0.2, 13, 18);
  const width = Math.max(height * 1.7, label.length * (height * 0.62) + 8);
  const x = rect.x + rect.w - width - rect.w * 0.04;
  const y = rect.y + rect.h * 0.045;
  const fontSize = height * 0.68;
  return (
    `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" rx="${n(height * 0.22)}" fill="#1c1c1e"/>` +
    `<text x="${n(x + width / 2)}" y="${n(y + height * 0.74)}" text-anchor="middle" fill="#ffffff" font-size="${n(fontSize)}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-weight="700">${label}</text>`
  );
}

function arrow(from, to) {
  const x1 = from.x + from.w / 2;
  const y1 = from.y + from.h / 2;
  const x2 = to.x + to.w / 2;
  const y2 = to.y + to.h / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const shaft = Math.min(from.w, from.h) * 0.075;
  const head = shaft * 3.3;
  const headWidth = shaft * 2.15;
  const startPad = Math.min(from.w, from.h) * 0.18;
  const endPad = Math.min(to.w, to.h) * 0.12;
  const sx = x1 + ux * startPad;
  const sy = y1 + uy * startPad;
  const ex = x2 - ux * endPad;
  const ey = y2 - uy * endPad;
  const baseX = ex - ux * head;
  const baseY = ey - uy * head;
  const points = [
    [sx + px * shaft, sy + py * shaft],
    [baseX + px * shaft, baseY + py * shaft],
    [baseX + px * headWidth, baseY + py * headWidth],
    [ex, ey],
    [baseX - px * headWidth, baseY - py * headWidth],
    [baseX - px * shaft, baseY - py * shaft],
    [sx - px * shaft, sy - py * shaft],
  ];
  const pointsAttr = points.map(([x, y]) => `${n(x)},${n(y)}`).join(" ");
  return `<polygon points="${pointsAttr}" fill="#8d8d93" opacity="0.55"/>`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function n(value) {
  return Number(value).toFixed(2);
}
