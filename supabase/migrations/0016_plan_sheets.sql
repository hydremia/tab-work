-- =====================================================================================================================
-- a2b TAB App: plan sheets (Import from plan)
--
-- A mechanical plan sheet read for a project: the page of a drawing PDF, the air devices found on it (with their
-- places) and the systems the user lassoed, each of which fills one airflow table of a unit and is drawn on the
-- marked-up plan (the final report's Mechanical Floorplan page). Until now the sheets lived on the device that read
-- them; this makes them project records that every device of the organization sees:
--
--  1. `plan_sheets`: a project record like photos. Changes travel through field_changes (table 'planSheets'); the
--     devices and systems are JSON fields (a whole-field set per edit, last writer wins). Members read it (RLS by
--     project), nobody writes it directly: the apply trigger's generic branch creates it (id + project_id, then the
--     create's fields) and the sync column map routes the fields. No change to the trigger itself.
--  2. The drawing file goes to the private storage bucket `plans`, path `<project_id>/<sheet_id>.pdf`, with the
--     photos' access rule (members of the project's organization, also after the project is deleted); the device
--     that read the sheet uploads it after the record is pushed and sets `storagePath`; other devices download it.
--
-- Re-runnable. Apply before the app version with synced plan sheets is used: until then the server refuses
-- 'planSheets' changes and that device's sync stops at the first one.
-- =====================================================================================================================

create table if not exists public.plan_sheets (
  id            uuid primary key,
  project_id    uuid not null references public.projects (id) on delete cascade,
  file_name     text not null default '',
  page          integer not null default 1,
  page_count    integer not null default 1,
  width         numeric,
  height        numeric,
  ocr           boolean not null default false,
  devices       jsonb,            -- [{ key, tag, type, size, cfm, x, y, how, count, index }]
  systems       jsonb,            -- [{ id, equipmentId, table, polygon, deviceKeys, color, prefix, rowIds, createdAt }]
  storage_path  text,             -- "<project_id>/<id>.pdf" in the plans bucket once uploaded
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists plan_sheets_project_idx on public.plan_sheets (project_id);

alter table public.plan_sheets enable row level security;
drop policy if exists "members read plan_sheets" on public.plan_sheets;
create policy "members read plan_sheets" on public.plan_sheets
  for select to authenticated using (public.can_access_project(project_id));
revoke all on public.plan_sheets from anon;
revoke insert, update, delete, truncate on public.plan_sheets from authenticated;
grant select on public.plan_sheets to authenticated;

alter table public.field_changes drop constraint if exists field_changes_table_name_check;
alter table public.field_changes add constraint field_changes_table_name_check check (table_name in
  ('projects', 'equipment', 'airflowRows', 'issues', 'photos', 'instruments', 'libraryInstruments', 'certProfiles',
   'libraryValves', 'libraryPumps', 'libraryUnits', 'planSheets'));

insert into public.sync_columns (table_name, app_key, column_name, kind) values
  ('planSheets', 'fileName', 'file_name', 'text'),
  ('planSheets', 'page', 'page', 'integer'),
  ('planSheets', 'pageCount', 'page_count', 'integer'),
  ('planSheets', 'width', 'width', 'numeric'),
  ('planSheets', 'height', 'height', 'numeric'),
  ('planSheets', 'ocr', 'ocr', 'boolean'),
  ('planSheets', 'devices', 'devices', 'jsonb'),
  ('planSheets', 'systems', 'systems', 'jsonb'),
  ('planSheets', 'storagePath', 'storage_path', 'text')
on conflict (table_name, app_key) do nothing;

create or replace function public.sync_table(app_table text) returns text
language sql immutable as $$
  select case app_table when 'airflowRows' then 'airflow_rows' when 'libraryInstruments' then 'instrument_library'
    when 'certProfiles' then 'cert_profiles' when 'libraryValves' then 'valve_library'
    when 'libraryPumps' then 'pump_library' when 'libraryUnits' then 'unit_library'
    when 'planSheets' then 'plan_sheets' else app_table end
$$;
revoke execute on function public.sync_table(text) from public, anon, authenticated;

-- the apply trigger needs nothing new, but it must be the 0003 trigger (its generic create branch)
do $mig$
begin
  if position('execute format(''insert into public.%I (id, project_id) values ($1, $2) on conflict (id) do nothing'', tbl)'
     in pg_get_functiondef('public.apply_field_change()'::regprocedure)) = 0 then
    raise exception '0016: apply_field_change() is not the 0003 trigger (no generic create branch); apply 0003 first';
  end if;
end $mig$;

-- ------------------------------------------------------------------------------------------ storage: plans bucket
-- Private bucket; object path "<project_id>/<sheet_id>.pdf". Same access rule as the photos (0003
-- can_access_photo_path: members of the project's organization, also after the project is deleted).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plans', 'plans', false, 104857600, array['application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "members read project plans" on storage.objects;
drop policy if exists "members upload project plans" on storage.objects;
drop policy if exists "members update project plans" on storage.objects;
drop policy if exists "members delete project plans" on storage.objects;
create policy "members read project plans" on storage.objects
  for select to authenticated using (bucket_id = 'plans' and public.can_access_photo_path(name));
create policy "members upload project plans" on storage.objects
  for insert to authenticated with check (bucket_id = 'plans' and public.can_access_photo_path(name));
create policy "members update project plans" on storage.objects
  for update to authenticated using (bucket_id = 'plans' and public.can_access_photo_path(name));
create policy "members delete project plans" on storage.objects
  for delete to authenticated using (bucket_id = 'plans' and public.can_access_photo_path(name));
