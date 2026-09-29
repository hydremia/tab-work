-- Tests for 0011_row_links.sql on plain PostgreSQL (see supabase/README.md "Checking the migrations locally").
-- Run after supabase_stub.sql, 0001 … 0011 and grants_for_stub.sql on an empty database. Every check prints
-- "PASS <name>" or stops with "FAIL <name>: ..." (ON_ERROR_STOP), so a clean run ends with "ALL 0011 TESTS PASSED".
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create schema if not exists t;
grant usage on schema t to authenticated, anon;
create function t.ok(name text, cond boolean) returns text language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL %', name; end if;
  return 'PASS ' || name;
end $$;
create function t.fails(name text, stmt text, pattern text) returns text language plpgsql as $$
declare
  msg text;
begin
  begin
    execute stmt;
  exception when others then
    msg := sqlerrm;
    if msg ~* pattern then return 'PASS ' || name || ' (' || msg || ')'; end if;
    raise exception 'FAIL %: wrong error: %', name, msg;
  end;
  raise exception 'FAIL %: no error', name;
end $$;
create function t.push(id uuid, tbl text, rec uuid, op text, fld text, val jsonb, dev text, ts bigint,
                       proj uuid, base bigint default null) returns void language sql as $$
  insert into public.field_changes (id, project_id, table_name, record_id, op, field, value, user_id, device_id, client_ts, base_seq)
  values (id, proj, tbl, rec, op, fld, val, auth.uid(), dev, ts, base)
  on conflict (id) do nothing
$$;
grant execute on all functions in schema t to authenticated, anon;

insert into auth.users (id, email) values
 ('11111111-1111-4111-8111-111111111111', 'a@a2b.com'),
 ('22222222-2222-4222-8222-222222222222', 'b@a2b.com');

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

-- a project with a unit and one outlet row (device A)
select t.push(gen_random_uuid(), 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'create', '', '{"name":"P1"}', 'devA', 1000,
  'aaaaaaaa-0000-4000-8000-000000000001');
select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'create', '',
  '{"type":"rtu","slot":1,"designation":"RTU-1"}', 'devA', 1001, 'aaaaaaaa-0000-4000-8000-000000000001');
select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000002', 'create', '',
  '{"type":"rtu","slot":2,"designation":"RTU-2"}', 'devA', 1002, 'aaaaaaaa-0000-4000-8000-000000000001');
select t.push(gen_random_uuid(), 'airflowRows', 'cccccccc-0000-4000-8000-000000000001', 'create', '',
  '{"equipmentId":"bbbbbbbb-0000-4000-8000-000000000001","table":"supply","order":0,"data":{"design":400}}', 'devA', 1003,
  'aaaaaaaa-0000-4000-8000-000000000001');


-- a second project with its own line
select t.push(gen_random_uuid(), 'projects', 'aaaaaaaa-0000-4000-8000-000000000002', 'create', '', '{"name":"P2"}', 'devA', 1100,
  'aaaaaaaa-0000-4000-8000-000000000002');
select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000009', 'create', '',
  '{"type":"rtu","slot":1,"designation":"RTU-9"}', 'devA', 1101, 'aaaaaaaa-0000-4000-8000-000000000002');
select t.push(gen_random_uuid(), 'airflowRows', 'cccccccc-0000-4000-8000-000000000009', 'create', '',
  '{"equipmentId":"bbbbbbbb-0000-4000-8000-000000000009","table":"supply","order":0,"data":{}}', 'devA', 1102,
  'aaaaaaaa-0000-4000-8000-000000000002');

-- an issue and a photo of line 1
select t.push(gen_random_uuid(), 'issues', 'dddddddd-0000-4000-8000-000000000001', 'create', '',
  '{"kind":"new","number":1,"remark":"damper stuck","equipmentId":"bbbbbbbb-0000-4000-8000-000000000001","airflowRowId":"cccccccc-0000-4000-8000-000000000001"}',
  'devA', 2000, 'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('an issue is created on its line', (select airflow_row_id from public.issues
  where id = 'dddddddd-0000-4000-8000-000000000001') = 'cccccccc-0000-4000-8000-000000000001');
