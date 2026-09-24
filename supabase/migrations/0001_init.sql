-- =====================================================================================================================
-- a2b TAB App: initial schema (Phase 1)
--
-- Mirrors the app's local data model (app/src/data/types.ts, docs/ROADMAP.md "Data model"):
--   organizations, profiles, projects, equipment, airflow_rows, issues, photos, instruments, field_changes.
-- Sync: devices push their outbox into field_changes; a trigger applies each change to the record tables
-- (last writer wins per record + field, by client timestamp). Devices pull field_changes by server_seq.
-- Security: RLS on every table. All users are equal (internal only): any signed-in user who belongs to the
-- organization can read and write everything in it. Who can sign in at all is decided by the Azure (Entra ID)
-- app registration (single tenant, optionally "assignment required"), see supabase/README.md.
-- =====================================================================================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------------------------------ organizations / profiles
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- the company organization (all users join it on first sign-in)
insert into public.organizations (name) values ('a2b');

create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  org_id       uuid not null references public.organizations (id),
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);
create index profiles_org_idx on public.profiles (org_id);

-- New auth user -> profile in the (single) company organization.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, org_id, email, display_name)
  values (
    new.id,
    (select id from public.organizations order by created_at limit 1),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email)
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS helpers (security definer so policies can read profiles/projects without recursion)
create or replace function public.current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where user_id = auth.uid()
$$;


-- ------------------------------------------------------------------------------------------ record tables
create table public.projects (
  id                uuid primary key,
  org_id            uuid not null references public.organizations (id),
  name              text not null default '',
  scope_profile     text not null default 'full' check (scope_profile in ('full', 'airflow', 'custom')),
  custom_scope      jsonb not null default '{}'::jsonb,
  tolerance         numeric not null default 0.1 check (tolerance > 0 and tolerance < 1),
  report_kind       text not null default 'prelim' check (report_kind in ('prelim', 'final')),
  info              jsonb not null default '{}'::jsonb,
  blueprints        jsonb not null default '[]'::jsonb,
  na_state          jsonb not null default '{"sections": {}, "fields": {}}'::jsonb,
  template_revision text not null default '05',
  cover_photo_id    uuid,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index projects_org_idx on public.projects (org_id);

create or replace function public.can_access_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects pr where pr.id = p and pr.org_id = public.current_org_id())
$$;

