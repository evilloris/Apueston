-- Ejecutar una sola vez en Supabase.
create extension if not exists pgcrypto;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 5000),
  allow_replies boolean not null default false,
  created_by uuid references public.accounts(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.announcement_replies (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  edited_once boolean not null default false,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(question) between 1 and 220),
  created_by uuid references public.accounts(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 160),
  sort_order integer not null default 0
);

create table if not exists public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (poll_id, account_id)
);

alter table public.announcements enable row level security;
alter table public.announcement_replies enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

do $$ begin create policy "announcements_all" on public.announcements for all to anon using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "announcement_replies_all" on public.announcement_replies for all to anon using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "polls_all" on public.polls for all to anon using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "poll_options_all" on public.poll_options for all to anon using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "poll_votes_all" on public.poll_votes for all to anon using (true) with check (true); exception when duplicate_object then null; end $$;

do $$ begin alter publication supabase_realtime add table public.announcements; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.announcement_replies; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.polls; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.poll_options; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.poll_votes; exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
