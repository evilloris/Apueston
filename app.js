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
  admin:false, account:null, tournaments:[], participants:[], matches:[], bets:[], rewards:[], rankings:[], cashierTransactions:[]
};
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
  const [accounts,tournaments,participants,matches,bets,rewards,rankings,cashierTransactions] = await Promise.all([
    supabase.from("accounts").select("*").order("credits",{ascending:false}),
    supabase.from("tournaments").select("*").order("created_at",{ascending:false}),
    supabase.from("tournament_participants").select("*"),
    supabase.from("matches").select("*").order("created_at"),
    supabase.from("bets").select("*").order("created_at",{ascending:false}),
    supabase.from("rewards").select("*").order("created_at",{ascending:false}),
    supabase.from("rankings").select("*").order("elo",{ascending:false}),
    supabase.from("cashier_transactions").select("*").order("created_at",{ascending:false})
  ]);
  for(const result of [accounts,tournaments,participants,matches,bets,rewards,rankings,cashierTransactions]){
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
  renderLeaderboard(); renderActiveEvents(); renderTournamentSelects(); renderBetMatches(); renderBetTournamentStandings(); renderBetStandings();
  renderMyBets(); renderGeneralStats(); renderResults(); renderAccountsAdmin();
  renderCreditsAdmin(); renderTournamentsAdmin(); renderIndividualEventsAdmin(); renderRewards(); renderWeeklyDailyPrizes(); updateDailyButton();
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
  window.scrollTo({top:0,behavior:"smooth"});
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

  // Presión moderada por dinero apostado. Solo cuenta apuestas pendientes al ganador.
  const winnerBets=state.bets.filter(b=>b.match_id===match.id&&b.bet_type==='winner'&&b.status==='pending');
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
  const list=state.matches.filter(m=>m.tournament_id===tid&&["scheduled","live"].includes(m.status)&&m.side_a&&m.side_b);
  $("#betMatches").innerHTML=list.map(m=>{
    const o=dynamicOdds(m);
    const blocked=accountParticipatesInMatch(m);
    return `<div class="card match clickable${blocked?" bet-blocked":""}" data-bet-match="${m.id}">
      <div class="muted">${esc(m.phase)} · ronda ${m.round_no}${blocked?" · No puedes apostar en tu propia partida":""}</div>
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
    const detail=b.bet_type==='parlay'?`<div class="bet-detail">${esc(parlayDetail(b))}</div>`:'';
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
function renderCreditsAdmin(){
  const allowed=state.admin||state.account?.is_cashier;
  if(!allowed)return;
  const me=state.account;
  const rows=state.accounts.map(a=>{
    const selfBlocked=!state.admin&&me?.id===a.id;
    return `<tr><td>${esc(a.username)}${selfBlocked?' (tú)':''}</td><td>${money(a.credits)}</td><td><input type="number" min="1" value="100" data-credit-input="${a.id}" ${selfBlocked?'disabled':''}></td><td><button data-add-credit="${a.id}" ${selfBlocked?'disabled':''}>Recargar</button> <button class="danger" data-remove-credit="${a.id}" ${selfBlocked?'disabled':''}>Retirar</button></td></tr>`;
  }).join('');
  $('#creditAdminList').innerHTML=`<table><thead><tr><th>Cuenta</th><th>Saldo</th><th>Monto</th><th>Acción</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Sin cuentas.</td></tr>'}</tbody></table>`;
  $$('[data-add-credit]').forEach(b=>b.onclick=()=>changeCredits(b.dataset.addCredit,1));
  $$('[data-remove-credit]').forEach(b=>b.onclick=()=>changeCredits(b.dataset.removeCredit,-1));

  const totals=cashierTotals();
  const mine=(Array.isArray(state.cashierTransactions)?state.cashierTransactions:[])
    .filter(t=>{
      const isRecharge=String(t.operation||'').trim().toLowerCase()==='recharge';
      if(!isRecharge)return false;
      // El administrador inicia sesión sin una cuenta normal, por eso sus movimientos
      // se identifican mediante operated_by_admin en lugar de cashier_id.
      return state.admin ? t.operated_by_admin===true : t.cashier_id===me?.id;
    })
    .reduce((a,t)=>a+(Number(t.credits)||0),0);
  const personalRate=state.admin ? 0.40 : (me?.is_cashier ? 0.30 : 0);
  const personalCommissionCredits=mine*personalRate;
  $('#cashierSummary').innerHTML=`
    <div class="card"><strong>Fondo común disponible</strong><div>${(totals.commonCredits/30).toFixed(2)} diamantes</div><small>${money(totals.commonCredits)} créditos equivalentes</small></div>
    <div class="card"><strong>Tus recargas acumuladas</strong><div>${money(mine)} créditos</div><small>${(mine/30).toFixed(2)} diamantes cobrados</small></div>
    <div class="card"><strong>Tu ${state.admin?'40':'30'}%</strong><div>${(personalCommissionCredits/30).toFixed(2)} diamantes</div><small>${money(personalCommissionCredits)} créditos equivalentes de comisión</small></div>`;

  const history=state.cashierTransactions.map(t=>{
    const cashier=state.accounts.find(a=>a.id===t.cashier_id)?.username||(t.operated_by_admin?'Administrador':'Cuenta eliminada');
    const target=state.accounts.find(a=>a.id===t.target_account_id)?.username||'Cuenta eliminada';
    const diamonds=Number(t.credits)/30;
    const share=String(t.operation||'').trim().toLowerCase()==='recharge' ? diamonds*(t.operated_by_admin ? 0.40 : 0.30) : 0;
    return `<tr><td>${new Date(t.created_at).toLocaleString('es-BO')}</td><td>${esc(cashier)}</td><td>${esc(target)}</td><td>${t.operation==='recharge'?'Recarga':'Retiro'}</td><td>${money(t.credits)}</td><td>${diamonds.toFixed(2)}</td><td>${share.toFixed(2)}</td></tr>`;
  }).join('');
  $('#cashierHistory').innerHTML=`<table><thead><tr><th>Fecha</th><th>Cajero</th><th>Cuenta</th><th>Movimiento</th><th>Créditos</th><th>Diamantes</th><th>Comisión personal</th></tr></thead><tbody>${history||'<tr><td colspan="7">Sin movimientos.</td></tr>'}</tbody></table>`;
}
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
    if(logError){
      console.error(logError);
      return alert('Los créditos cambiaron, pero no se pudo registrar el movimiento: '+logError.message);
    }
  }else{
    if(!state.account?.is_cashier)return alert('No tienes activo el rol de cajero.');
    const {error}=await supabase.rpc('cashier_change_credits',{p_cashier_id:state.account.id,p_target_id:id,p_operation:operation,p_credits:amount});
    if(error)return alert(error.message);
  }
  // Fuerza una lectura nueva del historial para que los tres acumulados cambien
  // inmediatamente, sin depender de Realtime ni de la caché del navegador.
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
  $("#tournamentAdminList").innerHTML=state.tournaments.filter(t=>!isIndividualEvent(t)).map(t=>{
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
  const {error}=await supabase.from("matches").update({scheduled_at:value?new Date(value).toISOString():null}).eq("id",id);
  if(error)alert(error.message);else alert("Fecha y hora guardadas.");
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
  legendary:`Articuno,Zapdos,Moltres,Mewtwo,Raikou,Entei,Suicune,Lugia,Ho-Oh,Regirock,Regice,Registeel,Latias,Latios,Kyogre,Groudon,Rayquaza,Uxie,Mesprit,Azelf,Dialga,Palkia,Giratina,Cobalion,Terrakion,Virizion,Tornadus,Thundurus,Landorus,Reshiram,Zekrom,Kyurem,Xerneas,Yveltal,Zygarde,Tapu Koko,Tapu Lele,Tapu Bulu,Tapu Fini,Solgaleo,Lunala,Necrozma,Zacian,Zamazenta,Eternatus,Calyrex,Glastrier,Spectrier,Enamorus,Ogerpon,Koraidon,Miraidon`.split(','),
  mythical:`Mew,Celebi,Jirachi,Deoxys,Phione,Manaphy,Darkrai,Shaymin,Arceus,Victini,Keldeo,Meloetta,Genesect,Diancie,Hoopa,Volcanion,Magearna,Marshadow,Zeraora,Meltan,Zarude,Pecharunt`.split(','),
  sublegendary:`Kubfu,Wo-Chien,Chien-Pao,Ting-Lu,Chi-Yu,Okidogi,Munkidori,Fezandipiti`.split(','),
  ultraBeast:`Nihilego,Buzzwole,Pheromosa,Xurkitree,Celesteela,Kartana,Guzzlord,Poipole,Stakataka,Blacephalon`.split(','),
  paradox:`Gran Colmillo,Ferrodada,Colagrito,Ferropolilla,Furioseta,Ferrocuello,Melenaleteo,Ferropaladín,Colmilargo,Ferropúas,Pelarena,Ferromano,Melenatrueno,Ferrocanto,Electrofuria,Ferroverdor,Trepamuros,Ferromole`.split(','),
  specialInitial:`Cosmog,Tipo Cero`.split(','),
  veryHard:`Dratini,Larvitar,Bagon,Beldum,Gible,Deino,Goomy,Jangmo-o,Dreepy,Frigibax`.split(','),
  fossil:`Aerodactyl,Omanyte,Omastar,Kabuto,Kabutops,Lileep,Cradily,Anorith,Armaldo,Cranidos,Rampardos,Shieldon,Bastiodon,Tirtouga,Carracosta,Archen,Archeops,Tyrunt,Tyrantrum,Amaura,Aurorus,Dracozolt,Arctozolt,Dracovish,Arctovish`.split(','),
  hard:`Bulbasaur,Ivysaur,Venusaur,Charmander,Charmeleon,Charizard,Squirtle,Wartortle,Blastoise,Chikorita,Bayleef,Meganium,Cyndaquil,Quilava,Typhlosion,Totodile,Croconaw,Feraligatr,Treecko,Grovyle,Sceptile,Torchic,Combusken,Blaziken,Mudkip,Marshtomp,Swampert,Turtwig,Grotle,Torterra,Chimchar,Monferno,Infernape,Piplup,Prinplup,Empoleon,Snivy,Servine,Serperior,Tepig,Pignite,Emboar,Oshawott,Dewott,Samurott,Chespin,Quilladin,Chesnaught,Fennekin,Braixen,Delphox,Froakie,Frogadier,Greninja,Rowlet,Dartrix,Decidueye,Litten,Torracat,Incineroar,Popplio,Brionne,Primarina,Grookey,Thwackey,Rillaboom,Scorbunny,Raboot,Cinderace,Sobble,Drizzile,Inteleon,Sprigatito,Floragato,Meowscarada,Fuecoco,Crocalor,Skeledirge,Quaxly,Quaxwell,Quaquaval`.split(','),
  common:`Pidgey,Rattata,Spearow,Ekans,Sandshrew,Nidoran♀,Nidoran♂,Vulpix,Zubat,Oddish,Paras,Venonat,Diglett,Meowth,Psyduck,Mankey,Growlithe,Poliwag,Abra,Machop,Bellsprout,Tentacool,Geodude,Ponyta,Slowpoke,Magnemite,Farfetch'd,Doduo,Seel,Grimer,Shellder,Gastly,Onix,Drowzee,Krabby,Voltorb,Exeggcute,Cubone,Lickitung,Koffing,Rhyhorn,Tangela,Horsea,Goldeen,Staryu,Scyther,Jynx,Electabuzz,Magmar,Pinsir,Tauros,Magikarp,Lapras,Eevee,Porygon,Sentret,Ledyba,Spinarak,Chinchou,Pichu,Cleffa,Igglybuff,Togepi,Natu,Mareep,Sudowoodo,Hoppip,Aipom,Sunkern,Yanma,Wooper,Murkrow,Misdreavus,Wobbuffet,Girafarig,Pineco,Dunsparce,Gligar,Snubbull,Qwilfish,Shuckle,Heracross,Teddiursa,Slugma,Swinub,Corsola,Remoraid,Delibird,Skarmory,Houndour,Phanpy,Stantler,Smeargle,Smoochum,Elekid,Magby,Miltank,Poochyena,Zigzagoon,Wurmple,Lotad,Seedot,Taillow,Wingull,Ralts,Surskit,Shroomish,Slakoth,Nincada,Whismur,Makuhita,Nosepass,Skitty,Sableye,Mawile,Aron,Meditite,Electrike,Plusle,Minun,Volbeat,Illumise,Roselia,Gulpin,Carvanha,Wailmer,Numel,Spoink,Cacnea,Swablu,Corphish,Baltoy,Feebas,Castform,Kecleon,Shuppet,Duskull,Tropius,Chimecho,Absol,Wynaut,Snorunt,Spheal,Clamperl,Relicanth,Luvdisc,Bidoof,Kricketot,Shinx,Burmy,Combee,Pachirisu,Buizel,Cherubi,Shellos,Drifloon,Buneary,Glameow,Stunky,Bronzor,Chatot,Spiritomb,Riolu,Hippopotas,Skorupi,Croagunk,Carnivine,Finneon,Mantyke,Snover,Rotom,Patrat,Lillipup,Purrloin,Pansage,Pansear,Panpour,Munna,Pidove,Blitzle,Roggenrola,Woobat,Drilbur,Audino,Timburr,Tympole,Throh,Sawk,Sewaddle,Venipede,Cottonee,Petilil,Basculin,Sandile,Darumaka,Maractus,Dwebble,Scraggy,Sigilyph,Yamask,Trubbish,Minccino,Gothita,Solosis,Ducklett,Vanillite,Deerling,Emolga,Karrablast,Foongus,Frillish,Alomomola,Joltik,Ferroseed,Klink,Tynamo,Elgyem,Litwick,Axew,Cubchoo,Cryogonal,Shelmet,Stunfisk,Mienfoo,Druddigon,Golett,Pawniard,Bouffalant,Rufflet,Vullaby,Heatmor,Durant,Bunnelby,Fletchling,Scatterbug,Litleo,Flabébé,Skiddo,Pancham,Furfrou,Espurr,Honedge,Spritzee,Swirlix,Inkay,Binacle,Skrelp,Clauncher,Helioptile,Hawlucha,Carbink,Phantump,Pumpkaboo,Bergmite,Noibat,Grubbin,Crabrawler,Oricorio,Cutiefly,Rockruff,Wishiwashi,Mareanie,Mudbray,Dewpider,Fomantis,Morelull,Salandit,Stufful,Bounsweet,Comfey,Oranguru,Passimian,Wimpod,Sandygast,Pyukumuku,Togedemaru,Bruxish,Drampa,Dhelmise,Skwovet,Rookidee,Blipbug,Nickit,Gossifleur,Wooloo,Chewtle,Yamper,Rolycoly,Applin,Silicobra,Cramorant,Arrokuda,Toxel,Sizzlipede,Clobbopus,Sinistea,Hatenna,Impidimp,Milcery,Falinks,Pincurchin,Snom,Stonjourner,Eiscue,Indeedee,Morpeko,Cufant,Lechonk,Tarountula,Nymble,Pawmi,Tandemaus,Fidough,Smoliv,Squawkabilly,Nacli,Charcadet,Tadbulb,Wattrel,Maschiff,Shroodle,Bramblin,Toedscool,Klawf,Capsakid,Rellor,Flittle,Tinkatink,Wiglett,Bombirdier,Finizen,Varoom,Cyclizar,Orthworm,Glimmet,Greavard,Flamigo,Cetoddle,Veluza,Dondozo,Tatsugiri`.split(',')
};
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
function impossiblePokemon(rng=Math.random){const category=randomItem(IMPOSSIBLE_CATEGORIES,rng);return {pokemon:randomItem(category.pool,rng),category:category.name,categoryKey:category.key,difficulty:'Casi imposible'}}
function pokemonReward(category,rng=Math.random){
  if(category==='common')return {pokemon:randomItem(POKEMON_POOLS.common,rng),category:'Común',categoryKey:'common',difficulty:'Muy común'};
  if(category==='hard')return {pokemon:randomItem(POKEMON_POOLS.hard,rng),category:'Inicial',categoryKey:'starter',difficulty:'Difícil'};
  if(category==='veryHard')return {pokemon:randomItem(POKEMON_POOLS.veryHard,rng),category:'Pseudolegendario',categoryKey:'pseudo',difficulty:'Muy difícil'};
  if(category==='fossil')return {pokemon:randomItem(POKEMON_POOLS.fossil,rng),category:'Fósil',categoryKey:'fossil',difficulty:'Extremadamente raro'};
  return impossiblePokemon(rng);
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
function createPaidPokemonPrize(){const category=weightedPick(paidCategories);return createPaidPokemonPrizeForCategory(category.key)}
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
function createPaidPokemonPrizeForCategory(key){const p=pokemonReward(key);return {pokemon:p.pokemon,category:p.category,categoryKey:p.categoryKey,difficulty:p.difficulty,label:`${p.pokemon} · ${p.category}`,rewardLabel:`${p.pokemon} — ${p.category} (${p.difficulty})`}}
$('#spinPaidButton').onclick=async()=>{
  if(!state.account||state.account.credits<100){alert('Necesitas 100 créditos.');return}
  $('#spinPaidButton').disabled=true;$('#spinPaidTenButton').disabled=true;
  try{
    const {error}=await supabase.from('accounts').update({credits:state.account.credits-100}).eq('id',state.account.id);
    if(error)throw error;
    pendingPaidReward=await paidSpin();
    $('#paidResult').innerHTML=`Salió: <strong>${esc(pendingPaidReward.pokemon)}</strong><br><span class="pokemon-category category-${esc(pendingPaidReward.categoryKey)}">${esc(pendingPaidReward.category)}</span>`;
    $('#acceptPaidReward').hidden=false;
    await loadAll();
  }catch(error){console.error(error);$('#paidResult').textContent='No se pudo completar el giro.'}
  finally{$('#spinPaidButton').disabled=false;$('#spinPaidTenButton').disabled=false}
};
$('#spinPaidTenButton').onclick=async()=>{
  if(!state.account||state.account.credits<900){alert('Necesitas 900 créditos.');return}
  $('#spinPaidTenButton').disabled=true;
  await supabase.from('accounts').update({credits:state.account.credits-900}).eq('id',state.account.id);
  const rewards=Array.from({length:10},()=>createPaidPokemonPrize());
  await supabase.from('rewards').insert(rewards.map(prize=>({account_id:state.account.id,source:'Ruleta Pokémon x10',label:prize.rewardLabel})));
  $('#paidResult').innerHTML='<strong>10 resultados:</strong><br>'+rewards.map((prize,index)=>`${index+1}. ${esc(prize.rewardLabel)}`).join('<br>');
  pendingPaidReward=null;$('#acceptPaidReward').hidden=true;$('#spinPaidTenButton').disabled=false;await loadAll();
};
$('#acceptPaidReward').onclick=async()=>{
  if(!pendingPaidReward||!state.account)return;
  await supabase.from('rewards').insert({account_id:state.account.id,source:'Ruleta Pokémon',label:pendingPaidReward.rewardLabel||pendingPaidReward.label});
  pendingPaidReward=null;$('#acceptPaidReward').hidden=true;$('#paidResult').textContent='Recompensa añadida.';await loadAll();
};
function renderRewards(){
  const mine=state.account?state.rewards.filter(r=>r.account_id===state.account.id&&r.status!=="claimed"):[];
  $("#myRewards").innerHTML=mine.map(r=>`<div class="card"><strong>${esc(r.label)}</strong><div class="muted">${esc(r.source)} · ${esc(r.status)}</div><div class="reward-actions">${r.status==="available"?`<button data-request-reward="${r.id}">Reclamar</button>`:""}<button class="danger" data-discard-reward="${r.id}">Descartar</button></div></div>`).join("")||'<div class="muted">No hay recompensas.</div>';
  $$("[data-request-reward]").forEach(b=>b.onclick=async()=>{await supabase.from("rewards").update({status:"requested",requested_at:new Date().toISOString()}).eq("id",b.dataset.requestReward);loadAll()});
  $$("[data-discard-reward]").forEach(b=>b.onclick=async()=>{
    if(!confirm("¿Descartar esta recompensa? Esta acción no se puede deshacer."))return;
    await supabase.from("rewards").delete().eq("id",b.dataset.discardReward);
    loadAll();
  });
  const requested=state.rewards.filter(r=>r.status==="requested");
  $("#deliveryList").innerHTML=requested.map(r=>{const a=state.accounts.find(x=>x.id===r.account_id);return`<div class="card"><strong>${esc(a?.username||"Cuenta")}</strong><div>${esc(r.label)}</div><button data-deliver="${r.id}">Confirmar entrega</button></div>`}).join("")||'<div class="muted">Sin solicitudes.</div>';
  $$("[data-deliver]").forEach(b=>b.onclick=async()=>{
    await supabase.from("rewards").delete().eq("id",b.dataset.deliver);
    loadAll();
  });
}
$("#rewardDrawerButton").onclick=()=>$("#rewardDrawer").classList.toggle("open");
$("#deliveryDrawerButton").onclick=()=>$("#deliveryDrawer").classList.toggle("open");

for(const table of ["accounts","tournaments","tournament_participants","matches","bets","rewards","daily_spins","rankings","cashier_transactions"]){
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
