import { Chess } from "chess.js";
import { BOT_ONLY_NOTICE } from "../allowlist.js";
import { classifySignals, inferPlayingAs, readDomSignals } from "../bot-dom.js";
import { createEngineClient } from "../engine-client.js";
import {
  extractFen,
  figurineFromNode,
  pieceSignature,
  sansFromNodes,
  squareFromClass,
  turnFromClocks,
} from "../fen.js";
import { selectDisplayedMoves } from "../human.js";
import { renderOverlaySvg } from "../overlay.js";
import { DEFAULT_SETTINGS, sameSettings, sanitizeSettings, STORAGE_KEY } from "../settings.js";
import { createSearchCollector, fenKey, formatEval } from "../uci.js";

const MOVETIME_MS = 700;
const HUMAN_POOL = 5;
const START_PLACEMENT = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

if (!globalThis.__CHESSLY_BOOTED__) {
  globalThis.__CHESSLY_BOOTED__ = true;
  boot();
}

function boot() {
  const panel = createPanel();
  document.documentElement.appendChild(panel.card);
  enableDrag(panel.card, panel.handle);

  let settings = sanitizeSettings(DEFAULT_SETTINGS);
  let activated = false;
  let engine = null;
  let engineReady = null;
  let engineName = "";
  let searchToken = 0;
  let currentKey = "";
  let currentFen = "";
  let lastSignature = "";
  let hintedSignature = "";
  let turnStarted = 0;
  let userToMove = false;
  let playingAs = null;
  let hintTimer = 0;
  let lastPool = null;
  let displayMoves = null;
  let showing = false;
  let overlay = null;
  let trackRaf = 0;
  let boardObserver = null;
  let observedBoard = null;

  const applied = {
    mode: settings.mode,
    lines: settings.lines,
    elo: settings.elo,
    analyzeOpponent: settings.analyzeOpponent,
  };

  chrome.storage?.local.get(STORAGE_KEY, (stored) => {
    const next = sanitizeSettings(stored?.[STORAGE_KEY]);
    if (sameSettings(next, settings)) return;
    settings = next;
    Object.assign(applied, settings);
    panel.apply(settings);
  });

  chrome.storage?.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY]) return;
    const incoming = sanitizeSettings(changes[STORAGE_KEY].newValue);
    if (sameSettings(incoming, settings)) return;
    settings = incoming;
    panel.apply(settings);
    onSettingsChanged();
  });

  chrome.runtime?.onMessage.addListener((message) => {
    if (message?.target !== "content") return;
    if (message.type === "DEACTIVATE") deactivate();
    if (message.type === "ENGINE_ERROR") panel.setStatus("Engine restarted");
  });

  installNavigationHooks(() => reconcile());
  const pollTimer = setInterval(() => reconcile(), 250);
  const statusTimer = setInterval(() => {
    if (!activated || !userToMove || showing) return;
    panel.setStatus(waitingStatus());
  }, 250);

  window.addEventListener("pagehide", () => {
    clearInterval(pollTimer);
    clearInterval(statusTimer);
    deactivate();
  });

  reconcile();

  function reconcile() {
    const signals = readDomSignals(document);
    const gate = classifySignals({ url: location.href, ...signals });
    if (!gate.activate) {
      deactivate();
      return;
    }
    if (!activated) {
      activated = true;
      panel.showActive();
      panel.apply(settings);
    }

    const position = readPosition(signals);
    if (!position) return;

    if (position.signature !== lastSignature) {
      lastSignature = position.signature;
      clearHintVisuals();
      if (
        userToMove &&
        position.signature &&
        position.signature === hintedSignature &&
        displayMoves?.length &&
        performance.now() - turnStarted >= settings.hintDelaySec * 1000
      ) {
        showHint();
      }
    }

    watchBoard(position.board);
    if (!position.fen) return;
    const key = fenKey(position.fen);
    if (key === currentKey) return;

    const placement = position.fen.split(" ")[0];
    if (placement === START_PLACEMENT) {
      /* A new game on the same URL re-reads the DOM gate above. */
    }

    currentKey = key;
    currentFen = position.fen;
    playingAs = position.playingAs;
    searchToken += 1;
    lastPool = null;
    displayMoves = null;
    hintedSignature = "";
    clearHintVisuals();
    userToMove = Boolean(playingAs) && position.turn === playingAs;

    if (!userToMove) {
      turnStarted = 0;
      panel.setStatus(playingAs ? "Opponent's turn" : "Detecting your color…");
      if (settings.analyzeOpponent && playingAs) void precompute(position.fen, searchToken);
      else void idleEngine();
      return;
    }

    turnStarted = performance.now();
    const cached = cacheHit(position.fen);
    if (cached) {
      lastPool = cached;
      displayMoves = decorate(cached);
      panel.setStatus(waitingStatus());
      scheduleHint();
      return;
    }
    panel.setStatus(waitingStatus());
    scheduleHint();
    void searchForUser(position.fen, searchToken);
  }

  let cache = null;

  function cacheHit(fen) {
    if (!cache || cache.key !== fenKey(fen)) return null;
    return cache.pool;
  }

  function onSettingsChanged() {
    const research =
      settings.mode !== applied.mode ||
      settings.lines !== applied.lines ||
      settings.analyzeOpponent !== applied.analyzeOpponent;
    const eloChanged = settings.elo !== applied.elo;
    Object.assign(applied, {
      mode: settings.mode,
      lines: settings.lines,
      elo: settings.elo,
      analyzeOpponent: settings.analyzeOpponent,
    });
    if (!activated) return;
    if (research && currentFen) {
      const token = ++searchToken;
      if (userToMove) void searchForUser(currentFen, token);
      else if (settings.analyzeOpponent) void precompute(currentFen, token);
      else void idleEngine();
      return;
    }
    if (eloChanged && lastPool && settings.mode === "human") {
      displayMoves = decorate(lastPool);
      if (showing) showHint();
    }
    if (userToMove && !showing) scheduleHint();
  }

  function decorate(pool) {
    return selectDisplayedMoves({
      mode: settings.mode,
      lines: settings.lines,
      candidates: pool,
      elo: settings.elo,
    }).map((move) => ({
      ...move,
      label: move.emphasis === "primary" ? formatEval(move.cp, move.mate) : "",
    }));
  }

  function scheduleHint() {
    clearTimeout(hintTimer);
    if (!activated || !userToMove) return;
    const wait = Math.max(0, settings.hintDelaySec * 1000 - (performance.now() - turnStarted));
    hintTimer = setTimeout(() => {
      if (!activated || !userToMove) return;
      if (!displayMoves?.length) {
        panel.setStatus("Calculating hint…");
        return;
      }
      showHint();
    }, wait);
  }

  function waitingStatus() {
    const remain = Math.ceil(
      (settings.hintDelaySec * 1000 - (performance.now() - turnStarted)) / 1000,
    );
    if (remain > 0) return `Hint in ${remain}s`;
    if (!displayMoves?.length) return "Calculating hint…";
    return "Hint ready";
  }

  function showHint() {
    const board = findBoard(document);
    if (!board || !displayMoves?.length || !activated || !userToMove) return;
    showing = true;
    hintedSignature = lastSignature;
    drawOverlay(board, displayMoves);
    panel.setStatus("Hint ready");
  }

  async function searchForUser(fen, token) {
    const multipv = settings.mode === "human" ? Math.max(settings.lines, HUMAN_POOL) : settings.lines;
    const pool = await runSearch(fen, multipv, token);
    if (token !== searchToken || !activated || !userToMove) return;
    if (!pool?.length) {
      panel.setStatus("No hint for this position");
      return;
    }
    lastPool = pool;
    displayMoves = decorate(pool);
    if (performance.now() - turnStarted >= settings.hintDelaySec * 1000) showHint();
    else panel.setStatus(waitingStatus());
  }

  async function precompute(fen, token) {
    const opponent = await runSearch(fen, 1, token);
    if (token !== searchToken || !activated || !settings.analyzeOpponent) return;
    if (!opponent?.length) return;
    let replyFen = null;
    try {
      const chess = new Chess(fen);
      const uci = opponent[0].uci;
      const played = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] || undefined,
      });
      if (!played) return;
      replyFen = chess.fen();
    } catch {
      return;
    }
    const multipv = settings.mode === "human" ? Math.max(settings.lines, HUMAN_POOL) : settings.lines;
    const replies = await runSearch(replyFen, multipv, token);
    if (token !== searchToken || !activated) return;
    if (!replies?.length) return;
    cache = { key: fenKey(replyFen), pool: replies };
  }

  async function runSearch(fen, multipv, token) {
    if (!activated || token !== searchToken) return null;
    try {
      await ensureEngine();
    } catch (error) {
      panel.setStatus("Engine unavailable");
      console.debug("[Chessly] engine start failed", error);
      return null;
    }
    if (!activated || token !== searchToken || !engine) return null;

    const collector = createSearchCollector();
    let accept = false;
    let resolveBest = null;
    const finished = new Promise((resolve) => {
      resolveBest = resolve;
    });
    const onLine = (line) => {
      if (!accept || token !== searchToken) return;
      if (line.startsWith("id name ")) {
        engineName = line.slice("id name ".length).trim();
        panel.setEngine(engineName);
      }
      if (line.includes("CRITICAL ERROR")) {
        resolveBest(null);
        return;
      }
      collector.push(line);
      if (line.startsWith("bestmove")) resolveBest(collector.finish());
    };
    engine.addHandler(onLine);
    try {
      const ready = waitForLine(engine, (line) => line.startsWith("readyok"), 2000);
      await engine.command(["stop", "isready"], location.href);
      await ready;
      if (!activated || token !== searchToken) return null;
      accept = true;
      await engine.command(
        [
          `setoption name MultiPV value ${multipv}`,
          `position fen ${fen}`,
          `go movetime ${MOVETIME_MS}`,
        ],
        location.href,
      );
      const result = await Promise.race([
        finished,
        delay(MOVETIME_MS + 9000).then(() => null),
      ]);
      return token === searchToken ? result : null;
    } catch (error) {
      console.debug("[Chessly] search failed", error);
      return null;
    } finally {
      engine?.removeHandler(onLine);
    }
  }

  async function ensureEngine() {
    if (!activated) throw new Error("inactive");
    if (engine?.started && engineReady) {
      await engineReady;
      if (!activated) throw new Error("inactive");
      return;
    }
    const client = createEngineClient();
    engine = client;
    const ready = (async () => {
      if (!activated) throw new Error("inactive");
      await client.start(location.href);
      if (!activated || engine !== client) throw new Error("inactive");
      const uciok = waitForLine(client, (line) => line.startsWith("uciok"), 15000);
      await client.command(["uci"], location.href);
      await uciok;
      if (!activated || engine !== client) throw new Error("inactive");
      const readyok = waitForLine(client, (line) => line.startsWith("readyok"), 15000);
      await client.command(
        ["setoption name Hash value 32", "ucinewgame", "isready"],
        location.href,
      );
      await readyok;
      if (!activated || engine !== client) throw new Error("inactive");
    })();
    engineReady = ready;
    try {
      await ready;
    } catch (error) {
      if (engine === client) {
        engine = null;
        engineReady = null;
        void client.stop(location.href);
      }
      throw error;
    }
  }

  async function idleEngine() {
    if (!engine?.started) return;
    try {
      await engine.command(["stop"], location.href);
    } catch {
      /* Stopping an idle engine is optional. */
    }
  }

  function deactivate() {
    const wasActive = activated || Boolean(engine);
    activated = false;
    searchToken += 1;
    currentKey = "";
    currentFen = "";
    lastSignature = "";
    hintedSignature = "";
    userToMove = false;
    playingAs = null;
    lastPool = null;
    displayMoves = null;
    cache = null;
    clearTimeout(hintTimer);
    clearHintVisuals();
    boardObserver?.disconnect();
    boardObserver = null;
    observedBoard = null;
    panel.showBlocked();
    if (wasActive && engine) {
      const closing = engine;
      engine = null;
      engineReady = null;
      void closing.stop(location.href);
    }
  }

  function clearHintVisuals() {
    showing = false;
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    if (trackRaf) {
      cancelAnimationFrame(trackRaf);
      trackRaf = 0;
    }
  }

  function drawOverlay(board, moves) {
    const rect = board.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    if (!overlay) {
      overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      overlay.setAttribute("class", "chessly-overlay");
      overlay.setAttribute("aria-hidden", "true");
      overlay.style.position = "fixed";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "2147483000";
      document.documentElement.appendChild(overlay);
      ensureTracking();
    }
    overlay.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.innerHTML = renderOverlaySvg({
      width: rect.width,
      height: rect.height,
      flipped: board.classList.contains("flipped"),
      moves,
    });
  }

  function ensureTracking() {
    if (trackRaf) return;
    const tick = () => {
      trackRaf = requestAnimationFrame(tick);
      if (!showing || !overlay) return;
      const board = findBoard(document);
      if (!board?.isConnected) {
        clearHintVisuals();
        return;
      }
      const rect = board.getBoundingClientRect();
      const flipped = board.classList.contains("flipped");
      const geom = `${rect.left.toFixed(1)}|${rect.top.toFixed(1)}|${rect.width.toFixed(1)}|${rect.height.toFixed(1)}|${flipped}`;
      if (overlay.dataset.geom === geom) return;
      drawOverlay(board, displayMoves || []);
      if (overlay) overlay.dataset.geom = geom;
    };
    trackRaf = requestAnimationFrame(tick);
  }

  function watchBoard(board) {
    if (!board || board === observedBoard) return;
    boardObserver?.disconnect();
    observedBoard = board;
    boardObserver = new MutationObserver(() => reconcile());
    boardObserver.observe(board, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  function panelPersist(next) {
    settings = sanitizeSettings(next);
    panel.apply(settings);
    chrome.storage?.local.set({ [STORAGE_KEY]: settings });
    onSettingsChanged();
  }

  panel.onChange(panelPersist);
}

function readPosition(signals) {
  const board = findBoard(document);
  if (!board) return null;
  const pieces = readPieceElements(board);
  const signature = pieceSignature(pieces);
  let apiFen = null;
  let apiTurn = null;
  let apiPlayingAs = null;
  try {
    const game = board.game;
    if (typeof game?.getFEN === "function") apiFen = game.getFEN();
    if (typeof game?.getTurn === "function") apiTurn = normalizeColor(game.getTurn());
    if (typeof game?.getPlayingAs === "function") apiPlayingAs = normalizeColor(game.getPlayingAs());
  } catch {
    /* The internal game object is optional. */
  }
  const flipped = board.classList.contains("flipped");
  const highlights = readHighlights(board);
  const moveNodes = readMoveNodes(document);
  const sans = sansFromNodes(moveNodes);
  const clockTurn = turnFromClocks({
    bottomActive: Boolean(
      document.querySelector(".clock-bottom.clock-player-turn, .clock-bottom .clock-player-turn"),
    ),
    topActive: Boolean(
      document.querySelector(".clock-top.clock-player-turn, .clock-top .clock-player-turn"),
    ),
    flipped,
  });
  const extracted = extractFen({
    apiFen,
    pieces,
    highlights,
    sans,
    turn: apiTurn || clockTurn,
  });
  let playingAs = apiPlayingAs;
  if (!playingAs) {
    // Computer games keep the user opposite the bot. When the seat is not in
    // the DOM yet, chess.com's default layout puts the bot on top.
    playingAs = inferPlayingAs({ botSeat: signals.botSeat || "top", flipped });
  }
  return {
    board,
    signature,
    fen: extracted?.fen || null,
    turn: extracted?.turn || null,
    source: extracted?.source || null,
    playingAs,
    flipped,
  };
}

function findBoard(doc) {
  return (
    doc.querySelector("wc-chess-board") ||
    doc.querySelector("chess-board") ||
    doc.querySelector("#board-play-computer chess-board") ||
    doc.querySelector("[data-cy='board']")
  );
}

function readPieceElements(board) {
  return [...board.querySelectorAll(".piece")].map((element) => ({
    className: elementClassName(element),
    square: element.getAttribute("data-square"),
  }));
}

function readHighlights(board) {
  const squares = [];
  for (const element of board.querySelectorAll(".highlight")) {
    const fromClass = squareFromClass(elementClassName(element));
    const fromData = element.getAttribute("data-square");
    if (fromClass) squares.push(fromClass);
    if (fromData && /^[a-h][1-8]$/.test(fromData)) squares.push(fromData);
  }
  return [...new Set(squares)];
}

function readMoveNodes(doc) {
  const selectors = [
    "wc-simple-move-list .node",
    "wc-move-list .node",
    ".vertical-move-list .node",
    ".move-list-wrapper .node",
    "[data-cy='move-list'] .node",
  ];
  for (const selector of selectors) {
    const nodes = [...doc.querySelectorAll(selector)];
    if (!nodes.length) continue;
    return nodes.map((node) => ({
      text: node.textContent || "",
      figurine: figurineFromNode(node),
    }));
  }
  return [];
}

function elementClassName(element) {
  if (typeof element.className === "string") return element.className;
  return element.getAttribute?.("class") || "";
}

function normalizeColor(value) {
  const text = String(value || "").toLowerCase();
  if (text === "w" || text === "white") return "w";
  if (text === "b" || text === "black") return "b";
  return null;
}

function waitForLine(engine, predicate, timeoutMs, token) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      engine.removeHandler(onLine);
      resolve(null);
    }, timeoutMs);
    function onLine(line) {
      if (!predicate(line)) return;
      clearTimeout(timer);
      engine.removeHandler(onLine);
      resolve(line);
    }
    engine.addHandler(onLine);
    if (token == null) return;
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installNavigationHooks(onChange) {
  const fire = () => onChange();
  for (const name of ["pushState", "replaceState"]) {
    const original = history[name];
    if (typeof original !== "function") continue;
    history[name] = function patchedHistory(...args) {
      const result = original.apply(this, args);
      fire();
      return result;
    };
  }
  window.addEventListener("popstate", fire);
  window.addEventListener("hashchange", fire);
}

