import { Chess } from "chess.js";
import { BOT_ONLY_NOTICE } from "../allowlist.js";
import { classifySignals, inferPlayingAs, readDomSignals } from "../bot-dom.js";
import { basicFromPieces, boardOrientation, createPositionTracker, findChessComBoard, readPieceElements } from "../chesscom-board.js";
import { createEngineClient } from "../engine-client.js";
import {
  extractFen,
  figurineFromNode,
  pieceSignature,
  sansFromNodes,
  squareFromClass,
  turnFromClocks,
} from "../fen.js";
import { failureText, hintStatusText, statusMayRefresh } from "../hint-status.js";
import { selectDisplayedMoves } from "../human.js";
import { renderOverlaySvg } from "../overlay.js";
import { BEST_MOVETIME_MS, searchCommands } from "../rating.js";
import { DEFAULT_SETTINGS, sameSettings, sanitizeSettings, STORAGE_KEY } from "../settings.js";
import { createSearchCollector, fenKey, formatEval } from "../uci.js";

const LOG = "[Chessly]";
const START_PLACEMENT = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
const HINT_DEADLINE_MS = 25000;

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
  let phase = "idle";
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
    if (message.type === "ENGINE_ERROR") {
      console.error(LOG, "engine:", message.detail || "unknown");
      dropEngine();
      if (activated && userToMove && phase !== "ready") {
        failHint(failureText(message.detail || "engine error"), message.detail);
      }
    }
  });

  const positionTracker = createPositionTracker();
  let lastGateKey = "";
  let deadlineTimer = 0;
  // Declared before the first reconcile(). A later `let` is still in the
  // temporal dead zone while that call runs, which aborted the search and
  // left the status on "Calculating hint…".
  let cache = null;

  installNavigationHooks(() => reconcile());
  const pollTimer = setInterval(() => reconcile(), 250);
  const statusTimer = setInterval(() => {
    if (!activated || !statusMayRefresh(phase) || !userToMove || showing) return;
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
    const gateKey = `${gate.activate}|${gate.reason}|${location.pathname}`;
    if (gateKey !== lastGateKey) {
      lastGateKey = gateKey;
      console.info(LOG, "gate", gate.reason, location.href, {
        bot: signals.hasBotMarker,
        human: signals.hasHumanMarker,
        botSeat: signals.botSeat,
      });
    }
    if (!gate.activate) {
      deactivate();
      return;
    }
    if (!activated) {
      activated = true;
      panel.showActive();
      panel.apply(settings);
    }

    const position = readPosition(signals, positionTracker);
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
    phase = "idle";
    clearHintVisuals();
    userToMove = Boolean(playingAs) && position.turn === playingAs;
    console.info(LOG, "position", {
      fen: position.fen,
      source: position.source,
      turn: position.turn,
      playingAs,
      orientation: position.orientation,
      userToMove,
      mode: settings.mode,
      elo: settings.elo,
    });

    if (!userToMove) {
      turnStarted = 0;
      phase = "idle";
      panel.setStatus(playingAs ? "Opponent's turn" : "Detecting your color…");
      if (settings.analyzeOpponent && playingAs) void precompute(position.fen, searchToken);
      else void idleEngine();
      return;
    }

    phase = "countdown";
    turnStarted = performance.now();
    armDeadline(searchToken);
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
    if (!activated || !userToMove || phase === "error") return;
    const wait = Math.max(0, settings.hintDelaySec * 1000 - (performance.now() - turnStarted));
    hintTimer = setTimeout(() => {
      if (!activated || !userToMove || phase === "error") return;
      if (!displayMoves?.length) {
        phase = "calculating";
        panel.setStatus("Calculating hint…");
        return;
      }
      showHint();
    }, wait);
  }

  function failHint(text, error) {
    console.error(LOG, text, error || "");
    phase = "error";
    clearTimeout(hintTimer);
    clearTimeout(deadlineTimer);
    panel.setStatus(text, "error");
  }

  function armDeadline(token) {
    clearTimeout(deadlineTimer);
    deadlineTimer = setTimeout(() => {
      if (token !== searchToken || phase === "error" || phase === "ready" || showing) return;
      if (!activated || !userToMove || displayMoves?.length) return;
      failHint("Hint timed out");
    }, HINT_DEADLINE_MS);
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
    phase = "ready";
    hintedSignature = lastSignature;
    drawOverlay(board, displayMoves);
    clearTimeout(deadlineTimer);
    panel.setStatus("Hint ready");
    console.info(
      LOG,
      "hint",
      displayMoves.map((move) => `${move.uci}${move.label ? ` ${move.label}` : ""}`).join(", "),
    );
  }

  async function searchForUser(fen, token) {
    console.info(LOG, "search-start", token, fen);
    if (token !== searchToken || !activated) return;
    if (phase === "error") {
      phase = "calculating";
      panel.setStatus(waitingStatus());
      armDeadline(token);
    }
    try {
      const pool = await runSearch(fen, token);
      if (token !== searchToken || !activated || !userToMove || phase === "error") return;
      if (!pool?.length) {
        failHint("No hint for this position");
        return;
      }
      lastPool = pool;
      displayMoves = decorate(pool);
      if (performance.now() - turnStarted >= settings.hintDelaySec * 1000) showHint();
      else panel.setStatus(waitingStatus());
    } catch (error) {
      if (token !== searchToken || !activated || phase === "error") return;
      failHint(failureText(error), error);
    }
  }

  async function precompute(fen, token) {
    let opponent = null;
    try {
      opponent = await runSearch(fen, token);
    } catch (error) {
      console.error(LOG, "precompute failed", error);
      return;
    }
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
    let replies = null;
    try {
      replies = await runSearch(replyFen, token);
    } catch (error) {
      console.error(LOG, "precompute reply failed", error);
      return;
    }
    if (token !== searchToken || !activated) return;
    if (!replies?.length) return;
    cache = { key: fenKey(replyFen), pool: replies };
  }

  async function runSearch(fen, token) {
    if (!activated || token !== searchToken) return null;
    await ensureEngine();
    if (!activated || token !== searchToken || !engine) return null;

    const plan = searchCommands({
      mode: settings.mode,
      elo: settings.elo,
      lines: settings.lines,
      fen,
    });
    console.info(LOG, "search", {
      mode: settings.mode,
      elo: settings.elo,
      depth: plan.plan.depth,
      uciElo: plan.plan.uciElo,
      limitStrength: plan.plan.limitStrength,
      fen,
    });

    const collector = createSearchCollector();
    let accept = false;
    let resolveBest = null;
    const finished = new Promise((resolve) => {
      resolveBest = resolve;
    });
    const onLine = (line) => {
      logUci(line);
      if (line.startsWith("id name ")) {
        engineName = line.slice("id name ".length).trim();
        panel.setEngine(engineName);
      }
      if (!accept || token !== searchToken) return;
      if (fatalEngineLine(line)) {
        resolveBest({ error: line });
        return;
      }
      collector.push(line);
      if (line.startsWith("bestmove")) resolveBest({ moves: collector.finish(), bestmove: line });
    };
    engine.addHandler(onLine);
    try {
      const ready = waitForLine(engine, (line) => line.startsWith("readyok") || fatalEngineLine(line), 8000);
      await engine.command(["stop", "isready"], location.href);
      const readyLine = await ready;
      if (!readyLine) throw new Error("readyok-timeout");
      if (fatalEngineLine(readyLine)) throw new Error(readyLine);
      if (!activated || token !== searchToken) return null;
      accept = true;
      await engine.command(plan.commands, location.href);
      const budget = settings.mode === "human" ? 12000 : BEST_MOVETIME_MS + 8000;
      let result = await Promise.race([finished, delay(budget).then(() => null)]);
      if (!result && token === searchToken && engine) {
        console.info(LOG, "search still running, sending stop");
        const late = waitForLine(engine, (line) => line.startsWith("bestmove") || fatalEngineLine(line), 4000);
        try {
          await engine.command(["stop"], location.href);
        } catch (error) {
          console.error(LOG, "stop failed", error);
        }
        const stopped = await late;
        if (typeof stopped === "string" && stopped.startsWith("bestmove")) {
          result = { moves: collector.finish(), bestmove: stopped };
        } else if (typeof stopped === "string" && fatalEngineLine(stopped)) {
          throw new Error(stopped);
        }
      }
      if (token !== searchToken) return null;
      if (!result) throw new Error("search-timeout");
      if (result.error) throw new Error(result.error);
      const bestmove = String(result.bestmove || "");
      if (/\bbestmove (?:\(none\)|none|0000)\b/.test(bestmove)) throw new Error("no-move");
      const moves = result.moves?.length
        ? result.moves
        : [{ uci: bestmove.split(/\s+/)[1], cp: null, mate: null, multipv: 1, depth: 0, pv: [] }];
      if (!/^[a-h][1-8][a-h][1-8]/.test(moves[0]?.uci || "")) throw new Error("no-move");
      console.info(LOG, "bestmove", bestmove);
      return moves;
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
      const uciok = waitForLine(
        client,
        (line) => line.startsWith("uciok") || fatalEngineLine(line),
        20000,
      );
      await client.command(["uci"], location.href);
      const uciLine = await uciok;
      if (!uciLine) throw new Error("uciok-timeout");
      if (fatalEngineLine(uciLine)) throw new Error(uciLine);
      if (!activated || engine !== client) throw new Error("inactive");
      const readyok = waitForLine(
        client,
        (line) => line.startsWith("readyok") || fatalEngineLine(line),
        15000,
      );
      await client.command(
        ["setoption name Hash value 32", "ucinewgame", "isready"],
        location.href,
      );
      const readyLine = await readyok;
      if (!readyLine) throw new Error("readyok-timeout");
      if (fatalEngineLine(readyLine)) throw new Error(readyLine);
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

  function dropEngine() {
    searchToken += 1;
    const closing = engine;
    engine = null;
    engineReady = null;
    if (closing) void closing.stop(location.href);
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
    phase = "idle";
    cache = null;
    positionTracker.reset();
    clearTimeout(deadlineTimer);
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
    overlay.dataset.moves = moves.map((move) => move.uci).filter(Boolean).join(",");
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

function readPosition(signals, tracker) {
  const board = findBoard(document);
  if (!board) return null;
  const pieces = readPieceElements(board);
  const signature = pieceSignature(pieces);
  const placement = basicFromPieces(pieces);
  let apiFen = null;
  let apiTurn = null;
  let apiPlayingAs = null;
  const gameHost = board.game ? board : board.closest?.("wc-chess-board, chess-board");
  try {
    const game = gameHost?.game;
    if (typeof game?.getFEN === "function") apiFen = game.getFEN();
    if (typeof game?.getTurn === "function") apiTurn = normalizeColor(game.getTurn());
    if (typeof game?.getPlayingAs === "function") apiPlayingAs = normalizeColor(game.getPlayingAs());
  } catch {
    /* The internal game object is optional. */
  }
  const flipped = board.classList.contains("flipped");
  const orientation = boardOrientation(board);
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
  const turnHint = apiTurn || clockTurn || null;
  const extracted = extractFen({
    apiFen,
    pieces,
    highlights,
    sans,
    turn: turnHint,
  });
  const tracked = placement?.basic ? tracker?.note(placement.basic, turnHint || extracted?.turn) : null;
  let chosen = null;
  if (extracted && (extracted.source === "api" || extracted.source === "moves")) {
    tracker?.adopt(extracted.fen);
    chosen = extracted;
  } else if (tracked?.fen && !tracked.rejected && !tracked.fresh) {
    chosen = { fen: tracked.fen, turn: tracked.turn, source: "dom" };
  } else if (extracted?.fen) {
    tracker?.adopt(extracted.fen);
    chosen = extracted;
  } else if (tracked?.fen && !tracked.rejected) {
    chosen = { fen: tracked.fen, turn: tracked.turn, source: "dom" };
  }
  let playingAs = apiPlayingAs;
  if (!playingAs && signals.botSeat) {
    playingAs = inferPlayingAs({ botSeat: signals.botSeat, flipped });
  }
  // A.C.A.S falls back to board orientation on chess.com: the user sits at the bottom.
  if (!playingAs) playingAs = orientation;
  return {
    board,
    signature,
    fen: chosen?.fen || null,
    turn: chosen?.turn || null,
    source: chosen?.source || null,
    playingAs,
    flipped,
    orientation,
  };
}

function findBoard(doc) {
  return findChessComBoard(doc);
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

function fatalEngineLine(line) {
  return (
    typeof line === "string" &&
    (line.includes("CRITICAL ERROR") ||
      line.includes("failed to asynchronously prepare wasm") ||
      line.startsWith("info string Chessly engine error:"))
  );
}

function logUci(line) {
  if (
    line.startsWith("bestmove") ||
    line.startsWith("uciok") ||
    line.startsWith("readyok") ||
    line.startsWith("id name") ||
    line.startsWith("info string") ||
    /error|failed|CRITICAL/i.test(line)
  ) {
    console.info(LOG, "uci <", line);
  }
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
    setStatus(text, state = "") {
      status.textContent = text || "";
      if (state) status.dataset.state = state;
      else delete status.dataset.state;
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
