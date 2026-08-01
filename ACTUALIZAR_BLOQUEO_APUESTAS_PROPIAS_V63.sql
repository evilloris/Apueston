-- v63: impedir apuestas al campeón o último lugar por uno mismo.
-- Ejecutar una sola vez en Supabase SQL Editor.

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
    raise exception 'El último lugar del torneo ya fue definido';
  end if;

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

grant execute on function public.place_tournament_position_bet(uuid,uuid,uuid,text,integer,numeric) to anon;
notify pgrst, 'reload schema';
