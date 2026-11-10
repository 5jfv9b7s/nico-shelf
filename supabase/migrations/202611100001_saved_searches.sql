-- NICO SHELF v0.9: per-user, cross-device saved search presets.
-- Run once using Supabase SQL Editor before using the new preset controls.
-- This table stores search settings, not credentials or NicoNico cookies.

create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  view text not null default 'library' check (char_length(view) between 1 and 120),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  card_mode text not null default 'list' check (card_mode in ('list', 'grid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

create index if not exists saved_searches_owner_created_idx
  on public.saved_searches(owner_id, created_at desc);

alter table public.saved_searches enable row level security;
revoke all on table public.saved_searches from anon, authenticated;
grant select, insert, update, delete on public.saved_searches to authenticated;

drop policy if exists saved_searches_owner_only on public.saved_searches;
create policy saved_searches_owner_only on public.saved_searches
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
