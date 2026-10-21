import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createEngineClient } from "../src/engine-client.js";

const PAGE = "https://www.chess.com/play/computer";

afterEach(() => {
  delete globalThis.chrome;
  delete globalThis.Worker;
});

function chromeWith(response) {
  const sent = [];
  globalThis.chrome = {
    runtime: {
      id: "chessly-test",
      sendMessage(message, callback) {
        sent.push(message);
        callback(response(message));
      },
      onMessage: {
        addListener() {},
        removeListener() {},
      },
      getURL(path) {
        return `chrome-extension://chessly-test/${path}`;
      },
    },
  };
  return sent;
}

describe("engine transport", () => {
  it("uses the background offscreen worker when the content script has no offscreen API", async () => {
    const sent = chromeWith(() => ({ ok: true }));
    const constructed = [];
    globalThis.Worker = class {
      constructor(url) {
        constructed.push(url);
      }
    };
    const client = createEngineClient();
    assert.equal(await client.start(PAGE), "offscreen");
    assert.equal(constructed.length, 0);
    assert.equal(sent[0].type, "START");
    assert.equal(sent[0].target, "background");
    await client.stop(PAGE);
  });

  it("starts a direct worker only when the browser has no offscreen API", async () => {
    chromeWith(() => ({ ok: false, reason: "offscreen-unavailable" }));
    let url = "";
    globalThis.Worker = class {
      constructor(script) {
        url = script;
      }
      postMessage() {}
      terminate() {}
    };
    const client = createEngineClient();
    assert.equal(await client.start(PAGE), "worker");
    assert.match(url, /stockfish-19-lite-single\.js#/);
    assert.match(decodeURIComponent(url.split("#")[1]), /stockfish-19-lite-single\.wasm$/);
    await client.stop(PAGE);
  });

  it("does not fall back to a page worker when the tab is rejected", async () => {
    chromeWith(() => ({ ok: false, reason: "not-bot-page" }));
    let constructed = false;
    globalThis.Worker = class {
      constructor() {
        constructed = true;
      }
    };
    const client = createEngineClient();
    await assert.rejects(() => client.start(PAGE), /not-bot-page/);
    assert.equal(constructed, false);
  });
});
