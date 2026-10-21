import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("bundled Stockfish", () => {
  it("is Stockfish 19 Lite and returns a legal opening move", async () => {
    // This repo is "type": "module", which would make Node parse the engine as
    // ESM. Copy it outside the package so the stockfish.js Node entry runs as CJS.
    const dir = mkdtempSync(join(tmpdir(), "chessly-sf-"));
    for (const file of ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm"]) {
      copyFileSync(join("engine", file), join(dir, file));
    }
    const child = spawn(process.execPath, [join(dir, "stockfish-19-lite-single.js")], {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stdin.write("uci\nisready\nposition startpos\ngo depth 6\n");
    const finished = (async () => {
      const deadline = Date.now() + 20000;
      while (!output.includes("bestmove ") && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    })();
    await finished;
    child.stdin.write("quit\n");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]);
    child.kill();
    assert.match(output, /id name Stockfish 19 Lite/);
    assert.match(output, /option name UCI_Elo type spin default 1320 min 1320 max 3190/);
    assert.match(output, /bestmove [a-h][1-8][a-h][1-8]/);
  });

  it("still returns bestmove for a rated human search at Elo 2310 and 1700", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chessly-sf-"));
    for (const file of ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm"]) {
      copyFileSync(join("engine", file), join(dir, file));
    }
    const child = spawn(process.execPath, [join(dir, "stockfish-19-lite-single.js")], {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    const fen = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    const waitForMoves = async (count) => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const moves = output.match(/bestmove [a-h][1-8][a-h][1-8]/g) || [];
        if (moves.length >= count) return moves;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return output.match(/bestmove [a-h][1-8][a-h][1-8]/g) || [];
    };
    child.stdin.write(
      [
        "uci",
        "isready",
        "setoption name UCI_LimitStrength value false",
        "setoption name UCI_Elo value 2310",
        "setoption name UCI_LimitStrength value false",
        `position fen ${fen}`,
        "go depth 6",
      ].join("\n") + "\n",
    );
    await waitForMoves(1);
    child.stdin.write(
      [
        "setoption name UCI_LimitStrength value false",
        "setoption name UCI_Elo value 1700",
        "setoption name UCI_LimitStrength value true",
        `position fen ${fen}`,
        "go depth 3",
      ].join("\n") + "\n",
    );
    await waitForMoves(2);
    child.stdin.write("quit\n");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]);
    child.kill();
    const moves = output.match(/bestmove [a-h][1-8][a-h][1-8]/g) || [];
    assert.equal(moves.length >= 2, true, output.slice(-500));
  });
});
