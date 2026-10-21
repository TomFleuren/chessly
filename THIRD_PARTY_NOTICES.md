# Third-party notices

## Stockfish and Stockfish.js

Stockfish 19 (tag `sf_19`) and the Stockfish.js 19.0.1 WebAssembly build in
`engine/` are licensed under the GNU General Public License version 3.

- https://github.com/official-stockfish/Stockfish/releases/tag/sf_19
- https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.1
- Local copy of the license: `engine/COPYING.txt`
- Authors: `engine/AUTHORS`

Chessly as a whole is GPL-3.0-only because it includes this engine.

## A.C.A.S

Board reading for chess.com, the Elo-to-depth table, and the decision to keep
the engine off the chess page are adapted from A.C.A.S (Advanced Chess
Assistance System) by Hakorr / Psyyke:

- https://github.com/Psyyke/A.C.A.S
- https://greasyfork.org/en/scripts/459137-1-chess-assistant-a-c-a-s-advanced-chess-assistance-system

A.C.A.S is GNU GPL-3.0, the same license as Chessly. The adapted pieces are
`GET_DEPTH_FROM_ELO`, the `UCI_Elo` / `UCI_LimitStrength` cutoff at 2300 from
`setEngineElo`, and the chess.com rules in `acas.user.js` (`#board-layout-chessboard > .board`,
piece classes `square-(\d)(\d)`, the `flipped` orientation, and one-move
castling / en-passant updates). Chessly does not copy the userscript, the
multi-site adapters, live or daily game support, or automatic move playing.
Hint graphics are Chessly’s own brackets and eval badge.

## chess.js

chess.js 1.4.0 is used to validate FENs and replay move lists. It is
BSD-2-Clause, which is compatible with the GPL. Copyright (c) 2025, Jeff Hlywa.

```
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```
