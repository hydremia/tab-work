-- =====================================================================================================================
-- a2b TAB App: shared certification profile (stamp and signature images)
--
-- The certified professional's details and images, stored once for the organization and used by every export: the
-- stamp is placed in the Certification sheet's stamp box and the signature on its signature line
-- (packages/workbook/src/certImages.ts); new projects take the CP name, number and expiration from it.
--
--  1. `cert_profiles`: an organization record like the calibration library (0004): its changes travel through
--     field_changes (table 'certProfiles') with the profile's own id as project_id; members read it (RLS by
--     organization), nobody writes it directly. The images are small encoded pictures stored in the change log as
--     JSON ({ dataUrl, width, height, type }; the app keeps each under 400 KB), so no storage bucket is involved.
--  2. The apply trigger treats 'certProfiles' like 'libraryInstruments' (organization, "the change names the record
--     itself", create). Every 0003 / 0004 / 0005 rule is unchanged (the whole function is replaced).
--
-- Rollback: rollback/0006_cert_profile_down.sql (back to the 0005 trigger; the table and its data stay).
-- =====================================================================================================================

create table if not exists public.cert_profiles (
  id           uuid primary key,
  org_id       uuid not null references public.organizations (id),
  cp_name      text not null default '',
  cert_number  text not null default '',
  expiration   text not null default '',  -- ISO date or ''
  stamp        jsonb,
  signature    jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists cert_profiles_org_idx on public.cert_profiles (org_id);

alter table public.cert_profiles enable row level security;
drop policy if exists "members read the certification profile" on public.cert_profiles;
create policy "members read the certification profile" on public.cert_profiles
  for select to authenticated using (org_id = public.current_org_id());
-- written only by the apply trigger (as the owner), like the other record tables
revoke all on public.cert_profiles from anon;
revoke insert, update, delete, truncate on public.cert_profiles from authenticated;
grant select on public.cert_profiles to authenticated;

alter table public.field_changes drop constraint if exists field_changes_table_name_check;
alter table public.field_changes add constraint field_changes_table_name_check check (table_name in
  ('projects', 'equipment', 'airflowRows', 'issues', 'photos', 'instruments', 'libraryInstruments', 'certProfiles'));

insert into public.sync_columns (table_name, app_key, column_name, kind) values
  ('certProfiles', 'cpName', 'cp_name', 'text'),
  ('certProfiles', 'certNumber', 'cert_number', 'text'),
  ('certProfiles', 'expiration', 'expiration', 'text'),
  ('certProfiles', 'stamp', 'stamp', 'jsonb'),
  ('certProfiles', 'signature', 'signature', 'jsonb')
on conflict (table_name, app_key) do nothing;

create or replace function public.sync_table(app_table text) returns text
language sql immutable as $$
  select case app_table when 'airflowRows' then 'airflow_rows' when 'libraryInstruments' then 'instrument_library'
    when 'certProfiles' then 'cert_profiles' else app_table end
$$;

-- ------------------------------------------------------------------------------------------ the apply trigger
-- 0005's function with 'certProfiles' handled as an organization record (like 'libraryInstruments').
create or replace function public.apply_field_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tbl text := public.sync_table(new.table_name);
  -- organization records: no project; their changes carry the record's own id as project_id (0004, 0006)
  is_lib boolean := new.table_name in ('libraryInstruments', 'certProfiles');
  k text;
  ok boolean := true;
  n int;
  v_org uuid;
  v_lock jsonb;
  v_found boolean;
  v_units uuid[];
  v_unit uuid;
  v_review_seq bigint;
  v_review_ts bigint;
  v_rec_project uuid;
  v_link record;
  v_link_owner uuid;
  v_dead text[] := '{}';
begin
  -- 1. idempotent re-push: a change already in the log is neither inserted nor applied again
  if exists (select 1 from public.field_changes f where f.id = new.id) then
    return null;
  end if;

  -- 2. who and which organization
  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'TAB_FORBIDDEN: a change must be made as the signed-in user';
  end if;
  if is_lib then
    -- a library instrument / certification profile: its organization, or (deleted) its changes' organization, or
    -- (new) the user's
    v_found := false;
    execute format('select org_id from public.%I where id = $1', tbl) into v_org using new.record_id;
    if v_org is null then
      v_org := public.project_org(new.project_id);
      if v_org is null and new.op = 'create' then
        v_org := public.current_org_id();
      end if;
    end if;
  else
    select pr.org_id, pr.lock into v_org, v_lock from public.projects pr where pr.id = new.project_id;
    v_found := found;
    if not v_found then
      if new.table_name = 'projects' and new.op = 'create' then
        -- a new project is the user's organization's; a deleted one's id stays its organization's
        v_org := coalesce(public.project_org(new.project_id), public.current_org_id());
      else
        v_org := public.project_org(new.project_id);  -- a deleted project: its organization from the log
      end if;
    end if;
  end if;
  if auth.uid() is not null and v_org is distinct from public.current_org_id() then
    raise exception using errcode = '42501', message = 'TAB_FORBIDDEN: the project belongs to another organization';
  end if;
  new.org_id := v_org;
  -- the record must belong to the change's project: the checks above (organization, lock) are about new.project_id,
  -- and this function runs as the owner, so a change filed under one project must not reach another project's record
  if new.table_name = 'projects' then
    if new.record_id is distinct from new.project_id then
      raise exception using errcode = '42501', message = 'TAB_FORBIDDEN: a project change must name the project itself';
    end if;
  elsif is_lib then
    if new.record_id is distinct from new.project_id then
      raise exception using errcode = '42501', message = case when new.table_name = 'certProfiles'
        then 'TAB_FORBIDDEN: a certification profile change must name the profile itself'
        else 'TAB_FORBIDDEN: a library change must name the instrument itself' end;
    end if;
  else
    execute format('select project_id from public.%I where id = $1', tbl) into v_rec_project using new.record_id;
    if v_rec_project is not null and v_rec_project is distinct from new.project_id then
      raise exception using errcode = '42501', message = 'TAB_FORBIDDEN: the record belongs to another project';
    end if;
  end if;
  -- links inside the value: a unit / issue of the same project, a library instrument of the same organization
  for v_link in select * from public.change_links(new.op, new.field, new.value) loop
    if v_link.field = 'libraryId' then
      select l.org_id into v_link_owner from public.instrument_library l where l.id = v_link.target;
      if v_link_owner is not null and v_link_owner is distinct from v_org then
        raise exception using errcode = '42501',
          message = 'TAB_FORBIDDEN: libraryId names a library instrument of another organization';
      end if;
    else
      execute format('select project_id from public.%I where id = $1',
                     case v_link.field when 'equipmentId' then 'equipment' else 'issues' end)
        into v_link_owner using v_link.target;
      if v_link_owner is not null and v_link_owner is distinct from new.project_id then
        raise exception using errcode = '42501',
          message = format('TAB_FORBIDDEN: %s names a record of another project', v_link.field);
      end if;
      -- (0005) a unit / issue another device deleted: see 3c
      if v_link_owner is null
         and exists (select 1 from public.field_changes f where f.record_id = v_link.target and f.op = 'delete') then
        v_dead := array_append(v_dead, v_link.field);
      end if;
    end if;
    v_link_owner := null;
  end loop;

  -- 3. report lock: only the lock itself and deleting the whole project while locked
  if v_found and jsonb_typeof(v_lock) = 'object'
     and not (new.table_name = 'projects' and ((new.op = 'set' and new.field = 'lock') or new.op = 'delete')) then
    raise exception using
      errcode = 'P0001',
      message = format('TAB_LOCKED: the report was issued as %s; unlock the project to edit.', coalesce(v_lock ->> 'label', '?')),
      detail = json_build_object('change_id', new.id, 'project_id', new.project_id, 'lock', v_lock)::text,
      hint = 'TAB_LOCKED';
  end if;

  v_units := public.change_units(new.table_name, new.op, new.record_id, new.field, new.value);
  new.units := v_units;

  -- 3b. a review signs off what the reviewer saw (0005): refused when another device changed the unit (its fields,
  --     rows, photos) after the reviewer's last pull, i.e. the reviewer checked "green" on data that is no longer the
  --     unit's. Kept in the log (applied = false) and answered with a server change clearing the review, so the
  --     reviewing device drops its review too and the unit is reviewed again on the current data.
  if new.table_name = 'equipment' and new.op = 'set' and new.field = 'review' and jsonb_typeof(new.value) = 'object'
     and exists (
       select 1 from public.field_changes f
       where f.project_id = new.project_id and f.applied and f.units @> array[new.record_id]
         and f.device_id <> new.device_id and f.server_seq > coalesce(new.base_seq, 0)
     ) then
    new.applied := false;
    new.note := 'review refused: the unit changed on another device before this review reached the server';
    insert into public.field_changes
      (id, project_id, table_name, record_id, op, field, value, user_id, device_id, client_ts, base_seq, note)
    values
      (gen_random_uuid(), new.project_id, 'equipment', new.record_id, 'set', 'review', 'null'::jsonb, new.user_id,
       'server', new.client_ts + 1, new.server_seq,
       'automatic: the unit changed on another device before the review reached the server; review it again');
    return new;
  end if;

  -- 3c. (0005) a link to a unit / issue another device deleted (made before this device pulled the delete). Before
  --     0005 the foreign key refused it and failed the whole push, again on every sync. Now: an outlet row (it cannot
  --     exist without its unit) and a set of the link are kept in the log, not applied; an issue or photo is created
  --     without the link. The device drops / unlinks them itself when it pulls the delete (app/src/sync/outbox.ts).
  if cardinality(v_dead) > 0 then
    if new.op = 'set' or new.table_name = 'airflowRows' then
      new.applied := false;
      new.note := format('links a deleted record (%s)', array_to_string(v_dead, ', '));
      return new;
    end if;
    new.value := new.value - v_dead;
  end if;

  -- 4. apply
  if new.op = 'delete' then
    execute format('delete from public.%I where id = $1', tbl) using new.record_id;
  elsif new.op = 'create' then
    if exists (select 1 from public.field_changes f where f.record_id = new.record_id and f.op = 'delete') then
      new.applied := false;
      new.note := 'record was deleted';
      return new;
    end if;
    if new.table_name = 'projects' then
      insert into public.projects (id, org_id) values (new.record_id, v_org) on conflict (id) do nothing;
    elsif is_lib then
      execute format('insert into public.%I (id, org_id) values ($1, $2) on conflict (id) do nothing', tbl)
        using new.record_id, v_org;
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
    get diagnostics n = row_count;
    if n = 0 then
      new.applied := false;
      new.note := 'record already exists';
      return new;
    end if;
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
  -- (0005) the server's own changes keep their note (why a review was cleared), shown in the devices' history
  new.note := case when not ok then 'unknown field' when new.device_id = 'server' then new.note
                   when cardinality(v_dead) > 0 then format('created without %s: it was deleted', array_to_string(v_dead, ', '))
              end;

  -- 5. review: a change the device made without knowing the unit's review clears it (server change, pulled by all)
  if ok then
    foreach v_unit in array v_units loop
      if exists (select 1 from public.equipment e where e.id = v_unit and jsonb_typeof(e.review) = 'object') then
        select f.server_seq, f.client_ts into v_review_seq, v_review_ts from public.field_changes f
        where f.record_id = v_unit and f.field = 'review' and f.op = 'set' and f.applied
        order by f.server_seq desc limit 1;
        if new.base_seq is null or v_review_seq is null or new.base_seq < v_review_seq then
          insert into public.field_changes
            (id, project_id, table_name, record_id, op, field, value, user_id, device_id, client_ts, base_seq, note)
          values
            (gen_random_uuid(), new.project_id, 'equipment', v_unit, 'set', 'review', 'null'::jsonb, new.user_id,
             'server', greatest(new.client_ts, coalesce(v_review_ts, 0) + 1), new.server_seq,
             'automatic: the unit changed after it was reviewed');
        end if;
      end if;
    end loop;
  end if;
  return new;
end $$;

-- privileges (as 0003: internals not callable over the API)
revoke execute on function public.apply_field_change() from public, anon, authenticated;
revoke execute on function public.sync_table(text) from public, anon, authenticated;
