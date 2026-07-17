-- ============================================================
-- LIGA POKÉMON / CASA DE APUESTAS - INSTALACIÓN DESDE CERO
-- Ejecuta TODO este archivo una sola vez en Supabase SQL Editor.
-- ADVERTENCIA: elimina las tablas anteriores de esta aplicación.
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

drop table if exists public.daily_spins cascade;
drop table if exists public.rewards cascade;
drop table if exists public.bets cascade;
drop table if exists public.matches cascade;
drop table if exists public.tournament_participants cascade;
drop table if exists public.tournaments cascade;
drop table if exists public.rankings cascade;
drop table if exists public.accounts cascade;
drop table if exists public.app_settings cascade;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  username citext not null unique,
  password_hash text not null,
  credits integer not null default 1000 check (credits >= 0),
  visible boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  format text not null check (format in ('1v1','2v2','1v1-double')),
  status text not null default 'draft' check (status in ('draft','active','finished')),
  config jsonb not null default '{"groups":2,"qualify_per_group":2,"third_place":true,"repechage":false}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.tournament_participants (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  display_name text not null,
  kind text not null check (kind in ('account','bot','team')),
  members jsonb not null default '[]'::jsonb,
  group_no integer not null default 1 check (group_no >= 1),
  seed_elo integer not null default 1000,
  unique (tournament_id, display_name)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  phase text not null check (phase in ('group','repechage','quarterfinal','semifinal','final','third_place')),
  round_no integer not null default 1,
  group_no integer,
  side_a uuid references public.tournament_participants(id) on delete set null,
  side_b uuid references public.tournament_participants(id) on delete set null,
  score_a integer,
  score_b integer,
  status text not null default 'scheduled' check (status in ('scheduled','live','finished','walkover')),
  scheduled_at timestamptz,
  winner_id uuid references public.tournament_participants(id) on delete set null,
  base_odds jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.bets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  tournament_id uuid references public.tournaments(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  bet_type text not null check (bet_type in ('winner','handicap','score','parlay','champion')),
  selection jsonb not null,
  stake integer not null check (stake > 0),
  locked_odds numeric(10,4) not null check (locked_odds > 1),
  status text not null default 'pending' check (status in ('pending','won','lost','refunded')),
  payout integer,
  created_at timestamptz not null default now()
);

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  source text not null,
  label text not null,
  status text not null default 'available' check (status in ('available','requested','claimed')),
  created_at timestamptz not null default now(),
  requested_at timestamptz,
  claimed_at timestamptz
);

create table public.daily_spins (
  account_id uuid not null references public.accounts(id) on delete cascade,
  spin_date date not null,
  reward_label text not null,
  created_at timestamptz not null default now(),
  primary key (account_id, spin_date)
);

create table public.rankings (
  name citext primary key,
  elo integer not null default 1000,
  wins integer not null default 0,
  losses integer not null default 0,
  kos_for integer not null default 0,
  kos_against integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Trigger para mantener updated_at.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger rankings_touch before update on public.rankings
for each row execute function public.touch_updated_at();

create trigger settings_touch before update on public.app_settings
for each row execute function public.touch_updated_at();

-- RLS.
alter table public.accounts enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_participants enable row level security;
alter table public.matches enable row level security;
alter table public.bets enable row level security;
alter table public.rewards enable row level security;
alter table public.daily_spins enable row level security;
alter table public.rankings enable row level security;
alter table public.app_settings enable row level security;

-- Liga privada sin Supabase Auth:
-- permite operar con la publishable key desde GitHub Pages.
-- No uses este esquema para dinero real.
do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts','tournaments','tournament_participants','matches',
    'bets','rewards','daily_spins','rankings','app_settings'
  ]
  loop
    execute format('create policy "public read %1$s" on public.%1$I for select to anon using (true)', t);
    execute format('create policy "public insert %1$s" on public.%1$I for insert to anon with check (true)', t);
    execute format('create policy "public update %1$s" on public.%1$I for update to anon using (true) with check (true)', t);
    execute format('create policy "public delete %1$s" on public.%1$I for delete to anon using (true)', t);
  end loop;
end $$;

-- Activar Realtime.
do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts','tournaments','tournament_participants','matches',
    'bets','rewards','daily_spins','rankings','app_settings'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
    end;
  end loop;
end $$;

insert into public.app_settings(key, value)
values ('site', '{"title":"Liga Pokémon · Poképachanga"}'::jsonb)
on conflict (key) do nothing;
