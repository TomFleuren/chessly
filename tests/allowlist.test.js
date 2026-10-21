import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { engineRequestAllowed, isBotGameUrl, normalizeChessPath } from "../src/allowlist.js";

describe("bot page allowlist", () => {
  const allowed = [
    "https://www.chess.com/play/computer",
    "https://www.chess.com/play/computer/",
    "https://chess.com/play/computer",
    "https://WWW.CHESS.COM/play/computer/Jimmy",
    "https://www.chess.com/play/computer/bots",
    "https://www.chess.com/play/computer/bots/",
    "https://www.chess.com/play/computer?opponent=nelson",
    "https://www.chess.com/play/computer#game",
    "https://www.chess.com/play/computer/CoachMaya/game",
    "https://user:secret@www.chess.com/play/computer",
  ];

  const denied = [
    "https://www.chess.com/play/online",
    "https://www.chess.com/play/online/123",
    "https://www.chess.com/game/live/12345",
    "https://www.chess.com/game/daily/99",
    "https://www.chess.com/play/arena",
    "https://www.chess.com/tournament/1",
    "https://www.chess.com/live",
    "https://www.chess.com/analysis",
    "https://www.chess.com/analysis/game",
    "https://www.chess.com/puzzles/1",
    "https://www.chess.com/play/coach",
    "https://www.chess.com/",
    "https://www.chess.com/play/computerized",
    "https://www.chess.com/play/computer-extra",
    "https://www.chess.com/play/computer2",
    "http://www.chess.com/play/computer",
    "https://evil.com/play/computer",
    "https://chess.com.evil.com/play/computer",
    "https://www.chess.com.evil.com/play/computer",
    "https://preview.chess.com/play/computer",
    "https://www.chess.com./play/computer",
    "https://www.chess.com/game/live/1?from=/play/computer",
    "https://www.chess.com/play/online?next=/play/computer",
    "https://www.chess.com/play/computer/../../game/live/1",
    "https://www.chess.com/play/computer/%2e%2e/%2e%2e/game/live/9",
    "https://www.chess.com/play/computer%2F..%2Fgame/live",
    "https://not a url",
    "",
    "file:///play/computer",
  ];

  for (const url of allowed) {
    it(`allows ${url}`, () => {
      assert.equal(isBotGameUrl(url), true);
    });
  }

  for (const url of denied) {
    it(`denies ${url}`, () => {
      assert.equal(isBotGameUrl(url), false);
    });
  }

  it("resolves encoded traversals out of the allowlist", () => {
    assert.equal(
      normalizeChessPath("/play/computer/%2e%2e/%2e%2e/game/live/9"),
      "/game/live/9",
    );
    assert.equal(normalizeChessPath("/play/computer%2F..%2Fgame/live"), "/play/game/live");
  });

  it("rejects a malformed escape instead of guessing", () => {
    assert.equal(normalizeChessPath("/play/computer/%E0%A4%A"), null);
    assert.equal(isBotGameUrl("https://www.chess.com/play/computer/%E0%A4%A"), false);
  });
});

describe("engine request gate", () => {
  it("requires the tab url itself to be allowlisted", () => {
    assert.equal(
      engineRequestAllowed({
        tabUrl: "https://www.chess.com/game/live/1",
        pageUrl: "https://www.chess.com/play/computer",
      }),
      false,
    );
  });

  it("lets the page url veto a stale allowlisted tab", () => {
    assert.equal(
      engineRequestAllowed({
        tabUrl: "https://www.chess.com/play/computer",
        pageUrl: "https://www.chess.com/game/live/42",
      }),
      false,
    );
  });

  it("allows only when both urls are bot pages", () => {
    assert.equal(
      engineRequestAllowed({
        tabUrl: "https://www.chess.com/play/computer/Nelson",
        pageUrl: "https://chess.com/play/computer/Nelson",
      }),
      true,
    );
  });

  it("allows a matching tab when the page did not supply a url", () => {
    assert.equal(
      engineRequestAllowed({ tabUrl: "https://www.chess.com/play/computer" }),
      true,
    );
  });
});
