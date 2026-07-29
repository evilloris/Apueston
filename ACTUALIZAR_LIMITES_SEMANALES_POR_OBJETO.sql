-- LIGA POKÉMON - LÍMITE SEMANAL INDIVIDUAL POR OBJETO
-- Ejecutar una vez en Supabase > SQL Editor.
-- 0 significa que el objeto no tiene límite semanal.

alter table public.store_items
  add column if not exists weekly_limit integer not null default 0
  check (weekly_limit >= 0);

-- Reemplaza la compra para validar el límite dentro de la base de datos.
-- La semana se calcula de lunes 00:00 a lunes 00:00 en horario de Bolivia.
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
  v_weekly_used integer;
  v_week_start timestamptz;
  v_week_end timestamptz;
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

  if v_item.weekly_limit > 0 then
    v_week_start := date_trunc('week', now() at time zone 'America/La_Paz') at time zone 'America/La_Paz';
    v_week_end := v_week_start + interval '7 days';

    select coalesce(sum(quantity), 0)::integer into v_weekly_used
    from public.store_purchases
    where account_id = p_account_id
      and store_item_id = p_store_item_id
      and status <> 'cancelled'
      and created_at >= v_week_start
      and created_at < v_week_end;

    if v_weekly_used + p_quantity > v_item.weekly_limit then
      raise exception 'Límite semanal superado para %. Ya compraste % de % y solo puedes comprar % más',
        v_item.display_name,
        v_weekly_used,
        v_item.weekly_limit,
        greatest(0, v_item.weekly_limit - v_weekly_used);
    end if;
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
