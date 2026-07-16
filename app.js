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
  admin:false, account:null, tournaments:[], participants:[], matches:[], bets:[], rewards:[], rankings:[]
};
let pendingPaidReward = null;
let wheelRotation = 0;

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
function clampOdds(value){ return Math.max(1.001, +Number(value || 1.001).toFixed(3)); }
function probabilityFromOdds(odds){ return Math.max(.01,Math.min(.99,1/Math.max(1.001,Number(odds)||2))); }
function logit(p){ p=Math.max(.01,Math.min(.99,p)); return Math.log(p/(1-p)); }
function logistic(x){ return 1/(1+Math.exp(-x)); }
function oddsFromProbability(pa){
  pa=Math.max(.015,Math.min(.985,pa));
  const payoutFactor=.94;
  return {a:clampOdds(payoutFactor/pa),b:clampOdds(payoutFactor/(1-pa))};
}
function oddsFromElo(a,b){ return oddsFromProbability(expected(a,b)); }
function winnerBetPools(match){
  let a=0,b=0;
  for(const bet of state.bets){
    if(bet.match_id!==match.id || bet.bet_type!=="winner" || bet.status!=="pending")continue;
    if(bet.selection?.participant_id===match.side_a)a+=Number(bet.stake)||0;
    if(bet.selection?.participant_id===match.side_b)b+=Number(bet.stake)||0;
  }
  return {a,b,total:a+b};
}
function scoreOdds(eloA,eloB,a,b){
  const expectedDiff=(eloA-eloB)/180;
  return +(2.7+Math.abs((a-b)-expectedDiff)*.75+Math.abs((a+b)-6)*.16).toFixed(2);
}
function participantName(id){ return state.participants.find(p=>p.id===id)?.display_name || "—"; }
function rankingFor(name){ return state.rankings.find(r=>r.name.toLowerCase()===String(name).toLowerCase()) || {elo:1000,wins:0,losses:0,kos_for:0,kos_against:0}; }

async function loadAll(){
  const [accounts,tournaments,participants,matches,bets,rewards,rankings] = await Promise.all([
    supabase.from("accounts").select("*").order("credits",{ascending:false}),
    supabase.from("tournaments").select("*").order("created_at",{ascending:false}),
    supabase.from("tournament_participants").select("*"),
    supabase.from("matches").select("*").order("created_at"),
    supabase.from("bets").select("*").order("created_at",{ascending:false}),
    supabase.from("rewards").select("*").order("created_at",{ascending:false}),
    supabase.from("rankings").select("*").order("elo",{ascending:false})
  ]);
  for(const result of [accounts,tournaments,participants,matches,bets,rewards,rankings]){
    if(result.error) console.error(result.error);
  }
  state.accounts=accounts.data||[];
  state.tournaments=tournaments.data||[];
  state.participants=participants.data||[];
  state.matches=matches.data||[];
  state.bets=bets.data||[];
  state.rewards=rewards.data||[];
  state.rankings=rankings.data||[];
  if(state.account) state.account=state.accounts.find(a=>a.id===state.account.id)||null;
  renderAll();
}
function renderAll(){
  document.body.classList.toggle("admin",state.admin);

  // Mantiene las secciones de administrador completamente separadas de las demás pestañas.
  $$(".admin-only").forEach(el=>{
    if(el.classList.contains("view")) el.hidden=!state.admin;
    else el.hidden=!state.admin;
  });
  const activeView=$(".view.active");
  if(!state.admin && activeView?.classList.contains("admin-only")) switchView("home");

  $("#sessionLabel").textContent=state.account?state.account.username:"Sin sesión";
  $("#walletLabel").textContent=state.account?`💰 ${money(state.account.credits)}`:"💰 —";
  $("#loginButton").hidden=!!state.account; $("#logoutButton").hidden=!state.account;
  renderLeaderboard(); renderActiveEvents(); renderTournamentSelects(); renderBetMatches(); renderBetTournamentStandings(); renderBetStandings();
  renderMyBets(); renderGeneralStats(); renderResults(); renderAccountsAdmin();
  renderCreditsAdmin(); renderTournamentsAdmin(); renderPvpEvents(); renderRewards(); updateDailyButton();
  if($("#betModal")?.classList.contains("open")) updateBetPreview();
}
function switchView(view){
  const target=$(`#view-${view}`);
  if(!target || (target.classList.contains("admin-only") && !state.admin)) view="home";

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
  window.scrollTo({top:0,behavior:"smooth"});
}
$("#nav").addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(b)switchView(b.dataset.view)});

$("#eventSubnav")?.addEventListener("click",e=>{
  const b=e.target.closest("[data-event-tab]");if(!b)return;
  $$("[data-event-tab]",$("#eventSubnav")).forEach(x=>x.classList.toggle("active",x===b));
  $$(".event-tab",$("#view-events")).forEach(x=>x.classList.toggle("active",x.id===`event-tab-${b.dataset.eventTab}`));
  if(b.dataset.eventTab==="pvp")renderPvpSides();
});

function modal(id,open=true){ $(id).classList.toggle("open",open); }
$$("[data-close-modal]").forEach(b=>b.onclick=()=>b.closest(".modal").classList.remove("open"));
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

function renderLeaderboard(){
  const rows=(state.accounts||[]).filter(a=>a.visible).map((a,i)=>`<tr><td>${i+1}</td><td>${esc(a.username)}${state.account?.id===a.id?" (tú)":""}</td><td>${money(a.credits)}</td></tr>`).join("");
  $("#leaderboard").innerHTML=`<table><thead><tr><th>#</th><th>Apostador</th><th>Pokédolares</th></tr></thead><tbody>${rows||'<tr><td colspan="3">Sin cuentas.</td></tr>'}</tbody></table>`;
}
function renderActiveEvents(){
  const cards=state.tournaments.filter(t=>t.status!=="finished").map(t=>{
    const open=state.matches.filter(m=>m.tournament_id===t.id&&["scheduled","live"].includes(m.status)).length;
    return `<div class="card clickable" data-open-event="${t.id}"><strong>🏆 ${esc(t.name)}</strong><div class="muted">${esc(t.format)} · ${open} enfrentamientos abiertos</div></div>`;
  }).join("");
  $("#activeEvents").innerHTML=cards||'<div class="muted">No hay eventos activos.</div>';
  $$("[data-open-event]").forEach(c=>c.onclick=()=>{$("#betTournamentSelect").value=c.dataset.openEvent;switchView("betting");renderBetMatches()});
}
function tournamentOptions(includeFinished=true){
  return state.tournaments.filter(t=>includeFinished||t.status!=="finished").map(t=>`<option value="${t.id}">${esc(t.name)} · ${esc(t.format)}</option>`).join("");
}
function renderTournamentSelects(){
  for(const id of ["betTournamentSelect","resultTournamentSelect","adminTournamentSelect"]){
    const el=$("#"+id);if(!el)continue;
    const old=el.value;el.innerHTML='<option value="">— Selecciona —</option>'+tournamentOptions(id!=="betTournamentSelect");
    if([...el.options].some(o=>o.value===old))el.value=old;
  }
  $("#participantPanel").hidden=!$("#adminTournamentSelect").value;
  $("#matchAdminPanel").hidden=!$("#adminTournamentSelect").value;
}
$("#betTournamentSelect").onchange=()=>{renderBetMatches();renderBetStandings()};
$("#resultTournamentSelect").onchange=renderResults;
$("#adminTournamentSelect").onchange=()=>{renderParticipantList();renderMatchAdmin();$("#participantPanel").hidden=false;$("#matchAdminPanel").hidden=false};

