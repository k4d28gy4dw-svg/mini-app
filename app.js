const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const SUPABASE_READY =
  window.SUPABASE_URL &&
  window.SUPABASE_ANON_KEY &&
  !window.SUPABASE_URL.includes("PASTE_") &&
  !window.SUPABASE_ANON_KEY.includes("PASTE_");

const sb = SUPABASE_READY ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY) : null;

const BOARD_SIZE = 8;
const PIECES = { w: "white", W: "white crown", b: "black", B: "black crown" };
const LEVEL_LABEL = { easy: "Лёгкий", normal: "Средний", hard: "Сложный" };
const SCORE_KEY = "checkers_online_score";
const PLAYER_KEY = "checkers_online_player_id";
const SOUND_KEY = "checkers_online_sound";

let game = null;
let roomChannel = null;
let playerId = localStorage.getItem(PLAYER_KEY);
if (!playerId) {
  playerId = "p_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem(PLAYER_KEY, playerId);
}

let soundEnabled = localStorage.getItem(SOUND_KEY) !== "off";
let audioCtx = null;

const $ = (id) => document.getElementById(id);
const screens = ["homeScreen", "levelScreen", "onlineScreen", "gameScreen"];
const score = loadScore();

$("botModeBtn").onclick = () => showScreen("levelScreen");
$("onlineModeBtn").onclick = () => showOnlineScreen();
$("homeBtn").onclick = () => goHome();
$("newGameBtn").onclick = () => game?.mode === "online" ? newOnlineGame() : showScreen("levelScreen");
$("rulesBtn").onclick = () => $("rulesModal").classList.remove("hidden");
$("rulesCloseBtn").onclick = () => $("rulesModal").classList.add("hidden");
$("closeBtn").onclick = () => tg ? tg.close() : showToast("Закрыть можно в Telegram");
$("hintBtn").onclick = () => showHint();
$("soundBtn").onclick = () => toggleSound();
$("createRoomBtn").onclick = () => createOnlineRoom();
$("joinRoomBtn").onclick = () => joinOnlineRoom($("roomInput").value.trim().toUpperCase());
$("copyRoomBtn").onclick = () => copyRoomLink();
$("shareRoomBtn").onclick = () => shareRoomLink();
$("sendChatBtn").onclick = () => sendChatMessage();
$("chatInput").onkeydown = (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChatMessage();
  }
};

document.querySelectorAll("[data-level]").forEach((btn) => {
  btn.onclick = () => {
    initAudio();
    playUiSound();
    startBotGame(btn.dataset.level);
  };
});

const roomFromUrl = new URLSearchParams(location.search).get("room");
if (roomFromUrl) {
  $("roomInput").value = roomFromUrl.toUpperCase();
  showOnlineScreen();
} else {
  showScreen("homeScreen");
}

updateScoreUI();
updateSoundButton();

function showScreen(id) {
  screens.forEach((s) => $(s).classList.toggle("hidden", s !== id));
}

function goHome() {
  if (roomChannel) {
    sb?.removeChannel(roomChannel);
    roomChannel = null;
  }
  $("chatPanel").classList.add("hidden");
  showScreen("homeScreen");
}

function showOnlineScreen() {
  showScreen("onlineScreen");
  if (!SUPABASE_READY) showToast("Сначала заполните config.js данными Supabase");
}

function loadScore() {
  try {
    const raw = JSON.parse(localStorage.getItem(SCORE_KEY) || "{}");
    return { wins: Number(raw.wins || 0), losses: Number(raw.losses || 0) };
  } catch {
    return { wins: 0, losses: 0 };
  }
}

function saveScore() {
  localStorage.setItem(SCORE_KEY, JSON.stringify(score));
}

function updateScoreUI() {
  $("winsCount").textContent = String(score.wins);
  $("lossesCount").textContent = String(score.losses);
}

function updateSoundButton() {
  $("soundBtn").textContent = soundEnabled ? "🔊 Звук" : "🔇 Без звука";
}

