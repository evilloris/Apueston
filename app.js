import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CONFIG } from "./config.js";

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);
const $ = s => document.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
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
const ELO_START = 1000;
const ELO_K = 32;
const ELO_TOURNEY_BONUS_WIN = 30;
const ELO_TOURNEY_BONUS_LOSE = 10;

function expected(a,b){ return 1/(1+10**((b-a)/400)); }
function clampOdds(v){ return Math.max(1.0001, Math.min(99, +Number(v).toFixed(4))); }
function koMarginMultiplier(winnerKos, loserKos){
  const margin = Math.max(0, Number(winnerKos||0)-Number(loserKos||0));
  return 1 + Math.min(.5, margin*.08);
}
function oddsFromElo(a,b){
  const pa=Math.max(.04,Math.min(.96,expected(a,b)));
  return {a:clampOdds(1/pa/.90), b:clampOdds(1/(1-pa)/.90)};
}
function diffCurveMultiplier(diff){
  const d=Math.abs(Number(diff||0));
  if(d<=1)return 1+d*.07;
  if(d===2)return 1.22;
  if(d===3)return 1.48;
  if(d===4)return 1.85;
  return 2.35+(d-5)*.30;
}
function crowdFactor(share){
  const centered=(Number(share||.5)-.5)*2;
  return Math.max(.72,Math.min(1.42,1-centered*.28));
}
function generateSeedOrder(n){
  let seeds=[1,2];
  while(seeds.length<n){
    const total=seeds.length*2+1,next=[];
    seeds.forEach(s=>{next.push(s);next.push(total-s)});
    seeds=next;
  }
  return seeds;
}
function roundRobinPairs(players){
  let ids=players.map(p=>p.id);
  if(ids.length%2)ids.push(null);
  const rounds=[],n=ids.length,half=n/2;
  let arr=[...ids];
  for(let r=0;r<n-1;r++){
    const pairs=[];
    for(let i=0;i<half;i++){
      const a=arr[i],b=arr[n-1-i];
      if(a&&b)pairs.push([a,b]);
    }
    rounds.push(pairs);
    const fixed=arr[0],rest=arr.slice(1);
    rest.unshift(rest.pop());
    arr=[fixed,...rest];
  }
  return rounds;
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
  $("#sessionLabel").textContent=state.account?state.account.username:"Sin sesión";
  $("#walletLabel").textContent=state.account?`💰 ${money(state.account.credits)}`:"💰 —";
  $("#loginButton").hidden=!!state.account; $("#logoutButton").hidden=!state.account;
  renderLeaderboard(); renderActiveEvents(); renderTournamentSelects(); renderBetMatches();
  renderMyBets(); renderGeneralStats(); renderResults(); renderAccountsAdmin();
  renderCreditsAdmin(); renderTournamentsAdmin(); renderRewards(); updateDailyButton();
}
function switchView(view){
  $$(".view").forEach(x=>x.classList.toggle("active",x.id===`view-${view}`));
  $$("#nav button").forEach(x=>x.classList.toggle("active",x.dataset.view===view));
}
$("#nav").addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(b)switchView(b.dataset.view)});

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
  if($("#adminTournamentSelect").value) renderParticipantCards();
}
$("#betTournamentSelect").onchange=renderBetMatches;
$("#resultTournamentSelect").onchange=renderResults;
$("#adminTournamentSelect").onchange=()=>{renderParticipantList();renderMatchAdmin();$("#participantPanel").hidden=false;$("#matchAdminPanel").hidden=false};

