-- NICO SHELF v0.5: atomic, per-user, one-way snapshot application.
-- Apply ONCE after 202611090001_nico_shelf.sql.
-- A user may update only their own existing playlists; no Nico credentials arrive here.

create or replace function public.apply_mylist_snapshot(p_snapshot jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
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
      if (v_item ->> 'video_id') !~ '^(sm|nm|so)[0-9]{1,12}$'
         or (v_item ->> 'position') !~ '^[1-9][0-9]*$'
         or (v_item ->> 'position')::integer > v_count
         or char_length(coalesce(v_item ->> 'title','')) > 220 then
        raise exception 'Malformed video data in playlist %', v_id;
      end if;
    end loop;
  end loop;

  for v_list in select value from jsonb_array_elements(v_lists) loop
    v_id := v_list ->> 'id';
    v_items := v_list -> 'items';
    -- Existing metadata, reviews and personal notes are never overwritten.
    insert into public.videos (owner_id,id,title)
      select v_owner, x->>'video_id', coalesce(nullif(x->>'title',''), x->>'video_id')
      from jsonb_array_elements(v_items) x
      on conflict (owner_id,id) do nothing;

    insert into public.entries (owner_id,playlist_id,video_id,position,present)
      select v_owner,v_id,x->>'video_id',(x->>'position')::integer,true
      from jsonb_array_elements(v_items) x
      on conflict (owner_id,playlist_id,video_id)
      do update set present=true,position=excluded.position;

    -- Keep old entries as absent history (present=false). No DELETE and no user_meta changes.
    update public.entries e set present=false
      where e.owner_id=v_owner and e.playlist_id=v_id and e.present=true
        and not exists (select 1 from jsonb_array_elements(v_items) x where x->>'video_id'=e.video_id);

    update public.playlists set last_sync=now(),sync_status='同期済み（取得一覧）'
      where owner_id=v_owner and id=v_id;
    v_processed := v_processed+1;
  end loop;
  return jsonb_build_object('ok',true,'updated_playlists',v_processed);
end;
$$;

revoke all on function public.apply_mylist_snapshot(jsonb) from public, anon;
grant execute on function public.apply_mylist_snapshot(jsonb) to authenticated;
