import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CONFIG } from "./config.js";

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);
const $ = s => document.querySelector(s);
const $$ = (s, root=document) => {
  const scope = typeof root === "string" ? document.querySelector(root) : root;
  return scope ? [...scope.querySelectorAll(s)] : [];
};
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => new Intl.NumberFormat("es-BO").format(Number(n || 0));

let state = {
  admin:false, account:null, tournaments:[], participants:[], matches:[], bets:[], rewards:[], rankings:[], cashierTransactions:[], cashierAdditionRequests:[], announcements:[], announcementReplies:[], polls:[], pollOptions:[], pollVotes:[], numberGameSettings:null, numberGameSessions:[], numberGameRounds:[], numberGameBusy:false, numberGameSelectedMargin:5, numberGameTab:"games", mineGameSettings:null, mineGameSession:null, mineGameBusy:false, mineGameLastResult:null, cashierTab:"cash", rewardTab:"available", selectedRewardIds:new Set()
};
let editingAnnouncementId = null;
let pendingPaidReward = null;
let wheelRotation = 0;
let parlayCart = [];
let dailyCountdownTimer = null;

async function sha256(text){
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function randomPassword(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#";
  const a=crypto.getRandomValues(new Uint32Array(10));
  return [...a].map(x=>chars[x%chars.length]).join("");
}
function todayBolivia(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:CONFIG.DAILY_WHEEL_TIMEZONE,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
function expected(a,b){ return 1/(1+10**((b-a)/400)); }
function oddsFromElo(a,b){
  const pa=Math.max(.08,Math.min(.92,expected(a,b)));
  const margin=.90;
  return {a:+(margin/pa).toFixed(2), b:+(margin/(1-pa)).toFixed(2)};
}
function scoreOdds(eloA,eloB,a,b){
  const expectedDiff=(eloA-eloB)/180;
  return +(2.7+Math.abs((a-b)-expectedDiff)*.75+Math.abs((a+b)-6)*.16).toFixed(2);
}
function participantName(id){ return state.participants.find(p=>p.id===id)?.display_name || "—"; }
function accountParticipatesInMatch(match,account=state.account){
  if(!match||!account)return false;
  return [match.side_a,match.side_b].some(participantId=>{
    const participant=state.participants.find(p=>p.id===participantId);
    const members=Array.isArray(participant?.members)?participant.members:[];
    return members.some(member=>member?.type==="account"&&member?.id===account.id);
  });
}
function rankingFor(name){ return state.rankings.find(r=>r.name.toLowerCase()===String(name).toLowerCase()) || {elo:1000,wins:0,losses:0,kos_for:0,kos_against:0}; }

async function removeExpiredRewards(){
  const cutoff=new Date(Date.now()-7*24*60*60*1000).toISOString();
  const {error}=await supabase.from("rewards").delete().eq("status","available").lt("created_at",cutoff);
  if(error)console.error("No se pudieron eliminar recompensas vencidas:",error);
}

async function loadAll(){
  await removeExpiredRewards();
  const [accounts,tournaments,participants,matches,bets,rewards,rankings,cashierTransactions,cashierAdditionRequests,announcements,announcementReplies,polls,pollOptions,pollVotes,numberGameSettings,numberGameSessions,numberGameRounds,mineGameSettings,mineGameSession] = await Promise.all([
    supabase.from("accounts").select("*").order("credits",{ascending:false}),
    supabase.from("tournaments").select("*").order("created_at",{ascending:false}),
    supabase.from("tournament_participants").select("*"),
    supabase.from("matches").select("*").order("created_at"),
    supabase.from("bets").select("*").order("created_at",{ascending:false}),
    supabase.from("rewards").select("*").order("created_at",{ascending:false}),
    supabase.from("rankings").select("*").order("elo",{ascending:false}),
    supabase.from("cashier_transactions").select("*").order("created_at",{ascending:false}),
    supabase.from("cashier_addition_requests").select("*").order("created_at",{ascending:false}),
    supabase.from("announcements").select("*").order("created_at",{ascending:false}),
    supabase.from("announcement_replies").select("*").order("created_at"),
    supabase.from("polls").select("*").order("created_at",{ascending:false}),
    supabase.from("poll_options").select("*").order("sort_order"),
    supabase.from("poll_votes").select("*"),
    supabase.from("number_game_settings").select("*").eq("id",true).maybeSingle(),
    supabase.from("number_game_sessions").select("*").order("updated_at",{ascending:false}),
    supabase.from("number_game_rounds").select("*").order("created_at",{ascending:false}).limit(15),
    supabase.from("mine_game_settings").select("*").eq("id",true).maybeSingle(),
    state.account ? supabase.rpc("mine_game_get_state",{p_account_id:state.account.id}) : Promise.resolve({data:null,error:null})
  ]);
  for(const result of [accounts,tournaments,participants,matches,bets,rewards,rankings,cashierTransactions,cashierAdditionRequests,announcements,announcementReplies,polls,pollOptions,pollVotes,numberGameSettings,numberGameSessions,numberGameRounds,mineGameSettings,mineGameSession]){
    if(result.error) console.error(result.error);
  }
  state.accounts=accounts.data||[];
  state.tournaments=tournaments.data||[];
  state.participants=participants.data||[];
  state.matches=matches.data||[];
  state.bets=bets.data||[];
  state.rewards=rewards.data||[];
  state.rankings=rankings.data||[];
  state.cashierTransactions=cashierTransactions.data||[];
  state.cashierAdditionRequests=cashierAdditionRequests.data||[];
  state.announcements=announcements.data||[];
  state.announcementReplies=announcementReplies.data||[];
  state.polls=polls.data||[];
  state.pollOptions=pollOptions.data||[];
  state.pollVotes=pollVotes.data||[];
  state.numberGameSettings=numberGameSettings.data||null;
  state.numberGameSessions=numberGameSessions.data||[];
  state.numberGameRounds=numberGameRounds.data||[];
  state.mineGameSettings=mineGameSettings.data||null;
  state.mineGameSession=mineGameSession.data||null;
  if(state.account) state.account=state.accounts.find(a=>a.id===state.account.id)||null;
  renderAll();
}
function renderAll(){
  document.body.classList.toggle("admin",state.admin);

  // Accesos separados para administrador y cajero.
  $$(".admin-only").forEach(el=>el.hidden=!state.admin);
  const cashierAllowed=!!(state.admin||state.account?.is_cashier);
  $$(".cashier-access").forEach(el=>el.hidden=!cashierAllowed);
  const activeView=$(".view.active");
  if((activeView?.classList.contains("admin-only")&&!state.admin)||(activeView?.classList.contains("cashier-access")&&!cashierAllowed)) switchView("home");

  $("#sessionLabel").textContent=state.account?state.account.username:"Sin sesión";
  $("#walletLabel").textContent=state.account?`💰 ${money(state.account.credits)}`:"💰 —";
  $("#loginButton").hidden=!!state.account; $("#logoutButton").hidden=!state.account;
  renderLeaderboard(); renderCommunityFeed(); renderCommunityNotificationBadge(); if($("#view-home")?.classList.contains("active"))markCommunityNotificationsSeen(); renderActiveEvents(); renderTournamentSelects(); renderBetMatches(); renderBetTournamentStandings(); renderBetStandings();
  renderMyBets(); renderGeneralStats(); renderResults(); renderAccountsAdmin();
  renderCreditsAdmin(); renderTournamentsAdmin(); renderIndividualEventsAdmin(); renderRewards(); // ============================================================
// v27 · Minijuego Adivina el número
// ============================================================
const NG_MARGIN_LABEL={5:"±5",2:"±2",1:"±1",0:"Exacto"};
function ngSettings(){
  return state.numberGameSettings||{enabled:false,min_stake:50,max_stake:1000,max_prize:25000,max_rounds:3,animation_ms:3000,multipliers:{100:{5:1.2,2:1.35,1:1.55,0:1.9},1000:{5:1.5,2:2,1:3,0:5}},round_options:{1:[5,2,1,0],2:[2,1,0],3:[0]}};
}
function ngActiveSession(){return state.account?state.numberGameSessions.find(x=>x.account_id===state.account.id&&x.status==="active"):null}
function ngAllowed(round){return (ngSettings().round_options?.[String(round)]||[]).map(Number)}
function ngMultiplier(range,margin){return Number(ngSettings().multipliers?.[String(range)]?.[String(margin)]||0)}
function ngProbability(range,number,margin){const low=Math.max(1,number-margin),high=Math.min(range,number+margin);return ((high-low+1)/range)*100}
function ngCurrentRound(){return ngActiveSession()?ngActiveSession().current_round+1:1}
function ngUuid(){return crypto.randomUUID()}
function renderNumberGame(){
  const root=$("#view-minigames");if(!root)return;
  const cfg=ngSettings(),session=ngActiveSession(),round=ngCurrentRound(),logged=!!state.account;
  $("#numberGameBalance").textContent=logged?`💰 ${money(state.account.credits)} créditos`:"💰 Inicia sesión";
  $("#numberGameDisabled").hidden=cfg.enabled;
  const notice=$("#numberGameActiveNotice");
  notice.hidden=!session;
  if(session)notice.innerHTML=`<strong>Partida activa recuperada</strong><div>Ronda superada: ${session.current_round} · Premio acumulado: ${money(session.accumulated)} créditos. Puedes cobrarlo o arriesgarlo en la ronda ${round}.</div>`;
  const range=Number($("#numberGameRange")?.value||session?.range_max||100);
  if(session){$("#numberGameRange").value=String(session.range_max);$("#numberGameRange").disabled=true}else $("#numberGameRange").disabled=false;
  const actualRange=session?.range_max||range;
  const numberInput=$("#numberGameChoice");numberInput.max=String(actualRange);numberInput.min="1";
  if(Number(numberInput.value)>actualRange)numberInput.value=Math.ceil(actualRange/2);
  const allowed=ngAllowed(round);
  if(!allowed.includes(Number(state.numberGameSelectedMargin)))state.numberGameSelectedMargin=allowed[0]??0;
  $("#numberGameMargins").innerHTML=[5,2,1,0].map(m=>`<button type="button" class="margin-choice ${Number(state.numberGameSelectedMargin)===m?'active':''}" data-ng-margin="${m}" ${allowed.includes(m)?'':'disabled'}>${NG_MARGIN_LABEL[m]}</button>`).join("");
  $$('[data-ng-margin]').forEach(b=>b.onclick=()=>{state.numberGameSelectedMargin=Number(b.dataset.ngMargin);renderNumberGame()});
  const stakeInput=$("#numberGameStake");
  stakeInput.disabled=!!session;stakeInput.min=cfg.min_stake;stakeInput.max=cfg.max_stake;
  if(session)stakeInput.value=session.accumulated;
  $("#numberGameStakeLabel").textContent=session?"Premio acumulado que se arriesgará":"Créditos a apostar";
  const chosen=Math.max(1,Math.min(actualRange,Number(numberInput.value)||1));
  const stake=session?.accumulated||Math.max(0,Number(stakeInput.value)||0),margin=Number(state.numberGameSelectedMargin),mult=ngMultiplier(actualRange,margin);
  const raw=Math.floor(stake*mult),prize=Math.min(cfg.max_prize,raw),net=prize-stake;
  $("#numberGamePreview").innerHTML=`
    <div class="mini-stat">Ronda<strong>${round} / ${cfg.max_rounds}</strong></div>
    <div class="mini-stat">Rango<strong>1–${actualRange}</strong></div>
    <div class="mini-stat">Multiplicador<strong>x${mult.toFixed(2)}</strong></div>
    <div class="mini-stat">Apuesta<strong>${money(stake)}</strong></div>
    <div class="mini-stat">Premio posible<strong>${money(prize)}${raw>cfg.max_prize?' (limitado)':''}</strong></div>
    <div class="mini-stat">Ganancia neta<strong>${money(net)}</strong></div>
    <div class="mini-stat">Premio acumulado<strong>${money(session?.accumulated||0)}</strong></div>`;
  const play=$("#numberGamePlay");
  play.textContent=session?`Confirmar continuación · ronda ${round}`:"Jugar";
  play.disabled=state.numberGameBusy||!logged||!cfg.enabled||round>cfg.max_rounds;
  $("#numberGameDecision").hidden=!session;
  renderNumberGameTabs();renderNumberGameAdmin();renderMineGameAdmin();
}
function renderNumberGameTabs(){
  const games=$("#numberGameGamesTab"),settings=$("#numberGameSettingsTab");
  if(!games||!settings)return;
  if(!state.admin)state.numberGameTab="games";
  const showSettings=state.admin&&state.numberGameTab==="settings";
  games.hidden=showSettings;settings.hidden=!showSettings;
  $$('[data-minigame-tab]').forEach(button=>{
    const active=button.dataset.minigameTab===state.numberGameTab;
    button.classList.toggle("active",active);
    button.classList.toggle("secondary",!active);
  });
}
function renderNumberGameAdmin(){
  const box=$("#numberGameAdmin");if(!box||!state.admin)return;
  const c=ngSettings(),m=c.multipliers||{},ro=c.round_options||{};
  box.innerHTML=`<div class="number-game-admin-grid">
    <label class="card"><input id="ngaEnabled" type="checkbox" ${c.enabled?'checked':''}> Minijuego activo</label>
    <div><label>Apuesta mínima</label><input id="ngaMin" type="number" value="${c.min_stake}"></div><div><label>Apuesta máxima</label><input id="ngaMax" type="number" value="${c.max_stake}"></div>
    <div><label>Premio máximo</label><input id="ngaPrize" type="number" value="${c.max_prize}"></div><div><label>Máximo de rondas</label><input id="ngaRounds" type="number" min="1" max="10" value="${c.max_rounds}"></div><div><label>Animación (ms)</label><input id="ngaAnimation" type="number" value="${c.animation_ms}"></div>
  </div><h3>Multiplicadores</h3><div style="overflow-x:auto"><table class="number-game-admin-table"><thead><tr><th>Rango</th><th>±5</th><th>±2</th><th>±1</th><th>Exacto</th></tr></thead><tbody>${[100,1000].map(r=>`<tr><td>1–${r}</td>${[5,2,1,0].map(x=>`<td><input data-nga-mult="${r}-${x}" type="number" step="0.01" value="${Number(m?.[r]?.[x]||0)}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>
  <h3>Opciones permitidas por ronda</h3><div class="grid">${Array.from({length:Number(c.max_rounds)},(_,i)=>i+1).map(r=>`<div class="card"><strong>Ronda ${r}</strong><div class="margin-options">${[5,2,1,0].map(x=>`<label><input type="checkbox" data-nga-round="${r}-${x}" ${(ro?.[r]||[]).map(Number).includes(x)?'checked':''}> ${NG_MARGIN_LABEL[x]}</label>`).join('')}</div></div>`).join('')}</div>
  <button id="ngaSave" style="margin-top:14px">Guardar configuración</button>`;
  $("#ngaSave").onclick=()=>saveNumberGameAdmin(false);
  $("#ngaEnabled").onchange=()=>saveNumberGameAdmin(true);
}
async function saveNumberGameAdmin(silent=false){
  const rounds=Number($("#ngaRounds").value),multipliers={100:{},1000:{}},round_options={};
  for(const r of [100,1000])for(const m of [5,2,1,0])multipliers[r][m]=Number($(`[data-nga-mult="${r}-${m}"]`).value);
  for(let r=1;r<=rounds;r++)round_options[r]=[5,2,1,0].filter(m=>$(`[data-nga-round="${r}-${m}"]`)?.checked);
  if(Object.values(round_options).some(a=>!a.length))return alert("Cada ronda debe permitir al menos un margen.");
  const config={enabled:$("#ngaEnabled").checked,min_stake:Number($("#ngaMin").value),max_stake:Number($("#ngaMax").value),max_prize:Number($("#ngaPrize").value),max_rounds:rounds,animation_ms:Number($("#ngaAnimation").value),multipliers,round_options};
  const {data,error}=await supabase.rpc("number_game_admin_update",{p_admin_code:CONFIG.ADMIN_CODE,p_config:config});
  if(error){ renderNumberGame(); return alert(error.message); }
  if(data) state.numberGameSettings=data;
  renderNumberGame();
  await refreshNumberGameData();
  if(!silent) alert("Configuración guardada.");
}
async function refreshNumberGameData(){
  const [s,se,r,a]=await Promise.all([supabase.from('number_game_settings').select('*').eq('id',true).maybeSingle(),supabase.from('number_game_sessions').select('*').order('updated_at',{ascending:false}),supabase.from('number_game_rounds').select('*').order('created_at',{ascending:false}).limit(15),state.account?supabase.from('accounts').select('*').eq('id',state.account.id).maybeSingle():Promise.resolve({data:null})]);
  state.numberGameSettings=s.data||state.numberGameSettings;state.numberGameSessions=se.data||[];state.numberGameRounds=r.data||[];if(a.data)state.account=a.data;renderAll();
}
async function ngAnimate(result,ms){
  state.numberGameBusy=true;renderNumberGame();const machine=$("#numberGameMachine"),range=result.range;const start=Date.now();
  await new Promise(resolve=>{const timer=setInterval(()=>{machine.textContent=1+Math.floor(Math.random()*range);if(Date.now()-start>=ms){clearInterval(timer);machine.textContent=result.result;resolve()}},70)});
  state.numberGameBusy=false;
}
function ngShowResult(r){
  const low=Math.max(1,r.chosen-r.margin),high=Math.min(r.range,r.chosen+r.margin),interval=r.margin===0?String(r.chosen):`${low}–${high}`;
  const el=$("#numberGameResult");el.className=`number-game-result ${r.won?'win':'lose'}`;
  el.innerHTML=`<strong>${r.won?'¡Ganaste!':'Perdiste'}</strong><br>Número elegido: ${r.chosen}<br>Intervalo ganador: ${interval}<br>Número obtenido: ${r.result}<br>Multiplicador: x${Number(r.multiplier).toFixed(2)}<br>Premio acumulado: ${money(r.prize)} créditos${r.auto_cashed?'<br><strong>Premio cobrado automáticamente.</strong>':''}`;
}
async function playNumberGame(){
  if(!state.account)return alert("Debes iniciar sesión.");
  const cfg=ngSettings(),session=ngActiveSession(),range=session?.range_max||Number($("#numberGameRange").value),chosen=Number($("#numberGameChoice").value),margin=Number(state.numberGameSelectedMargin),stake=Number($("#numberGameStake").value);
  if(chosen<1||chosen>range)return alert("El número elegido está fuera del rango.");
  if(!session&&(stake<cfg.min_stake||stake>cfg.max_stake))return alert(`La apuesta debe estar entre ${cfg.min_stake} y ${cfg.max_stake} créditos.`);
  if(session){
    const mult=ngMultiplier(range,margin),potential=Math.min(cfg.max_prize,Math.floor(session.accumulated*mult));
    const summary=`Ronda ${session.current_round+1}\nNúmero: ${chosen}\nRango: 1–${range}\nMargen: ${NG_MARGIN_LABEL[margin]}\nPremio arriesgado: ${session.accumulated}\nMultiplicador: x${mult.toFixed(2)}\nPremio si ganas: ${potential}`;
    if(!confirm(summary))return;
    if(!confirm("Estás a punto de arriesgar todo tu premio acumulado. Si pierdes, recibirás 0 créditos. ¿Deseas continuar?"))return;
  }
  state.numberGameBusy=true;renderNumberGame();
  const call=session?supabase.rpc('number_game_continue',{p_account_id:state.account.id,p_session_id:session.id,p_number:chosen,p_margin:margin,p_request_id:ngUuid()}):supabase.rpc('number_game_start',{p_account_id:state.account.id,p_range:range,p_number:chosen,p_margin:margin,p_stake:stake,p_request_id:ngUuid()});
  const {data,error}=await call;if(error){state.numberGameBusy=false;renderNumberGame();return alert(error.message)}
  await ngAnimate(data,Number(cfg.animation_ms)||3000);ngShowResult(data);await refreshNumberGameData();
}
async function cashNumberGame(){
  const s=ngActiveSession();if(!s)return;
  if(!confirm(`¿Cobrar ${money(s.accumulated)} créditos y terminar la partida?`))return;
  state.numberGameBusy=true;renderNumberGame();const {data,error}=await supabase.rpc('number_game_cashout',{p_account_id:state.account.id,p_session_id:s.id});state.numberGameBusy=false;
  if(error)return alert(error.message);alert(`Cobraste ${money(data.prize)} créditos.`);await refreshNumberGameData();
}
$("#numberGamePlay").onclick=playNumberGame;
$("#numberGameCash").onclick=cashNumberGame;
$("#numberGamePrepareContinue").onclick=()=>$("#numberGamePlay").scrollIntoView({behavior:'smooth',block:'center'});
$$('[data-minigame-tab]').forEach(button=>button.addEventListener('click',()=>{
  if(!state.admin)return;
  state.numberGameTab=button.dataset.minigameTab;
  renderNumberGame();
}));

for(const id of ["numberGameRange","numberGameChoice","numberGameStake"])$("#"+id).addEventListener(id==="numberGameRange"?"change":"input",()=>{if(id==="numberGameRange"){$("#numberGameChoice").max=$("#numberGameRange").value}renderNumberGame()});

// ============================================================
// v30 · Minijuego Campo Minado
// ============================================================
function mgSettings(){return state.mineGameSettings||{enabled:false,min_stake:50,max_stake:1000,max_prize:25000}}
function mgSession(){return state.mineGameSession&&state.mineGameSession.status==="active"?state.mineGameSession:null}
function mgMines(level){return Math.min(35,Math.max(5,Number(level||1)*5))}
function mgRequired(level){return Math.min(3,36-mgMines(level))}
async function refreshMineGameData(){
  const [s,g,a]=await Promise.all([
    supabase.from('mine_game_settings').select('*').eq('id',true).maybeSingle(),
    state.account?supabase.rpc('mine_game_get_state',{p_account_id:state.account.id}):Promise.resolve({data:null}),
    state.account?supabase.from('accounts').select('*').eq('id',state.account.id).maybeSingle():Promise.resolve({data:null})
  ]);
  if(s.data)state.mineGameSettings=s.data;
  state.mineGameSession=g.data||null;
  if(a.data)state.account=a.data;
  renderAll();
}
function renderMineGame(){
  const board=$('#mineGameBoard');if(!board)return;
  const cfg=mgSettings(),s=mgSession(),logged=!!state.account;
  $('#mineGameBalance').textContent=logged?`💰 ${money(state.account.credits)} créditos`:'💰 Inicia sesión';
  $('#mineGameDisabled').hidden=cfg.enabled;
  const stake=$('#mineGameStake');stake.min=cfg.min_stake;stake.max=cfg.max_stake;stake.disabled=!!s||state.mineGameBusy;
  $('#mineGameStart').disabled=!logged||!cfg.enabled||!!s||state.mineGameBusy;
  $('#mineGameStartBox').hidden=!!s;
  const level=Number(s?.level||1),safe=Number(s?.safe_picks||0),required=mgRequired(level),prize=Number(s?.accumulated||0);
  $('#mineGameInfo').innerHTML=`<div class="mini-stat">Nivel<strong>${level} / 7</strong></div><div class="mini-stat">Minas<strong>${mgMines(level)} / 36</strong></div><div class="mini-stat">Casillas seguras<strong>${safe} / ${required}</strong></div><div class="mini-stat">Premio acumulado<strong>${money(prize)}</strong></div>`;
  const status=$('#mineGameStatus');
  status.innerHTML=s?`<strong>Partida activa</strong><div>Nivel ${level}: encuentra ${required-safe} casilla${required-safe===1?'':'s'} segura${required-safe===1?'':'s'} para completarlo.</div>`:`<strong>Campo Minado</strong><div>Apuesta créditos y selecciona casillas. Cada nivel crea un tablero nuevo.</div>`;
  const hitMine=Number(s?.hit_mine_cell??state.mineGameLastResult?.hit_mine_cell??-1);
  const revealed=new Set((s?.revealed_cells||[]).map(Number));if(hitMine>=0)revealed.add(hitMine);
  const safeCells=new Set((s?.safe_cells||[]).map(Number));
  board.innerHTML=Array.from({length:36},(_,i)=>{
    const open=revealed.has(i),mine=i===hitMine,good=open&&safeCells.has(i);
    return `<button type="button" class="mine-cell ${open?'revealed':''} ${mine?'mine-hit':''} ${good?'safe-hit':''}" data-mine-cell="${i}" ${!s||open||state.mineGameBusy?'disabled':''} aria-label="Casilla ${i+1}">${mine?'💣':good?'✓':''}</button>`;
  }).join('');
  $$('[data-mine-cell]',board).forEach(b=>b.onclick=()=>revealMineCell(Number(b.dataset.mineCell)));
  const completed=!!s?.level_complete;
  $('#mineGameDecision').hidden=!completed;
  $('#mineGameCash').disabled=state.mineGameBusy;
  $('#mineGameContinue').disabled=state.mineGameBusy||level>=7;
  $('#mineGameContinue').textContent=level>=7?'Premio entregado':'Continuar al siguiente nivel';
  const message=$('#mineGameMessage');
  if(state.mineGameLastResult){
    const r=state.mineGameLastResult;
    message.className=`mine-message ${r.hit_mine?'lose':'win'}`;
    message.innerHTML=r.hit_mine?`<strong>¡Mina!</strong> Perdiste la apuesta y el premio acumulado.`:`<strong>Casilla segura.</strong> ${r.multiplier>1?`Multiplicador x${Number(r.multiplier).toFixed(2)}. `:''}Premio: ${money(r.prize)} créditos.${r.auto_cashed?' Cobrado automáticamente.':''}`;
  }else{
    message.className='mine-message muted';
    message.textContent=s?'Selecciona una casilla cerrada.':'Inicia una partida para generar el tablero.';
  }
}
async function startMineGame(){
  if(!state.account)return alert('Debes iniciar sesión.');
  const cfg=mgSettings(),stake=Number($('#mineGameStake').value);
  if(stake<cfg.min_stake||stake>cfg.max_stake)return alert(`La apuesta debe estar entre ${cfg.min_stake} y ${cfg.max_stake} créditos.`);
  state.mineGameBusy=true;state.mineGameLastResult=null;renderMineGame();
  const {data,error}=await supabase.rpc('mine_game_start',{p_account_id:state.account.id,p_stake:stake,p_request_id:crypto.randomUUID()});
  state.mineGameBusy=false;
  if(error){renderMineGame();return alert(error.message)}
  state.mineGameSession=data;await refreshMineGameData();
}
async function revealMineCell(cell){
  const s=mgSession();if(!s||state.mineGameBusy)return;
  state.mineGameBusy=true;renderMineGame();
  const {data,error}=await supabase.rpc('mine_game_reveal',{p_account_id:state.account.id,p_session_id:s.id,p_cell:cell,p_request_id:crypto.randomUUID()});
  state.mineGameBusy=false;
  if(error){renderMineGame();return alert(error.message)}
  state.mineGameLastResult=data;
  state.mineGameSession=data.state||null;
  await refreshMineGameData();
}
async function cashMineGame(){
  const s=mgSession();if(!s)return;
  state.mineGameBusy=true;renderMineGame();
  const {data,error}=await supabase.rpc('mine_game_cashout',{p_account_id:state.account.id,p_session_id:s.id});
  state.mineGameBusy=false;
  if(error)return alert(error.message);
  state.mineGameLastResult={hit_mine:false,multiplier:1,prize:data.prize,auto_cashed:true};
  alert(`Cobraste ${money(data.prize)} créditos.`);await refreshMineGameData();
}
async function continueMineGame(){
  const s=mgSession();if(!s||!s.level_complete)return;
  state.mineGameBusy=true;state.mineGameLastResult=null;renderMineGame();
  const {data,error}=await supabase.rpc('mine_game_continue',{p_account_id:state.account.id,p_session_id:s.id});
  state.mineGameBusy=false;
  if(error)return alert(error.message);
  state.mineGameSession=data;await refreshMineGameData();
}
function renderMineGameAdmin(){
  const box=$('#mineGameAdmin');if(!box||!state.admin)return;
  const c=mgSettings();
  box.innerHTML=`<div class="number-game-admin-grid"><label class="card"><input id="mgaEnabled" type="checkbox" ${c.enabled?'checked':''}> Minijuego activo</label><div><label>Apuesta mínima</label><input id="mgaMin" type="number" min="1" value="${c.min_stake}"></div><div><label>Apuesta máxima</label><input id="mgaMax" type="number" min="1" value="${c.max_stake}"></div><div><label>Premio máximo</label><input id="mgaPrize" type="number" min="1" value="${c.max_prize}"></div></div><p class="muted">El tablero siempre es de 6×6, tiene 7 niveles y suma 5 minas por nivel. Los niveles 1–6 usan multiplicadores aleatorios por casilla entre x1.05 y x1.10; al completar el nivel 7 se aplica x2.00 y se cobra automáticamente.</p><button id="mgaSave" style="margin-top:12px">Guardar configuración</button>`;
  $('#mgaSave').onclick=()=>saveMineGameAdmin(false);
  $('#mgaEnabled').onchange=()=>saveMineGameAdmin(true);
}
async function saveMineGameAdmin(silent=false){
  const config={enabled:$('#mgaEnabled').checked,min_stake:Number($('#mgaMin').value),max_stake:Number($('#mgaMax').value),max_prize:Number($('#mgaPrize').value)};
  const {data,error}=await supabase.rpc('mine_game_admin_update',{p_admin_code:CONFIG.ADMIN_CODE,p_config:config});
  if(error){renderMineGame();return alert(error.message)}
  if(data)state.mineGameSettings=data;
  renderMineGame();renderMineGameAdmin();
  if(!silent)alert('Configuración de Campo Minado guardada.');
}
$('#mineGameStart').onclick=startMineGame;
$('#mineGameCash').onclick=cashMineGame;
$('#mineGameContinue').onclick=continueMineGame;

if($('#pokemonGenerationSearch'))$('#pokemonGenerationSearch').oninput=renderPokemonGenerationSearch;

renderWeeklyDailyPrizes(); updateDailyButton(); renderNumberGame(); renderMineGame();
}
function communityNotificationOwner(){
  return state.account?.id||"guest";
}
function communityNotificationKey(){
  return `liga_community_seen_${communityNotificationOwner()}`;
}
function latestCommunityTimestamp(){
  return [...state.announcements,...state.polls].reduce((latest,item)=>{
    const value=Date.parse(item.created_at||0)||0;
    return Math.max(latest,value);
  },0);
}
function communityUnreadCount(){
  const items=[...state.announcements,...state.polls];
  if(!items.length)return 0;
  const key=communityNotificationKey();
  const stored=localStorage.getItem(key);
  const latest=latestCommunityTimestamp();
  if(stored===null){
    localStorage.setItem(key,String(latest));
    return 0;
  }
  const seen=Number(stored)||0;
  return items.filter(item=>(Date.parse(item.created_at||0)||0)>seen).length;
}
function renderCommunityNotificationBadge(){
  const badge=$("#homeNotificationBadge");
  if(!badge)return;
  const count=communityUnreadCount();
  badge.textContent=count>99?"99+":String(count);
  badge.hidden=count===0;
  badge.setAttribute("aria-label",`${count} notificación${count===1?"":"es"} nueva${count===1?"":"s"}`);
}
function markCommunityNotificationsSeen(){
  localStorage.setItem(communityNotificationKey(),String(latestCommunityTimestamp()));
  renderCommunityNotificationBadge();
}

function switchView(view){
  const target=$(`#view-${view}`);
  if(!target || (target.classList.contains("admin-only")&&!state.admin) || (target.classList.contains("cashier-access")&&!(state.admin||state.account?.is_cashier))) view="home";

  $$(".view").forEach(section=>{
    const isActive=section.id===`view-${view}`;
    section.classList.toggle("active",isActive);
    section.setAttribute("aria-hidden",String(!isActive));
  });
  $$("#nav button").forEach(button=>{
    const isActive=button.dataset.view===view;
    button.classList.toggle("active",isActive);
    button.setAttribute("aria-current",isActive?"page":"false");
  });
  if(view==="home")markCommunityNotificationsSeen();
  window.scrollTo({top:0,behavior:"smooth"});
}
$("#nav").addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(b)switchView(b.dataset.view)});

function modal(id,open=true){ $(id).classList.toggle("open",open); }
$$("[data-close-modal]").forEach(b=>b.onclick=()=>b.closest(".modal").classList.remove("open"));
$("#openAnnouncementCreator").onclick=()=>{
  if(!state.admin)return;
  editingAnnouncementId=null;
  $("#announcementTitle").value="";
  $("#announcementBody").value="";
  $("#announcementReplies").checked=false;
  $("#announcementModal h2").textContent="Crear nuevo comunicado";
  $("#createAnnouncement").textContent="Publicar comunicado";
  modal("#announcementModal");
};
$("#openPollCreator").onclick=()=>{if(state.admin){resetPollOptionEditor();modal("#pollModal")}};
$("#addPollOption").onclick=()=>addPollOptionField();
$("#createAnnouncement").onclick=async()=>{
  if(!state.admin)return;
  const title=$("#announcementTitle").value.trim();
  const body=$("#announcementBody").value.trim();
  if(!title||!body){alert("Completa el título y el texto.");return}
  const values={title,body,allow_replies:$("#announcementReplies").checked};
  const query=editingAnnouncementId
    ? supabase.from("announcements").update(values).eq("id",editingAnnouncementId)
    : supabase.from("announcements").insert({...values,created_by:state.account?.id||null});
  const {error}=await query;
  if(error){alert(error.message);return}
  editingAnnouncementId=null;
  $("#announcementTitle").value="";
  $("#announcementBody").value="";
  $("#announcementReplies").checked=false;
  $("#announcementModal h2").textContent="Crear nuevo comunicado";
  $("#createAnnouncement").textContent="Publicar comunicado";
  modal("#announcementModal",false);
  await loadAll();
};
$("#createPoll").onclick=async()=>{if(!state.admin)return;const question=$("#pollQuestion").value.trim(),labels=$$(".poll-option-input").map(x=>x.value.trim()).filter(Boolean);if(!question||labels.length<2){alert("Escribe la pregunta y al menos 2 opciones.");return}const {data:poll,error}=await supabase.from("polls").insert({question,created_by:state.account?.id||null}).select("*").single();if(error){alert(error.message);return}const {error:optionsError}=await supabase.from("poll_options").insert(labels.map((label,i)=>({poll_id:poll.id,label,sort_order:i})));if(optionsError){await supabase.from("polls").delete().eq("id",poll.id);alert(optionsError.message);return}$("#pollQuestion").value="";modal("#pollModal",false);await loadAll()};
$("#loginButton").onclick=()=>modal("#loginModal");
$("#logoutButton").onclick=()=>{state.account=null;localStorage.removeItem("liga_account");renderAll()};
$("#adminButton").onclick=()=>{
  if(state.admin){state.admin=false;renderAll();return}
  const code=prompt("Código de organizador:");
  if(code===CONFIG.ADMIN_CODE){state.admin=true;renderAll()}else alert("Código incorrecto.");
};
$("#confirmLogin").onclick=async()=>{
  const username=$("#loginUsername").value.trim(), password=$("#loginPassword").value;
  const hash=await sha256(password);
  const {data,error}=await supabase.from("accounts").select("*").ilike("username",username).maybeSingle();
  if(error||!data||data.password_hash!==hash){alert("Cuenta o contraseña incorrecta.");return}
  state.account=data;localStorage.setItem("liga_account",data.id);modal("#loginModal",false);await loadAll();
};

function communityAuthor(accountId){ return state.accounts.find(a=>a.id===accountId)?.username||"Usuario"; }
function communityDate(value){ return value?new Intl.DateTimeFormat("es-BO",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)):""; }
function renderCommunityFeed(){
  const root=$("#communityFeed");if(!root)return;
  const items=[...state.announcements.map(x=>({...x,communityType:"announcement"})),...state.polls.map(x=>({...x,communityType:"poll"}))].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  root.innerHTML=items.map(item=>{
    if(item.communityType==="announcement"){
      const replies=state.announcementReplies.filter(r=>r.announcement_id===item.id);
      const replyBox=item.allow_replies?`<div class="community-replies">${replies.map(r=>`<div class="community-reply"><strong>${esc(communityAuthor(r.account_id))}</strong><span>${esc(r.body)}</span><small>${esc(communityDate(r.created_at))}${r.edited_at?' · Editada':''}</small>${state.account?.id===r.account_id&&!r.edited_once?`<button class="secondary" data-edit-reply="${r.id}">Editar respuesta</button>`:''}</div>`).join("")||'<div class="muted">Todavía no hay respuestas.</div>'}${state.account?`<div class="community-reply-form"><input data-reply-input="${item.id}" maxlength="1000" placeholder="Escribe una respuesta"><button data-send-reply="${item.id}">Responder</button></div>`:'<div class="muted">Inicia sesión para responder.</div>'}</div>`:'<div class="muted">Las respuestas están deshabilitadas.</div>';
      return `<article class="card community-card"><div class="community-type">📢 Comunicado</div><h3>${esc(item.title)}</h3><div class="community-body">${esc(item.body).replace(/\n/g,"<br>")}</div><div class="muted">${esc(communityDate(item.created_at))}</div>${replyBox}${state.admin?`<div class="row community-admin-actions"><button class="secondary" data-edit-announcement="${item.id}">Editar</button><button class="danger community-delete" data-delete-announcement="${item.id}">Eliminar</button></div>`:""}</article>`;
    }
    const options=state.pollOptions.filter(o=>o.poll_id===item.id),votes=state.pollVotes.filter(v=>v.poll_id===item.id),total=votes.length,mine=state.account?votes.find(v=>v.account_id===state.account.id):null;
    return `<article class="card community-card"><div class="community-type">📊 Encuesta</div><h3>${esc(item.question)}</h3><div class="poll-options">${options.map(o=>{const count=votes.filter(v=>v.option_id===o.id).length,pct=total?Math.round(count*100/total):0;return `<button class="poll-option ${mine?.option_id===o.id?'selected':''}" data-vote-option="${o.id}" data-poll-id="${item.id}" ${!state.account?'disabled':''}><span>${esc(o.label)}</span><strong>${pct}%</strong><div class="poll-bar"><i style="width:${pct}%"></i></div><small>${count} voto${count===1?'':'s'}</small></button>`}).join("")}</div><div class="muted">${total} voto${total===1?'':'s'} · ${esc(communityDate(item.created_at))}${!state.account?' · Inicia sesión para votar.':''}</div>${state.admin?`<button class="danger community-delete" data-delete-poll="${item.id}">Eliminar</button>`:""}</article>`;
  }).join("")||'<div class="muted">Todavía no hay comunicados ni encuestas.</div>';
  $$('[data-send-reply]').forEach(b=>b.onclick=async()=>{const input=$(`[data-reply-input="${b.dataset.sendReply}"]`),body=input?.value.trim();if(!state.account||!body)return;const {error}=await supabase.from('announcement_replies').insert({announcement_id:b.dataset.sendReply,account_id:state.account.id,body});if(error)alert(error.message);else await loadAll()});
  $$('[data-vote-option]').forEach(b=>b.onclick=async()=>{if(!state.account)return;const {error}=await supabase.from('poll_votes').upsert({poll_id:b.dataset.pollId,option_id:b.dataset.voteOption,account_id:state.account.id},{onConflict:'poll_id,account_id'});if(error)alert(error.message);else await loadAll()});
  $$('[data-edit-announcement]').forEach(b=>b.onclick=()=>{
    if(!state.admin)return;
    const item=state.announcements.find(x=>x.id===b.dataset.editAnnouncement);
    if(!item)return;
    editingAnnouncementId=item.id;
    $("#announcementTitle").value=item.title||"";
    $("#announcementBody").value=item.body||"";
    $("#announcementReplies").checked=!!item.allow_replies;
    $("#announcementModal h2").textContent="Editar comunicado";
    $("#createAnnouncement").textContent="Guardar cambios";
    modal("#announcementModal");
  });
  $$('[data-edit-reply]').forEach(b=>b.onclick=async()=>{
    if(!state.account)return;
    const reply=state.announcementReplies.find(x=>x.id===b.dataset.editReply);
    if(!reply||reply.account_id!==state.account.id||reply.edited_once)return;
    const body=prompt("Edita tu respuesta:",reply.body||"");
    if(body===null)return;
    const clean=body.trim();
    if(!clean){alert("La respuesta no puede quedar vacía.");return}
    const {data,error}=await supabase.from("announcement_replies")
      .update({body:clean,edited_once:true,edited_at:new Date().toISOString()})
      .eq("id",reply.id)
      .eq("account_id",state.account.id)
      .eq("edited_once",false)
      .select("id")
      .maybeSingle();
    if(error){alert(error.message);return}
    if(!data){alert("Esta respuesta ya fue editada una vez.");return}
    await loadAll();
  });
  $$('[data-delete-announcement]').forEach(b=>b.onclick=async()=>{if(state.admin&&confirm('¿Eliminar este comunicado?')){await supabase.from('announcements').delete().eq('id',b.dataset.deleteAnnouncement);await loadAll()}});
  $$('[data-delete-poll]').forEach(b=>b.onclick=async()=>{if(state.admin&&confirm('¿Eliminar esta encuesta?')){await supabase.from('polls').delete().eq('id',b.dataset.deletePoll);await loadAll()}});
}
function resetPollOptionEditor(){const root=$("#pollOptionEditor");if(!root)return;root.innerHTML='';addPollOptionField();addPollOptionField()}
function addPollOptionField(value=''){const root=$("#pollOptionEditor");if(!root)return;const row=document.createElement('div');row.className='poll-option-editor-row';row.innerHTML=`<input class="poll-option-input" maxlength="160" placeholder="Opción ${root.children.length+1}" value="${esc(value)}"><button type="button" class="danger">×</button>`;row.querySelector('button').onclick=()=>{if(root.children.length<=2){alert('La encuesta debe tener al menos 2 opciones.');return}row.remove()};root.appendChild(row)}

function renderLeaderboard(){
  const rows=(state.accounts||[]).filter(a=>a.visible).map((a,i)=>`<tr><td>${i+1}</td><td>${esc(a.username)}${state.account?.id===a.id?" (tú)":""}</td><td>${money(a.credits)}</td></tr>`).join("");
  $("#leaderboard").innerHTML=`<table><thead><tr><th>#</th><th>Apostador</th><th>Pokédolares</th></tr></thead><tbody>${rows||'<tr><td colspan="3">Sin cuentas.</td></tr>'}</tbody></table>`;
}
function renderActiveEvents(){
  const cards=state.tournaments.filter(t=>t.status!=="finished"||tournamentHasOpenMatches(t.id)).map(t=>{
    const open=state.matches.filter(m=>m.tournament_id===t.id&&["scheduled","live"].includes(m.status)).length;
    return `<div class="card clickable" data-open-event="${t.id}"><strong>🏆 ${esc(t.name)}</strong><div class="muted">${esc(t.format)} · ${open} enfrentamientos abiertos</div></div>`;
  }).join("");
  $("#activeEvents").innerHTML=cards||'<div class="muted">No hay eventos activos.</div>';
  $$("[data-open-event]").forEach(c=>c.onclick=()=>{$("#betTournamentSelect").value=c.dataset.openEvent;switchView("betting");renderBetMatches()});
}
function isIndividualEvent(t){ return !!(t?.config?.event_type==="individual"||t?.config?.individual); }
function tournamentHasOpenMatches(tid){
  return state.matches.some(m=>m.tournament_id===tid&&["scheduled","live"].includes(m.status)&&m.side_a&&m.side_b);
}
function tournamentOptions(includeFinished=true){
  const available=state.tournaments.filter(t=>includeFinished||t.status!=="finished"||tournamentHasOpenMatches(t.id));
  const tournaments=available.filter(t=>!isIndividualEvent(t));
  const individual=available.filter(isIndividualEvent);
  const options=list=>list.map(t=>`<option value="${t.id}">${esc(t.name)} · ${esc(t.format)}</option>`).join("");
  if(!individual.length)return options(tournaments);
  return `${tournaments.length?`<optgroup label="Torneos">${options(tournaments)}</optgroup>`:""}<optgroup label="Peleas individuales">${options(individual)}</optgroup>`;
}
function renderTournamentSelects(){
  for(const id of ["betTournamentSelect","resultTournamentSelect","adminTournamentSelect"]){
    const el=$("#"+id);if(!el)continue;
    const old=el.value;el.innerHTML='<option value="">— Selecciona —</option>'+tournamentOptions(id!=="betTournamentSelect");
    if([...el.options].some(o=>o.value===old))el.value=old;
  }
  const selected=tournamentById($("#adminTournamentSelect").value);
  $("#participantPanel").hidden=!selected||isIndividualEvent(selected);
  $("#matchAdminPanel").hidden=!selected;
  $("#knockoutPanel").hidden=!selected||isIndividualEvent(selected);
}
$("#betTournamentSelect").onchange=()=>{renderBetMatches();renderBetStandings()};
$("#resultTournamentSelect").onchange=renderResults;

function participantAverageElo(participant){
  const members=Array.isArray(participant?.members)&&participant.members.length?participant.members:[{name:participant?.display_name}];
  return members.reduce((sum,m)=>sum+rankingFor(m.name).elo,0)/Math.max(1,members.length);
}
function participantStatStrength(participant){
  const members=Array.isArray(participant?.members)&&participant.members.length?participant.members:[{name:participant?.display_name}];
  const values=members.map(member=>{
    const ranking=rankingFor(member.name);
    const played=Number(ranking.wins||0)+Number(ranking.losses||0);
    const winRate=played?Number(ranking.wins||0)/played:.5;
    const koDiffPerMatch=played?(Number(ranking.kos_for||0)-Number(ranking.kos_against||0))/played:0;
    return Number(ranking.elo||1000)+(winRate-.5)*80+clamp(koDiffPerMatch,-3,3)*12;
  });
  return values.reduce((sum,value)=>sum+value,0)/Math.max(1,values.length);
}
function handicapMarket(match){
  const sideA=state.participants.find(p=>p.id===match.side_a),sideB=state.participants.find(p=>p.id===match.side_b);
  const strengthA=participantStatStrength(sideA),strengthB=participantStatStrength(sideB);
  const difference=strengthA-strengthB;
  const absoluteDifference=Math.abs(difference);

  // La magnitud de la línea se define únicamente por la diferencia estadística.
  const handicap=absoluteDifference<55?.5:absoluteDifference<110?1:absoluteDifference<175?1.5:absoluteDifference<245?2:absoluteDifference<325?2.5:absoluteDifference<420?3.5:4.5;
  const expectedScoreDifference=difference/140;
  const payoutFactor=.94;
  const option=(participantId,line,expectedMargin)=>{
    const probability=clamp(1/(1+Math.exp(-(expectedMargin+line)/1.55)),.06,.94);
    return {participant_id:participantId,line,odds:Math.max(1.001,+(payoutFactor/probability).toFixed(3))};
  };

  return {
    handicap,
    options:[
      option(match.side_a, handicap, expectedScoreDifference),
      option(match.side_a,-handicap, expectedScoreDifference),
      option(match.side_b, handicap,-expectedScoreDifference),
      option(match.side_b,-handicap,-expectedScoreDifference)
    ]
  };
}
function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
function scoreProbabilityShift(diff){
  const d=Math.abs(Number(diff)||0);
  if(d<=0)return 0;
  if(d===1)return 0.04;  // diferencia 1: cambio visible
  if(d===2)return 0.08;  // diferencia 2: cambio mayor
  if(d===3)return 0.15;  // diferencia 3: incremento medio
  if(d===4)return 0.24;  // diferencia 4: incremento medio-alto
  if(d===5)return 0.38;  // diferencia 5: incremento muy alto
  if(d===6)return 0.52;  // diferencia 6: cuota del perdedor se dispara
  return Math.min(0.72,0.52+(d-6)*0.06);
}
function dynamicOdds(match){
  const sideA=state.participants.find(p=>p.id===match.side_a),sideB=state.participants.find(p=>p.id===match.side_b);
  const eloA=participantAverageElo(sideA),eloB=participantAverageElo(sideB);
  let pA;
  const manual=match.base_odds?.mode==='manual'&&Number(match.base_odds?.a)>1&&Number(match.base_odds?.b)>1;
  if(manual){
    const ia=1/Number(match.base_odds.a),ib=1/Number(match.base_odds.b);
    pA=ia/(ia+ib);
  }else pA=expected(eloA,eloB);

  // Presión moderada por dinero apostado. Las selecciones al ganador dentro de una combinada
  // afectan la cuota del mismo modo que una apuesta individual.
  const winnerBets=state.bets
    .filter(b=>b.status==='pending')
    .flatMap(b=>{
      if(b.match_id===match.id&&b.bet_type==='winner')return [{selection:b.selection,stake:b.stake}];
      if(b.bet_type!=='parlay')return [];
      return (b.selection?.legs||[])
        .filter(leg=>leg.match_id===match.id&&leg.bet_type==='winner')
        .map(leg=>({selection:leg.selection,stake:b.stake}));
    });
  const stakeA=winnerBets.filter(b=>b.selection?.participant_id===match.side_a).reduce((n,b)=>n+Number(b.stake||0),0);
  const stakeB=winnerBets.filter(b=>b.selection?.participant_id===match.side_b).reduce((n,b)=>n+Number(b.stake||0),0);
  const total=stakeA+stakeB;
  if(total>0)pA+=((stakeA-stakeB)/total)*0.10;

  // El marcador mueve la probabilidad de manera continua: poco (1-2), medio (3-4), alto (5-6).
  const diff=(Number(match.score_a)||0)-(Number(match.score_b)||0);
  if(match.status==='live'&&diff!==0)pA+=Math.sign(diff)*scoreProbabilityShift(diff);

  pA=clamp(pA,0.015,0.985);
  const payoutFactor=0.94;
  return {
    a:Math.max(1.001,+(payoutFactor/pA).toFixed(3)),
    b:Math.max(1.001,+(payoutFactor/(1-pA)).toFixed(3))
  };
}

function bindGroupAccordions(container){
  if(!container)return;
  const details=$$("details.group-accordion",container);
  details.forEach(item=>item.addEventListener("toggle",()=>{
    if(!item.open)return;
    details.forEach(other=>{if(other!==item)other.open=false});
  }));
}
function groupTableHtml(g,list,q=0){
  return `<details class="group-accordion"><summary>Grupo ${groupLetter(g)}</summary><div class="group-table-wrap"><table><thead><tr><th>#</th><th>Jugador/equipo</th><th>PJ</th><th>PG</th><th>Pts</th><th>KO+</th><th>KO-</th><th>Dif.</th></tr></thead><tbody>${list.map((x,i)=>`<tr class="${i<q?"qualifier-row":""}"><td>${i+1}</td><td>${esc(x.display_name)}</td><td>${x.pj}</td><td>${x.pg}</td><td>${x.pts}</td><td>${x.kf}</td><td>${x.kc}</td><td>${x.kf-x.kc}</td></tr>`).join("")}</tbody></table></div></details>`;
}

function renderBetStandings(){
  const tid=$("#betTournamentSelect").value;
  if(!tid){$("#betStandings").innerHTML='<div class="muted">Selecciona un torneo.</div>';return}
  const t=tournamentById(tid);
  if(isIndividualEvent(t)){ $("#betStandings").innerHTML='<div class="muted">Las peleas individuales no usan tabla de posiciones.</div>';return }
  const q=t?.config?.qualify_per_group||1,rows=standingsFor(tid);
  const groups=[...new Set(rows.map(r=>r.group_no))].sort((a,b)=>b-a);
  $("#betStandings").innerHTML=groups.map((g,i)=>groupTableHtml(g,rows.filter(r=>r.group_no===g),q).replace('<details class="group-accordion">',`<details class="group-accordion" ${i===0?"open":""}>`)).join("")||'<div class="muted">Sin participantes.</div>';
  bindGroupAccordions($("#betStandings"));
}

function renderBetTournamentStandings(){
  const box=$("#betTournamentStandings");
  if(!box)return;
  const tid=$("#betTournamentSelect").value;
  if(!tid){box.innerHTML="";return}
  const tournament=tournamentById(tid);
  if(isIndividualEvent(tournament)){box.innerHTML="";return}
  const rows=standingsFor(tid);
  const groups=[...new Set(rows.map(r=>r.group_no))].sort((a,b)=>b-a);
  box.innerHTML=groups.map((g,i)=>groupTableHtml(g,rows.filter(r=>r.group_no===g)).replace('<details class="group-accordion">',`<details class="group-accordion" ${i===0?"open":""}>`)).join("")||'<div class="muted">La tabla aparecerá cuando se asignen participantes.</div>';
  bindGroupAccordions(box);
}
function renderBetMatches(){
  const tid=$("#betTournamentSelect").value;
  const list=state.matches
    .filter(m=>m.tournament_id===tid&&["scheduled","live"].includes(m.status)&&m.side_a&&m.side_b)
    .sort((a,b)=>{
      const aTime=a.scheduled_at?Date.parse(a.scheduled_at):NaN;
      const bTime=b.scheduled_at?Date.parse(b.scheduled_at):NaN;
      const aHasDate=Number.isFinite(aTime);
      const bHasDate=Number.isFinite(bTime);

      // Primero, fecha y hora exactas: la pelea más cercana aparece antes.
      if(aHasDate&&bHasDate&&aTime!==bTime)return aTime-bTime;
      if(aHasDate!==bHasDate)return aHasDate?-1:1;

      // Sin fecha (o empate exacto), conservar el orden en que se crearon.
      const aCreated=Date.parse(a.created_at||'');
      const bCreated=Date.parse(b.created_at||'');
      if(Number.isFinite(aCreated)&&Number.isFinite(bCreated)&&aCreated!==bCreated)return aCreated-bCreated;

      return Number(a.round_no||0)-Number(b.round_no||0);
    });
  $("#betMatches").innerHTML=list.map((m,index)=>{
    const o=dynamicOdds(m);
    const blocked=accountParticipatesInMatch(m);
    const displayedRound=index+1;
    return `<div class="card match clickable${blocked?" bet-blocked":""}" data-bet-match="${m.id}">
      <div class="muted">${esc(m.phase)} · ronda ${displayedRound}${blocked?" · No puedes apostar en tu propia partida":""}</div>
      <div class="teams"><span>${esc(participantName(m.side_a))}${m.status==="live"?`<small class="live-score">${m.score_a??0}</small>`:""}</span><span>${m.status==="live"?'<b class="live-label">● EN VIVO</b>':"vs"}</span><span>${esc(participantName(m.side_b))}${m.status==="live"?`<small class="live-score">${m.score_b??0}</small>`:""}</span></div>
      <div class="odds"><span>x${o.a}</span><span>x${o.b}</span></div>
      ${(()=>{
        if(!state.account)return "";
        const mine=state.bets.filter(b=>b.account_id===state.account.id&&b.match_id===m.id&&b.status==='pending');
        if(!mine.length)return "";
        return `<div class="locked-user-odds">Tu apuesta conserva su cuota: ${mine.map(b=>`x${Number(b.locked_odds).toFixed(3)}`).join(' · ')}</div>`;
      })()}
      <div class="muted">${m.scheduled_at?new Date(m.scheduled_at).toLocaleString("es-BO"):"Sin horario"}</div>
    </div>`;
  }).join("")||'<div class="muted">No hay enfrentamientos abiertos.</div>';
  $$("[data-bet-match]").forEach(c=>c.onclick=()=>openBet(c.dataset.betMatch));
}
function openBet(id){
  if(!state.account){alert("Primero inicia sesión.");return}
  const m=state.matches.find(x=>x.id===id);if(!m)return;
  if(accountParticipatesInMatch(m)){alert("No puedes apostar en una partida en la que participas.");return}
  $("#betMatchId").value=id;$("#betModalTitle").textContent=`${participantName(m.side_a)} vs ${participantName(m.side_b)}`;
  $("#betType").value="winner";renderBetFields();modal("#betModal");
}
$("#betType").onchange=renderBetFields;
function renderBetFields(){
  const m=state.matches.find(x=>x.id===$("#betMatchId").value);if(!m)return;
  const type=$("#betType").value,o=dynamicOdds(m),a=participantName(m.side_a),b=participantName(m.side_b);
  if(type==="winner"){
    $("#betDynamicFields").innerHTML=`<label>Selección</label><select id="betSelection"><option value="${m.side_a}">${esc(a)}</option><option value="${m.side_b}">${esc(b)}</option></select>`;
  }else if(type==="handicap"){
    const market=handicapMarket(m);
    const buttons=market.options.map((option,index)=>{
      const name=option.participant_id===m.side_a?a:b;
      const line=`${option.line>=0?'+':''}${option.line}`;
      return `<button type="button" class="handicap-choice${index===0?' selected':''}" data-handicap-value="${option.participant_id}|${option.line}"><strong>${esc(name)} ${line}</strong><span>x${option.odds}</span></button>`;
    }).join('');
    $("#betDynamicFields").innerHTML=`<label>Selecciona un hándicap</label><input id="betSelection" type="hidden" value="${market.options[0].participant_id}|${market.options[0].line}"><div class="handicap-choice-grid">${buttons}</div>`;
    $$("[data-handicap-value]",$("#betDynamicFields")).forEach(button=>button.onclick=()=>{
      $("#betSelection").value=button.dataset.handicapValue;
      $$("[data-handicap-value]",$("#betDynamicFields")).forEach(item=>item.classList.toggle('selected',item===button));
      updateBetPreview();
    });
  }else{
    $("#betDynamicFields").innerHTML=`<div class="row"><div><label>${esc(a)}</label><input id="scoreA" type="number" min="0" value="6"></div><div><label>${esc(b)}</label><input id="scoreB" type="number" min="0" value="4"></div></div>`;
  }
  updateBetPreview();
  $("#betDynamicFields").oninput=updateBetPreview;$("#betDynamicFields").onchange=updateBetPreview;
}
function currentBetOdds(){
  const m=state.matches.find(x=>x.id===$("#betMatchId").value),type=$("#betType").value,o=dynamicOdds(m);
  if(type==="winner") return $("#betSelection").value===m.side_a?o.a:o.b;
  if(type==="handicap"){
    const market=handicapMarket(m);
    const [participantId,lineText]=$("#betSelection").value.split('|');
    const line=Number(lineText);
    return market.options.find(option=>option.participant_id===participantId&&Number(option.line)===line)?.odds||1.001;
  }
  const a=state.participants.find(p=>p.id===m.side_a),b=state.participants.find(p=>p.id===m.side_b);
  return scoreOdds(rankingFor(a.display_name).elo,rankingFor(b.display_name).elo,+$("#scoreA").value,+$("#scoreB").value);
}
function updateBetPreview(){
  const odds=currentBetOdds(),stake=+$("#betStake").value||0;
  $("#betOddsPreview").textContent=`Cuota x${odds} · pago potencial ${money(Math.floor(stake*odds))}`;
}
$("#betStake").oninput=updateBetPreview;
function currentBetSelection(){
  const type=$('#betType').value;
  if(type==='score')return {score_a:+$('#scoreA').value,score_b:+$('#scoreB').value};
  if(type==='handicap'){const [participant_id,line]=$('#betSelection').value.split('|');return {participant_id,line:+line}}
  return {participant_id:$('#betSelection').value};
}
function renderParlayBuilder(){
  const box=$('#parlayBuilder');
  if(!box)return;
  box.hidden=parlayCart.length===0;
  if(!parlayCart.length){box.innerHTML='';return}
  const totalOdds=parlayCart.reduce((value,leg)=>value*Number(leg.locked_odds),1);
  box.innerHTML=`<h3>Combinada (${parlayCart.length} selecciones)</h3>
    ${parlayCart.map((leg,index)=>`<div class="parlay-leg"><div><strong>${esc(leg.match_label)}</strong><small>${esc(leg.selection_label)} · cuota x${Number(leg.locked_odds).toFixed(3)}</small></div><button class="danger parlay-remove" data-remove-parlay="${index}">Quitar</button></div>`).join('')}
    <div class="parlay-summary"><div class="card"><span class="muted">Cuota combinada</span><strong style="display:block">x${totalOdds.toFixed(3)}</strong></div><div class="card"><span class="muted">Pago potencial</span><strong id="parlayPotential" style="display:block">0 créditos</strong></div></div>
    <div class="parlay-actions"><div><label>Monto de la combinada</label><input id="parlayStake" type="number" min="1" value="50"></div><button id="confirmParlay">Confirmar combinada</button><button id="clearParlay" class="secondary">Vaciar</button></div>`;
  const update=()=>{$('#parlayPotential').textContent=money(Math.floor((+$('#parlayStake').value||0)*totalOdds))+' créditos'};
  $('#parlayStake').oninput=update;update();
  $$('[data-remove-parlay]',box).forEach(btn=>btn.onclick=()=>{parlayCart.splice(+btn.dataset.removeParlay,1);renderParlayBuilder()});
  $('#clearParlay').onclick=()=>{parlayCart=[];renderParlayBuilder()};
  $('#confirmParlay').onclick=placeParlay;
}
$('#addToParlay').onclick=()=>{
  const match=state.matches.find(x=>x.id===$('#betMatchId').value);if(!match)return;
  if(accountParticipatesInMatch(match)){alert('No puedes agregar a la combinada una partida en la que participas.');return}
  const type=$('#betType').value,selection=currentBetSelection(),odds=Number(currentBetOdds());
  const duplicate=parlayCart.some(leg=>leg.match_id===match.id&&leg.bet_type===type&&JSON.stringify(leg.selection)===JSON.stringify(selection));
  if(duplicate){alert('Esa selección ya está en la combinada.');return}
  parlayCart.push({match_id:match.id,bet_type:type,selection,locked_odds:odds,match_label:`${participantName(match.side_a)} vs ${participantName(match.side_b)}`,selection_label:describeBetSelection(type,selection,match)});
  modal('#betModal',false);renderParlayBuilder();
};
async function placeParlay(){
  if(!state.account||!parlayCart.length)return;
  if(parlayCart.some(leg=>accountParticipatesInMatch(state.matches.find(m=>m.id===leg.match_id)))){alert('La combinada contiene una partida en la que participas. Quítala para continuar.');return}
  const stake=+$('#parlayStake').value;
  if(!stake||stake<1||stake>state.account.credits){alert('Monto inválido.');return}
  const lockedOdds=Number(parlayCart.reduce((value,leg)=>value*Number(leg.locked_odds),1).toFixed(4));
  const tournamentIds=[...new Set(parlayCart.map(leg=>state.matches.find(m=>m.id===leg.match_id)?.tournament_id).filter(Boolean))];
  const betRow={account_id:state.account.id,tournament_id:tournamentIds.length===1?tournamentIds[0]:null,match_id:null,bet_type:'parlay',selection:{legs:parlayCart.map(leg=>({...leg}))},stake,locked_odds:lockedOdds};
  const newCredits=state.account.credits-stake;
  const [u,b]=await Promise.all([
    supabase.from('accounts').update({credits:newCredits}).eq('id',state.account.id),
    supabase.from('bets').insert(betRow).select('*').single()
  ]);
  if(u.error||b.error){alert('No se pudo guardar la combinada.');console.error(u.error||b.error);return}
  state.account.credits=newCredits;
  const accountIndex=state.accounts.findIndex(a=>a.id===state.account.id);if(accountIndex>=0)state.accounts[accountIndex].credits=newCredits;
  state.bets.unshift(b.data||{...betRow,id:`local-${Date.now()}`,status:'pending',created_at:new Date().toISOString()});
  parlayCart=[];renderParlayBuilder();renderMyBets();renderAll();loadAll();
}
$("#confirmBet").onclick=async()=>{
  const match=state.matches.find(x=>x.id===$("#betMatchId").value),type=$("#betType").value,stake=+$("#betStake").value;
  if(!match||!stake||stake<1||stake>state.account.credits){alert("Monto inválido.");return}
  if(accountParticipatesInMatch(match)){alert("No puedes apostar en una partida en la que participas.");return}
  const selection=currentBetSelection();
  const odds=currentBetOdds();
  const {error}=await supabase.rpc("place_bet_atomic",{});
  if(error && !String(error.message).includes("Could not find")) console.warn(error);
  const newCredits=state.account.credits-stake;
  const betRow={account_id:state.account.id,tournament_id:match.tournament_id,match_id:match.id,bet_type:type,selection,stake,locked_odds:odds};
  const [u,b]=await Promise.all([
    supabase.from("accounts").update({credits:newCredits}).eq("id",state.account.id),
    supabase.from("bets").insert(betRow).select("*").single()
  ]);
  if(u.error||b.error){alert("No se pudo guardar la apuesta.");console.error(u.error||b.error);return}

  // Actualización inmediata local: la cuota del mercado cambia sin esperar Realtime ni recargar.
  state.account.credits=newCredits;
  const accountIndex=state.accounts.findIndex(a=>a.id===state.account.id);
  if(accountIndex>=0)state.accounts[accountIndex]={...state.accounts[accountIndex],credits:newCredits};
  state.bets.unshift(b.data||{...betRow,id:`local-${Date.now()}`,status:'pending',created_at:new Date().toISOString()});
  modal("#betModal",false);
  renderBetMatches();renderMyBets();renderAll();
  // Sincroniza en segundo plano con Supabase.
  loadAll();
};
function betStatusInfo(status){
  const map={
    pending:{label:'Pendiente',className:'bet-status-pending'},
    won:{label:'Ganada',className:'bet-status-won'},
    lost:{label:'Perdida',className:'bet-status-lost'},
    refunded:{label:'Reembolsada',className:'bet-status-refunded'}
  };
  return map[status]||{label:String(status||'Pendiente'),className:'bet-status-pending'};
}
function betTypeLabel(type){
  return ({winner:'Ganador',handicap:'Hándicap',score:'Marcador exacto',parlay:'Combinada',champion:'Campeón'})[type]||type;
}
function describeBetSelection(type,selection,match){
  if(!match)return 'Enfrentamiento no disponible';
  const a=participantName(match.side_a),b=participantName(match.side_b);
  if(type==='winner')return `Ganador: ${participantName(selection?.participant_id)}`;
  if(type==='handicap')return `Hándicap: ${participantName(selection?.participant_id)} ${Number(selection?.line)>=0?'+':''}${selection?.line}`;
  if(type==='score')return `Marcador exacto: ${a} ${selection?.score_a} - ${selection?.score_b} ${b}`;
  return '';
}
function parlayDetail(bet){
  const legs=bet.selection?.legs||[];
  return legs.map(leg=>{
    const match=state.matches.find(m=>m.id===leg.match_id);
    const title=match?`${participantName(match.side_a)} vs ${participantName(match.side_b)}`:'Partido';
    return `${title}: ${describeBetSelection(leg.bet_type,leg.selection,match)} (x${Number(leg.locked_odds).toFixed(3)})`;
  }).join(' · ');
}
function renderMyBets(){
  if(!state.account){$("#myBets").innerHTML='<div class="muted">Inicia sesión.</div>';return}
  const rows=state.bets.filter(b=>b.account_id===state.account.id).map(b=>{
    const info=betStatusInfo(b.status);
    const match=state.matches.find(m=>m.id===b.match_id);
    const selectionDetail=b.bet_type==='parlay'
      ? parlayDetail(b)
      : describeBetSelection(b.bet_type,b.selection,match);
    const potentialGain=Number(b.stake||0)*Number(b.locked_odds||0);
    const detail=`${selectionDetail?`<div class="bet-detail">${esc(selectionDetail)}</div>`:''}<div class="bet-detail"><strong>Ganancia:</strong> ${money(potentialGain)}</div>`;
    return `<tr class="${info.className}"><td>${esc(betTypeLabel(b.bet_type))}${detail}</td><td>${money(b.stake)}</td><td>x${Number(b.locked_odds).toFixed(3)}</td><td><span class="bet-status ${info.className}">${esc(info.label)}</span></td><td>${money(b.payout||0)}</td></tr>`;
  }).join("");
  $("#myBets").innerHTML=`<table><thead><tr><th>Tipo</th><th>Monto</th><th>Cuota</th><th>Estado</th><th>Pago</th></tr></thead><tbody>${rows||'<tr><td colspan="5">Sin apuestas.</td></tr>'}</tbody></table>`;
}

function renderGeneralStats(){
  const accountNames=new Set(state.accounts.map(a=>a.username.toLowerCase()));
  const rows=state.rankings.filter(r=>accountNames.has(r.name.toLowerCase())).map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.name)}</td>${state.admin?`<td>${r.elo}</td>`:""}<td>${r.wins}</td><td>${r.losses}</td><td>${r.kos_for}</td><td>${r.kos_against}</td></tr>`).join("");
  const colspan=state.admin?7:6;
  $("#generalStats").innerHTML=`<table><thead><tr><th>#</th><th>Jugador</th>${state.admin?"<th>ELO</th>":""}<th>PG</th><th>PP</th><th>KO+</th><th>KO-</th></tr></thead><tbody>${rows||`<tr><td colspan="${colspan}">Sin estadísticas.</td></tr>`}</tbody></table>`;
}
function standingsFor(tid){
  const ps=state.participants.filter(p=>p.tournament_id===tid), ms=state.matches.filter(m=>m.tournament_id===tid&&m.phase==="group"&&["finished","walkover"].includes(m.status));
  const map=new Map(ps.map(p=>[p.id,{...p,pj:0,pg:0,pts:0,kf:0,kc:0}]));
  for(const m of ms){
    const a=map.get(m.side_a),b=map.get(m.side_b);if(!a||!b)continue;
    a.pj++;b.pj++;a.kf+=m.score_a||0;a.kc+=m.score_b||0;b.kf+=m.score_b||0;b.kc+=m.score_a||0;
    if(m.winner_id===a.id){a.pg++;a.pts+=3}else if(m.winner_id===b.id){b.pg++;b.pts+=3}else{a.pts++;b.pts++}
  }
  return [...map.values()].sort((a,b)=>a.group_no-b.group_no||b.pts-a.pts||((b.kf-b.kc)-(a.kf-a.kc)));
}
function renderResults(){
  const tid=$("#resultTournamentSelect").value;
  if(!tid){$("#standings").innerHTML="";$("#finishedMatches").innerHTML="";return}
  const st=standingsFor(tid);
  const groups=[...new Set(st.map(r=>r.group_no))].sort((a,b)=>b-a);
  $("#standings").innerHTML=groups.map((g,i)=>groupTableHtml(g,st.filter(r=>r.group_no===g)).replace('<details class="group-accordion">',`<details class="group-accordion" ${i===0?"open":""}>`)).join("");
  bindGroupAccordions($("#standings"));
  const ms=state.matches.filter(m=>m.tournament_id===tid&&["finished","walkover"].includes(m.status));
  $("#finishedMatches").innerHTML=ms.map(m=>`<div class="card">${esc(participantName(m.side_a))} <strong>${m.score_a??0}-${m.score_b??0}</strong> ${esc(participantName(m.side_b))} · ${esc(m.phase)}</div>`).join("")||'<div class="muted">Sin resultados.</div>';
}

