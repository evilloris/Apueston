-- ============================================================
-- LIGA POKÉMON - TIENDA + APUESTAS AL CAMPEÓN
-- Ejecutar UNA sola vez en Supabase > SQL Editor.
-- No elimina datos existentes.
-- ============================================================

create extension if not exists pgcrypto;

-- 1) Catálogo editable desde la página.
create table if not exists public.store_items (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  item_id text not null,
  price integer not null check (price > 0),
  default_quantity integer not null default 1 check (default_quantity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists store_items_item_id_unique
  on public.store_items (lower(item_id));

-- 2) Compras realizadas por los jugadores.
create table if not exists public.store_purchases (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_item_id uuid references public.store_items(id) on delete set null,
  item_name text not null,
  item_id text not null,
  quantity integer not null check (quantity > 0),
  unit_price integer not null check (unit_price > 0),
  total_price integer not null check (total_price > 0),
  status text not null default 'pending' check (status in ('pending','delivered','cancelled')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  delivered_by uuid references public.accounts(id) on delete set null
);

create index if not exists store_purchases_account_idx
  on public.store_purchases(account_id, created_at desc);
create index if not exists store_purchases_status_idx
  on public.store_purchases(status, created_at desc);

-- 3) Campeón oficial por torneo.
create table if not exists public.tournament_champions (
  tournament_id uuid primary key references public.tournaments(id) on delete cascade,
  participant_id uuid not null references public.tournament_participants(id) on delete cascade,
  resolved_automatically boolean not null default false,
  resolved_at timestamptz not null default now()
);

-- 4) Cuotas de campeón configurables por participante.
create table if not exists public.tournament_champion_odds (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  participant_id uuid not null references public.tournament_participants(id) on delete cascade,
  odds numeric(10,4) not null check (odds >= 1.001),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (tournament_id, participant_id)
);

-- updated_at genérico.
create or replace function public.store_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists store_items_touch on public.store_items;
create trigger store_items_touch
before update on public.store_items
for each row execute function public.store_touch_updated_at();

drop trigger if exists champion_odds_touch on public.tournament_champion_odds;
create trigger champion_odds_touch
before update on public.tournament_champion_odds
for each row execute function public.store_touch_updated_at();

-- 5) Compra atómica: descuenta créditos y registra la compra.
create or replace function public.store_buy_item(
  p_account_id uuid,
  p_store_item_id uuid,
  p_quantity integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.store_items%rowtype;
  v_credits integer;
  v_total integer;
  v_purchase_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;

  select * into v_item
  from public.store_items
  where id = p_store_item_id and active = true
  for update;

  if not found then
    raise exception 'El objeto no existe o está desactivado';
  end if;

  v_total := v_item.price * p_quantity;

  select credits into v_credits
  from public.accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'Cuenta no encontrada';
  end if;

  if v_credits < v_total then
    raise exception 'Créditos insuficientes';
  end if;

  update public.accounts
  set credits = credits - v_total
  where id = p_account_id;

  insert into public.store_purchases(
    account_id, store_item_id, item_name, item_id,
    quantity, unit_price, total_price
  ) values (
    p_account_id, v_item.id, v_item.display_name, v_item.item_id,
    p_quantity, v_item.price, v_total
  ) returning id into v_purchase_id;

  return v_purchase_id;
end;
$$;

-- 6) Marcar compra como entregada.
create or replace function public.store_mark_delivered(
  p_purchase_id uuid,
  p_admin_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.accounts
    where id = p_admin_id and lower(username::text) = 'admin'
  ) then
    raise exception 'Solo el administrador puede entregar compras';
  end if;

  update public.store_purchases
  set status = 'delivered', delivered_at = now(), delivered_by = p_admin_id
  where id = p_purchase_id and status = 'pending';

  if not found then
    raise exception 'La compra no existe o ya fue procesada';
  end if;
end;
$$;

-- 7) Apostar al ganador del torneo.
-- Reutiliza public.bets con bet_type = 'champion'.
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
  v_credits integer;
  v_odds numeric(10,4);
  v_bet_id uuid;
