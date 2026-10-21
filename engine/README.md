# Bundled engine

Chessly runs **Stockfish 19 Lite WASM**, single-threaded, from
[Stockfish.js 19.0.1](https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.1).

| | |
| --- | --- |
| UCI name | `Stockfish 19 Lite WASM` |
| Stockfish | [19, tag `sf_19`](https://github.com/official-stockfish/Stockfish/releases/tag/sf_19) (2026-09-05, commit `edb0d9d`) |
| Stockfish.js | 19.0.1 (2026-10-10) |
| Files | `stockfish-19-lite-single.js`, `stockfish-19-lite-single.wasm` |
| Network | Lite NNUE `nn-61e7af4bb97d.nnue` (embedded) |
| Threads | 1 (no cross-origin isolation required) |

The official Stockfish 19 release adds WebAssembly targets but does not attach
WASM binaries. The full Stockfish.js WASM build is about 94 MB and its
multi-threaded builds need `SharedArrayBuffer`. This lite single-threaded
build is the Stockfish 19 WASM build that fits in an extension and still plays
far above human strength.

Stockfish and this WASM build are **GPL-3.0-only**. See `COPYING.txt` and `AUTHORS`.