$("#generatePassword").onclick=()=>$("#newPassword").value=randomPassword();
$("#createAccount").onclick=async()=>{
  const username=$("#newUsername").value.trim(),password=$("#newPassword").value;
  if(!username||password.length<6){alert("Nombre y contraseña de al menos 6 caracteres.");return}
  const {error}=await supabase.from("accounts").insert({username,password_hash:await sha256(password),credits:CONFIG.STARTING_CREDITS});
  if(error){alert(error.message);return} $("#newUsername").value="";$("#newPassword").value="";await loadAll();
};
function renderAccountsAdmin(){
  const rows=state.accounts.map(a=>`<tr><td>${esc(a.username)}</td><td>${money(a.credits)}</td><td><input type="checkbox" data-visible="${a.id}" ${a.visible?"checked":""}></td><td><input type="checkbox" data-cashier-role="${a.id}" ${a.is_cashier?"checked":""}></td><td><button class="secondary" data-reset="${a.id}">Nueva clave</button> <button class="danger" data-reset-ranking="${a.id}">Borrar ELO/estadísticas</button> <button class="danger" data-delete-account="${a.id}">Eliminar</button></td></tr>`).join("");
  $("#accountAdminList").innerHTML=`<table><thead><tr><th>Cuenta</th><th>Saldo</th><th>Visible</th><th>Cajero</th><th>Acciones</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Sin cuentas.</td></tr>'}</tbody></table>`;
  $$('[data-visible]').forEach(x=>x.onchange=async()=>{await supabase.from('accounts').update({visible:x.checked}).eq('id',x.dataset.visible);loadAll()});
  $$('[data-cashier-role]').forEach(x=>x.onchange=async()=>{
    const desired=x.checked;
    x.disabled=true;
    const {error}=await supabase.from('accounts').update({is_cashier:desired}).eq('id',x.dataset.cashierRole);
    if(error){
      x.checked=!desired;
      alert('No se pudo cambiar el rol de cajero: '+error.message);
      console.error(error);
      x.disabled=false;
      return;
    }
    await loadAll();
  });
  $$('[data-reset]').forEach(x=>x.onclick=async()=>{const p=randomPassword();await supabase.from('accounts').update({password_hash:await sha256(p)}).eq('id',x.dataset.reset);alert('Nueva contraseña: '+p)});
  $$('[data-reset-ranking]').forEach(x=>x.onclick=async()=>{
    const account=state.accounts.find(a=>a.id===x.dataset.resetRanking);if(!account)return;
    if(!confirm(`¿Borrar el ELO y todas las estadísticas de ${account.username}?`))return;
    const {error}=await supabase.from('rankings').upsert({name:account.username,elo:1000,wins:0,losses:0,kos_for:0,kos_against:0},{onConflict:'name'});
    if(error){alert('No se pudo borrar el progreso.');console.error(error);return}
    await loadAll();
  });
  $$('[data-delete-account]').forEach(x=>x.onclick=async()=>{if(confirm('¿Eliminar la cuenta y todos sus datos?')){await supabase.from('accounts').delete().eq('id',x.dataset.deleteAccount);loadAll()}});
  const resetAll=$('#resetAllRankings');
  if(resetAll)resetAll.onclick=async()=>{
    if(!confirm('¿Borrar el ELO y todas las estadísticas de todos los jugadores?'))return;
    const rows=state.accounts.map(a=>({name:a.username,elo:1000,wins:0,losses:0,kos_for:0,kos_against:0}));
    if(!rows.length)return;
    const {error}=await supabase.from('rankings').upsert(rows,{onConflict:'name'});
    if(error){alert('No se pudo borrar el progreso de todos.');console.error(error);return}
    await loadAll();
  };
}
function cashierTotals(){
  const tx=Array.isArray(state.cashierTransactions)?state.cashierTransactions:[];
  const commonFromRecharges=tx
    .filter(t=>String(t.operation||'').trim().toLowerCase()==='recharge')
    .reduce((total,t)=>{
      const credits=Number(t.credits)||0;
      // Cajero normal: 70% al fondo común. Administrador: 60% al fondo común.
      return total+credits*(t.operated_by_admin ? 0.60 : 0.70);
    },0);
  const totalWithdraw=tx
    .filter(t=>String(t.operation||'').trim().toLowerCase()==='withdrawal')
    .reduce((total,t)=>total+(Number(t.credits)||0),0);
  return {commonCredits:Math.max(0,commonFromRecharges-totalWithdraw)};
}
async function refreshCashierTransactions(){
  const {data,error}=await supabase.from('cashier_transactions').select('*').order('created_at',{ascending:false});
  if(error){
    console.error('No se pudo actualizar el resumen de caja:',error);
    alert('La operación se realizó, pero no se pudo actualizar el resumen de caja: '+error.message);
    return false;
  }
  state.cashierTransactions=data||[];
  return true;
}
function renderCashierTabs(){
  const cash=$("#cashierCashTab"),additions=$("#cashierAdditionsTab");
  if(!cash||!additions)return;
  const showAdditions=state.cashierTab==="additions";
  cash.hidden=showAdditions;
  additions.hidden=!showAdditions;
  $$('[data-cashier-tab]').forEach(button=>{
    const active=button.dataset.cashierTab===state.cashierTab;
    button.classList.toggle("active",active);
    button.classList.toggle("secondary",!active);
  });
}
function renderCreditsAdmin(){
  const allowed=state.admin||state.account?.is_cashier;
  if(!allowed)return;
  const me=state.account;
  renderCashierTabs();

  const rows=state.accounts.map(a=>{
    const isSelf=me?.id===a.id;
    const selfBlocked=!state.admin&&isSelf;
    return `<tr><td>${esc(a.username)}${isSelf?' (tú)':''}</td><td>${money(a.credits)}</td><td><input type="number" min="1" value="100" data-credit-input="${a.id}" ${selfBlocked?'disabled':''}></td><td><button data-add-credit="${a.id}" ${selfBlocked?'disabled':''}>Recargar</button> <button class="danger" data-remove-credit="${a.id}" ${selfBlocked?'disabled':''}>Retirar</button></td></tr>`;
  }).join('');
  $('#creditAdminList').innerHTML=`<table><thead><tr><th>Cuenta</th><th>Saldo</th><th>Monto</th><th>Acción</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Sin cuentas.</td></tr>'}</tbody></table>`;
  $$('[data-add-credit]').forEach(b=>b.onclick=()=>changeCredits(b.dataset.addCredit,1));
  $$('[data-remove-credit]').forEach(b=>b.onclick=()=>changeCredits(b.dataset.removeCredit,-1));

  if(state.admin){
    const options=state.accounts.map(a=>`<option value="${a.id}">${esc(a.username)}${a.id===me?.id?' (tú)':''} — ${money(a.credits)} créditos</option>`).join('');
    const pending=(state.cashierAdditionRequests||[]).filter(r=>r.status==='pending').map(r=>{
      const cashier=state.accounts.find(a=>a.id===r.cashier_id)?.username||'Cajero eliminado';
      const target=state.accounts.find(a=>a.id===r.target_account_id)?.username||'Cuenta eliminada';
      return `<tr><td>${new Date(r.created_at).toLocaleString('es-BO')}</td><td>${esc(cashier)}</td><td>${esc(target)}</td><td>${money(r.requested_credits||0)}</td><td>${esc(r.description)}</td><td><button data-approve-addition="${r.id}">Aprobar</button> <button class="danger" data-reject-addition="${r.id}">Rechazar</button></td></tr>`;
    }).join('');
    $('#creditAdditionList').innerHTML=`<div class="panel"><h3>Adición directa del administrador</h3><div class="grid"><div><label>Cuenta</label><select id="adminAdditionTarget"><option value="">— Selecciona una cuenta —</option>${options}</select></div><div><label>Cantidad de créditos</label><input id="adminAdditionAmount" type="number" min="1" value="100"></div><div><label>Justificante o descripción de la dinámica</label><textarea id="adminAdditionDescription" rows="3" placeholder="Explica la actividad, dinámica o motivo"></textarea></div></div><div style="display:flex;gap:8px;margin-top:12px"><button id="adminDirectAdd">Adicionar</button><button id="adminDirectRemove" class="danger">Retirar</button></div></div><div class="panel" style="margin-top:16px"><h3>Solicitudes pendientes de cajeros</h3><table><thead><tr><th>Fecha</th><th>Cajero</th><th>Cuenta</th><th>Créditos</th><th>Dinámica</th><th>Decisión</th></tr></thead><tbody>${pending||'<tr><td colspan="6">No hay solicitudes pendientes.</td></tr>'}</tbody></table></div>`;
    $('#adminDirectAdd').onclick=()=>adminDirectAddition(1);
    $('#adminDirectRemove').onclick=()=>adminDirectAddition(-1);
    $$('[data-approve-addition]').forEach(b=>b.onclick=()=>reviewAdditionRequest(b.dataset.approveAddition,true));
    $$('[data-reject-addition]').forEach(b=>b.onclick=()=>reviewAdditionRequest(b.dataset.rejectAddition,false));
  }else{
    const options=state.accounts.filter(a=>a.id!==me?.id).map(a=>`<option value="${a.id}">${esc(a.username)}</option>`).join('');
    $('#creditAdditionList').innerHTML=`<div class="grid"><div><label>Cuenta que recibirá los créditos</label><select id="cashierAdditionTarget"><option value="">— Selecciona una cuenta —</option>${options}</select></div><div><label>Cantidad de créditos</label><input id="cashierAdditionAmount" type="number" min="1" value="100"></div><div><label>Justificante o descripción de la dinámica</label><textarea id="cashierAdditionDescription" rows="4" placeholder="Describe claramente la actividad, premio o dinámica realizada"></textarea></div></div><button id="submitAdditionRequest" style="margin-top:12px">Enviar</button><p class="muted" style="margin-top:10px">Los créditos solo se entregarán cuando un administrador apruebe la solicitud.</p>`;
    $('#submitAdditionRequest').onclick=submitAdditionRequest;
  }

  const totals=cashierTotals();
  const mine=(Array.isArray(state.cashierTransactions)?state.cashierTransactions:[])
    .filter(t=>String(t.operation||'').trim().toLowerCase()==='recharge' && (state.admin?t.operated_by_admin===true:t.cashier_id===me?.id))
    .reduce((a,t)=>a+(Number(t.credits)||0),0);
  const personalRate=state.admin?0.40:(me?.is_cashier?0.30:0);
  const personalCommissionCredits=mine*personalRate;
  $('#cashierSummary').innerHTML=`
    <div class="card"><strong>Fondo común disponible</strong><div>${(totals.commonCredits/30).toFixed(2)} diamantes</div><small>${money(totals.commonCredits)} créditos equivalentes</small></div>
    <div class="card"><strong>Tus recargas acumuladas</strong><div>${money(mine)} créditos</div><small>${(mine/30).toFixed(2)} diamantes cobrados</small></div>
    <div class="card"><strong>Tu ${state.admin?'40':'30'}%</strong><div>${(personalCommissionCredits/30).toFixed(2)} diamantes</div><small>${money(personalCommissionCredits)} créditos equivalentes de comisión</small></div>`;

  const history=state.cashierTransactions.map(t=>{
    const cashier=state.accounts.find(a=>a.id===t.cashier_id)?.username||(t.operated_by_admin?'Administrador':'Cuenta eliminada');
    const target=state.accounts.find(a=>a.id===t.target_account_id)?.username||'Cuenta eliminada';
    const diamonds=Number(t.credits)/30;
    const share=String(t.operation||'').trim().toLowerCase()==='recharge'?diamonds*(t.operated_by_admin?0.40:0.30):0;
    return `<tr><td>${new Date(t.created_at).toLocaleString('es-BO')}</td><td>${esc(cashier)}</td><td>${esc(target)}</td><td>${t.operation==='recharge'?'Recarga':'Retiro'}</td><td>${money(t.credits)}</td><td>${diamonds.toFixed(2)}</td><td>${share.toFixed(2)}</td><td>${t.justification?esc(t.justification):'—'}</td></tr>`;
  }).join('');
  $('#cashierHistory').innerHTML=`<table><thead><tr><th>Fecha</th><th>Cajero</th><th>Cuenta</th><th>Movimiento</th><th>Créditos</th><th>Diamantes</th><th>Comisión personal</th><th>Justificante</th></tr></thead><tbody>${history||'<tr><td colspan="8">Sin movimientos.</td></tr>'}</tbody></table>`;
}
async function submitAdditionRequest(){
  const targetId=$('#cashierAdditionTarget')?.value;
  const amount=Number($('#cashierAdditionAmount')?.value);
  const description=$('#cashierAdditionDescription')?.value.trim();
  if(!targetId)return alert('Selecciona la cuenta que recibirá los créditos.');
  if(!Number.isInteger(amount)||amount<1)return alert('Ingresa una cantidad válida de créditos.');
  if(!description)return alert('Debes explicar de qué trata la actividad o dinámica.');
  const {error}=await supabase.rpc('cashier_request_credit_addition',{p_cashier_id:state.account.id,p_target_id:targetId,p_credits:amount,p_description:description});
  if(error)return alert(error.message);
  alert('Solicitud enviada al administrador.');
  await loadAll();
}
async function adminDirectAddition(sign){
  if(!state.admin)return;
  const id=$('#adminAdditionTarget')?.value;
  const amount=Number($('#adminAdditionAmount')?.value);
  const description=$('#adminAdditionDescription')?.value.trim();
  const target=state.accounts.find(x=>x.id===id);
  if(!target)return alert('Selecciona una cuenta.');
  if(!Number.isInteger(amount)||amount<1)return alert('Ingresa una cantidad válida.');
  if(!description)return alert('Debes escribir el justificante o la descripción de la dinámica.');
  const next=target.credits+sign*amount;
  if(next<0)return alert('La cuenta no tiene suficientes créditos.');
  const {error}=await supabase.from('accounts').update({credits:next}).eq('id',id);
  if(error)return alert(error.message);
  await loadAll();
}
async function reviewAdditionRequest(requestId,approve){
  if(!state.admin)return;
  const request=state.cashierAdditionRequests.find(r=>r.id===requestId);
  if(!request||request.status!=='pending')return alert('La solicitud ya no está pendiente.');
  if(approve){
    const amount=Number(request.requested_credits);
    if(!Number.isInteger(amount)||amount<1)return alert('La solicitud no tiene una cantidad válida.');
    const target=state.accounts.find(a=>a.id===request.target_account_id);
    if(!target)return alert('La cuenta de destino ya no existe.');
    const {error:updateError}=await supabase.from('accounts').update({credits:target.credits+amount}).eq('id',target.id);
    if(updateError)return alert(updateError.message);
    const {error:requestError}=await supabase.from('cashier_addition_requests').update({status:'approved',approved_credits:amount,resolved_at:new Date().toISOString()}).eq('id',requestId).eq('status','pending');
    if(requestError)return alert('Los créditos fueron enviados, pero no se pudo cerrar la solicitud: '+requestError.message);
  }else{
    const {error}=await supabase.from('cashier_addition_requests').update({status:'rejected',resolved_at:new Date().toISOString()}).eq('id',requestId).eq('status','pending');
    if(error)return alert(error.message);
  }
  await loadAll();
}
$$('[data-cashier-tab]').forEach(button=>button.addEventListener('click',()=>{
  state.cashierTab=button.dataset.cashierTab;
  renderCreditsAdmin();
}));

