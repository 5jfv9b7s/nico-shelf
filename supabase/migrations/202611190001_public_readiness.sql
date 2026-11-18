-- NICO SHELF v0.19.0. Apply this entire ASCII-only script after v0.17.3.
-- Existing library rows are not removed or silently truncated.
begin;

lock table public.playlists, public.videos, public.entries, public.user_meta,
  public.saved_searches in share row exclusive mode;

create schema if not exists nico_private;
revoke all on schema nico_private from public, anon, authenticated;

create table if not exists nico_private.library_configuration (
  singleton boolean primary key default true check (singleton),
  limits jsonb not null
);
insert into nico_private.library_configuration(singleton, limits) values (true,
  '{"version":1,"rows":{"playlists":50,"videos":10000,"entries":30000,"user_meta":10000,"saved_searches":20},
    "account_bytes":52428800,"global_bytes":262144000,"row_bytes":65536,
    "array_items":100,"array_bytes":16384,"filter_bytes":8192,
    "text":{"playlists":{"id":80,"name":200,"sync_status":500},
      "videos":{"title":1000,"description":20000,"uploader":200,"uploader_id":80,"thumb":2048,"genre":200,"kind":200,"vocadb_id":80,"status":200},
      "user_meta":{"memo":10000,"personal_tags":500,"verified_voice":500,"verified_composer":500},
      "saved_searches":{"name":80,"view":120}}}'::jsonb)
on conflict (singleton) do nothing;

create table if not exists nico_private.library_usage (
  owner_id uuid not null references auth.users(id) on delete cascade,
  resource text not null check (resource in ('__total__','playlists','videos','entries','user_meta','saved_searches')),
  row_count bigint not null default 0 check (row_count >= 0),
  bytes_used bigint not null default 0 check (bytes_used >= 0),
  primary key (owner_id, resource)
);
create table if not exists nico_private.global_usage (
  singleton boolean primary key default true check (singleton),
  bytes_used bigint not null default 0 check (bytes_used >= 0)
);

alter table nico_private.library_configuration enable row level security;
alter table nico_private.library_usage enable row level security;
alter table nico_private.global_usage enable row level security;
revoke all on all tables in schema nico_private from public, anon, authenticated;

create or replace function nico_private.check_library_payload(
  p_table text, p_new jsonb, p_old jsonb, p_limits jsonb
) returns void
language plpgsql
set search_path = ''
as $payload$
declare
  v_field text;
  v_limit bigint;
  v_new bigint;
  v_old bigint;
begin
  -- Grandfather old oversized fields only when they stay the same size or shrink.
  for v_field, v_limit in
    select key, value::bigint from jsonb_each_text(coalesce(p_limits->'text'->p_table, '{}'::jsonb))
  loop
    v_new := char_length(coalesce(p_new->>v_field, ''));
    v_old := char_length(coalesce(p_old->>v_field, ''));
    if v_new > v_limit and v_new > v_old then
      raise exception using errcode='P0001', message='NICO_FIELD_LIMIT',
        detail=p_table || '.' || v_field || ':' || v_limit;
    end if;
  end loop;
  if p_table='videos' then
    foreach v_field in array array['voices','producers','composers','arrangers','lyricists','tags','vocadb_tags'] loop
      if jsonb_typeof(p_new->v_field) is distinct from 'array' then
        raise exception using errcode='P0001', message='NICO_ARRAY_FORMAT', detail=v_field;
      end if;
      v_new := jsonb_array_length(p_new->v_field);
      v_old := case when jsonb_typeof(p_old->v_field)='array' then jsonb_array_length(p_old->v_field) else 0 end;
      if v_new > (p_limits->>'array_items')::bigint and v_new > v_old then
        raise exception using errcode='P0001', message='NICO_ARRAY_LIMIT', detail=v_field;
      end if;
      v_new := octet_length((p_new->v_field)::text);
      v_old := coalesce(octet_length((p_old->v_field)::text),0);
      if v_new > (p_limits->>'array_bytes')::bigint and v_new > v_old then
        raise exception using errcode='P0001', message='NICO_ARRAY_LIMIT', detail=v_field;
      end if;
    end loop;
  end if;
  if p_table='saved_searches' then
    v_new := octet_length((p_new->'filters')::text);
    v_old := coalesce(octet_length((p_old->'filters')::text),0);
    if v_new > (p_limits->>'filter_bytes')::bigint and v_new > v_old then
      raise exception using errcode='P0001', message='NICO_FIELD_LIMIT', detail='saved_searches.filters';
    end if;
  end if;
  v_new := octet_length(p_new::text);
  v_old := octet_length(p_old::text);
  if v_new > (p_limits->>'row_bytes')::bigint and v_new > v_old then
    raise exception using errcode='P0001', message='NICO_ROW_LIMIT';
  end if;
end;
$payload$;

create or replace function nico_private.enforce_library_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $limits$
declare
  v_owner uuid;
  v_limits jsonb;
  v_new jsonb := case when TG_OP='DELETE' then '{}'::jsonb else to_jsonb(NEW) end;
  v_old jsonb := case when TG_OP='INSERT' then '{}'::jsonb else to_jsonb(OLD) end;
  v_delta bigint;
  v_rows integer := case when TG_OP='INSERT' then 1 when TG_OP='DELETE' then -1 else 0 end;
  v_max_rows bigint;
