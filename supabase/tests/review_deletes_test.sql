-- Tests for 0005_review_deletes.sql on plain PostgreSQL (see supabase/README.md "Checking the migrations locally").
-- Run after supabase_stub.sql, 0001 … 0005 and grants_for_stub.sql on an empty database. Every check prints
-- "PASS <name>" or stops with "FAIL <name>: ..." (ON_ERROR_STOP), so a clean run ends with "ALL 0005 TESTS PASSED".
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

select t.ok('changes record the unit they touched',
  (select units from public.field_changes where table_name = 'airflowRows') = array['bbbbbbbb-0000-4000-8000-000000000001']::uuid[]
  and (select count(*) from public.field_changes where table_name = 'projects' and units = '{}') = 1);

-- ------------------------------------------------------------------------------------ review of what A saw
-- A has pulled everything (base = current max seq) and reviews RTU-1: accepted
select t.push('00000000-0000-4000-8000-00000000a001', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'review',
  '{"name":"Ann","at":2000}', 'devA', 2000, 'aaaaaaaa-0000-4000-8000-000000000001',
  (select max(server_seq) from public.field_changes));
select t.ok('review of the data the reviewer saw is applied',
  (select jsonb_typeof(review) from public.equipment where id = 'bbbbbbbb-0000-4000-8000-000000000001') = 'object'
  and (select applied from public.field_changes where id = '00000000-0000-4000-8000-00000000a001'));
-- clear it again (A, knowing its review)
select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'review', 'null', 'devA', 2001,
  'aaaaaaaa-0000-4000-8000-000000000001', (select max(server_seq) from public.field_changes));

-- A's pull position before B's edit
reset role;
create table t.pos as select max(server_seq) as seq from public.field_changes;
grant select on t.pos to authenticated;
set role authenticated;

-- B blanks a reading of RTU-1 (an outlet row) that A has not pulled
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select t.push(gen_random_uuid(), 'airflowRows', 'cccccccc-0000-4000-8000-000000000001', 'set', 'data.final', 'null', 'devB', 3000,
  'aaaaaaaa-0000-4000-8000-000000000001', (select max(server_seq) from public.field_changes));

-- A reviews RTU-1 without having pulled B's change: refused, answered by a server clear
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select t.push('00000000-0000-4000-8000-00000000a002', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'review',
  '{"name":"Ann","at":3100}', 'devA', 3100, 'aaaaaaaa-0000-4000-8000-000000000001', (select seq from t.pos));
select t.ok('stale review is kept in the log but not applied',
  (select not applied and note like 'review refused%' from public.field_changes where id = '00000000-0000-4000-8000-00000000a002')
  and (select review from public.equipment where id = 'bbbbbbbb-0000-4000-8000-000000000001') = 'null'::jsonb);
select t.ok('server answers a stale review with a clear that wins on every device',
  (select count(*) from public.field_changes f
    where f.device_id = 'server' and f.field = 'review' and f.record_id = 'bbbbbbbb-0000-4000-8000-000000000001'
      and f.value = 'null'::jsonb and f.client_ts > 3100 and f.applied and f.note like 'automatic: %'
      and f.server_seq > (select server_seq from public.field_changes where id = '00000000-0000-4000-8000-00000000a002')) = 1);
-- the stale review of RTU-1 does not concern RTU-2 (B's change touched RTU-1 only)
select t.push('00000000-0000-4000-8000-00000000a003', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000002', 'set', 'review',
  '{"name":"Ann","at":3200}', 'devA', 3200, 'aaaaaaaa-0000-4000-8000-000000000001', (select seq from t.pos));
select t.ok('another unit''s changes do not refuse a review',
  (select applied from public.field_changes where id = '00000000-0000-4000-8000-00000000a003')
  and (select jsonb_typeof(review) from public.equipment where id = 'bbbbbbbb-0000-4000-8000-000000000002') = 'object');
-- the reviewer's own unpulled-by-others edits never refuse its review
select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000002', 'set', 'review', 'null', 'devA', 3201,
  'aaaaaaaa-0000-4000-8000-000000000001', (select max(server_seq) from public.field_changes));
select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000002', 'set', 'data.serial', '"S1"', 'devA', 3202,
  'aaaaaaaa-0000-4000-8000-000000000001', (select seq from t.pos));
select t.push('00000000-0000-4000-8000-00000000a004', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000002', 'set', 'review',
  '{"name":"Ann","at":3300}', 'devA', 3300, 'aaaaaaaa-0000-4000-8000-000000000001', (select seq from t.pos));
select t.ok('the reviewer''s own edits do not refuse its review',
  (select applied from public.field_changes where id = '00000000-0000-4000-8000-00000000a004'));
-- after pulling B's change (base past it) A can review RTU-1
select t.push('00000000-0000-4000-8000-00000000a005', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'review',
  '{"name":"Ann","at":3400}', 'devA', 3400, 'aaaaaaaa-0000-4000-8000-000000000001',
  (select max(server_seq) from public.field_changes));
select t.ok('review after pulling the other device''s change is applied',
  (select applied from public.field_changes where id = '00000000-0000-4000-8000-00000000a005')
  and (select jsonb_typeof(review) from public.equipment where id = 'bbbbbbbb-0000-4000-8000-000000000001') = 'object');
-- a review without a pull position (base_seq unknown) is refused once another device touched the unit
select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'review', 'null', 'devC', 3500,
  'aaaaaaaa-0000-4000-8000-000000000001', (select max(server_seq) from public.field_changes));
select t.push('00000000-0000-4000-8000-00000000a006', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'review',
  '{"name":"Cy","at":3600}', 'devC', 3600, 'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('review with no pull position is refused', not (select applied from public.field_changes
  where id = '00000000-0000-4000-8000-00000000a006'));