async function changeCredits(id,sign){
  const target=state.accounts.find(x=>x.id===id),input=document.querySelector(`[data-credit-input="${id}"]`),amount=Number(input?.value);
  if(!target||!Number.isInteger(amount)||amount<1)return alert('Ingresa una cantidad válida.');
  if(!state.admin&&state.account?.id===id)return alert('Un cajero no puede recargarse ni retirarse créditos a sí mismo.');
  const operation=sign>0?'recharge':'withdrawal';
  if(state.admin){
    const next=target.credits+sign*amount;
    if(next<0)return alert('La cuenta no tiene suficientes créditos.');
    const {error:updateError}=await supabase.from('accounts').update({credits:next}).eq('id',id);
    if(updateError)return alert(updateError.message);
    const {error:logError}=await supabase.from('cashier_transactions').insert({cashier_id:state.account?.id||null,target_account_id:id,operation,credits:amount,operated_by_admin:true});
    if(logError)return alert('Los créditos cambiaron, pero no se pudo registrar el movimiento: '+logError.message);
  }else{
    if(!state.account?.is_cashier)return alert('No tienes activo el rol de cajero.');
    const {error}=await supabase.rpc('cashier_change_credits',{p_cashier_id:state.account.id,p_target_id:id,p_operation:operation,p_credits:amount});
    if(error)return alert(error.message);
  }
  await refreshCashierTransactions();
  await loadAll();
}


