const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
  document.body.style.backgroundColor = tg.themeParams?.bg_color || "";
}

const BOARD_SIZE = 8;
const PIECES = { w: "white", W: "white crown", b: "black", B: "black crown" };
const LEVEL_LABEL = { easy: "Лёгкий", normal: "Средний", hard: "Сложный" };
const STORAGE_KEY = "checkers_mini_app_score";
const SOUND_KEY = "checkers_mini_app_sound";

let game = null;
let soundEnabled = localStorage.getItem(SOUND_KEY) !== "off";
let audioCtx = null;

const levelScreen = document.getElementById("levelScreen");
const gameScreen = document.getElementById("gameScreen");
const boardEl = document.getElementById("board");
const boardFx = document.getElementById("boardFx");
const statusText = document.getElementById("statusText");
const difficultyLabel = document.getElementById("difficultyLabel");
const userPanel = document.getElementById("userPanel");
const botPanel = document.getElementById("botPanel");
const toastEl = document.getElementById("toast");
const rulesModal = document.getElementById("rulesModal");
const winsCountEl = document.getElementById("winsCount");
const lossesCountEl = document.getElementById("lossesCount");
const soundBtn = document.getElementById("soundBtn");

const score = loadScore();
updateScoreUI();
updateSoundButton();

document.querySelectorAll("[data-level]").forEach((btn) => {
  btn.addEventListener("click", () => {
    initAudio();
    playUiSound();
    startGame(btn.dataset.level);
  });
});

document.getElementById("newGameBtn").addEventListener("click", () => {
  initAudio();
  playUiSound();
  showLevelScreen();
});
document.getElementById("rulesBtn").addEventListener("click", () => {
  initAudio();
  playUiSound();
  rulesModal.classList.remove("hidden");
});
document.getElementById("rulesCloseBtn").addEventListener("click", () => {
  playUiSound();
  rulesModal.classList.add("hidden");
});
document.getElementById("closeBtn").addEventListener("click", () => tg ? tg.close() : showToast("Закрыть можно в Telegram"));
document.getElementById("hintBtn").addEventListener("click", () => {
  initAudio();
  playUiSound();
  showHint();
});
document.getElementById("resetScoreBtn").addEventListener("click", () => {
  initAudio();
  playUiSound();
  score.wins = 0;
  score.losses = 0;
  saveScore();
  updateScoreUI();
  showToast("Счётчик побед сброшен");
});
soundBtn.addEventListener("click", () => {
  initAudio();
  soundEnabled = !soundEnabled;
  localStorage.setItem(SOUND_KEY, soundEnabled ? "on" : "off");
  updateSoundButton();
  if (soundEnabled) playUiSound();
});

function loadScore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      wins: Number(raw.wins || 0),
      losses: Number(raw.losses || 0),
    };
  } catch {
    return { wins: 0, losses: 0 };
  }
}

function saveScore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(score));
}

function updateScoreUI() {
  winsCountEl.textContent = String(score.wins);
  lossesCountEl.textContent = String(score.losses);
}

function updateSoundButton() {
  soundBtn.textContent = soundEnabled ? "🔊 Звук" : "🔇 Без звука";
}

function showLevelScreen() {
  levelScreen.classList.remove("hidden");
  gameScreen.classList.add("hidden");
}

function startGame(level = "normal") {
  game = {
    board: newBoard(),
    turn: "w",
    selected: null,
    forcedPiece: null,
    lastPath: [],
    finished: false,
    level,
    message: "Ваш ход. Нажмите на белую шашку.",
  };

  levelScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  difficultyLabel.textContent = LEVEL_LABEL[level] || "Средний";
  render();
  haptic("impact");
}

function newBoard() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) board[r][c] = "b";
  for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) board[r][c] = "w";
  return board;
}