function dynamicOdds(match){
  const a=state.participants.find(p=>p.id===match.side_a);
  const b=state.participants.find(p=>p.id===match.side_b);
  const ra=rankingFor(a?.display_name).elo, rb=rankingFor(b?.display_name).elo;
  let odds=oddsFromElo(ra,rb);

  if(["live","finished"].includes(match.status) && match.score_a!==null && match.score_b!==null){
    const diff=Number(match.score_a||0)-Number(match.score_b||0);
    if(diff){
      const mult=diffCurveMultiplier(diff);
      if(diff>0){odds.a=clampOdds(odds.a/mult);odds.b=clampOdds(odds.b*mult)}
      else{odds.b=clampOdds(odds.b/mult);odds.a=clampOdds(odds.a*mult)}
    }
  }

  const winnerBets=state.bets.filter(bet=>bet.match_id===match.id&&bet.bet_type==="winner"&&bet.status==="pending");
  const poolA=winnerBets.filter(bet=>bet.selection?.participant_id===match.side_a).reduce((s,b)=>s+Number(b.stake||0),0);
  const poolB=winnerBets.filter(bet=>bet.selection?.participant_id===match.side_b).reduce((s,b)=>s+Number(b.stake||0),0);
  const total=poolA+poolB;
  if(total>0){
    odds.a=clampOdds(odds.a*crowdFactor(poolA/total));
    odds.b=clampOdds(odds.b*crowdFactor(poolB/total));
  }
  return odds;
}
function renderBetMatches(){
  const tid=$("#betTournamentSelect").value;
  const list=state.matches.filter(m=>m.tournament_id===tid&&["scheduled","live"].includes(m.status)&&m.side_a&&m.side_b);
  $("#betMatches").innerHTML=list.map(m=>{
    const o=dynamicOdds(m);
    return `<div class="card match clickable" data-bet-match="${m.id}">
      <div class="muted">${esc(m.phase)} · ronda ${m.round_no}</div>
      <div class="teams"><span>${esc(participantName(m.side_a))}</span><span>vs</span><span>${esc(participantName(m.side_b))}</span></div>
      <div class="odds"><span>x${o.a}</span><span>x${o.b}</span></div>
      <div class="muted">${m.scheduled_at?new Date(m.scheduled_at).toLocaleString("es-BO"):"Sin horario"}</div>
    </div>`;
  }).join("")||'<div class="muted">No hay enfrentamientos abiertos.</div>';
  $$("[data-bet-match]").forEach(c=>c.onclick=()=>openBet(c.dataset.betMatch));
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
    const ra=rankingFor(a).elo, rb=rankingFor(b).elo;
    const favoriteA=ra>=rb;
    const lines=[.5,1.5,2.5];
    const options=[];
    lines.forEach((line,idx)=>{
      const favOdds=clampOdds(1.55+idx*.40);
      const dogOdds=clampOdds(2.25+idx*.65);
      if(favoriteA){
        options.push(`<option data-odds="${favOdds}" value="${m.side_a}|-${line}">${esc(a)} -${line} · x${favOdds}</option>`);
        options.push(`<option data-odds="${dogOdds}" value="${m.side_b}|+${line}">${esc(b)} +${line} · x${dogOdds}</option>`);
      }else{
        options.push(`<option data-odds="${favOdds}" value="${m.side_b}|-${line}">${esc(b)} -${line} · x${favOdds}</option>`);
        options.push(`<option data-odds="${dogOdds}" value="${m.side_a}|+${line}">${esc(a)} +${line} · x${dogOdds}</option>`);
      }
    });
    $("#betDynamicFields").innerHTML=`<label>Selección de hándicap</label><select id="betSelection">${options.join("")}</select>`;
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
    const option=$("#betSelection").selectedOptions[0];
    return clampOdds(option?.dataset.odds || 1.9);
  }
  const a=state.participants.find(p=>p.id===m.side_a),b=state.participants.find(p=>p.id===m.side_b);
  return scoreOdds(rankingFor(a.display_name).elo,rankingFor(b.display_name).elo,+$("#scoreA").value,+$("#scoreB").value);
}
function updateBetPreview(){
  const odds=currentBetOdds(),stake=+$("#betStake").value||0;
  $("#betOddsPreview").textContent=`Cuota x${odds} · pago potencial ${money(Math.floor(stake*odds))}`;
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
  const accountNames=new Set(state.accounts.map(a=>a.username.toLowerCase()));
  const rows=state.rankings.filter(r=>accountNames.has(r.name.toLowerCase())).map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.name)}</td><td>${r.elo}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.kos_for}</td><td>${r.kos_against}</td></tr>`).join("");
  $("#generalStats").innerHTML=`<table><thead><tr><th>#</th><th>Jugador</th><th>ELO</th><th>PG</th><th>PP</th><th>KO+</th><th>KO-</th></tr></thead><tbody>${rows||'<tr><td colspan="7">Sin estadísticas.</td></tr>'}</tbody></table>`;
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

$("#createTournament").onclick=async()=>{
  const name=$("#tournamentName").value.trim();
  const format=$("#tournamentFormat").value;
  const participantCount=+$("#tournamentParticipants").value;
  const groups=+$("#tournamentGroups").value;
  const qualify=+$("#qualifyPerGroup").value;
  if(!name||participantCount<2||participantCount>32||groups<1||groups>participantCount||qualify<1){
    alert("Revisa el nombre, participantes, grupos y clasificados.");
    return;
  }
  const {data,error}=await supabase.from("tournaments").insert({
    name,format,
    config:{groups,qualify_per_group:qualify,participant_count:participantCount,third_place:true,repechage:false}
  }).select().single();
  if(error){alert(error.message);return}
  $("#tournamentName").value="";
  await loadAll();
  $("#adminTournamentSelect").value=data.id;
  $("#participantPanel").hidden=false;
  $("#matchAdminPanel").hidden=false;
  renderParticipantCards();
  renderParticipantList();
  renderMatchAdmin();
};
function renderTournamentsAdmin(){
  $("#tournamentAdminList").innerHTML=state.tournaments.map(t=>`<div class="card"><strong>${esc(t.name)}</strong><div class="muted">${esc(t.format)} · ${esc(t.status)}</div><button class="secondary" data-edit-tournament="${t.id}">Administrar</button> <button class="danger" data-delete-tournament="${t.id}">Eliminar</button></div>`).join("")||'<div class="muted">Sin torneos.</div>';
  $$("[data-edit-tournament]").forEach(b=>b.onclick=()=>{$("#adminTournamentSelect").value=b.dataset.editTournament;$("#participantPanel").hidden=false;$("#matchAdminPanel").hidden=false;renderParticipantList();renderMatchAdmin()});
  $$("[data-delete-tournament]").forEach(b=>b.onclick=async()=>{if(confirm("¿Eliminar torneo completo?")){await supabase.from("tournaments").delete().eq("id",b.dataset.deleteTournament);loadAll()}});
}

