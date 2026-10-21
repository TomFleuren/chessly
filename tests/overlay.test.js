import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { squareRect } from "../src/geometry.js";
import { renderOverlaySvg } from "../src/overlay.js";
import { formatEval, parseInfoLine, createSearchCollector } from "../src/uci.js";

describe("board geometry", () => {
  it("puts a1 at the bottom left and h8 at the top right", () => {
    const a1 = squareRect("a1", { width: 800, height: 800, flipped: false });
    const h8 = squareRect("h8", { width: 800, height: 800, flipped: false });
    assert.equal(a1.x, 0);
    assert.equal(a1.y, 700);
    assert.equal(h8.x, 700);
    assert.equal(h8.y, 0);
  });

  it("mirrors squares when the board is flipped", () => {
    const a1 = squareRect("a1", { width: 800, height: 800, flipped: true });
    const e4 = squareRect("e4", { width: 400, height: 400, flipped: true });
    assert.equal(a1.x, 700);
    assert.equal(a1.y, 0);
    assert.equal(e4.x, 150);
    assert.equal(e4.y, 150);
  });
});

describe("hint overlay", () => {
  it("draws focus brackets and an eval badge on the primary move only", () => {
    const svg = renderOverlaySvg({
      width: 800,
      height: 800,
      flipped: false,
      moves: [
        { uci: "e2e4", emphasis: "primary", label: formatEval(40, null) },
        { uci: "d2d4", emphasis: "secondary", label: "+0.2" },
      ],
    });
    assert.equal(formatEval(40, null), "+0.4");
    assert.match(svg, /\+0\.4/);
    assert.equal(svg.includes("+0.2"), false);
    assert.equal((svg.match(/<polygon /g) || []).length, 1);
    assert.ok((svg.match(/<path /g) || []).length >= 16);
    assert.equal(svg.includes("fill=\"#1c1c1e\""), true);
    const upright = svg;
    const flipped = renderOverlaySvg({
      width: 800,
      height: 800,
      flipped: true,
      moves: [{ uci: "e2e4", emphasis: "primary", label: "+0.4" }],
    });
    assert.notEqual(upright, flipped);
  });

  it("formats mate scores and parses multipv info", () => {
    assert.equal(formatEval(null, 3), "+M3");
    assert.equal(formatEval(12, -2), "-M2");
    const collector = createSearchCollector();
    collector.push(
      "info depth 10 seldepth 12 multipv 1 score cp 34 nodes 10 nps 1000 time 10 pv e2e4 e7e5",
    );
    collector.push(
      "info depth 10 seldepth 12 multipv 2 score cp 12 nodes 10 nps 1000 time 10 pv d2d4",
    );
    collector.push(
      "info depth 11 seldepth 14 multipv 1 score mate 2 nodes 20 nps 1000 time 12 pv g1f3",
    );
    const lines = collector.finish();
    assert.equal(lines.length, 1);
    assert.equal(lines[0].uci, "g1f3");
    assert.equal(lines[0].mate, 2);
    assert.equal(parseInfoLine("info string hello"), null);
  });
});
