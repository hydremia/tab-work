-- =====================================================================================================================
-- a2b TAB App: shared balancing-valve library (hydronic)
--
-- Valve models stored once for the organization and picked on a valve row, so the app can turn a setting and a ΔP into
-- a flow (fixed / adjustable orifice: Cv at the setting × √ΔP psi) or check a self-adjusting valve's ΔP against its
-- range. Entries come from manufacturer data sheets (FDI, FlowCon, B&G, Armstrong, Nexus …) and are added as valves turn
-- up on jobs; each names its source.
--
--  1. `valve_library`: an organization record like the calibration library (0004) and the certification profile (0006):
--     changes travel through field_changes (table 'libraryValves') with the valve's own id as project_id; members read
--     it (RLS by organization), nobody writes it directly.
--  2. The apply trigger treats 'libraryValves' like the other organization records. Instead of repeating the whole
--     function (0006), its current definition is read and the organization-table list extended; the migration stops
--     if the expected text is not there (a changed trigger needs a look first). Re-runnable.
--
-- Rollback: rollback/0009_valve_library_down.sql (the trigger without 'libraryValves'; the table and data stay).
-- =====================================================================================================================

create table if not exists public.valve_library (
  id          uuid primary key,
  org_id      uuid not null references public.organizations (id),
  make        text not null default '',
  model       text not null default '',
  size        text not null default '',
  valve_type  text not null default '',   -- F fixed orifice, A adjustable orifice, S self-adjusting
  cv_table    jsonb,                      -- [{ "setting": 2.5, "cv": 3.1 }, …] (F: one row, setting null)
  rated_gpm   numeric,                    -- S: the tag flow
  dp_min      numeric,                    -- S: control range, psi
  dp_max      numeric,
  source      text not null default '',   -- data sheet name and date
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists valve_library_org_idx on public.valve_library (org_id);

alter table public.valve_library enable row level security;
drop policy if exists "members read the valve library" on public.valve_library;
create policy "members read the valve library" on public.valve_library
  for select to authenticated using (org_id = public.current_org_id());
revoke all on public.valve_library from anon;
revoke insert, update, delete, truncate on public.valve_library from authenticated;
grant select on public.valve_library to authenticated;

alter table public.field_changes drop constraint if exists field_changes_table_name_check;
alter table public.field_changes add constraint field_changes_table_name_check check (table_name in
  ('projects', 'equipment', 'airflowRows', 'issues', 'photos', 'instruments', 'libraryInstruments', 'certProfiles',
   'libraryValves'));

insert into public.sync_columns (table_name, app_key, column_name, kind) values
  ('libraryValves', 'make', 'make', 'text'),
  ('libraryValves', 'model', 'model', 'text'),
  ('libraryValves', 'size', 'size', 'text'),
  ('libraryValves', 'valveType', 'valve_type', 'text'),
  ('libraryValves', 'cvTable', 'cv_table', 'jsonb'),
  ('libraryValves', 'ratedGpm', 'rated_gpm', 'numeric'),
  ('libraryValves', 'dpMin', 'dp_min', 'numeric'),
  ('libraryValves', 'dpMax', 'dp_max', 'numeric'),
  ('libraryValves', 'source', 'source', 'text'),
  ('libraryValves', 'notes', 'notes', 'text')
on conflict (table_name, app_key) do nothing;

create or replace function public.sync_table(app_table text) returns text
language sql immutable as $$
  select case app_table when 'airflowRows' then 'airflow_rows' when 'libraryInstruments' then 'instrument_library'
    when 'certProfiles' then 'cert_profiles' when 'libraryValves' then 'valve_library' else app_table end
$$;
revoke execute on function public.sync_table(text) from public, anon, authenticated;

-- the apply trigger: 'libraryValves' joins the organization records
do $mig$
declare
  src text := pg_get_functiondef('public.apply_field_change()'::regprocedure);
  old_list constant text := $q$new.table_name in ('libraryInstruments', 'certProfiles')$q$;
  new_list constant text := $q$new.table_name in ('libraryInstruments', 'certProfiles', 'libraryValves')$q$;
begin
  if position(new_list in src) > 0 then
    return; -- already applied
  end if;
  if position(old_list in src) = 0 then
    raise exception '0009: apply_field_change() does not have the 0006 organization-table list; review the trigger first';
  end if;
  execute replace(src, old_list, new_list);
end $mig$;
revoke execute on function public.apply_field_change() from public, anon, authenticated;