function dynamicOdds(match){
  const a=state.participants.find(p=>p.id===match.side_a),b=state.participants.find(p=>p.id===match.side_b);
  const ra=rankingFor(a?.display_name).elo, rb=rankingFor(b?.display_name).elo;

  // Base por ELO o por las cuotas manuales elegidas por el organizador.
  let pA=expected(ra,rb);
  const manualA=Number(match.base_odds?.manual_a),manualB=Number(match.base_odds?.manual_b);
  if(manualA>=1.001 && manualB>=1.001){
    const ia=probabilityFromOdds(manualA),ib=probabilityFromOdds(manualB);
    pA=ia/(ia+ib);
  }

  // El dinero apostado mueve la cuota: más apuestas a un lado = menor cuota para ese lado.
  const pool=winnerBetPools(match);
  if(pool.total>0){
    const virtualLiquidity=500;
    const crowdA=(pool.a+(virtualLiquidity*pA))/(pool.total+virtualLiquidity);
    const crowdWeight=Math.min(.55,pool.total/(pool.total+700));
    pA=(pA*(1-crowdWeight))+(crowdA*crowdWeight);
  }

  // Durante la pelea, el marcador pesa cada vez más según la diferencia.
  if(match.status==="live"){
    const diff=(Number(match.score_a)||0)-(Number(match.score_b)||0);
    const abs=Math.abs(diff);
    const strength=abs<=2?.20:abs<=4?.38:.72;
    pA=logistic(logit(pA)+(diff*strength));
  }
  return oddsFromProbability(pA);
}

function renderBetStandings(){
  const tid=$("#betTournamentSelect").value;
  if(!tid){$("#betStandings").innerHTML='<div class="muted">Selecciona un torneo.</div>';return}
  const t=tournamentById(tid),q=t?.config?.qualify_per_group||1,rows=standingsFor(tid);
  const groups=[...new Set(rows.map(r=>r.group_no))];
  $("#betStandings").innerHTML=groups.map(g=>{
    const list=rows.filter(r=>r.group_no===g);
    return `<div class="standings-group"><h3>Grupo ${groupLetter(g)}</h3><table><thead><tr><th>#</th><th>Jugador/equipo</th><th>PJ</th><th>PG</th><th>Pts</th><th>KO+</th><th>KO-</th><th>Dif.</th></tr></thead><tbody>${list.map((x,i)=>`<tr class="${i<q?"qualifier-row":""}"><td>${i+1}</td><td>${esc(x.display_name)}</td><td>${x.pj}</td><td>${x.pg}</td><td>${x.pts}</td><td>${x.kf}</td><td>${x.kc}</td><td>${x.kf-x.kc}</td></tr>`).join("")}</tbody></table></div>`;
  }).join("")||'<div class="muted">Sin participantes.</div>';
}


function renderBetTournamentStandings(){
  const box=$("#betTournamentStandings");
  if(!box)return;
  const tid=$("#betTournamentSelect").value;
  if(!tid){box.innerHTML="";return}
  const rows=standingsFor(tid);
  const groups=[...new Set(rows.map(r=>r.group_no))].sort((a,b)=>a-b);
  box.innerHTML=groups.map(g=>`
    <div>
      <h3>Grupo ${groupLetter(g)}</h3>
      <table>
        <thead><tr><th>#</th><th>Jugador/equipo</th><th>PJ</th><th>PG</th><th>PTS</th><th>KO+</th><th>KO-</th><th>DIF</th></tr></thead>
        <tbody>${rows.filter(r=>r.group_no===g).map((r,i)=>`
          <tr><td>${i+1}</td><td>${esc(r.display_name)}</td><td>${r.pj}</td><td>${r.pg}</td><td>${r.pts}</td><td>${r.kf}</td><td>${r.kc}</td><td>${r.kf-r.kc}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>`).join("")||'<div class="muted">La tabla aparecerá cuando se asignen participantes.</div>';
}
function renderBetMatches(){
  const tid=$("#betTournamentSelect").value;
  const list=state.matches.filter(m=>m.tournament_id===tid&&["scheduled","live"].includes(m.status)&&m.side_a&&m.side_b);
  $("#betMatches").innerHTML=list.map(m=>{
    const o=dynamicOdds(m),live=m.status==="live";
    return `<div class="card match clickable ${live?"live-match":""}" data-bet-match="${m.id}">
      <div class="match-topline">
        <div class="muted">${esc(m.phase)} · ronda ${m.round_no}</div>
        ${live?'<span class="live-badge"><i></i> EN VIVO</span>':''}
      </div>
      <div class="live-score-grid">
        <div class="live-team"><strong>${esc(participantName(m.side_a))}</strong><span class="live-score">${m.score_a??0}</span></div>
        <span class="vs">VS</span>
        <div class="live-team"><strong>${esc(participantName(m.side_b))}</strong><span class="live-score">${m.score_b??0}</span></div>
      </div>
      <div class="odds"><span>x${o.a.toFixed(3)}</span><span>x${o.b.toFixed(3)}</span></div>
      <div class="muted">${m.scheduled_at?new Date(m.scheduled_at).toLocaleString("es-BO"):"Sin horario asignado"}</div>
    </div>`;
  }).join("")||'<div class="muted">No hay enfrentamientos abiertos.</div>';
  $$('[data-bet-match]').forEach(c=>c.onclick=()=>openBet(c.dataset.betMatch));
}
function openBet(id){
  if(!state.account){alert("Primero inicia sesión.");return}
  const m=state.matches.find(x=>x.id===id);if(!m)return;
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
    $("#betDynamicFields").innerHTML=`<label>Selección</label><select id="betSelection"><option value="${m.side_a}|-1.5">${esc(a)} -1.5</option><option value="${m.side_b}|+1.5">${esc(b)} +1.5</option></select>`;
  }else{
    $("#betDynamicFields").innerHTML=`<div class="row"><div><label>${esc(a)}</label><input id="scoreA" type="number" min="0" value="6"></div><div><label>${esc(b)}</label><input id="scoreB" type="number" min="0" value="4"></div></div>`;
  }
  updateBetPreview();
  $("#betDynamicFields").oninput=updateBetPreview;$("#betDynamicFields").onchange=updateBetPreview;
}
function currentBetOdds(){
  const m=state.matches.find(x=>x.id===$("#betMatchId").value),type=$("#betType").value,o=dynamicOdds(m);
  if(type==="winner") return $("#betSelection").value===m.side_a?o.a:o.b;
  if(type==="handicap") return 1.9;
  const a=state.participants.find(p=>p.id===m.side_a),b=state.participants.find(p=>p.id===m.side_b);
  return scoreOdds(rankingFor(a.display_name).elo,rankingFor(b.display_name).elo,+$("#scoreA").value,+$("#scoreB").value);
}
function updateBetPreview(){
  const odds=currentBetOdds(),stake=+$("#betStake").value||0;
  $("#betOddsPreview").textContent=`Cuota x${Number(odds).toFixed(3)} · pago potencial ${money(Math.floor(stake*odds))}`;
}
$("#betStake").oninput=updateBetPreview;
$("#confirmBet").onclick=async()=>{
  const match=state.matches.find(x=>x.id===$("#betMatchId").value),type=$("#betType").value,stake=+$("#betStake").value;
  if(!match||!stake||stake<1||stake>state.account.credits){alert("Monto inválido.");return}
  let selection;
  if(type==="score")selection={score_a:+$("#scoreA").value,score_b:+$("#scoreB").value};
  else if(type==="handicap"){const [participant_id,line]=$("#betSelection").value.split("|");selection={participant_id,line:+line}}
  else selection={participant_id:$("#betSelection").value};
  const odds=currentBetOdds();
  const {error}=await supabase.rpc("place_bet_atomic",{});
  if(error && !String(error.message).includes("Could not find")) console.warn(error);
  const newCredits=state.account.credits-stake;
  const [u,b]=await Promise.all([
    supabase.from("accounts").update({credits:newCredits}).eq("id",state.account.id),
    supabase.from("bets").insert({account_id:state.account.id,tournament_id:match.tournament_id,match_id:match.id,bet_type:type,selection,stake,locked_odds:odds})
  ]);
  if(u.error||b.error){alert("No se pudo guardar la apuesta.");console.error(u.error||b.error);return}
  modal("#betModal",false);await loadAll();
};
function renderMyBets(){
  if(!state.account){$("#myBets").innerHTML='<div class="muted">Inicia sesión.</div>';return}
  const rows=state.bets.filter(b=>b.account_id===state.account.id).map(b=>`<tr><td>${esc(b.bet_type)}</td><td>${money(b.stake)}</td><td>x${b.locked_odds}</td><td>${esc(b.status)}</td><td>${money(b.payout||0)}</td></tr>`).join("");
  $("#myBets").innerHTML=`<table><thead><tr><th>Tipo</th><th>Monto</th><th>Cuota</th><th>Estado</th><th>Pago</th></tr></thead><tbody>${rows||'<tr><td colspan="5">Sin apuestas.</td></tr>'}</tbody></table>`;
}

function renderGeneralStats(){
  const panel=$("#generalStats")?.closest(".panel");
  if(panel) panel.hidden=!state.admin;
  if(!state.admin){$("#generalStats").innerHTML="";return;}
  const accountNames=new Set(state.accounts.map(a=>a.username.toLowerCase()));
  const rows=state.rankings.filter(r=>accountNames.has(r.name.toLowerCase())).map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.name)}</td><td>${r.elo}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.kos_for}</td><td>${r.kos_against}</td><td><button class="danger" data-reset-ranking="${esc(r.name)}">Reiniciar</button></td></tr>`).join("");
  $("#generalStats").innerHTML=`<table><thead><tr><th>#</th><th>Jugador</th><th>ELO</th><th>PG</th><th>PP</th><th>KO+</th><th>KO-</th><th>Acción</th></tr></thead><tbody>${rows||'<tr><td colspan="8">Sin estadísticas.</td></tr>'}</tbody></table>`;
  $$('[data-reset-ranking]').forEach(b=>b.onclick=()=>resetRanking(b.dataset.resetRanking));
}
async function resetRanking(name){
  if(!state.admin||!confirm(`¿Reiniciar ELO y estadísticas de ${name}?`))return;
  const row={name,elo:1000,wins:0,losses:0,kos_for:0,kos_against:0};
  const {error}=await supabase.from("rankings").upsert(row,{onConflict:"name"});
  if(error){alert(error.message);return}await loadAll();
}
$("#resetAllRankings").onclick=async()=>{
  if(!state.admin||!confirm("¿Reiniciar el ELO, victorias, derrotas y KO de todos los usuarios?"))return;
  const rows=state.accounts.map(a=>({name:a.username,elo:1000,wins:0,losses:0,kos_for:0,kos_against:0}));
  if(!rows.length)return;
  const {error}=await supabase.from("rankings").upsert(rows,{onConflict:"name"});
  if(error){alert(error.message);return}await loadAll();
};

