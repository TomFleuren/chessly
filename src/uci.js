const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export function fenKey(fen) {
  if (typeof fen !== "string") return "";
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return fen.trim();
  return parts.slice(0, 4).join(" ");
}

export function formatEval(cp, mate) {
  if (mate != null && Number.isFinite(Number(mate))) {
    const value = Number(mate);
    return `${value > 0 ? "+" : "-"}M${Math.abs(value)}`;
  }
  if (!Number.isFinite(cp)) return "";
  const pawns = cp / 100;
  if (Math.abs(pawns) < 0.05) return "0.0";
  const sign = pawns > 0 ? "+" : "-";
  return `${sign}${Math.abs(pawns).toFixed(1)}`;
}

export function parseInfoLine(line) {
  if (typeof line !== "string") return null;
  if (!line.startsWith("info ") || !line.includes(" pv ")) return null;
  if (/\bcurrmove\b/.test(line)) return null;
  const depth = readInt(line, "depth");
  const multipv = readInt(line, "multipv") ?? 1;
  const mate = readInt(line, "mate");
  const cp = readInt(line, "cp");
  if (mate == null && cp == null) return null;
  const pvIndex = line.indexOf(" pv ");
  const pv = line.slice(pvIndex + 4).trim().split(/\s+/);
  const uci = pv[0];
  if (!UCI_MOVE.test(uci || "")) return null;
  return { depth: depth ?? 0, multipv, cp, mate, uci, pv };
}

export function createSearchCollector() {
  let bestDepth = -1;
  /** @type {Map<number, Map<number, object>>} */
  const byDepth = new Map();
  return {
    push(line) {
      const info = parseInfoLine(line);
      if (!info) return;
      if (info.depth >= bestDepth) bestDepth = info.depth;
      if (!byDepth.has(info.depth)) byDepth.set(info.depth, new Map());
      byDepth.get(info.depth).set(info.multipv, info);
    },
    finish() {
      const map = byDepth.get(bestDepth);
      if (!map) return [];
      return [...map.values()].sort((a, b) => a.multipv - b.multipv);
    },
  };
}

function readInt(line, key) {
  const match = line.match(new RegExp(`\\b${key}\\s+(-?\\d+)`));
  if (!match) return null;
  return Number(match[1]);
}
