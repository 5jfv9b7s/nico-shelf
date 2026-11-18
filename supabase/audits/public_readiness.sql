-- READ ONLY. Run as project owner in Supabase SQL Editor.
-- This does not replace two-account API testing or repair unexpected results.
begin transaction read only;

-- All five rows should have rls=true, anon=false, auth_crud=true, auth_truncate=false.
select c.relname as resource,c.relrowsecurity as rls,
  has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_any,
  has_table_privilege('authenticated',c.oid,'SELECT')
    and has_table_privilege('authenticated',c.oid,'INSERT')
    and has_table_privilege('authenticated',c.oid,'UPDATE')
    and has_table_privilege('authenticated',c.oid,'DELETE') as auth_crud,
  has_table_privilege('authenticated',c.oid,'TRUNCATE') as auth_truncate
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('playlists','videos','entries','user_meta','saved_searches')
order by c.relname;

-- Inspect every policy, including any unexpected permissive policy.
select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('playlists','videos','entries','user_meta','saved_searches')
order by tablename,policyname;

-- Expected: 5 enabled quota triggers and no anonymous function grants below.
select c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal
  and c.relname in ('playlists','videos','entries','user_meta','saved_searches');
select n.nspname,p.proname,p.prosecdef as security_definer,p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as auth_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='nico_private' or (n.nspname='public' and p.proname in
 ('read_my_library_usage','apply_mylist_snapshot','apply_mylist_snapshot_v2'));
select has_schema_privilege('authenticated','nico_private','USAGE') as private_schema_auth,
  has_schema_privilege('anon','nico_private','USAGE') as private_schema_anon;

-- Expected: zero rows. Compares resource, per-account and global logical counters.
with actual as (
 select owner_id,'playlists' as resource,count(*) as row_count,sum(octet_length(to_jsonb(t)::text)) as bytes_used from public.playlists t group by owner_id
 union all select owner_id,'videos',count(*),sum(octet_length(to_jsonb(t)::text)) from public.videos t group by owner_id
 union all select owner_id,'entries',count(*),sum(octet_length(to_jsonb(t)::text)) from public.entries t group by owner_id
 union all select owner_id,'user_meta',count(*),sum(octet_length(to_jsonb(t)::text)) from public.user_meta t group by owner_id
 union all select owner_id,'saved_searches',count(*),sum(octet_length(to_jsonb(t)::text)) from public.saved_searches t group by owner_id
), expected as (
 select * from actual
 union all select owner_id,'__total__',0,sum(bytes_used) from actual group by owner_id
), mismatch as (
 select coalesce(a.owner_id,u.owner_id)::text as owner_id,
   coalesce(a.resource,u.resource) as resource,coalesce(a.row_count,0) as actual_rows,
   coalesce(u.row_count,0) as charged_rows,coalesce(a.bytes_used,0) as actual_bytes,
   coalesce(u.bytes_used,0) as charged_bytes
 from expected a full join nico_private.library_usage u using(owner_id,resource)
 where coalesce(a.row_count,0)<>coalesce(u.row_count,0) or coalesce(a.bytes_used,0)<>coalesce(u.bytes_used,0)
)
select * from mismatch
union all select 'GLOBAL','__total__',0,0,
  (select coalesce(sum(bytes_used),0) from actual),bytes_used from nico_private.global_usage
where bytes_used<>(select coalesce(sum(bytes_used),0) from actual);

-- Logical usage and physical database size are different measures.
select limits from nico_private.library_configuration;
select bytes_used as charged_global_bytes from nico_private.global_usage;
select pg_database_size(current_database()) as physical_database_bytes;
select count(*) as auth_accounts from auth.users;
-- Counts only: do not export e-mails, JWTs or private notes when sharing audit output.
commit;