select t.push(gen_random_uuid(), 'photos', 'eeeeeeee-0000-4000-8000-000000000001', 'create', '',
  '{"category":"other","equipmentId":"bbbbbbbb-0000-4000-8000-000000000001","airflowRowId":"cccccccc-0000-4000-8000-000000000001"}',
  'devA', 2001, 'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('a photo is created on its line', (select airflow_row_id from public.photos
  where id = 'eeeeeeee-0000-4000-8000-000000000001') = 'cccccccc-0000-4000-8000-000000000001');
select t.push(gen_random_uuid(), 'issues', 'dddddddd-0000-4000-8000-000000000001', 'set', 'airflowRowId', 'null', 'devA', 2002, 'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('the line is cleared by a set', (select airflow_row_id from public.issues
  where id = 'dddddddd-0000-4000-8000-000000000001') is null);
select t.push(gen_random_uuid(), 'issues', 'dddddddd-0000-4000-8000-000000000001', 'set', 'airflowRowId',
  '"cccccccc-0000-4000-8000-000000000001"', 'devA', 2003, 'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('and set again', (select airflow_row_id from public.issues
  where id = 'dddddddd-0000-4000-8000-000000000001') = 'cccccccc-0000-4000-8000-000000000001');
select t.fails('a line of another project is refused',
  $$select t.push(gen_random_uuid(), 'issues', 'dddddddd-0000-4000-8000-000000000001', 'set', 'airflowRowId',
    '"cccccccc-0000-4000-8000-000000000009"', 'devA', 2004, 'aaaaaaaa-0000-4000-8000-000000000001')$$,
  'airflowRowId names a record of another project');

-- the line is deleted: the issue and photo stay on the unit
select t.push(gen_random_uuid(), 'airflowRows', 'cccccccc-0000-4000-8000-000000000001', 'delete', '', 'null', 'devA', 3000, 'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('deleting the line unlinks the issue and the photo (they stay on the unit)',
  (select airflow_row_id is null and equipment_id = 'bbbbbbbb-0000-4000-8000-000000000001' from public.issues
    where id = 'dddddddd-0000-4000-8000-000000000001')
  and (select airflow_row_id is null and equipment_id = 'bbbbbbbb-0000-4000-8000-000000000001' from public.photos
    where id = 'eeeeeeee-0000-4000-8000-000000000001'));

-- another device, not knowing: a new issue on the deleted line goes in without it; a set is kept unapplied
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select t.push(gen_random_uuid(), 'issues', 'dddddddd-0000-4000-8000-000000000002', 'create', '',
  '{"kind":"new","number":2,"equipmentId":"bbbbbbbb-0000-4000-8000-000000000001","airflowRowId":"cccccccc-0000-4000-8000-000000000001"}',
  'devB', 3100, 'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('an issue made on a deleted line is created on its unit',
  (select airflow_row_id is null and equipment_id = 'bbbbbbbb-0000-4000-8000-000000000001' from public.issues
    where id = 'dddddddd-0000-4000-8000-000000000002')
  and (select note from public.field_changes where record_id = 'dddddddd-0000-4000-8000-000000000002') like '%airflowRowId%');
select t.push('00000000-0000-4000-8000-00000000b001', 'photos', 'eeeeeeee-0000-4000-8000-000000000001', 'set', 'airflowRowId',
  '"cccccccc-0000-4000-8000-000000000001"', 'devB', 3101, 'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('a set of the deleted line is logged, not applied',
  (select not applied from public.field_changes where id = '00000000-0000-4000-8000-00000000b001')
  and (select airflow_row_id from public.photos where id = 'eeeeeeee-0000-4000-8000-000000000001') is null);
reset role;
select t.ok('synced as airflowRowId', (select count(*) from public.sync_columns where app_key = 'airflowRowId') = 2);
select 'ALL 0011 TESTS PASSED';
