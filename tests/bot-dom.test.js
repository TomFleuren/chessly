import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  botSeatFromPlayers,
  classifySignals,
  inferPlayingAs,
  readDomSignals,
  rowIsBot,
} from "../src/bot-dom.js";

function element({
  className = "",
  hidden = false,
  attrs = {},
  text = "",
  rect = null,
  tag = "div",
  children = [],
}) {
  return {
    className,
    hidden,
    tag,
    textContent: text,
    getAttribute(name) {
      return attrs[name] ?? null;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      if (selector === "img" || selector === "a") {
        return children.filter((child) => child.tag === selector);
      }
      return children.filter((child) => child.matches(selector));
    },
    getBoundingClientRect: rect ? () => rect : undefined,
    matches(selector) {
      if (selector.includes("bot-name") && attrs["data-cy"] === "bot-name") return true;
      if (selector.includes("data-bot") && attrs["data-bot"] != null) return true;
      return false;
    },
  };
}

function fakeDocument(hits) {
  return {
    querySelector(selector) {
      if (hits[selector]) return hits[selector];
      for (const part of selector.split(",")) {
        const key = part.trim();
        if (hits[key]) return hits[key];
      }
      return null;
    },
  };
}

describe("bot DOM second check", () => {
  it("refuses every non-allowlisted url even if the DOM looks like a bot", () => {
    for (const url of [
      "https://www.chess.com/game/live/1",
      "https://www.chess.com/game/daily/2",
      "https://www.chess.com/play/online",
      "https://www.chess.com/tournament/3",
    ]) {
      const decision = classifySignals({
        url,
        hasBotMarker: true,
        hasHumanMarker: false,
        botSeat: "top",
      });
      assert.equal(decision.activate, false);
      assert.equal(decision.reason, "not-bot-page");
    }
  });

  it("activates on an allowlisted url with a bot marker", () => {
    const decision = classifySignals({
      url: "https://www.chess.com/play/computer/Jimmy",
      hasBotMarker: true,
    });
    assert.equal(decision.activate, true);
    assert.equal(decision.reason, "bot-dom");
    assert.equal(decision.domUnconfirmed, false);
  });

  it("vetoes an allowlisted url when a human-game marker is visible", () => {
    const decision = classifySignals({
      url: "https://www.chess.com/play/computer",
      hasBotMarker: true,
      hasHumanMarker: true,
    });
    assert.equal(decision.activate, false);
    assert.equal(decision.reason, "human-game-dom");
  });

  it("keeps the url allowlist when the DOM has no opinion", () => {
    const decision = classifySignals({
      url: "https://chess.com/play/computer/bots",
    });
    assert.equal(decision.activate, true);
    assert.equal(decision.reason, "url-allowlist");
    assert.equal(decision.domUnconfirmed, true);
  });

  it("reads visible bot and human markers from a document", () => {
    const signals = readDomSignals(
      fakeDocument({
        "#board-play-computer": element({ rect: { width: 400, height: 400 } }),
        "#board-live": element({ rect: { width: 0, height: 0 } }),
        ".player-top": element({ className: "player-top bot-player-component" }),
        ".clock-top": null,
      }),
    );
    assert.equal(signals.hasBotMarker, true);
    assert.equal(signals.hasHumanMarker, false);
    assert.equal(signals.botSeat, "top");
  });

  it("ignores a hidden human marker", () => {
    const signals = readDomSignals(
      fakeDocument({
        "#board-live": element({ hidden: true, rect: { width: 400, height: 400 } }),
      }),
    );
    assert.equal(signals.hasHumanMarker, false);
  });
});

describe("player color inference", () => {
  it("recognizes a bot row from structure, not from the word bottom", () => {
    assert.equal(rowIsBot(element({ className: "player-bottom" })), false);
    assert.equal(rowIsBot(element({ className: "bot-player-component" })), true);
    assert.equal(
      rowIsBot(
        element({
          children: [
            element({
              tag: "img",
              attrs: { src: "https://images.chesscomfiles.com/bots/jimmy.png" },
            }),
          ],
        }),
      ),
      true,
    );
  });

  it("places the user opposite the bot, including a flipped board", () => {
    assert.equal(botSeatFromPlayers({ topIsBot: true }), "top");
    assert.equal(botSeatFromPlayers({ bottomIsBot: true }), "bottom");
    assert.equal(botSeatFromPlayers({ topIsBot: true, bottomIsBot: true }), null);
    assert.equal(inferPlayingAs({ botSeat: "top", flipped: false }), "w");
    assert.equal(inferPlayingAs({ botSeat: "top", flipped: true }), "b");
    assert.equal(inferPlayingAs({ botSeat: "bottom", flipped: true }), "w");
    assert.equal(inferPlayingAs({ botSeat: "bottom", flipped: false }), "b");
  });
});
