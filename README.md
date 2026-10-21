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

On Chrome the worker lives in an offscreen document, the same idea as [A.C.A.S](https://github.com/Psyyke/A.C.A.S) keeping the engine off the chess page: chess.com’s page CSP cannot see or block the WASM worker. The content script only reads the board and draws the hint. It does not start the worker itself. Chrome does not expose `chrome.offscreen` to content scripts, so an earlier build fell through to `new Worker` inside the page, the worker never came up, and the status line kept saying “Calculating hint…”. A failed or timed-out search now stays on a visible error (`Engine failed to start`, `Engine did not respond`, `Hint timed out`, or `Engine rejected the position`) and the page console logs lines prefixed with `[Chessly]`.

## Human move mode

The Elo slider is a Lichess-style rating from 800 to 2500. Human move mode follows A.C.A.S `setEngineElo` / `GET_DEPTH_FROM_ELO`:

- Search depth is 1 at 800, 3 at 1700, 6 at 2310, and 7 at 2500.
- At or below 2300, and only when the rating is inside this build’s `UCI_Elo` range (1320–3190), Chessly sets `UCI_Elo` and `UCI_LimitStrength`. `UCI_Elo` is set before limit-strength is turned on.
- Above 2300 the search stays full strength and just stops at that depth. 2310 is in this band.
- Ratings below 1320 are not sent as `UCI_Elo`. This build rejects values outside 1320–3190, and Skill Level no longer exists in Stockfish 19, so a low rating is depth 1 only.

Best move mode ignores the slider and searches at full strength for 700 ms. In both modes the first engine line is the bracketed move. Extra lines are the next MultiPV results. The badge is that line’s evaluation from the side to move.

## Develop

```bash
npm install
npm test
npm run build   # rewrites dist/ after source changes
```

Tests cover the URL allowlist (including encoded `..` escapes), the human-game DOM veto, FEN extraction, the chess.com piece/orientation tracker, the rated-search commands, overlay geometry, and a smoke test that Stockfish 19 Lite returns a move for both a full-strength search and the Elo 2310 / 1700 human-move settings.

## License

Chessly is **GPL-3.0-only** because it includes Stockfish. See `LICENSE`, `engine/COPYING.txt`, and `THIRD_PARTY_NOTICES.md`. chess.js is BSD-2-Clause.

Board reading, the depth-from-Elo table, and the “engine off the chess page” split are adapted from [A.C.A.S](https://github.com/Psyyke/A.C.A.S) by Hakorr / Psyyke, also GPL-3.0. Chessly does not include A.C.A.S’s multi-site support, live or daily games, or automatic moving. The hint graphics stay the Chessly brackets and eval badge.

## What this repository cannot verify by itself

chess.com sits behind a bot check, and its board markup is not published as a stable API. Selectors follow the chess.com path in A.C.A.S: `#board-layout-chessboard > .board`, `.piece` with `(b|w)[prnbqk]` and `square-XY`, and the `flipped` class. `wc-chess-board` / `board.game.getFEN()` is still preferred when chess.com exposes it and it matches the pieces. If chess.com renames those nodes, piece reading or the bot-marker confirmation can miss until the selectors are updated. The URL allowlist does not depend on those names.
