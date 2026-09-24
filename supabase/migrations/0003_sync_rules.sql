-- =====================================================================================================================
-- a2b TAB App: server-side sync rules (Phase 5)
--
-- Replaces the field_changes apply trigger of 0001 so the server enforces what every device's repository enforces
-- (app/src/data/repo.ts), and fixes three problems found while testing the sync engine against a fake server and
-- this schema on PostgreSQL 16 (supabase/tests/sync_rules_test.sql):
--
--  1. Idempotent re-push. The app pushes with `upsert(..., { ignoreDuplicates: true })` (INSERT ... ON CONFLICT (id)
--     DO NOTHING). PostgreSQL fires BEFORE INSERT row triggers *before* the conflict check, so a retried push
--     (response lost, the device sends the same changes again) re-applied them: a retried "create" put the record
--     back to its created values (undoing later edits by other devices) and a retried create after a delete brought
--     the record back. Now the trigger skips a change whose id is already in the log (returns NULL: nothing
--     inserted, nothing applied). The change id, generated on the device, is the idempotency key.
--  2. Deleting a project could never sync: the insert policy (can_write_project) ran after the trigger had deleted
--     the project, found no project and rejected the row. Changes now carry the organization (`org_id`, set by the
--     trigger from the project, or from the project's earlier changes once it is gone); the policies check that.
--     This also lets other devices pull the project delete (the old read policy hid every change of a deleted
--     project).
--  3. Report lock. While a project is locked (`projects.lock` is an object) the trigger refuses every change to the
--     project's records except setting / clearing the lock itself and deleting the whole project, exactly like the
--     device repository. The error is SQLSTATE P0001 with message "TAB_LOCKED: ...", hint "TAB_LOCKED" and a JSON
--     detail {"change_id", "project_id", "lock"}; the app maps it to its LockedError and holds that change on the
--     device until the project is unlocked (app/src/sync/engine.ts).
--
-- Also:
--  - review clearing, consistent with the devices: a device that changes a reviewed unit clears the review itself
--    (same transaction, synced). When a change reaches the server for a unit that is reviewed and the device did
--    not know about that review yet (its base_seq is older than the review's server_seq, or unknown), the server
--    clears the review with a change of its own (device_id 'server'), which every device pulls. Issues and
--    project-level changes never clear a review (as on the devices).
--  - base_seq: the device's pull cursor when the change was made (what it had seen). Used for the review rule above
--    and by the devices to tell a real conflict (two devices edited the same field without seeing each other's edit)
--    from a normal later edit.
--  - server_time_ms(): the server clock, so devices can measure their clock offset (ordering uses server-corrected
--    client timestamps; see app/README.md "Sync").
--  - a created record is never created twice (a create for an existing id, or for a record that was deleted, is
--    kept in the log with applied = false instead of overwriting the record).
--  - explicit checks with clear errors: a change must be made as the signed-in user, in the user's organization
--    (RLS still checks both as well).
--  - photo files of a deleted project can still be read / removed by members of its organization.
-- =====================================================================================================================

alter table public.field_changes add column if not exists org_id   uuid references public.organizations (id);
alter table public.field_changes add column if not exists base_seq bigint;

update public.field_changes f set org_id = p.org_id from public.projects p where p.id = f.project_id and f.org_id is null;

create index if not exists field_changes_org_seq_idx on public.field_changes (org_id, server_seq);
create index if not exists field_changes_record_op_idx on public.field_changes (record_id, op);

-- The organization a project belongs to, or belonged to before it was deleted (from its changes).
create or replace function public.project_org(p uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select org_id from public.projects where id = p),
    (select org_id from public.field_changes where project_id = p and org_id is not null limit 1)
  )
$$;

-- Server clock in ms since the epoch (clock_timestamp: the real time, not the transaction start).
create or replace function public.server_time_ms() returns bigint
language sql volatile as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint
$$;

-- The unit (equipment id) a change touches, for the review rule (before the change is applied).
create or replace function public.change_units(t text, op text, rec uuid, fld text, val jsonb) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare
  u uuid[] := '{}';
  x uuid;
begin
  if t = 'equipment' then
    if op = 'set' and fld <> 'review' then u := array[rec]; end if;
  elsif t in ('airflowRows', 'photos') then
    if op = 'create' then
      x := nullif(val ->> 'equipmentId', '')::uuid;
      if x is not null then u := array[x]; end if;
    else
      if t = 'airflowRows' then select equipment_id into x from public.airflow_rows where id = rec;
      else select equipment_id into x from public.photos where id = rec;
      end if;
      if x is not null then u := array[x]; end if;
      -- a photo moved to another unit changes that unit too
      if op = 'set' and fld = 'equipmentId' and jsonb_typeof(val) = 'string' then
        u := u || (val #>> '{}')::uuid;
      end if;
    end if;
  end if;
  return u;
end $$;

create or replace function public.apply_field_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tbl text := public.sync_table(new.table_name);
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
begin
  -- 1. idempotent re-push: a change already in the log is neither inserted nor applied again
  if exists (select 1 from public.field_changes f where f.id = new.id) then
    return null;
  end if;

  -- 2. who and which organization
  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'TAB_FORBIDDEN: a change must be made as the signed-in user';
  end if;
  select pr.org_id, pr.lock into v_org, v_lock from public.projects pr where pr.id = new.project_id;
  v_found := found;
  if not v_found then
    if new.table_name = 'projects' and new.op = 'create' then
      v_org := public.current_org_id();
    else
      v_org := public.project_org(new.project_id);  -- a deleted project: its organization from the log
    end if;
  end if;
  if auth.uid() is not null and v_org is distinct from public.current_org_id() then
    raise exception using errcode = '42501', message = 'TAB_FORBIDDEN: the project belongs to another organization';
  end if;
  new.org_id := v_org;

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
  new.note := case when ok then null else 'unknown field' end;

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

-- field_changes: members read and append their organization's log (also the changes of a deleted project)
drop policy if exists "members read field changes" on public.field_changes;
drop policy if exists "members append field changes" on public.field_changes;
create policy "members read field changes" on public.field_changes
  for select to authenticated using (org_id = public.current_org_id());
create policy "members append field changes" on public.field_changes
  for insert to authenticated with check (user_id = auth.uid() and org_id = public.current_org_id());

grant execute on function public.server_time_ms() to authenticated;

-- storage: photo files of a deleted project stay readable / removable by its organization's members (the deleting
-- device removes them after the project delete synced; before this, a deleted project's folder was unreachable)
create or replace function public.can_access_photo_path(object_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  folder text := split_part(object_name, '/', 1);
begin
  if folder !~ '^[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  return public.project_org(folder::uuid) = public.current_org_id();
end $$;
