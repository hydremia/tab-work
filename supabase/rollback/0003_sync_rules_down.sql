-- =====================================================================================================================
-- Rollback of 0003_sync_rules.sql: back to the 0001 / 0002 sync rules (docs/SYNC_SETUP.md "Rollback plan").
-- Run in the SQL editor only if 0003 has to be undone. Data is kept: the extra columns field_changes.org_id / base_seq
-- stay (unused by the old rules); the app keeps working (it measures no clock offset without server_time_ms and the
-- server no longer refuses edits of locked projects: the devices still do).
-- NOTE: the old rules have the bugs 0003 fixed (a retried push can re-apply a create; a project delete cannot sync).
-- The privileges set by 0003 (internal functions not callable over the API, record tables written only through
-- field_changes) and its record / project check in the apply trigger are kept.
-- =====================================================================================================================

-- Applies each pushed change to its record table. BEFORE INSERT, so a batch that creates a project and then
-- its units in one request works row by row. Runs as the owner; the field_changes insert policy is checked
-- right after this trigger, and a failed check rolls the applied change back with the statement.
create or replace function public.apply_field_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tbl text := public.sync_table(new.table_name);
  k text;
  ok boolean := true;
  v_rec_project uuid;
begin
  -- the record must belong to the change's project (the insert policy checks only project_id; kept from 0003)
  if new.table_name = 'projects' then
    if new.record_id is distinct from new.project_id then
      raise exception using errcode = '42501', message = 'TAB_FORBIDDEN: a project change must name the project itself';
    end if;
  else
    execute format('select project_id from public.%I where id = $1', tbl) into v_rec_project using new.record_id;
    if v_rec_project is not null and v_rec_project is distinct from new.project_id then
      raise exception using errcode = '42501', message = 'TAB_FORBIDDEN: the record belongs to another project';
    end if;
  end if;
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

drop policy if exists "members read field changes" on public.field_changes;
drop policy if exists "members append field changes" on public.field_changes;
create policy "members read field changes" on public.field_changes
  for select to authenticated using (public.can_access_project(project_id));
create policy "members append field changes" on public.field_changes
  for insert to authenticated with check (user_id = auth.uid() and public.can_write_project(project_id));

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

drop function if exists public.server_time_ms();
drop function if exists public.change_units(text, text, uuid, text, jsonb);
drop function if exists public.project_org(uuid);
drop index if exists public.field_changes_org_seq_idx;
drop index if exists public.field_changes_record_op_idx;