function accountOptionHtml(selected=""){
  return '<option value="">— Selecciona cuenta —</option>'+
    state.accounts.map(a=>`<option value="${a.id}" ${a.id===selected?"selected":""}>${esc(a.username)}</option>`).join("");
}
function participantCardMember(slotIndex, memberIndex, savedMember){
  const key=`${slotIndex}-${memberIndex}`;
  const isBot=savedMember?.type==="bot";
  const accountId=savedMember?.id||"";
  const botName=isBot?(savedMember?.name||""):"";
  return `<div class="participant-member" data-member-key="${key}">
    <label>${memberIndex===0?"Jugador":"Segundo integrante"}</label>
    <select data-slot-kind="${key}">
      <option value="account" ${!isBot?"selected":""}>Cuenta creada</option>
      <option value="bot" ${isBot?"selected":""}>Bot</option>
    </select>
    <select data-slot-account="${key}" ${isBot?"hidden":""}>${accountOptionHtml(accountId)}</select>
    <input data-slot-bot="${key}" ${!isBot?"hidden":""} value="${esc(botName)}" placeholder="Nombre del bot">
  </div>`;
}
function renderParticipantCards(){
  const tid=$("#adminTournamentSelect").value;
  const tournament=state.tournaments.find(t=>t.id===tid);
  if(!tournament){$("#participantCards").innerHTML="";return}
  const count=Number(tournament.config?.participant_count||2);
  const groups=Number(tournament.config?.groups||1);
  const existing=state.participants.filter(p=>p.tournament_id===tid);
  const cards=[];
  for(let i=0;i<count;i++){
    const saved=existing[i];
    const members=Array.isArray(saved?.members)?saved.members:[];
    cards.push(`<div class="participant-slot" data-participant-slot="${i}">
      <div class="participant-slot-title">${tournament.format==="2v2"?"Equipo":"Jugador"} ${i+1}</div>
      ${participantCardMember(i,0,members[0])}
      ${tournament.format==="2v2"?participantCardMember(i,1,members[1]):""}
      <div style="margin-top:10px"><label>Grupo</label>
        <select data-slot-group="${i}">
          ${Array.from({length:groups},(_,g)=>`<option value="${g+1}" ${(saved?.group_no||(i%groups)+1)===g+1?"selected":""}>Grupo ${String.fromCharCode(65+g)}</option>`).join("")}
        </select>
      </div>
    </div>`);
  }
  $("#participantCards").innerHTML=cards.join("");
  $$("[data-slot-kind]").forEach(sel=>sel.onchange=()=>{
    const key=sel.dataset.slotKind;
    document.querySelector(`[data-slot-account="${key}"]`).hidden=sel.value==="bot";
    document.querySelector(`[data-slot-bot="${key}"]`).hidden=sel.value!=="bot";
  });
}
$("#loadParticipantCards").onclick=renderParticipantCards;
$("#adminTournamentSelect").onchange=()=>{
  $("#participantPanel").hidden=!$("#adminTournamentSelect").value;
  $("#matchAdminPanel").hidden=!$("#adminTournamentSelect").value;
  renderParticipantCards();renderParticipantList();renderMatchAdmin();
};
$("#saveParticipants").onclick=async()=>{
  const tid=$("#adminTournamentSelect").value;
  const tournament=state.tournaments.find(t=>t.id===tid);
  if(!tournament)return;
  const cards=$$("[data-participant-slot]");
  const rows=[],used=new Set();

  for(const card of cards){
    const slot=card.dataset.participantSlot;
    const memberKinds=$$("[data-slot-kind]",card);
    const members=[];
    for(const kindSel of memberKinds){
      const key=kindSel.dataset.slotKind;
      let member;
      if(kindSel.value==="bot"){
        const name=document.querySelector(`[data-slot-bot="${key}"]`).value.trim();
        if(!name){alert(`Escribe el nombre del bot en la tarjeta ${Number(slot)+1}.`);return}
        member={name,type:"bot"};
      }else{
        const id=document.querySelector(`[data-slot-account="${key}"]`).value;
        const account=state.accounts.find(a=>a.id===id);
        if(!account){alert(`Selecciona una cuenta en la tarjeta ${Number(slot)+1}.`);return}
        member={id:account.id,name:account.username,type:"account"};
      }
      const unique=member.type+":"+String(member.id||member.name).toLowerCase();
      if(used.has(unique)){alert(`El participante ${member.name} está repetido.`);return}
      used.add(unique);members.push(member);
    }
    const display_name=tournament.format==="2v2"?members.map(m=>m.name).join(" + "):members[0].name;
    const seed_elo=Math.round(members.reduce((s,m)=>s+rankingFor(m.name).elo,0)/members.length);
    rows.push({
      tournament_id:tid,
      display_name,
      kind:tournament.format==="2v2"?"team":members[0].type,
      members,
      group_no:+card.querySelector(`[data-slot-group="${slot}"]`).value,
      seed_elo
    });
  }

  await supabase.from("tournament_participants").delete().eq("tournament_id",tid);
  const {error}=await supabase.from("tournament_participants").insert(rows);
  if(error){alert(error.message);return}
  await loadAll();
  $("#adminTournamentSelect").value=tid;
  renderParticipantCards();renderParticipantList();
  alert("Participantes guardados.");
};
function renderParticipantList(){
  const tid=$("#adminTournamentSelect").value;
  const ps=state.participants.filter(p=>p.tournament_id===tid).sort((a,b)=>a.group_no-b.group_no||b.seed_elo-a.seed_elo);
  $("#participantList").innerHTML=ps.map(p=>`<div class="card"><strong>${esc(p.display_name)}</strong><div class="muted">Grupo ${String.fromCharCode(64+p.group_no)} · ELO inicial ${p.seed_elo}</div></div>`).join("")||'<div class="muted">Completa y guarda las tarjetas.</div>';
}