create table public.equipment (
  id          uuid primary key,
  project_id  uuid not null references public.projects (id) on delete cascade,
  type        text not null check (type in ('rtu', 'mau', 'erv', 'fan', 'smallFan', 'vav', 'hood', 'traverse')),
  designation text not null default '',
  -- block number on the unit sheet; not unique on purpose: two offline devices can pick the same slot, which the
  -- app resolves on pull (Phase 5) instead of failing the push
  slot        integer not null check (slot >= 1),
  is_existing boolean not null default false,
  data        jsonb not null default '{}'::jsonb,
  na_state    jsonb not null default '{"sections": {}, "fields": {}}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index equipment_project_type_idx on public.equipment (project_id, type);

create table public.airflow_rows (
  id           uuid primary key,
  project_id   uuid not null references public.projects (id) on delete cascade,
  equipment_id uuid not null references public.equipment (id) on delete cascade,
  table_key    text not null,  -- supply | return | oa | outlets | exhaust
  sort_order   double precision not null default 0,
  data         jsonb not null default '{}'::jsonb,
  na           jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index airflow_rows_equipment_idx on public.airflow_rows (equipment_id, table_key, sort_order);
create index airflow_rows_project_idx on public.airflow_rows (project_id);

create table public.issues (
  id           uuid primary key,
  project_id   uuid not null references public.projects (id) on delete cascade,
  kind         text not null default 'new' check (kind in ('new', 'existing')),
  number       integer not null check (number >= 1),  -- numbered separately for New and Existing
  remark       text not null default '',
  status       text not null default 'Open' check (status in ('Open', 'Closed')),
  comments     text not null default '',
  equipment_id uuid references public.equipment (id) on delete set null,  -- null = "General (N/A)"
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index issues_project_idx on public.issues (project_id, kind, number);
create index issues_equipment_idx on public.issues (equipment_id);

create table public.photos (
  id           uuid primary key,
  project_id   uuid not null references public.projects (id) on delete cascade,
  equipment_id uuid references public.equipment (id) on delete cascade,
  issue_id     uuid references public.issues (id) on delete set null,
  category     text not null check (category in ('cover', 'unit', 'tag', 'oa_damper', 'deficiency', 'other')),
  caption      text not null default '',
  mime_type    text not null default 'image/jpeg',
  file_name    text not null default '',
  -- object path in the "photos" bucket: <project_id>/<photo_id>.<ext>
  storage_path text,
  taken_at     timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index photos_project_idx on public.photos (project_id, category);
create index photos_equipment_idx on public.photos (equipment_id);

create table public.instruments (
  id               uuid primary key,
  project_id       uuid not null references public.projects (id) on delete cascade,
  sort_order       integer not null default 0,
  type             text not null default '',
  manufacturer     text not null default '',
  model            text not null default '',
  serial           text not null default '',
  calibration_date text not null default '',  -- ISO date, or '' / N/A notation
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index instruments_project_idx on public.instruments (project_id, sort_order);

-- ------------------------------------------------------------------------------------------ field_changes (sync log)
create table public.field_changes (
  id          uuid primary key,                 -- generated on the device (idempotent re-push)
  server_seq  bigint generated always as identity unique,  -- pull cursor
  project_id  uuid not null,
  table_name  text not null check (table_name in ('projects', 'equipment', 'airflowRows', 'issues', 'photos', 'instruments')),
  record_id   uuid not null,
  op          text not null check (op in ('set', 'create', 'delete')),
  field       text not null default '',          -- dotted app path, e.g. data.serial, naState.fields.fla
  value       jsonb,
  user_id     uuid default auth.uid(),
  device_id   text not null,
  client_ts   bigint not null,                   -- device clock (ms); later edit wins
  received_at timestamptz not null default now(),
  applied     boolean not null default false,    -- false: superseded by a newer edit of the same field, or unknown field
  note        text
);
create index field_changes_project_seq_idx on public.field_changes (project_id, server_seq);
create index field_changes_record_field_idx on public.field_changes (record_id, field, client_ts desc);

-- App key (camelCase, first path segment) -> column, per table. Data, so new fields are rows, not code.
create table public.sync_columns (
  table_name  text not null,  -- app table name
  app_key     text not null,
  column_name text not null,
  kind        text not null check (kind in ('text', 'integer', 'numeric', 'double precision', 'boolean', 'uuid', 'jsonb')),
  primary key (table_name, app_key)
);
insert into public.sync_columns (table_name, app_key, column_name, kind) values
  ('projects', 'name', 'name', 'text'),
  ('projects', 'scopeProfile', 'scope_profile', 'text'),
  ('projects', 'customScope', 'custom_scope', 'jsonb'),
  ('projects', 'tolerance', 'tolerance', 'numeric'),
  ('projects', 'reportKind', 'report_kind', 'text'),
  ('projects', 'info', 'info', 'jsonb'),
  ('projects', 'blueprints', 'blueprints', 'jsonb'),
  ('projects', 'naState', 'na_state', 'jsonb'),
  ('projects', 'templateRevision', 'template_revision', 'text'),
  ('equipment', 'type', 'type', 'text'),
  ('equipment', 'designation', 'designation', 'text'),
  ('equipment', 'slot', 'slot', 'integer'),
  ('equipment', 'isExisting', 'is_existing', 'boolean'),
  ('equipment', 'data', 'data', 'jsonb'),
  ('equipment', 'naState', 'na_state', 'jsonb'),
  ('airflowRows', 'equipmentId', 'equipment_id', 'uuid'),
  ('airflowRows', 'table', 'table_key', 'text'),
  ('airflowRows', 'order', 'sort_order', 'double precision'),
  ('airflowRows', 'data', 'data', 'jsonb'),
  ('airflowRows', 'na', 'na', 'jsonb'),
  ('issues', 'kind', 'kind', 'text'),
  ('issues', 'number', 'number', 'integer'),
  ('issues', 'remark', 'remark', 'text'),
  ('issues', 'status', 'status', 'text'),
  ('issues', 'comments', 'comments', 'text'),
  ('issues', 'equipmentId', 'equipment_id', 'uuid'),
  ('photos', 'equipmentId', 'equipment_id', 'uuid'),
  ('photos', 'issueId', 'issue_id', 'uuid'),
  ('photos', 'category', 'category', 'text'),
  ('photos', 'caption', 'caption', 'text'),
  ('photos', 'mimeType', 'mime_type', 'text'),
  ('photos', 'fileName', 'file_name', 'text'),
  ('photos', 'storagePath', 'storage_path', 'text'),
  ('instruments', 'order', 'sort_order', 'integer'),
  ('instruments', 'type', 'type', 'text'),
  ('instruments', 'manufacturer', 'manufacturer', 'text'),
  ('instruments', 'model', 'model', 'text'),
  ('instruments', 'serial', 'serial', 'text'),
  ('instruments', 'calibrationDate', 'calibration_date', 'text');

create or replace function public.sync_table(app_table text) returns text
language sql immutable as $$
  select case app_table when 'airflowRows' then 'airflow_rows' else app_table end
$$;

-- jsonb_set that creates missing intermediate objects (plain jsonb_set silently does nothing then).
create or replace function public.jsonb_set_deep(target jsonb, path text[], new_value jsonb) returns jsonb
language plpgsql immutable as $$
declare
  i int;
begin
  target := coalesce(target, '{}'::jsonb);
  for i in 1 .. coalesce(array_length(path, 1), 0) - 1 loop
    if jsonb_typeof(target #> path[1:i]) not in ('object', 'array') or target #> path[1:i] is null then
      target := jsonb_set(target, path[1:i], '{}'::jsonb, true);
    end if;
  end loop;
  return jsonb_set(target, path, coalesce(new_value, 'null'::jsonb), true);
end $$;

-- Set one app field path on one record. Returns false for an unknown field.
create or replace function public.apply_set(p_table text, p_record uuid, p_field text, p_value jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  seg text[] := string_to_array(p_field, '.');
  col record;
  tbl text := public.sync_table(p_table);
begin
  select column_name, kind into col from public.sync_columns where table_name = p_table and app_key = seg[1];
  if not found then
    return false;
  end if;
  if array_length(seg, 1) = 1 then
    if col.kind = 'jsonb' then
      execute format('update public.%I set %I = $1, updated_at = now() where id = $2', tbl, col.column_name)
        using coalesce(p_value, 'null'::jsonb), p_record;
    else
      execute format('update public.%I set %I = ($1)::%s, updated_at = now() where id = $2', tbl, col.column_name, col.kind)
        using p_value #>> '{}', p_record;
    end if;
  elsif col.kind = 'jsonb' then
    execute format('update public.%I set %I = public.jsonb_set_deep(%I, $1, $2), updated_at = now() where id = $3',
                   tbl, col.column_name, col.column_name)
      using seg[2:], p_value, p_record;
  else
    return false;  -- a path into a scalar column
  end if;
  return true;
end $$;

-- Applies each pushed change to its record table. BEFORE INSERT, so a batch that creates a project and then
-- its units in one request works row by row. Runs as the owner; the field_changes insert policy is checked
-- right after this trigger, and a failed check rolls the applied change back with the statement.
create or replace function public.apply_field_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tbl text := public.sync_table(new.table_name);
  k text;
  ok boolean := true;
begin
  if new.op = 'delete' then
    execute format('delete from public.%I where id = $1', tbl) using new.record_id;
  elsif new.op = 'create' then
    if new.table_name = 'projects' then
      insert into public.projects (id, org_id) values (new.record_id, public.current_org_id()) on conflict (id) do nothing;
    elsif new.table_name = 'equipment' then
      insert into public.equipment (id, project_id, type, slot)
      values (new.record_id, new.project_id, new.value ->> 'type', coalesce((new.value ->> 'slot')::int, 1))
      on conflict (id) do nothing;
    elsif new.table_name = 'airflowRows' then
      insert into public.airflow_rows (id, project_id, equipment_id, table_key)
      values (new.record_id, new.project_id, (new.value ->> 'equipmentId')::uuid, coalesce(new.value ->> 'table', ''))
      on conflict (id) do nothing;
    elsif new.table_name = 'issues' then
      insert into public.issues (id, project_id, number)
      values (new.record_id, new.project_id, coalesce((new.value ->> 'number')::int, 1))
      on conflict (id) do nothing;
    elsif new.table_name = 'photos' then
      insert into public.photos (id, project_id, category)
      values (new.record_id, new.project_id, coalesce(new.value ->> 'category', 'other'))
      on conflict (id) do nothing;
    else
      execute format('insert into public.%I (id, project_id) values ($1, $2) on conflict (id) do nothing', tbl)
        using new.record_id, new.project_id;
    end if;
    -- then every mapped key of the created record
    for k in select jsonb_object_keys(coalesce(new.value, '{}'::jsonb)) loop
      perform public.apply_set(new.table_name, new.record_id, k, new.value -> k);
    end loop;
  else
    -- last writer wins per record + field (ties broken by device id)
    if exists (
      select 1 from public.field_changes f
      where f.record_id = new.record_id and f.field = new.field and f.op = 'set' and f.id <> new.id
        and (f.client_ts > new.client_ts or (f.client_ts = new.client_ts and f.device_id > new.device_id))
    ) then
      new.applied := false;
      new.note := 'superseded by a newer edit';
      return new;
    end if;
    ok := public.apply_set(new.table_name, new.record_id, new.field, new.value);
  end if;
  new.applied := ok;
  new.note := case when ok then null else 'unknown field' end;
  return new;
end $$;

create trigger field_changes_apply
  before insert on public.field_changes
  for each row execute function public.apply_field_change();

-- ------------------------------------------------------------------------------------------ row-level security
alter table public.organizations enable row level security;
alter table public.profiles      enable row level security;
alter table public.projects      enable row level security;
alter table public.equipment     enable row level security;
alter table public.airflow_rows  enable row level security;
alter table public.issues        enable row level security;
alter table public.photos        enable row level security;
alter table public.instruments   enable row level security;
alter table public.field_changes enable row level security;
alter table public.sync_columns  enable row level security;

-- organizations / profiles: members see their organization and its people; each user edits their own profile
create policy "members read their organization" on public.organizations
  for select to authenticated using (id = public.current_org_id());
create policy "members read profiles in their organization" on public.profiles
  for select to authenticated using (org_id = public.current_org_id());
create policy "users update their own profile" on public.profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and org_id = public.current_org_id());

-- projects: any member of the organization can read and write (all users are equal)
create policy "members read projects" on public.projects
  for select to authenticated using (org_id = public.current_org_id());
create policy "members insert projects" on public.projects
  for insert to authenticated with check (org_id = public.current_org_id());
create policy "members update projects" on public.projects
  for update to authenticated using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
create policy "members delete projects" on public.projects
  for delete to authenticated using (org_id = public.current_org_id());

-- everything that belongs to a project
do $$
declare
  t text;
begin
  foreach t in array array['equipment', 'airflow_rows', 'issues', 'photos', 'instruments'] loop
    execute format('create policy "members read %1$s" on public.%1$I for select to authenticated using (public.can_access_project(project_id))', t);
    execute format('create policy "members insert %1$s" on public.%1$I for insert to authenticated with check (public.can_access_project(project_id))', t);
    execute format('create policy "members update %1$s" on public.%1$I for update to authenticated using (public.can_access_project(project_id)) with check (public.can_access_project(project_id))', t);
    execute format('create policy "members delete %1$s" on public.%1$I for delete to authenticated using (public.can_access_project(project_id))', t);
  end loop;
end $$;

-- field_changes: read the project's log; append (never edit or delete) changes as yourself. The check runs after
-- the BEFORE trigger applied the change, so a project's own "create" passes (the trigger created it in the
-- member's organization). Volatile, so it sees rows the trigger just wrote.
create or replace function public.can_write_project(p uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  return exists (select 1 from public.projects pr where pr.id = p and pr.org_id = public.current_org_id());
end $$;

create policy "members read field changes" on public.field_changes
  for select to authenticated using (public.can_access_project(project_id));
create policy "members append field changes" on public.field_changes
  for insert to authenticated with check (user_id = auth.uid() and public.can_write_project(project_id));

create policy "signed-in users read the sync column map" on public.sync_columns
  for select to authenticated using (true);

-- ------------------------------------------------------------------------------------------ realtime
-- Devices subscribe to new field_changes of the projects they have open (Phase 5).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.field_changes;
  end if;
end $$;

-- ------------------------------------------------------------------------------------------ storage: photos bucket
-- Private bucket; object path "<project_id>/<photo_id>.<ext>". Members of the project's organization can
-- read and write the project's folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 26214400, array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'])
on conflict (id) do nothing;

create or replace function public.can_access_photo_path(object_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  folder text := split_part(object_name, '/', 1);
begin
  if folder !~ '^[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  return public.can_access_project(folder::uuid);
end $$;

create policy "members read project photos" on storage.objects
  for select to authenticated using (bucket_id = 'photos' and public.can_access_photo_path(name));
create policy "members upload project photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos' and public.can_access_photo_path(name));
create policy "members update project photos" on storage.objects
  for update to authenticated using (bucket_id = 'photos' and public.can_access_photo_path(name));
create policy "members delete project photos" on storage.objects
  for delete to authenticated using (bucket_id = 'photos' and public.can_access_photo_path(name));