function standingsFor(tid){
  const ps=state.participants.filter(p=>p.tournament_id===tid);
  const ms=state.matches.filter(m=>m.tournament_id===tid&&m.phase==="group"&&["live","finished","walkover"].includes(m.status));
  const map=new Map(ps.map(p=>[p.id,{...p,pj:0,pg:0,pts:0,kf:0,kc:0}]));
  for(const m of ms){
    const a=map.get(m.side_a),b=map.get(m.side_b);if(!a||!b)continue;
    a.kf+=m.score_a||0;a.kc+=m.score_b||0;b.kf+=m.score_b||0;b.kc+=m.score_a||0;
    if(m.status==="live")continue;
    a.pj++;b.pj++;
    if(m.winner_id===a.id){a.pg++;a.pts+=3}else if(m.winner_id===b.id){b.pg++;b.pts+=3}else{a.pts++;b.pts++}
  }
  return [...map.values()].sort((a,b)=>a.group_no-b.group_no||b.pts-a.pts||((b.kf-b.kc)-(a.kf-a.kc)));
}
function renderResults(){
  const tid=$("#resultTournamentSelect").value;
  if(!tid){$("#standings").innerHTML="";$("#finishedMatches").innerHTML="";return}
  const st=standingsFor(tid);
  $("#standings").innerHTML=`<table><thead><tr><th>Grupo</th><th>Jugador</th><th>PJ</th><th>PG</th><th>Pts</th><th>KO+</th><th>KO-</th><th>Dif</th></tr></thead><tbody>${st.map(x=>`<tr><td>${x.group_no}</td><td>${esc(x.display_name)}</td><td>${x.pj}</td><td>${x.pg}</td><td>${x.pts}</td><td>${x.kf}</td><td>${x.kc}</td><td>${x.kf-x.kc}</td></tr>`).join("")}</tbody></table>`;
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
  const rows=state.accounts.map(a=>`<tr><td>${esc(a.username)}</td><td>${money(a.credits)}</td><td><input type="checkbox" data-visible="${a.id}" ${a.visible?"checked":""}></td><td><button class="secondary" data-reset="${a.id}">Nueva clave</button> <button class="danger" data-delete-account="${a.id}">Eliminar</button></td></tr>`).join("");
  $("#accountAdminList").innerHTML=`<table><thead><tr><th>Cuenta</th><th>Saldo</th><th>Visible</th><th>Acciones</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Sin cuentas.</td></tr>'}</tbody></table>`;
  $$("[data-visible]").forEach(x=>x.onchange=async()=>{await supabase.from("accounts").update({visible:x.checked}).eq("id",x.dataset.visible);loadAll()});
  $$("[data-reset]").forEach(x=>x.onclick=async()=>{const p=randomPassword();await supabase.from("accounts").update({password_hash:await sha256(p)}).eq("id",x.dataset.reset);alert("Nueva contraseña: "+p)});
  $$("[data-delete-account]").forEach(x=>x.onclick=async()=>{if(confirm("¿Eliminar la cuenta y todos sus datos?")){await supabase.from("accounts").delete().eq("id",x.dataset.deleteAccount);loadAll()}});
}
function renderCreditsAdmin(){
  const rows=state.accounts.map(a=>`<tr><td>${esc(a.username)}</td><td>${money(a.credits)}</td><td><input type="number" min="1" value="100" data-credit-input="${a.id}"></td><td><button data-add-credit="${a.id}">Sumar</button> <button class="danger" data-remove-credit="${a.id}">Retirar</button></td></tr>`).join("");
  $("#creditAdminList").innerHTML=`<table><thead><tr><th>Cuenta</th><th>Saldo</th><th>Monto</th><th>Acción</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Sin cuentas.</td></tr>'}</tbody></table>`;
  $$("[data-add-credit]").forEach(b=>b.onclick=()=>changeCredits(b.dataset.addCredit,1));
  $$("[data-remove-credit]").forEach(b=>b.onclick=()=>changeCredits(b.dataset.removeCredit,-1));
}
async function changeCredits(id,sign){
  const a=state.accounts.find(x=>x.id===id),amount=+document.querySelector(`[data-credit-input="${id}"]`).value;
  if(!a||amount<1)return;
  await supabase.from("accounts").update({credits:Math.max(0,a.credits+sign*amount)}).eq("id",id);loadAll();
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

$("#createTournament").onclick=async()=>{
  const name=$("#tournamentName").value.trim();
  const format=$("#tournamentFormat").value;
  const participant_count=+$("#tournamentParticipantCount").value;
  const groups=+$("#tournamentGroups").value;
  const qualify=+$("#qualifyPerGroup").value;

  if(!name){alert("Escribe el nombre del torneo.");return}
  if(participant_count<2||participant_count>32){alert("La cantidad de participantes debe estar entre 2 y 32.");return}
  if(groups<1||groups>26||groups>participant_count){alert("La cantidad de grupos debe estar entre 1 y 26 y no superar los participantes.");return}
  if(qualify<1||qualify>Math.ceil(participant_count/groups)){alert("La cantidad que clasifica por grupo no es válida.");return}

  const config={
    groups, qualify_per_group:qualify, participant_count,
    third_place:true, repechage:false
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
  $("#tournamentAdminList").innerHTML=state.tournaments.filter(t=>t.config?.event_kind!=="pvp").map(t=>{
    const count=t.config?.participant_count||0;
    return `<div class="card">
      <strong>${esc(t.name)}</strong>
      <div class="muted">${esc(t.format)} · ${count} participantes · ${t.config?.groups||1} grupos · ${esc(t.status)}</div>
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

$("#adminTournamentSelect").onchange=()=>{
  const has=!!$("#adminTournamentSelect").value;
  $("#participantPanel").hidden=!has;$("#matchAdminPanel").hidden=!has;$("#knockoutPanel").hidden=!has;
  if(has){renderParticipantCards();renderMatchAdmin();renderKnockoutPanel()}
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
  const existing=tournamentParticipants(tid);
  const count=t.config?.participant_count||existing.length||2;
  $("#participantCards").innerHTML=Array.from({length:count},(_,i)=>participantCardHtml(t,i,existing[i])).join("");
  $$("[data-member-kind]").forEach(sel=>sel.onchange=()=>{
    const block=sel.closest("[data-member]");
    block.querySelector(`[data-account-wrap="${sel.dataset.memberKind}"]`).hidden=sel.value==="bot";
    block.querySelector(`[data-bot-wrap="${sel.dataset.memberKind}"]`).hidden=sel.value!=="bot";
  });
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

$("#saveParticipantsButton").onclick=async()=>{
  const tid=$("#adminTournamentSelect").value;if(!tid)return;
  let items;try{items=readParticipantCards()}catch(e){alert(e.message);return}
  await supabase.from("tournament_participants").delete().eq("tournament_id",tid);
  const rows=items.map(x=>({...x,tournament_id:tid}));
  const {error}=await supabase.from("tournament_participants").insert(rows);
  if(error){alert(error.message);return}
  await loadAll();$("#adminTournamentSelect").value=tid;renderParticipantCards();
  alert("Participantes guardados.");
};

$("#fairPairingButton").onclick=()=>{
  const cards=$$("[data-slot]","#participantCards");
  const entries=cards.map(card=>{
    const names=[];
    for(const block of $$("[data-member]",card)){
      const idx=block.dataset.member;
      const kind=block.querySelector(`[data-member-kind="${idx}"]`).value;
      if(kind==="account"){
        const a=state.accounts.find(x=>x.id===block.querySelector(`[data-member-account="${idx}"]`).value);
        if(a)names.push(a.username);
      }else{
        const n=block.querySelector(`[data-member-bot="${idx}"]`).value.trim();if(n)names.push(n);
      }
    }
    const elo=names.length?names.reduce((s,n)=>s+rankingFor(n).elo,0)/names.length:1000;
    return {card,elo};
  }).sort((a,b)=>b.elo-a.elo);
  const groups=tournamentById($("#adminTournamentSelect").value)?.config?.groups||1;
  let g=1,dir=1;
  entries.forEach(e=>{
    e.card.querySelector("[data-slot-group]").value=g;
    if(groups>1){g+=dir;if(g>groups){g=groups;dir=-1}else if(g<1){g=1;dir=1}}
  });
};

$("#generateFixture").onclick=async()=>{
  const tid=$("#adminTournamentSelect").value,t=tournamentById(tid),ps=tournamentParticipants(tid);
  const expectedCount=t?.config?.participant_count||0;
  if(!t||ps.length!==expectedCount){alert(`Debes guardar exactamente ${expectedCount} participantes antes de generar las peleas.`);return}
  const groupNumbers=[...new Set(ps.map(p=>p.group_no))];
  for(const g of groupNumbers)if(ps.filter(p=>p.group_no===g).length<2){alert(`El grupo ${groupLetter(g)} necesita al menos 2 participantes.`);return}

  await supabase.from("matches").delete().eq("tournament_id",tid);
  const rows=[];let round=1;
  for(const g of groupNumbers.sort((a,b)=>a-b)){
    const gp=ps.filter(p=>p.group_no===g);
    for(let i=0;i<gp.length;i++)for(let j=i+1;j<gp.length;j++){
      rows.push({tournament_id:tid,phase:"group",round_no:round++,group_no:g,side_a:gp[i].id,side_b:gp[j].id,status:"scheduled"});
      if(t.format==="1v1-double")rows.push({tournament_id:tid,phase:"group",round_no:round++,group_no:g,side_a:gp[j].id,side_b:gp[i].id,status:"scheduled"});
    }
  }
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
function renderMatchAdmin(){
  const tid=$("#adminTournamentSelect").value;if(!tid)return;
  const ms=tournamentMatches(tid);
  const phases=["group","repechage","quarterfinal","semifinal","final","third_place"];
  $("#matchAdminList").innerHTML=phases.map(phase=>{
    const list=ms.filter(m=>m.phase===phase);if(!list.length)return "";
    const title={group:"Fase de grupos",repechage:"Repechaje",quarterfinal:"Cuartos de final",semifinal:"Semifinales",final:"Final",third_place:"Tercer puesto"}[phase];
    return `<div class="phase-title">${title}</div>${list.map(matchCardAdmin).join("")}`;
  }).join("")||'<div class="muted">Todavía no se generaron peleas.</div>';

  $$("[data-start-match]").forEach(b=>b.onclick=()=>startMatch(b.dataset.startMatch));
  $$("[data-finish-match]").forEach(b=>b.onclick=()=>finishMatch(b.dataset.finishMatch,false));
  $$("[data-walkover-a]").forEach(b=>b.onclick=()=>finishMatch(b.dataset.walkoverA,true,"a"));
  $$("[data-walkover-b]").forEach(b=>b.onclick=()=>finishMatch(b.dataset.walkoverB,true,"b"));
  $$("[data-save-schedule]").forEach(b=>b.onclick=()=>saveSchedule(b.dataset.saveSchedule));
  $$("[data-save-odds]").forEach(b=>b.onclick=()=>saveManualOdds(b.dataset.saveOdds));
  $$("[data-clear-odds]").forEach(b=>b.onclick=()=>clearManualOdds(b.dataset.clearOdds));
  $$("[data-live-score]").forEach(input=>input.oninput=()=>queueLiveScoreSave(input.dataset.liveScore));
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
    <div class="manual-odds-box">
      <div><label>Cuota manual ${esc(participantName(m.side_a))}</label><input type="number" min="1.001" step="0.001" value="${m.base_odds?.manual_a??''}" data-manual-odds-a="${m.id}" placeholder="Automática"></div>
      <div><label>Cuota manual ${esc(participantName(m.side_b))}</label><input type="number" min="1.001" step="0.001" value="${m.base_odds?.manual_b??''}" data-manual-odds-b="${m.id}" placeholder="Automática"></div>
      <button class="secondary" data-save-odds="${m.id}">Guardar cuotas</button>
      <button class="danger" data-clear-odds="${m.id}">Usar ELO</button>
    </div>
    <div class="fight-controls">
      ${done?`<div class="card"><strong>Resultado: ${m.score_a??0} - ${m.score_b??0}</strong> · ${m.status==="walkover"?"Walkover":"Finalizada"}</div>`:
      started?`<div class="score-box">
        <input type="number" min="0" value="${m.score_a??0}" data-score-a="${m.id}" data-live-score="${m.id}">
        <span>—</span>
        <input type="number" min="0" value="${m.score_b??0}" data-score-b="${m.id}" data-live-score="${m.id}">
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
function queueLiveScoreSave(id){
  const m=state.matches.find(x=>x.id===id);if(!m)return;
  const a=Math.max(0,+document.querySelector(`[data-score-a="${id}"]`)?.value||0);
  const b=Math.max(0,+document.querySelector(`[data-score-b="${id}"]`)?.value||0);
  m.score_a=a;m.score_b=b;
  renderBetMatches();renderBetStandings();renderBetTournamentStandings();
  clearTimeout(liveScoreTimers.get(id));
  liveScoreTimers.set(id,setTimeout(async()=>{
    const {error}=await supabase.from("matches").update({score_a:a,score_b:b,status:"live"}).eq("id",id);
    if(error)console.error(error);
  },350));
}
async function saveManualOdds(id){
  const a=Number(document.querySelector(`[data-manual-odds-a="${id}"]`)?.value);
  const b=Number(document.querySelector(`[data-manual-odds-b="${id}"]`)?.value);
  if(a<1.001||b<1.001){alert("Ambas cuotas deben ser de al menos 1.001.");return}
  const {error}=await supabase.from("matches").update({base_odds:{manual_a:a,manual_b:b}}).eq("id",id);
  if(error)alert(error.message);else await loadAll();
}
async function clearManualOdds(id){
  const {error}=await supabase.from("matches").update({base_odds:{}}).eq("id",id);
  if(error)alert(error.message);else await loadAll();
}
async function saveSchedule(id){
  const value=document.querySelector(`[data-match-date="${id}"]`).value;
  const {error}=await supabase.from("matches").update({scheduled_at:value?new Date(value).toISOString():null}).eq("id",id);
  if(error)alert(error.message);else alert("Fecha y hora guardadas.");
}
async function startMatch(id){
  await supabase.from("matches").update({status:"live"}).eq("id",id);
  await loadAll();renderMatchAdmin();
}
function participantMemberNames(participant){
  const names=(participant?.members||[]).map(botOrAccountName).filter(Boolean);
  return names.length?names:[participant?.display_name].filter(Boolean);
}
function performanceEloDelta(playerElo,opponentAverage,didWin,kBase,kosFor,kosAgainst){
  const exp=expected(playerElo,opponentAverage);
  const result=didWin?1:0;
  const scoreDiff=Number(kosFor||0)-Number(kosAgainst||0);
  // Los KO modifican el resultado, pero no pueden dominar por completo la victoria/derrota.
  const koAdjustment=Math.max(-0.35,Math.min(0.35,scoreDiff*0.055));
  const raw=kBase*((result-exp)+koAdjustment);
  return Math.round(raw)|| (didWin?1:-1);
}
async function updateRankingAfterMatch(match,scoreA,scoreB,winnerId){
  const pa=state.participants.find(p=>p.id===match.side_a);
  const pb=state.participants.find(p=>p.id===match.side_b);
  if(!pa||!pb)return;
  const namesA=participantMemberNames(pa),namesB=participantMemberNames(pb);
  const avgA=namesA.reduce((sum,n)=>sum+rankingFor(n).elo,0)/Math.max(1,namesA.length);
  const avgB=namesB.reduce((sum,n)=>sum+rankingFor(n).elo,0)/Math.max(1,namesB.length);
  const isDouble=(tournamentById(match.tournament_id)?.format==="2v2")||namesA.length>1||namesB.length>1;
  // Las dobles dan menos puntos. Todo resultado de torneo vale x2 frente a un PVP normal.
  const tournamentMultiplier=2;
  const kBase=(isDouble?14:24)*tournamentMultiplier;
  const wonA=winnerId===match.side_a;
  const updates=[];
  for(const name of namesA){
    const current=rankingFor(name);
    const delta=performanceEloDelta(current.elo,avgB,wonA,kBase,scoreA,scoreB);
    updates.push({name,elo:Math.max(100,current.elo+delta),wins:current.wins+(wonA?1:0),losses:current.losses+(wonA?0:1),kos_for:current.kos_for+scoreA,kos_against:current.kos_against+scoreB});
  }
  for(const name of namesB){
    const current=rankingFor(name);
    const delta=performanceEloDelta(current.elo,avgA,!wonA,kBase,scoreB,scoreA);
    updates.push({name,elo:Math.max(100,current.elo+delta),wins:current.wins+(wonA?0:1),losses:current.losses+(wonA?1:0),kos_for:current.kos_for+scoreB,kos_against:current.kos_against+scoreA});
  }
  const {error}=await supabase.from("rankings").upsert(updates,{onConflict:"name"});
  if(error)console.error("No se pudo actualizar el ELO:",error);
}
async function settleBets(matchId){
  const m=state.matches.find(x=>x.id===matchId);if(!m)return;
  const pending=state.bets.filter(b=>b.match_id===matchId&&b.status==="pending");
  for(const bet of pending){
    let won=false,refunded=false;
    if(bet.bet_type==="winner") won=bet.selection?.participant_id===m.winner_id;
    else if(bet.bet_type==="score") won=Number(bet.selection?.score_a)===Number(m.score_a)&&Number(bet.selection?.score_b)===Number(m.score_b);
    else if(bet.bet_type==="handicap"){
      const pid=bet.selection?.participant_id,line=Number(bet.selection?.line||0);
      const selectedScore=pid===m.side_a?Number(m.score_a):Number(m.score_b);
      const otherScore=pid===m.side_a?Number(m.score_b):Number(m.score_a);
      const adjusted=selectedScore+line;
      if(adjusted===otherScore)refunded=true;else won=adjusted>otherScore;
    }else continue;
    const payout=refunded?Number(bet.stake):won?Math.floor(Number(bet.stake)*Number(bet.locked_odds)):0;
    await supabase.from("bets").update({status:refunded?"refunded":won?"won":"lost",payout}).eq("id",bet.id);
    if(payout>0){
      const account=state.accounts.find(a=>a.id===bet.account_id);
      if(account){
        account.credits+=payout;
        await supabase.from("accounts").update({credits:account.credits}).eq("id",account.id);
      }
    }
  }
}
async function finishMatch(id,walkover=false,side=null){
  const m=state.matches.find(x=>x.id===id);if(!m)return;
  const button=document.querySelector(`[data-finish-match="${id}"]`)||document.querySelector(`[data-walkover-a="${id}"]`)||document.querySelector(`[data-walkover-b="${id}"]`);
  if(button){button.disabled=true;button.textContent="Finalizando…"}
  let a=0,b=0,winner=null,status="finished";
  if(walkover){
    status="walkover";winner=side==="a"?m.side_a:m.side_b;a=side==="a"?1:0;b=side==="b"?1:0;
  }else{
    clearTimeout(liveScoreTimers.get(id));
    a=+document.querySelector(`[data-score-a="${id}"]`).value;
    b=+document.querySelector(`[data-score-b="${id}"]`).value;
    if(a===b){alert("El marcador no puede terminar empatado.");if(button)button.disabled=false;return}
    winner=a>b?m.side_a:m.side_b;
  }
  // Cambio local inmediato para que la interfaz responda sin esperar Realtime.
  Object.assign(m,{score_a:a,score_b:b,status,winner_id:winner});
  renderMatchAdmin();renderKnockoutPanel();renderBetMatches();renderBetStandings();renderBetTournamentStandings();renderResults();
  const {error}=await supabase.from("matches").update({score_a:a,score_b:b,status,winner_id:winner}).eq("id",id);
  if(error){alert(error.message);await loadAll();return}
  await Promise.all([updateRankingAfterMatch(m,a,b,winner),settleBets(id)]);
  // Crear la siguiente fase antes de recargar, para que aparezca en la misma acción.
  const eventTournament=tournamentById(m.tournament_id);
  if(eventTournament?.config?.event_kind==="pvp"){
    eventTournament.status="finished";
    await supabase.from("tournaments").update({status:"finished"}).eq("id",m.tournament_id);
  }else if(m.phase==="group") await autoGenerateKnockout(m.tournament_id);
  else await advanceKnockout(m.tournament_id,m.phase);
  await loadAll();
  $("#adminTournamentSelect").value=m.tournament_id;
  renderMatchAdmin();renderKnockoutPanel();
}

async function autoGenerateKnockout(tid){
  const t=tournamentById(tid);
  if(!t||!isGroupStageComplete(tid))return;
  const mainExisting=tournamentMatches(tid).some(m=>["quarterfinal","semifinal","final"].includes(m.phase));
  if(mainExisting){renderKnockoutPanel();return}
  await generateKnockoutRows(tid);
}
async function generateKnockoutRows(tid){
  const t=tournamentById(tid),q=Number(t.config?.qualify_per_group||1);
  const groups=[...new Set(tournamentParticipants(tid).map(p=>p.group_no))].sort((a,b)=>a-b);
  const table=standingsFor(tid);
  // Solo clasifican los primeros N indicados al crear el torneo, por cada grupo.
  const qualifiers=groups.flatMap(g=>table.filter(x=>x.group_no===g).slice(0,q));
  const third=t.config?.third_place!==false;
  if(![2,4,8,16].includes(qualifiers.length)){
    $("#bracketStatus").textContent=`Clasificaron ${qualifiers.length}. El total debe ser 2, 4, 8 o 16 para formar la llave.`;
    return;
  }
  if(tournamentMatches(tid).some(m=>["quarterfinal","semifinal","final"].includes(m.phase))){renderKnockoutPanel();return}
  const phase=qualifiers.length===2?"final":qualifiers.length===4?"semifinal":"quarterfinal";
  const rows=[];
  // Cruce simple entre clasificados; nunca incluye a participantes fuera del top N.
  for(let i=0;i<qualifiers.length;i+=2)rows.push({tournament_id:tid,phase,round_no:1,side_a:qualifiers[i].id,side_b:qualifiers[i+1].id,status:"scheduled"});
  const {data,error}=await supabase.from("matches").insert(rows).select();
  if(error){alert(error.message);return}
  if(data?.length)state.matches.push(...data);
  await supabase.from("tournaments").update({config:{...t.config,third_place:third}}).eq("id",tid);
  $("#adminTournamentSelect").value=tid;
  renderMatchAdmin();renderKnockoutPanel();renderBetMatches();renderBetTournamentStandings();
}
async function advanceKnockout(tid,finishedPhase){
  const t=tournamentById(tid);if(!t)return;
  let rows=[];
  if(finishedPhase==="quarterfinal"){
    const matches=tournamentMatches(tid).filter(m=>m.phase==="quarterfinal");
    if(matches.length&&matches.every(m=>["finished","walkover"].includes(m.status))&&!tournamentMatches(tid).some(m=>m.phase==="semifinal")){
      const winners=matches.map(m=>m.winner_id);
      for(let i=0;i<winners.length;i+=2)rows.push({tournament_id:tid,phase:"semifinal",round_no:1,side_a:winners[i],side_b:winners[i+1],status:"scheduled"});
    }
  }else if(finishedPhase==="semifinal"){
    const semis=tournamentMatches(tid).filter(m=>m.phase==="semifinal");
    if(semis.length===2&&semis.every(m=>["finished","walkover"].includes(m.status))&&!tournamentMatches(tid).some(m=>m.phase==="final")){
      const winners=semis.map(m=>m.winner_id),losers=semis.map(m=>m.side_a===m.winner_id?m.side_b:m.side_a);
      rows=[{tournament_id:tid,phase:"final",round_no:1,side_a:winners[0],side_b:winners[1],status:"scheduled"}];
      if(t.config?.third_place!==false)rows.push({tournament_id:tid,phase:"third_place",round_no:1,side_a:losers[0],side_b:losers[1],status:"scheduled"});
    }
  }else if(finishedPhase==="final"){
    t.status="finished";
    await supabase.from("tournaments").update({status:"finished"}).eq("id",tid);
  }
  if(rows.length){
    const {data,error}=await supabase.from("matches").insert(rows).select();
    if(error){alert(error.message);return}
    if(data?.length)state.matches.push(...data);
  }
  $("#adminTournamentSelect").value=tid;
  renderMatchAdmin();renderKnockoutPanel();renderBetMatches();renderBetTournamentStandings();
}
function renderKnockoutPanel(){
  const tid=$("#adminTournamentSelect").value,t=tournamentById(tid);if(!t)return;
  $("#enableRepechage").checked=!!t.config?.repechage;
  $("#enableThirdPlace").checked=t.config?.third_place!==false;
  const done=isGroupStageComplete(tid);
  $("#bracketStatus").textContent=done?"La fase de grupos terminó. Las eliminatorias se generan automáticamente.":"Las eliminatorias aparecerán al finalizar todas las peleas de grupos.";
  const ms=tournamentMatches(tid).filter(m=>m.phase!=="group");
  $("#knockoutBracket").innerHTML=ms.map(m=>`<div class="card knockout-card">
    <span class="pill">${esc(m.phase)}</span>
    <div class="teams" style="margin-top:10px"><span>${esc(participantName(m.side_a))}</span><span>VS</span><span>${esc(participantName(m.side_b))}</span></div>
    <div class="muted">${m.scheduled_at?new Date(m.scheduled_at).toLocaleString("es-BO"):"Sin horario"} · ${esc(m.status)}</div>
  </div>`).join("")||'<div class="muted">Aún no hay cruces eliminatorios.</div>';
}
$("#enableRepechage").onchange=async()=>{
  const tid=$("#adminTournamentSelect").value,t=tournamentById(tid);if(!t)return;
  await supabase.from("tournaments").update({config:{...t.config,repechage:$("#enableRepechage").checked}}).eq("id",tid);
  await loadAll();$("#adminTournamentSelect").value=tid;renderKnockoutPanel();
  if(isGroupStageComplete(tid))await autoGenerateKnockout(tid);
};
$("#enableThirdPlace").onchange=async()=>{
  const tid=$("#adminTournamentSelect").value,t=tournamentById(tid);if(!t)return;
  await supabase.from("tournaments").update({config:{...t.config,third_place:$("#enableThirdPlace").checked}}).eq("id",tid);
  await loadAll();$("#adminTournamentSelect").value=tid;renderKnockoutPanel();
};


function pvpMemberSelect(side,index){
  return `<div><label>${side} · integrante ${index+1}</label><select data-pvp-member="${side}-${index}">${accountOptions()}</select></div>`;
}
function renderPvpSides(){
  const format=$("#pvpFormat")?.value||"1v1",team=format==="2v2";
  if(!$("#pvpSides"))return;
  $("#pvpSides").innerHTML=`<div class="card pvp-side"><h3>Lado A</h3><div class="pvp-members">${pvpMemberSelect("a",0)}${team?pvpMemberSelect("a",1):""}</div></div><div class="card pvp-side"><h3>Lado B</h3><div class="pvp-members">${pvpMemberSelect("b",0)}${team?pvpMemberSelect("b",1):""}</div></div>`;
}
$("#pvpFormat").onchange=renderPvpSides;
$("#createPvpEvent").onclick=async()=>{
  const name=$("#pvpEventName").value.trim(),format=$("#pvpFormat").value,team=format==="2v2";
  if(!name){alert("Escribe el nombre del evento.");return}
  const ids=$$("[data-pvp-member]").map(x=>x.value);
  if(ids.some(x=>!x)){alert("Selecciona todos los participantes.");return}
  if(new Set(ids).size!==ids.length){alert("No puedes repetir una cuenta en la misma pelea.");return}
  const sideMembers=side=>ids.filter((_,i)=>team?(side==="a"?i<2:i>=2):(side==="a"?i===0:i===1)).map(id=>{const a=state.accounts.find(x=>x.id===id);return{id:a.id,name:a.username,type:"account"}});
  const aMembers=sideMembers("a"),bMembers=sideMembers("b");
  const config={event_kind:"pvp",groups:1,qualify_per_group:1,participant_count:2,third_place:false,repechage:false};
  const {data:t,error:te}=await supabase.from("tournaments").insert({name,format,status:"active",config}).select().single();
  if(te){alert(te.message);return}
  const parts=[aMembers,bMembers].map((members,i)=>({tournament_id:t.id,display_name:members.map(m=>m.name).join(" + "),kind:team?"team":"account",members,group_no:1,seed_elo:participantEloFromMembers(members)}));
  const {data:ps,error:pe}=await supabase.from("tournament_participants").insert(parts).select();
  if(pe){alert(pe.message);await supabase.from("tournaments").delete().eq("id",t.id);return}
  const {error:me}=await supabase.from("matches").insert({tournament_id:t.id,phase:"group",round_no:1,group_no:1,side_a:ps[0].id,side_b:ps[1].id,status:"scheduled"});
  if(me){alert(me.message);return}
  $("#pvpEventName").value="";await loadAll();renderPvpSides();
};
function renderPvpEvents(){
  if(!$("#pvpEventList"))return;
  const events=state.tournaments.filter(t=>t.config?.event_kind==="pvp");
  $("#pvpEventList").innerHTML=events.map(t=>{
    const m=tournamentMatches(t.id)[0];
    return `<div class="panel"><div class="section-heading"><div><strong>${esc(t.name)}</strong><div class="muted">${esc(t.format)} · ${esc(t.status)}</div></div><button class="danger" data-delete-pvp="${t.id}">Eliminar evento</button></div>${m?matchCardAdmin(m):'<div class="muted">Sin pelea.</div>'}</div>`;
  }).join("")||'<div class="muted">No hay peleas individuales creadas.</div>';
  $$('[data-start-match]').forEach(b=>b.onclick=()=>startMatch(b.dataset.startMatch));
  $$('[data-finish-match]').forEach(b=>b.onclick=()=>finishMatch(b.dataset.finishMatch,false));
  $$('[data-walkover-a]').forEach(b=>b.onclick=()=>finishMatch(b.dataset.walkoverA,true,"a"));
  $$('[data-walkover-b]').forEach(b=>b.onclick=()=>finishMatch(b.dataset.walkoverB,true,"b"));
  $$('[data-save-schedule]').forEach(b=>b.onclick=()=>saveSchedule(b.dataset.saveSchedule));
  $$('[data-save-odds]').forEach(b=>b.onclick=()=>saveManualOdds(b.dataset.saveOdds));
  $$('[data-clear-odds]').forEach(b=>b.onclick=()=>clearManualOdds(b.dataset.clearOdds));
  $$('[data-live-score]').forEach(input=>input.oninput=()=>queueLiveScoreSave(input.dataset.liveScore));
  $$('[data-delete-pvp]').forEach(b=>b.onclick=async()=>{if(confirm("¿Eliminar esta pelea individual?")){await supabase.from("tournaments").delete().eq("id",b.dataset.deletePvp);await loadAll()}});
}
renderPvpSides();

const pokemonPools=[
  {category:"Legendario",rarity:"Casi imposible",weight:0.34,names:`Articuno, Zapdos, Moltres, Mewtwo, Raikou, Entei, Suicune, Lugia, Ho-Oh, Regirock, Regice, Registeel, Latias, Latios, Kyogre, Groudon, Rayquaza, Uxie, Mesprit, Azelf, Dialga, Palkia, Giratina, Cobalion, Terrakion, Virizion, Tornadus, Thundurus, Landorus, Reshiram, Zekrom, Kyurem, Xerneas, Yveltal, Zygarde, Tapu Koko, Tapu Lele, Tapu Bulu, Tapu Fini, Solgaleo, Lunala, Necrozma, Zacian, Zamazenta, Eternatus, Calyrex, Glastrier, Spectrier, Enamorus, Ogerpon, Koraidon, Miraidon`},
  {category:"Mítico",rarity:"Casi imposible",weight:0.16,names:`Mew, Celebi, Jirachi, Deoxys, Phione, Manaphy, Darkrai, Shaymin, Arceus, Victini, Keldeo, Meloetta, Genesect, Diancie, Hoopa, Volcanion, Magearna, Marshadow, Zeraora, Meltan, Zarude, Pecharunt`},
  {category:"Sublegendario",rarity:"Casi imposible",weight:0.08,names:`Kubfu, Wo-Chien, Chien-Pao, Ting-Lu, Chi-Yu, Okidogi, Munkidori, Fezandipiti`},
  {category:"Ultraente",rarity:"Casi imposible",weight:0.08,names:`Nihilego, Buzzwole, Pheromosa, Xurkitree, Celesteela, Kartana, Guzzlord, Poipole, Stakataka, Blacephalon`},
  {category:"Paradoja",rarity:"Casi imposible",weight:0.22,names:`Gran Colmillo, Ferrodada, Colagrito, Ferropolilla, Furioseta, Ferrocuello, Melenaleteo, Ferropaladín, Colmilargo, Ferropúas, Pelarena, Ferromano, Melenatrueno, Ferrocanto, Electrofuria, Ferroverdor, Trepamuros, Ferromole`},
  {category:"Fase inicial específica",rarity:"Casi imposible",weight:0.12,names:`Cosmog, Tipo Cero`},
  {category:"Pseudolegendario inicial",rarity:"Muy difícil",weight:4,names:`Dratini, Larvitar, Bagon, Beldum, Gible, Deino, Goomy, Jangmo-o, Dreepy, Frigibax`},
  {category:"Inicial",rarity:"Difícil",weight:13,names:`Bulbasaur, Ivysaur, Venusaur, Charmander, Charmeleon, Charizard, Squirtle, Wartortle, Blastoise, Chikorita, Bayleef, Meganium, Cyndaquil, Quilava, Typhlosion, Totodile, Croconaw, Feraligatr, Treecko, Grovyle, Sceptile, Torchic, Combusken, Blaziken, Mudkip, Marshtomp, Swampert, Turtwig, Grotle, Torterra, Chimchar, Monferno, Infernape, Piplup, Prinplup, Empoleon, Snivy, Servine, Serperior, Tepig, Pignite, Emboar, Oshawott, Dewott, Samurott, Chespin, Quilladin, Chesnaught, Fennekin, Braixen, Delphox, Froakie, Frogadier, Greninja, Rowlet, Dartrix, Decidueye, Litten, Torracat, Incineroar, Popplio, Brionne, Primarina, Grookey, Thwackey, Rillaboom, Scorbunny, Raboot, Cinderace, Sobble, Drizzile, Inteleon, Sprigatito, Floragato, Meowscarada, Fuecoco, Crocalor, Skeledirge, Quaxly, Quaxwell, Quaquaval`},
  {category:"Común",rarity:"Común",weight:82,names:`Pidgey, Rattata, Spearow, Ekans, Sandshrew, Nidoran♀, Nidoran♂, Vulpix, Zubat, Oddish, Paras, Venonat, Diglett, Meowth, Psyduck, Mankey, Growlithe, Poliwag, Abra, Machop, Bellsprout, Tentacool, Geodude, Ponyta, Slowpoke, Magnemite, Farfetch'd, Doduo, Seel, Grimer, Shellder, Gastly, Onix, Drowzee, Krabby, Voltorb, Exeggcute, Cubone, Lickitung, Koffing, Rhyhorn, Tangela, Horsea, Goldeen, Staryu, Scyther, Jynx, Electabuzz, Magmar, Pinsir, Tauros, Magikarp, Lapras, Eevee, Porygon, Omanyte, Kabuto, Sentret, Ledyba, Spinarak, Chinchou, Pichu, Cleffa, Igglybuff, Togepi, Natu, Mareep, Sudowoodo, Hoppip, Aipom, Sunkern, Yanma, Wooper, Murkrow, Misdreavus, Wobbuffet, Girafarig, Pineco, Dunsparce, Gligar, Snubbull, Qwilfish, Shuckle, Heracross, Teddiursa, Slugma, Swinub, Corsola, Remoraid, Delibird, Skarmory, Houndour, Phanpy, Stantler, Smeargle, Smoochum, Elekid, Magby, Miltank, Poochyena, Zigzagoon, Wurmple, Lotad, Seedot, Taillow, Wingull, Ralts, Surskit, Shroomish, Slakoth, Nincada, Whismur, Makuhita, Nosepass, Skitty, Sableye, Mawile, Aron, Meditite, Electrike, Plusle, Minun, Volbeat, Illumise, Roselia, Gulpin, Carvanha, Wailmer, Numel, Spoink, Cacnea, Swablu, Corphish, Baltoy, Lileep, Anorith, Feebas, Castform, Kecleon, Shuppet, Duskull, Tropius, Chimecho, Absol, Wynaut, Snorunt, Spheal, Clamperl, Relicanth, Luvdisc, Bidoof, Kricketot, Shinx, Cranidos, Shieldon, Burmy, Combee, Pachirisu, Buizel, Cherubi, Shellos, Drifloon, Buneary, Glameow, Stunky, Bronzor, Chatot, Spiritomb, Riolu, Hippopotas, Skorupi, Croagunk, Carnivine, Finneon, Mantyke, Snover, Rotom, Patrat, Lillipup, Purrloin, Pansage, Pansear, Panpour, Munna, Pidove, Blitzle, Roggenrola, Woobat, Drilbur, Audino, Timburr, Tympole, Throh, Sawk, Sewaddle, Venipede, Cottonee, Petilil, Basculin, Sandile, Darumaka, Maractus, Dwebble, Scraggy, Sigilyph, Yamask, Tirtouga, Archen, Trubbish, Minccino, Gothita, Solosis, Ducklett, Vanillite, Deerling, Emolga, Karrablast, Foongus, Frillish, Alomomola, Joltik, Ferroseed, Klink, Tynamo, Elgyem, Litwick, Axew, Cubchoo, Cryogonal, Shelmet, Stunfisk, Mienfoo, Druddigon, Golett, Pawniard, Bouffalant, Rufflet, Vullaby, Heatmor, Durant, Bunnelby, Fletchling, Scatterbug, Litleo, Flabébé, Skiddo, Pancham, Furfrou, Espurr, Honedge, Spritzee, Swirlix, Inkay, Binacle, Skrelp, Clauncher, Helioptile, Amaura, Hawlucha, Carbink, Phantump, Pumpkaboo, Bergmite, Noibat, Grubbin, Crabrawler, Oricorio, Cutiefly, Rockruff, Wishiwashi, Mareanie, Mudbray, Dewpider, Fomantis, Morelull, Salandit, Stufful, Bounsweet, Comfey, Oranguru, Passimian, Wimpod, Sandygast, Pyukumuku, Togedemaru, Bruxish, Drampa, Dhelmise, Skwovet, Rookidee, Blipbug, Nickit, Gossifleur, Wooloo, Chewtle, Yamper, Rolycoly, Applin, Silicobra, Cramorant, Arrokuda, Toxel, Sizzlipede, Clobbopus, Sinistea, Hatenna, Impidimp, Milcery, Falinks, Pincurchin, Snom, Stonjourner, Eiscue, Indeedee, Morpeko, Cufant, Dracozolt, Arctozolt, Dracovish, Arctovish, Lechonk, Tarountula, Nymble, Pawmi, Tandemaus, Fidough, Smoliv, Squawkabilly, Nacli, Charcadet, Tadbulb, Wattrel, Maschiff, Shroodle, Bramblin, Toedscool, Klawf, Capsakid, Rellor, Flittle, Tinkatink, Wiglett, Bombirdier, Finizen, Varoom, Cyclizar, Orthworm, Glimmet, Greavard, Flamigo, Cetoddle, Veluza, Dondozo, Tatsugiri`}
].map(pool=>({...pool,names:pool.names.split(",").map(x=>x.trim()).filter(Boolean)}));
const dailyPrizes=[
  {label:"Común",weight:82},{label:"Difícil",weight:13},{label:"Muy difícil",weight:4},{label:"Casi imposible",weight:1}
];
function pickPokemon(){
  const pool=weightedPick(pokemonPools);
  const name=pool.names[Math.floor(Math.random()*pool.names.length)];
  return {name,category:pool.category,rarity:pool.rarity,label:`${name} · ${pool.category}`};
}
const paidPrizes=[
  {label:"Pokémon común aleatorio",weight:46},{label:"Pokémon raro aleatorio",weight:24},
  {label:"5 Caramelos Raros",weight:15},{label:"500 créditos",weight:10,credits:500},
  {label:"Pokémon shiny aleatorio",weight:4},{label:"Legendario / mítico",weight:1}
];
function weightedPick(items){let r=Math.random()*items.reduce((s,x)=>s+x.weight,0);for(const x of items){r-=x.weight;if(r<=0)return x}return items[0]}
function drawWheel(el,items){const colors=["#ef476f","#4d8dff","#33d17a","#ad7cff","#f5bd16","#ff8c42","#00a6a6"];const step=360/items.length;el.style.background=`conic-gradient(${items.map((x,i)=>`${colors[i%colors.length]} ${i*step}deg ${(i+1)*step}deg`).join(",")})`}
drawWheel($("#dailyWheel"),dailyPrizes);drawWheel($("#paidWheel"),paidPrizes);
async function spinVisual(el,items){const pick=weightedPick(items),idx=items.indexOf(pick),step=360/items.length;wheelRotation+=1440+(360-(idx*step+step/2));el.style.transform=`rotate(${wheelRotation}deg)`;await new Promise(r=>setTimeout(r,4300));return pick}
async function updateDailyButton(){
  if(!state.account){$("#spinDailyButton").disabled=true;return}
  const {data}=await supabase.from("daily_spins").select("account_id").eq("account_id",state.account.id).eq("spin_date",todayBolivia()).maybeSingle();
  $("#spinDailyButton").disabled=!!data;$("#spinDailyButton").textContent=data?"Giro diario usado":"Girar ruleta Pokémon";
}
$("#spinDailyButton").onclick=async()=>{
  if(!state.account)return;
  await spinVisual($("#dailyWheel"),dailyPrizes);
  const pick=pickPokemon();
  const {error}=await supabase.from("daily_spins").insert({account_id:state.account.id,spin_date:todayBolivia(),reward_label:pick.label});
  if(error){alert("Ya giraste hoy.");return}
  await supabase.from("rewards").insert({account_id:state.account.id,source:"Ruleta Pokémon diaria",label:pick.label});
  $("#dailyResult").innerHTML=`<strong>${esc(pick.name)}</strong><span>${esc(pick.category)} · ${esc(pick.rarity)}</span>`;
  await loadAll();
};
$("#spinPaidButton").onclick=async()=>{
  if(!state.account||state.account.credits<100){alert("Necesitas 100 créditos.");return}
  await supabase.from("accounts").update({credits:state.account.credits-100}).eq("id",state.account.id);
  pendingPaidReward=await spinVisual($("#paidWheel"),paidPrizes);$("#paidResult").textContent="Salió: "+pendingPaidReward.label;$("#acceptPaidReward").hidden=false;await loadAll();
};
$("#acceptPaidReward").onclick=async()=>{
  if(!pendingPaidReward||!state.account)return;
  if(pendingPaidReward.credits)await supabase.from("accounts").update({credits:state.account.credits+pendingPaidReward.credits}).eq("id",state.account.id);
  else await supabase.from("rewards").insert({account_id:state.account.id,source:"Ruleta Pokémon",label:pendingPaidReward.label});
  pendingPaidReward=null;$("#acceptPaidReward").hidden=true;$("#paidResult").textContent="Recompensa añadida.";await loadAll();
};
function renderRewards(){
  const mine=state.account?state.rewards.filter(r=>r.account_id===state.account.id):[];
  $("#myRewards").innerHTML=mine.map(r=>`<div class="card"><strong>${esc(r.label)}</strong><div class="muted">${esc(r.source)} · ${esc(r.status)}</div>${r.status==="available"?`<button data-request-reward="${r.id}">Reclamar</button>`:""}</div>`).join("")||'<div class="muted">No hay recompensas.</div>';
  $$("[data-request-reward]").forEach(b=>b.onclick=async()=>{await supabase.from("rewards").update({status:"requested",requested_at:new Date().toISOString()}).eq("id",b.dataset.requestReward);loadAll()});
  const requested=state.rewards.filter(r=>r.status==="requested");
  $("#deliveryList").innerHTML=requested.map(r=>{const a=state.accounts.find(x=>x.id===r.account_id);return`<div class="card"><strong>${esc(a?.username||"Cuenta")}</strong><div>${esc(r.label)}</div><button data-deliver="${r.id}">Confirmar entrega</button></div>`}).join("")||'<div class="muted">Sin solicitudes.</div>';
  $$("[data-deliver]").forEach(b=>b.onclick=async()=>{await supabase.from("rewards").update({status:"claimed",claimed_at:new Date().toISOString()}).eq("id",b.dataset.deliver);loadAll()});
}
$("#rewardDrawerButton").onclick=()=>$("#rewardDrawer").classList.toggle("open");
$("#deliveryDrawerButton").onclick=()=>$("#deliveryDrawer").classList.toggle("open");

let realtimeReloadTimer=null;
function queueRealtimeReload(){
  clearTimeout(realtimeReloadTimer);
  realtimeReloadTimer=setTimeout(()=>loadAll(),180);
}
for(const table of ["accounts","tournaments","tournament_participants","matches","bets","rewards","daily_spins","rankings"]){
  supabase.channel("rt-"+table).on("postgres_changes",{event:"*",schema:"public",table},queueRealtimeReload).subscribe();
}
const saved=localStorage.getItem("liga_account");
if(saved){const {data}=await supabase.from("accounts").select("*").eq("id",saved).maybeSingle();state.account=data||null}
await loadAll();
