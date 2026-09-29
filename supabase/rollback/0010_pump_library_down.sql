-- Undo 0010: pump library changes are refused again (the table and its data stay; 0010 re-applies cleanly).
do $mig$
declare
  src text := pg_get_functiondef('public.apply_field_change()'::regprocedure);
begin
  execute replace(src, $q$new.table_name in ('libraryInstruments', 'certProfiles', 'libraryValves', 'libraryPumps')$q$,
                       $q$new.table_name in ('libraryInstruments', 'certProfiles', 'libraryValves')$q$);
end $mig$;
revoke execute on function public.apply_field_change() from public, anon, authenticated;
create or replace function public.sync_table(app_table text) returns text
language sql immutable as $$
  select case app_table when 'airflowRows' then 'airflow_rows' when 'libraryInstruments' then 'instrument_library'
    when 'certProfiles' then 'cert_profiles' when 'libraryValves' then 'valve_library' else app_table end
$$;
revoke execute on function public.sync_table(text) from public, anon, authenticated;
alter table public.field_changes drop constraint if exists field_changes_table_name_check;
alter table public.field_changes add constraint field_changes_table_name_check check (table_name in
  ('projects', 'equipment', 'airflowRows', 'issues', 'photos', 'instruments', 'libraryInstruments', 'certProfiles',
   'libraryValves'))
  not valid;
