-- Ejecutar una sola vez en Supabase.
-- Agrega un justificante auditable cuando el administrador se recarga créditos a sí mismo.

alter table public.cashier_transactions
add column if not exists justification text;

notify pgrst, 'reload schema';