function toggleSound() {
  initAudio();
  soundEnabled = !soundEnabled;
  localStorage.setItem(SOUND_KEY, soundEnabled ? "on" : "off");
  updateSoundButton();
  if (soundEnabled) playUiSound();
}

function randomRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function playerName() {
  return tg?.initDataUnsafe?.user?.first_name || "Игрок";
}

function createInitialState(whiteId = playerId) {
  return {
    board: newBoard(),
    turn: "w",
    selected: null,
    forcedPiece: null,
    lastPath: [],
    finished: false,
    message: "Ожидаем второго игрока.",
    whiteId,
    blackId: null,
    whiteName: playerName(),
    blackName: null,
    chat: [],
    updatedAt: Date.now(),
  };
}

async function createOnlineRoom() {
  if (!SUPABASE_READY) return showToast("Заполните config.js данными Supabase");
  const roomId = randomRoomId();
  const state = createInitialState();

  const { error } = await sb.from("checkers_rooms").insert({ id: roomId, state });
  if (error) return showToast("Ошибка создания комнаты: " + error.message);

  await enterOnlineRoom(roomId, state);
  showToast("Комната создана");
}

async function joinOnlineRoom(roomId) {
  if (!SUPABASE_READY) return showToast("Заполните config.js данными Supabase");
  if (!roomId) return showToast("Введите код комнаты");

  const { data, error } = await sb.from("checkers_rooms").select("*").eq("id", roomId).single();
  if (error || !data) return showToast("Комната не найдена");

  let state = data.state;

  if (state.whiteId === playerId || state.blackId === playerId) {
    return enterOnlineRoom(roomId, state);
  }

  if (state.blackId && state.blackId !== playerId) {
    return showToast("Комната уже занята");
  }

  state.blackId = playerId;
  state.blackName = playerName();
  state.message = "Игра началась. Ход белых.";
  state.updatedAt = Date.now();

  const { error: updateError } = await sb.from("checkers_rooms").update({ state, updated_at: new Date().toISOString() }).eq("id", roomId);
  if (updateError) return showToast("Ошибка входа: " + updateError.message);

  await enterOnlineRoom(roomId, state);
}

async function enterOnlineRoom(roomId, state) {
  if (roomChannel) {
    await sb.removeChannel(roomChannel);
    roomChannel = null;
  }

  game = {
    mode: "online",
    roomId,
    playerColor: state.whiteId === playerId ? "w" : "b",
    board: state.board,
    turn: state.turn,
    selected: null,
    forcedPiece: state.forcedPiece,
    lastPath: state.lastPath || [],
    finished: state.finished,
    message: state.message || "",
    onlineState: state,
  };

  applyOnlineState(state);
  showScreen("gameScreen");
  $("roomPanel").classList.remove("hidden");
  $("chatPanel").classList.remove("hidden");
  $("modeLabel").textContent = "Онлайн";
  $("roomLabel").textContent = roomId;
  $("roomCodeText").textContent = roomId;

  roomChannel = sb.channel("room_" + roomId)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "checkers_rooms", filter: `id=eq.${roomId}` }, (payload) => {
      applyOnlineState(payload.new.state);
    })
    .subscribe();

  render();
}

function applyOnlineState(state) {
  if (!game) return;
  const selected = game.selected;
  game.onlineState = state;
  game.board = state.board;
  game.turn = state.turn;
  game.forcedPiece = state.forcedPiece;
  game.lastPath = state.lastPath || [];
  game.finished = state.finished;
  game.message = onlineMessage(state);
  game.selected = state.turn === game.playerColor ? selected : null;

  $("userName").textContent = "Вы";
  $("enemyName").textContent = game.playerColor === "w" ? (state.blackName || "Ожидаем") : (state.whiteName || "Ожидаем");
  $("userColor").textContent = game.playerColor === "w" ? "белые" : "чёрные";
  $("enemyColor").textContent = game.playerColor === "w" ? "чёрные" : "белые";
  renderChat(state.chat || []);
  render();
}