function createPanel() {
  const card = el("aside", "chessly-card");
  card.id = "chessly-panel";
  const handle = el("div", "chessly-handle");
  const heading = el("p", "chessly-kicker");
  heading.textContent = "ANALYSIS";
  handle.appendChild(heading);

  const notice = el("p", "chessly-notice");
  notice.textContent = BOT_ONLY_NOTICE;

  const controls = el("div", "chessly-controls");
  controls.hidden = true;
  const mode = segment(
    [
      ["best", "Best move"],
      ["human", "Human move"],
    ],
    "mode",
  );
  const linesRow = el("div", "chessly-row");
  const linesLabel = el("span", "chessly-label");
  linesLabel.textContent = "Lines & arrows";
  const lines = segment(
    [
      ["1", "1"],
      ["2", "2"],
      ["3", "3"],
    ],
    "lines",
    "chessly-lines",
  );
  linesRow.append(linesLabel, lines.root);

  const eloBlock = el("div", "chessly-elo-block");
  const eloRow = el("div", "chessly-row");
  const eloLabel = el("span", "chessly-label");
  eloLabel.textContent = "Hint level (Lichess Elo)";
  const eloReadout = el("span", "chessly-readout");
  eloReadout.id = "chessly-elo";
  eloRow.append(eloLabel, eloReadout);
  const eloSlider = slider("Hint level (Lichess Elo)", 800, 2500, 10);
  eloBlock.append(eloRow, eloSlider);

  const delayBlock = el("div", "chessly-delay-block");
  const delayRow = el("div", "chessly-row");
  const delayLabel = el("span", "chessly-label");
  delayLabel.textContent = "Hint delay";
  const delayReadout = el("span", "chessly-readout");
  delayRow.append(delayLabel, delayReadout);
  const delaySlider = slider("Hint delay", 1, 30, 1);
  delayBlock.append(delayRow, delaySlider);

  const analyzeRow = el("div", "chessly-row");
  const analyzeLabel = el("span", "chessly-label");
  analyzeLabel.textContent = "Analyze opponent's turn";
  const analyze = el("button", "chessly-switch");
  analyze.type = "button";
  analyze.setAttribute("role", "switch");
  analyze.setAttribute("aria-label", "Analyze opponent's turn");
  analyzeRow.append(analyzeLabel, analyze);

  const status = el("p", "chessly-status");
  const engineLine = el("p", "chessly-engine");

  controls.append(mode.root, linesRow, eloBlock, delayBlock, analyzeRow, status, engineLine);
  card.append(handle, notice, controls);

  let listener = () => {};
  let current = sanitizeSettings(DEFAULT_SETTINGS);

  mode.root.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    listener({ ...current, mode: button.dataset.value });
  });
  lines.root.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    listener({ ...current, lines: Number(button.dataset.value) });
  });
  eloSlider.addEventListener("input", () => {
    listener({ ...current, elo: Number(eloSlider.value) });
  });
  delaySlider.addEventListener("input", () => {
    listener({ ...current, hintDelaySec: Number(delaySlider.value) });
  });
  analyze.addEventListener("click", () => {
    listener({ ...current, analyzeOpponent: !current.analyzeOpponent });
  });

  function apply(settings) {
    current = sanitizeSettings(settings);
    press(mode.root, current.mode);
    press(lines.root, String(current.lines));
    eloReadout.textContent = `≈ ${current.elo}`;
    eloSlider.value = String(current.elo);
    eloBlock.dataset.active = current.mode === "human" ? "true" : "false";
    delayReadout.textContent = `${current.hintDelaySec}s`;
    delaySlider.value = String(current.hintDelaySec);
    analyze.setAttribute("aria-checked", current.analyzeOpponent ? "true" : "false");
  }

  return {
    card,
    handle,
    apply,
    onChange(fn) {
      listener = fn;
    },
    showBlocked() {
      notice.hidden = false;
      controls.hidden = true;
    },
    showActive() {
      notice.hidden = true;
      controls.hidden = false;
    },
    setStatus(text) {
      status.textContent = text || "";
    },
    setEngine(text) {
      engineLine.textContent = text || "";
    },
  };
}

function segment(options, name, className = "chessly-segment") {
  const root = el("div", className);
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", name);
  for (const [value, label] of options) {
    const button = el("button", "");
    button.type = "button";
    button.dataset.value = value;
    button.textContent = label;
    button.setAttribute("aria-pressed", "false");
    root.appendChild(button);
  }
  return { root };
}

function press(root, value) {
  for (const button of root.querySelectorAll("button[data-value]")) {
    button.setAttribute("aria-pressed", button.dataset.value === value ? "true" : "false");
  }
}

function slider(label, min, max, step) {
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.setAttribute("aria-label", label);
  return input;
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function enableDrag(card, handle) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;
  handle.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    dragging = true;
    const rect = card.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    handle.setPointerCapture?.(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    card.style.left = `${Math.max(8, event.clientX - offsetX)}px`;
    card.style.top = `${Math.max(8, event.clientY - offsetY)}px`;
    card.style.right = "auto";
  });
  const stop = () => {
    dragging = false;
  };
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
}
