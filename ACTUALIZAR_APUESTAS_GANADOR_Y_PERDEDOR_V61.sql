-- ============================================================
-- LIGA POKÉMON v61 - APUESTAS AL GANADOR Y AL PERDEDOR
-- Ejecutar UNA sola vez en Supabase > SQL Editor.
-- Requiere haber ejecutado antes ACTUALIZAR_TIENDA_Y_APUESTAS_CAMPEON.sql
-- ============================================================

alter table public.tournament_champions
  add column if not exists last_place_participant_id uuid
  references public.tournament_participants(id) on delete set null;

-- Una sola apuesta por cuenta, torneo y mercado.
-- No se crea un índice único para no bloquear la actualización si ya existen
-- apuestas antiguas duplicadas; la función lo valida de forma atómica.
create or replace function public.place_tournament_position_bet(
  p_account_id uuid,
  p_tournament_id uuid,
  p_participant_id uuid,
  p_market text,
  p_stake integer,
  p_odds numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
  v_bet_type text;
  v_bet_id uuid;
begin
  if p_market not in ('champion','last_place') then
    raise exception 'Mercado no válido';
  end if;
  v_bet_type := p_market;

  if p_stake is null or p_stake <= 0 then
    raise exception 'La apuesta debe ser mayor que cero';
  end if;
  if p_odds is null or p_odds < 1.001 then
    raise exception 'Cuota no válida';
  end if;

  if not exists (
    select 1 from public.tournament_participants
    where id = p_participant_id and tournament_id = p_tournament_id
  ) then
    raise exception 'El participante no pertenece al torneo';
  end if;

  if exists (
    select 1
    from public.tournament_participants tp,
         lateral jsonb_array_elements(coalesce(tp.members,'[]'::jsonb)) member
    where tp.id = p_participant_id
      and tp.tournament_id = p_tournament_id
      and member->>'type' = 'account'
      and member->>'id' = p_account_id::text
  ) then
    raise exception 'No puedes apostar por ti mismo';
  end if;

  if p_market = 'champion' and exists (
    select 1 from public.tournament_champions
    where tournament_id = p_tournament_id and participant_id is not null
  ) then
    raise exception 'El ganador del torneo ya fue definido';
  end if;

  if p_market = 'last_place' and exists (
    select 1 from public.tournament_champions
    where tournament_id = p_tournament_id and last_place_participant_id is not null
  ) then
    raise exception 'El perdedor del torneo ya fue definido';
  end if;

  -- Bloquea la cuenta para impedir dos compras simultáneas del mismo mercado.
  select credits into v_credits
  from public.accounts
  where id = p_account_id
  for update;

  if not found then raise exception 'Cuenta no encontrada'; end if;

  if exists (
    select 1 from public.bets
    where account_id = p_account_id
      and tournament_id = p_tournament_id
      and bet_type = v_bet_type
  ) then
    raise exception 'Solo puedes realizar una apuesta de este tipo por torneo';
  end if;

  if v_credits < p_stake then raise exception 'Créditos insuficientes'; end if;

  update public.accounts set credits = credits - p_stake where id = p_account_id;

  insert into public.bets(
    account_id,tournament_id,match_id,bet_type,selection,stake,locked_odds,status
  ) values (
    p_account_id,p_tournament_id,null,v_bet_type,
    jsonb_build_object('participant_id',p_participant_id),
    p_stake,p_odds,'pending'
  ) returning id into v_bet_id;

  return v_bet_id;
end;
$$;

-- Mantiene compatibilidad con el botón antiguo de apuesta al campeón.
create or replace function public.place_champion_bet(
  p_account_id uuid,
  p_tournament_id uuid,
  p_participant_id uuid,
  p_stake integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_odds numeric;
begin
  select odds into v_odds from public.tournament_champion_odds
  where tournament_id=p_tournament_id and participant_id=p_participant_id and active=true;
  if v_odds is null then raise exception 'No hay cuota disponible'; end if;
  return public.place_tournament_position_bet(p_account_id,p_tournament_id,p_participant_id,'champion',p_stake,v_odds);
end;
$$;

create or replace function public.resolve_tournament_champion(
  p_tournament_id uuid,
  p_participant_id uuid,
  p_automatic boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_bet record; v_payout integer;
begin
  if not exists (select 1 from public.tournament_participants where id=p_participant_id and tournament_id=p_tournament_id) then
    raise exception 'El participante no pertenece al torneo';
  end if;

  insert into public.tournament_champions(tournament_id,participant_id,resolved_automatically,resolved_at)
  values(p_tournament_id,p_participant_id,coalesce(p_automatic,false),now())
  on conflict(tournament_id) do update set
    participant_id=excluded.participant_id,
    resolved_automatically=excluded.resolved_automatically,
    resolved_at=now();

  for v_bet in select * from public.bets
    where tournament_id=p_tournament_id and bet_type='champion' and status='pending' for update
  loop
    if v_bet.selection->>'participant_id'=p_participant_id::text then
      v_payout:=floor(v_bet.stake*v_bet.locked_odds);
      update public.accounts set credits=credits+v_payout where id=v_bet.account_id;
      update public.bets set status='won',payout=v_payout where id=v_bet.id;
    else
      update public.bets set status='lost',payout=0 where id=v_bet.id;
    end if;
  end loop;
end;
$$;

create or replace function public.resolve_tournament_last_place(
  p_tournament_id uuid,
  p_participant_id uuid,
  p_automatic boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_bet record; v_payout integer;
begin
  if not exists (select 1 from public.tournament_participants where id=p_participant_id and tournament_id=p_tournament_id) then
    raise exception 'El participante no pertenece al torneo';
  end if;

  insert into public.tournament_champions(tournament_id,participant_id,last_place_participant_id,resolved_automatically,resolved_at)
  values(
    p_tournament_id,
    coalesce((select participant_id from public.tournament_champions where tournament_id=p_tournament_id),p_participant_id),
    p_participant_id,coalesce(p_automatic,false),now()
  )
  on conflict(tournament_id) do update set
    last_place_participant_id=excluded.last_place_participant_id,
    resolved_at=now();

  for v_bet in select * from public.bets
    where tournament_id=p_tournament_id and bet_type='last_place' and status='pending' for update
  loop
    if v_bet.selection->>'participant_id'=p_participant_id::text then
      v_payout:=floor(v_bet.stake*v_bet.locked_odds);
      update public.accounts set credits=credits+v_payout where id=v_bet.account_id;
      update public.bets set status='won',payout=v_payout where id=v_bet.id;
    else
      update public.bets set status='lost',payout=0 where id=v_bet.id;
    end if;
  end loop;
end;
$$;

grant execute on function public.place_tournament_position_bet(uuid,uuid,uuid,text,integer,numeric) to anon;
grant execute on function public.resolve_tournament_last_place(uuid,uuid,boolean) to anon;
grant execute on function public.resolve_tournament_champion(uuid,uuid,boolean) to anon;

-- Fin.
