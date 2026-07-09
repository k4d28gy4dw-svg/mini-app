const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
  document.body.style.backgroundColor = tg.themeParams?.bg_color || "";
}

const BOARD_SIZE = 8;
const PIECES = { w: "white", W: "white crown", b: "black", B: "black crown" };
const LEVEL_LABEL = { easy: "Лёгкий", normal: "Средний", hard: "Сложный" };

let game = null;

const levelScreen = document.getElementById("levelScreen");
const gameScreen = document.getElementById("gameScreen");
const boardEl = document.getElementById("board");
const statusText = document.getElementById("statusText");
const difficultyLabel = document.getElementById("difficultyLabel");
const userPanel = document.getElementById("userPanel");
const botPanel = document.getElementById("botPanel");
const toastEl = document.getElementById("toast");
const rulesModal = document.getElementById("rulesModal");

document.querySelectorAll("[data-level]").forEach((btn) => {
  btn.addEventListener("click", () => startGame(btn.dataset.level));
});

document.getElementById("newGameBtn").addEventListener("click", showLevelScreen);
document.getElementById("rulesBtn").addEventListener("click", () => rulesModal.classList.remove("hidden"));
document.getElementById("rulesCloseBtn").addEventListener("click", () => rulesModal.classList.add("hidden"));
document.getElementById("closeBtn").addEventListener("click", () => tg ? tg.close() : showToast("Закрыть можно в Telegram"));
document.getElementById("hintBtn").addEventListener("click", showHint);

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

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) board[r][c] = "b";
    }
  }

  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) board[r][c] = "w";
    }
  }

  return board;
}

function inside(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function colorOf(piece) {
  if (!piece) return null;
  return piece.toLowerCase() === "w" ? "w" : "b";
}

function opponent(color) {
  return color === "w" ? "b" : "w";
}

function posName([r, c]) {
  return "abcdefgh"[c] + (8 - r);
}

function simpleDirs(piece) {
  if (piece === "w") return [[-1, -1], [-1, 1]];
  if (piece === "b") return [[1, -1], [1, 1]];
  return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
}

function captureDirs() {
  return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
}

function cloneBoard(board) {
  return board.map(row => [...row]);
}

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

    if (middle && colorOf(middle) !== my && !board[lr][lc]) {
      out.push({ landing: [lr, lc], captured: [mr, mc] });
    }
  }

  return out;
}

function allCaptures(board, color) {
  const map = new Map();

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && colorOf(piece) === color) {
        const caps = getCapturesFrom(board, r, c);
        if (caps.length) map.set(`${r},${c}`, caps);
      }
    }
  }

  return map;
}

function allSimpleMoves(board, color) {
  const map = new Map();

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && colorOf(piece) === color) {
        const moves = getSimpleMoves(board, r, c);
        if (moves.length) map.set(`${r},${c}`, moves);
      }
    }
  }

  return map;
}

function promote(piece, r) {
  if (piece === "w" && r === 0) return "W";
  if (piece === "b" && r === 7) return "B";
  return piece;
}

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

function samePos(a, b) {
  return a && b && a[0] === b[0] && a[1] === b[1];
}

function posKey(pos) {
  return pos ? `${pos[0]},${pos[1]}` : "";
}

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
  for (const row of board) {
    for (const p of row) if (p && colorOf(p) === color) n++;
  }
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
  let score = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      let val = p === p.toUpperCase() ? 300 : 100;

      if (colorOf(p) === "b") {
        val += r * 6;
        score += val;
      } else {
        val += (7 - r) * 6;
        score -= val;
      }
    }
  }

  score += generateTurnMoves(board, "b").length * 4;
  score -= generateTurnMoves(board, "w").length * 4;
  return score;
}

function moveHeuristic(move) {
  const [r, c] = move.end;
  let score = move.captures.length * 120;
  if (r === 7) score += 80;
  score += 14 - Math.abs(3.5 - r) - Math.abs(3.5 - c);
  return score;
}

