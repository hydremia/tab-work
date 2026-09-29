-- Tests for 0008_hydronic_types.sql on plain PostgreSQL (see supabase/README.md "Checking the migrations locally").
-- Run after supabase_stub.sql, 0001 … 0008 and grants_for_stub.sql on an empty database; a clean run ends with
-- "ALL 0008 TESTS PASSED".
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
create function t.push(id uuid, tbl text, rec uuid, op text, fld text, val jsonb, dev text, ts bigint) returns void
language sql as $$
  insert into public.field_changes (id, project_id, table_name, record_id, op, field, value, user_id, device_id, client_ts)
  values (id, 'aaaaaaaa-0000-4000-8000-000000000001', tbl, rec, op, fld, val, auth.uid(), dev, ts)
  on conflict (id) do nothing
$$;
grant execute on all functions in schema t to authenticated, anon;

insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'a@a2b.com');
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select t.push('00000000-0000-4000-8000-000000000001', 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'create', '',
  '{"name":"Hydronic","info":{}}', 'devA', 1000);
select t.push('00000000-0000-4000-8000-000000000002', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'create', '',
  '{"type":"pump","slot":1,"designation":"P-1","data":{"system":"CHW","designGpm":200}}', 'devA', 1001);
select t.push('00000000-0000-4000-8000-000000000003', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000002', 'create', '',
  '{"type":"valveSystem","slot":1,"designation":"CHW","data":{}}', 'devA', 1002);
select t.push('00000000-0000-4000-8000-000000000004', 'airflowRows', 'cccccccc-0000-4000-8000-000000000001', 'create', '',
  '{"equipmentId":"bbbbbbbb-0000-4000-8000-000000000002","table":"valves","order":1,"data":{"tag":"CBV-1","designGpm":10}}',
  'devA', 1003);
select t.push('00000000-0000-4000-8000-000000000005', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000003', 'create', '',
  '{"type":"plant","slot":1,"designation":"CH-1","data":{}}', 'devA', 1004);
select t.push('00000000-0000-4000-8000-000000000006', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000004', 'create', '',
  '{"type":"flowMeasurement","slot":1,"designation":"U-1","data":{}}', 'devA', 1005);
select t.ok('pump, valve system, plant and flow reading created',
  (select count(*) from public.equipment where type in ('pump', 'valveSystem', 'plant', 'flowMeasurement')) = 4);
select t.ok('a valve row belongs to its system', (select table_key from public.airflow_rows) = 'valves');
select t.ok('pump data applied', (select data ->> 'system' from public.equipment where designation = 'P-1') = 'CHW');
select t.fails('unknown type still refused',
  $$select t.push('00000000-0000-4000-8000-000000000007', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000005', 'create', '',
    '{"type":"boilerRoom","slot":1,"designation":"X"}', 'devA', 1006)$$, 'equipment_type_check');
select t.push('00000000-0000-4000-8000-000000000008', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000006', 'create', '',
  '{"type":"rtu","slot":1,"designation":"RTU-1"}', 'devA', 1007);
select t.ok('airside types still accepted', (select count(*) from public.equipment where type = 'rtu') = 1);
reset role;
select 'ALL 0008 TESTS PASSED';
