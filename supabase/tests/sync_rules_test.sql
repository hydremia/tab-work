-- Tests for 0003_sync_rules.sql on plain PostgreSQL (see supabase/README.md "Checking the migrations locally").
-- Run after supabase_stub.sql, 0001, 0002, 0003 and grants_for_stub.sql on an empty database. Every check prints
-- "PASS <name>" or stops with "FAIL <name>: ..." (ON_ERROR_STOP), so a clean run ends with "ALL SYNC RULE TESTS PASSED".
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- test helpers (owned by the superuser; executed as the test role)
create schema if not exists t;
grant usage on schema t to authenticated, anon;
create function t.ok(name text, cond boolean) returns text language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL %', name; end if;
  return 'PASS ' || name;
end $$;
-- runs a statement that must fail with an error whose message matches `pattern`; nothing it did is kept
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
grant execute on all functions in schema t to authenticated, anon;

-- a change row as JSON -> insert (the app's push: upsert ignoreDuplicates = ON CONFLICT (id) DO NOTHING)
create function t.push(id uuid, tbl text, rec uuid, op text, fld text, val jsonb, dev text, ts bigint,
                       base bigint default null, proj uuid default 'aaaaaaaa-0000-4000-8000-000000000001',
                       usr uuid default null) returns void language sql as $$
  insert into public.field_changes (id, project_id, table_name, record_id, op, field, value, user_id, device_id, client_ts, base_seq)
  values (id, proj, tbl, rec, op, fld, val, coalesce(usr, auth.uid()), dev, ts, base)
  on conflict (id) do nothing
$$;
grant execute on all functions in schema t to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
 ('11111111-1111-4111-8111-111111111111', 'a@a2b.com', '{"full_name":"Tech A"}'),
 ('22222222-2222-4222-8222-222222222222', 'b@a2b.com', '{}');
insert into public.organizations (name) values ('other');
insert into auth.users (id, email) values ('33333333-3333-4333-8333-333333333333', 'x@other.com');
update public.profiles set org_id = (select id from public.organizations where name = 'other')
 where user_id = '33333333-3333-4333-8333-333333333333';

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

-- ------------------------------------------------------------------------------------ project, unit, row by device A
select t.push('00000000-0000-4000-8000-000000000001', 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'create', '',
  '{"name":"Riverside","info":{}}', 'devA', 1000);
select t.push('00000000-0000-4000-8000-000000000002', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'create', '',
  '{"type":"rtu","slot":1,"designation":"RTU-1","data":{}}', 'devA', 1001);
select t.push('00000000-0000-4000-8000-000000000003', 'airflowRows', 'cccccccc-0000-4000-8000-000000000001', 'create', '',
  '{"equipmentId":"bbbbbbbb-0000-4000-8000-000000000001","table":"supply","order":1,"data":{}}', 'devA', 1002);
select t.ok('create project / unit / row', (select count(*) from public.equipment) = 1 and (select count(*) from public.airflow_rows) = 1);
select t.ok('changes carry the organization',
  (select bool_and(org_id = (select id from public.organizations where name = 'a2b')) from public.field_changes));

-- device B renames the unit
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select t.push('00000000-0000-4000-8000-000000000004', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'designation', '"RTU-1A"', 'devB', 2000);

-- ------------------------------------------------------------------------------------ idempotent re-push
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select t.push('00000000-0000-4000-8000-000000000002', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'create', '',
  '{"type":"rtu","slot":1,"designation":"RTU-1","data":{}}', 'devA', 1001);
select t.ok('re-pushed create is not applied again (later rename kept)',
  (select designation from public.equipment) = 'RTU-1A');
select t.ok('re-pushed change is logged once',
  (select count(*) from public.field_changes where id = '00000000-0000-4000-8000-000000000002') = 1);
select t.push('00000000-0000-4000-8000-000000000005', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"SN-1"', 'devA', 2100);
select t.push('00000000-0000-4000-8000-000000000005', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"SN-1"', 'devA', 2100);
select t.ok('re-pushed set logged once', (select count(*) from public.field_changes where id = '00000000-0000-4000-8000-000000000005') = 1);

-- ------------------------------------------------------------------------------------ last writer wins still holds
select t.push('00000000-0000-4000-8000-000000000006', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"SN-OLD"', 'devC', 1500);
select t.ok('older edit arriving later is superseded',
  (select data ->> 'serial' from public.equipment) = 'SN-1'
  and not (select applied from public.field_changes where id = '00000000-0000-4000-8000-000000000006'));

-- ------------------------------------------------------------------------------------ spoofed user, other organization
select t.fails('spoofed user rejected',
  $$select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"spoof"', 'devA', 9000,
     null, 'aaaaaaaa-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222')$$,
  'TAB_FORBIDDEN|row-level security');
set request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select t.ok('other organization sees no projects', (select count(*) from public.projects) = 0);
select t.ok('other organization sees no changes', (select count(*) from public.field_changes) = 0);
select t.fails('other organization cannot edit',
  $$select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"hack"', 'devX', 9000)$$,
  'TAB_FORBIDDEN|row-level security');
select t.fails('other organization cannot lock / unlock',
  $$select t.push(gen_random_uuid(), 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'set', 'lock', 'null', 'devX', 9000)$$,
  'TAB_FORBIDDEN|row-level security');
select t.fails('other organization cannot delete the project',
  $$select t.push(gen_random_uuid(), 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'delete', '', null, 'devX', 9000)$$,
  'TAB_FORBIDDEN|row-level security');
select t.fails('other organization cannot upload into the project folder',
  $$insert into storage.objects (bucket_id, name) values ('photos', 'aaaaaaaa-0000-4000-8000-000000000001/p1.jpg')$$,
  'row-level security');
-- a change filed under the outsider's own project must not reach a record of another project (the trigger runs as
-- the owner, so only its own check stands between the change and the record)
select t.push(gen_random_uuid(), 'projects', 'eeeeeeee-0000-4000-8000-000000000001', 'create', '', '{"name":"Outsider"}', 'devX', 9000,
  null, 'eeeeeeee-0000-4000-8000-000000000001');
select t.fails('other organization cannot edit a record through its own project',
  $$select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"hack"', 'devX', 9000,
     null, 'eeeeeeee-0000-4000-8000-000000000001')$$,
  'TAB_FORBIDDEN');
select t.fails('other organization cannot delete a record through its own project',
  $$select t.push(gen_random_uuid(), 'airflowRows', 'cccccccc-0000-4000-8000-000000000001', 'delete', '', null, 'devX', 9000,
     null, 'eeeeeeee-0000-4000-8000-000000000001')$$,
  'TAB_FORBIDDEN');
select t.fails('other organization cannot edit / delete a project through its own project',
  $$select t.push(gen_random_uuid(), 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'delete', '', null, 'devX', 9000,
     null, 'eeeeeeee-0000-4000-8000-000000000001')$$,
  'TAB_FORBIDDEN');
-- the apply helpers are internal (SECURITY DEFINER, no checks of their own): not callable over the API
select t.fails('apply_set is not callable by a signed-in user',
  $$select public.apply_set('equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'data.serial', '"rpc"')$$,
  'permission denied');
select t.fails('change_units / project_org are not callable by a signed-in user',
  $$select public.change_units('equipment', 'set', 'bbbbbbbb-0000-4000-8000-000000000001', 'x', null), public.project_org('aaaaaaaa-0000-4000-8000-000000000001')$$,
  'permission denied');
reset role;
set role anon;
select t.fails('anon cannot call apply_set',
  $$select public.apply_set('equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'data.serial', '"anon"')$$,
  'permission denied');
select t.fails('anon cannot read records', $$select count(*) from public.projects$$, 'permission denied');
select t.fails('anon cannot read the sync log', $$select count(*) from public.field_changes$$, 'permission denied');
reset role;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
-- records change only through field_changes (the lock, the log and the other devices would not see a direct write)
select t.fails('members cannot write record tables directly',
  $$update public.equipment set data = '{"serial":"direct"}' where id = 'bbbbbbbb-0000-4000-8000-000000000001'$$,
  'permission denied');
select t.fails('members cannot delete projects directly',
  $$delete from public.projects where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  'permission denied');
select t.ok('nothing changed by the rejected writes', (select data ->> 'serial' from public.equipment) = 'SN-1'
  and (select count(*) from public.airflow_rows) = 1 and (select count(*) from public.projects) = 1);

-- ------------------------------------------------------------------------------------ review cleared by the server
-- A reviews RTU-1 (having seen everything so far); B edits the unit offline without knowing the review
select t.push('00000000-0000-4000-8000-000000000010', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'review',
  '{"name":"Kim","userId":"u","deviceId":"devA","at":1}', 'devA', 3000, (select max(server_seq) from public.field_changes));
select t.ok('unit reviewed', (select jsonb_typeof(review) from public.equipment) = 'object');
-- A edits with knowledge of its own review (base_seq >= the review's seq): A clears itself, the server does not
select t.push('00000000-0000-4000-8000-000000000011', 'airflowRows', 'cccccccc-0000-4000-8000-000000000001', 'set', 'data.no', '"S-1"',
  'devA', 3100, (select max(server_seq) from public.field_changes));
select t.ok('change made after seeing the review: no server clear',
  (select count(*) from public.field_changes where device_id = 'server') = 0);
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select t.push('00000000-0000-4000-8000-000000000012', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.model', '"48FC"',
  'devB', 2500, 4);
select t.ok('change made without knowing the review clears it (server change)',
  (select review from public.equipment) = 'null'::jsonb
  and (select count(*) from public.field_changes where device_id = 'server' and field = 'review' and applied) = 1);
select t.ok('server clear is ordered after the change and wins last-writer-wins',
  (select server_seq from public.field_changes where device_id = 'server')
    > (select server_seq from public.field_changes where id = '00000000-0000-4000-8000-000000000012')
  and (select client_ts from public.field_changes where device_id = 'server') > 3000);
-- issues never clear a review
select t.push('00000000-0000-4000-8000-000000000013', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'review',
  '{"name":"Kim","userId":"u","deviceId":"devB","at":2}', 'devB', 3200, (select max(server_seq) from public.field_changes));
select t.push('00000000-0000-4000-8000-000000000014', 'issues', 'dddddddd-0000-4000-8000-000000000001', 'create', '',
  '{"kind":"new","number":1,"remark":"Belt worn","equipmentId":"bbbbbbbb-0000-4000-8000-000000000001"}', 'devB', 3300, 0);
select t.ok('issue on a reviewed unit does not clear the review', (select jsonb_typeof(review) from public.equipment) = 'object');

-- ------------------------------------------------------------------------------------ report lock
select t.push('00000000-0000-4000-8000-000000000020', 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'set', 'lock',
  '{"label":"Prelim","revisionId":null,"name":"Kim","userId":"u","deviceId":"devB","at":1}', 'devB', 4000);
select t.ok('project locked', (select lock ->> 'label' from public.projects) = 'Prelim');
select t.fails('locked project refuses a field edit',
  $$select t.push('00000000-0000-4000-8000-000000000021', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"SN-2"', 'devB', 4100)$$,
  '^TAB_LOCKED: the report was issued as Prelim');
select t.fails('locked project refuses a new unit',
  $$select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000002', 'create', '', '{"type":"rtu","slot":2,"designation":"RTU-2"}', 'devB', 4100)$$,
  '^TAB_LOCKED');
select t.fails('locked project refuses a row delete',
  $$select t.push(gen_random_uuid(), 'airflowRows', 'cccccccc-0000-4000-8000-000000000001', 'delete', '', null, 'devB', 4100)$$,
  '^TAB_LOCKED');
select t.fails('locked project refuses a review',
  $$select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'review', 'null', 'devB', 4100)$$,
  '^TAB_LOCKED');
select t.fails('locked project refuses a project field edit',
  $$select t.push(gen_random_uuid(), 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'set', 'info.architect', '"X"', 'devB', 4100)$$,
  '^TAB_LOCKED');
-- the error detail names the refused change (the app maps it to LockedError and holds that change)
do $$
declare d text;
begin
  perform t.push('00000000-0000-4000-8000-000000000022', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"SN-3"', 'devB', 4200);
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  if (d::jsonb ->> 'change_id') <> '00000000-0000-4000-8000-000000000022' or sqlstate <> 'P0001' then
    raise exception 'FAIL lock error detail: % %', sqlstate, d;
  end if;
end $$;
select 'PASS lock error: SQLSTATE P0001, detail names the refused change';
-- the lock cannot be bypassed by filing the change under another (unlocked) project of the organization
select t.push(gen_random_uuid(), 'projects', 'aaaaaaaa-0000-4000-8000-000000000002', 'create', '', '{"name":"Other job"}', 'devB', 4150,
  null, 'aaaaaaaa-0000-4000-8000-000000000002');
select t.fails('locked project: a change filed under another project is refused',
  $$select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"SN-X"', 'devB', 4160,
     null, 'aaaaaaaa-0000-4000-8000-000000000002')$$,
  'TAB_FORBIDDEN');
select t.push(gen_random_uuid(), 'projects', 'aaaaaaaa-0000-4000-8000-000000000002', 'delete', '', null, 'devB', 4170,
  null, 'aaaaaaaa-0000-4000-8000-000000000002');
select t.ok('nothing of the refused changes was applied or logged',
  (select data ->> 'serial' from public.equipment) = 'SN-1'
  and (select count(*) from public.equipment) = 1
  and (select count(*) from public.field_changes where id in ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000022')) = 0);
-- a retry of a change that was accepted before the lock is harmless (skipped, no error)
select t.push('00000000-0000-4000-8000-000000000005', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"SN-1"', 'devA', 2100);
select 'PASS retry of a change accepted before the lock: skipped without error';
-- the members can still upload / read photos (the lock is about records; the app refuses new photos itself)
insert into storage.objects (bucket_id, name) values ('photos', 'aaaaaaaa-0000-4000-8000-000000000001/p1.jpg');
select t.ok('member uploads into the project folder', (select count(*) from storage.objects) = 1);

-- unlock (any member), then edits work again; unlock + edit in one push (one statement) works row by row
insert into public.field_changes (id, project_id, table_name, record_id, op, field, value, device_id, client_ts) values
 ('00000000-0000-4000-8000-000000000030', 'aaaaaaaa-0000-4000-8000-000000000001', 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'set', 'lock', 'null', 'devB', 5000),
 ('00000000-0000-4000-8000-000000000031', 'aaaaaaaa-0000-4000-8000-000000000001', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"SN-4"', 'devB', 5001)
on conflict (id) do nothing;
select t.ok('unlock then edit works', (select lock from public.projects) = 'null'::jsonb and (select data ->> 'serial' from public.equipment) = 'SN-4');
-- lock again by A, then a whole-project delete is allowed while locked
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select t.push('00000000-0000-4000-8000-000000000032', 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'set', 'lock',
  '{"label":"Rev 1","revisionId":null,"name":"A","userId":"u","deviceId":"devA","at":2}', 'devA', 6000);
select t.push('00000000-0000-4000-8000-000000000040', 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'delete', '', null, 'devA', 7000);
select t.ok('locked project can be deleted as a whole (cascade)',
  (select count(*) from public.projects) = 0 and (select count(*) from public.equipment) = 0
  and (select count(*) from public.airflow_rows) = 0 and (select count(*) from public.issues) = 0);
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select t.ok('other members pull the project delete',
  (select count(*) from public.field_changes where op = 'delete' and table_name = 'projects'
    and record_id = 'aaaaaaaa-0000-4000-8000-000000000001') = 1);
select t.push(gen_random_uuid(), 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'create', '', '{"name":"again"}', 'devB', 8000);
select t.ok('create of a deleted record is logged, not applied',
  (select count(*) from public.projects) = 0
  and (select note from public.field_changes where op = 'create' and table_name = 'projects' and not applied) = 'record was deleted');
-- another organization cannot claim a deleted project's id (that would make its photo folder theirs)
set request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select t.fails('other organization cannot re-create a deleted project of another organization',
  $$select t.push(gen_random_uuid(), 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'create', '', '{"name":"mine now"}', 'devX', 9100)$$,
  'TAB_FORBIDDEN');
select t.fails('other organization cannot upload into a deleted project''s folder',
  $$insert into storage.objects (bucket_id, name) values ('photos', 'aaaaaaaa-0000-4000-8000-000000000001/x.jpg')$$,
  'row-level security');
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
delete from storage.objects where name like 'aaaaaaaa-0000-4000-8000-000000000001/%';
reset role;
select t.ok('photo files of the deleted project can be removed by a member', (select count(*) from storage.objects) = 0);
set role authenticated;
select t.ok('server clock', abs(public.server_time_ms() - (extract(epoch from now()) * 1000)::bigint) < 60000);
reset role;
select 'ALL SYNC RULE TESTS PASSED';
