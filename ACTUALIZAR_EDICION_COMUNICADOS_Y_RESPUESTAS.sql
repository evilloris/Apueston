-- Ejecutar una sola vez en Supabase si ya instalaste la versión v40.
alter table public.announcement_replies
  add column if not exists edited_once boolean not null default false;

alter table public.announcement_replies
  add column if not exists edited_at timestamptz;

notify pgrst, 'reload schema';