function minimax(board, depth, color, alpha, beta) {
  const moves = generateTurnMoves(board, color);
  if (depth === 0 || !moves.length) return evaluateBoard(board);

  if (color === "b") {
    let best = -Infinity;
    for (const m of moves) {
      const score = minimax(m.boardAfter, depth - 1, "w", alpha, beta);
      best = Math.max(best, score);
      alpha = Math.max(alpha, score);
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = Infinity;
  for (const m of moves) {
    const score = minimax(m.boardAfter, depth - 1, "b", alpha, beta);
    best = Math.min(best, score);
    beta = Math.min(beta, score);
    if (beta <= alpha) break;
  }
  return best;
}

function chooseBotMove() {
  const moves = generateTurnMoves(game.board, "b");
  if (!moves.length) return null;

  if (game.level === "easy") {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  if (game.level === "normal") {
    const scores = moves.map(moveHeuristic);
    const max = Math.max(...scores);
    const best = moves.filter((_, i) => scores[i] === max);
    return best[Math.floor(Math.random() * best.length)];
  }

  let bestScore = -Infinity;
  let bestMoves = [];

  for (const move of moves) {
    const score = minimax(move.boardAfter, 3, "w", -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [move];
    } else if (score === bestScore) {
      bestMoves.push(move);
    }
  }

  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

function legalDestinationsForSelected() {
  if (!game?.selected) return [];
  const [r, c] = game.selected;
  const captures = allCaptures(game.board, "w");

  if (captures.size) {
    return getCapturesFrom(game.board, r, c).map(x => x.landing);
  }

  return getSimpleMoves(game.board, r, c);
}

function render() {
  boardEl.innerHTML = "";

  const dests = legalDestinationsForSelected();
  const lastKeys = new Set((game?.lastPath || []).map(posKey));

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = document.createElement("button");
      const isDark = (r + c) % 2 === 1;
      const pos = [r, c];

      cell.className = `cell ${isDark ? "dark" : "light"}`;

      if (game?.selected && samePos(game.selected, pos)) cell.classList.add("selected");
      if (dests.some(d => samePos(d, pos))) cell.classList.add("dest");
      if (lastKeys.has(posKey(pos))) cell.classList.add("last");

      const piece = game?.board[r][c];
      if (piece) {
        const p = document.createElement("div");
        p.className = `piece ${PIECES[piece]}`;
        p.classList.add("pop");
        cell.appendChild(p);
      }

      cell.addEventListener("click", () => handleCellClick(r, c));
      boardEl.appendChild(cell);
    }
  }

  statusText.textContent = game?.message || "Выберите сложность";
  userPanel.classList.toggle("active", game?.turn === "w");
  botPanel.classList.toggle("active", game?.turn === "b");
}

function handleCellClick(r, c) {
  if (!game || game.finished || game.turn !== "w") return;

  const piece = game.board[r][c];
  const selected = game.selected;
  const forced = game.forcedPiece;
  const captures = allCaptures(game.board, "w");
  const mustCapture = captures.size > 0;

  if (!selected) {
    if (!piece || colorOf(piece) !== "w") return setMessage("Выберите свою белую шашку.");

    if (forced && !samePos(forced, [r, c])) {
      return setMessage(`Нужно продолжить взятие фигурой на ${posName(forced)}.`);
    }

    if (mustCapture && !captures.has(`${r},${c}`)) {
      return setMessage("Есть обязательное взятие. Выберите шашку, которая может бить.");
    }

    game.selected = [r, c];
    setMessage(`Выбрана шашка на ${posName([r, c])}.`);
    haptic("selection");
    render();
    return;
  }

  const [sr, sc] = selected;

  if (piece && colorOf(piece) === "w" && !forced) {
    if (mustCapture && !captures.has(`${r},${c}`)) return setMessage("Эта шашка не может выполнить обязательное взятие.");
    game.selected = [r, c];
    setMessage(`Выбрана шашка на ${posName([r, c])}.`);
    render();
    return;
  }

  const captureMap = getCapturesFrom(game.board, sr, sc);
  const isCapture = captureMap.some(x => samePos(x.landing, [r, c]));
  const simpleMoves = getSimpleMoves(game.board, sr, sc);

  if (mustCapture && !isCapture) return setMessage("Взятие обязательно.");
  if (!isCapture && !simpleMoves.some(x => samePos(x, [r, c]))) return setMessage("Так ходить нельзя.");
  if (game.board[r][c]) return setMessage("Клетка занята.");

  const result = executeStep(game.board, [sr, sc], [r, c]);
  game.lastPath = [[sr, sc], [r, c]];
  game.selected = null;

  if (result.isCapture) {
    const more = getCapturesFrom(game.board, r, c);
    if (more.length) {
      game.forcedPiece = [r, c];
      game.selected = [r, c];
      setMessage("Есть ещё одно взятие. Продолжайте этой же шашкой.");
      haptic("impact");
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

  setTimeout(botTurn, game.level === "hard" ? 750 : 450);
}

function botTurn() {
  animateThinking(0, () => {
    const move = chooseBotMove();

    if (!move) return finish("У бота нет ходов. Вы победили.");

    game.board = move.boardAfter;
    game.lastPath = move.path;

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

function formatMove(move) {
  return move.path.map(posName).join(move.captures.length ? " × " : " → ");
}

function setMessage(msg) {
  game.message = msg;
  showToast(msg);
  render();
}

function finish(msg) {
  game.finished = true;
  game.turn = "w";
  game.message = msg;
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

showLevelScreen();
