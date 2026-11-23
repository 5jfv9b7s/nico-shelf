-- NICO SHELF v0.20.0: synchronize source playlist names; preserve partial sync.
-- Run this ENTIRE script in Supabase SQL Editor. It can be run again.

begin;

create or replace function public.apply_mylist_snapshot_v2(p_snapshot jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $mylist_v2$
declare
  v_owner uuid := (select auth.uid());
  v_lists jsonb;
  v_list jsonb;
  v_items jsonb;
  v_id text;
  v_item jsonb;
  v_count integer;
  v_processed integer := 0;
  v_name text;
  v_allow_removals boolean;
  v_last_position integer;
begin
  if v_owner is null then raise exception 'Login required'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Invalid snapshot';
  end if;
  v_lists := p_snapshot -> 'lists';
  if jsonb_typeof(v_lists) is distinct from 'array'
     or jsonb_array_length(v_lists) < 1 or jsonb_array_length(v_lists) > 25 then
    raise exception 'Invalid or empty list collection';
  end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(v_lists) x) <> jsonb_array_length(v_lists) then
    raise exception 'Duplicate playlist IDs';
  end if;
  -- Validate the WHOLE snapshot before touching any row. This function is atomic.
  for v_list in select value from jsonb_array_elements(v_lists) loop
    v_id := v_list ->> 'id';
    v_items := v_list -> 'items';
    if v_id is null or v_id !~ '^[0-9]{1,16}$' then raise exception 'Invalid remote playlist ID'; end if;
    if v_list ? 'allow_removals' and jsonb_typeof(v_list -> 'allow_removals') is distinct from 'boolean' then
      raise exception 'Invalid sync mode for playlist %', v_id;
    end if;
    if v_list ? 'name' and (jsonb_typeof(v_list -> 'name') is distinct from 'string'
       or btrim(v_list ->> 'name') = '' or char_length(v_list ->> 'name') > 200) then
      raise exception 'Invalid playlist name for %', v_id;
    end if;
    select name into v_name from public.playlists where owner_id=v_owner and id=v_id;
    if not found then raise exception 'Unknown playlist %', v_id; end if;
    if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items)>1000 then
      raise exception 'Incomplete items for playlist %', v_id;
    end if;
    v_count := jsonb_array_length(v_items);
    if (select count(distinct x->>'video_id') from jsonb_array_elements(v_items) x) <> v_count then
      raise exception 'Duplicate video IDs in playlist %', v_id;
    end if;
    if (select count(distinct x->>'position') from jsonb_array_elements(v_items) x) <> v_count then
      raise exception 'Duplicate positions in playlist %', v_id;
    end if;
    for v_item in select value from jsonb_array_elements(v_items) loop
      if (v_item ->> 'video_id') is null or (v_item ->> 'position') is null
         or (v_item ->> 'video_id') !~ '^(sm|nm|so)[0-9]{1,12}$'
         or (v_item ->> 'position') !~ '^[1-9][0-9]*$'
         or (v_item ->> 'position')::integer > v_count
         or char_length(coalesce(v_item ->> 'title','')) > 220 then
        raise exception 'Malformed video data in playlist %', v_id;
      end if;
    end loop;
  end loop;

  -- Lock all selected playlists before writing to avoid interleaved snapshots.
  perform 1 from public.playlists
    where owner_id=v_owner and id in (select x->>'id' from jsonb_array_elements(v_lists) x)
    order by id for update;

  for v_list in select value from jsonb_array_elements(v_lists) loop
    v_id := v_list ->> 'id';
    v_items := v_list -> 'items';
    v_allow_removals := coalesce((v_list ->> 'allow_removals')::boolean, true);
    -- Existing metadata, reviews and personal notes are never overwritten.
    insert into public.videos (owner_id,id,title)
      select v_owner, x->>'video_id', coalesce(nullif(x->>'title',''), x->>'video_id')
      from jsonb_array_elements(v_items) x
      on conflict (owner_id,id) do nothing;

    if v_allow_removals then
      insert into public.entries (owner_id,playlist_id,video_id,position,present)
        select v_owner,v_id,x->>'video_id',(x->>'position')::integer,true
        from jsonb_array_elements(v_items) x
        on conflict (owner_id,playlist_id,video_id)
        do update set present=true,position=excluded.position;

      update public.entries e set present=false
        where e.owner_id=v_owner and e.playlist_id=v_id and e.present=true
          and not exists (select 1 from jsonb_array_elements(v_items) x where x->>'video_id'=e.video_id);
    else
      -- A short response cannot establish deletions or exact existing positions.
      -- Append only new/restored entries after the current active sequence.
      select coalesce(max(position),0) into v_last_position from public.entries
        where owner_id=v_owner and playlist_id=v_id and present=true;
      insert into public.entries (owner_id,playlist_id,video_id,position,present)
        select v_owner,v_id,x->>'video_id',
          v_last_position + (row_number() over (order by (x->>'position')::integer))::integer,true
        from jsonb_array_elements(v_items) x
        where not exists (
          select 1 from public.entries e
          where e.owner_id=v_owner and e.playlist_id=v_id and e.video_id=x->>'video_id' and e.present=true
        )
        on conflict (owner_id,playlist_id,video_id)
        do update set present=true,position=excluded.position;
    end if;

    update public.playlists set name=coalesce(v_list ->> 'name',name),last_sync=now(),sync_status=case
        when v_allow_removals then U&'\540C\671F\6E08\307F\FF08\53D6\5F97\4E00\89A7\FF09'
        else U&'\516C\958B\53D6\5F97\5206\3092\53CD\6620\FF08\65E2\5B58\6240\5C5E\30FB\9806\756A\3092\4FDD\6301\FF09' end
      where owner_id=v_owner and id=v_id;
    v_processed := v_processed+1;
  end loop;
  return jsonb_build_object('ok',true,'updated_playlists',v_processed);
end;
$mylist_v2$;

revoke all on function public.apply_mylist_snapshot_v2(jsonb) from public, anon;
grant execute on function public.apply_mylist_snapshot_v2(jsonb) to authenticated;

-- Older clients use the same playlist locks and keep their full-snapshot behavior.
create or replace function public.apply_mylist_snapshot(p_snapshot jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $mylist_compat$
  select public.apply_mylist_snapshot_v2(p_snapshot);
$mylist_compat$;

revoke all on function public.apply_mylist_snapshot(jsonb) from public, anon;
grant execute on function public.apply_mylist_snapshot(jsonb) to authenticated;

commit;

select
  to_regprocedure('public.apply_mylist_snapshot_v2(jsonb)') is not null as v2_ready,
  to_regprocedure('public.apply_mylist_snapshot(jsonb)') is not null as compatibility_ready;
