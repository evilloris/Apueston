-- Ejecuta este archivo UNA sola vez en Supabase SQL Editor.
-- No elimina datos existentes.

create extension if not exists pgcrypto;

create table if not exists public.number_game_settings (
  id boolean primary key default true check (id = true),
  enabled boolean not null default true,
  min_stake integer not null default 50 check (min_stake > 0),
  max_stake integer not null default 1000 check (max_stake >= min_stake),
  max_prize integer not null default 25000 check (max_prize > 0),
  max_rounds integer not null default 3 check (max_rounds between 1 and 10),
  animation_ms integer not null default 3000 check (animation_ms between 0 and 15000),
  multipliers jsonb not null default '{"100":{"5":1.20,"2":1.35,"1":1.55,"0":1.90},"1000":{"5":1.50,"2":2.00,"1":3.00,"0":5.00}}'::jsonb,
  round_options jsonb not null default '{"1":[5,2,1,0],"2":[2,1,0],"3":[0]}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.number_game_settings(id) values (true) on conflict (id) do nothing;

-- Código de administrador usado solamente por la función segura de configuración.
insert into public.app_settings(key,value)
values ('number_game_admin', jsonb_build_object('password_hash', crypt('pktrn1907', gen_salt('bf'))))
on conflict (key) do update set value=excluded.value;

create table if not exists public.number_game_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  status text not null check (status in ('active','lost','cashed')),
  current_round integer not null default 1,
  accumulated integer not null default 0 check (accumulated >= 0),
  range_max integer not null check (range_max in (100,1000)),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create unique index if not exists number_game_one_active_per_account
on public.number_game_sessions(account_id) where status='active';

create table if not exists public.number_game_rounds (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  session_id uuid not null references public.number_game_sessions(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  player_name text not null,
  round_no integer not null,
  range_max integer not null check (range_max in (100,1000)),
  chosen_number integer not null,
  margin integer not null check (margin in (0,1,2,5)),
  result_number integer not null,
  stake integer not null check (stake > 0),
  multiplier numeric(10,4) not null check (multiplier > 0),
  potential_prize integer not null check (potential_prize >= 0),
  won boolean not null,
  prize_collected integer not null default 0 check (prize_collected >= 0),
  created_at timestamptz not null default now()
);

create index if not exists number_game_rounds_recent_idx on public.number_game_rounds(created_at desc);
create index if not exists number_game_sessions_account_idx on public.number_game_sessions(account_id,updated_at desc);

alter table public.number_game_settings enable row level security;
alter table public.number_game_sessions enable row level security;
alter table public.number_game_rounds enable row level security;

drop policy if exists "number game settings read" on public.number_game_settings;
create policy "number game settings read" on public.number_game_settings for select to anon using (true);
drop policy if exists "number game sessions read" on public.number_game_sessions;
create policy "number game sessions read" on public.number_game_sessions for select to anon using (true);
drop policy if exists "number game rounds read" on public.number_game_rounds;
create policy "number game rounds read" on public.number_game_rounds for select to anon using (true);

-- No se crean políticas INSERT/UPDATE/DELETE: las escrituras solo pasan por RPC.
revoke insert, update, delete on public.number_game_settings from anon;
revoke insert, update, delete on public.number_game_sessions from anon;
revoke insert, update, delete on public.number_game_rounds from anon;

grant select on public.number_game_settings, public.number_game_sessions, public.number_game_rounds to anon;

create or replace function public.number_game_margin_label(p_margin integer)
returns text language sql immutable as $$
  select case p_margin when 5 then '±5' when 2 then '±2' when 1 then '±1' else 'Exacto' end
$$;

create or replace function public.number_game_validate_choice(
  p_settings public.number_game_settings,
  p_round integer,
  p_range integer,
  p_number integer,
  p_margin integer
) returns numeric language plpgsql stable as $$
declare v_mult numeric; v_options jsonb;
begin
  if p_range not in (100,1000) then raise exception 'Rango no válido'; end if;
  if p_number < 1 or p_number > p_range then raise exception 'Número fuera del rango'; end if;
  v_options := p_settings.round_options -> p_round::text;
  if v_options is null or not (v_options @> to_jsonb(array[p_margin])) then
    raise exception 'Ese margen no está permitido en esta ronda';
  end if;
  v_mult := (p_settings.multipliers -> p_range::text ->> p_margin::text)::numeric;
  if v_mult is null or v_mult <= 0 then raise exception 'Multiplicador no configurado'; end if;
  return v_mult;
end; $$;

create or replace function public.number_game_start(
  p_account_id uuid,
  p_range integer,
  p_number integer,
  p_margin integer,
  p_stake integer,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  s public.number_game_settings; a public.accounts; sess public.number_game_sessions;
  v_mult numeric; v_result integer; v_win boolean; v_prize integer; v_auto boolean;
begin
  select * into s from public.number_game_settings where id=true;
  if not s.enabled then raise exception 'El minijuego está desactivado'; end if;
  if p_stake < s.min_stake or p_stake > s.max_stake then raise exception 'La apuesta debe estar entre % y %',s.min_stake,s.max_stake; end if;
  if exists(select 1 from public.number_game_sessions where account_id=p_account_id and status='active') then raise exception 'Ya tienes una partida activa'; end if;
  v_mult := public.number_game_validate_choice(s,1,p_range,p_number,p_margin);
  select * into a from public.accounts where id=p_account_id for update;
  if a.id is null then raise exception 'Cuenta inexistente'; end if;
  if a.credits < p_stake then raise exception 'Créditos insuficientes'; end if;
  if exists(select 1 from public.number_game_rounds where request_id=p_request_id) then raise exception 'Esta solicitud ya fue procesada'; end if;
  update public.accounts set credits=credits-p_stake where id=p_account_id;
  v_result := floor(random()*p_range)::integer+1;
  v_win := abs(v_result-p_number)<=p_margin;
  v_prize := case when v_win then least(s.max_prize,floor(p_stake*v_mult)::integer) else 0 end;
  v_auto := v_win and (s.max_rounds<=1 or v_prize>=s.max_prize);
  insert into public.number_game_sessions(account_id,status,current_round,accumulated,range_max,finished_at)
  values(p_account_id,case when not v_win then 'lost' when v_auto then 'cashed' else 'active' end,1,v_prize,p_range,case when not v_win or v_auto then now() end)
  returning * into sess;
  if v_auto then update public.accounts set credits=credits+v_prize where id=p_account_id; end if;
  insert into public.number_game_rounds(request_id,session_id,account_id,player_name,round_no,range_max,chosen_number,margin,result_number,stake,multiplier,potential_prize,won,prize_collected)
  values(p_request_id,sess.id,p_account_id,a.username,1,p_range,p_number,p_margin,v_result,p_stake,v_mult,v_prize,v_win,case when v_auto then v_prize else 0 end);
  return jsonb_build_object('session_id',sess.id,'round',1,'range',p_range,'chosen',p_number,'margin',p_margin,'result',v_result,'won',v_win,'stake',p_stake,'multiplier',v_mult,'prize',v_prize,'status',sess.status,'auto_cashed',v_auto,'balance',(select credits from public.accounts where id=p_account_id));
end; $$;

create or replace function public.number_game_continue(
  p_account_id uuid,
  p_session_id uuid,
  p_number integer,
  p_margin integer,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  s public.number_game_settings; a public.accounts; sess public.number_game_sessions;
  v_round integer; v_mult numeric; v_result integer; v_win boolean; v_prize integer; v_stake integer; v_auto boolean;
begin
  select * into s from public.number_game_settings where id=true;
  if not s.enabled then raise exception 'El minijuego está desactivado'; end if;
  select * into sess from public.number_game_sessions where id=p_session_id and account_id=p_account_id for update;
  if sess.id is null or sess.status<>'active' then raise exception 'La partida ya no está activa'; end if;
  v_round:=sess.current_round+1;
  if v_round>s.max_rounds then raise exception 'Ya alcanzaste el máximo de rondas'; end if;
  v_mult:=public.number_game_validate_choice(s,v_round,sess.range_max,p_number,p_margin);
  if exists(select 1 from public.number_game_rounds where request_id=p_request_id) then raise exception 'Esta solicitud ya fue procesada'; end if;
  select * into a from public.accounts where id=p_account_id;
  v_stake:=sess.accumulated;
  v_result:=floor(random()*sess.range_max)::integer+1;
  v_win:=abs(v_result-p_number)<=p_margin;
  v_prize:=case when v_win then least(s.max_prize,floor(v_stake*v_mult)::integer) else 0 end;
  v_auto:=v_win and (v_round>=s.max_rounds or v_prize>=s.max_prize);
  update public.number_game_sessions set current_round=v_round, accumulated=v_prize,
    status=case when not v_win then 'lost' when v_auto then 'cashed' else 'active' end,
    updated_at=now(), finished_at=case when not v_win or v_auto then now() else null end
  where id=sess.id;
  if v_auto then update public.accounts set credits=credits+v_prize where id=p_account_id; end if;
  insert into public.number_game_rounds(request_id,session_id,account_id,player_name,round_no,range_max,chosen_number,margin,result_number,stake,multiplier,potential_prize,won,prize_collected)
  values(p_request_id,sess.id,p_account_id,a.username,v_round,sess.range_max,p_number,p_margin,v_result,v_stake,v_mult,v_prize,v_win,case when v_auto then v_prize else 0 end);
  return jsonb_build_object('session_id',sess.id,'round',v_round,'range',sess.range_max,'chosen',p_number,'margin',p_margin,'result',v_result,'won',v_win,'stake',v_stake,'multiplier',v_mult,'prize',v_prize,'status',case when not v_win then 'lost' when v_auto then 'cashed' else 'active' end,'auto_cashed',v_auto,'balance',(select credits from public.accounts where id=p_account_id));
end; $$;

create or replace function public.number_game_cashout(p_account_id uuid,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare sess public.number_game_sessions;
begin
  select * into sess from public.number_game_sessions where id=p_session_id and account_id=p_account_id for update;
  if sess.id is null or sess.status<>'active' then raise exception 'La partida ya fue cobrada o finalizada'; end if;
  update public.number_game_sessions set status='cashed',finished_at=now(),updated_at=now() where id=sess.id;
  update public.accounts set credits=credits+sess.accumulated where id=p_account_id;
  update public.number_game_rounds set prize_collected=sess.accumulated
  where id=(select id from public.number_game_rounds where session_id=sess.id order by round_no desc limit 1);
  return jsonb_build_object('prize',sess.accumulated,'balance',(select credits from public.accounts where id=p_account_id));
end; $$;

create or replace function public.number_game_admin_update(p_admin_code text,p_config jsonb)
returns public.number_game_settings language plpgsql security definer set search_path=public as $$
declare h text; outrow public.number_game_settings;
begin
  select value->>'password_hash' into h from public.app_settings where key='number_game_admin';
  if h is null or crypt(p_admin_code,h)<>h then raise exception 'Código de administrador incorrecto'; end if;
  update public.number_game_settings set
    enabled=coalesce((p_config->>'enabled')::boolean,enabled),
    min_stake=coalesce((p_config->>'min_stake')::integer,min_stake),
    max_stake=coalesce((p_config->>'max_stake')::integer,max_stake),
    max_prize=coalesce((p_config->>'max_prize')::integer,max_prize),
    max_rounds=coalesce((p_config->>'max_rounds')::integer,max_rounds),
    animation_ms=coalesce((p_config->>'animation_ms')::integer,animation_ms),
    multipliers=coalesce(p_config->'multipliers',multipliers),
    round_options=coalesce(p_config->'round_options',round_options),updated_at=now()
  where id=true returning * into outrow;
  return outrow;
end; $$;

grant execute on function public.number_game_start(uuid,integer,integer,integer,integer,uuid) to anon;
grant execute on function public.number_game_continue(uuid,uuid,integer,integer,uuid) to anon;
grant execute on function public.number_game_cashout(uuid,uuid) to anon;
grant execute on function public.number_game_admin_update(text,jsonb) to anon;

do $$ begin
  alter publication supabase_realtime add table public.number_game_settings;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.number_game_sessions;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.number_game_rounds;
exception when duplicate_object then null; end $$;

notify pgrst,'reload schema';
