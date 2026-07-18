-- ============================================================
-- CAMPO MINADO · Migración segura para Supabase
-- No elimina cuentas, torneos, apuestas ni otros minijuegos.
-- ============================================================

create table if not exists public.mine_game_settings (
  id boolean primary key default true check (id = true),
  enabled boolean not null default true,
  min_stake integer not null default 50 check (min_stake > 0),
  max_stake integer not null default 1000 check (max_stake >= min_stake),
  max_prize integer not null default 25000 check (max_prize > 0),
  updated_at timestamptz not null default now()
);

insert into public.mine_game_settings(id)
values (true)
on conflict (id) do nothing;

-- Solo crea el código si aún no existe. No reemplaza el que ya usa la página.
insert into public.app_settings(key,value)
values ('number_game_admin','{"admin_code":"pktrn1907"}'::jsonb)
on conflict (key) do nothing;

create table if not exists public.mine_game_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  status text not null default 'active' check (status in ('active','lost','cashed')),
  level integer not null default 1 check (level between 1 and 7),
  safe_picks integer not null default 0 check (safe_picks between 0 and 3),
  level_complete boolean not null default false,
  accumulated numeric(18,4) not null check (accumulated >= 0),
  initial_stake integer not null check (initial_stake > 0),
  mine_cells integer[] not null default '{}',
  revealed_cells integer[] not null default '{}',
  safe_cells integer[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create unique index if not exists mine_game_one_active_per_account
on public.mine_game_sessions(account_id)
where status = 'active';

create table if not exists public.mine_game_actions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  session_id uuid not null references public.mine_game_sessions(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  level integer not null,
  cell integer not null check (cell between 0 and 35),
  hit_mine boolean not null,
  multiplier numeric(6,2) not null default 1,
  prize_after numeric(18,4) not null default 0,
  created_at timestamptz not null default now()
);

alter table public.mine_game_settings enable row level security;
alter table public.mine_game_sessions enable row level security;
alter table public.mine_game_actions enable row level security;

drop policy if exists "mine game settings read" on public.mine_game_settings;
create policy "mine game settings read"
on public.mine_game_settings for select to anon using (true);

-- Las minas nunca se exponen mediante SELECT. El estado seguro se obtiene por RPC.
revoke all on public.mine_game_sessions from anon;
revoke all on public.mine_game_actions from anon;
grant select on public.mine_game_settings to anon;

create or replace function public.mine_game_make_board(p_level integer)
returns integer[]
language plpgsql
volatile
as $$
declare
  v_count integer := least(35,greatest(5,p_level*5));
  v_cells integer[];
begin
  select coalesce(array_agg(x order by x),'{}'::integer[])
  into v_cells
  from (
    select x
    from generate_series(0,35) x
    order by random()
    limit v_count
  ) q;
  return v_cells;
end;
$$;

create or replace function public.mine_game_safe_state(p_session public.mine_game_sessions)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id',p_session.id,
    'account_id',p_session.account_id,
    'status',p_session.status,
    'level',p_session.level,
    'safe_picks',p_session.safe_picks,
    'level_complete',p_session.level_complete,
    'accumulated',floor(p_session.accumulated)::integer,
    'initial_stake',p_session.initial_stake,
    'revealed_cells',to_jsonb(p_session.revealed_cells),
    'safe_cells',to_jsonb(p_session.safe_cells),
    'updated_at',p_session.updated_at
  )
$$;