$("#generateFixture").onclick=async()=>{
  const tid=$("#adminTournamentSelect").value;
  const t=state.tournaments.find(x=>x.id===tid);
  const ps=state.participants.filter(p=>p.tournament_id===tid);
  const expectedCount=Number(t?.config?.participant_count||0);
  if(!t||ps.length!==expectedCount){
    alert(`Debes guardar exactamente ${expectedCount} participantes antes de generar la fase.`);
    return;
  }
  await supabase.from("matches").delete().eq("tournament_id",tid);
  const rows=[];
  const groups=[...new Set(ps.map(p=>p.group_no))].sort((a,b)=>a-b);
  for(const groupNo of groups){
    const gp=ps.filter(p=>p.group_no===groupNo).sort((a,b)=>b.seed_elo-a.seed_elo);
    const rounds=roundRobinPairs(gp);
    rounds.forEach((pairs,r)=>{
      pairs.forEach(([a,b])=>{
        rows.push({tournament_id:tid,phase:"group",round_no:r+1,group_no:groupNo,side_a:a,side_b:b});
        if(t.format==="1v1-double"){
          rows.push({tournament_id:tid,phase:"group",round_no:r+1+rounds.length,group_no:groupNo,side_a:b,side_b:a});
        }
      });
    });
  }
  const {error}=await supabase.from("matches").insert(rows);
  if(error){alert(error.message);return}
  await supabase.from("tournaments").update({status:"active"}).eq("id",tid);
  await loadAll();$("#adminTournamentSelect").value=tid;renderMatchAdmin();
};
function renderMatchAdmin(){
  const tid=$("#adminTournamentSelect").value;
  const ms=state.matches.filter(m=>m.tournament_id===tid);
  $("#matchAdminList").innerHTML=ms.map(m=>`<div class="card">
    <strong>${esc(participantName(m.side_a))} vs ${esc(participantName(m.side_b))}</strong>
    <div class="muted">${esc(m.phase)} · ronda ${m.round_no}</div>
    <div class="row"><input type="number" min="0" value="${m.score_a??0}" data-score-a="${m.id}"><input type="number" min="0" value="${m.score_b??0}" data-score-b="${m.id}"><input type="datetime-local" data-schedule="${m.id}" value="${m.scheduled_at?new Date(m.scheduled_at).toISOString().slice(0,16):""}"><button data-save-match="${m.id}">Guardar</button></div>
  </div>`).join("")||'<div class="muted">Sin partidas.</div>';
  $$("[data-save-match]").forEach(b=>b.onclick=()=>saveMatch(b.dataset.saveMatch));
}
async function saveMatch(id){
  const m=state.matches.find(x=>x.id===id);
  const a=+document.querySelector(`[data-score-a="${id}"]`).value;
  const b=+document.querySelector(`[data-score-b="${id}"]`).value;
  const s=document.querySelector(`[data-schedule="${id}"]`).value;
  const finished=a!==b&&(a>0||b>0);
  const winner=finished?(a>b?m.side_a:m.side_b):null;

  const update={
    score_a:a,score_b:b,
    scheduled_at:s?new Date(s).toISOString():null,
    status:finished?"finished":"scheduled",
    winner_id:winner
  };
  const {error}=await supabase.from("matches").update(update).eq("id",id);
  if(error){alert(error.message);return}

  if(finished&&!m.elo_processed){
    await updateRankingAfterMatch(m,a,b,winner);
    await supabase.from("matches").update({elo_processed:true}).eq("id",id);
  }
  await settleBets(id);
  await loadAll();
  $("#adminTournamentSelect").value=m.tournament_id;
  renderMatchAdmin();
}
async function updateRankingAfterMatch(m,a,b,winner){
  const pa=state.participants.find(p=>p.id===m.side_a);
  const pb=state.participants.find(p=>p.id===m.side_b);
  const ra=rankingFor(pa.display_name), rb=rankingFor(pb.display_name);
  const aWon=winner===m.side_a;
  const winnerRating=aWon?ra.elo:rb.elo;
  const loserRating=aWon?rb.elo:ra.elo;
  const multiplier=koMarginMultiplier(aWon?a:b,aWon?b:a);
  const base=Math.round(ELO_K*(1-expected(winnerRating,loserRating))*multiplier);
  const winnerDelta=base+ELO_TOURNEY_BONUS_WIN;
  const loserDelta=-(base+ELO_TOURNEY_BONUS_LOSE);

  const nextA={
    name:pa.display_name,
    elo:Math.max(100,ra.elo+(aWon?winnerDelta:loserDelta)),
    wins:ra.wins+(aWon?1:0),
    losses:ra.losses+(aWon?0:1),
    kos_for:ra.kos_for+a,
    kos_against:ra.kos_against+b
  };
  const nextB={
    name:pb.display_name,
    elo:Math.max(100,rb.elo+(aWon?loserDelta:winnerDelta)),
    wins:rb.wins+(aWon?0:1),
    losses:rb.losses+(aWon?1:0),
    kos_for:rb.kos_for+b,
    kos_against:rb.kos_against+a
  };
  await supabase.from("rankings").upsert([nextA,nextB]);
}
async function settleBets(matchId){
  const m=(await supabase.from("matches").select("*").eq("id",matchId).single()).data;
  const bets=(await supabase.from("bets").select("*").eq("match_id",matchId).eq("status","pending")).data||[];
  for(const b of bets){
    let won=false;
    if(b.bet_type==="winner")won=b.selection.participant_id===m.winner_id;
    if(b.bet_type==="score")won=+b.selection.score_a===m.score_a&&+b.selection.score_b===m.score_b;
    if(b.bet_type==="handicap"){
      const selected=b.selection.participant_id,line=+b.selection.line;
      const diff=selected===m.side_a?(m.score_a+line-m.score_b):(m.score_b+line-m.score_a);won=diff>0;
    }
    const payout=won?Math.floor(b.stake*Number(b.locked_odds)):0;
    await supabase.from("bets").update({status:won?"won":"lost",payout}).eq("id",b.id);
    if(won){const acc=state.accounts.find(a=>a.id===b.account_id);if(acc)await supabase.from("accounts").update({credits:acc.credits+payout}).eq("id",acc.id)}
  }
}
$("#generateBracket").onclick=async()=>{
  const tid=$("#adminTournamentSelect").value;
  const t=state.tournaments.find(x=>x.id===tid);
  const groupMatches=state.matches.filter(m=>m.tournament_id===tid&&m.phase==="group");
  const pending=groupMatches.filter(m=>!["finished","walkover"].includes(m.status));
  if(pending.length){$("#bracketStatus").textContent=`Faltan ${pending.length} partidas de grupos.`;return}

  const q=Number(t.config.qualify_per_group||2);
  const groups=[...new Set(state.participants.filter(p=>p.tournament_id===tid).map(p=>p.group_no))].sort((a,b)=>a-b);
  const standings=standingsFor(tid);
  const qualifiers=[];
  for(let rank=0;rank<q;rank++){
    for(const groupNo of groups){
      const p=standings.filter(x=>x.group_no===groupNo)[rank];
      if(p)qualifiers.push(p);
    }
  }
  if(![2,4,8,16].includes(qualifiers.length)){
    alert("La cantidad total de clasificados debe ser 2, 4, 8 o 16.");
    return;
  }

  const ordered=generateSeedOrder(qualifiers.length).map(seed=>qualifiers[seed-1]);
  const phase=qualifiers.length===2?"final":qualifiers.length===4?"semifinal":qualifiers.length===8?"quarterfinal":"quarterfinal";
  const rows=[];
  for(let i=0;i<ordered.length;i+=2){
    rows.push({tournament_id:tid,phase,round_no:1,side_a:ordered[i].id,side_b:ordered[i+1].id});
  }
  const {error}=await supabase.from("matches").insert(rows);
  if(error){alert(error.message);return}
  $("#bracketStatus").textContent="Eliminatorias generadas según clasificación y seeding.";
  await loadAll();$("#adminTournamentSelect").value=tid;renderMatchAdmin();
};

