-- Undo 0009: valve library changes are refused again (the table and its data stay; 0009 re-applies cleanly).
do $mig$
declare
  src text := pg_get_functiondef('public.apply_field_change()'::regprocedure);
begin
  execute replace(src, $q$new.table_name in ('libraryInstruments', 'certProfiles', 'libraryValves')$q$,
                       $q$new.table_name in ('libraryInstruments', 'certProfiles')$q$);
end $mig$;
revoke execute on function public.apply_field_change() from public, anon, authenticated;
alter table public.field_changes drop constraint if exists field_changes_table_name_check;
alter table public.field_changes add constraint field_changes_table_name_check check (table_name in
  ('projects', 'equipment', 'airflowRows', 'issues', 'photos', 'instruments', 'libraryInstruments', 'certProfiles'))
  not valid;