function renderChat(messages) {
  const list = $("chatMessages");
  list.innerHTML = "";
  $("chatCount").textContent = String(messages.length);

  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "Пока сообщений нет. Поздоровайтесь с соперником!";
    list.appendChild(empty);
    return;
  }

  for (const message of messages.slice(-50)) {
    const item = document.createElement("div");
    item.className = `chat-message${message.playerId === playerId ? " mine" : ""}`;

    const meta = document.createElement("div");
    meta.className = "chat-meta";
    const author = document.createElement("strong");
    author.textContent = message.playerId === playerId ? "Вы" : (message.author || "Игрок");
    const time = document.createElement("time");
    time.textContent = new Date(message.createdAt || Date.now()).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    meta.append(author, time);

    const text = document.createElement("p");
    text.textContent = message.text || "";
    item.append(meta, text);
    list.appendChild(item);
  }
  list.scrollTop = list.scrollHeight;
}

async function sendChatMessage() {
  if (!game || game.mode !== "online") return;
  if (!game.onlineState?.blackId) return showToast("Дождитесь второго игрока");

  const input = $("chatInput");
  const text = input.value.trim().replace(/\s+/g, " ");
  if (!text) return;

  const chat = [...(game.onlineState.chat || []), {
    id: `${playerId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    playerId,
    author: playerName(),
    text: text.slice(0, 240),
    createdAt: Date.now(),
  }].slice(-50);

  input.value = "";
  await saveOnlineState({ chat });
  renderChat(chat);
}

function onlineMessage(state) {
  if (state.finished) return state.message;
  if (!state.blackId) return "Комната создана. Отправьте код второму игроку.";
  if (state.turn === game.playerColor) return "Ваш ход.";
  return "Ход соперника.";
}

async function saveOnlineState(extra = {}) {
  if (!game || game.mode !== "online") return;
  const state = {
    ...game.onlineState,
    board: game.board,
    turn: game.turn,
    forcedPiece: game.forcedPiece,
    lastPath: game.lastPath,
    finished: game.finished,
    message: game.message,
    updatedAt: Date.now(),
    ...extra,
  };
  game.onlineState = state;
  const { error } = await sb.from("checkers_rooms").update({ state, updated_at: new Date().toISOString() }).eq("id", game.roomId);
  if (error) showToast("Ошибка синхронизации: " + error.message);
}

async function newOnlineGame() {
  if (!game || game.mode !== "online") return;
  if (game.playerColor !== "w") return showToast("Новую игру создаёт игрок белыми");
  game.board = newBoard();
  game.turn = "w";
  game.selected = null;
  game.forcedPiece = null;
  game.lastPath = [];
  game.finished = false;
  game.message = "Новая игра началась. Ход белых.";
  await saveOnlineState({ board: game.board, turn: "w", forcedPiece: null, lastPath: [], finished: false, message: game.message });
  render();
}

function roomLink() {
  const url = new URL(location.href);
  url.searchParams.set("room", game.roomId);
  return url.toString();
}

async function copyRoomLink() {
  const link = roomLink();
  try {
    await navigator.clipboard.writeText(link);
    showToast("Ссылка скопирована");
  } catch {
    showToast(link);
  }
}

function shareRoomLink() {
  const link = roomLink();
  const text = encodeURIComponent("Сыграем в шашки?");
  const url = encodeURIComponent(link);
  if (tg) tg.openTelegramLink(`https://t.me/share/url?url=${url}&text=${text}`);
  else window.open(`https://t.me/share/url?url=${url}&text=${text}`, "_blank");
}

function startBotGame(level = "normal") {
  game = {
    mode: "bot",
    level,
    playerColor: "w",
    board: newBoard(),
    turn: "w",
    selected: null,
    forcedPiece: null,
    lastPath: [],
    finished: false,
    message: "Ваш ход. Нажмите на белую шашку.",
  };
  $("roomPanel").classList.add("hidden");
  $("chatPanel").classList.add("hidden");
  $("modeLabel").textContent = "Бот: " + LEVEL_LABEL[level];
  $("roomLabel").textContent = "VS";
  $("userName").textContent = "Вы";
  $("enemyName").textContent = "Бот";
  $("userColor").textContent = "белые";
  $("enemyColor").textContent = "чёрные";
  showScreen("gameScreen");
  render();
}

function newBoard() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) board[r][c] = "b";
  for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) board[r][c] = "w";
  return board;
}

