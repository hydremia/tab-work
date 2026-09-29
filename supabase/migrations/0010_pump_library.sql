-- =====================================================================================================================
-- a2b TAB App: shared pump-curve library (hydronic)
--
-- Pump models with their published head / flow curve per impeller diameter, stored once for the organization and
-- picked on a pump: the shut-off head read at the gauges gives the impeller, the final head (TDH) the flow (the
-- "Pump curve" flow method). Entries come from the manufacturers' curve sheets (B&G, Armstrong, Taco, Grundfos …) and
-- are added as pumps turn up on jobs; each names its source.
--
--  1. `pump_library`: an organization record like the valve library (0009): changes travel through field_changes
--     (table 'libraryPumps') with the pump's own id as project_id; members read it (RLS by organization), nobody
--     writes it directly.
--  2. The apply trigger treats 'libraryPumps' like the other organization records: its current definition is read
--     and the 0009 organization-table list extended; the migration stops if that list is not there. Re-runnable.
--
-- Rollback: rollback/0010_pump_library_down.sql (the trigger without 'libraryPumps'; the table and data stay).
-- =====================================================================================================================

create table if not exists public.pump_library (
  id          uuid primary key,
  org_id      uuid not null references public.organizations (id),
  make        text not null default '',
  model       text not null default '',
  size        text not null default '',
  rpm         numeric,                    -- catalogue speed of the curves
  curves      jsonb,                      -- [{ "impeller": 9.5, "points": [{ "gpm": 0, "head": 80 }, …] }, …]
  source      text not null default '',   -- curve sheet name and date
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists pump_library_org_idx on public.pump_library (org_id);

alter table public.pump_library enable row level security;
drop policy if exists "members read the pump library" on public.pump_library;
create policy "members read the pump library" on public.pump_library
  for select to authenticated using (org_id = public.current_org_id());
revoke all on public.pump_library from anon;
revoke insert, update, delete, truncate on public.pump_library from authenticated;
grant select on public.pump_library to authenticated;

alter table public.field_changes drop constraint if exists field_changes_table_name_check;
alter table public.field_changes add constraint field_changes_table_name_check check (table_name in
  ('projects', 'equipment', 'airflowRows', 'issues', 'photos', 'instruments', 'libraryInstruments', 'certProfiles',
   'libraryValves', 'libraryPumps'));

insert into public.sync_columns (table_name, app_key, column_name, kind) values
  ('libraryPumps', 'make', 'make', 'text'),
  ('libraryPumps', 'model', 'model', 'text'),
  ('libraryPumps', 'size', 'size', 'text'),
  ('libraryPumps', 'rpm', 'rpm', 'numeric'),
  ('libraryPumps', 'curves', 'curves', 'jsonb'),
  ('libraryPumps', 'source', 'source', 'text'),
  ('libraryPumps', 'notes', 'notes', 'text')
on conflict (table_name, app_key) do nothing;

create or replace function public.sync_table(app_table text) returns text
language sql immutable as $$
  select case app_table when 'airflowRows' then 'airflow_rows' when 'libraryInstruments' then 'instrument_library'
    when 'certProfiles' then 'cert_profiles' when 'libraryValves' then 'valve_library'
    when 'libraryPumps' then 'pump_library' else app_table end
$$;
revoke execute on function public.sync_table(text) from public, anon, authenticated;

-- the apply trigger: 'libraryPumps' joins the organization records
do $mig$
declare
  src text := pg_get_functiondef('public.apply_field_change()'::regprocedure);
  old_list constant text := $q$new.table_name in ('libraryInstruments', 'certProfiles', 'libraryValves')$q$;
  new_list constant text := $q$new.table_name in ('libraryInstruments', 'certProfiles', 'libraryValves', 'libraryPumps')$q$;
begin
  if position(new_list in src) > 0 then
    return; -- already applied
  end if;
  if position(old_list in src) = 0 then
    raise exception '0010: apply_field_change() does not have the 0009 organization-table list; apply 0009 first';
  end if;
  execute replace(src, old_list, new_list);
end $mig$;
revoke execute on function public.apply_field_change() from public, anon, authenticated;
