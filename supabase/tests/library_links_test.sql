-- Tests for 0004_library_links.sql on plain PostgreSQL (see supabase/README.md "Checking the migrations locally").
-- Run after supabase_stub.sql, 0001 … 0004 and grants_for_stub.sql on an empty database. Every check prints
-- "PASS <name>" or stops with "FAIL <name>: ..." (ON_ERROR_STOP), so a clean run ends with "ALL 0004 TESTS PASSED".
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
insert into public.organizations (name) values ('other');
insert into auth.users (id, email) values ('33333333-3333-4333-8333-333333333333', 'x@other.com');
update public.profiles set org_id = (select id from public.organizations where name = 'other')
 where user_id = '33333333-3333-4333-8333-333333333333';

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

-- two projects of the same organization, each with a unit; P2 also has an issue
select t.push(gen_random_uuid(), 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'create', '', '{"name":"P1"}', 'devA', 1000,
  'aaaaaaaa-0000-4000-8000-000000000001');
select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'create', '',
  '{"type":"rtu","slot":1,"designation":"RTU-1"}', 'devA', 1001, 'aaaaaaaa-0000-4000-8000-000000000001');
select t.push(gen_random_uuid(), 'projects', 'aaaaaaaa-0000-4000-8000-000000000002', 'create', '', '{"name":"P2"}', 'devA', 1002,
  'aaaaaaaa-0000-4000-8000-000000000002');
select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000002', 'create', '',
  '{"type":"rtu","slot":1,"designation":"RTU-9"}', 'devA', 1003, 'aaaaaaaa-0000-4000-8000-000000000002');
select t.push(gen_random_uuid(), 'issues', 'dddddddd-0000-4000-8000-000000000002', 'create', '',
  '{"kind":"new","number":1,"remark":"P2 issue"}', 'devA', 1004, 'aaaaaaaa-0000-4000-8000-000000000002');

-- ------------------------------------------------------------------------------------ calibration library
select t.push('00000000-0000-4000-8000-00000000c001', 'libraryInstruments', 'eeeeeeee-0000-4000-8000-000000000001', 'create', '',
  '{"type":"Balometer","manufacturer":"Evergreen","model":"Three Pounder","serial":"2400180B","calibrationDate":"2024-03-14","notes":""}',
  'devA', 2000, 'eeeeeeee-0000-4000-8000-000000000001');
select t.ok('library instrument created in the member''s organization',
  (select org_id from public.instrument_library where id = 'eeeeeeee-0000-4000-8000-000000000001')
    = (select id from public.organizations where name = 'a2b')
  and (select model from public.instrument_library) = 'Three Pounder');
select t.ok('library change carries the organization',
  (select org_id from public.field_changes where id = '00000000-0000-4000-8000-00000000c001')
    = (select id from public.organizations where name = 'a2b'));
select t.push('00000000-0000-4000-8000-00000000c001', 'libraryInstruments', 'eeeeeeee-0000-4000-8000-000000000001', 'create', '',
  '{"type":"X"}', 'devA', 2000, 'eeeeeeee-0000-4000-8000-000000000001');
select t.ok('re-pushed library create is skipped', (select type from public.instrument_library) = 'Balometer'
  and (select count(*) from public.field_changes where id = '00000000-0000-4000-8000-00000000c001') = 1);

set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select t.push(gen_random_uuid(), 'libraryInstruments', 'eeeeeeee-0000-4000-8000-000000000001', 'set', 'calibrationDate',
  '"2026-09-01"', 'devB', 3000, 'eeeeeeee-0000-4000-8000-000000000001');
select t.ok('another member edits the library', (select calibration_date from public.instrument_library) = '2026-09-01');
select t.ok('members read the library and pull its changes',
  (select count(*) from public.instrument_library) = 1
  and (select count(*) from public.field_changes where table_name = 'libraryInstruments') = 2);
