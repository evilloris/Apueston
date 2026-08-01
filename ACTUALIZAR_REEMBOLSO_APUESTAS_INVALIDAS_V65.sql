-- ============================================================
-- LIGA POKÉMON v65 - REEMBOLSO DE APUESTAS INVÁLIDAS
-- Ejecutar UNA sola vez en Supabase > SQL Editor.
-- ============================================================

-- Reembolsa únicamente apuestas pendientes que ya no tengan una
-- selección o enfrentamiento válido. Puede limitarse a un torneo.
create or replace function public.refund_invalid_bets(
  p_tournament_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bet record;
  v_invalid boolean;
  v_count integer := 0;
begin
  for v_bet in
    select b.*
    from public.bets b
    where b.status = 'pending'
      and (p_tournament_id is null or b.tournament_id = p_tournament_id
           or (b.bet_type = 'parlay' and exists (
             select 1
             from jsonb_array_elements(coalesce(b.selection->'legs','[]'::jsonb)) leg
             join public.matches m on m.id = nullif(leg->>'match_id','')::uuid
             where m.tournament_id = p_tournament_id
           )))
    for update of b skip locked
  loop
    v_invalid := false;

    if v_bet.bet_type in ('champion','last_place') then
      v_invalid := not exists (
        select 1
        from public.tournament_participants tp
        where tp.id = nullif(v_bet.selection->>'participant_id','')::uuid
          and tp.tournament_id = v_bet.tournament_id
      );

    elsif v_bet.bet_type = 'parlay' then
      v_invalid := not exists (
        select 1 from jsonb_array_elements(coalesce(v_bet.selection->'legs','[]'::jsonb))
      ) or exists (
        select 1
        from jsonb_array_elements(coalesce(v_bet.selection->'legs','[]'::jsonb)) leg
        left join public.matches m on m.id = nullif(leg->>'match_id','')::uuid
        left join public.tournament_participants pa on pa.id = m.side_a
        left join public.tournament_participants pb on pb.id = m.side_b
        where m.id is null or pa.id is null or pb.id is null
      );

    else
      v_invalid := v_bet.match_id is null or not exists (
        select 1
        from public.matches m
        join public.tournament_participants pa on pa.id = m.side_a
        join public.tournament_participants pb on pb.id = m.side_b
        where m.id = v_bet.match_id
      );

      if not v_invalid and v_bet.bet_type in ('winner','handicap') then
        v_invalid := not exists (
          select 1
          from public.matches m
          where m.id = v_bet.match_id
            and nullif(v_bet.selection->>'participant_id','')::uuid in (m.side_a,m.side_b)
        );
      end if;
    end if;

    if v_invalid then
      update public.accounts
      set credits = credits + v_bet.stake
      where id = v_bet.account_id;

      update public.bets
      set status = 'refunded', payout = v_bet.stake
      where id = v_bet.id;

      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- Antes de reemplazar participantes o regenerar el fixture, reembolsa
-- todas las apuestas pendientes que dependan de la estructura actual.
create or replace function public.refund_tournament_bets_for_structure_change(
  p_tournament_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bet record;
  v_count integer := 0;
begin
  for v_bet in
    select b.*
    from public.bets b
    where b.status = 'pending'
      and (
        b.tournament_id = p_tournament_id
        or (
          b.bet_type = 'parlay'
          and exists (
            select 1
            from jsonb_array_elements(coalesce(b.selection->'legs','[]'::jsonb)) leg
            join public.matches m on m.id = nullif(leg->>'match_id','')::uuid
            where m.tournament_id = p_tournament_id
          )
        )
      )
    for update of b skip locked
  loop
    update public.accounts
    set credits = credits + v_bet.stake
    where id = v_bet.account_id;

    update public.bets
    set status = 'refunded', payout = v_bet.stake
    where id = v_bet.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.refund_invalid_bets(uuid) to anon;
grant execute on function public.refund_tournament_bets_for_structure_change(uuid) to anon;

notify pgrst, 'reload schema';
