-- EJECUTA ESTE ARCHIVO UNA SOLA VEZ EN SUPABASE SQL EDITOR.
-- Permite a los cajeros adicionar créditos sin registrarlos como recargas.
-- Estas adiciones no afectan el fondo común ni las comisiones.

create or replace function public.cashier_add_untracked_credits(
  p_cashier_id uuid,
  p_target_id uuid,
  p_credits integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_cashier boolean;
begin
  if p_credits is null or p_credits <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;

  select is_cashier
  into v_is_cashier
  from public.accounts
  where id = p_cashier_id;

  if coalesce(v_is_cashier,false) = false then
    raise exception 'La cuenta no tiene activo el rol de cajero';
  end if;

  if p_cashier_id = p_target_id then
    raise exception 'Un cajero no puede adicionarse créditos a sí mismo';
  end if;

  if not exists(select 1 from public.accounts where id = p_target_id) then
    raise exception 'Cuenta de destino inexistente';
  end if;

  update public.accounts
  set credits = credits + p_credits
  where id = p_target_id;
end;
$$;

grant execute on function public.cashier_add_untracked_credits(uuid,uuid,integer) to anon;

notify pgrst, 'reload schema';