select t.fails('a library change must name the instrument itself',
  $$select t.push(gen_random_uuid(), 'libraryInstruments', 'eeeeeeee-0000-4000-8000-000000000001', 'set', 'notes', '"x"', 'devB', 3100,
    'aaaaaaaa-0000-4000-8000-000000000001')$$, 'TAB_FORBIDDEN: a library change must name the instrument itself');
select t.fails('members cannot write the library table directly',
  $$update public.instrument_library set model = 'hacked'$$, 'permission denied');

-- a project row copied from the library keeps the link
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select t.push(gen_random_uuid(), 'instruments', 'ffffffff-0000-4000-8000-000000000001', 'create', '',
  '{"order":0,"type":"Balometer","serial":"2400180B","calibrationDate":"2024-03-14","libraryId":"eeeeeeee-0000-4000-8000-000000000001"}',
  'devA', 4000, 'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('project instrument keeps its own copy and its library link',
  (select library_id from public.instruments) = 'eeeeeeee-0000-4000-8000-000000000001'
  and (select calibration_date from public.instruments) = '2024-03-14');

-- another organization
set request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select t.ok('another organization does not see the library', (select count(*) from public.instrument_library) = 0
  and (select count(*) from public.field_changes where table_name = 'libraryInstruments') = 0);
select t.fails('another organization cannot edit the library',
  $$select t.push(gen_random_uuid(), 'libraryInstruments', 'eeeeeeee-0000-4000-8000-000000000001', 'set', 'model', '"x"', 'devX', 5000,
    'eeeeeeee-0000-4000-8000-000000000001')$$, 'TAB_FORBIDDEN');
select t.fails('another organization cannot re-create the library id',
  $$select t.push(gen_random_uuid(), 'libraryInstruments', 'eeeeeeee-0000-4000-8000-000000000001', 'create', '', '{"type":"x"}', 'devX', 5001,
    'eeeeeeee-0000-4000-8000-000000000001')$$, 'TAB_FORBIDDEN');
select t.push(gen_random_uuid(), 'libraryInstruments', 'eeeeeeee-0000-4000-8000-000000000009', 'create', '', '{"type":"Their meter"}',
  'devX', 5002, 'eeeeeeee-0000-4000-8000-000000000009');
select t.ok('the other organization has its own library', (select count(*) from public.instrument_library) = 1);

-- ------------------------------------------------------------------------------------ link checks
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select t.fails('libraryId of another organization''s instrument is refused',
  $$select t.push(gen_random_uuid(), 'instruments', 'ffffffff-0000-4000-8000-000000000001', 'set', 'libraryId',
    '"eeeeeeee-0000-4000-8000-000000000009"', 'devA', 6000, 'aaaaaaaa-0000-4000-8000-000000000001')$$,
  'TAB_FORBIDDEN: libraryId names a library instrument of another organization');
select t.fails('an issue cannot link a unit of another project (create)',
  $$select t.push(gen_random_uuid(), 'issues', 'dddddddd-0000-4000-8000-000000000001', 'create', '',
    '{"kind":"new","number":1,"equipmentId":"bbbbbbbb-0000-4000-8000-000000000002"}', 'devA', 6001, 'aaaaaaaa-0000-4000-8000-000000000001')$$,
  'TAB_FORBIDDEN: equipmentId names a record of another project');
select t.push(gen_random_uuid(), 'issues', 'dddddddd-0000-4000-8000-000000000001', 'create', '',
  '{"kind":"new","number":1,"equipmentId":"bbbbbbbb-0000-4000-8000-000000000001"}', 'devA', 6002, 'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('an issue links a unit of its own project',
  (select equipment_id from public.issues where id = 'dddddddd-0000-4000-8000-000000000001') = 'bbbbbbbb-0000-4000-8000-000000000001');
select t.fails('an issue cannot be re-linked to a unit of another project (set)',
  $$select t.push(gen_random_uuid(), 'issues', 'dddddddd-0000-4000-8000-000000000001', 'set', 'equipmentId',
    '"bbbbbbbb-0000-4000-8000-000000000002"', 'devA', 6003, 'aaaaaaaa-0000-4000-8000-000000000001')$$,
  'TAB_FORBIDDEN: equipmentId names a record of another project');