const groupLetter = n => String.fromCharCode(64 + Math.max(1, Math.min(26, Number(n))));
function tournamentById(id){ return state.tournaments.find(t=>t.id===id); }
function tournamentParticipants(id){ return state.participants.filter(p=>p.tournament_id===id); }
function tournamentMatches(id){ return state.matches.filter(m=>m.tournament_id===id); }
function isGroupStageComplete(id){
  const ms=tournamentMatches(id).filter(m=>m.phase==="group");
  return ms.length>0 && ms.every(m=>["finished","walkover"].includes(m.status));
}
function accountOptions(selected=""){
  return '<option value="">— Selecciona cuenta —</option>'+
    state.accounts.map(a=>`<option value="${a.id}" ${a.id===selected?"selected":""}>${esc(a.username)}</option>`).join("");
}
function botOrAccountName(member){
  if(!member)return "";
  if(member.type==="account") return state.accounts.find(a=>a.id===member.id)?.username || member.name || "";
  return member.name || "";
}
function participantEloFromMembers(members){
  if(!members?.length)return 1000;
  return Math.round(members.reduce((sum,m)=>sum+rankingFor(botOrAccountName(m)).elo,0)/members.length);
}
function isRoundRobinTournament(t){return t?.format==="round-robin"||t?.config?.round_robin===true;}
function shuffled(list){const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function tournamentMatchCountDetails(t,repechageOverride,thirdOverride){
  if(!t)return {group:0,repechage:0,knockout:0,third:0,final:0,total:0};
  const n=Number(t.config?.participant_count||0);
  if(isRoundRobinTournament(t)){
    const group=n>1?n*(n-1)/2:0;
    return {group,repechage:0,knockout:0,third:0,final:0,total:group};
  }
  const groups=Math.max(1,Number(t.config?.groups||1));
  const base=Math.floor(n/groups),extra=n%groups;
  let group=0;
  for(let i=0;i<groups;i++){const size=base+(i<extra?1:0);group+=size*(size-1)/2;}
  if(t.format==="1v1-double")group*=2;
  const repechage=Boolean(repechageOverride??t.config?.repechage)?1:0;
  const qualified=groups*Number(t.config?.qualify_per_group||1)+repechage;
  const valid=[2,4,8,16].includes(qualified);
  const final=valid?1:0;
  const knockout=valid?Math.max(0,qualified-2):0;
  const third=valid&&qualified>=4&&Boolean(thirdOverride??(t.config?.third_place!==false))?1:0;
  return {group,repechage,knockout,third,final,total:group+repechage+knockout+third+final};
}
function renderTournamentMatchCount(){
  const box=$("#tournamentMatchCount");if(!box)return;
  const t=tournamentById($("#adminTournamentSelect")?.value);
  if(!t){box.textContent="";return}
  const c=tournamentMatchCountDetails(t,$("#enableRepechage")?.checked,$("#enableThirdPlace")?.checked);
  box.innerHTML=`<strong>Enfrentamientos previstos</strong><br>Clasificatorias: ${c.group} · Repechaje: ${c.repechage} · Eliminación directa: ${c.knockout} · 3.er lugar: ${c.third} · Final: ${c.final}<br><strong>Total: ${c.total} enfrentamientos</strong>`;
}

const tournamentDraftParticipants=new Map();
function entrantCardHtml(index,existing={}){
  const isBot=existing.type==="bot";
  return `<div class="card tournament-entrant" data-entrant="${index}">
    <strong>Participante ${index+1}</strong>
    <label>Tipo</label>
    <select data-entrant-kind><option value="account" ${!isBot?"selected":""}>Cuenta creada</option><option value="bot" ${isBot?"selected":""}>Bot</option></select>
    <div data-entrant-account-wrap ${isBot?"hidden":""}><label>Cuenta</label><select data-entrant-account>${accountOptions(existing.id||"")}</select></div>
    <div data-entrant-bot-wrap ${!isBot?"hidden":""}><label>Nombre del bot</label><input data-entrant-bot value="${esc(isBot?existing.name||"":"")}" placeholder="Ej: Bot Brock"></div>
  </div>`;
}
function renderTournamentEntrantSetup(t){
  const total=t.format==="2v2"?(t.config?.participant_count||2)*2:(t.config?.participant_count||2);
  $("#tournamentEntrantHelp").textContent=isRoundRobinTournament(t)?`Ingresa los ${total} jugadores. Este modo ignora el ELO y sortea aleatoriamente el orden de los enfrentamientos.`:t.format==="2v2"?`Ingresa los ${total} jugadores. Se crearán ${t.config?.participant_count||2} equipos de dos con promedios de ELO lo más parecidos posible.`:`Ingresa los ${total} jugadores. Se distribuirán automáticamente por ELO entre los grupos.`;
  $("#tournamentEntrantCards").innerHTML=Array.from({length:total},(_,i)=>entrantCardHtml(i)).join("");
  $$('[data-entrant-kind]',"#tournamentEntrantCards").forEach(sel=>sel.onchange=()=>{const card=sel.closest('[data-entrant]');card.querySelector('[data-entrant-account-wrap]').hidden=sel.value==="bot";card.querySelector('[data-entrant-bot-wrap]').hidden=sel.value!=="bot";});
  $("#tournamentEntrantSetup").hidden=false;$("#tournamentTeamSetup").hidden=true;
}
function readTournamentEntrants(){
  const used=new Set(),members=[];
  for(const card of $$('[data-entrant]',"#tournamentEntrantCards")){
    const kind=card.querySelector('[data-entrant-kind]').value;
    if(kind==="account"){
      const id=card.querySelector('[data-entrant-account]').value,account=state.accounts.find(a=>a.id===id);
      if(!account)throw new Error(`Selecciona una cuenta en participante ${+card.dataset.entrant+1}.`);
      const key='a:'+id;if(used.has(key))throw new Error(`La cuenta ${account.username} está repetida.`);used.add(key);members.push({id,name:account.username,type:'account'});
    }else{
      const name=card.querySelector('[data-entrant-bot]').value.trim();if(!name)throw new Error(`Escribe el nombre del bot en participante ${+card.dataset.entrant+1}.`);
      const key='b:'+name.toLowerCase();if(used.has(key))throw new Error(`El bot ${name} está repetido.`);used.add(key);members.push({name,type:'bot'});
    }
  }
  return members;
}
function snakeGroupAssignments(count,groups){const result=[];let g=1,dir=1;for(let i=0;i<count;i++){result.push(g);if(groups>1){g+=dir;if(g>groups){g=groups;dir=-1}else if(g<1){g=1;dir=1}}}return result;}
function balancedTournamentParticipants(t,members){
  const groups=t.config?.groups||1;
  if(isRoundRobinTournament(t))return shuffled(members).map(member=>({display_name:member.name,kind:member.type,members:[member],group_no:1,seed_elo:1000}));
  const ranked=[...members].sort((a,b)=>rankingFor(b.name).elo-rankingFor(a.name).elo);let participants;
  if(t.format==="2v2"){
    participants=[];while(ranked.length){const high=ranked.shift(),low=ranked.pop();participants.push({members:[high,low]});}
    participants.sort((a,b)=>participantEloFromMembers(b.members)-participantEloFromMembers(a.members));
  }else participants=ranked.map(member=>({members:[member]}));
  const assignments=snakeGroupAssignments(participants.length,groups);
  return participants.map((p,i)=>({display_name:t.format==="2v2"?p.members.map(m=>m.name).join(' + '):p.members[0].name,kind:t.format==="2v2"?'team':p.members[0].type,members:p.members,group_no:assignments[i],seed_elo:participantEloFromMembers(p.members)}));
}

$("#createTournament").onclick=async()=>{
  const name=$("#tournamentName").value.trim();
  const format=$("#tournamentFormat").value;
  const participant_count=+$("#tournamentParticipantCount").value;
  let groups=+$("#tournamentGroups").value;
  let qualify=+$("#qualifyPerGroup").value;
  const roundRobin=format==="round-robin";
  if(roundRobin){groups=1;qualify=1;}

  if(!name){alert("Escribe el nombre del torneo.");return}
  if(participant_count<2||participant_count>32){alert("La cantidad de participantes debe estar entre 2 y 32.");return}
  if(groups<1||groups>26||groups>participant_count){alert("La cantidad de grupos debe estar entre 1 y 26 y no superar los participantes.");return}
  if(qualify<1||qualify>Math.ceil(participant_count/groups)){alert("La cantidad que clasifica por grupo no es válida.");return}

  const config={
    groups, qualify_per_group:qualify, participant_count,
    third_place:roundRobin?false:true, repechage:false, round_robin:roundRobin
  };
  const {data,error}=await supabase.from("tournaments").insert({name,format,config}).select().single();
  if(error){alert(error.message);return}
  $("#tournamentName").value="";
  await loadAll();
  $("#adminTournamentSelect").value=data.id;
  $("#participantPanel").hidden=false;
  $("#matchAdminPanel").hidden=false;
  $("#knockoutPanel").hidden=false;
  renderParticipantCards();
  renderMatchAdmin();
  renderKnockoutPanel();
};

function renderTournamentsAdmin(){
  $("#tournamentAdminList").innerHTML=state.tournaments.filter(t=>!isIndividualEvent(t)&&t.status!=="finished").map(t=>{
    const count=t.config?.participant_count||0;
    return `<div class="card">
      <strong>${esc(t.name)}</strong>
      <div class="muted">${isRoundRobinTournament(t)?"Todos contra todos":esc(t.format)} · ${count} participantes · ${t.config?.groups||1} grupos · ${esc(t.status)}</div>
      <button class="secondary" data-edit-tournament="${t.id}">Administrar</button>
      <button class="danger" data-delete-tournament="${t.id}">Eliminar</button>
    </div>`;
  }).join("")||'<div class="muted">Sin torneos.</div>';

  $$("[data-edit-tournament]").forEach(b=>b.onclick=()=>{
    $("#adminTournamentSelect").value=b.dataset.editTournament;
    $("#participantPanel").hidden=false;$("#matchAdminPanel").hidden=false;$("#knockoutPanel").hidden=false;
    renderParticipantCards();renderMatchAdmin();renderKnockoutPanel();
  });
  $$("[data-delete-tournament]").forEach(b=>b.onclick=async()=>{
    if(confirm("¿Eliminar torneo completo?")){
      await supabase.from("tournaments").delete().eq("id",b.dataset.deleteTournament);
      await loadAll();
    }
  });
}


function individualMemberFromName(name){
  const clean=String(name||"").trim();
  const account=state.accounts.find(a=>String(a.username).toLowerCase()===clean.toLowerCase());
  return account?{type:"account",id:account.id,name:account.username}:{type:"bot",name:clean};
}
let individual2v2AutoBalanced=false;
function syncIndividualEventFields(){
  const team=$("#individualEventFormat")?.value==="2v2";
  $$('[data-individual-team-only]').forEach(el=>el.hidden=!team);
  if($("#individualSideALabel"))$("#individualSideALabel").textContent=team?"Equipo A · jugador 1":"Jugador A";
  if($("#individualSideBLabel"))$("#individualSideBLabel").textContent=team?"Equipo B · jugador 1":"Jugador B";
  individual2v2AutoBalanced=false;
}
function balanceIndividual2v2(showAlert=false){
  const fields=["#individualA1","#individualA2","#individualB1","#individualB2"];
  const players=fields.map(id=>({name:$(id).value.trim()}));
  if(players.some(p=>!p.name)){
    if(showAlert)alert("Completa los cuatro participantes antes de ordenar los equipos.");
    return false;
  }
  const repeated=new Set();
  for(const player of players){
    const key=player.name.toLowerCase();
    if(repeated.has(key)){if(showAlert)alert(`El participante ${player.name} está repetido.`);return false}
    repeated.add(key);
    player.elo=rankingFor(player.name).elo;
  }
  const arrangements=[
    [[0,1],[2,3]],
    [[0,2],[1,3]],
    [[0,3],[1,2]]
  ];
  const best=arrangements.map(([a,b])=>{
    const eloA=(players[a[0]].elo+players[a[1]].elo)/2;
    const eloB=(players[b[0]].elo+players[b[1]].elo)/2;
    return {a,b,eloA,eloB,diff:Math.abs(eloA-eloB)};
  }).sort((x,y)=>x.diff-y.diff)[0];
  const ordered=[players[best.a[0]],players[best.a[1]],players[best.b[0]],players[best.b[1]]];
  fields.forEach((id,i)=>$(id).value=ordered[i].name);
  const info=$("#individual2v2BalanceInfo");
  if(info)info.textContent=`Equipo A: ${Math.round(best.eloA)} ELO promedio · Equipo B: ${Math.round(best.eloB)} · diferencia ${Math.round(best.diff)}`;
  individual2v2AutoBalanced=true;
  return true;
}
async function createIndividualEvent(){
  const format=$("#individualEventFormat").value;
  const name=$("#individualEventName").value.trim()||`Pelea individual ${new Date().toLocaleDateString("es-BO")}`;
  const names=[$("#individualA1").value.trim(),$("#individualA2").value.trim(),$("#individualB1").value.trim(),$("#individualB2").value.trim()];
  const required=format==="2v2"?[names[0],names[1],names[2],names[3]]:[names[0],names[2]];
  if(required.some(n=>!n)){alert(format==="2v2"?"Completa los cuatro integrantes.":"Completa ambos jugadores.");return}
  if(format==="2v2"&&!individual2v2AutoBalanced){balanceIndividual2v2(false);names.splice(0,4,$("#individualA1").value.trim(),$("#individualA2").value.trim(),$("#individualB1").value.trim(),$("#individualB2").value.trim())}
  const sideAMembers=(format==="2v2"?[names[0],names[1]]:[names[0]]).map(individualMemberFromName);
  const sideBMembers=(format==="2v2"?[names[2],names[3]]:[names[2]]).map(individualMemberFromName);
  const displayA=sideAMembers.map(m=>m.name).join(" + "),displayB=sideBMembers.map(m=>m.name).join(" + ");
  const {data:t,error:tError}=await supabase.from("tournaments").insert({name,format,status:"active",config:{event_type:"individual",individual:true,participant_count:2,groups:1,qualify_per_group:1,third_place:false,repechage:false}}).select().single();
  if(tError){alert(tError.message);return}
  const participantRows=[
    {tournament_id:t.id,display_name:displayA,kind:format==="2v2"?"team":sideAMembers[0].type,members:sideAMembers,group_no:1,seed_elo:participantEloFromMembers(sideAMembers)},
    {tournament_id:t.id,display_name:displayB,kind:format==="2v2"?"team":sideBMembers[0].type,members:sideBMembers,group_no:1,seed_elo:participantEloFromMembers(sideBMembers)}
  ];
  const {data:participants,error:pError}=await supabase.from("tournament_participants").insert(participantRows).select();
  if(pError){await supabase.from("tournaments").delete().eq("id",t.id);alert(pError.message);return}
  const {error:mError}=await supabase.from("matches").insert({tournament_id:t.id,phase:"final",round_no:1,side_a:participants[0].id,side_b:participants[1].id,status:"scheduled"});
  if(mError){await supabase.from("tournaments").delete().eq("id",t.id);alert(mError.message);return}
  $("#individualEventName").value="";["#individualA1","#individualA2","#individualB1","#individualB2"].forEach(id=>$(id).value="");
  individual2v2AutoBalanced=false;if($("#individual2v2BalanceInfo"))$("#individual2v2BalanceInfo").textContent="Completa los cuatro participantes para equilibrar los equipos.";
  await loadAll();
}
function renderIndividualEventsAdmin(){
  const box=$("#individualEventAdminList");if(!box)return;
  const events=state.tournaments.filter(isIndividualEvent);
  box.innerHTML=events.map(t=>{
    const match=tournamentMatches(t.id)[0],open=match&&["scheduled","live"].includes(match.status);
    const result=match&&["finished","walkover"].includes(match.status)?` · ${match.score_a??0}-${match.score_b??0}`:"";
    return `<div class="card"><strong>${esc(t.name)}</strong><div class="muted">${esc(t.format)} · ${match?`${esc(participantName(match.side_a))} vs ${esc(participantName(match.side_b))}`:"Sin pelea"}${result} · ${open?"abierta":esc(t.status)}</div><button class="secondary" data-manage-individual="${t.id}">Administrar</button><button class="danger" data-delete-individual="${t.id}">Eliminar</button></div>`;
  }).join("")||'<div class="muted">Sin peleas individuales.</div>';
  $$("[data-manage-individual]").forEach(b=>b.onclick=()=>{
    $("#adminTournamentSelect").value=b.dataset.manageIndividual;
    $("#participantPanel").hidden=true;$("#matchAdminPanel").hidden=false;$("#knockoutPanel").hidden=true;
    renderMatchAdmin();$("#matchAdminPanel").scrollIntoView({behavior:"smooth",block:"start"});
  });
  $$("[data-delete-individual]").forEach(b=>b.onclick=async()=>{if(confirm("¿Eliminar esta pelea individual?")){await supabase.from("tournaments").delete().eq("id",b.dataset.deleteIndividual);await loadAll()}});
}
if($("#individualEventFormat"))$("#individualEventFormat").onchange=syncIndividualEventFields;
if($("#balanceIndividual2v2"))$("#balanceIndividual2v2").onclick=()=>balanceIndividual2v2(true);
["#individualA1","#individualA2","#individualB1","#individualB2"].forEach(id=>{
  if(!$(id))return;
  $(id).oninput=()=>{
    if(["#individualA1","#individualA2","#individualB1","#individualB2"].some(x=>!$(x).value.trim()))individual2v2AutoBalanced=false;
  };
  $(id).onchange=()=>{
    if($("#individualEventFormat")?.value==="2v2"&&!individual2v2AutoBalanced)balanceIndividual2v2(false);
  };
});
if($("#createIndividualEvent"))$("#createIndividualEvent").onclick=createIndividualEvent;
syncIndividualEventFields();

$("#adminTournamentSelect").onchange=()=>{
  const id=$("#adminTournamentSelect").value,has=!!id,t=tournamentById(id),individual=isIndividualEvent(t);
  $("#participantPanel").hidden=!has||individual;$("#matchAdminPanel").hidden=!has;$("#knockoutPanel").hidden=!has||individual;
  if(has){if(!individual)renderParticipantCards();renderMatchAdmin();if(!individual)renderKnockoutPanel()}
};

function participantCardHtml(t,index,existing){
  const team=t.format==="2v2";
  const members=existing?.members||[];
  const kind=existing?.kind==="bot"?"bot":team?"team":"account";
  const groupNo=existing?.group_no||((index%(t.config?.groups||1))+1);

  function memberFields(memberIndex,label){
    const m=members[memberIndex]||{};
    const isBot=m.type==="bot";
    return `<div class="member-block" data-member="${memberIndex}">
      <label>${label} · tipo</label>
      <select data-member-kind="${memberIndex}">
        <option value="account" ${!isBot?"selected":""}>Cuenta creada</option>
        <option value="bot" ${isBot?"selected":""}>Bot</option>
      </select>
      <div data-account-wrap="${memberIndex}" ${isBot?"hidden":""}>
        <label>Cuenta</label><select data-member-account="${memberIndex}">${accountOptions(m.id||"")}</select>
      </div>
      <div data-bot-wrap="${memberIndex}" ${!isBot?"hidden":""}>
        <label>Nombre del bot</label><input data-member-bot="${memberIndex}" value="${esc(isBot?m.name||"":"")}" placeholder="Ej: Bot Brock">
      </div>
    </div>`;
  }
  return `<div class="card participant-slot" data-slot="${index}">
    <div class="slot-number">#${index+1}</div>
    <strong>${team?"Equipo":"Jugador"} ${index+1}</strong>
    ${memberFields(0,team?"Integrante 1":"Participante")}
    ${team?memberFields(1,"Integrante 2"):""}
    <div style="margin-top:10px"><label>Grupo</label>
      <select data-slot-group>${Array.from({length:t.config?.groups||1},(_,i)=>`<option value="${i+1}" ${i+1===groupNo?"selected":""}>Grupo ${groupLetter(i+1)}</option>`).join("")}</select>
    </div>
  </div>`;
}
function renderParticipantCards(){
  const tid=$("#adminTournamentSelect").value,t=tournamentById(tid);if(!t)return;
  const existing=tournamentParticipants(tid),draft=tournamentDraftParticipants.get(tid)||[];
  if(!existing.length&&!draft.length){renderTournamentEntrantSetup(t);return}
  const source=existing.length?existing:draft,count=t.config?.participant_count||source.length||2;
  $("#participantCards").innerHTML=Array.from({length:count},(_,i)=>participantCardHtml(t,i,source[i])).join("");
  $$('[data-member-kind]').forEach(sel=>sel.onchange=()=>{const block=sel.closest('[data-member]');block.querySelector(`[data-account-wrap="${sel.dataset.memberKind}"]`).hidden=sel.value==="bot";block.querySelector(`[data-bot-wrap="${sel.dataset.memberKind}"]`).hidden=sel.value!=="bot";});
  $("#tournamentEntrantSetup").hidden=true;$("#tournamentTeamSetup").hidden=false;
  if($("#fairPairingButton")){$("#fairPairingButton").textContent=isRoundRobinTournament(t)?"🎲 Sortear jugadores":"⚖️ Emparejamiento justo por ELO";}
}

function readParticipantCards(){
  const tid=$("#adminTournamentSelect").value,t=tournamentById(tid);
  const used=new Set(),items=[];
  for(const card of $$("[data-slot]","#participantCards")){
    const members=[];
    for(const block of $$("[data-member]",card)){
      const idx=block.dataset.member;
      const kind=block.querySelector(`[data-member-kind="${idx}"]`).value;
      let member;
      if(kind==="account"){
        const id=block.querySelector(`[data-member-account="${idx}"]`).value;
        const account=state.accounts.find(a=>a.id===id);
        if(!account)throw new Error(`Selecciona una cuenta en la tarjeta ${+card.dataset.slot+1}.`);
        if(used.has("a:"+id))throw new Error(`La cuenta ${account.username} está repetida.`);
        used.add("a:"+id);member={id,name:account.username,type:"account"};
      }else{
        const name=block.querySelector(`[data-member-bot="${idx}"]`).value.trim();
        if(!name)throw new Error(`Escribe el nombre del bot en la tarjeta ${+card.dataset.slot+1}.`);
        if(used.has("b:"+name.toLowerCase()))throw new Error(`El bot ${name} está repetido.`);
        used.add("b:"+name.toLowerCase());member={name,type:"bot"};
      }
      members.push(member);
    }
    const display_name=t.format==="2v2"?members.map(m=>m.name).join(" + "):members[0].name;
    items.push({display_name,kind:t.format==="2v2"?"team":members[0].type,members,group_no:+card.querySelector("[data-slot-group]").value,seed_elo:participantEloFromMembers(members)});
  }
  return items;
}

$("#confirmTournamentEntrants").onclick=()=>{
  const tid=$("#adminTournamentSelect").value,t=tournamentById(tid);if(!t)return;
  let members;try{members=readTournamentEntrants()}catch(e){alert(e.message);return}
  tournamentDraftParticipants.set(tid,balancedTournamentParticipants(t,members));renderParticipantCards();
};

$("#saveParticipantsButton").onclick=async()=>{
  const tid=$("#adminTournamentSelect").value;if(!tid)return;
  let items;try{items=readParticipantCards()}catch(e){alert(e.message);return}
  await supabase.from("tournament_participants").delete().eq("tournament_id",tid);
  const rows=items.map(x=>({...x,tournament_id:tid}));
  const {error}=await supabase.from("tournament_participants").insert(rows);
  if(error){alert(error.message);return}
  tournamentDraftParticipants.delete(tid);
  await loadAll();$("#adminTournamentSelect").value=tid;renderParticipantCards();
  alert("Participantes guardados.");
};

$("#fairPairingButton").onclick=()=>{
  const tid=$("#adminTournamentSelect").value,t=tournamentById(tid);if(!t)return;
  let items;try{items=readParticipantCards()}catch(e){alert(e.message);return}
  tournamentDraftParticipants.set(tid,balancedTournamentParticipants(t,items.flatMap(x=>x.members)));renderParticipantCards();
};

$("#generateFixture").onclick=async()=>{
  const tid=$("#adminTournamentSelect").value,t=tournamentById(tid),ps=tournamentParticipants(tid);
  const expectedCount=t?.config?.participant_count||0;
  if(!t||ps.length!==expectedCount){alert(`Debes guardar exactamente ${expectedCount} participantes antes de generar las peleas.`);return}
  const groupNumbers=[...new Set(ps.map(p=>p.group_no))];
  for(const g of groupNumbers)if(ps.filter(p=>p.group_no===g).length<2){alert(`El grupo ${groupLetter(g)} necesita al menos 2 participantes.`);return}

  await supabase.from("matches").delete().eq("tournament_id",tid);
  let rows=[];let round=1;
  for(const g of groupNumbers.sort((a,b)=>a-b)){
    const gp=isRoundRobinTournament(t)?shuffled(ps.filter(p=>p.group_no===g)):ps.filter(p=>p.group_no===g);
    for(let i=0;i<gp.length;i++)for(let j=i+1;j<gp.length;j++){
      rows.push({tournament_id:tid,phase:"group",round_no:round++,group_no:g,side_a:gp[i].id,side_b:gp[j].id,status:"scheduled"});
      if(t.format==="1v1-double")rows.push({tournament_id:tid,phase:"group",round_no:round++,group_no:g,side_a:gp[j].id,side_b:gp[i].id,status:"scheduled"});
    }
  }
  if(isRoundRobinTournament(t))rows=shuffled(rows).map((row,i)=>({...row,round_no:i+1}));
  const {error}=await supabase.from("matches").insert(rows);
  if(error){alert(error.message);return}
  await supabase.from("tournaments").update({status:"active"}).eq("id",tid);
  await loadAll();$("#adminTournamentSelect").value=tid;renderMatchAdmin();renderKnockoutPanel();
};

function localDatetimeValue(value){
  if(!value)return "";
  const d=new Date(value),pad=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function tournamentAdminMatchOrder(matches){
  return matches.map((match,index)=>({match,index})).sort((a,b)=>{
    const statusRank=match=>match.status==="live"?0:["scheduled"].includes(match.status)?1:2;
    const rankDiff=statusRank(a.match)-statusRank(b.match);
    if(rankDiff)return rankDiff;

    const aHasDate=!!a.match.scheduled_at,bHasDate=!!b.match.scheduled_at;
    if(aHasDate!==bHasDate)return aHasDate?-1:1;
    if(aHasDate&&bHasDate){
      const dateDiff=new Date(a.match.scheduled_at).getTime()-new Date(b.match.scheduled_at).getTime();
      if(dateDiff)return dateDiff;
    }

    const createdDiff=new Date(a.match.created_at||0).getTime()-new Date(b.match.created_at||0).getTime();
    return createdDiff||a.index-b.index;
  }).map(x=>x.match);
}
function renderMatchAdmin(){
  const tid=$("#adminTournamentSelect").value;if(!tid)return;
  const ms=tournamentAdminMatchOrder(tournamentMatches(tid));
  $("#matchAdminList").innerHTML=ms.map(matchCardAdmin).join("")||'<div class="muted">Todavía no se generaron peleas.</div>';

  $$("[data-start-match]").forEach(b=>b.onclick=()=>startMatch(b.dataset.startMatch));
  $$("[data-finish-match]").forEach(b=>b.onclick=()=>finishMatch(b.dataset.finishMatch,false));
  $$("[data-walkover-a]").forEach(b=>b.onclick=()=>finishMatch(b.dataset.walkoverA,true,"a"));
  $$("[data-walkover-b]").forEach(b=>b.onclick=()=>finishMatch(b.dataset.walkoverB,true,"b"));
  $$(`[data-save-manual-odds]`).forEach(b=>b.onclick=()=>saveManualOdds(b.dataset.saveManualOdds));
  $$(`[data-auto-odds]`).forEach(b=>b.onclick=()=>useAutomaticOdds(b.dataset.autoOdds));
  $$("[data-save-schedule]").forEach(b=>b.onclick=()=>saveSchedule(b.dataset.saveSchedule));
  $$("[data-score-a],[data-score-b]").forEach(input=>input.addEventListener("input",()=>queueLiveScore(input.dataset.scoreA||input.dataset.scoreB)));
}
function matchCardAdmin(m){
  const started=m.status==="live",done=["finished","walkover"].includes(m.status);
  return `<div class="card fight-card">
    <div class="fight-header">
      <span class="pill">${m.phase==="group"?`Grupo ${groupLetter(m.group_no)}`:esc(m.phase)}</span>
      <div class="row" style="flex:0 1 420px">
        <input type="datetime-local" data-match-date="${m.id}" value="${localDatetimeValue(m.scheduled_at)}">
        <button class="secondary" data-save-schedule="${m.id}">Guardar fecha</button>
      </div>
    </div>
    <div class="fight-vs">
      <span>${esc(participantName(m.side_a))}</span><span class="vs">VS</span><span>${esc(participantName(m.side_b))}</span>
    </div>
    <div class="odds-admin-row">
      <label>Cuota base A<input type="number" min="1.001" step="0.001" data-manual-odds-a="${m.id}" value="${m.base_odds?.mode==='manual'?Number(m.base_odds.a).toFixed(3):''}" placeholder="Automática ELO"></label>
      <label>Cuota base B<input type="number" min="1.001" step="0.001" data-manual-odds-b="${m.id}" value="${m.base_odds?.mode==='manual'?Number(m.base_odds.b).toFixed(3):''}" placeholder="Automática ELO"></label>
      <button class="secondary" data-save-manual-odds="${m.id}">Guardar cuotas</button>
      <button class="secondary" data-auto-odds="${m.id}">Usar ELO</button>
      <small class="muted">Actual: x${dynamicOdds(m).a} / x${dynamicOdds(m).b}</small>
    </div>
    <div class="fight-controls">
      ${done?`<div class="card"><strong>Resultado: ${m.score_a??0} - ${m.score_b??0}</strong> · ${m.status==="walkover"?"Walkover":"Finalizada"}</div>`:
      started?`<div class="score-box">
        <input type="number" min="0" value="${m.score_a??0}" data-score-a="${m.id}">
        <span>—</span>
        <input type="number" min="0" value="${m.score_b??0}" data-score-b="${m.id}">
        <button data-finish-match="${m.id}">Finalizar pelea</button>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="danger" data-walkover-a="${m.id}">WO para ${esc(participantName(m.side_a))}</button>
        <button class="danger" data-walkover-b="${m.id}">WO para ${esc(participantName(m.side_b))}</button>
      </div>`:
      `<button data-start-match="${m.id}" style="width:100%">Iniciar pelea</button>`}
    </div>
  </div>`;
}
const liveScoreTimers=new Map();
function queueLiveScore(id){
  const m=state.matches.find(x=>x.id===id);if(!m||m.status!=="live")return;
  const a=+document.querySelector(`[data-score-a="${id}"]`)?.value||0;
  const b=+document.querySelector(`[data-score-b="${id}"]`)?.value||0;
  m.score_a=a;m.score_b=b;
  renderBetMatches();
  clearTimeout(liveScoreTimers.get(id));
  liveScoreTimers.set(id,setTimeout(async()=>{
    const {error}=await supabase.from("matches").update({score_a:a,score_b:b}).eq("id",id);
    if(error)console.error("No se pudo actualizar el marcador en vivo",error);
  },220));
}

async function saveManualOdds(id){
  const a=Number(document.querySelector(`[data-manual-odds-a="${id}"]`)?.value);
  const b=Number(document.querySelector(`[data-manual-odds-b="${id}"]`)?.value);
  if(!Number.isFinite(a)||!Number.isFinite(b)||a<1.001||b<1.001){alert('Ambas cuotas deben ser 1.001 o mayores.');return}
  const match=state.matches.find(m=>m.id===id);if(!match)return;
  match.base_odds={mode:'manual',a:+a.toFixed(3),b:+b.toFixed(3)};
  renderMatchAdmin();renderBetMatches();
  const {error}=await supabase.from('matches').update({base_odds:match.base_odds}).eq('id',id);
  if(error){console.error(error);await refreshTournamentState(match.tournament_id)}
}
async function useAutomaticOdds(id){
  const match=state.matches.find(m=>m.id===id);if(!match)return;
  match.base_odds={mode:'elo'};
  renderMatchAdmin();renderBetMatches();
  const {error}=await supabase.from('matches').update({base_odds:match.base_odds}).eq('id',id);
  if(error){console.error(error);await refreshTournamentState(match.tournament_id)}
}

async function saveSchedule(id){
  const value=document.querySelector(`[data-match-date="${id}"]`).value;
  const scheduledAt=value?new Date(value).toISOString():null;
  const {error}=await supabase.from("matches").update({scheduled_at:scheduledAt}).eq("id",id);
  if(error){alert(error.message);return}
  const match=state.matches.find(m=>m.id===id);if(match)match.scheduled_at=scheduledAt;
  renderMatchAdmin();renderBetMatches();
  alert("Fecha y hora guardadas.");
}
async function startMatch(id){
  const m=state.matches.find(x=>x.id===id);if(!m)return;
  m.status="live";m.score_a=m.score_a??0;m.score_b=m.score_b??0;
  renderMatchAdmin();renderBetMatches();
  const {error}=await supabase.from("matches").update({status:"live",score_a:m.score_a,score_b:m.score_b}).eq("id",id);
  if(error){console.error(error);await loadAll()}
}
function participantMemberNames(participant){
  if(Array.isArray(participant?.members)&&participant.members.length)return participant.members.map(m=>m.name).filter(Boolean);
  return participant?.display_name?[participant.display_name]:[];
}
async function updateRankingAfterMatch(match,scoreA,scoreB,winnerId){
  const sideA=state.participants.find(p=>p.id===match.side_a),sideB=state.participants.find(p=>p.id===match.side_b);
  if(!sideA||!sideB)return;
  const namesA=participantMemberNames(sideA),namesB=participantMemberNames(sideB);
  const avgA=namesA.reduce((n,name)=>n+rankingFor(name).elo,0)/Math.max(1,namesA.length);
  const avgB=namesB.reduce((n,name)=>n+rankingFor(name).elo,0)/Math.max(1,namesB.length);
  const tournament=state.tournaments.find(t=>t.id===match.tournament_id);
  const isTeam=tournament?.format==='2v2'||namesA.length>1||namesB.length>1;
  const isIndividualEvent=!!(tournament?.config?.event_type==='individual'||tournament?.config?.individual);
  const baseK=isTeam?14:24;
  const multiplier=isIndividualEvent?1:2;
  const winA=winnerId===match.side_a;
  const rows=[];
  for(const [names,oppAvg,won,kf,ka] of [[namesA,avgB,winA,scoreA,scoreB],[namesB,avgA,!winA,scoreB,scoreA]]){
    for(const name of names){
      const current=rankingFor(name),exp=expected(current.elo,oppAvg);
      const koImpact=clamp((Number(kf)-Number(ka))*0.9,-7,7);
      const delta=Math.round(((baseK*(Number(won)-exp))+koImpact)*multiplier);
      rows.push({name,elo:Math.max(100,current.elo+delta),wins:current.wins+(won?1:0),losses:current.losses+(won?0:1),kos_for:current.kos_for+Number(kf||0),kos_against:current.kos_against+Number(ka||0)});
    }
  }
  const {error}=await supabase.from('rankings').upsert(rows,{onConflict:'name'});
  if(error)throw error;
  for(const row of rows){const i=state.rankings.findIndex(r=>r.name.toLowerCase()===row.name.toLowerCase());if(i>=0)state.rankings[i]={...state.rankings[i],...row};else state.rankings.push(row)}
  state.rankings.sort((a,b)=>b.elo-a.elo);
  renderGeneralStats();renderBetMatches();
}
function legResult(leg){
  const match=state.matches.find(m=>m.id===leg.match_id);
  if(!match||!["finished","walkover"].includes(match.status))return null;
  if(leg.bet_type==='winner')return leg.selection?.participant_id===match.winner_id;
  if(leg.bet_type==='score')return Number(leg.selection?.score_a)===Number(match.score_a)&&Number(leg.selection?.score_b)===Number(match.score_b);
  if(leg.bet_type==='handicap'){
    const selected=leg.selection?.participant_id,line=Number(leg.selection?.line||0);
    const selectedScore=selected===match.side_a?Number(match.score_a):Number(match.score_b);
    const otherScore=selected===match.side_a?Number(match.score_b):Number(match.score_a);
    return selectedScore+line>otherScore;
  }
  return false;
}
async function settleParlays(){
  const parlays=state.bets.filter(b=>b.bet_type==='parlay'&&b.status==='pending');
  for(const bet of parlays){
    const results=(bet.selection?.legs||[]).map(legResult);
    if(!results.length)continue;
    const lost=results.some(result=>result===false),complete=results.every(result=>result!==null);
    if(!lost&&!complete)continue;
    const won=!lost&&complete,payout=won?Math.floor(Number(bet.stake)*Number(bet.locked_odds)):0;
    await supabase.from('bets').update({status:won?'won':'lost',payout}).eq('id',bet.id);
    bet.status=won?'won':'lost';bet.payout=payout;
    if(won){const account=state.accounts.find(a=>a.id===bet.account_id);if(account){account.credits+=payout;await supabase.from('accounts').update({credits:account.credits}).eq('id',account.id)}}
  }
}
async function settleBets(matchId){
  const match=state.matches.find(m=>m.id===matchId);if(!match)return;
  const bets=state.bets.filter(b=>b.match_id===matchId&&b.status==='pending');
  for(const bet of bets){
    let won=false;
    if(bet.bet_type==='winner')won=bet.selection?.participant_id===match.winner_id;
    else if(bet.bet_type==='score')won=Number(bet.selection?.score_a)===Number(match.score_a)&&Number(bet.selection?.score_b)===Number(match.score_b);
    else if(bet.bet_type==='handicap'){
      const selected=bet.selection?.participant_id,line=Number(bet.selection?.line||0);
      const selectedScore=selected===match.side_a?Number(match.score_a):Number(match.score_b);
      const otherScore=selected===match.side_a?Number(match.score_b):Number(match.score_a);
      won=selectedScore+line>otherScore;
    }
    const payout=won?Math.floor(Number(bet.stake)*Number(bet.locked_odds)):0;
    await supabase.from('bets').update({status:won?'won':'lost',payout}).eq('id',bet.id);
    bet.status=won?'won':'lost';bet.payout=payout;
    if(won){
      const account=state.accounts.find(a=>a.id===bet.account_id);
      if(account){account.credits+=payout;await supabase.from('accounts').update({credits:account.credits}).eq('id',account.id)}
    }
  }
  await settleParlays();
  renderMyBets();renderLeaderboard();
}

async function finishMatch(id,walkover=false,side=null){
  const m=state.matches.find(x=>x.id===id);if(!m)return;
  let a=0,b=0,winner=null,status="finished";
  if(walkover){
    status="walkover";winner=side==="a"?m.side_a:m.side_b;a=side==="a"?1:0;b=side==="b"?1:0;
  }else{
    a=+document.querySelector(`[data-score-a="${id}"]`)?.value||0;
    b=+document.querySelector(`[data-score-b="${id}"]`)?.value||0;
    if(a===b){alert("El marcador no puede terminar empatado.");return}
    winner=a>b?m.side_a:m.side_b;
  }
  const previous={score_a:m.score_a,score_b:m.score_b,status:m.status,winner_id:m.winner_id};
  Object.assign(m,{score_a:a,score_b:b,status,winner_id:winner});
  renderMatchAdmin();renderBetMatches();renderBetStandings();renderBetTournamentStandings();renderResults();
  const {error}=await supabase.from("matches").update({score_a:a,score_b:b,status,winner_id:winner}).eq("id",id);
  if(error){Object.assign(m,previous);renderAll();alert(error.message);return}
  try{
    if(!["finished","walkover"].includes(previous.status))await updateRankingAfterMatch(m,a,b,winner);
    if(typeof settleBets==="function")await settleBets(id);
  }catch(err){console.error("La pelea finalizó, pero falló una tarea secundaria:",err)}
  if(m.phase==="group")await autoGenerateKnockout(m.tournament_id);
  else await advanceKnockout(m.tournament_id,m.phase);
  await refreshTournamentState(m.tournament_id);
}

async function refreshTournamentState(tid){
  const [tournaments,participants,matches,rankings,bets]=await Promise.all([
    supabase.from("tournaments").select("*").order("created_at",{ascending:false}),
    supabase.from("tournament_participants").select("*"),
    supabase.from("matches").select("*").order("created_at"),
    supabase.from("rankings").select("*").order("elo",{ascending:false}),
    supabase.from("bets").select("*").order("created_at",{ascending:false})
  ]);
  if(!tournaments.error)state.tournaments=tournaments.data||[];
  if(!participants.error)state.participants=participants.data||[];
  if(!matches.error)state.matches=matches.data||[];
  if(!rankings.error)state.rankings=rankings.data||[];
  if(!bets.error)state.bets=bets.data||[];
  renderAll();
  $("#adminTournamentSelect").value=tid;
  $("#participantPanel").hidden=false;$("#matchAdminPanel").hidden=false;$("#knockoutPanel").hidden=false;
  renderParticipantCards();renderMatchAdmin();renderKnockoutPanel();
}
function worldCupOpeningPairs(qualifiers,groups,q){
  const byGroup=new Map(groups.map(g=>[g,qualifiers.filter(x=>x.group_no===g)]));
  if(q===2 && groups.length%2===0){
    const firstHalf=[],secondHalf=[];
    for(let i=0;i<groups.length;i+=2){
      const ga=groups[i],gb=groups[i+1],a=byGroup.get(ga)||[],b=byGroup.get(gb)||[];
      if(a[0]&&b[1])firstHalf.push([a[0],b[1]]);
      if(b[0]&&a[1])secondHalf.push([b[0],a[1]]);
    }
    return [...firstHalf,...secondHalf];
  }
  const remaining=[...qualifiers];
  const pairs=[];
  while(remaining.length){
    const a=remaining.shift();
    let index=remaining.findIndex(b=>b.group_no!==a.group_no);
    if(index<0)index=0;
    const b=remaining.splice(index,1)[0];
    if(a&&b)pairs.push([a,b]);
  }
  return pairs;
}

async function autoGenerateKnockout(tid){
  const t=tournamentById(tid);
  if(!t||!isGroupStageComplete(tid))return;
  if(isRoundRobinTournament(t)){
    await supabase.from("tournaments").update({status:"finished"}).eq("id",tid);
    await loadAll();$("#adminTournamentSelect").value=tid;renderMatchAdmin();renderKnockoutPanel();
    return;
  }
  const mainExisting=tournamentMatches(tid).some(m=>["quarterfinal","semifinal","final"].includes(m.phase));
  if(mainExisting){renderKnockoutPanel();return}
  await generateKnockoutRows(tid);
}
async function generateKnockoutRows(tid){
  const t=tournamentById(tid),q=t.config?.qualify_per_group||1;
  const groups=[...new Set(tournamentParticipants(tid).map(p=>p.group_no))].sort((a,b)=>a-b);
  const table=standingsFor(tid);
  const qualifiers=[];
  for(const g of groups)qualifiers.push(...table.filter(x=>x.group_no===g).slice(0,q));

  const repechage=t.config?.repechage ?? $("#enableRepechage").checked;
  const third=t.config?.third_place ?? $("#enableThirdPlace").checked;
  let rep=tournamentMatches(tid).find(m=>m.phase==="repechage");

  if(repechage && !rep){
    const extras=groups.map(g=>table.filter(x=>x.group_no===g)[q]).filter(Boolean);
    if(extras.length>=2){
      const {data,error}=await supabase.from("matches").insert({
        tournament_id:tid,phase:"repechage",round_no:1,
        side_a:extras[0].id,side_b:extras[1].id,status:"scheduled"
      }).select().single();
      if(error){alert(error.message);return}
      rep=data;
      $("#bracketStatus").textContent="Repechaje creado. Al finalizarlo se crearán las eliminatorias.";
      await loadAll();$("#adminTournamentSelect").value=tid;renderMatchAdmin();renderKnockoutPanel();
      return;
    }
  }

  if(rep && !["finished","walkover"].includes(rep.status)){
    $("#bracketStatus").textContent="Falta finalizar el repechaje.";
    return;
  }
  if(rep?.winner_id)qualifiers.push(state.participants.find(p=>p.id===rep.winner_id));

  if(![2,4,8,16].includes(qualifiers.length)){
    $("#bracketStatus").textContent=`Hay ${qualifiers.length} clasificados. Deben ser 2, 4, 8 o 16.`;
    return;
  }

  const phase=qualifiers.length===2?"final":qualifiers.length===4?"semifinal":"quarterfinal";
  const pairs=worldCupOpeningPairs(qualifiers,groups,q);
  const rows=pairs.map(([a,b],i)=>({tournament_id:tid,phase,round_no:i+1,side_a:a.id,side_b:b.id,status:"scheduled"}));
  const {error}=await supabase.from("matches").insert(rows);
  if(error){alert(error.message);return}
  await supabase.from("tournaments").update({config:{...t.config,repechage,third_place:third}}).eq("id",tid);
  await refreshTournamentState(tid);
}
async function advanceKnockout(tid,finishedPhase){
  const t=tournamentById(tid);if(!t)return;

  if(finishedPhase==="repechage"){
    await generateKnockoutRows(tid);
    return;
  }

  if(finishedPhase==="quarterfinal"){
    const matches=tournamentMatches(tid).filter(m=>m.phase==="quarterfinal");
    if(matches.length&&matches.every(m=>["finished","walkover"].includes(m.status)) &&
       !tournamentMatches(tid).some(m=>m.phase==="semifinal")){
      const winners=matches.map(m=>m.winner_id);
      const rows=[];
      for(let i=0;i<winners.length;i+=2)rows.push({tournament_id:tid,phase:"semifinal",round_no:1,side_a:winners[i],side_b:winners[i+1],status:"scheduled"});
      await supabase.from("matches").insert(rows);
    }
  }

  if(finishedPhase==="semifinal"){
    const semis=tournamentMatches(tid).filter(m=>m.phase==="semifinal");
    if(semis.length===2&&semis.every(m=>["finished","walkover"].includes(m.status)) &&
       !tournamentMatches(tid).some(m=>m.phase==="final")){
      const winners=semis.map(m=>m.winner_id);
      const losers=semis.map(m=>m.side_a===m.winner_id?m.side_b:m.side_a);
      const rows=[{tournament_id:tid,phase:"final",round_no:1,side_a:winners[0],side_b:winners[1],status:"scheduled"}];
      if(t.config?.third_place!==false)rows.push({tournament_id:tid,phase:"third_place",round_no:1,side_a:losers[0],side_b:losers[1],status:"scheduled"});
      await supabase.from("matches").insert(rows);
    }
  }

  if(finishedPhase==="final"){
    const third=tournamentMatches(tid).find(m=>m.phase==="third_place");
    if(!third||["finished","walkover"].includes(third.status)){
      await supabase.from("tournaments").update({status:"finished"}).eq("id",tid);
    }else{
      await supabase.from("tournaments").update({status:"active"}).eq("id",tid);
    }
  }
  if(finishedPhase==="third_place"){
    const final=tournamentMatches(tid).find(m=>m.phase==="final");
    if(final&&["finished","walkover"].includes(final.status)){
      await supabase.from("tournaments").update({status:"finished"}).eq("id",tid);
    }
  }
  await loadAll();$("#adminTournamentSelect").value=tid;renderMatchAdmin();renderKnockoutPanel();
}
function renderKnockoutPanel(){
  const tid=$("#adminTournamentSelect").value,t=tournamentById(tid);if(!t)return;
  $("#enableRepechage").checked=!!t.config?.repechage;
  $("#enableThirdPlace").checked=t.config?.third_place!==false;
  $("#enableRepechage").disabled=isRoundRobinTournament(t);
  $("#enableThirdPlace").disabled=isRoundRobinTournament(t);
  const done=isGroupStageComplete(tid);
  $("#bracketStatus").textContent=isRoundRobinTournament(t)?(done?"Todos los enfrentamientos finalizaron.":"Todos los jugadores se enfrentarán una vez entre sí; no hay eliminatorias."):done?"La fase de grupos terminó. Las eliminatorias se generan automáticamente.":"Las eliminatorias aparecerán al finalizar todas las peleas de grupos.";
  renderTournamentMatchCount();
  const ms=tournamentMatches(tid).filter(m=>m.phase!=="group");
  $("#knockoutBracket").innerHTML=ms.map(m=>`<div class="card knockout-card">
    <span class="pill">${esc(m.phase)}</span>
    <div class="teams" style="margin-top:10px"><span>${esc(participantName(m.side_a))}</span><span>VS</span><span>${esc(participantName(m.side_b))}</span></div>
    <div class="muted">${m.scheduled_at?new Date(m.scheduled_at).toLocaleString("es-BO"):"Sin horario"} · ${esc(m.status)}</div>
  </div>`).join("")||'<div class="muted">Aún no hay cruces eliminatorios.</div>';
}
$("#enableRepechage").onchange=async()=>{
  const tid=$("#adminTournamentSelect").value,t=tournamentById(tid);if(!t||isRoundRobinTournament(t))return;
  renderTournamentMatchCount();
  await supabase.from("tournaments").update({config:{...t.config,repechage:$("#enableRepechage").checked}}).eq("id",tid);
  await loadAll();$("#adminTournamentSelect").value=tid;renderKnockoutPanel();
  if(isGroupStageComplete(tid))await autoGenerateKnockout(tid);
};
$("#enableThirdPlace").onchange=async()=>{
  const tid=$("#adminTournamentSelect").value,t=tournamentById(tid);if(!t||isRoundRobinTournament(t))return;
  renderTournamentMatchCount();
  await supabase.from("tournaments").update({config:{...t.config,third_place:$("#enableThirdPlace").checked}}).eq("id",tid);
  await loadAll();$("#adminTournamentSelect").value=tid;renderKnockoutPanel();
};

const POKEMON_POOLS={
  common:[{"dex":10,"code":"0010","name":"Caterpie","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":11,"code":"0011","name":"Metapod","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":12,"code":"0012","name":"Butterfree","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":13,"code":"0013","name":"Weedle","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":14,"code":"0014","name":"Kakuna","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":15,"code":"0015","name":"Beedrill","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":16,"code":"0016","name":"Pidgey","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":17,"code":"0017","name":"Pidgeotto","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":18,"code":"0018","name":"Pidgeot","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":19,"code":"0019","name":"Rattata","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":20,"code":"0020","name":"Raticate","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":21,"code":"0021","name":"Spearow","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":22,"code":"0022","name":"Fearow","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":23,"code":"0023","name":"Ekans","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":24,"code":"0024","name":"Arbok","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":25,"code":"0025","name":"Pikachu","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":26,"code":"0026","name":"Raichu","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":27,"code":"0027","name":"Sandshrew","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":28,"code":"0028","name":"Sandslash","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":29,"code":"0029","name":"Nidoran♀","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":30,"code":"0030","name":"Nidorina","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":31,"code":"0031","name":"Nidoqueen","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":32,"code":"0032","name":"Nidoran♂","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":33,"code":"0033","name":"Nidorino","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":34,"code":"0034","name":"Nidoking","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":35,"code":"0035","name":"Clefairy","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":36,"code":"0036","name":"Clefable","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":37,"code":"0037","name":"Vulpix","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":38,"code":"0038","name":"Ninetales","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":39,"code":"0039","name":"Jigglypuff","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":40,"code":"0040","name":"Wigglytuff","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":41,"code":"0041","name":"Zubat","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":42,"code":"0042","name":"Golbat","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":43,"code":"0043","name":"Oddish","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":44,"code":"0044","name":"Gloom","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":45,"code":"0045","name":"Vileplume","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":46,"code":"0046","name":"Paras","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":47,"code":"0047","name":"Parasect","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":48,"code":"0048","name":"Venonat","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":49,"code":"0049","name":"Venomoth","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":50,"code":"0050","name":"Diglett","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":51,"code":"0051","name":"Dugtrio","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":52,"code":"0052","name":"Meowth","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":53,"code":"0053","name":"Persian","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":54,"code":"0054","name":"Psyduck","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":55,"code":"0055","name":"Golduck","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":56,"code":"0056","name":"Mankey","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":57,"code":"0057","name":"Primeape","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":58,"code":"0058","name":"Growlithe","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":59,"code":"0059","name":"Arcanine","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":60,"code":"0060","name":"Poliwag","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":61,"code":"0061","name":"Poliwhirl","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":62,"code":"0062","name":"Poliwrath","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":63,"code":"0063","name":"Abra","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":64,"code":"0064","name":"Kadabra","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":65,"code":"0065","name":"Alakazam","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":66,"code":"0066","name":"Machop","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":67,"code":"0067","name":"Machoke","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":68,"code":"0068","name":"Machamp","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":69,"code":"0069","name":"Bellsprout","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":70,"code":"0070","name":"Weepinbell","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":71,"code":"0071","name":"Victreebel","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":72,"code":"0072","name":"Tentacool","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":73,"code":"0073","name":"Tentacruel","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":74,"code":"0074","name":"Geodude","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":75,"code":"0075","name":"Graveler","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":76,"code":"0076","name":"Golem","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":77,"code":"0077","name":"Ponyta","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":78,"code":"0078","name":"Rapidash","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":79,"code":"0079","name":"Slowpoke","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":80,"code":"0080","name":"Slowbro","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":81,"code":"0081","name":"Magnemite","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":82,"code":"0082","name":"Magneton","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":83,"code":"0083","name":"Farfetch'd","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":84,"code":"0084","name":"Doduo","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":85,"code":"0085","name":"Dodrio","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":86,"code":"0086","name":"Seel","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":87,"code":"0087","name":"Dewgong","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":88,"code":"0088","name":"Grimer","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":89,"code":"0089","name":"Muk","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":90,"code":"0090","name":"Shellder","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":91,"code":"0091","name":"Cloyster","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":92,"code":"0092","name":"Gastly","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":93,"code":"0093","name":"Haunter","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":94,"code":"0094","name":"Gengar","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":95,"code":"0095","name":"Onix","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":96,"code":"0096","name":"Drowzee","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":97,"code":"0097","name":"Hypno","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":98,"code":"0098","name":"Krabby","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":99,"code":"0099","name":"Kingler","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":100,"code":"0100","name":"Voltorb","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":101,"code":"0101","name":"Electrode","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":102,"code":"0102","name":"Exeggcute","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":103,"code":"0103","name":"Exeggutor","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":104,"code":"0104","name":"Cubone","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":105,"code":"0105","name":"Marowak","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":106,"code":"0106","name":"Hitmonlee","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":107,"code":"0107","name":"Hitmonchan","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":108,"code":"0108","name":"Lickitung","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":109,"code":"0109","name":"Koffing","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":110,"code":"0110","name":"Weezing","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":111,"code":"0111","name":"Rhyhorn","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":112,"code":"0112","name":"Rhydon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":113,"code":"0113","name":"Chansey","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":114,"code":"0114","name":"Tangela","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":115,"code":"0115","name":"Kangaskhan","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":116,"code":"0116","name":"Horsea","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":117,"code":"0117","name":"Seadra","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":118,"code":"0118","name":"Goldeen","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":119,"code":"0119","name":"Seaking","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":120,"code":"0120","name":"Staryu","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":121,"code":"0121","name":"Starmie","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":122,"code":"0122","name":"Mr. Mime","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":123,"code":"0123","name":"Scyther","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":124,"code":"0124","name":"Jynx","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":125,"code":"0125","name":"Electabuzz","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":126,"code":"0126","name":"Magmar","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":127,"code":"0127","name":"Pinsir","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":128,"code":"0128","name":"Tauros","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":129,"code":"0129","name":"Magikarp","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":130,"code":"0130","name":"Gyarados","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":131,"code":"0131","name":"Lapras","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":132,"code":"0132","name":"Ditto","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":133,"code":"0133","name":"Eevee","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":134,"code":"0134","name":"Vaporeon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":135,"code":"0135","name":"Jolteon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":136,"code":"0136","name":"Flareon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":137,"code":"0137","name":"Porygon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":143,"code":"0143","name":"Snorlax","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":161,"code":"0161","name":"Sentret","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":162,"code":"0162","name":"Furret","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":163,"code":"0163","name":"Hoothoot","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":164,"code":"0164","name":"Noctowl","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":165,"code":"0165","name":"Ledyba","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":166,"code":"0166","name":"Ledian","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":167,"code":"0167","name":"Spinarak","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":168,"code":"0168","name":"Ariados","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":169,"code":"0169","name":"Crobat","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":170,"code":"0170","name":"Chinchou","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":171,"code":"0171","name":"Lanturn","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":172,"code":"0172","name":"Pichu","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":173,"code":"0173","name":"Cleffa","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":174,"code":"0174","name":"Igglybuff","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":175,"code":"0175","name":"Togepi","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":176,"code":"0176","name":"Togetic","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":177,"code":"0177","name":"Natu","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":178,"code":"0178","name":"Xatu","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":179,"code":"0179","name":"Mareep","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":180,"code":"0180","name":"Flaaffy","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":181,"code":"0181","name":"Ampharos","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":182,"code":"0182","name":"Bellossom","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":183,"code":"0183","name":"Marill","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":184,"code":"0184","name":"Azumarill","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":185,"code":"0185","name":"Sudowoodo","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":186,"code":"0186","name":"Politoed","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":187,"code":"0187","name":"Hoppip","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":188,"code":"0188","name":"Skiploom","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":189,"code":"0189","name":"Jumpluff","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":190,"code":"0190","name":"Aipom","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":191,"code":"0191","name":"Sunkern","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":192,"code":"0192","name":"Sunflora","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":193,"code":"0193","name":"Yanma","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":194,"code":"0194","name":"Wooper","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":195,"code":"0195","name":"Quagsire","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":196,"code":"0196","name":"Espeon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":197,"code":"0197","name":"Umbreon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":198,"code":"0198","name":"Murkrow","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":199,"code":"0199","name":"Slowking","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":200,"code":"0200","name":"Misdreavus","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":201,"code":"0201","name":"Unown","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":202,"code":"0202","name":"Wobbuffet","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":203,"code":"0203","name":"Girafarig","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":204,"code":"0204","name":"Pineco","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":205,"code":"0205","name":"Forretress","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":206,"code":"0206","name":"Dunsparce","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":207,"code":"0207","name":"Gligar","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":208,"code":"0208","name":"Steelix","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":209,"code":"0209","name":"Snubbull","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":210,"code":"0210","name":"Granbull","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":211,"code":"0211","name":"Qwilfish","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":212,"code":"0212","name":"Scizor","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":213,"code":"0213","name":"Shuckle","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":214,"code":"0214","name":"Heracross","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":215,"code":"0215","name":"Sneasel","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":216,"code":"0216","name":"Teddiursa","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":217,"code":"0217","name":"Ursaring","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":218,"code":"0218","name":"Slugma","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":219,"code":"0219","name":"Magcargo","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":220,"code":"0220","name":"Swinub","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":221,"code":"0221","name":"Piloswine","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":222,"code":"0222","name":"Corsola","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":223,"code":"0223","name":"Remoraid","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":224,"code":"0224","name":"Octillery","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":225,"code":"0225","name":"Delibird","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":226,"code":"0226","name":"Mantine","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":227,"code":"0227","name":"Skarmory","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":228,"code":"0228","name":"Houndour","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":229,"code":"0229","name":"Houndoom","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":230,"code":"0230","name":"Kingdra","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":231,"code":"0231","name":"Phanpy","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":232,"code":"0232","name":"Donphan","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":233,"code":"0233","name":"Porygon2","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":234,"code":"0234","name":"Stantler","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":235,"code":"0235","name":"Smeargle","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":236,"code":"0236","name":"Tyrogue","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":237,"code":"0237","name":"Hitmontop","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":238,"code":"0238","name":"Smoochum","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":239,"code":"0239","name":"Elekid","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":240,"code":"0240","name":"Magby","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":241,"code":"0241","name":"Miltank","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":242,"code":"0242","name":"Blissey","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":261,"code":"0261","name":"Poochyena","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":262,"code":"0262","name":"Mightyena","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":263,"code":"0263","name":"Zigzagoon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":264,"code":"0264","name":"Linoone","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":265,"code":"0265","name":"Wurmple","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":266,"code":"0266","name":"Silcoon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":267,"code":"0267","name":"Beautifly","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":268,"code":"0268","name":"Cascoon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":269,"code":"0269","name":"Dustox","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":270,"code":"0270","name":"Lotad","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":271,"code":"0271","name":"Lombre","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":272,"code":"0272","name":"Ludicolo","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":273,"code":"0273","name":"Seedot","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":274,"code":"0274","name":"Nuzleaf","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":275,"code":"0275","name":"Shiftry","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":276,"code":"0276","name":"Taillow","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":277,"code":"0277","name":"Swellow","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":278,"code":"0278","name":"Wingull","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":279,"code":"0279","name":"Pelipper","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":280,"code":"0280","name":"Ralts","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":281,"code":"0281","name":"Kirlia","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":282,"code":"0282","name":"Gardevoir","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":283,"code":"0283","name":"Surskit","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":284,"code":"0284","name":"Masquerain","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":285,"code":"0285","name":"Shroomish","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":286,"code":"0286","name":"Breloom","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":287,"code":"0287","name":"Slakoth","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":288,"code":"0288","name":"Vigoroth","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":289,"code":"0289","name":"Slaking","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":290,"code":"0290","name":"Nincada","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":291,"code":"0291","name":"Ninjask","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":292,"code":"0292","name":"Shedinja","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":293,"code":"0293","name":"Whismur","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":294,"code":"0294","name":"Loudred","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":295,"code":"0295","name":"Exploud","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":296,"code":"0296","name":"Makuhita","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":297,"code":"0297","name":"Hariyama","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":298,"code":"0298","name":"Azurill","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":299,"code":"0299","name":"Nosepass","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":300,"code":"0300","name":"Skitty","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":301,"code":"0301","name":"Delcatty","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":302,"code":"0302","name":"Sableye","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":303,"code":"0303","name":"Mawile","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":304,"code":"0304","name":"Aron","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":305,"code":"0305","name":"Lairon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":306,"code":"0306","name":"Aggron","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":307,"code":"0307","name":"Meditite","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":308,"code":"0308","name":"Medicham","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":309,"code":"0309","name":"Electrike","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":310,"code":"0310","name":"Manectric","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":311,"code":"0311","name":"Plusle","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":312,"code":"0312","name":"Minun","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":313,"code":"0313","name":"Volbeat","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":314,"code":"0314","name":"Illumise","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":315,"code":"0315","name":"Roselia","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":316,"code":"0316","name":"Gulpin","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":317,"code":"0317","name":"Swalot","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":318,"code":"0318","name":"Carvanha","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":319,"code":"0319","name":"Sharpedo","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":320,"code":"0320","name":"Wailmer","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":321,"code":"0321","name":"Wailord","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":322,"code":"0322","name":"Numel","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":323,"code":"0323","name":"Camerupt","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":324,"code":"0324","name":"Torkoal","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":325,"code":"0325","name":"Spoink","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":326,"code":"0326","name":"Grumpig","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":327,"code":"0327","name":"Spinda","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":328,"code":"0328","name":"Trapinch","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":329,"code":"0329","name":"Vibrava","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":330,"code":"0330","name":"Flygon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":331,"code":"0331","name":"Cacnea","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":332,"code":"0332","name":"Cacturne","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":333,"code":"0333","name":"Swablu","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":334,"code":"0334","name":"Altaria","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":335,"code":"0335","name":"Zangoose","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":336,"code":"0336","name":"Seviper","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":337,"code":"0337","name":"Lunatone","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":338,"code":"0338","name":"Solrock","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":339,"code":"0339","name":"Barboach","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":340,"code":"0340","name":"Whiscash","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":341,"code":"0341","name":"Corphish","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":342,"code":"0342","name":"Crawdaunt","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":343,"code":"0343","name":"Baltoy","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":344,"code":"0344","name":"Claydol","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":349,"code":"0349","name":"Feebas","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":350,"code":"0350","name":"Milotic","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":351,"code":"0351","name":"Castform","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":352,"code":"0352","name":"Kecleon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":353,"code":"0353","name":"Shuppet","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":354,"code":"0354","name":"Banette","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":355,"code":"0355","name":"Duskull","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":356,"code":"0356","name":"Dusclops","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":357,"code":"0357","name":"Tropius","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":358,"code":"0358","name":"Chimecho","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":359,"code":"0359","name":"Absol","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":360,"code":"0360","name":"Wynaut","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":361,"code":"0361","name":"Snorunt","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":362,"code":"0362","name":"Glalie","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":363,"code":"0363","name":"Spheal","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":364,"code":"0364","name":"Sealeo","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":365,"code":"0365","name":"Walrein","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":366,"code":"0366","name":"Clamperl","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":367,"code":"0367","name":"Huntail","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":368,"code":"0368","name":"Gorebyss","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":369,"code":"0369","name":"Relicanth","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":370,"code":"0370","name":"Luvdisc","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":396,"code":"0396","name":"Starly","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":397,"code":"0397","name":"Staravia","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":398,"code":"0398","name":"Staraptor","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":399,"code":"0399","name":"Bidoof","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":400,"code":"0400","name":"Bibarel","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":401,"code":"0401","name":"Kricketot","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":402,"code":"0402","name":"Kricketune","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":403,"code":"0403","name":"Shinx","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":404,"code":"0404","name":"Luxio","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":405,"code":"0405","name":"Luxray","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":406,"code":"0406","name":"Budew","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":407,"code":"0407","name":"Roserade","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":412,"code":"0412","name":"Burmy","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":413,"code":"0413","name":"Wormadam","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":414,"code":"0414","name":"Mothim","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":415,"code":"0415","name":"Combee","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":416,"code":"0416","name":"Vespiquen","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":417,"code":"0417","name":"Pachirisu","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":418,"code":"0418","name":"Buizel","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":419,"code":"0419","name":"Floatzel","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":420,"code":"0420","name":"Cherubi","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":421,"code":"0421","name":"Cherrim","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":422,"code":"0422","name":"Shellos","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":423,"code":"0423","name":"Gastrodon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":424,"code":"0424","name":"Ambipom","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":425,"code":"0425","name":"Drifloon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":426,"code":"0426","name":"Drifblim","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":427,"code":"0427","name":"Buneary","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":428,"code":"0428","name":"Lopunny","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":429,"code":"0429","name":"Mismagius","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":430,"code":"0430","name":"Honchkrow","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":431,"code":"0431","name":"Glameow","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":432,"code":"0432","name":"Purugly","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":433,"code":"0433","name":"Chingling","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":434,"code":"0434","name":"Stunky","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":435,"code":"0435","name":"Skuntank","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":436,"code":"0436","name":"Bronzor","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":437,"code":"0437","name":"Bronzong","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":438,"code":"0438","name":"Bonsly","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":439,"code":"0439","name":"Mime Jr.","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":440,"code":"0440","name":"Happiny","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":441,"code":"0441","name":"Chatot","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":442,"code":"0442","name":"Spiritomb","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":446,"code":"0446","name":"Munchlax","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":447,"code":"0447","name":"Riolu","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":448,"code":"0448","name":"Lucario","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":449,"code":"0449","name":"Hippopotas","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":450,"code":"0450","name":"Hippowdon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":451,"code":"0451","name":"Skorupi","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":452,"code":"0452","name":"Drapion","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":453,"code":"0453","name":"Croagunk","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":454,"code":"0454","name":"Toxicroak","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":455,"code":"0455","name":"Carnivine","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":456,"code":"0456","name":"Finneon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":457,"code":"0457","name":"Lumineon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":458,"code":"0458","name":"Mantyke","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":459,"code":"0459","name":"Snover","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":460,"code":"0460","name":"Abomasnow","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":461,"code":"0461","name":"Weavile","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":462,"code":"0462","name":"Magnezone","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":463,"code":"0463","name":"Lickilicky","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":464,"code":"0464","name":"Rhyperior","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":465,"code":"0465","name":"Tangrowth","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":466,"code":"0466","name":"Electivire","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":467,"code":"0467","name":"Magmortar","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":468,"code":"0468","name":"Togekiss","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":469,"code":"0469","name":"Yanmega","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":470,"code":"0470","name":"Leafeon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":471,"code":"0471","name":"Glaceon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":472,"code":"0472","name":"Gliscor","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":473,"code":"0473","name":"Mamoswine","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":474,"code":"0474","name":"Porygon-Z","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":475,"code":"0475","name":"Gallade","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":476,"code":"0476","name":"Probopass","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":477,"code":"0477","name":"Dusknoir","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":478,"code":"0478","name":"Froslass","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":479,"code":"0479","name":"Rotom","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":504,"code":"0504","name":"Patrat","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":505,"code":"0505","name":"Watchog","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":506,"code":"0506","name":"Lillipup","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":507,"code":"0507","name":"Herdier","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":508,"code":"0508","name":"Stoutland","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":509,"code":"0509","name":"Purrloin","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":510,"code":"0510","name":"Liepard","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":511,"code":"0511","name":"Pansage","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":512,"code":"0512","name":"Simisage","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":513,"code":"0513","name":"Pansear","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":514,"code":"0514","name":"Simisear","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":515,"code":"0515","name":"Panpour","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":516,"code":"0516","name":"Simipour","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":517,"code":"0517","name":"Munna","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":518,"code":"0518","name":"Musharna","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":519,"code":"0519","name":"Pidove","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":520,"code":"0520","name":"Tranquill","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":521,"code":"0521","name":"Unfezant","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":522,"code":"0522","name":"Blitzle","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":523,"code":"0523","name":"Zebstrika","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":524,"code":"0524","name":"Roggenrola","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":525,"code":"0525","name":"Boldore","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":526,"code":"0526","name":"Gigalith","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":527,"code":"0527","name":"Woobat","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":528,"code":"0528","name":"Swoobat","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":529,"code":"0529","name":"Drilbur","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":530,"code":"0530","name":"Excadrill","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":531,"code":"0531","name":"Audino","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":532,"code":"0532","name":"Timburr","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":533,"code":"0533","name":"Gurdurr","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":534,"code":"0534","name":"Conkeldurr","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":535,"code":"0535","name":"Tympole","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":536,"code":"0536","name":"Palpitoad","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":537,"code":"0537","name":"Seismitoad","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":538,"code":"0538","name":"Throh","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":539,"code":"0539","name":"Sawk","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":540,"code":"0540","name":"Sewaddle","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":541,"code":"0541","name":"Swadloon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":542,"code":"0542","name":"Leavanny","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":543,"code":"0543","name":"Venipede","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":544,"code":"0544","name":"Whirlipede","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":545,"code":"0545","name":"Scolipede","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":546,"code":"0546","name":"Cottonee","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":547,"code":"0547","name":"Whimsicott","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":548,"code":"0548","name":"Petilil","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":549,"code":"0549","name":"Lilligant","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":550,"code":"0550","name":"Basculin","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":551,"code":"0551","name":"Sandile","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":552,"code":"0552","name":"Krokorok","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":553,"code":"0553","name":"Krookodile","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":554,"code":"0554","name":"Darumaka","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":555,"code":"0555","name":"Darmanitan","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":556,"code":"0556","name":"Maractus","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":557,"code":"0557","name":"Dwebble","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":558,"code":"0558","name":"Crustle","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":559,"code":"0559","name":"Scraggy","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":560,"code":"0560","name":"Scrafty","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":561,"code":"0561","name":"Sigilyph","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":562,"code":"0562","name":"Yamask","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":563,"code":"0563","name":"Cofagrigus","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":568,"code":"0568","name":"Trubbish","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":569,"code":"0569","name":"Garbodor","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":570,"code":"0570","name":"Zorua","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":571,"code":"0571","name":"Zoroark","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":572,"code":"0572","name":"Minccino","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":573,"code":"0573","name":"Cinccino","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":574,"code":"0574","name":"Gothita","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":575,"code":"0575","name":"Gothorita","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":576,"code":"0576","name":"Gothitelle","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":577,"code":"0577","name":"Solosis","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":578,"code":"0578","name":"Duosion","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":579,"code":"0579","name":"Reuniclus","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":580,"code":"0580","name":"Ducklett","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":581,"code":"0581","name":"Swanna","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":582,"code":"0582","name":"Vanillite","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":583,"code":"0583","name":"Vanillish","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":584,"code":"0584","name":"Vanilluxe","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":585,"code":"0585","name":"Deerling","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":586,"code":"0586","name":"Sawsbuck","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":587,"code":"0587","name":"Emolga","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":588,"code":"0588","name":"Karrablast","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":589,"code":"0589","name":"Escavalier","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":590,"code":"0590","name":"Foongus","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":591,"code":"0591","name":"Amoonguss","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":592,"code":"0592","name":"Frillish","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":593,"code":"0593","name":"Jellicent","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":594,"code":"0594","name":"Alomomola","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":595,"code":"0595","name":"Joltik","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":596,"code":"0596","name":"Galvantula","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":597,"code":"0597","name":"Ferroseed","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":598,"code":"0598","name":"Ferrothorn","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":599,"code":"0599","name":"Klink","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":600,"code":"0600","name":"Klang","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":601,"code":"0601","name":"Klinklang","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":602,"code":"0602","name":"Tynamo","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":603,"code":"0603","name":"Eelektrik","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":604,"code":"0604","name":"Eelektross","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":605,"code":"0605","name":"Elgyem","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":606,"code":"0606","name":"Beheeyem","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":607,"code":"0607","name":"Litwick","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":608,"code":"0608","name":"Lampent","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":609,"code":"0609","name":"Chandelure","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":610,"code":"0610","name":"Axew","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":611,"code":"0611","name":"Fraxure","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":612,"code":"0612","name":"Haxorus","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":613,"code":"0613","name":"Cubchoo","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":614,"code":"0614","name":"Beartic","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":615,"code":"0615","name":"Cryogonal","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":616,"code":"0616","name":"Shelmet","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":617,"code":"0617","name":"Accelgor","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":618,"code":"0618","name":"Stunfisk","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":619,"code":"0619","name":"Mienfoo","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":620,"code":"0620","name":"Mienshao","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":621,"code":"0621","name":"Druddigon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":622,"code":"0622","name":"Golett","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":623,"code":"0623","name":"Golurk","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":624,"code":"0624","name":"Pawniard","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":625,"code":"0625","name":"Bisharp","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":626,"code":"0626","name":"Bouffalant","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":627,"code":"0627","name":"Rufflet","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":628,"code":"0628","name":"Braviary","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":629,"code":"0629","name":"Vullaby","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":630,"code":"0630","name":"Mandibuzz","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":631,"code":"0631","name":"Heatmor","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":632,"code":"0632","name":"Durant","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":636,"code":"0636","name":"Larvesta","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":637,"code":"0637","name":"Volcarona","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":659,"code":"0659","name":"Bunnelby","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":660,"code":"0660","name":"Diggersby","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":661,"code":"0661","name":"Fletchling","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":662,"code":"0662","name":"Fletchinder","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":663,"code":"0663","name":"Talonflame","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":664,"code":"0664","name":"Scatterbug","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":665,"code":"0665","name":"Spewpa","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":666,"code":"0666","name":"Vivillon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":667,"code":"0667","name":"Litleo","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":668,"code":"0668","name":"Pyroar","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":669,"code":"0669","name":"Flabébé","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":670,"code":"0670","name":"Floette","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":671,"code":"0671","name":"Florges","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":672,"code":"0672","name":"Skiddo","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":673,"code":"0673","name":"Gogoat","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":674,"code":"0674","name":"Pancham","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":675,"code":"0675","name":"Pangoro","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":676,"code":"0676","name":"Furfrou","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":677,"code":"0677","name":"Espurr","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":678,"code":"0678","name":"Meowstic","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":679,"code":"0679","name":"Honedge","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":680,"code":"0680","name":"Doublade","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":681,"code":"0681","name":"Aegislash","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":682,"code":"0682","name":"Spritzee","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":683,"code":"0683","name":"Aromatisse","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":684,"code":"0684","name":"Swirlix","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":685,"code":"0685","name":"Slurpuff","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":686,"code":"0686","name":"Inkay","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":687,"code":"0687","name":"Malamar","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":688,"code":"0688","name":"Binacle","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":689,"code":"0689","name":"Barbaracle","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":690,"code":"0690","name":"Skrelp","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":691,"code":"0691","name":"Dragalge","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":692,"code":"0692","name":"Clauncher","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":693,"code":"0693","name":"Clawitzer","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":694,"code":"0694","name":"Helioptile","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":695,"code":"0695","name":"Heliolisk","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":700,"code":"0700","name":"Sylveon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":701,"code":"0701","name":"Hawlucha","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":702,"code":"0702","name":"Dedenne","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":703,"code":"0703","name":"Carbink","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":707,"code":"0707","name":"Klefki","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":708,"code":"0708","name":"Phantump","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":709,"code":"0709","name":"Trevenant","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":710,"code":"0710","name":"Pumpkaboo","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":711,"code":"0711","name":"Gourgeist","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":712,"code":"0712","name":"Bergmite","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":713,"code":"0713","name":"Avalugg","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":714,"code":"0714","name":"Noibat","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":715,"code":"0715","name":"Noivern","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":731,"code":"0731","name":"Pikipek","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":732,"code":"0732","name":"Trumbeak","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":733,"code":"0733","name":"Toucannon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":734,"code":"0734","name":"Yungoos","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":735,"code":"0735","name":"Gumshoos","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":736,"code":"0736","name":"Grubbin","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":737,"code":"0737","name":"Charjabug","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":738,"code":"0738","name":"Vikavolt","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":739,"code":"0739","name":"Crabrawler","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":740,"code":"0740","name":"Crabominable","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":741,"code":"0741","name":"Oricorio","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":742,"code":"0742","name":"Cutiefly","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":743,"code":"0743","name":"Ribombee","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":744,"code":"0744","name":"Rockruff","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":745,"code":"0745","name":"Lycanroc","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":746,"code":"0746","name":"Wishiwashi","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":747,"code":"0747","name":"Mareanie","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":748,"code":"0748","name":"Toxapex","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":749,"code":"0749","name":"Mudbray","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":750,"code":"0750","name":"Mudsdale","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":751,"code":"0751","name":"Dewpider","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":752,"code":"0752","name":"Araquanid","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":753,"code":"0753","name":"Fomantis","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":754,"code":"0754","name":"Lurantis","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":755,"code":"0755","name":"Morelull","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":756,"code":"0756","name":"Shiinotic","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":757,"code":"0757","name":"Salandit","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":758,"code":"0758","name":"Salazzle","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":759,"code":"0759","name":"Stufful","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":760,"code":"0760","name":"Bewear","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":761,"code":"0761","name":"Bounsweet","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":762,"code":"0762","name":"Steenee","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":763,"code":"0763","name":"Tsareena","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":764,"code":"0764","name":"Comfey","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":765,"code":"0765","name":"Oranguru","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":766,"code":"0766","name":"Passimian","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":767,"code":"0767","name":"Wimpod","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":768,"code":"0768","name":"Golisopod","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":769,"code":"0769","name":"Sandygast","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":770,"code":"0770","name":"Palossand","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":771,"code":"0771","name":"Pyukumuku","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":774,"code":"0774","name":"Minior","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":775,"code":"0775","name":"Komala","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":776,"code":"0776","name":"Turtonator","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":777,"code":"0777","name":"Togedemaru","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":778,"code":"0778","name":"Mimikyu","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":779,"code":"0779","name":"Bruxish","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":780,"code":"0780","name":"Drampa","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":781,"code":"0781","name":"Dhelmise","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":819,"code":"0819","name":"Skwovet","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":820,"code":"0820","name":"Greedent","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":821,"code":"0821","name":"Rookidee","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":822,"code":"0822","name":"Corvisquire","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":823,"code":"0823","name":"Corviknight","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":824,"code":"0824","name":"Blipbug","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":825,"code":"0825","name":"Dottler","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":826,"code":"0826","name":"Orbeetle","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":827,"code":"0827","name":"Nickit","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":828,"code":"0828","name":"Thievul","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":829,"code":"0829","name":"Gossifleur","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":830,"code":"0830","name":"Eldegoss","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":831,"code":"0831","name":"Wooloo","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":832,"code":"0832","name":"Dubwool","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":833,"code":"0833","name":"Chewtle","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":834,"code":"0834","name":"Drednaw","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":835,"code":"0835","name":"Yamper","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":836,"code":"0836","name":"Boltund","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":837,"code":"0837","name":"Rolycoly","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":838,"code":"0838","name":"Carkol","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":839,"code":"0839","name":"Coalossal","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":840,"code":"0840","name":"Applin","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":841,"code":"0841","name":"Flapple","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":842,"code":"0842","name":"Appletun","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":843,"code":"0843","name":"Silicobra","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":844,"code":"0844","name":"Sandaconda","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":845,"code":"0845","name":"Cramorant","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":846,"code":"0846","name":"Arrokuda","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":847,"code":"0847","name":"Barraskewda","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":848,"code":"0848","name":"Toxel","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":849,"code":"0849","name":"Toxtricity","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":850,"code":"0850","name":"Sizzlipede","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":851,"code":"0851","name":"Centiskorch","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":852,"code":"0852","name":"Clobbopus","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":853,"code":"0853","name":"Grapploct","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":854,"code":"0854","name":"Sinistea","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":855,"code":"0855","name":"Polteageist","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":856,"code":"0856","name":"Hatenna","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":857,"code":"0857","name":"Hattrem","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":858,"code":"0858","name":"Hatterene","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":859,"code":"0859","name":"Impidimp","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":860,"code":"0860","name":"Morgrem","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":861,"code":"0861","name":"Grimmsnarl","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":862,"code":"0862","name":"Obstagoon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":863,"code":"0863","name":"Perrserker","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":864,"code":"0864","name":"Cursola","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":865,"code":"0865","name":"Sirfetch'd","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":866,"code":"0866","name":"Mr. Rime","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":867,"code":"0867","name":"Runerigus","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":868,"code":"0868","name":"Milcery","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":869,"code":"0869","name":"Alcremie","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":870,"code":"0870","name":"Falinks","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":871,"code":"0871","name":"Pincurchin","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":872,"code":"0872","name":"Snom","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":873,"code":"0873","name":"Frosmoth","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":874,"code":"0874","name":"Stonjourner","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":875,"code":"0875","name":"Eiscue","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":876,"code":"0876","name":"Indeedee","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":877,"code":"0877","name":"Morpeko","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":878,"code":"0878","name":"Cufant","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":879,"code":"0879","name":"Copperajah","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":884,"code":"0884","name":"Duraludon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":899,"code":"0899","name":"Wyrdeer","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":900,"code":"0900","name":"Kleavor","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":901,"code":"0901","name":"Ursaluna","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":902,"code":"0902","name":"Basculegion","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":903,"code":"0903","name":"Sneasler","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":904,"code":"0904","name":"Overqwil","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":915,"code":"0915","name":"Lechonk","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":916,"code":"0916","name":"Oinkologne","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":917,"code":"0917","name":"Tarountula","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":918,"code":"0918","name":"Spidops","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":919,"code":"0919","name":"Nymble","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":920,"code":"0920","name":"Lokix","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":921,"code":"0921","name":"Pawmi","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":922,"code":"0922","name":"Pawmo","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":923,"code":"0923","name":"Pawmot","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":924,"code":"0924","name":"Tandemaus","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":925,"code":"0925","name":"Maushold","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":926,"code":"0926","name":"Fidough","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":927,"code":"0927","name":"Dachsbun","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":928,"code":"0928","name":"Smoliv","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":929,"code":"0929","name":"Dolliv","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":930,"code":"0930","name":"Arboliva","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":931,"code":"0931","name":"Squawkabilly","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":932,"code":"0932","name":"Nacli","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":933,"code":"0933","name":"Naclstack","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":934,"code":"0934","name":"Garganacl","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":935,"code":"0935","name":"Charcadet","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":936,"code":"0936","name":"Armarouge","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":937,"code":"0937","name":"Ceruledge","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":938,"code":"0938","name":"Tadbulb","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":939,"code":"0939","name":"Bellibolt","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":940,"code":"0940","name":"Wattrel","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":941,"code":"0941","name":"Kilowattrel","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":942,"code":"0942","name":"Maschiff","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":943,"code":"0943","name":"Mabosstiff","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":944,"code":"0944","name":"Shroodle","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":945,"code":"0945","name":"Grafaiai","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":946,"code":"0946","name":"Bramblin","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":947,"code":"0947","name":"Brambleghast","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":948,"code":"0948","name":"Toedscool","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":949,"code":"0949","name":"Toedscruel","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":950,"code":"0950","name":"Klawf","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":951,"code":"0951","name":"Capsakid","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":952,"code":"0952","name":"Scovillain","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":953,"code":"0953","name":"Rellor","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":954,"code":"0954","name":"Rabsca","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":955,"code":"0955","name":"Flittle","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":956,"code":"0956","name":"Espathra","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":957,"code":"0957","name":"Tinkatink","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":958,"code":"0958","name":"Tinkatuff","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":959,"code":"0959","name":"Tinkaton","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":960,"code":"0960","name":"Wiglett","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":961,"code":"0961","name":"Wugtrio","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":962,"code":"0962","name":"Bombirdier","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":963,"code":"0963","name":"Finizen","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":964,"code":"0964","name":"Palafin","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":965,"code":"0965","name":"Varoom","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":966,"code":"0966","name":"Revavroom","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":967,"code":"0967","name":"Cyclizar","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":968,"code":"0968","name":"Orthworm","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":969,"code":"0969","name":"Glimmet","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":970,"code":"0970","name":"Glimmora","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":971,"code":"0971","name":"Greavard","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":972,"code":"0972","name":"Houndstone","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":973,"code":"0973","name":"Flamigo","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":974,"code":"0974","name":"Cetoddle","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":975,"code":"0975","name":"Cetitan","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":976,"code":"0976","name":"Veluza","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":977,"code":"0977","name":"Dondozo","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":978,"code":"0978","name":"Tatsugiri","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":979,"code":"0979","name":"Annihilape","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":980,"code":"0980","name":"Clodsire","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":981,"code":"0981","name":"Farigiraf","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":982,"code":"0982","name":"Dudunsparce","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":983,"code":"0983","name":"Kingambit","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":999,"code":"0999","name":"Gimmighoul","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":1000,"code":"1000","name":"Gholdengo","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":1011,"code":"1011","name":"Dipplin","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":1012,"code":"1012","name":"Poltchageist","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":1013,"code":"1013","name":"Sinistcha","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":1018,"code":"1018","name":"Archaludon","category":"Común","categoryKey":"common","difficulty":"Muy común"},{"dex":1019,"code":"1019","name":"Hydrapple","category":"Común","categoryKey":"common","difficulty":"Muy común"}],
  hard:[{"dex":1,"code":"0001","name":"Bulbasaur","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":2,"code":"0002","name":"Ivysaur","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":3,"code":"0003","name":"Venusaur","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":4,"code":"0004","name":"Charmander","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":5,"code":"0005","name":"Charmeleon","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":6,"code":"0006","name":"Charizard","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":7,"code":"0007","name":"Squirtle","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":8,"code":"0008","name":"Wartortle","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":9,"code":"0009","name":"Blastoise","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":152,"code":"0152","name":"Chikorita","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":153,"code":"0153","name":"Bayleef","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":154,"code":"0154","name":"Meganium","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":155,"code":"0155","name":"Cyndaquil","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":156,"code":"0156","name":"Quilava","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":157,"code":"0157","name":"Typhlosion","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":158,"code":"0158","name":"Totodile","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":159,"code":"0159","name":"Croconaw","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":160,"code":"0160","name":"Feraligatr","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":252,"code":"0252","name":"Treecko","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":253,"code":"0253","name":"Grovyle","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":254,"code":"0254","name":"Sceptile","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":255,"code":"0255","name":"Torchic","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":256,"code":"0256","name":"Combusken","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":257,"code":"0257","name":"Blaziken","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":258,"code":"0258","name":"Mudkip","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":259,"code":"0259","name":"Marshtomp","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":260,"code":"0260","name":"Swampert","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":387,"code":"0387","name":"Turtwig","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":388,"code":"0388","name":"Grotle","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":389,"code":"0389","name":"Torterra","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":390,"code":"0390","name":"Chimchar","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":391,"code":"0391","name":"Monferno","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":392,"code":"0392","name":"Infernape","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":393,"code":"0393","name":"Piplup","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":394,"code":"0394","name":"Prinplup","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":395,"code":"0395","name":"Empoleon","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":495,"code":"0495","name":"Snivy","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":496,"code":"0496","name":"Servine","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":497,"code":"0497","name":"Serperior","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":498,"code":"0498","name":"Tepig","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":499,"code":"0499","name":"Pignite","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":500,"code":"0500","name":"Emboar","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":501,"code":"0501","name":"Oshawott","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":502,"code":"0502","name":"Dewott","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":503,"code":"0503","name":"Samurott","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":650,"code":"0650","name":"Chespin","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":651,"code":"0651","name":"Quilladin","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":652,"code":"0652","name":"Chesnaught","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":653,"code":"0653","name":"Fennekin","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":654,"code":"0654","name":"Braixen","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":655,"code":"0655","name":"Delphox","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":656,"code":"0656","name":"Froakie","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":657,"code":"0657","name":"Frogadier","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":658,"code":"0658","name":"Greninja","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":722,"code":"0722","name":"Rowlet","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":723,"code":"0723","name":"Dartrix","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":724,"code":"0724","name":"Decidueye","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":725,"code":"0725","name":"Litten","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":726,"code":"0726","name":"Torracat","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":727,"code":"0727","name":"Incineroar","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":728,"code":"0728","name":"Popplio","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":729,"code":"0729","name":"Brionne","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":730,"code":"0730","name":"Primarina","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":810,"code":"0810","name":"Grookey","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":811,"code":"0811","name":"Thwackey","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":812,"code":"0812","name":"Rillaboom","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":813,"code":"0813","name":"Scorbunny","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":814,"code":"0814","name":"Raboot","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":815,"code":"0815","name":"Cinderace","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":816,"code":"0816","name":"Sobble","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":817,"code":"0817","name":"Drizzile","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":818,"code":"0818","name":"Inteleon","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":906,"code":"0906","name":"Sprigatito","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":907,"code":"0907","name":"Floragato","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":908,"code":"0908","name":"Meowscarada","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":909,"code":"0909","name":"Fuecoco","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":910,"code":"0910","name":"Crocalor","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":911,"code":"0911","name":"Skeledirge","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":912,"code":"0912","name":"Quaxly","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":913,"code":"0913","name":"Quaxwell","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"},{"dex":914,"code":"0914","name":"Quaquaval","category":"Inicial","categoryKey":"starter","difficulty":"Difícil"}],
  fossil:[{"dex":138,"code":"0138","name":"Omanyte","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":139,"code":"0139","name":"Omastar","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":140,"code":"0140","name":"Kabuto","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":141,"code":"0141","name":"Kabutops","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":142,"code":"0142","name":"Aerodactyl","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":345,"code":"0345","name":"Lileep","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":346,"code":"0346","name":"Cradily","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":347,"code":"0347","name":"Anorith","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":348,"code":"0348","name":"Armaldo","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":408,"code":"0408","name":"Cranidos","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":409,"code":"0409","name":"Rampardos","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":410,"code":"0410","name":"Shieldon","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":411,"code":"0411","name":"Bastiodon","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":564,"code":"0564","name":"Tirtouga","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":565,"code":"0565","name":"Carracosta","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":566,"code":"0566","name":"Archen","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":567,"code":"0567","name":"Archeops","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":696,"code":"0696","name":"Tyrunt","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":697,"code":"0697","name":"Tyrantrum","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":698,"code":"0698","name":"Amaura","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":699,"code":"0699","name":"Aurorus","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":880,"code":"0880","name":"Dracozolt","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":881,"code":"0881","name":"Arctozolt","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":882,"code":"0882","name":"Dracovish","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"},{"dex":883,"code":"0883","name":"Arctovish","category":"Fósil","categoryKey":"fossil","difficulty":"Extremadamente raro"}],
  veryHard:[{"dex":147,"code":"0147","name":"Dratini","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":148,"code":"0148","name":"Dragonair","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":149,"code":"0149","name":"Dragonite","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":246,"code":"0246","name":"Larvitar","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":247,"code":"0247","name":"Pupitar","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":248,"code":"0248","name":"Tyranitar","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":371,"code":"0371","name":"Bagon","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":372,"code":"0372","name":"Shelgon","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":373,"code":"0373","name":"Salamence","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":374,"code":"0374","name":"Beldum","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":375,"code":"0375","name":"Metang","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":376,"code":"0376","name":"Metagross","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":443,"code":"0443","name":"Gible","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":444,"code":"0444","name":"Gabite","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":445,"code":"0445","name":"Garchomp","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":633,"code":"0633","name":"Deino","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":634,"code":"0634","name":"Zweilous","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":635,"code":"0635","name":"Hydreigon","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":704,"code":"0704","name":"Goomy","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":705,"code":"0705","name":"Sliggoo","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":706,"code":"0706","name":"Goodra","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":782,"code":"0782","name":"Jangmo-o","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":783,"code":"0783","name":"Hakamo-o","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":784,"code":"0784","name":"Kommo-o","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":885,"code":"0885","name":"Dreepy","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":886,"code":"0886","name":"Drakloak","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":887,"code":"0887","name":"Dragapult","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":996,"code":"0996","name":"Frigibax","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":997,"code":"0997","name":"Arctibax","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"},{"dex":998,"code":"0998","name":"Baxcalibur","category":"Pseudolegendario","categoryKey":"pseudo","difficulty":"Muy difícil"}],
  legendary:[{"dex":150,"code":"0150","name":"Mewtwo","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":249,"code":"0249","name":"Lugia","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":250,"code":"0250","name":"Ho-oh","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":382,"code":"0382","name":"Kyogre","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":383,"code":"0383","name":"Groudon","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":384,"code":"0384","name":"Rayquaza","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":483,"code":"0483","name":"Dialga","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":484,"code":"0484","name":"Palkia","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":487,"code":"0487","name":"Giratina","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":643,"code":"0643","name":"Reshiram","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":644,"code":"0644","name":"Zekrom","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":646,"code":"0646","name":"Kyurem","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":716,"code":"0716","name":"Xerneas","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":717,"code":"0717","name":"Yveltal","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":718,"code":"0718","name":"Zygarde","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":791,"code":"0791","name":"Solgaleo","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":792,"code":"0792","name":"Lunala","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":800,"code":"0800","name":"Necrozma","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":888,"code":"0888","name":"Zacian","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":889,"code":"0889","name":"Zamazenta","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":890,"code":"0890","name":"Eternatus","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":898,"code":"0898","name":"Calyrex","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":1007,"code":"1007","name":"Koraidon","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":1008,"code":"1008","name":"Miraidon","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"},{"dex":1024,"code":"1024","name":"Terapagos","category":"Legendario","categoryKey":"legendary","difficulty":"Casi imposible"}],
  sublegendary:[{"dex":144,"code":"0144","name":"Articuno","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":145,"code":"0145","name":"Zapdos","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":146,"code":"0146","name":"Moltres","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":243,"code":"0243","name":"Raikou","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":244,"code":"0244","name":"Entei","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":245,"code":"0245","name":"Suicune","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":377,"code":"0377","name":"Regirock","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":378,"code":"0378","name":"Regice","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":379,"code":"0379","name":"Registeel","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":380,"code":"0380","name":"Latias","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":381,"code":"0381","name":"Latios","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":480,"code":"0480","name":"Uxie","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":481,"code":"0481","name":"Mesprit","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":482,"code":"0482","name":"Azelf","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":485,"code":"0485","name":"Heatran","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":486,"code":"0486","name":"Regigigas","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":488,"code":"0488","name":"Cresselia","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":638,"code":"0638","name":"Cobalion","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":639,"code":"0639","name":"Terrakion","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":640,"code":"0640","name":"Virizion","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":641,"code":"0641","name":"Tornadus","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":642,"code":"0642","name":"Thundurus","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":645,"code":"0645","name":"Landorus","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":772,"code":"0772","name":"Type: Null","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":773,"code":"0773","name":"Silvally","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":785,"code":"0785","name":"Tapu Koko","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":786,"code":"0786","name":"Tapu Lele","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":787,"code":"0787","name":"Tapu Bulu","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":788,"code":"0788","name":"Tapu Fini","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":891,"code":"0891","name":"Kubfu","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":892,"code":"0892","name":"Urshifu","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":894,"code":"0894","name":"Regieleki","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":895,"code":"0895","name":"Regidrago","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":896,"code":"0896","name":"Glastrier","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":897,"code":"0897","name":"Spectrier","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":905,"code":"0905","name":"Enamorus","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":1001,"code":"1001","name":"Wo-Chien","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":1002,"code":"1002","name":"Chien-Pao","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":1003,"code":"1003","name":"Ting-Lu","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":1004,"code":"1004","name":"Chi-Yu","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":1014,"code":"1014","name":"Okidogi","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":1015,"code":"1015","name":"Munkidori","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":1016,"code":"1016","name":"Fezandipiti","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"},{"dex":1017,"code":"1017","name":"Ogerpon","category":"Sublegendario","categoryKey":"sublegendary","difficulty":"Casi imposible"}],
  mythical:[{"dex":151,"code":"0151","name":"Mew","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":251,"code":"0251","name":"Celebi","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":385,"code":"0385","name":"Jirachi","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":386,"code":"0386","name":"Deoxys","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":489,"code":"0489","name":"Phione","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":490,"code":"0490","name":"Manaphy","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":491,"code":"0491","name":"Darkrai","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":492,"code":"0492","name":"Shaymin","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":493,"code":"0493","name":"Arceus","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":494,"code":"0494","name":"Victini","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":647,"code":"0647","name":"Keldeo","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":648,"code":"0648","name":"Meloetta","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":649,"code":"0649","name":"Genesect","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":719,"code":"0719","name":"Diancie","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":720,"code":"0720","name":"Hoopa","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":721,"code":"0721","name":"Volcanion","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":801,"code":"0801","name":"Magearna","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":802,"code":"0802","name":"Marshadow","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":807,"code":"0807","name":"Zeraora","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":808,"code":"0808","name":"Meltan","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":809,"code":"0809","name":"Melmetal","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":893,"code":"0893","name":"Zarude","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"},{"dex":1025,"code":"1025","name":"Pecharunt","category":"Mítico","categoryKey":"mythical","difficulty":"Casi imposible"}],
  ultraBeast:[{"dex":793,"code":"0793","name":"Nihilego","category":"Ultraente","categoryKey":"ultrabeast","difficulty":"Casi imposible"},{"dex":794,"code":"0794","name":"Buzzwole","category":"Ultraente","categoryKey":"ultrabeast","difficulty":"Casi imposible"},{"dex":795,"code":"0795","name":"Pheromosa","category":"Ultraente","categoryKey":"ultrabeast","difficulty":"Casi imposible"},{"dex":796,"code":"0796","name":"Xurkitree","category":"Ultraente","categoryKey":"ultrabeast","difficulty":"Casi imposible"},{"dex":797,"code":"0797","name":"Celesteela","category":"Ultraente","categoryKey":"ultrabeast","difficulty":"Casi imposible"},{"dex":798,"code":"0798","name":"Kartana","category":"Ultraente","categoryKey":"ultrabeast","difficulty":"Casi imposible"},{"dex":799,"code":"0799","name":"Guzzlord","category":"Ultraente","categoryKey":"ultrabeast","difficulty":"Casi imposible"},{"dex":803,"code":"0803","name":"Poipole","category":"Ultraente","categoryKey":"ultrabeast","difficulty":"Casi imposible"},{"dex":804,"code":"0804","name":"Naganadel","category":"Ultraente","categoryKey":"ultrabeast","difficulty":"Casi imposible"},{"dex":805,"code":"0805","name":"Stakataka","category":"Ultraente","categoryKey":"ultrabeast","difficulty":"Casi imposible"},{"dex":806,"code":"0806","name":"Blacephalon","category":"Ultraente","categoryKey":"ultrabeast","difficulty":"Casi imposible"}],
  paradox:[{"dex":984,"code":"0984","name":"Great Tusk","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":985,"code":"0985","name":"Scream Tail","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":986,"code":"0986","name":"Brute Bonnet","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":987,"code":"0987","name":"Flutter Mane","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":988,"code":"0988","name":"Slither Wing","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":989,"code":"0989","name":"Sandy Shocks","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":990,"code":"0990","name":"Iron Treads","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":991,"code":"0991","name":"Iron Bundle","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":992,"code":"0992","name":"Iron Hands","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":993,"code":"0993","name":"Iron Jugulis","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":994,"code":"0994","name":"Iron Moth","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":995,"code":"0995","name":"Iron Thorns","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":1005,"code":"1005","name":"Roaring Moon","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":1006,"code":"1006","name":"Iron Valiant","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":1009,"code":"1009","name":"Walking Wake","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":1010,"code":"1010","name":"Iron Leaves","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":1020,"code":"1020","name":"Gouging Fire","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":1021,"code":"1021","name":"Raging Bolt","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":1022,"code":"1022","name":"Iron Boulder","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"},{"dex":1023,"code":"1023","name":"Iron Crown","category":"Paradoja","categoryKey":"paradox","difficulty":"Casi imposible"}],
  specialInitial:[{"dex":789,"code":"0789","name":"Cosmog","category":"Fase específica","categoryKey":"special","difficulty":"Casi imposible"},{"dex":790,"code":"0790","name":"Cosmoem","category":"Fase específica","categoryKey":"special","difficulty":"Casi imposible"}]
};
const ALL_POKEMON=Object.values(POKEMON_POOLS).flat().sort((a,b)=>a.dex-b.dex);
const IMPOSSIBLE_CATEGORIES=[
  {name:'Legendario',key:'legendary',pool:POKEMON_POOLS.legendary},
  {name:'Mítico',key:'mythical',pool:POKEMON_POOLS.mythical},
  {name:'Sublegendario',key:'sublegendary',pool:POKEMON_POOLS.sublegendary},
  {name:'Ultraente',key:'ultrabeast',pool:POKEMON_POOLS.ultraBeast},
  {name:'Paradoja',key:'paradox',pool:POKEMON_POOLS.paradox},
  {name:'Fase inicial específica',key:'special',pool:POKEMON_POOLS.specialInitial}
];
function randomItem(items,rng=Math.random){return items[Math.floor(rng()*items.length)]}
function seededRandom(seedText){let h=2166136261;for(const ch of seedText){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return()=>{h+=0x6D2B79F5;let t=h;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
function sundayWeekKey(){const now=new Date();const local=new Date(new Intl.DateTimeFormat('en-US',{timeZone:CONFIG.DAILY_WHEEL_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(now));const day=local.getDay();local.setDate(local.getDate()-day);return local.toISOString().slice(0,10)}
function pokemonDisplay(p){return `${p.code} - ${p.name}`}
function normalizePokemonPrize(p){return {...p,pokemon:pokemonDisplay(p)}}
const REGIONAL_FORMS={
  19:['alola'],20:['alola'],26:['alola'],27:['alola'],28:['alola'],37:['alola'],38:['alola'],50:['alola'],51:['alola'],
  52:['alola','galar'],53:['alola'],74:['alola'],75:['alola'],76:['alola'],88:['alola'],89:['alola'],103:['alola'],105:['alola'],
  77:['galar'],78:['galar'],79:['galar'],80:['galar'],83:['galar'],110:['galar'],122:['galar'],144:['galar'],145:['galar'],146:['galar'],
  199:['galar'],222:['galar'],263:['galar'],264:['galar'],554:['galar'],555:['galar'],562:['galar'],618:['galar'],
  58:['hisui'],59:['hisui'],100:['hisui'],101:['hisui'],157:['hisui'],211:['hisui'],215:['hisui'],503:['hisui'],549:['hisui'],
  570:['hisui'],571:['hisui'],628:['hisui'],705:['hisui'],706:['hisui'],713:['hisui'],724:['hisui'],901:['hisui']
};
const REGIONAL_FORM_LABELS={normal:'Forma normal',alola:'Forma de Alola',galar:'Forma de Galar',hisui:'Forma de Hisui'};
function applyRegionalForm(prize,rng=Math.random){
  if(prize.regionalForm)return prize;
  const available=REGIONAL_FORMS[Number(prize.dex)]||[];
  if(!available.length)return {...prize,regionalForm:null,regionalFormLabel:null};
  const regionalForm=randomItem(['normal',...available],rng);
  const regionalFormLabel=REGIONAL_FORM_LABELS[regionalForm];
  return {
    ...prize,
    regionalForm,
    regionalFormLabel,
    label:`${prize.pokemon} · ${prize.category} · ${regionalFormLabel}`,
    rewardLabel:`${prize.pokemon} — ${prize.category} (${prize.difficulty}) — ${regionalFormLabel}`
  };
}
function impossiblePokemon(rng=Math.random){const category=randomItem(IMPOSSIBLE_CATEGORIES,rng);return normalizePokemonPrize(randomItem(category.pool,rng))}
function pokemonReward(category,rng=Math.random){
  if(category==='impossible')return impossiblePokemon(rng);
  const pool=POKEMON_POOLS[category]||POKEMON_POOLS.common;
  return normalizePokemonPrize(randomItem(pool,rng));
}
const POKEMON_GENERATIONS={
  1:{label:'1ra generación',min:1,max:151},2:{label:'2da generación',min:152,max:251},3:{label:'3ra generación',min:252,max:386},
  4:{label:'4ta generación',min:387,max:493},5:{label:'5ta generación',min:494,max:649},6:{label:'6ta generación',min:650,max:721},
  7:{label:'7ma generación',min:722,max:809},8:{label:'8va generación',min:810,max:905},9:{label:'9na generación',min:906,max:1025}
};
function selectedPaidGeneration(){const value=$('#paidGenerationSelect')?.value||'all';return value==='all'?null:Number(value)}
function generationPokemonPool(generation){const range=POKEMON_GENERATIONS[generation];return range?ALL_POKEMON.filter(p=>p.dex>=range.min&&p.dex<=range.max):ALL_POKEMON}
function pokemonGenerationNumber(dex){
  const entry=Object.entries(POKEMON_GENERATIONS).find(([,range])=>dex>=range.min&&dex<=range.max);
  return entry?Number(entry[0]):null;
}
function normalizePokemonSearchText(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}
function renderPokemonGenerationSearch(){
  const input=$('#pokemonGenerationSearch');
  const results=$('#pokemonGenerationSearchResults');
  if(!input||!results)return;
  const raw=input.value.trim();
  if(!raw){results.textContent='Escribe al menos un carácter para buscar.';return}
  const query=normalizePokemonSearchText(raw);
  const numeric=raw.replace(/^0+/,'');
  const matches=ALL_POKEMON.filter(p=>{
    const name=normalizePokemonSearchText(p.name);
    const code=String(p.code);
    return name.includes(query)||code.includes(raw)||String(p.dex)===numeric;
  }).slice(0,30);
  if(!matches.length){results.innerHTML='<span class="muted">No se encontró ningún Pokémon.</span>';return}
  results.innerHTML=matches.map(p=>{
    const generation=pokemonGenerationNumber(p.dex);
    const generationLabel=generation?POKEMON_GENERATIONS[generation].label:'Generación desconocida';
    return `<div class="pokemon-search-result"><strong>${esc(p.code)} - ${esc(p.name)}</strong><span>${esc(generationLabel)}</span></div>`;
  }).join('');
}
function createGenerationPokemonPrize(generation){
  const pool=generationPokemonPool(generation);
  // Al elegir una generación, los Pokémon que no son comunes tienen
  // una probabilidad individual 5 veces menor que los comunes.
  const weightedPool=pool.map(p=>({pokemon:p,weight:p.categoryKey==='common'?1:0.2}));
  const selected=weightedPick(weightedPool).pokemon;
  const p=normalizePokemonPrize(selected);
  return applyRegionalForm({...p,label:`${p.pokemon} · ${p.category}`,rewardLabel:`${p.pokemon} — ${p.category} (${p.difficulty})`});
}
function paidSpinPricing(){const generation=selectedPaidGeneration();return generation?{one:500,ten:4500,generation}:{one:100,ten:900,generation:null}}
function updatePaidSpinControls(){
  const pricing=paidSpinPricing();
  $('#spinPaidButton').textContent=`1 tiro · ${pricing.one} créditos`;
  $('#spinPaidTenButton').textContent=`10 tiros · ${pricing.ten} créditos`;
  $('#reelNext').textContent=pricing.generation?`${POKEMON_GENERATIONS[pricing.generation].label} · ${pricing.one} créditos por tiro`:`${pricing.one} créditos por tiro`;
}
function weeklyDailyPrizes(){
  const rng=seededRandom('daily-wheel-'+sundayWeekKey());
  const impossible=impossiblePokemon(rng);
  const candidates=[
    ()=>{const credits=50+Math.floor(rng()*51);return {label:`${credits} créditos`,credits,weight:1}},
    ()=>{const p=pokemonReward('common',rng);return {label:`${p.pokemon} · ${p.category}`,rewardLabel:`${p.pokemon} — ${p.category} (${p.difficulty})`,weight:1}},
    ()=>({label:'5 Caramelos Raros',weight:1}),
    ()=>{const credits=250+Math.floor(rng()*251);return {label:`${credits} créditos`,credits,weight:1}},
    ()=>({label:'10 Caramelos Raros',weight:1}),
    ()=>{const p=pokemonReward('hard',rng);return {label:`${p.pokemon} · ${p.category}`,rewardLabel:`${p.pokemon} — ${p.category} (${p.difficulty})`,weight:1}},
    ()=>{const credits=5000+Math.floor(rng()*5001);return {label:`${credits} créditos`,credits,weight:1}},
    ()=>({label:'40 Caramelos Raros',weight:1}),
    ()=>({label:'Convertir un Pokémon en shiny',weight:1})
  ];
  for(let i=candidates.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]]}
  return [
    {label:`${impossible.pokemon} · ${impossible.category}`,rewardLabel:`${impossible.pokemon} — ${impossible.category} (${impossible.difficulty})`,weight:1},
    ...candidates.slice(0,6).map(fn=>fn())
  ];
}
const dailyPrizes=weeklyDailyPrizes();
function renderWeeklyDailyPrizes(){
  const list=$('#weeklyDailyPrizeList');
  if(!list)return;
  list.innerHTML=dailyPrizes.map((prize,index)=>`<div class="daily-prize-chip"><strong>${index+1}.</strong> ${esc(prize.label)}</div>`).join('');
}
function millisecondsUntilNextDailySpin(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:CONFIG.DAILY_WHEEL_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  const nextMidnightBoliviaUtc=Date.UTC(Number(values.year),Number(values.month)-1,Number(values.day)+1,4,0,0);
  return Math.max(0,nextMidnightBoliviaUtc-Date.now());
}
function formatDailyCountdown(ms){
  const total=Math.max(0,Math.floor(ms/1000));
  const hours=Math.floor(total/3600);
  const minutes=Math.floor((total%3600)/60);
  const seconds=total%60;
  return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
}
function startDailyCountdown(){
  clearInterval(dailyCountdownTimer);
  const button=$('#spinDailyButton');
  if(!button)return;
  const tick=()=>{
    const remaining=millisecondsUntilNextDailySpin();
    if(remaining<=0){clearInterval(dailyCountdownTimer);updateDailyButton();return}
    button.textContent=`Próximo giro en ${formatDailyCountdown(remaining)}`;
  };
  tick();
  dailyCountdownTimer=setInterval(tick,1000);
}
const paidCategories=[
  {label:'Pokémon común',weight:94.82,key:'common'},
  {label:'Pokémon inicial',weight:3,key:'hard'},
  {label:'Pseudolegendario',weight:0.1,key:'veryHard'},
  {label:'Legendario / mítico / especial',weight:0.08,key:'impossible'},
  {label:'Pokémon fósil',weight:2,key:'fossil'}
];
function weightedPick(items){let r=Math.random()*items.reduce((sum,item)=>sum+item.weight,0);for(const item of items){r-=item.weight;if(r<=0)return item}return items[items.length-1]}
function createPaidPokemonPrize(){const generation=selectedPaidGeneration();if(generation)return createGenerationPokemonPrize(generation);const category=weightedPick(paidCategories);return createPaidPokemonPrizeForCategory(category.key)}
$('#paidGenerationSelect').onchange=()=>{pendingPaidReward=null;$('#acceptPaidReward').hidden=true;$('#paidResult').textContent='Sin girar.';updatePaidSpinControls()};
updatePaidSpinControls();
function randomDailyPreview(){return randomItem(dailyPrizes)}
function setDailyReelPrize(prize,previousLabel='',nextLabel=''){
  $('#dailyReelPrizeName').textContent=prize.label;
  $('#dailyReelPrevious').textContent=previousLabel||randomDailyPreview().label;
  $('#dailyReelNext').textContent=nextLabel||randomDailyPreview().label;
}
async function animateDailyPrizeReel(finalPrize){
  const reel=$('#dailyPrizeReel');
  reel.classList.remove('finished');reel.classList.add('spinning');
  const delays=[45,45,45,45,50,50,55,55,60,65,70,75,85,95,110,130,155,185,220,270,330,420];
  let previous=randomDailyPreview();
  for(const delay of delays){
    const current=randomDailyPreview(),next=randomDailyPreview();
    setDailyReelPrize(current,previous.label,next.label);
    previous=current;
    await wait(delay);
  }
  setDailyReelPrize(finalPrize,previous.label,finalPrize.label);
  reel.classList.remove('spinning');reel.classList.add('finished');
  await wait(250);
}
async function updateDailyButton(){
  const button=$('#spinDailyButton');
  clearInterval(dailyCountdownTimer);
  if(!state.account){button.disabled=true;button.textContent='Girar una vez al día';return}
  const {data}=await supabase.from('daily_spins').select('account_id').eq('account_id',state.account.id).eq('spin_date',todayBolivia()).maybeSingle();
  button.disabled=!!data;
  if(data)startDailyCountdown();
  else button.textContent='Girar una vez al día';
}
async function grantWheelReward(prize,source){
  const label=prize.rewardLabel||prize.label;
  if(prize.credits){await supabase.from('accounts').update({credits:state.account.credits+prize.credits}).eq('id',state.account.id)}
  else await supabase.from('rewards').insert({account_id:state.account.id,source,label});
  return label;
}
$('#spinDailyButton').onclick=async()=>{
  if(!state.account)return;
  const button=$('#spinDailyButton');
  button.disabled=true;
  const pick=weightedPick(dailyPrizes);
  await animateDailyPrizeReel(pick);
  const label=pick.rewardLabel||pick.label;
  const {error}=await supabase.from('daily_spins').insert({account_id:state.account.id,spin_date:todayBolivia(),reward_label:label});
  if(error){alert('Ya giraste hoy.');await updateDailyButton();return}
  await grantWheelReward(pick,'Ruleta diaria');
  $('#dailyResult').textContent='Premio: '+label;await loadAll();
};
const PAID_CATEGORY_CLASSES=['category-legendary','category-mythical','category-sublegendary','category-ultrabeast','category-paradox','category-special','category-pseudo','category-starter','category-fossil','category-common'];
function setPaidReelPokemon(prize,previousName='',nextName=''){
  const categoryEl=$('#reelPokemonCategory');
  $('#reelPokemonName').textContent=prize.pokemon;
  categoryEl.textContent=prize.category;
  categoryEl.classList.remove(...PAID_CATEGORY_CLASSES);
  categoryEl.classList.add(`category-${prize.categoryKey||'common'}`);
  const formEl=$('#reelPokemonForm');
  if(formEl){
    formEl.hidden=!prize.regionalFormLabel;
    formEl.textContent=prize.regionalFormLabel||'';
    formEl.className=`pokemon-form${prize.regionalForm?` form-${prize.regionalForm}`:''}`;
  }
  $('#reelPrevious').textContent=previousName||randomPaidPreview().pokemon;
  $('#reelNext').textContent=nextName||randomPaidPreview().pokemon;
}
function randomPaidPreview(){return createPaidPokemonPrize()}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function animatePaidPokemonReel(finalPrize){
  const reel=$('#paidPokemonReel');
  reel.classList.remove('finished');reel.classList.add('spinning');
  const delays=[45,45,45,45,50,50,55,55,60,65,70,75,85,95,110,130,155,185,220,270,330,420];
  let previous=randomPaidPreview();
  for(const delay of delays){
    const current=randomPaidPreview(),next=randomPaidPreview();
    setPaidReelPokemon(current,previous.pokemon,next.pokemon);
    previous=current;
    await wait(delay);
  }
  setPaidReelPokemon(finalPrize,previous.pokemon,finalPrize.pokemon);
  reel.classList.remove('spinning');reel.classList.add('finished');
  await wait(250);
}
async function paidSpin(){
  const finalPrize=createPaidPokemonPrize();
  await animatePaidPokemonReel(finalPrize);
  return finalPrize;
}
function createPaidPokemonPrizeForCategory(key){const p=pokemonReward(key);return applyRegionalForm({...p,label:`${p.pokemon} · ${p.category}`,rewardLabel:`${p.pokemon} — ${p.category} (${p.difficulty})`})}
$('#spinPaidButton').onclick=async()=>{
  const pricing=paidSpinPricing();
  if(!state.account||state.account.credits<pricing.one){alert(`Necesitas ${pricing.one} créditos.`);return}
  $('#spinPaidButton').disabled=true;$('#spinPaidTenButton').disabled=true;$('#paidGenerationSelect').disabled=true;
  try{
    const {error}=await supabase.from('accounts').update({credits:state.account.credits-pricing.one}).eq('id',state.account.id);
    if(error)throw error;
    pendingPaidReward=await paidSpin();
    $('#paidResult').innerHTML=`Salió: <strong>${esc(pendingPaidReward.pokemon)}</strong><br><span class="pokemon-category category-${esc(pendingPaidReward.categoryKey)}">${esc(pendingPaidReward.category)}</span>${pendingPaidReward.regionalFormLabel?` <span class="pokemon-form form-${esc(pendingPaidReward.regionalForm)}">${esc(pendingPaidReward.regionalFormLabel)}</span>`:''}`;
    $('#acceptPaidReward').hidden=false;
    await loadAll();
  }catch(error){console.error(error);$('#paidResult').textContent='No se pudo completar el giro.'}
  finally{$('#spinPaidButton').disabled=false;$('#spinPaidTenButton').disabled=false;$('#paidGenerationSelect').disabled=false}
};
$('#spinPaidTenButton').onclick=async()=>{
  const pricing=paidSpinPricing();
  if(!state.account||state.account.credits<pricing.ten){alert(`Necesitas ${pricing.ten} créditos.`);return}
  $('#spinPaidTenButton').disabled=true;$('#spinPaidButton').disabled=true;$('#paidGenerationSelect').disabled=true;
  try{
    const rewards=Array.from({length:10},()=>createPaidPokemonPrize());
    const {error:creditError}=await supabase.from('accounts').update({credits:state.account.credits-pricing.ten}).eq('id',state.account.id);
    if(creditError)throw creditError;
    const rows=rewards.map(prize=>({account_id:state.account.id,source:'Ruleta Pokémon x10',label:prize.rewardLabel||prize.label||`${prize.pokemon} — ${prize.category}`}));
    const {error:rewardError}=await supabase.from('rewards').insert(rows);
    if(rewardError)throw rewardError;
    $('#paidResult').innerHTML='<strong>10 resultados:</strong><br>'+rewards.map((prize,index)=>`${index+1}. ${esc(prize.rewardLabel||prize.label||`${prize.pokemon} — ${prize.category}`)}`).join('<br>');
    pendingPaidReward=null;$('#acceptPaidReward').hidden=true;
    await loadAll();
  }catch(error){
    console.error(error);
    $('#paidResult').textContent='No se pudieron guardar los 10 resultados.';
  }finally{
    $('#spinPaidTenButton').disabled=false;$('#spinPaidButton').disabled=false;$('#paidGenerationSelect').disabled=false;
  }
};
$('#acceptPaidReward').onclick=async()=>{
  if(!pendingPaidReward||!state.account)return;
  await supabase.from('rewards').insert({account_id:state.account.id,source:'Ruleta Pokémon',label:pendingPaidReward.rewardLabel||pendingPaidReward.label});
  pendingPaidReward=null;$('#acceptPaidReward').hidden=true;$('#paidResult').textContent='Recompensa añadida.';await loadAll();
};
const DELIVERY_MINECRAFT_USERS={
  davi:"davicowww",
  erickcld:"ErickCST",
  lix:"LixitoRoa",
  olise:"OLISE",
  tycrays:"Tycrays",
  volterwf:"Volterwf",
  japi:"xJAPlx",
  zapi:"Z4P131"
};
function minecraftUsernameForAccount(username){
  return DELIVERY_MINECRAFT_USERS[String(username||"").trim().toLowerCase()]||String(username||"").trim();
}
function pokemonNameFromRewardLabel(label){
  let name=String(label||"").split(/\s+—\s+/)[0].trim();
  name=name.replace(/^\d{1,4}\s*[-–—]\s*/,"").trim();
  return name;
}
function pokemonRegionFromRewardLabel(label){
  const text=String(label||"").toLowerCase();
  if(text.includes("forma de alola"))return "alola";
  if(text.includes("forma de galar"))return "galar";
  if(text.includes("forma de hisui"))return "hisui";
  return "";
}
function rewardPokemonCommandPart(reward,level){
  const name=pokemonNameFromRewardLabel(reward?.label);
  if(!name)return "";
  const region=pokemonRegionFromRewardLabel(reward?.label);
  return `${name} ${level}${region?` ${region}`:""}`;
}
async function copyTextToClipboard(text){
  if(navigator.clipboard?.writeText){
    await navigator.clipboard.writeText(text);
    return;
  }
  const area=document.createElement("textarea");
  area.value=text;area.style.position="fixed";area.style.opacity="0";
  document.body.appendChild(area);area.select();
  const ok=document.execCommand("copy");area.remove();
  if(!ok)throw new Error("No se pudo copiar");
}

function renderRewards(){
  const mine=state.account?state.rewards.filter(r=>r.account_id===state.account.id):[];
  const available=mine.filter(r=>r.status==="available");
  const pending=mine.filter(r=>r.status==="requested");
  const current=state.rewardTab==="requested"?pending:available;

  state.selectedRewardIds=new Set([...state.selectedRewardIds].filter(id=>available.some(r=>r.id===id)));

  $$("[data-reward-tab]").forEach(button=>{
    const active=button.dataset.rewardTab===state.rewardTab;
    button.classList.toggle("active",active);
    button.setAttribute("aria-selected",active?"true":"false");
    button.onclick=()=>{
      state.rewardTab=button.dataset.rewardTab;
      state.selectedRewardIds.clear();
      renderRewards();
    };
  });

  const bulkActions=$("#rewardBulkActions");
  if(bulkActions)bulkActions.hidden=state.rewardTab!=="available";

  if(state.rewardTab==="available"){
    $("#myRewards").innerHTML=current.map(r=>`<div class="card reward-card"><div class="reward-card-main"><div><strong>${esc(r.label)}</strong><div class="muted">${esc(r.source)}</div></div><label class="reward-check" title="Seleccionar recompensa"><input type="checkbox" data-select-reward="${r.id}" ${state.selectedRewardIds.has(r.id)?"checked":""}><span></span></label></div></div>`).join("")||'<div class="muted">No tienes recompensas sin reclamar.</div>';
  }else{
    $("#myRewards").innerHTML=current.map(r=>`<div class="card reward-card pending-reward"><strong>${esc(r.label)}</strong><div class="muted">${esc(r.source)} · Pendiente de entrega</div></div>`).join("")||'<div class="muted">No tienes recompensas pendientes.</div>';
  }

  const updateSelectionControls=()=>{
    const visibleIds=available.map(r=>r.id);
    const selectedCount=visibleIds.filter(id=>state.selectedRewardIds.has(id)).length;
    const allSelected=visibleIds.length>0&&selectedCount===visibleIds.length;
    const selectAll=$("#selectAllRewards");
    if(selectAll){selectAll.checked=allSelected;selectAll.indeterminate=selectedCount>0&&!allSelected;selectAll.disabled=!visibleIds.length;}
    if($("#selectedRewardsCount"))$("#selectedRewardsCount").textContent=`${selectedCount} seleccionada${selectedCount===1?"":"s"}`;
    if($("#claimSelectedRewards"))$("#claimSelectedRewards").disabled=selectedCount===0;
    if($("#discardSelectedRewards"))$("#discardSelectedRewards").disabled=selectedCount===0;
  };

  $$('[data-select-reward]').forEach(input=>input.onchange=()=>{
    if(input.checked)state.selectedRewardIds.add(input.dataset.selectReward);
    else state.selectedRewardIds.delete(input.dataset.selectReward);
    updateSelectionControls();
  });

  const selectAll=$("#selectAllRewards");
  if(selectAll)selectAll.onchange=()=>{
    if(selectAll.checked)available.forEach(r=>state.selectedRewardIds.add(r.id));
    else available.forEach(r=>state.selectedRewardIds.delete(r.id));
    renderRewards();
  };

  const claimSelected=$("#claimSelectedRewards");
  if(claimSelected)claimSelected.onclick=async()=>{
    const ids=[...state.selectedRewardIds].filter(id=>available.some(r=>r.id===id));
    if(!ids.length)return;
    claimSelected.disabled=true;
    const {error}=await supabase.from("rewards").update({status:"requested",requested_at:new Date().toISOString()}).in("id",ids).eq("account_id",state.account.id).eq("status","available");
    if(error){console.error(error);claimSelected.disabled=false;return;}
    state.selectedRewardIds.clear();
    state.rewardTab="requested";
    await loadAll();
  };

  const discardSelected=$("#discardSelectedRewards");
  if(discardSelected)discardSelected.onclick=async()=>{
    const ids=[...state.selectedRewardIds].filter(id=>available.some(r=>r.id===id));
    if(!ids.length)return;
    discardSelected.disabled=true;
    const {error}=await supabase.from("rewards").delete().in("id",ids).eq("account_id",state.account.id).eq("status","available");
    if(error){console.error(error);discardSelected.disabled=false;return;}
    state.selectedRewardIds.clear();
    await loadAll();
  };

  updateSelectionControls();

  const requested=state.rewards.filter(r=>r.status==="requested");
  const filter=$("#deliveryAccountFilter");
  const previousFilter=filter?.value||"all";
  const requestedAccountIds=[...new Set(requested.map(r=>r.account_id))];
  const requestedAccounts=requestedAccountIds
    .map(id=>state.accounts.find(a=>a.id===id))
    .filter(Boolean)
    .sort((a,b)=>String(a.username).localeCompare(String(b.username),"es",{sensitivity:"base"}));

  if(filter){
    filter.innerHTML='<option value="all">Todas las cuentas</option>'+requestedAccounts
      .map(a=>`<option value="${a.id}">${esc(a.username)}</option>`).join("");
    filter.value=requestedAccountIds.includes(previousFilter)?previousFilter:"all";
  }

  const renderDeliveryRequests=()=>{
    const selectedAccount=filter?.value||"all";
    const visibleRequested=selectedAccount==="all"
      ? requested
      : requested.filter(r=>r.account_id===selectedAccount);
    const commandActions=$("#deliveryCommandActions");
    const copyPlayerRewards=$("#copySelectedPlayerRewards");
    const commandSummary=$("#deliveryCommandSummary");
    const selectedAccountData=selectedAccount==="all"?null:state.accounts.find(a=>a.id===selectedAccount);
    const levelInput=$("#deliveryRewardLevel");
    const savedLevel=Number(localStorage.getItem("delivery_reward_level")||20);
    if(levelInput&&!levelInput.dataset.initialized){
      levelInput.value=String(Number.isInteger(savedLevel)&&savedLevel>=1&&savedLevel<=100?savedLevel:20);
      levelInput.dataset.initialized="true";
    }
    const level=Math.min(100,Math.max(1,parseInt(levelInput?.value||"20",10)||20));
    const pokemonParts=visibleRequested.map(r=>rewardPokemonCommandPart(r,level)).filter(Boolean);
    const groupedCommand=selectedAccountData&&pokemonParts.length
      ?`/reward ${minecraftUsernameForAccount(selectedAccountData.username)} ${pokemonParts.join(",")}`
      :"";

    if(commandActions)commandActions.hidden=!groupedCommand;
    if(commandSummary)commandSummary.textContent=groupedCommand
      ?`${pokemonParts.length} Pokémon pendiente${pokemonParts.length===1?"":"s"} para ${selectedAccountData.username} · Nivel ${level}`
      :"";
    if(levelInput){
      levelInput.onchange=()=>{
        const normalized=Math.min(100,Math.max(1,parseInt(levelInput.value||"20",10)||20));
        levelInput.value=String(normalized);
        localStorage.setItem("delivery_reward_level",String(normalized));
        renderDeliveryRequests();
      };
      levelInput.oninput=()=>{
        const raw=parseInt(levelInput.value,10);
        if(Number.isInteger(raw)&&raw>=1&&raw<=100)localStorage.setItem("delivery_reward_level",String(raw));
      };
    }
    if(copyPlayerRewards){
      copyPlayerRewards.disabled=!groupedCommand;
      copyPlayerRewards.textContent="C · Copiar comando";
      copyPlayerRewards.classList.remove("copied");
      copyPlayerRewards.onclick=groupedCommand?async()=>{
        try{
          await copyTextToClipboard(groupedCommand);
          copyPlayerRewards.textContent="✓ Comando copiado";
          copyPlayerRewards.classList.add("copied");
          setTimeout(()=>{
            copyPlayerRewards.textContent="C · Copiar comando";
            copyPlayerRewards.classList.remove("copied");
          },1400);
        }catch(error){
          console.error(error);
          copyPlayerRewards.title=groupedCommand;
        }
      }:null;
    }

    $("#deliveryList").innerHTML=visibleRequested.map(r=>{
      const a=state.accounts.find(x=>x.id===r.account_id);
      return`<div class="card"><strong>${esc(a?.username||"Cuenta")}</strong><div>${esc(r.label)}</div><div class="delivery-card-actions"><button data-deliver="${r.id}">Confirmar entrega</button></div></div>`;
    }).join("")||'<div class="muted">Sin solicitudes para esta cuenta.</div>';
    $$('[data-deliver]').forEach(b=>b.onclick=async()=>{
      await supabase.from("rewards").delete().eq("id",b.dataset.deliver);
      loadAll();
    });
  };

  if(filter)filter.onchange=renderDeliveryRequests;
  renderDeliveryRequests();
}
$("#rewardDrawerButton").onclick=()=>$("#rewardDrawer").classList.toggle("open");
$("#deliveryDrawerButton").onclick=()=>$("#deliveryDrawer").classList.toggle("open");

for(const table of ["accounts","tournaments","tournament_participants","matches","bets","rewards","daily_spins","rankings","cashier_transactions","number_game_settings","number_game_sessions","number_game_rounds","mine_game_settings","mine_game_sessions","announcements","announcement_replies","polls","poll_options","poll_votes"]){
  supabase.channel("rt-"+table).on("postgres_changes",{event:"*",schema:"public",table},async payload=>{
    const tid=payload.new?.tournament_id||payload.old?.tournament_id||$("#adminTournamentSelect")?.value;
    if(["tournaments","tournament_participants","matches"].includes(table)&&tid)await refreshTournamentState(tid);
    else await loadAll();
  }).subscribe();
}
setInterval(()=>{
  const bettingActive=document.querySelector('#view-betting.active');
  if(bettingActive)renderBetMatches();
  if(document.querySelector('#betModal.open'))updateBetPreview();
},1000);

renderWeeklyDailyPrizes();

const saved=localStorage.getItem("liga_account");
if(saved){const {data}=await supabase.from("accounts").select("*").eq("id",saved).maybeSingle();state.account=data||null}
await loadAll();

function syncTournamentFormatFields(){
  const rr=$("#tournamentFormat")?.value==="round-robin";
  if($("#tournamentGroups")){ $("#tournamentGroups").disabled=rr; if(rr)$("#tournamentGroups").value=1; }
  if($("#qualifyPerGroup")){ $("#qualifyPerGroup").disabled=rr; if(rr)$("#qualifyPerGroup").value=1; }
  const button=$("#createTournament");if(button)button.textContent=rr?"Crear todos contra todos y generar tarjetas":"Crear torneo y generar tarjetas";
}
if($("#tournamentFormat"))$("#tournamentFormat").addEventListener("change",syncTournamentFormatFields);
syncTournamentFormatFields();

