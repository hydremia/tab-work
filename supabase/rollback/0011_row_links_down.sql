-- Undo 0011: airflowRowId is no longer synced or checked (the columns and their values stay; 0011 re-applies cleanly).
do $mig$
declare
  src text := pg_get_functiondef('public.apply_field_change()'::regprocedure);
begin
  execute replace(src,
    $q$case v_link.field when 'equipmentId' then 'equipment' when 'airflowRowId' then 'airflow_rows' else 'issues' end$q$,
    $q$case v_link.field when 'equipmentId' then 'equipment' else 'issues' end$q$);
end $mig$;
revoke execute on function public.apply_field_change() from public, anon, authenticated;
create or replace function public.change_links(op text, fld text, val jsonb) returns table (field text, target uuid)
language plpgsql immutable as $$
declare
  k text;
begin
  if op = 'create' and jsonb_typeof(val) = 'object' then
    foreach k in array array['equipmentId', 'issueId', 'libraryId'] loop
      if jsonb_typeof(val -> k) = 'string' and (val ->> k) <> '' then
        field := k; target := (val ->> k)::uuid; return next;
      end if;
    end loop;
  elsif op = 'set' and fld in ('equipmentId', 'issueId', 'libraryId') and jsonb_typeof(val) = 'string'
        and (val #>> '{}') <> '' then
    field := fld; target := (val #>> '{}')::uuid; return next;
  end if;
end $$;
revoke execute on function public.change_links(text, text, jsonb) from public, anon, authenticated;
delete from public.sync_columns where table_name in ('issues', 'photos') and app_key = 'airflowRowId';
