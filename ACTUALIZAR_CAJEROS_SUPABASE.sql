-- EJECUTA ESTE ARCHIVO UNA SOLA VEZ EN SUPABASE SQL EDITOR.
-- No elimina cuentas, torneos, apuestas ni datos existentes.

alter table public.accounts
add column if not exists is_cashier boolean not null default false;

create table if not exists public.cashier_transactions (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid references public.accounts(id) on delete set null,
  target_account_id uuid not null references public.accounts(id) on delete cascade,
  operation text not null check (operation in ('recharge','withdrawal')),
  credits integer not null check (credits > 0),
  operated_by_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists cashier_transactions_cashier_idx
  on public.cashier_transactions(cashier_id, created_at desc);

create or replace function public.cashier_change_credits(
  p_cashier_id uuid,
  p_target_id uuid,
  p_operation text,
  p_credits integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_cashier boolean;
  v_target_credits integer;
  v_common_pool_credits numeric;
begin
  if p_credits is null or p_credits <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;

  if p_operation not in ('recharge','withdrawal') then
    raise exception 'Operación no válida';
  end if;

  select is_cashier into v_is_cashier
  from public.accounts
  where id = p_cashier_id;

  if coalesce(v_is_cashier,false) = false then
    raise exception 'La cuenta no tiene activo el rol de cajero';
  end if;

  if p_cashier_id = p_target_id then
    raise exception 'Un cajero no puede modificar sus propios créditos';
  end if;

  select credits into v_target_credits
  from public.accounts
  where id = p_target_id
  for update;

  if v_target_credits is null then
    raise exception 'Cuenta de destino inexistente';
  end if;

  if p_operation = 'recharge' then
    update public.accounts
    set credits = credits + p_credits
    where id = p_target_id;
  else
    if v_target_credits < p_credits then
      raise exception 'La cuenta no tiene suficientes créditos para retirar';
    end if;

    select coalesce(sum(
      case
        when operation = 'recharge' then credits * 0.70
        when operation = 'withdrawal' then -credits
      end
    ),0)
    into v_common_pool_credits
    from public.cashier_transactions
    where operated_by_admin = false;

    if v_common_pool_credits < p_credits then
      raise exception 'El fondo común de cajeros no alcanza para cubrir este retiro';
    end if;

    update public.accounts
    set credits = credits - p_credits
    where id = p_target_id;
  end if;

  insert into public.cashier_transactions(
    cashier_id,target_account_id,operation,credits,operated_by_admin
  ) values (
    p_cashier_id,p_target_id,p_operation,p_credits,false
  );
end;
$$;

grant execute on function public.cashier_change_credits(uuid,uuid,text,integer) to anon;

alter table public.cashier_transactions enable row level security;

drop policy if exists "public read cashier_transactions" on public.cashier_transactions;
drop policy if exists "public insert cashier_transactions" on public.cashier_transactions;
drop policy if exists "public update cashier_transactions" on public.cashier_transactions;
drop policy if exists "public delete cashier_transactions" on public.cashier_transactions;

create policy "public read cashier_transactions"
on public.cashier_transactions for select to anon using (true);

create policy "public insert cashier_transactions"
on public.cashier_transactions for insert to anon with check (true);

create policy "public update cashier_transactions"
on public.cashier_transactions for update to anon using (true) with check (true);

create policy "public delete cashier_transactions"
on public.cashier_transactions for delete to anon using (true);

begin
  alter publication supabase_realtime add table public.cashier_transactions;
exception
  when duplicate_object then null;
end;

notify pgrst, 'reload schema';