function inside(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function colorOf(piece) { if (!piece) return null; return piece.toLowerCase() === "w" ? "w" : "b"; }
function posName([r, c]) { return "abcdefgh"[c] + (8 - r); }
function simpleDirs(piece) { if (piece === "w") return [[-1,-1],[-1,1]]; if (piece === "b") return [[1,-1],[1,1]]; return [[-1,-1],[-1,1],[1,-1],[1,1]]; }
function captureDirs() { return [[-1,-1],[-1,1],[1,-1],[1,1]]; }
function cloneBoard(board) { return board.map(row => [...row]); }

function getSimpleMoves(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const out = [];
  for (const [dr, dc] of simpleDirs(piece)) {
    const nr = r + dr, nc = c + dc;
    if (inside(nr, nc) && !board[nr][nc]) out.push([nr, nc]);
  }
  return out;
}

function getCapturesFrom(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const my = colorOf(piece);
  const out = [];
  for (const [dr, dc] of captureDirs(piece)) {
    const mr = r + dr, mc = c + dc;
    const lr = r + 2 * dr, lc = c + 2 * dc;
    if (!inside(mr, mc) || !inside(lr, lc)) continue;
    const middle = board[mr][mc];
    if (middle && colorOf(middle) !== my && !board[lr][lc]) out.push({ landing: [lr, lc], captured: [mr, mc] });
  }
  return out;
}

function allCaptures(board, color) {
  const map = new Map();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const piece = board[r][c];
    if (piece && colorOf(piece) === color) {
      const caps = getCapturesFrom(board, r, c);
      if (caps.length) map.set(`${r},${c}`, caps);
    }
  }
  return map;
}

function allSimpleMoves(board, color) {
  const map = new Map();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const piece = board[r][c];
    if (piece && colorOf(piece) === color) {
      const moves = getSimpleMoves(board, r, c);
      if (moves.length) map.set(`${r},${c}`, moves);
    }
  }
  return map;
}

function promote(piece, r) { if (piece === "w" && r === 0) return "W"; if (piece === "b" && r === 7) return "B"; return piece; }

function executeStep(board, start, end) {
  const [sr, sc] = start;
  const [er, ec] = end;
  const piece = board[sr][sc];
  const captures = getCapturesFrom(board, sr, sc);
  const found = captures.find(x => samePos(x.landing, end));
  const captured = found?.captured || null;
  board[sr][sc] = null;
  if (captured) board[captured[0]][captured[1]] = null;
  board[er][ec] = promote(piece, er);
  return { isCapture: !!captured, captured };
}

function samePos(a, b) { return a && b && a[0] === b[0] && a[1] === b[1]; }
function posKey(pos) { return pos ? `${pos[0]},${pos[1]}` : ""; }

function generateCaptureSequences(board, start, path = [start], captured = []) {
  const [r, c] = path[path.length - 1];
  const caps = getCapturesFrom(board, r, c);
  if (!caps.length) {
    if (path.length <= 1) return [];
    return [{ start, end: path[path.length - 1], path, captures: captured, boardAfter: cloneBoard(board) }];
  }
  let result = [];
  for (const cap of caps) {
    const nextBoard = cloneBoard(board);
    executeStep(nextBoard, [r, c], cap.landing);
    result = result.concat(generateCaptureSequences(nextBoard, start, [...path, cap.landing], [...captured, cap.captured]));
  }
  return result;
}

function generateTurnMoves(board, color) {
  const caps = allCaptures(board, color);
  let moves = [];
  if (caps.size) {
    for (const key of caps.keys()) {
      const start = key.split(",").map(Number);
      moves = moves.concat(generateCaptureSequences(cloneBoard(board), start));
    }
    return moves;
  }
  const simple = allSimpleMoves(board, color);
  for (const [key, ends] of simple.entries()) {
    const start = key.split(",").map(Number);
    for (const end of ends) {
      const next = cloneBoard(board);
      executeStep(next, start, end);
      moves.push({ start, end, path: [start, end], captures: [], boardAfter: next });
    }
  }
  return moves;
}

function countPieces(board, color) {
  let n = 0;
  for (const row of board) for (const p of row) if (p && colorOf(p) === color) n++;
  return n;
}

function checkWinner() {
  if (countPieces(game.board, "w") === 0) return "Бот победил.";
  if (countPieces(game.board, "b") === 0) return "Вы победили.";
  if (!generateTurnMoves(game.board, "w").length) return "У вас нет ходов. Бот победил.";
  if (!generateTurnMoves(game.board, "b").length) return "У бота нет ходов. Вы победили.";
  return null;
}

function evaluateBoard(board) {
  let scoreValue = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (!p) continue;
    let val = p === p.toUpperCase() ? 300 : 100;
    if (colorOf(p) === "b") { val += r * 6; scoreValue += val; }
    else { val += (7 - r) * 6; scoreValue -= val; }
  }
  scoreValue += generateTurnMoves(board, "b").length * 4;
  scoreValue -= generateTurnMoves(board, "w").length * 4;
  return scoreValue;
}