const dailyPrizes=[
  {label:"500 créditos",weight:32,credits:500},{label:"1000 créditos",weight:8,credits:1000},
  {label:"10 Caramelos Raros",weight:18},{label:"Pokémon shiny aleatorio",weight:2},
  {label:"Pokémon común aleatorio",weight:38},{label:"Legendario / mítico del día",weight:.2},{label:"Pseudolegendario del día",weight:.8}
];
const FULL_FULL_PRIZE_CATS = {
  comun: { label: "Común", color: "#8A93A6" },
  inicial: { label: "Inicial", color: "#8BE58B" },
  pseudolegendario: { label: "Pseudolegendario", color: "#FF9FD1" },
  legendario: { label: "Legendario", color: "#F2B705" },
  sublegendario: { label: "Sublegendario", color: "#FF8C42" },
  mitico: { label: "Mítico", color: "#E63946" },
  ultraente: { label: "Ultraente", color: "#A26BFA" },
  paradoja: { label: "Paradoja", color: "#4DD9E8" },
};

// Pool de premios: cada entrada = { name, catKey, weight, isPokemon, isJackpot }
const FULL_FULL_PRIZE_POOL = [];
["Pidgey", "Rattata", "Spearow", "Ekans", "Sandshrew", "Nidoran♀", "Nidoran♂", "Vulpix", "Zubat", "Oddish", "Paras", "Venonat", "Diglett", "Meowth", "Psyduck", "Mankey", "Growlithe", "Poliwag", "Abra", "Machop", "Bellsprout", "Tentacool", "Geodude", "Ponyta", "Slowpoke", "Magnemite", "Farfetch'd", "Doduo", "Seel", "Grimer", "Shellder", "Gastly", "Onix", "Drowzee", "Krabby", "Voltorb", "Exeggcute", "Cubone", "Lickitung", "Koffing", "Rhyhorn", "Tangela", "Horsea", "Goldeen", "Staryu", "Scyther", "Jynx", "Electabuzz", "Magmar", "Pinsir", "Tauros", "Magikarp", "Lapras", "Eevee", "Porygon", "Omanyte", "Kabuto", "Sentret", "Ledyba", "Spinarak", "Chinchou", "Pichu", "Cleffa", "Igglybuff", "Togepi", "Natu", "Mareep", "Sudowoodo", "Hoppip", "Aipom", "Sunkern", "Yanma", "Wooper", "Murkrow", "Misdreavus", "Wobbuffet", "Girafarig", "Pineco", "Dunsparce", "Gligar", "Snubbull", "Qwilfish", "Shuckle", "Heracross", "Teddiursa", "Slugma", "Swinub", "Corsola", "Remoraid", "Delibird", "Skarmory", "Houndour", "Phanpy", "Stantler", "Smeargle", "Smoochum", "Elekid", "Magby", "Miltank", "Poochyena", "Zigzagoon", "Wurmple", "Lotad", "Seedot", "Taillow", "Wingull", "Ralts", "Surskit", "Shroomish", "Slakoth", "Nincada", "Whismur", "Makuhita", "Nosepass", "Skitty", "Sableye", "Mawile", "Aron", "Meditite", "Electrike", "Plusle", "Minun", "Volbeat", "Illumise", "Roselia", "Gulpin", "Carvanha", "Wailmer", "Numel", "Spoink", "Cacnea", "Swablu", "Corphish", "Baltoy", "Lileep", "Anorith", "Feebas", "Castform", "Kecleon", "Shuppet", "Duskull", "Tropius", "Chimecho", "Absol", "Wynaut", "Snorunt", "Spheal", "Clamperl", "Relicanth", "Luvdisc", "Bidoof", "Kricketot", "Shinx", "Cranidos", "Shieldon", "Burmy", "Combee", "Pachirisu", "Buizel", "Cherubi", "Shellos", "Drifloon", "Buneary", "Glameow", "Stunky", "Bronzor", "Chatot", "Spiritomb", "Gible", "Riolu", "Hippopotas", "Skorupi", "Croagunk", "Carnivine", "Finneon", "Mantyke", "Snover", "Rotom", "Patrat", "Lillipup", "Purrloin", "Pansage", "Pansear", "Panpour", "Munna", "Pidove", "Blitzle", "Roggenrola", "Woobat", "Drilbur", "Audino", "Timburr", "Tympole", "Throh", "Sawk", "Sewaddle", "Venipede", "Cottonee", "Petilil", "Basculin", "Sandile", "Darumaka", "Maractus", "Dwebble", "Scraggy", "Sigilyph", "Yamask", "Tirtouga", "Archen", "Trubbish", "Minccino", "Gothita", "Solosis", "Ducklett", "Vanillite", "Deerling", "Emolga", "Karrablast", "Foongus", "Frillish", "Alomomola", "Joltik", "Ferroseed", "Klink", "Tynamo", "Elgyem", "Litwick", "Axew", "Cubchoo", "Cryogonal", "Shelmet", "Stunfisk", "Mienfoo", "Druddigon", "Golett", "Pawniard", "Bouffalant", "Rufflet", "Vullaby", "Heatmor", "Durant", "Bunnelby", "Fletchling", "Scatterbug", "Litleo", "Flabébé", "Skiddo", "Pancham", "Furfrou", "Espurr", "Honedge", "Spritzee", "Swirlix", "Inkay", "Binacle", "Skrelp", "Clauncher", "Helioptile", "Amaura", "Hawlucha", "Carbink", "Phantump", "Pumpkaboo", "Bergmite", "Noibat", "Grubbin", "Crabrawler", "Oricorio", "Cutiefly", "Rockruff", "Wishiwashi", "Mareanie", "Mudbray", "Dewpider", "Fomantis", "Morelull", "Salandit", "Stufful", "Bounsweet", "Comfey", "Oranguru", "Passimian", "Wimpod", "Sandygast", "Pyukumuku", "Togedemaru", "Bruxish", "Drampa", "Dhelmise", "Skwovet", "Rookidee", "Blipbug", "Nickit", "Gossifleur", "Wooloo", "Chewtle", "Yamper", "Rolycoly", "Applin", "Silicobra", "Cramorant", "Arrokuda", "Toxel", "Sizzlipede", "Clobbopus", "Sinistea", "Hatenna", "Impidimp", "Milcery", "Falinks", "Pincurchin", "Snom", "Stonjourner", "Eiscue", "Indeedee", "Morpeko", "Cufant", "Dracozolt", "Arctozolt", "Dracovish", "Arctovish", "Lechonk", "Tarountula", "Nymble", "Pawmi", "Tandemaus", "Fidough", "Smoliv", "Squawkabilly", "Nacli", "Charcadet", "Tadbulb", "Wattrel", "Maschiff", "Shroodle", "Bramblin", "Toedscool", "Klawf", "Capsakid", "Rellor", "Flittle", "Tinkatink", "Wiglett", "Bombirdier", "Finizen", "Varoom", "Cyclizar", "Orthworm", "Glimmet", "Greavard", "Flamigo", "Cetoddle", "Veluza", "Dondozo", "Tatsugiri"].forEach(n => FULL_PRIZE_POOL.push({ name: n, catKey: "comun", weight: 1000, isPokemon: true, isJackpot: false }));
["Articuno", "Zapdos", "Moltres", "Mewtwo", "Raikou", "Entei", "Suicune", "Lugia", "Ho-Oh", "Regirock", "Regice", "Registeel", "Latias", "Latios", "Kyogre", "Groudon", "Rayquaza", "Uxie", "Mesprit", "Azelf", "Dialga", "Palkia", "Giratina", "Cobalion", "Terrakion", "Virizion", "Tornadus", "Thundurus", "Landorus", "Reshiram", "Zekrom", "Kyurem", "Xerneas", "Yveltal", "Zygarde", "Tapu Koko", "Tapu Lele", "Tapu Bulu", "Tapu Fini", "Solgaleo", "Lunala", "Necrozma", "Zacian", "Zamazenta", "Eternatus", "Calyrex", "Glastrier", "Spectrier", "Enamorus", "Ogerpon", "Koraidon", "Miraidon", "Cosmog", "Tipo Cero"].forEach(n => FULL_PRIZE_POOL.push({ name: n, catKey: "legendario", weight: 0.5, isPokemon: true, isJackpot: false }));
["Kubfu", "Wo-Chien", "Chien-Pao", "Ting-Lu", "Chi-Yu", "Okidogi", "Munkidori", "Fezandipiti"].forEach(n => FULL_PRIZE_POOL.push({ name: n, catKey: "sublegendario", weight: 0.5, isPokemon: true, isJackpot: false }));
["Mew", "Celebi", "Jirachi", "Deoxys", "Phione", "Manaphy", "Darkrai", "Shaymin", "Arceus", "Victini", "Keldeo", "Meloetta", "Genesect", "Diancie", "Hoopa", "Volcanion", "Magearna", "Marshadow", "Zeraora", "Meltan", "Zarude", "Pecharunt"].forEach(n => FULL_PRIZE_POOL.push({ name: n, catKey: "mitico", weight: 0.5, isPokemon: true, isJackpot: false }));
["Nihilego", "Buzzwole", "Pheromosa", "Xurkitree", "Celesteela", "Kartana", "Guzzlord", "Poipole", "Stakataka", "Blacephalon"].forEach(n => FULL_PRIZE_POOL.push({ name: n, catKey: "ultraente", weight: 0.5, isPokemon: true, isJackpot: false }));
["Gran Colmillo", "Ferrodada", "Colagrito", "Ferropolilla", "Furioseta", "Ferrocuello", "Melenaleteo", "Ferropaladín", "Colmilargo", "Ferropúas", "Pelarena", "Ferromano", "Melenatrueno", "Ferrocanto", "Electrofuria", "Ferroverdor", "Trepamuros", "Ferromole"].forEach(n => FULL_PRIZE_POOL.push({ name: n, catKey: "paradoja", weight: 0.5, isPokemon: true, isJackpot: false }));
["Dratini", "Larvitar", "Bagon", "Beldum", "Gible", "Deino", "Goomy", "Jangmo-o", "Dreepy", "Frigibax"].forEach(n => FULL_PRIZE_POOL.push({ name: n, catKey: "pseudolegendario", weight: 15, isPokemon: true, isJackpot: false }));
["Bulbasaur", "Ivysaur", "Venusaur", "Charmander", "Charmeleon", "Charizard", "Squirtle", "Wartortle", "Blastoise", "Chikorita", "Bayleef", "Meganium", "Cyndaquil", "Quilava", "Typhlosion", "Totodile", "Croconaw", "Feraligatr", "Treecko", "Grovyle", "Sceptile", "Torchic", "Combusken", "Blaziken", "Mudkip", "Marshtomp", "Swampert", "Turtwig", "Grotle", "Torterra", "Chimchar", "Monferno", "Infernape", "Piplup", "Prinplup", "Empoleon", "Snivy", "Servine", "Serperior", "Tepig", "Pignite", "Emboar", "Oshawott", "Dewott", "Samurott", "Chespin", "Quilladin", "Chesnaught", "Fennekin", "Braixen", "Delphox", "Froakie", "Frogadier", "Greninja", "Rowlet", "Dartrix", "Decidueye", "Litten", "Torracat", "Incineroar", "Popplio", "Brionne", "Primarina", "Grookey", "Thwackey", "Rillaboom", "Scorbunny", "Raboot", "Cinderace", "Sobble", "Drizzile", "Inteleon", "Sprigatito", "Floragato", "Meowscarada", "Fuecoco", "Crocalor", "Skeledirge", "Quaxly", "Quaxwell", "Quaquaval"].forEach(n => FULL_PRIZE_POOL.push({ name: n, catKey: "inicial", weight: 80, isPokemon: true, isJackpot: false }));

