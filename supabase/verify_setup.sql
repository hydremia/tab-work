-- Read-only check of a Supabase project's setup: one row per migration (0001-0014) with ok / MISSING, plus the
-- sign-ins per provider. Run in Supabase -> SQL Editor. Expected: every row ok, 83 mapped sync fields.
select check_name, result,
       case when result = expected then 'ok' else 'MISSING / CHECK' end as status,
       expected
from (values
  ('0001 tables + sync log',       (to_regclass('public.field_changes') is not null)::text, 'true'),
  ('0001 photos bucket private',   (select coalesce(bool_and(not public), false)::text from storage.buckets where id = 'photos'), 'true'),
  ('0001 organization a2b',        (select count(*)::text from public.organizations where name = 'a2b'), '1'),
  ('0002 review/lock columns',     (select (count(*) > 0)::text from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name like 'lock%'), 'true'),
  ('0003 server clock',            (to_regprocedure('public.server_time_ms()') is not null)::text, 'true'),
  ('0005 field_changes.units',     (select count(*)::text from information_schema.columns where table_name = 'field_changes' and column_name = 'units'), '1'),
  ('0006 cert_profiles',           (to_regclass('public.cert_profiles') is not null)::text, 'true'),
  ('0007 device_name',             (select count(*)::text from information_schema.columns where table_name = 'field_changes' and column_name = 'device_name'), '1'),
  ('0008 hydronic types',          (select coalesce(bool_or(pg_get_constraintdef(oid) like '%valveSystem%'), false)::text from pg_constraint where conname = 'equipment_type_check'), 'true'),
  ('0009 valve_library',           (to_regclass('public.valve_library') is not null)::text, 'true'),
  ('0010 pump_library',            (to_regclass('public.pump_library') is not null)::text, 'true'),
  ('0011 issues.airflow_row_id',   (select count(*)::text from information_schema.columns where table_name = 'issues' and column_name = 'airflow_row_id'), '1'),
  ('0012 motor photos',            (select coalesce(bool_or(pg_get_constraintdef(oid) like '%motor%'), false)::text from pg_constraint where conname = 'photos_category_check'), 'true'),
  ('0013 issues.issue_type',       (select count(*)::text from information_schema.columns where table_name = 'issues' and column_name = 'issue_type'), '1'),
  ('0014 unit_library',            (to_regclass('public.unit_library') is not null)::text, 'true'),
  ('0001-0014 mapped sync fields', (select count(*)::text from public.sync_columns), '83')
) as t(check_name, result, expected)
union all
select 'users signed in via ' || coalesce(raw_app_meta_data->>'provider', '?'), count(*)::text, 'info', '-'
from auth.users
group by 1;