begin
  if p_stake is null or p_stake <= 0 then
    raise exception 'La apuesta debe ser mayor que cero';
  end if;

  if exists (select 1 from public.tournament_champions where tournament_id = p_tournament_id) then
    raise exception 'Este torneo ya tiene campeón';
  end if;

  if not exists (
    select 1 from public.tournament_participants
    where id = p_participant_id and tournament_id = p_tournament_id
  ) then
    raise exception 'El participante no pertenece al torneo';
  end if;

  select odds into v_odds
  from public.tournament_champion_odds
  where tournament_id = p_tournament_id
    and participant_id = p_participant_id
    and active = true;

  if v_odds is null then
    raise exception 'No hay cuota disponible para este participante';
  end if;

  select credits into v_credits
  from public.accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'Cuenta no encontrada';
  end if;

  if v_credits < p_stake then
    raise exception 'Créditos insuficientes';
  end if;

  update public.accounts
  set credits = credits - p_stake
  where id = p_account_id;

  insert into public.bets(
    account_id, tournament_id, match_id, bet_type,
    selection, stake, locked_odds, status
  ) values (
    p_account_id, p_tournament_id, null, 'champion',
    jsonb_build_object('participant_id', p_participant_id),
    p_stake, v_odds, 'pending'
  ) returning id into v_bet_id;

  return v_bet_id;
end;
$$;

-- 8) Resolver campeón y pagar apuestas pendientes.
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
declare
  v_bet record;
  v_payout integer;
begin
  if not exists (
    select 1 from public.tournament_participants
    where id = p_participant_id and tournament_id = p_tournament_id
  ) then
    raise exception 'El participante no pertenece al torneo';
  end if;

  insert into public.tournament_champions(
    tournament_id, participant_id, resolved_automatically, resolved_at
  ) values (
    p_tournament_id, p_participant_id, coalesce(p_automatic,false), now()
  )
  on conflict (tournament_id) do update set
    participant_id = excluded.participant_id,
    resolved_automatically = excluded.resolved_automatically,
    resolved_at = now();

  for v_bet in
    select * from public.bets
    where tournament_id = p_tournament_id
      and bet_type = 'champion'
      and status = 'pending'
    for update
  loop
    if v_bet.selection->>'participant_id' = p_participant_id::text then
      v_payout := floor(v_bet.stake * v_bet.locked_odds);
      update public.accounts
      set credits = credits + v_payout
      where id = v_bet.account_id;

      update public.bets
      set status = 'won', payout = v_payout
      where id = v_bet.id;
    else
      update public.bets
      set status = 'lost', payout = 0
      where id = v_bet.id;
    end if;
  end loop;
end;
$$;

-- 9) RLS y permisos (compatibles con la aplicación actual que usa la clave anon).
alter table public.store_items enable row level security;
alter table public.store_purchases enable row level security;
alter table public.tournament_champions enable row level security;
alter table public.tournament_champion_odds enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'store_items',
    'store_purchases',
    'tournament_champions',
    'tournament_champion_odds'
  ]
  loop
    execute format('drop policy if exists "public read %1$s" on public.%1$I', t);
    execute format('drop policy if exists "public insert %1$s" on public.%1$I', t);
    execute format('drop policy if exists "public update %1$s" on public.%1$I', t);
    execute format('drop policy if exists "public delete %1$s" on public.%1$I', t);

    execute format('create policy "public read %1$s" on public.%1$I for select to anon using (true)', t);
    execute format('create policy "public insert %1$s" on public.%1$I for insert to anon with check (true)', t);
    execute format('create policy "public update %1$s" on public.%1$I for update to anon using (true) with check (true)', t);
    execute format('create policy "public delete %1$s" on public.%1$I for delete to anon using (true)', t);
  end loop;
end;
$$;

grant select, insert, update, delete on public.store_items to anon;
grant select, insert, update, delete on public.store_purchases to anon;
grant select, insert, update, delete on public.tournament_champions to anon;
grant select, insert, update, delete on public.tournament_champion_odds to anon;

grant execute on function public.store_buy_item(uuid,uuid,integer) to anon;
grant execute on function public.store_mark_delivered(uuid,uuid) to anon;
grant execute on function public.place_champion_bet(uuid,uuid,uuid,integer) to anon;
grant execute on function public.resolve_tournament_champion(uuid,uuid,boolean) to anon;

-- Fin.