// Recompensas especiales (no son Pokémon)
FULL_PRIZE_POOL.push({ name: "x5 Caramelo Raro", catKey: null, catLabelOverride: "Poco común", catColorOverride: "#4C8DFF", weight: 150, isPokemon: false, isJackpot: false });
FULL_PRIZE_POOL.push({ name: "x50 Créditos", catKey: null, catLabelOverride: "Muy común", catColorOverride: "#2ED573", weight: 1500, isPokemon: false, isJackpot: false });
FULL_PRIZE_POOL.push({ name: "x100 Créditos", catKey: null, catLabelOverride: "Común", catColorOverride: "#8A93A6", weight: 1000, isPokemon: false, isJackpot: false });
FULL_PRIZE_POOL.push({ name: "x10000 Créditos", catKey: null, catLabelOverride: "Extremadamente poco común", catColorOverride: "#F2B705", weight: 0.05, isPokemon: false, isJackpot: true });
FULL_PRIZE_POOL.push({ name: "x1 Piedra Mega", catKey: null, catLabelOverride: "Muy poco común (elección libre)", catColorOverride: "#C9A6FF", weight: 3, isPokemon: false, isJackpot: false });
let prizeTotalWeight = 0;
FULL_PRIZE_POOL.forEach(p => { prizeTotalWeight += p.weight; });