select t.fails('an outlet row cannot hang under a unit of another project',
  $$select t.push(gen_random_uuid(), 'airflowRows', 'cccccccc-0000-4000-8000-000000000001', 'create', '',
    '{"equipmentId":"bbbbbbbb-0000-4000-8000-000000000002","table":"supply","order":1}', 'devA', 6004, 'aaaaaaaa-0000-4000-8000-000000000001')$$,
  'TAB_FORBIDDEN: equipmentId names a record of another project');
select t.fails('a deficiency photo cannot link an issue of another project',
  $$select t.push(gen_random_uuid(), 'photos', '99999999-0000-4000-8000-000000000001', 'create', '',
    '{"category":"deficiency","equipmentId":null,"issueId":"dddddddd-0000-4000-8000-000000000002"}', 'devA', 6005,
    'aaaaaaaa-0000-4000-8000-000000000001')$$,
  'TAB_FORBIDDEN: issueId names a record of another project');
select t.push(gen_random_uuid(), 'photos', '99999999-0000-4000-8000-000000000001', 'create', '',
  '{"category":"deficiency","equipmentId":null,"issueId":"dddddddd-0000-4000-8000-000000000001"}', 'devA', 6006,
  'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('a deficiency photo links an issue of its own project',
  (select issue_id from public.photos) = 'dddddddd-0000-4000-8000-000000000001');
select t.ok('nothing of the refused changes was applied or logged',
  (select count(*) from public.airflow_rows) = 0
  and (select count(*) from public.field_changes where client_ts in (6000, 6001, 6003, 6004, 6005)) = 0);

-- ------------------------------------------------------------------------------------ slot move note, library delete
select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'slot', '2', 'devA', 7000,
  'aaaaaaaa-0000-4000-8000-000000000001');
select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'slotMove',
  '{"from":1,"to":2,"otherId":"bbbbbbbb-0000-4000-8000-000000000003"}', 'devA', 7001, 'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('slot move and its note are stored',
  (select slot from public.equipment where id = 'bbbbbbbb-0000-4000-8000-000000000001') = 2
  and (select slot_move ->> 'from' from public.equipment where id = 'bbbbbbbb-0000-4000-8000-000000000001') = '1');
select t.push(gen_random_uuid(), 'libraryInstruments', 'eeeeeeee-0000-4000-8000-000000000001', 'delete', '', null, 'devA', 8000,
  'eeeeeeee-0000-4000-8000-000000000001');
select t.ok('library instrument deleted; the project copy stays',
  (select count(*) from public.instrument_library) = 0 and (select count(*) from public.instruments) = 1);
select t.push(gen_random_uuid(), 'libraryInstruments', 'eeeeeeee-0000-4000-8000-000000000001', 'create', '', '{"type":"again"}', 'devB', 8100,
  'eeeeeeee-0000-4000-8000-000000000001');
select t.ok('a deleted library instrument is not brought back by a create',
  (select count(*) from public.instrument_library) = 0);
select t.fails('a lock still refuses edits (0003 rules kept)',
  $$select t.push(gen_random_uuid(), 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'set', 'lock',
      '{"label":"Prelim"}', 'devA', 9000, 'aaaaaaaa-0000-4000-8000-000000000001');
    select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"x"', 'devA', 9001,
      'aaaaaaaa-0000-4000-8000-000000000001')$$, 'TAB_LOCKED');
reset role;
set role anon;
select t.ok('anon reads nothing of the library', not has_table_privilege('anon', 'public.instrument_library', 'select'));
reset role;
select t.ok('link helper not callable by members', not has_function_privilege('authenticated', 'public.change_links(text, text, jsonb)', 'execute'));
select 'ALL 0004 TESTS PASSED';