-- ------------------------------------------------------------------------------------ links to deleted records
-- A deletes RTU-2 (and an issue); B, offline, had added an outlet row, a photo and an issue to RTU-2
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select t.push(gen_random_uuid(), 'issues', 'dddddddd-0000-4000-8000-000000000001', 'create', '', '{"kind":"new","number":1}',
  'devA', 5000, 'aaaaaaaa-0000-4000-8000-000000000001', (select max(server_seq) from public.field_changes));
select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000002', 'delete', '', 'null', 'devA', 5001,
  'aaaaaaaa-0000-4000-8000-000000000001', (select max(server_seq) from public.field_changes));
select t.push(gen_random_uuid(), 'issues', 'dddddddd-0000-4000-8000-000000000001', 'delete', '', 'null', 'devA', 5002,
  'aaaaaaaa-0000-4000-8000-000000000001', (select max(server_seq) from public.field_changes));
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select t.push('00000000-0000-4000-8000-00000000d001', 'airflowRows', 'cccccccc-0000-4000-8000-000000000002', 'create', '',
  '{"equipmentId":"bbbbbbbb-0000-4000-8000-000000000002","table":"supply","order":0}', 'devB', 5100,
  'aaaaaaaa-0000-4000-8000-000000000001', 1);
select t.ok('outlet row of a deleted unit: logged, not applied, the push does not fail',
  (select not applied and note like 'links a deleted record%' from public.field_changes where id = '00000000-0000-4000-8000-00000000d001')
  and not exists (select 1 from public.airflow_rows where id = 'cccccccc-0000-4000-8000-000000000002'));
select t.push('00000000-0000-4000-8000-00000000d002', 'photos', '99999999-0000-4000-8000-000000000001', 'create', '',
  '{"category":"deficiency","equipmentId":null,"issueId":"dddddddd-0000-4000-8000-000000000001","caption":"x"}', 'devB', 5101,
  'aaaaaaaa-0000-4000-8000-000000000001', 1);
select t.ok('photo of a deleted issue is created without the link',
  (select issue_id is null and caption = 'x' from public.photos where id = '99999999-0000-4000-8000-000000000001')
  and (select applied and note = 'created without issueId: it was deleted' from public.field_changes
       where id = '00000000-0000-4000-8000-00000000d002'));
select t.push('00000000-0000-4000-8000-00000000d003', 'issues', 'dddddddd-0000-4000-8000-000000000002', 'create', '',
  '{"kind":"new","number":2,"equipmentId":"bbbbbbbb-0000-4000-8000-000000000002"}', 'devB', 5102,
  'aaaaaaaa-0000-4000-8000-000000000001', 1);
select t.ok('issue on a deleted unit is created as General (no unit)',
  (select equipment_id is null and number = 2 from public.issues where id = 'dddddddd-0000-4000-8000-000000000002'));
select t.push('00000000-0000-4000-8000-00000000d004', 'photos', '99999999-0000-4000-8000-000000000001', 'set', 'equipmentId',
  '"bbbbbbbb-0000-4000-8000-000000000002"', 'devB', 5103, 'aaaaaaaa-0000-4000-8000-000000000001', 1);
select t.ok('moving a photo to a deleted unit is logged, not applied',
  (select not applied from public.field_changes where id = '00000000-0000-4000-8000-00000000d004')
  and (select equipment_id is null from public.photos where id = '99999999-0000-4000-8000-000000000001'));
select t.fails('a link to a unit that never existed still fails on the foreign key',
  $$select t.push(gen_random_uuid(), 'airflowRows', gen_random_uuid(), 'create', '',
      '{"equipmentId":"bbbbbbbb-0000-4000-8000-0000000000ff","table":"supply"}', 'devB', 5104,
      'aaaaaaaa-0000-4000-8000-000000000001', 1)$$, 'foreign key');

-- ------------------------------------------------------------------------------------ earlier rules kept
-- the 0003 rule: B's change made without knowing A's (applied) review clears it
select t.push('00000000-0000-4000-8000-00000000a007', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'review',
  '{"name":"Ann","at":3700}', 'devA', 3700, 'aaaaaaaa-0000-4000-8000-000000000001', (select max(server_seq) from public.field_changes));
reset role;
create table t.pos2 as select max(server_seq) - 1 as seq from public.field_changes;
grant select on t.pos2 to authenticated;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"B"', 'devB', 3800,
  'aaaaaaaa-0000-4000-8000-000000000001', (select seq from t.pos2));
select t.ok('a change made without knowing the review still clears it (0003), and the server says why',
  (select review from public.equipment where id = 'bbbbbbbb-0000-4000-8000-000000000001') = 'null'::jsonb
  and (select note from public.field_changes where device_id = 'server' order by server_seq desc limit 1)
      = 'automatic: the unit changed after it was reviewed');
select t.ok('a member''s own change carries no note', (select count(*) from public.field_changes
  where device_id <> 'server' and applied and note is not null and note not like 'created without %') = 0);
select t.fails('a lock still refuses edits (0003 rules kept)',
  $$select t.push(gen_random_uuid(), 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'set', 'lock',
      '{"label":"Prelim"}', 'devB', 9000, 'aaaaaaaa-0000-4000-8000-000000000001');
    select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'review',
      '{"name":"B"}', 'devB', 9001, 'aaaaaaaa-0000-4000-8000-000000000001', 999999)$$, 'TAB_LOCKED');
select t.fails('members cannot write the units column directly',
  $$update public.field_changes set units = '{}'$$, 'permission denied');
reset role;
select t.ok('apply trigger not callable by members', not has_function_privilege('authenticated', 'public.apply_field_change()', 'execute'));
select 'ALL 0005 TESTS PASSED';
