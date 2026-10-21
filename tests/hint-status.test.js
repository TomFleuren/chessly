import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { failureText, hintStatusText, statusMayRefresh } from "../src/hint-status.js";

describe("hint status", () => {
  it("does not let the countdown replace an error", () => {
    assert.equal(statusMayRefresh("error"), false);
    assert.equal(statusMayRefresh("ready"), false);
    assert.equal(statusMayRefresh("calculating"), true);
    const shown = hintStatusText({
      phase: "error",
      errorText: "Engine failed to start",
      userToMove: true,
      remainSec: 0,
      hasMoves: false,
    });
    assert.equal(shown.text, "Engine failed to start");
    assert.equal(shown.state, "error");
  });

  it("names timeouts and startup failures", () => {
    assert.equal(failureText(new Error("uciok-timeout")), "Engine did not respond");
    assert.equal(failureText(new Error("search-timeout")), "Hint timed out");
    assert.equal(failureText("worker error: wasm"), "Engine failed to start");
    assert.equal(failureText("CRITICAL ERROR"), "Engine rejected the position");
  });
});