create or replace function public.mine_game_get_state(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.mine_game_sessions;
begin
  select * into v_session
  from public.mine_game_sessions
  where account_id=p_account_id and status='active'
  order by created_at desc
  limit 1;

  if v_session.id is null then return null; end if;
  return public.mine_game_safe_state(v_session);
end;
$$;

create or replace function public.mine_game_start(
  p_account_id uuid,
  p_stake integer,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.mine_game_settings;
  v_account public.accounts;
  v_session public.mine_game_sessions;
begin
  select * into v_cfg from public.mine_game_settings where id=true;
  if not v_cfg.enabled then raise exception 'El minijuego está desactivado'; end if;
  if p_stake < v_cfg.min_stake or p_stake > v_cfg.max_stake then
    raise exception 'La apuesta debe estar entre % y %',v_cfg.min_stake,v_cfg.max_stake;
  end if;
  if exists(select 1 from public.mine_game_sessions where account_id=p_account_id and status='active') then
    raise exception 'Ya tienes una partida activa';
  end if;
  if exists(select 1 from public.mine_game_actions where request_id=p_request_id) then
    raise exception 'Esta solicitud ya fue procesada';
  end if;

  select * into v_account from public.accounts where id=p_account_id for update;
  if v_account.id is null then raise exception 'Cuenta inexistente'; end if;
  if v_account.credits < p_stake then raise exception 'Créditos insuficientes'; end if;

  update public.accounts set credits=credits-p_stake where id=p_account_id;

  insert into public.mine_game_sessions(
    account_id,status,level,safe_picks,level_complete,accumulated,initial_stake,mine_cells
  ) values (
    p_account_id,'active',1,0,false,p_stake,p_stake,public.mine_game_make_board(1)
  ) returning * into v_session;

  return public.mine_game_safe_state(v_session);
end;
$$;

create or replace function public.mine_game_reveal(
  p_account_id uuid,
  p_session_id uuid,
  p_cell integer,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.mine_game_settings;
  v_session public.mine_game_sessions;
  v_hit boolean;
  v_mult numeric(6,2) := 1;
  v_prize numeric(18,4);
  v_safe integer;
  v_required integer;
  v_complete boolean;
  v_auto boolean := false;
  v_state jsonb;
begin
  if p_cell < 0 or p_cell > 35 then raise exception 'Casilla no válida'; end if;
  if exists(select 1 from public.mine_game_actions where request_id=p_request_id) then
    raise exception 'Esta solicitud ya fue procesada';
  end if;

  select * into v_cfg from public.mine_game_settings where id=true;
  if not v_cfg.enabled then raise exception 'El minijuego está desactivado'; end if;

  select * into v_session
  from public.mine_game_sessions
  where id=p_session_id and account_id=p_account_id
  for update;

  if v_session.id is null or v_session.status<>'active' then raise exception 'La partida ya no está activa'; end if;
  if v_session.level_complete then raise exception 'Debes cobrar o continuar al siguiente nivel'; end if;
  if p_cell = any(v_session.revealed_cells) then raise exception 'Esa casilla ya fue descubierta'; end if;

  v_hit := p_cell = any(v_session.mine_cells);

  if v_hit then
    update public.mine_game_sessions
    set status='lost',revealed_cells=array_append(revealed_cells,p_cell),accumulated=0,
        updated_at=now(),finished_at=now()
    where id=v_session.id returning * into v_session;

    insert into public.mine_game_actions(request_id,session_id,account_id,level,cell,hit_mine,multiplier,prize_after)
    values(p_request_id,v_session.id,p_account_id,v_session.level,p_cell,true,1,0);

    return jsonb_build_object(
      'hit_mine',true,'hit_mine_cell',p_cell,'multiplier',1,'prize',0,
      'auto_cashed',false,'state',public.mine_game_safe_state(v_session)
    );
  end if;

  v_safe := v_session.safe_picks+1;
  -- Con 35 minas solo existe una casilla segura; el nivel 7 se completa con esa única casilla.
  v_required := least(3,36-cardinality(v_session.mine_cells));
  v_complete := v_safe >= v_required;

  if v_session.level <= 6 then
    v_mult := (105 + floor(random()*6))::numeric / 100;
  elsif v_complete then
    v_mult := 2.00;
  else
    v_mult := 1.00;
  end if;

  v_prize := least(v_cfg.max_prize::numeric,v_session.accumulated*v_mult);
  v_auto := v_complete and v_session.level=7;

  update public.mine_game_sessions
  set safe_picks=v_safe,
      level_complete=v_complete,
      accumulated=v_prize,
      revealed_cells=array_append(revealed_cells,p_cell),
      safe_cells=array_append(safe_cells,p_cell),
      status=case when v_auto then 'cashed' else 'active' end,
      updated_at=now(),
      finished_at=case when v_auto then now() else null end
  where id=v_session.id returning * into v_session;

  if v_auto then
    update public.accounts
    set credits=credits+floor(v_prize)::integer
    where id=p_account_id;
  end if;

  insert into public.mine_game_actions(request_id,session_id,account_id,level,cell,hit_mine,multiplier,prize_after)
  values(p_request_id,v_session.id,p_account_id,v_session.level,p_cell,false,v_mult,v_prize);

  v_state := public.mine_game_safe_state(v_session);
  return jsonb_build_object(
    'hit_mine',false,'hit_mine_cell',null,'multiplier',v_mult,
    'prize',floor(v_prize)::integer,'level_complete',v_complete,
    'auto_cashed',v_auto,'state',v_state
  );
end;
$$;

create or replace function public.mine_game_continue(
  p_account_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.mine_game_sessions;
  v_next integer;
begin
  select * into v_session
  from public.mine_game_sessions
  where id=p_session_id and account_id=p_account_id
  for update;

  if v_session.id is null or v_session.status<>'active' then raise exception 'La partida ya no está activa'; end if;
  if not v_session.level_complete then raise exception 'Todavía no completaste este nivel'; end if;
  if v_session.level>=7 then raise exception 'La partida ya terminó'; end if;

  v_next:=v_session.level+1;
  update public.mine_game_sessions
  set level=v_next,safe_picks=0,level_complete=false,
      mine_cells=public.mine_game_make_board(v_next),revealed_cells='{}',safe_cells='{}',updated_at=now()
  where id=v_session.id returning * into v_session;

  return public.mine_game_safe_state(v_session);
end;
$$;

create or replace function public.mine_game_cashout(
  p_account_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.mine_game_sessions;
  v_payout integer;
begin
  select * into v_session
  from public.mine_game_sessions
  where id=p_session_id and account_id=p_account_id
  for update;

  if v_session.id is null or v_session.status<>'active' then raise exception 'La partida ya fue finalizada'; end if;
  if not v_session.level_complete then raise exception 'Solo puedes cobrar después de completar el nivel'; end if;

  v_payout:=floor(v_session.accumulated)::integer;
  update public.mine_game_sessions set status='cashed',updated_at=now(),finished_at=now() where id=v_session.id;
  update public.accounts set credits=credits+v_payout where id=p_account_id;

  return jsonb_build_object('prize',v_payout,'balance',(select credits from public.accounts where id=p_account_id));
end;
$$;

create or replace function public.mine_game_admin_update(
  p_admin_code text,
  p_config jsonb
)
returns public.mine_game_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result public.mine_game_settings;
  v_min integer;
  v_max integer;
  v_prize integer;
begin
  select value->>'admin_code' into v_code
  from public.app_settings where key='number_game_admin';
  if v_code is null or p_admin_code is distinct from v_code then
    raise exception 'Código de administrador incorrecto';
  end if;

  select
    coalesce((p_config->>'min_stake')::integer,min_stake),
    coalesce((p_config->>'max_stake')::integer,max_stake),
    coalesce((p_config->>'max_prize')::integer,max_prize)
  into v_min,v_max,v_prize
  from public.mine_game_settings where id=true;

  if v_min<=0 then raise exception 'La apuesta mínima debe ser mayor que cero'; end if;
  if v_max<v_min then raise exception 'La apuesta máxima no puede ser menor que la mínima'; end if;
  if v_prize<=0 then raise exception 'El premio máximo debe ser mayor que cero'; end if;

  update public.mine_game_settings
  set enabled=coalesce((p_config->>'enabled')::boolean,enabled),
      min_stake=v_min,max_stake=v_max,max_prize=v_prize,updated_at=now()
  where id=true returning * into v_result;
  return v_result;
end;
$$;

grant execute on function public.mine_game_get_state(uuid) to anon;
grant execute on function public.mine_game_start(uuid,integer,uuid) to anon;
grant execute on function public.mine_game_reveal(uuid,uuid,integer,uuid) to anon;
grant execute on function public.mine_game_continue(uuid,uuid) to anon;
grant execute on function public.mine_game_cashout(uuid,uuid) to anon;
grant execute on function public.mine_game_admin_update(text,jsonb) to anon;

do $$ begin
  alter publication supabase_realtime add table public.mine_game_settings;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.mine_game_sessions;
exception when duplicate_object then null; end $$;

notify pgrst,'reload schema';
