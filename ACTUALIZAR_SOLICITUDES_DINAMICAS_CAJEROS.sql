-- Ejecuta una sola vez en Supabase SQL Editor.
-- Los cajeros solicitan una adición por actividad/dinámica y el administrador la aprueba.

create table if not exists public.cashier_addition_requests (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid not null references public.accounts(id) on delete cascade,
  target_account_id uuid not null references public.accounts(id) on delete cascade,
  description text not null check (length(trim(description)) >= 3),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  approved_credits integer check (approved_credits is null or approved_credits > 0),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.cashier_addition_requests enable row level security;

drop policy if exists "cashier addition requests read" on public.cashier_addition_requests;
create policy "cashier addition requests read"
on public.cashier_addition_requests for select to anon using (true);

drop policy if exists "cashier addition requests admin update" on public.cashier_addition_requests;
create policy "cashier addition requests admin update"
on public.cashier_addition_requests for update to anon using (true) with check (true);

grant select, update on public.cashier_addition_requests to anon;

create or replace function public.cashier_request_credit_addition(
  p_cashier_id uuid,
  p_target_id uuid,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_is_cashier boolean;
begin
  select is_cashier into v_is_cashier from public.accounts where id=p_cashier_id;
  if coalesce(v_is_cashier,false)=false then
    raise exception 'La cuenta no tiene activo el rol de cajero';
  end if;
  if p_cashier_id=p_target_id then
    raise exception 'Un cajero no puede solicitar créditos para sí mismo';
  end if;
  if not exists(select 1 from public.accounts where id=p_target_id) then
    raise exception 'Cuenta de destino inexistente';
  end if;
  if length(trim(coalesce(p_description,'')))<3 then
    raise exception 'Debes describir la actividad o dinámica';
  end if;
  insert into public.cashier_addition_requests(cashier_id,target_account_id,description)
  values(p_cashier_id,p_target_id,trim(p_description)) returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.cashier_request_credit_addition(uuid,uuid,text) to anon;

do $$ begin
  alter publication supabase_realtime add table public.cashier_addition_requests;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
