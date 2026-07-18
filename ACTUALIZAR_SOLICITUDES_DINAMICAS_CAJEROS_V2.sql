-- Ejecuta una sola vez en Supabase SQL Editor.
-- Añade la cantidad solicitada por el cajero y actualiza la función de envío.

alter table public.cashier_addition_requests
  add column if not exists requested_credits integer;

update public.cashier_addition_requests
set requested_credits = coalesce(requested_credits, approved_credits, 100)
where requested_credits is null;

alter table public.cashier_addition_requests
  alter column requested_credits set not null;

alter table public.cashier_addition_requests
  drop constraint if exists cashier_addition_requests_requested_credits_check;

alter table public.cashier_addition_requests
  add constraint cashier_addition_requests_requested_credits_check
  check (requested_credits > 0);

drop function if exists public.cashier_request_credit_addition(uuid,uuid,text);
drop function if exists public.cashier_request_credit_addition(uuid,uuid,integer,text);

create or replace function public.cashier_request_credit_addition(
  p_cashier_id uuid,
  p_target_id uuid,
  p_credits integer,
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
  select is_cashier into v_is_cashier
  from public.accounts
  where id = p_cashier_id;

  if coalesce(v_is_cashier,false)=false then
    raise exception 'La cuenta no tiene activo el rol de cajero';
  end if;

  if p_cashier_id = p_target_id then
    raise exception 'Un cajero no puede solicitar créditos para sí mismo';
  end if;

  if not exists(select 1 from public.accounts where id=p_target_id) then
    raise exception 'Cuenta de destino inexistente';
  end if;

  if p_credits is null or p_credits < 1 then
    raise exception 'La cantidad de créditos debe ser mayor que cero';
  end if;

  if length(trim(coalesce(p_description,''))) < 3 then
    raise exception 'Debes describir la actividad o dinámica';
  end if;

  insert into public.cashier_addition_requests(
    cashier_id,
    target_account_id,
    requested_credits,
    description
  )
  values(
    p_cashier_id,
    p_target_id,
    p_credits,
    trim(p_description)
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.cashier_request_credit_addition(uuid,uuid,integer,text) to anon;

notify pgrst, 'reload schema';
