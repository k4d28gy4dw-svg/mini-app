(() => {
  const root = document.querySelector(".app");
  const ready = window.SUPABASE_URL && window.SUPABASE_ANON_KEY && !window.SUPABASE_URL.includes("PASTE_");
  const db = ready ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY) : null;
  const pid = localStorage.getItem("checkers_online_player_id") || `p_${Math.random().toString(36).slice(2)}`;
  const name = () => window.Telegram?.WebApp?.initDataUnsafe?.user?.first_name || "Игрок";
  const $ = (id) => document.getElementById(id);
  let x = null, channel = null, resultShown = false;

  const shell = document.createElement("main");
  shell.id = "extraGameScreen";
  shell.className = "extra-game hidden";
  shell.innerHTML = `
    <section class="extra-game-head card"><div><h2 id="xTitle">Игра</h2><small id="xSubtitle">Выберите режим</small></div><strong id="xRoom"></strong></section>
    <section id="xMenu" class="extra-panel card"><h2 id="xMenuTitle"></h2><p>Играйте против бота или создайте онлайн-комнату.</p><div class="extra-modes"><button id="xBot" class="big-action">🤖 Играть с ботом</button><button id="xOnline" class="big-action online">🌐 Онлайн с другом</button></div></section>
    <section id="xOnlinePanel" class="extra-panel card hidden"><h2>Онлайн-игра</h2><p>Создайте комнату или введите код друга.</p><button id="xCreate" class="big-action online">Создать комнату</button><div class="extra-online-row"><input id="xCode" maxlength="8" placeholder="Код комнаты"><button id="xJoin">Войти</button></div></section>
    <div id="xStatus" class="extra-status">Выберите режим</div>
    <section id="xBoardHost"></section>
    <section id="xChat" class="chat-panel card extra-chat hidden"><div class="chat-head"><div><strong>Чат комнаты</strong><small>Сообщения видят оба игрока</small></div><span id="xChatCount">0</span></div><div id="xMessages" class="chat-messages"></div><div class="chat-compose"><input id="xMessage" maxlength="240" placeholder="Напишите сообщение…"><button id="xSend">Отправить</button></div></section>
    <section class="extra-actions card"><button id="xRestart">Новая игра</button><button id="xCopy">Код комнаты</button><button id="xBack">К играм</button></section>`;
  root.insertBefore(shell, $("toast"));

  function hideBase() { ["homeScreen","modeScreen","levelScreen","onlineScreen","gameScreen"].forEach(id => $(id)?.classList.add("hidden")); shell.classList.remove("hidden"); }
  function home() { shell.classList.add("hidden"); if (channel) db?.removeChannel(channel); channel = null; x = null; $("homeScreen").classList.remove("hidden"); }
  $("homeBtn").addEventListener("click", () => { if (!shell.classList.contains("hidden")) home(); });
  $("xBack").onclick = home;
  $("chessGameBtn").onclick = () => openGame("chess");
  $("seaGameBtn").onclick = () => openGame("sea");
  $("xBot").onclick = () => startBot();
  $("xOnline").onclick = () => $("xOnlinePanel").classList.remove("hidden");
  $("xCreate").onclick = createRoom;
  $("xJoin").onclick = () => joinRoom($("xCode").value.trim().toUpperCase());
  $("xSend").onclick = sendMessage;
  $("xMessage").onkeydown = e => { if (e.key === "Enter") sendMessage(); };
  $("xCopy").onclick = async () => { if (!x?.roomId) return toast("Сначала создайте комнату"); await navigator.clipboard?.writeText(x.roomId); toast(`Код ${x.roomId} скопирован`); };
  $("xRestart").onclick = restart;

  function openGame(type) {
    hideBase();
    x = { type, mode: null, roomId: null, color: "w", state: null, selected: null }; resultShown = false;
    $("xTitle").textContent = type === "chess" ? "♚ Шахматы" : "🚢 Морской бой";
    $("xMenuTitle").textContent = type === "chess" ? "Шахматы" : "Морской бой";
    $("xSubtitle").textContent = "Выберите режим";
    $("xRoom").textContent = "";
    $("xMenu").classList.remove("hidden"); $("xOnlinePanel").classList.add("hidden"); $("xChat").classList.add("hidden");
    $("xBoardHost").innerHTML = ""; status("Выберите режим");
  }

  function startBot() {
    $("resultBanner").classList.add("hidden"); resultShown = false;
    x.mode = "bot"; x.color = "w"; x.state = x.type === "chess" ? chessState() : seaState(true);
    $("xMenu").classList.add("hidden"); $("xOnlinePanel").classList.add("hidden"); $("xSubtitle").textContent = "Игра против бота"; render();
  }

  const roomId = () => `${x.type === "chess" ? "C" : "S"}${Math.random().toString(36).slice(2,7)}`.toUpperCase();
  async function createRoom() {
    if (!db) return toast("Supabase не подключён");
    const id = roomId();
    const state = x.type === "chess" ? chessState() : seaState(false);
    Object.assign(state, { gameType: x.type, whiteId: pid, whiteName: name(), blackId: null, blackName: null, chat: [] });
    const { error } = await db.from("checkers_rooms").insert({ id, state });
    if (error) return toast(error.message);
    await enterRoom(id, state);
  }
  async function joinRoom(id) {
    if (!db || !id) return toast("Введите код комнаты");
    const { data, error } = await db.from("checkers_rooms").select("*").eq("id", id).single();
    if (error || !data || data.state.gameType !== x.type) return toast("Комната не найдена");
    const state = data.state;
    if (!state.blackId) { state.blackId = pid; state.blackName = name(); if (x.type === "sea") state.blackFleet = makeFleet(); await db.from("checkers_rooms").update({ state }).eq("id", id); }
    else if (![state.whiteId,state.blackId].includes(pid)) return toast("Комната занята");
    await enterRoom(id, state);
  }
  async function enterRoom(id, state) {
    x.mode = "online"; x.roomId = id; x.color = state.whiteId === pid ? "w" : "b"; x.state = state;
    $("xMenu").classList.add("hidden"); $("xOnlinePanel").classList.add("hidden"); $("xChat").classList.remove("hidden"); $("xRoom").textContent = id; $("xSubtitle").textContent = x.color === "w" ? "Вы — первый игрок" : "Вы — второй игрок";
    if (channel) await db.removeChannel(channel);
    channel = db.channel(`extra_${id}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "checkers_rooms", filter: `id=eq.${id}` }, p => { x.state = p.new.state; render(); }).subscribe();
    render();
  }
  async function save(extra={}) { Object.assign(x.state, extra, { updatedAt: Date.now() }); const { error } = await db.from("checkers_rooms").update({ state:x.state, updated_at:new Date().toISOString() }).eq("id",x.roomId); if(error) toast(error.message); }

  // Chess: standard movement, promotion, check prevention and king capture ending.
  const glyph = {K:"♔",Q:"♕",R:"♖",B:"♗",N:"♘",P:"♙",k:"♚",q:"♛",r:"♜",b:"♝",n:"♞",p:"♟"};
  function chessState(){ return { board:["rnbqkbnr","pppppppp","........","........","........","........","PPPPPPPP","RNBQKBNR"].map(r=>[...r].map(v=>v==="."?null:v)), turn:"w", finished:false, message:"Ход белых" }; }
  const pc = p => p && (p===p.toUpperCase()?"w":"b"), inside=(r,c)=>r>=0&&r<8&&c>=0&&c<8;
  function chessMoves(b,r,c){ const p=b[r][c], out=[]; if(!p)return out; const mine=pc(p), low=p.toLowerCase(); const add=(rr,cc)=>{if(inside(rr,cc)&&pc(b[rr][cc])!==mine){out.push([rr,cc]);return !b[rr][cc]}return false};
    if(low==="p"){const d=mine==="w"?-1:1,s=mine==="w"?6:1;if(inside(r+d,c)&&!b[r+d][c]){out.push([r+d,c]);if(r===s&&!b[r+2*d][c])out.push([r+2*d,c])}for(const dc of[-1,1])if(inside(r+d,c+dc)&&b[r+d][c+dc]&&pc(b[r+d][c+dc])!==mine)out.push([r+d,c+dc]);}
    if(low==="n")for(const [dr,dc]of[[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]])add(r+dr,c+dc);
    const dirs=low==="b"?[[1,1],[1,-1],[-1,1],[-1,-1]]:low==="r"?[[1,0],[-1,0],[0,1],[0,-1]]:[[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
    if("brq".includes(low))for(const[dr,dc]of dirs)for(let n=1;n<8&&add(r+dr*n,c+dc*n);n++); if(low==="k")for(const[dr,dc]of dirs)add(r+dr,c+dc); return out; }
  function chessAll(color){const a=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(pc(x.state.board[r][c])===color)for(const end of chessMoves(x.state.board,r,c))a.push({start:[r,c],end});return a;}
  function chessClick(r,c){if(x.state.finished||x.state.turn!==x.color&&x.mode==="online"||x.mode==="bot"&&x.state.turn!=="w")return;const p=x.state.board[r][c];if(!x.selected){if(pc(p)===x.state.turn)x.selected=[r,c];return render();}const moves=chessMoves(x.state.board,...x.selected);if(pc(p)===x.state.turn){x.selected=[r,c];return render()}if(!moves.some(m=>m[0]===r&&m[1]===c))return;chessMove(x.selected,[r,c]);}
  async function chessMove([sr,sc],[r,c]){const captured=x.state.board[r][c];let p=x.state.board[sr][sc];x.state.board[sr][sc]=null;if(p==="P"&&r===0)p="Q";if(p==="p"&&r===7)p="q";x.state.board[r][c]=p;x.selected=null;if(captured?.toLowerCase()==="k"){x.state.finished=true;x.state.message=`${pc(p)==="w"?"Белые":"Чёрные"} победили`;}else{x.state.turn=x.state.turn==="w"?"b":"w";x.state.message=`Ход ${x.state.turn==="w"?"белых":"чёрных"}`;}render();if(x.mode==="online")await save();else if(!x.state.finished)setTimeout(chessBot,450);}
  function chessBot(){const moves=chessAll("b");if(!moves.length){x.state.finished=true;x.state.message="Белые победили";return render()}moves.sort((a,b)=>(x.state.board[b.end[0]][b.end[1]]?1:0)-(x.state.board[a.end[0]][a.end[1]]?1:0));const top=moves.filter(m=>!!x.state.board[m.end[0]][m.end[1]]===!!x.state.board[moves[0].end[0]][moves[0].end[1]]);const m=top[Math.floor(Math.random()*top.length)];chessMove(m.start,m.end);}

  // Battleship: automatic legal fleets, alternating shots and a hunt-style bot.
  function makeFleet(){const grid=Array.from({length:10},()=>Array(10).fill(0));for(const size of[4,3,3,2,2,2,1,1,1,1]){let ok=false;while(!ok){const v=Math.random()<.5,r=Math.floor(Math.random()*(10-(v?size:1))),c=Math.floor(Math.random()*(10-(v?1:size)));ok=true;for(let i=0;i<size;i++){const rr=r+(v?i:0),cc=c+(v?0:i);for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++)if(grid[rr+dr]?.[cc+dc])ok=false}if(ok)for(let i=0;i<size;i++)grid[r+(v?i:0)][c+(v?0:i)]=1;}}return grid;}
  function seaState(bot){return {gameType:"sea",whiteFleet:makeFleet(),blackFleet:bot?makeFleet():null,whiteShots:Array.from({length:10},()=>Array(10).fill(0)),blackShots:Array.from({length:10},()=>Array(10).fill(0)),turn:"w",finished:false,message:bot?"Ваш выстрел":"Ожидаем второго игрока",chat:[]};}
  const fleetAlive=f=>f.flat().some(Boolean);
  async function seaShoot(r,c){if(x.state.finished)return;const me=x.color, foe=me==="w"?"black":"white";if(x.state.turn!==me||!x.state[`${foe}Fleet`])return;const shots=x.state[`${me==="w"?"white":"black"}Shots`];if(shots[r][c])return;const hit=!!x.state[`${foe}Fleet`][r][c];shots[r][c]=hit?2:1;if(hit)x.state[`${foe}Fleet`][r][c]=0;if(!fleetAlive(x.state[`${foe}Fleet`])){x.state.finished=true;x.state.message="Победа! Флот уничтожен";}else{x.state.turn=me==="w"?"b":"w";x.state.message=hit?"Попадание! Ход соперника":"Мимо. Ход соперника";}render();if(x.mode==="online")await save();else if(!x.state.finished)setTimeout(seaBot,450);}
  function seaBot(){const shots=x.state.blackShots,free=[];for(let r=0;r<10;r++)for(let c=0;c<10;c++)if(!shots[r][c])free.push([r,c]);const[r,c]=free[Math.floor(Math.random()*free.length)],hit=!!x.state.whiteFleet[r][c];shots[r][c]=hit?2:1;if(hit)x.state.whiteFleet[r][c]=0;if(!fleetAlive(x.state.whiteFleet)){x.state.finished=true;x.state.message="Бот победил";}else{x.state.turn="w";x.state.message=hit?"Бот попал. Ваш ход":"Бот промахнулся. Ваш ход";}render();}

  function render(){if(!x?.state)return;status(x.state.message||"Игра");if(x.type==="chess")renderChess();else renderSea();renderChat();if(x.state.finished&&!resultShown){resultShown=true;showExtraResult();}}
  function showExtraResult(){const msg=x.state.message||"Игра завершена";const won=/Победа|Белые победили/.test(msg)?x.color==="w":/Чёрные победили/.test(msg)?x.color==="b":false;const banner=$("resultBanner");banner.className=`result-banner ${won?"win":"lose"}`;$("resultIcon").textContent=won?"🏆":"🛡️";$("resultKicker").textContent=won?"Отличная партия":"Партия окончена";$("resultTitle").textContent=won?"Победа!":"Поражение";$("resultMessage").textContent=msg;const confetti=$("resultConfetti");confetti.innerHTML="";if(won)for(let i=0;i<28;i++){const bit=document.createElement("i");bit.style.setProperty("--x",`${Math.random()*100}vw`);bit.style.setProperty("--delay",`${Math.random()*.8}s`);bit.style.setProperty("--spin",`${Math.random()*700-350}deg`);confetti.appendChild(bit)}$("resultAgainBtn").onclick=()=>{$("resultBanner").classList.add("hidden");resultShown=false;restart()};$("resultHomeBtn").onclick=()=>{$("resultBanner").classList.add("hidden");home()};}
  function renderChess(){const b=document.createElement("div");b.className="extra-board";const targets=x.selected?chessMoves(x.state.board,...x.selected):[];for(let r=0;r<8;r++)for(let c=0;c<8;c++){const q=document.createElement("button");q.className=`chess-cell ${(r+c)%2?"dark":"light"}`;if(x.selected?.[0]===r&&x.selected[1]===c)q.classList.add("selected");if(targets.some(t=>t[0]===r&&t[1]===c))q.classList.add("target");q.textContent=glyph[x.state.board[r][c]]||"";q.onclick=()=>chessClick(r,c);b.appendChild(q)}$("xBoardHost").replaceChildren(b);}
  function renderSea(){const layout=document.createElement("div");layout.className="sea-layout";layout.append(seaBoard("Ваш флот",x.color==="w"?x.state.whiteFleet:x.state.blackFleet,x.color==="w"?x.state.blackShots:x.state.whiteShots,false),seaBoard("Поле соперника",null,x.color==="w"?x.state.whiteShots:x.state.blackShots,true));$("xBoardHost").replaceChildren(layout);}
  function seaBoard(title,fleet,shots,enemy){const w=document.createElement("div");w.className="sea-board-wrap";w.innerHTML=`<h3>${title}</h3>`;const b=document.createElement("div");b.className="sea-board";for(let r=0;r<10;r++)for(let c=0;c<10;c++){const q=document.createElement("button");q.className="sea-cell";if(fleet?.[r]?.[c])q.classList.add("ship");if(shots?.[r]?.[c]===1)q.classList.add("miss");if(shots?.[r]?.[c]===2)q.classList.add("hit");if(enemy)q.onclick=()=>seaShoot(r,c);b.appendChild(q)}w.appendChild(b);return w;}
  function renderChat(){const chat=x.state.chat||[];$("xChatCount").textContent=chat.length;$("xMessages").innerHTML="";for(const m of chat.slice(-50)){const d=document.createElement("div");d.className=`chat-message${m.playerId===pid?" mine":""}`;const meta=document.createElement("div");meta.className="chat-meta";meta.textContent=m.playerId===pid?"Вы":m.author;const p=document.createElement("p");p.textContent=m.text;d.append(meta,p);$("xMessages").appendChild(d)}}
  async function sendMessage(){if(x?.mode!=="online")return;const text=$("xMessage").value.trim();if(!text)return;$("xMessage").value="";x.state.chat=[...(x.state.chat||[]),{id:`${pid}_${Date.now()}`,playerId:pid,author:name(),text:text.slice(0,240)}].slice(-50);renderChat();await save();}
  async function restart(){if(!x)return;$("resultBanner").classList.add("hidden");resultShown=false;if(x.mode==="bot")return startBot();if(x.color!=="w")return toast("Новую игру создаёт первый игрок");const fresh=x.type==="chess"?chessState():seaState(false);Object.assign(fresh,{gameType:x.type,whiteId:x.state.whiteId,whiteName:x.state.whiteName,blackId:x.state.blackId,blackName:x.state.blackName,chat:x.state.chat||[]});if(x.type==="sea"&&fresh.blackId)fresh.blackFleet=makeFleet();x.state=fresh;await save();render();}
  function status(t){$("xStatus").textContent=t} function toast(t){$("toast").textContent=t;$("toast").classList.remove("hidden");setTimeout(()=>$("toast").classList.add("hidden"),1900)}
})();