function moveHeuristic(move) {
  const [r, c] = move.end;
  let value = move.captures.length * 120;
  if (r === 7) value += 80;
  value += 14 - Math.abs(3.5 - r) - Math.abs(3.5 - c);
  return value;
}

function minimax(board, depth, color, alpha, beta) {
  const moves = generateTurnMoves(board, color);
  if (depth === 0 || !moves.length) return evaluateBoard(board);
  if (color === "b") {
    let best = -Infinity;
    for (const m of moves) {
      const scoreValue = minimax(m.boardAfter, depth - 1, "w", alpha, beta);
      best = Math.max(best, scoreValue);
      alpha = Math.max(alpha, scoreValue);
      if (beta <= alpha) break;
    }
    return best;
  }
  let best = Infinity;
  for (const m of moves) {
    const scoreValue = minimax(m.boardAfter, depth - 1, "b", alpha, beta);
    best = Math.min(best, scoreValue);
    beta = Math.min(beta, scoreValue);
    if (beta <= alpha) break;
  }
  return best;
}

function chooseBotMove() {
  const moves = generateTurnMoves(game.board, "b");
  if (!moves.length) return null;
  if (game.level === "easy") return moves[Math.floor(Math.random() * moves.length)];
  if (game.level === "normal") {
    const scores = moves.map(moveHeuristic);
    const max = Math.max(...scores);
    const best = moves.filter((_, i) => scores[i] === max);
    return best[Math.floor(Math.random() * best.length)];
  }
  let bestScore = -Infinity;
  let bestMoves = [];
  for (const move of moves) {
    const scoreValue = minimax(move.boardAfter, 3, "w", -Infinity, Infinity);
    if (scoreValue > bestScore) { bestScore = scoreValue; bestMoves = [move]; }
    else if (scoreValue === bestScore) bestMoves.push(move);
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

function legalDestinationsForSelected() {
  if (!game?.selected) return [];
  const [r, c] = game.selected;
  const captures = allCaptures(game.board, "w");
  if (captures.size) return getCapturesFrom(game.board, r, c).map(x => x.landing);
  return getSimpleMoves(game.board, r, c);
}

function render() {
  boardEl.innerHTML = "";
  const dests = legalDestinationsForSelected();
  const lastKeys = new Set((game?.lastPath || []).map(posKey));
  for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) {
    const cell = document.createElement("button");
    const isDark = (r + c) % 2 === 1;
    const pos = [r, c];
    cell.className = `cell ${isDark ? "dark" : "light"}`;
    cell.dataset.r = String(r);
    cell.dataset.c = String(c);
    if (game?.selected && samePos(game.selected, pos)) cell.classList.add("selected");
    if (dests.some(d => samePos(d, pos))) cell.classList.add("dest");
    if (lastKeys.has(posKey(pos))) cell.classList.add("last");
    const piece = game?.board[r][c];
    if (piece) {
      const p = document.createElement("div");
      p.className = `piece ${PIECES[piece]} pop`;
      if (game?.lastPath?.some(x => samePos(x, pos))) p.classList.add("moving");
      if (piece === "W" || piece === "B") p.classList.add("crown");
      cell.appendChild(p);
    }
    cell.addEventListener("click", () => handleCellClick(r, c));
    boardEl.appendChild(cell);
  }
  statusText.textContent = game?.message || "Выберите сложность";
  userPanel.classList.toggle("active", game?.turn === "w");
  botPanel.classList.toggle("active", game?.turn === "b");
}

function handleCellClick(r, c) {
  if (!game || game.finished || game.turn !== "w") return;
  initAudio();
  const piece = game.board[r][c];
  const selected = game.selected;
  const forced = game.forcedPiece;
  const captures = allCaptures(game.board, "w");
  const mustCapture = captures.size > 0;

  if (!selected) {
    if (!piece || colorOf(piece) !== "w") return setMessage("Выберите свою белую шашку.");
    if (forced && !samePos(forced, [r, c])) return setMessage(`Нужно продолжить взятие фигурой на ${posName(forced)}.`);
    if (mustCapture && !captures.has(`${r},${c}`)) return setMessage("Есть обязательное взятие. Выберите шашку, которая может бить.");
    game.selected = [r, c];
    setMessage(`Выбрана шашка на ${posName([r, c])}.`);
    playSelectSound();
    spawnSelectionFx([r, c]);
    haptic("selection");
    render();
    return;
  }

  const [sr, sc] = selected;
  if (piece && colorOf(piece) === "w" && !forced) {
    if (mustCapture && !captures.has(`${r},${c}`)) return setMessage("Эта шашка не может выполнить обязательное взятие.");
    game.selected = [r, c];
    setMessage(`Выбрана шашка на ${posName([r, c])}.`);
    playSelectSound();
    spawnSelectionFx([r, c]);
    render();
    return;
  }

  const captureMap = getCapturesFrom(game.board, sr, sc);
  const captureInfo = captureMap.find(x => samePos(x.landing, [r, c]));
  const isCapture = !!captureInfo;
  const simpleMoves = getSimpleMoves(game.board, sr, sc);

  if (mustCapture && !isCapture) return setMessage("Взятие обязательно.");
  if (!isCapture && !simpleMoves.some(x => samePos(x, [r, c]))) return setMessage("Так ходить нельзя.");
  if (game.board[r][c]) return setMessage("Клетка занята.");

  const result = executeStep(game.board, [sr, sc], [r, c]);
  game.lastPath = [[sr, sc], [r, c]];
  game.selected = null;

  if (result.isCapture) {
    playCaptureSound();
    spawnCaptureFx(result.captured);
  } else {
    playMoveSound();
    spawnMoveFx([r, c]);
  }

  if (result.isCapture) {
    const more = getCapturesFrom(game.board, r, c);
    if (more.length) {
      game.forcedPiece = [r, c];
      game.selected = [r, c];
      game.message = "Есть ещё одно взятие. Продолжайте этой же шашкой.";
      render();
      return;
    }
  }

  game.forcedPiece = null;
  const winner = checkWinner();
  if (winner) return finish(winner);

  game.turn = "b";
  game.message = "Бот думает...";
  render();
  haptic("impact");
  setTimeout(botTurn, game.level === "hard" ? 700 : 430);
}

function botTurn() {
  animateThinking(0, () => {
    const move = chooseBotMove();
    if (!move) return finish("У бота нет ходов. Вы победили.");
    const didCapture = move.captures.length > 0;
    game.board = move.boardAfter;
    game.lastPath = move.path;
    if (didCapture) {
      playCaptureSound();
      if (move.captures[0]) spawnCaptureFx(move.captures[0]);
    } else {
      playMoveSound(0.78);
      spawnMoveFx(move.end);
    }
    const winner = checkWinner();
    if (winner) return finish(`${winner} Ход бота: ${formatMove(move)}`);
    game.turn = "w";
    game.selected = null;
    game.forcedPiece = null;
    game.message = `Ваш ход. Ход бота: ${formatMove(move)}`;
    render();
    haptic("notification");
  });
}

function animateThinking(i, done) {
  const frames = ["Бот думает ·", "Бот думает · ·", "Бот думает · · ·"];
  if (i >= frames.length) return done();
  game.message = frames[i];
  render();
  setTimeout(() => animateThinking(i + 1, done), 220);
}

function formatMove(move) { return move.path.map(posName).join(move.captures.length ? " × " : " → "); }

function setMessage(msg) {
  if (game) game.message = msg;
  showToast(msg);
  render();
}

function finish(msg) {
  game.finished = true;
  game.turn = "w";
  game.message = msg;
  if (/Вы победили/.test(msg)) {
    score.wins += 1;
    saveScore();
    updateScoreUI();
    playWinSound();
    spawnWinFx();
  } else if (/Бот победил/.test(msg)) {
    score.losses += 1;
    saveScore();
    updateScoreUI();
    playLoseSound();
  }
  render();
  showToast(msg);
  haptic("notification");
}

function showHint() {
  if (!game || game.finished) return;
  const moves = generateTurnMoves(game.board, "w");
  if (!moves.length) return showToast("Ходов нет.");
  moves.sort((a, b) => moveHeuristic(b) - moveHeuristic(a));
  const m = moves[0];
  showToast(`Подсказка: ${formatMove(m)}`);
  spawnSelectionFx(m.start);
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 1700);
}

