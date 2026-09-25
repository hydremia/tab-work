-- =====================================================================================================================
-- Rollback of 0004_library_links.sql: back to the 0003 apply trigger (no library instruments, no link checks).
-- Run in the SQL editor only if 0004 has to be undone. Data is kept: instrument_library, instruments.library_id,
-- equipment.slot_move and the widened field_changes table check stay (unused by the 0003 rules; a library change pushed
-- after the rollback is refused by the 0003 checks, so devices keep those changes until 0004 is applied again).
-- =====================================================================================================================

create or replace function public.sync_table(app_table text) returns text
language sql immutable as $$
  select case app_table when 'airflowRows' then 'airflow_rows' else app_table end
$$;

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
  v_rec_project uuid;
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
      -- a new project is the user's organization's; a deleted one's id stays its organization's
      v_org := coalesce(public.project_org(new.project_id), public.current_org_id());
    else
      v_org := public.project_org(new.project_id);  -- a deleted project: its organization from the log
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
  else
    execute format('select project_id from public.%I where id = $1', tbl) into v_rec_project using new.record_id;
    if v_rec_project is not null and v_rec_project is distinct from new.project_id then
      raise exception using errcode = '42501', message = 'TAB_FORBIDDEN: the record belongs to another project';
    end if;
  end if;

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

drop function if exists public.change_links(text, text, jsonb);
delete from public.sync_columns where table_name = 'libraryInstruments'
  or (table_name = 'instruments' and app_key = 'libraryId') or (table_name = 'equipment' and app_key = 'slotMove');
revoke execute on function public.apply_field_change() from public, anon, authenticated;
revoke execute on function public.sync_table(text) from public, anon, authenticated;