begin
  if TG_TABLE_SCHEMA<>'public' or TG_TABLE_NAME not in
    ('playlists','videos','entries','user_meta','saved_searches') then
    raise exception 'Unsupported quota resource';
  end if;
  v_owner := coalesce((v_new->>'owner_id')::uuid,(v_old->>'owner_id')::uuid);
  if TG_OP='UPDATE' and v_new->>'owner_id' is distinct from v_old->>'owner_id' then
    raise exception using errcode='P0001', message='NICO_OWNER_IMMUTABLE';
  end if;
  select limits into strict v_limits from nico_private.library_configuration where singleton;
  v_max_rows := (v_limits->'rows'->>TG_TABLE_NAME)::bigint;
  if TG_OP<>'DELETE' then
    perform nico_private.check_library_payload(TG_TABLE_NAME,v_new,v_old,v_limits);
  end if;
  v_delta := case when TG_OP='INSERT' then octet_length(v_new::text)
    when TG_OP='DELETE' then -octet_length(v_old::text)
    else octet_length(v_new::text)-octet_length(v_old::text) end;

  -- Atomic guarded UPDATEs serialize competing charges, including bulk writes.
  -- Every operation locks global -> account -> resource in the same order.
  update nico_private.global_usage set bytes_used=bytes_used+v_delta
    where singleton and bytes_used+v_delta>=0
      and (v_delta<=0 or bytes_used+v_delta <= (v_limits->>'global_bytes')::bigint);
  if not found then
    raise exception using errcode='P0001', message='NICO_QUOTA_GLOBAL';
  end if;
  if TG_OP<>'DELETE' then
    insert into nico_private.library_usage(owner_id,resource)
      values(v_owner,'__total__'),(v_owner,TG_TABLE_NAME)
      on conflict (owner_id,resource) do nothing;
  end if;
  update nico_private.library_usage set bytes_used=bytes_used+v_delta
    where owner_id=v_owner and resource='__total__' and bytes_used+v_delta>=0
      and (v_delta<=0 or bytes_used+v_delta <= (v_limits->>'account_bytes')::bigint);
  if not found and TG_OP<>'DELETE' then
    raise exception using errcode='P0001', message='NICO_QUOTA_BYTES';
  end if;
  update nico_private.library_usage set
    row_count=row_count+v_rows, bytes_used=bytes_used+v_delta
    where owner_id=v_owner and resource=TG_TABLE_NAME
      and row_count+v_rows>=0 and bytes_used+v_delta>=0
      and (v_rows<=0 or row_count+v_rows<=v_max_rows);
  if not found and TG_OP<>'DELETE' then
    raise exception using errcode='P0001', message='NICO_QUOTA_ROWS',
      detail=TG_TABLE_NAME || ':' || v_max_rows;
  end if;
  -- Missing owner counters during auth.users ON DELETE CASCADE are intentional.
  return null;
end;
$limits$;

-- Rebuild counters under the write locks. No existing application rows change.
delete from nico_private.library_usage;
insert into nico_private.library_usage(owner_id,resource,row_count,bytes_used)
select owner_id,'playlists',count(*),sum(octet_length(to_jsonb(t)::text)) from public.playlists t group by owner_id
union all select owner_id,'videos',count(*),sum(octet_length(to_jsonb(t)::text)) from public.videos t group by owner_id
union all select owner_id,'entries',count(*),sum(octet_length(to_jsonb(t)::text)) from public.entries t group by owner_id
union all select owner_id,'user_meta',count(*),sum(octet_length(to_jsonb(t)::text)) from public.user_meta t group by owner_id
union all select owner_id,'saved_searches',count(*),sum(octet_length(to_jsonb(t)::text)) from public.saved_searches t group by owner_id;
insert into nico_private.library_usage(owner_id,resource,row_count,bytes_used)
  select owner_id,'__total__',0,sum(bytes_used) from nico_private.library_usage group by owner_id;
insert into nico_private.global_usage(singleton,bytes_used)
  select true,coalesce(sum(bytes_used),0) from nico_private.library_usage where resource='__total__'
  on conflict (singleton) do update set bytes_used=excluded.bytes_used;

do $install$
declare v_table text;
begin
  foreach v_table in array array['playlists','videos','entries','user_meta','saved_searches'] loop
    execute format('drop trigger if exists nico_library_limits on public.%I',v_table);
    execute format('create trigger nico_library_limits after insert or update or delete on public.%I for each row execute function nico_private.enforce_library_limits()',v_table);
  end loop;
end;
$install$;

create or replace function public.read_my_library_usage()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $usage$
declare
  v_owner uuid := (select auth.uid());
  v_limits jsonb;
  v_resources jsonb;
  v_bytes bigint;
begin
  if v_owner is null then
    raise exception using errcode='42501', message='NICO_AUTH_REQUIRED';
  end if;
  select limits into strict v_limits from nico_private.library_configuration where singleton;
  select coalesce(jsonb_object_agg(resource,jsonb_build_object('count',row_count,'bytes',bytes_used)),
    '{}'::jsonb) into v_resources from nico_private.library_usage
    where owner_id=v_owner and resource<>'__total__';
  select bytes_used into v_bytes from nico_private.library_usage where owner_id=v_owner and resource='__total__';
  return jsonb_build_object('version',1,'limits',v_limits,'resources',v_resources,'bytes',coalesce(v_bytes,0));
end;
$usage$;

revoke all on all functions in schema nico_private from public, anon, authenticated;
revoke all on function public.read_my_library_usage() from public, anon;
grant execute on function public.read_my_library_usage() to authenticated;
commit;

select 'nico_shelf_public_readiness_v1' as installed,
  to_regprocedure('public.read_my_library_usage()') is not null as usage_rpc_ready;
