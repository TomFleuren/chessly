import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chooseHumanMove,
  selectDisplayedMoves,
  temperatureForElo,
} from "../src/human.js";
import { sanitizeSettings } from "../src/settings.js";

function mulberry32(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pool = [
  { uci: "e2e4", cp: 30, mate: null, multipv: 1 },
  { uci: "d2d4", cp: -70, mate: null, multipv: 2 },
  { uci: "g2g4", cp: -180, mate: null, multipv: 3 },
];

function rate(elo, samples = 400) {
  const rng = mulberry32(elo);
  let best = 0;
  for (let i = 0; i < samples; i += 1) {
    if (chooseHumanMove(pool, elo, rng).uci === "e2e4") best += 1;
  }
  return best / samples;
}

describe("human move sampling", () => {
  it("gets stricter as the Elo rises", () => {
    assert.ok(temperatureForElo(800) > temperatureForElo(1700));
    assert.ok(temperatureForElo(1700) > temperatureForElo(2500));
    const low = rate(800);
    const mid = rate(1700);
    const high = rate(2500);
    assert.ok(high > mid);
    assert.ok(mid > low);
    assert.ok(high > 0.9);
    assert.ok(low < 0.75);
  });

  it("shows the sampled move first and keeps the requested line count", () => {
    const shown = selectDisplayedMoves({
      mode: "human",
      lines: 2,
      elo: 800,
      candidates: pool,
      rng: () => 0.99,
    });
    assert.equal(shown.length, 2);
    assert.equal(shown[0].emphasis, "primary");
    assert.equal(shown[1].emphasis, "secondary");
    assert.notEqual(shown[0].uci, shown[1].uci);
  });

  it("shows engine order in best-move mode", () => {
    const shown = selectDisplayedMoves({
      mode: "best",
      lines: 3,
      elo: 800,
      candidates: pool,
      rng: () => 0.99,
    });
    assert.deepEqual(
      shown.map((move) => move.uci),
      ["e2e4", "d2d4", "g2g4"],
    );
    assert.equal(shown[0].emphasis, "primary");
  });
});

describe("settings cannot widen fair play", () => {
  it("drops unknown fields such as an allow-humans flag", () => {
    const settings = sanitizeSettings({
      allowHumans: true,
      enabledEverywhere: true,
      overrideAllowlist: true,
      mode: "human",
      lines: 9,
      elo: 4000,
      hintDelaySec: 0,
      analyzeOpponent: true,
    });
    assert.deepEqual(Object.keys(settings).sort(), [
      "analyzeOpponent",
      "elo",
      "hintDelaySec",
      "lines",
      "mode",
    ]);
    assert.equal(settings.mode, "human");
    assert.equal(settings.lines, 1);
    assert.equal(settings.elo, 1700);
    assert.equal(settings.hintDelaySec, 1);
    assert.equal(settings.analyzeOpponent, true);
    assert.equal("allowHumans" in settings, false);
  });
});