function haptic(type) {
  if (!tg?.HapticFeedback) return;
  try {
    if (type === "selection") tg.HapticFeedback.selectionChanged();
    else if (type === "notification") tg.HapticFeedback.notificationOccurred("success");
    else tg.HapticFeedback.impactOccurred("light");
  } catch (_) {}
}

function initAudio() {
  if (!soundEnabled) return;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx?.state === "suspended") audioCtx.resume();
}

function beep(freq = 440, duration = 0.12, type = "sine", volume = 0.04, when = 0) {
  if (!soundEnabled) return;
  initAudio();
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const now = audioCtx.currentTime + when;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function playUiSound() { beep(610, 0.06, "triangle", 0.03); }
function playSelectSound() { beep(540, 0.06, "triangle", 0.025); }
function playMoveSound(mult = 1) { beep(520 * mult, 0.07, "triangle", 0.03); beep(690 * mult, 0.09, "triangle", 0.022, 0.035); }
function playCaptureSound() { beep(240, 0.09, "square", 0.04); beep(180, 0.12, "square", 0.03, 0.03); }
function playWinSound() { beep(660, 0.12, "triangle", 0.04); beep(880, 0.12, "triangle", 0.04, 0.10); beep(1040, 0.16, "triangle", 0.05, 0.20); }
function playLoseSound() { beep(300, 0.13, "sawtooth", 0.03); beep(220, 0.18, "sawtooth", 0.03, 0.10); }

function spawnMoveFx(pos) {
  if (!pos) return;
  const rect = cellCenter(pos);
  spawnRing(rect.x, rect.y, "#35d7ff");
  for (let i = 0; i < 4; i++) spawnSpark(rect.x, rect.y, 16 + Math.random() * 22, "#7be2ff");
}

function spawnSelectionFx(pos) {
  if (!pos) return;
  const rect = cellCenter(pos);
  spawnRing(rect.x, rect.y, "#35d7ff");
}

function spawnCaptureFx(pos) {
  if (!pos) return;
  const rect = cellCenter(pos);
  const burst = document.createElement("div");
  burst.className = "capture-burst";
  burst.style.left = rect.x - 9 + "px";
  burst.style.top = rect.y - 9 + "px";
  boardFx.appendChild(burst);
  setTimeout(() => burst.remove(), 500);
  for (let i = 0; i < 9; i++) spawnSpark(rect.x, rect.y, 24 + Math.random() * 34, "#ff7f73");
}

function spawnWinFx() {
  const wrapRect = boardFx.getBoundingClientRect();
  for (let i = 0; i < 18; i++) {
    const x = 20 + Math.random() * (wrapRect.width - 40);
    const y = 20 + Math.random() * (wrapRect.height - 40);
    const spark = document.createElement("div");
    spark.className = "spark";
    spark.style.left = x + "px";
    spark.style.top = y + "px";
    spark.style.setProperty("--dx", `${(Math.random() - 0.5) * 60}px`);
    spark.style.setProperty("--dy", `${(Math.random() - 0.5) * 60}px`);
    spark.style.background = "radial-gradient(circle, rgba(255,255,255,1), rgba(255,211,80,.8), rgba(255,211,80,0))";
    boardFx.appendChild(spark);
    setTimeout(() => spark.remove(), 700);
  }
}

function spawnRing(x, y, color) {
  const ring = document.createElement("div");
  ring.className = "ring";
  ring.style.left = x - 22 + "px";
  ring.style.top = y - 22 + "px";
  ring.style.width = "44px";
  ring.style.height = "44px";
  ring.style.borderColor = color;
  boardFx.appendChild(ring);
  setTimeout(() => ring.remove(), 450);
}

function spawnSpark(x, y, distance, color) {
  const spark = document.createElement("div");
  spark.className = "spark";
  spark.style.left = x - 5 + "px";
  spark.style.top = y - 5 + "px";
  spark.style.setProperty("--dx", `${(Math.random() - 0.5) * distance * 2}px`);
  spark.style.setProperty("--dy", `${(Math.random() - 0.5) * distance * 2}px`);
  spark.style.background = `radial-gradient(circle, rgba(255,255,255,1), ${color}, rgba(255,255,255,0))`;
  boardFx.appendChild(spark);
  setTimeout(() => spark.remove(), 700);
}

function cellCenter(pos) {
  const [r, c] = pos;
  const cell = boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
  const cellRect = cell.getBoundingClientRect();
  const wrapRect = boardFx.getBoundingClientRect();
  return {
    x: cellRect.left - wrapRect.left + cellRect.width / 2,
    y: cellRect.top - wrapRect.top + cellRect.height / 2,
  };
}

showLevelScreen();
