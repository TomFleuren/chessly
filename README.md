# Chessly

Chessly is a Manifest V3 browser extension that shows move hints on [chess.com](https://www.chess.com) **only while you are on a Play vs Computer page**. It runs Stockfish locally inside the extension. It does not talk to an analysis server.

## Fair play: bots only

Chessly is an allowlist, not a blocklist.

The engine is allowed to start only when the page URL is:

- `https://www.chess.com/play/computer`
- `https://chess.com/play/computer`
- a sub-route of those, such as `https://www.chess.com/play/computer/Jimmy`

On every other chess.com page — live games (`/game/live`), daily games (`/game/daily`), Play Online (`/play/online`), tournaments, arena, analysis, puzzles, coach — Chessly does **not** start Stockfish, does **not** draw brackets or arrows, and the panel shows:

> Chessly is only available against bots

There is no setting, flag, query parameter, or hidden toggle that overrides this. Settings stored in `chrome.storage` are filtered to hint preferences only; unknown fields are discarded.

The check runs again on every URL change (`pushState`, `replaceState`, `popstate`, `hashchange`, and a short poll), when the background script sees a history update, and whenever the board position returns to the starting position for a new game. Leaving a bot game shuts the engine down immediately. A page-supplied URL can veto an engine request, but it can never grant one: the browser tab URL has to be on the allowlist as well.

A second, DOM-level check runs on those pages. Visible human-game markers (live board, daily board, Play Online board) veto the engine even if the URL has not caught up. Bot markers such as `#board-play-computer`, a bot player row, or a bot avatar confirm the opponent. If the DOM is still inconclusive, the URL allowlist is what decides — a human-game URL is never enough to pass, and a bot-looking DOM on a human-game URL is ignored.

## Install (unpacked)

Chrome, Edge, Brave, or another Chromium browser:

1. Clone this repository.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select this folder (the one that contains `manifest.json`).
5. Open [chess.com/play/computer](https://www.chess.com/play/computer) and start a game against a bot.

No build step is required to load the extension. `dist/` is already built.

Firefox (best effort): `about:debugging` → **This Firefox** → **Load Temporary Add-on** → select `manifest.json`. Firefox has no `offscreen` API. If the manifest loads, Chessly falls back to starting the Stockfish worker from the content script. Chrome is the tested target.

## Features

- **Hint timer.** On your turn, if you have not moved for 10 seconds, the hint appears. The delay is configurable from 1 to 30 seconds (default 10). The hint disappears as soon as the piece placement changes.
- **Best move / Human move.** Best move shows Stockfish’s top line or lines. Human move picks a rating-weighted candidate (see below).
- **Lines & arrows.** Show 1, 2, or 3 candidate moves.
- **Hint level (Lichess Elo).** Slider from 800 to 2500, default ≈ 1700, used in Human move mode.
- **Analyze opponent’s turn.** When on, Chessly predicts the bot’s move during the bot’s turn and searches your reply, so the hint is ready when your timer finishes. When off, the engine stays idle until it is your turn.
- **Settings** persist in `chrome.storage.local`.

The panel is a dark rounded card: a small grey uppercase **ANALYSIS** heading, a pill toggle, a 1 / 2 / 3 line selector, the Elo readout and slider, an iOS-style switch, and the hint-delay row. Drag the heading to move it.

## Hint graphics

On your move, the chosen from-square and to-square get dark grey corner brackets (a camera focus frame), with a thin light edge so they stay visible on dark squares. There is no filled highlight. The to-square carries a small dark badge with the evaluation from the side to move, such as `+0.4` or `+M3`. Extra candidates are lighter arrows. The overlay follows the board’s size and the `flipped` class.

## How a position becomes a FEN

Chessly prefers, in order:

1. `board.game.getFEN()` on `wc-chess-board` / `chess-board`, when chess.js accepts it and it matches the pieces on the board.
2. The SAN move list (including figurine icons), replayed with chess.js, when the resulting placement matches the board.
3. Piece elements (`.piece.wp.square-52` and `data-square`), plus castling and en-passant inferred from king/rook squares and the last-move highlights.

Every FEN is passed through chess.js before it is sent to Stockfish. Stockfish 19 rejects illegal positions and then exits; normalizing first avoids that. Your color comes from `getPlayingAs()` when chess.com exposes it, otherwise from which side of the board the bot is sitting on.

## Engine

| | |
| --- | --- |
| Build | **Stockfish 19 Lite WASM**, single-threaded |
| UCI id | `Stockfish 19 Lite WASM` |
| Stockfish | 19, tag [`sf_19`](https://github.com/official-stockfish/Stockfish/releases/tag/sf_19) (2026-09-05, commit `edb0d9d`) |
| Packaged by | [Stockfish.js 19.0.1](https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.1) |
| Files | `engine/stockfish-19-lite-single.js`, `engine/stockfish-19-lite-single.wasm` |
| NNUE | Lite net `nn-61e7af4bb97d.nnue` |

Official Stockfish 19 builds WebAssembly, but the GitHub release only publishes native binaries. The full Stockfish.js WASM file is about 94 MB, and the multi-threaded builds need cross-origin isolation (`SharedArrayBuffer`), which an extension page on chess.com does not have. The lite single-threaded build is the Stockfish 19 WASM build that runs inside the extension. It is weaker than full Stockfish 19 and still far stronger than a human.

On Chrome the worker lives in an offscreen document so chess.com’s page CSP cannot block it. The content script never links to an external engine.

## Human move mode

The Elo slider is a **Lichess-style rating from 800 to 2500**, not Stockfish’s `UCI_Elo` option. On this build `UCI_Elo` only accepts 1320–3190 and is a different scale, so it cannot represent the lower end of the slider.

Human move mode still searches at full strength (the badge stays an honest evaluation) with MultiPV, then samples one candidate with a softmax over centipawn gaps:

```
temperature(elo) = 15 + 145 * exp(-(elo - 800) / 700)
weight(move)     = exp(-(bestCp - moveCp) / temperature)
```

Approximate temperatures: 800 → 160cp, 1700 → 55cp, 2500 → 28cp. A 2500-rated sample almost always plays the best move. An 800-rated sample often plays a noticeably worse one. The sampled move is the one drawn with brackets; the other lines, if requested, are the remaining engine candidates.

## Develop

```bash
npm install
npm test
npm run build   # rewrites dist/ after source changes
```

Tests cover the URL allowlist (including encoded `..` escapes), the human-game DOM veto, FEN extraction from piece classes and move lists, overlay geometry, human-move sampling, and a smoke test that the bundled engine identifies itself as Stockfish 19 Lite and returns a move.

## License

Chessly is **GPL-3.0-only** because it includes Stockfish. See `LICENSE`, `engine/COPYING.txt`, and `THIRD_PARTY_NOTICES.md`. chess.js is BSD-2-Clause.

## What this repository cannot verify by itself

chess.com sits behind a bot check, and its board markup is not published as a stable API. Selectors (`wc-chess-board`, `.piece`, `square-XY`, `#board-play-computer`, `.clock-top` / `.clock-bottom`, `board.game.getFEN`) match the DOM chess.com has used recently, and the extension prefers the internal FEN when it is present. If chess.com renames those nodes, piece reading or the bot-marker confirmation can miss until the selectors are updated. The URL allowlist does not depend on those names. The overlay alignment, flip handling, and resize tracking are implemented against `getBoundingClientRect` and the `flipped` class, and were not exercised on a live logged-in bot game in this environment.
