-- =====================================================================================================================
-- a2b TAB App: issues and photos linked to an airflow line
--
-- An issue or a unit photo can name the airflow line it is about (an outlet, grille or valve row of its unit), besides
-- the project (general) and the unit levels it already had.
--
--  1. `issues.airflow_row_id` and `photos.airflow_row_id`, nullable, set null when the line is deleted (the issue /
--     photo stays on its unit); synced as `airflowRowId`.
--  2. `airflowRowId` is a link like `equipmentId` (0004): it must name a line of the same project, and a link to a
--     line another device deleted is handled as in 0005 (a create goes in without it, a set is kept unapplied).
--     change_links() gets the new key; the apply trigger's target-table choice is extended in place (its current
--     definition is read; the migration stops if the expected text is not there). Re-runnable.
--
-- Rollback: rollback/0011_row_links_down.sql (links no longer checked or synced; the columns and values stay).
-- =====================================================================================================================

alter table public.issues add column if not exists airflow_row_id uuid references public.airflow_rows (id) on delete set null;
alter table public.photos add column if not exists airflow_row_id uuid references public.airflow_rows (id) on delete set null;
create index if not exists issues_airflow_row_idx on public.issues (airflow_row_id);
create index if not exists photos_airflow_row_idx on public.photos (airflow_row_id);

insert into public.sync_columns (table_name, app_key, column_name, kind) values
  ('issues', 'airflowRowId', 'airflow_row_id', 'uuid'),
  ('photos', 'airflowRowId', 'airflow_row_id', 'uuid')
on conflict (table_name, app_key) do nothing;

create or replace function public.change_links(op text, fld text, val jsonb) returns table (field text, target uuid)
language plpgsql immutable as $$
declare
  k text;
begin
  if op = 'create' and jsonb_typeof(val) = 'object' then
    foreach k in array array['equipmentId', 'issueId', 'libraryId', 'airflowRowId'] loop
      if jsonb_typeof(val -> k) = 'string' and (val ->> k) <> '' then
        field := k; target := (val ->> k)::uuid; return next;
      end if;
    end loop;
  elsif op = 'set' and fld in ('equipmentId', 'issueId', 'libraryId', 'airflowRowId') and jsonb_typeof(val) = 'string'
        and (val #>> '{}') <> '' then
    field := fld; target := (val #>> '{}')::uuid; return next;
  end if;
end $$;
revoke execute on function public.change_links(text, text, jsonb) from public, anon, authenticated;

-- the apply trigger: an airflowRowId link is looked up in airflow_rows
do $mig$
declare
  src text := pg_get_functiondef('public.apply_field_change()'::regprocedure);
  old_case constant text := $q$case v_link.field when 'equipmentId' then 'equipment' else 'issues' end$q$;
  new_case constant text :=
    $q$case v_link.field when 'equipmentId' then 'equipment' when 'airflowRowId' then 'airflow_rows' else 'issues' end$q$;
begin
  if position(new_case in src) > 0 then
    return; -- already applied
  end if;
  if position(old_case in src) = 0 then
    raise exception '0011: apply_field_change() does not have the 0004 link lookup; review the trigger first';
  end if;
  execute replace(src, old_case, new_case);
end $mig$;
revoke execute on function public.apply_field_change() from public, anon, authenticated;
