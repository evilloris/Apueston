-- Ejecuta esto una sola vez si ya creaste las tablas con el SQL anterior.
alter table public.matches
add column if not exists elo_processed boolean not null default false;

notify pgrst, 'reload schema';
