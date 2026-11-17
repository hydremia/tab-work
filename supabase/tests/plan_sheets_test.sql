-- Tests for 0016_plan_sheets.sql on plain PostgreSQL (see supabase/README.md "Checking the migrations locally").
-- Run after supabase_stub.sql, 0001 … 0016 and grants_for_stub.sql on an empty database; a clean run ends with
-- "ALL 0016 TESTS PASSED".
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

insert into auth.users (id, email) values
 ('11111111-1111-4111-8111-111111111111', 'a@a2b.com'),
 ('22222222-2222-4222-8222-222222222222', 'b@a2b.com');
insert into public.organizations (name) values ('other');
insert into auth.users (id, email) values ('33333333-3333-4333-8333-333333333333', 'x@other.com');
update public.profiles set org_id = (select id from public.organizations where name = 'other')
 where user_id = '33333333-3333-4333-8333-333333333333';

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select t.push('00000000-0000-4000-8000-0000000000a1', 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'create', '', '{"name":"Whole Foods DAG"}', 'devA', 1000);
select t.push('00000000-0000-4000-8000-0000000000a2', 'planSheets', 'dddddddd-0000-4000-8000-000000000001', 'create', '',
  '{"projectId":"aaaaaaaa-0000-4000-8000-000000000001","fileName":"M101-plans.pdf","page":1,"pageCount":1,"width":2592,"height":1728,"ocr":false,"devices":[{"key":"d0-0","type":"SR1","size":"12\"x8\"","cfm":290,"x":367,"y":1321,"how":"leader","count":1,"index":0,"tag":{"x":367,"y":1348,"box":{"x0":350,"y0":1330,"x1":384,"y1":1366},"lines":["12\"x8\"","SR1","290 CFM"]}}],"systems":[],"createdAt":1,"updatedAt":1}',
  'devA', 2000);
select t.ok('a plan sheet is created with its devices',
  (select file_name from public.plan_sheets) = 'M101-plans.pdf'
  and (select devices -> 0 ->> 'type' from public.plan_sheets) = 'SR1'
  and (select width from public.plan_sheets) = 2592
  and (select jsonb_array_length(systems) from public.plan_sheets) = 0);
select t.ok('the create is applied', (select applied from public.field_changes where id = '00000000-0000-4000-8000-0000000000a2'));
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select t.push('00000000-0000-4000-8000-0000000000a3', 'planSheets', 'dddddddd-0000-4000-8000-000000000001', 'set', 'systems',
  '[{"id":"s1","equipmentId":"eeeeeeee-0000-4000-8000-000000000001","table":"supply","polygon":[[0,0],[10,0],[10,10]],"deviceKeys":["d0-0"],"color":"#ff809d","prefix":"3","rowIds":{},"createdAt":3}]',
  'devB', 3000);
select t.push('00000000-0000-4000-8000-0000000000a4', 'planSheets', 'dddddddd-0000-4000-8000-000000000001', 'set', 'storagePath',
  '"aaaaaaaa-0000-4000-8000-000000000001/dddddddd-0000-4000-8000-000000000001.pdf"', 'devA', 3500);
select t.ok('a colleague lassos a system; the file path is recorded',
  (select systems -> 0 ->> 'prefix' from public.plan_sheets) = '3'
  and (select storage_path from public.plan_sheets) like 'aaaaaaaa-%/dddddddd-%.pdf');
select t.ok('members read it', (select count(*) from public.plan_sheets) = 1);
set request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select t.ok('another organization does not see it', (select count(*) from public.plan_sheets) = 0);
select t.fails('another organization cannot change it',
  $$select t.push('00000000-0000-4000-8000-0000000000a5', 'planSheets', 'dddddddd-0000-4000-8000-000000000001', 'set', 'fileName', '"x"', 'devX', 4000)$$,
  'another organization');
select t.ok('another organization may not read the sheet file',
  public.can_access_photo_path('aaaaaaaa-0000-4000-8000-000000000001/dddddddd-0000-4000-8000-000000000001.pdf') = false);
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select t.ok('a member of the organization may read the sheet file',
  public.can_access_photo_path('aaaaaaaa-0000-4000-8000-000000000001/dddddddd-0000-4000-8000-000000000001.pdf'));
select t.fails('members cannot write the table directly', $$update public.plan_sheets set file_name = 'Z'$$, 'permission denied');
select t.push('00000000-0000-4000-8000-0000000000a6', 'planSheets', 'dddddddd-0000-4000-8000-000000000001', 'delete', '', null, 'devA', 5000);
select t.ok('deleted', (select count(*) from public.plan_sheets) = 0);
-- a sheet of a deleted project goes with it
select t.push('00000000-0000-4000-8000-0000000000a7', 'planSheets', 'dddddddd-0000-4000-8000-000000000002', 'create', '',
  '{"projectId":"aaaaaaaa-0000-4000-8000-000000000001","fileName":"M101.pdf","page":1,"pageCount":1,"width":1,"height":1,"ocr":false,"devices":[],"systems":[]}', 'devA', 6000);
select t.push('00000000-0000-4000-8000-0000000000a8', 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'delete', '', null, 'devA', 7000);
reset role;
select t.ok('the project delete removes its sheets', (select count(*) from public.plan_sheets) = 0);
select t.ok('the plans bucket is private and takes PDFs only',
  (select not public and allowed_mime_types = array['application/pdf'] from storage.buckets where id = 'plans'));
select t.ok('trigger still not callable by members', not has_function_privilege('authenticated', 'public.apply_field_change()', 'execute'));
select 'ALL 0016 TESTS PASSED';
