-- =====================================================================================================================
-- a2b TAB App: shared unit configuration library
--
-- One entry per product line (Carrier WeatherMaster 48GE, Munters DryCool HCUc, CaptiveAire A2-D …), matched to units by
-- make and model pattern: the supply-air component order the static pressure profile follows (filter, wheel, coil,
-- reheat, fan, heat …), how that order is known (stated / inferred / unconfirmed, with the evidence), and the manuals,
-- product data, submittals and drawings of the line.
--
--  1. `unit_library`: an organization record like the pump library (0010): changes travel through field_changes
--     (table 'libraryUnits') with the entry's own id as project_id; members read it (RLS by organization), nobody
--     writes it directly.
--  2. The apply trigger treats 'libraryUnits' like the other organization records: its current definition is read and
--     the 0010 organization-table list extended; the migration stops if that list is not there. Re-runnable.
--
-- Rollback: rollback/0014_unit_library_down.sql (the trigger without 'libraryUnits'; the table and data stay).
-- =====================================================================================================================

create table if not exists public.unit_library (
  id              uuid primary key,
  org_id          uuid not null references public.organizations (id),
  make            text not null default '',
  line            text not null default '',
  model_patterns  text not null default '',   -- "48GE*, 50GE*": * any characters, ? one
  unit_type       text not null default '',   -- RTU, DOAS, DHU, MAU, ERV, EF
  components      jsonb,                      -- [{ "kind": "filter" }, { "kind": "coil" }, { "kind": "fan" }, { "kind": "heat" }]
  confidence      text not null default 'unconfirmed' check (confidence in ('stated', 'inferred', 'unconfirmed')),
  evidence        text not null default '',
  documents       jsonb,                      -- [{ "title": …, "kind": "manual", "ref": …, "url": … }]
  notes           text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists unit_library_org_idx on public.unit_library (org_id);

alter table public.unit_library enable row level security;
drop policy if exists "members read the unit library" on public.unit_library;
create policy "members read the unit library" on public.unit_library
  for select to authenticated using (org_id = public.current_org_id());
revoke all on public.unit_library from anon;
revoke insert, update, delete, truncate on public.unit_library from authenticated;
grant select on public.unit_library to authenticated;

alter table public.field_changes drop constraint if exists field_changes_table_name_check;
alter table public.field_changes add constraint field_changes_table_name_check check (table_name in
  ('projects', 'equipment', 'airflowRows', 'issues', 'photos', 'instruments', 'libraryInstruments', 'certProfiles',
   'libraryValves', 'libraryPumps', 'libraryUnits'));

insert into public.sync_columns (table_name, app_key, column_name, kind) values
  ('libraryUnits', 'make', 'make', 'text'),
  ('libraryUnits', 'line', 'line', 'text'),
  ('libraryUnits', 'modelPatterns', 'model_patterns', 'text'),
  ('libraryUnits', 'unitType', 'unit_type', 'text'),
  ('libraryUnits', 'components', 'components', 'jsonb'),
  ('libraryUnits', 'confidence', 'confidence', 'text'),
  ('libraryUnits', 'evidence', 'evidence', 'text'),
  ('libraryUnits', 'documents', 'documents', 'jsonb'),
  ('libraryUnits', 'notes', 'notes', 'text')
on conflict (table_name, app_key) do nothing;

create or replace function public.sync_table(app_table text) returns text
language sql immutable as $$
  select case app_table when 'airflowRows' then 'airflow_rows' when 'libraryInstruments' then 'instrument_library'
    when 'certProfiles' then 'cert_profiles' when 'libraryValves' then 'valve_library'
    when 'libraryPumps' then 'pump_library' when 'libraryUnits' then 'unit_library' else app_table end
$$;
revoke execute on function public.sync_table(text) from public, anon, authenticated;

-- the apply trigger: 'libraryUnits' joins the organization records
do $mig$
declare
  src text := pg_get_functiondef('public.apply_field_change()'::regprocedure);
  old_list constant text := $q$new.table_name in ('libraryInstruments', 'certProfiles', 'libraryValves', 'libraryPumps')$q$;
  new_list constant text := $q$new.table_name in ('libraryInstruments', 'certProfiles', 'libraryValves', 'libraryPumps', 'libraryUnits')$q$;
begin
  if position(new_list in src) > 0 then
    return; -- already applied
  end if;
  if position(old_list in src) = 0 then
    raise exception '0014: apply_field_change() does not have the 0010 organization-table list; apply 0010 first';
  end if;
  execute replace(src, old_list, new_list);
end $mig$;
revoke execute on function public.apply_field_change() from public, anon, authenticated;
