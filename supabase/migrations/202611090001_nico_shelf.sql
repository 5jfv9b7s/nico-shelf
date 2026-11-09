-- NICO SHELF v0.4: private, per-account database.
-- Run once from Supabase Dashboard -> SQL Editor, or with Supabase migrations.
-- Sign-in is through Supabase Auth. No NicoNico credentials/cookies in these tables.

create table if not exists public.playlists (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null,
  last_sync timestamptz,
  sync_status text,
  primary key (owner_id, id)
);

create table if not exists public.videos (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  title text not null default '',
  description text not null default '',
  uploader text not null default '',
  uploader_id text not null default '',
  published_at timestamptz,
  duration integer,
  views bigint,
  comments bigint,
  mylists bigint,
  likes bigint,
  thumb text,
  genre text,
  kind text,
  voices jsonb not null default '[]'::jsonb,
  producers jsonb not null default '[]'::jsonb,
  composers jsonb not null default '[]'::jsonb,
  arrangers jsonb not null default '[]'::jsonb,
  lyricists jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  vocadb_tags jsonb not null default '[]'::jsonb,
  vocadb_id text,
  status text,
  metadata_updated_at timestamptz,
  primary key (owner_id, id),
  constraint videos_valid_id check (id ~ '^(sm|nm|so)[0-9]{1,12}$'),
  constraint videos_arrays check (
    jsonb_typeof(voices) = 'array' and jsonb_typeof(producers) = 'array'
    and jsonb_typeof(composers) = 'array' and jsonb_typeof(arrangers) = 'array'
    and jsonb_typeof(lyricists) = 'array' and jsonb_typeof(tags) = 'array'
    and jsonb_typeof(vocadb_tags) = 'array'
  )
);

create table if not exists public.entries (
  owner_id uuid not null references auth.users(id) on delete cascade,
  playlist_id text not null,
  video_id text not null,
  position integer not null default 0,
  added_at timestamptz,
  present boolean not null default true,
  primary key (owner_id, playlist_id, video_id),
  foreign key (owner_id, playlist_id)
    references public.playlists(owner_id, id) on delete cascade,
  foreign key (owner_id, video_id)
    references public.videos(owner_id, id) on delete cascade
);

create table if not exists public.user_meta (
  owner_id uuid not null references auth.users(id) on delete cascade,
  video_id text not null,
  rating integer not null default 0 check (rating between 0 and 5),
  favorite boolean not null default false,
  memo text not null default '',
  personal_tags text not null default '',
  verified_voice text not null default '',
  verified_composer text not null default '',
  updated_at timestamptz,
  primary key (owner_id, video_id),
  foreign key (owner_id, video_id)
    references public.videos(owner_id, id) on delete cascade
);

create index if not exists entries_owner_video_idx
  on public.entries(owner_id, video_id) where present;
create index if not exists entries_owner_playlist_position_idx
  on public.entries(owner_id, playlist_id, position) where present;
create index if not exists videos_owner_views_idx
  on public.videos(owner_id, views desc nulls last);
create index if not exists videos_owner_date_idx
  on public.videos(owner_id, published_at desc nulls last);
create index if not exists user_meta_owner_favorite_idx
  on public.user_meta(owner_id, favorite) where favorite;

-- Do NOT allow unauthenticated clients to browse your personal library.
-- RLS applies even if the Pages site itself is publicly accessible.
alter table public.playlists enable row level security;
alter table public.videos enable row level security;
alter table public.entries enable row level security;
alter table public.user_meta enable row level security;

revoke all on table public.playlists, public.videos, public.entries, public.user_meta from anon, authenticated;
grant select, insert, update, delete on table public.playlists, public.videos, public.entries, public.user_meta to authenticated;

create policy playlists_owner_only on public.playlists for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy videos_owner_only on public.videos for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy entries_owner_only on public.entries for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy user_meta_owner_only on public.user_meta for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- Bridge sessions, bridge tokens and NicoNico API jobs are intentionally NOT migrated.
-- A secure Cloudflare/bridge registration protocol must be designed separately.