function inside(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function colorOf(piece) { return piece ? (piece.toLowerCase() === "w" ? "w" : "b") : null; }
function opposite(color) { return color === "w" ? "b" : "w"; }
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

function promote(piece, r) {
  if (piece === "w" && r === 0) return "W";
  if (piece === "b" && r === 7) return "B";
  return piece;
}

function executeStep(board, start, end) {
  const [sr, sc] = start, [er, ec] = end;
  const piece = board[sr][sc];
  const found = getCapturesFrom(board, sr, sc).find(x => samePos(x.landing, end));
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
    const next = cloneBoard(board);
    executeStep(next, [r, c], cap.landing);
    result = result.concat(generateCaptureSequences(next, start, [...path, cap.landing], [...captured, cap.captured]));
  }
  return result;
}

function generateTurnMoves(board, color) {
  const caps = allCaptures(board, color);
  let moves = [];
  if (caps.size) {
    for (const key of caps.keys()) moves = moves.concat(generateCaptureSequences(cloneBoard(board), key.split(",").map(Number)));
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
  if (countPieces(game.board, "w") === 0) return "Чёрные победили.";
  if (countPieces(game.board, "b") === 0) return "Белые победили.";
  if (!generateTurnMoves(game.board, "w").length) return "У белых нет ходов. Чёрные победили.";
  if (!generateTurnMoves(game.board, "b").length) return "У чёрных нет ходов. Белые победили.";
  return null;
}

function evaluateBoard(board) {
  let s = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (!p) continue;
    let val = p === p.toUpperCase() ? 300 : 100;
    if (colorOf(p) === "b") { val += r * 6; s += val; } else { val += (7 - r) * 6; s -= val; }
  }
  return s;
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
      const score = minimax(m.boardAfter, depth - 1, "w", alpha, beta);
      best = Math.max(best, score); alpha = Math.max(alpha, score);
      if (beta <= alpha) break;
    }
    return best;
  }
  let best = Infinity;
  for (const m of moves) {
    const score = minimax(m.boardAfter, depth - 1, "b", alpha, beta);
    best = Math.min(best, score); beta = Math.min(beta, score);
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
  let bestScore = -Infinity, bestMoves = [];
  for (const move of moves) {
    const score = minimax(move.boardAfter, 3, "w", -Infinity, Infinity);
    if (score > bestScore) { bestScore = score; bestMoves = [move]; }
    else if (score === bestScore) bestMoves.push(move);
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

function currentPlayerColor() {
  return game?.mode === "online" ? game.playerColor : "w";
}

function canAct() {
  if (!game || game.finished) return false;
  if (game.mode === "online") {
    if (!game.onlineState?.blackId) return false;
    return game.turn === game.playerColor;
  }
  return game.turn === "w";
}

function legalDestinationsForSelected() {
  if (!game?.selected) return [];
  const [r, c] = game.selected;
  const color = currentPlayerColor();
  const captures = allCaptures(game.board, color);
  if (captures.size) return getCapturesFrom(game.board, r, c).map(x => x.landing);
  return getSimpleMoves(game.board, r, c);
}

function render() {
  $("board").innerHTML = "";
  const dests = legalDestinationsForSelected();
  const lastKeys = new Set((game?.lastPath || []).map(posKey));

  for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) {
    const cell = document.createElement("button");
    const isDark = (r + c) % 2 === 1;
    const pos = [r, c];
    cell.className = `cell ${isDark ? "dark" : "light"}`;
    cell.dataset.r = r; cell.dataset.c = c;
    if (game?.selected && samePos(game.selected, pos)) cell.classList.add("selected");
    if (dests.some(d => samePos(d, pos))) cell.classList.add("dest");
    if (lastKeys.has(posKey(pos))) cell.classList.add("last");

    const piece = game?.board?.[r]?.[c];
    if (piece) {
      const p = document.createElement("div");
      p.className = `piece ${PIECES[piece]} pop`;
      if (game?.lastPath?.some(x => samePos(x, pos))) p.classList.add("moving");
      if (piece === "W" || piece === "B") p.classList.add("crown");
      cell.appendChild(p);
    }

    cell.onclick = () => handleCellClick(r, c);
    $("board").appendChild(cell);
  }

  $("statusText").textContent = game?.message || "Выберите режим";
  $("userPanel").classList.toggle("active", game && game.turn === currentPlayerColor() && !game.finished);
  $("botPanel").classList.toggle("active", game && game.turn !== currentPlayerColor() && !game.finished);
}

async function handleCellClick(r, c) {
  if (!canAct()) return;
  initAudio();

  const color = currentPlayerColor();
  const piece = game.board[r][c];
  const selected = game.selected;
  const forced = game.forcedPiece;
  const captures = allCaptures(game.board, color);
  const mustCapture = captures.size > 0;

  if (!selected) {
    if (!piece || colorOf(piece) !== color) return setMessage(color === "w" ? "Выберите белую шашку." : "Выберите чёрную шашку.");
    if (forced && !samePos(forced, [r, c])) return setMessage(`Нужно продолжить взятие фигурой на ${posName(forced)}.`);
    if (mustCapture && !captures.has(`${r},${c}`)) return setMessage("Есть обязательное взятие. Выберите шашку, которая может бить.");
    game.selected = [r, c];
    setMessage(`Выбрана шашка на ${posName([r, c])}.`);
    playSelectSound();
    spawnSelectionFx([r, c]);
    render();
    return;
  }

  const [sr, sc] = selected;

  if (piece && colorOf(piece) === color && !forced) {
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

  if (result.isCapture) { playCaptureSound(); spawnCaptureFx(result.captured); }
  else { playMoveSound(); spawnMoveFx([r, c]); }

  if (result.isCapture) {
    const more = getCapturesFrom(game.board, r, c);
    if (more.length) {
      game.forcedPiece = [r, c];
      game.selected = [r, c];
      game.message = "Есть ещё одно взятие. Продолжайте этой же шашкой.";
      if (game.mode === "online") await saveOnlineState();
      render();
      return;
    }
  }

  game.forcedPiece = null;

  const winner = checkWinner();
  if (winner) {
    await finish(winner);
    return;
  }

  if (game.mode === "online") {
    game.turn = opposite(color);
    game.message = "Ход соперника.";
    await saveOnlineState();
    render();
  } else {
    game.turn = "b";
    game.message = "Бот думает...";
    render();
    setTimeout(botTurn, game.level === "hard" ? 700 : 430);
  }
}

function botTurn() {
  animateThinking(0, async () => {
    const move = chooseBotMove();
    if (!move) return finish("У чёрных нет ходов. Белые победили.");
    const didCapture = move.captures.length > 0;
    game.board = move.boardAfter;
    game.lastPath = move.path;
    if (didCapture) { playCaptureSound(); if (move.captures[0]) spawnCaptureFx(move.captures[0]); }
    else { playMoveSound(0.78); spawnMoveFx(move.end); }

    const winner = checkWinner();
    if (winner) return finish(`${winner} Ход бота: ${formatMove(move)}`);

    game.turn = "w";
    game.selected = null;
    game.forcedPiece = null;
    game.message = `Ваш ход. Ход бота: ${formatMove(move)}`;
    render();
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
  if (game) game.message = msg;
  showToast(msg);
  render();
}

async function finish(msg) {
  game.finished = true;
  game.message = msg;

  const playerWon = game.mode === "bot"
    ? /Белые победили/.test(msg)
    : ((game.playerColor === "w" && /Белые победили/.test(msg)) || (game.playerColor === "b" && /Чёрные победили/.test(msg)));

  if (playerWon) {
    score.wins += 1;
    playWinSound();
    spawnWinFx();
  } else {
    score.losses += 1;
    playLoseSound();
  }
  saveScore();
  updateScoreUI();

  if (game.mode === "online") await saveOnlineState({ finished: true, message: msg });

  render();
  showToast(msg);
}

function showHint() {
  if (!game || game.finished) return;
  if (game.mode === "online") return showToast("Подсказка доступна только в игре с ботом.");
  const moves = generateTurnMoves(game.board, "w");
  if (!moves.length) return showToast("Ходов нет.");
  moves.sort((a, b) => moveHeuristic(b) - moveHeuristic(a));
  const m = moves[0];
  showToast(`Подсказка: ${formatMove(m)}`);
  spawnSelectionFx(m.start);
}

function showToast(msg) {
  $("toast").textContent = msg;
  $("toast").classList.remove("hidden");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => $("toast").classList.add("hidden"), 1900);
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

function playUiSound(){beep(610,.06,"triangle",.03)}
function playSelectSound(){beep(540,.06,"triangle",.025)}
function playMoveSound(mult=1){beep(520*mult,.07,"triangle",.03);beep(690*mult,.09,"triangle",.022,.035)}
function playCaptureSound(){beep(240,.09,"square",.04);beep(180,.12,"square",.03,.03)}
function playWinSound(){beep(660,.12,"triangle",.04);beep(880,.12,"triangle",.04,.10);beep(1040,.16,"triangle",.05,.20)}
function playLoseSound(){beep(300,.13,"sawtooth",.03);beep(220,.18,"sawtooth",.03,.10)}

function cellCenter(pos) {
  const [r, c] = pos;
  const cell = $("board").querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
  if (!cell) return { x: 0, y: 0 };
  const cr = cell.getBoundingClientRect();
  const br = $("boardFx").getBoundingClientRect();
  return { x: cr.left - br.left + cr.width / 2, y: cr.top - br.top + cr.height / 2 };
}

function spawnRing(x,y,color){const ring=document.createElement("div");ring.className="ring";ring.style.left=x-22+"px";ring.style.top=y-22+"px";ring.style.width="44px";ring.style.height="44px";ring.style.borderColor=color;$("boardFx").appendChild(ring);setTimeout(()=>ring.remove(),450)}
function spawnSpark(x,y,distance,color){const s=document.createElement("div");s.className="spark";s.style.left=x-5+"px";s.style.top=y-5+"px";s.style.setProperty("--dx",`${(Math.random()-.5)*distance*2}px`);s.style.setProperty("--dy",`${(Math.random()-.5)*distance*2}px`);s.style.background=`radial-gradient(circle,rgba(255,255,255,1),${color},rgba(255,255,255,0))`;$("boardFx").appendChild(s);setTimeout(()=>s.remove(),700)}
function spawnMoveFx(pos){const p=cellCenter(pos);spawnRing(p.x,p.y,"#35d7ff");for(let i=0;i<4;i++)spawnSpark(p.x,p.y,16+Math.random()*22,"#7be2ff")}
function spawnSelectionFx(pos){const p=cellCenter(pos);spawnRing(p.x,p.y,"#35d7ff")}
function spawnCaptureFx(pos){const p=cellCenter(pos);const b=document.createElement("div");b.className="capture-burst";b.style.left=p.x-9+"px";b.style.top=p.y-9+"px";$("boardFx").appendChild(b);setTimeout(()=>b.remove(),500);for(let i=0;i<9;i++)spawnSpark(p.x,p.y,24+Math.random()*34,"#ff7f73")}
function spawnWinFx(){const br=$("boardFx").getBoundingClientRect();for(let i=0;i<18;i++)spawnSpark(20+Math.random()*(br.width-40),20+Math.random()*(br.height-40),50,"#ffd350")}