function pickFullPrize() {
  let r = Math.random() * prizeTotalWeight;
  for (let i = 0; i < FULL_PRIZE_POOL.length; i++) {
    r -= FULL_PRIZE_POOL[i].weight;
    if (r <= 0) return FULL_PRIZE_POOL[i];
  }
  return FULL_PRIZE_POOL[FULL_PRIZE_POOL.length - 1];
}

function fullPrizeCategory(prize) {
  if (prize.catKey) return FULL_PRIZE_CATS[prize.catKey];
  return { label: prize.catLabelOverride, color: prize.catColorOverride };
}

// ---------- nombre del entrenador (reutiliza la misma clave que la Casa de Apuestas) ----------

const paidPrizes=FULL_PRIZE_POOL;
function weightedPick(items){let r=Math.random()*items.reduce((s,x)=>s+x.weight,0);for(const x of items){r-=x.weight;if(r<=0)return x}return items[0]}
function drawWheel(el,items){const colors=["#ef476f","#4d8dff","#33d17a","#ad7cff","#f5bd16","#ff8c42","#00a6a6"];const step=360/items.length;el.style.background=`conic-gradient(${items.map((x,i)=>`${colors[i%colors.length]} ${i*step}deg ${(i+1)*step}deg`).join(",")})`}
drawWheel($("#dailyWheel"),dailyPrizes);
drawWheel($("#paidWheel"),paidPrizes.slice(0,Math.min(24,paidPrizes.length)));
async function spinVisual(el,items){const pick=weightedPick(items),idx=items.indexOf(pick),step=360/items.length;wheelRotation+=1440+(360-(idx*step+step/2));el.style.transform=`rotate(${wheelRotation}deg)`;await new Promise(r=>setTimeout(r,4300));return pick}
async function updateDailyButton(){
  if(!state.account){$("#spinDailyButton").disabled=true;return}
  const {data}=await supabase.from("daily_spins").select("account_id").eq("account_id",state.account.id).eq("spin_date",todayBolivia()).maybeSingle();
  $("#spinDailyButton").disabled=!!data;$("#spinDailyButton").textContent=data?"Giro diario usado":"Girar una vez al día";
}
$("#spinDailyButton").onclick=async()=>{
  if(!state.account)return;
  const pick=await spinVisual($("#dailyWheel"),dailyPrizes);
  const {error}=await supabase.from("daily_spins").insert({account_id:state.account.id,spin_date:todayBolivia(),reward_label:pick.label});
  if(error){alert("Ya giraste hoy.");return}
  if(pick.credits)await supabase.from("accounts").update({credits:state.account.credits+pick.credits}).eq("id",state.account.id);
  else await supabase.from("rewards").insert({account_id:state.account.id,source:"Ruleta diaria",label:pick.label});
  $("#dailyResult").textContent="Premio: "+pick.label;await loadAll();
};
$("#spinPaidButton").onclick=async()=>{
  if(!state.account||state.account.credits<100){alert("Necesitas 100 créditos.");return}
  await supabase.from("accounts").update({credits:state.account.credits-100}).eq("id",state.account.id);
  const visualItems=paidPrizes.slice(0,Math.min(24,paidPrizes.length));
  await spinVisual($("#paidWheel"),visualItems);
  pendingPaidReward=pickFullPrize();
  const category=fullPrizeCategory(pendingPaidReward);
  $("#paidResult").innerHTML=`Salió: <strong style="color:${category.color}">${esc(pendingPaidReward.name)}</strong><div class="muted">${esc(category.label)}</div>`;
  $("#acceptPaidReward").hidden=false;
  await loadAll();
};
$("#acceptPaidReward").onclick=async()=>{
  if(!pendingPaidReward||!state.account)return;
  const rewardName=pendingPaidReward.name;
  const creditMatch=rewardName.match(/x(\d+) Créditos/i);
  if(creditMatch){
    await supabase.from("accounts").update({credits:state.account.credits+Number(creditMatch[1])}).eq("id",state.account.id);
  }else{
    await supabase.from("rewards").insert({account_id:state.account.id,source:"Ruleta Pokémon",label:rewardName});
  }
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

for(const table of ["accounts","tournaments","tournament_participants","matches","bets","rewards","daily_spins","rankings"]){
  supabase.channel("rt-"+table).on("postgres_changes",{event:"*",schema:"public",table},()=>loadAll()).subscribe();
}
const saved=localStorage.getItem("liga_account");
if(saved){const {data}=await supabase.from("accounts").select("*").eq("id",saved).maybeSingle();state.account=data||null}
await loadAll();
