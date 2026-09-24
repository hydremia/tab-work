-- Smoke test for 0001_init.sql on plain PostgreSQL (see supabase/README.md "Checking the migration locally").
-- Expected: the sync trigger applies creates / sets / deletes (last writer wins), and RLS rejects the spoofed
-- user_id, the outsider (other organization) and the outsider photo upload with "violates row-level security".
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values
 ('11111111-1111-4111-8111-111111111111', 'a@a2b.com', '{"full_name":"Tech A"}'),
 ('22222222-2222-4222-8222-222222222222', 'b@a2b.com', '{}');
-- an outsider in another org
insert into public.organizations (name) values ('other');
insert into auth.users (id, email) values ('33333333-3333-4333-8333-333333333333', 'x@other.com');
update public.profiles set org_id = (select id from public.organizations where name = 'other') where user_id = '33333333-3333-4333-8333-333333333333';
select user_id, email, display_name from public.profiles order by email;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
-- device A pushes: create project, create equipment, sets
insert into public.field_changes (id, project_id, table_name, record_id, op, field, value, device_id, client_ts) values
 (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'create', '',
   '{"id":"aaaaaaaa-0000-4000-8000-000000000001","name":"Riverside","scopeProfile":"full","customScope":{},"tolerance":0.1,"reportKind":"prelim","info":{"address":"1 Main"},"blueprints":[],"naState":{"sections":{},"fields":{}},"templateRevision":"05","createdAt":1,"updatedAt":1}', 'devA', 1000),
 (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'create', '',
   '{"id":"bbbbbbbb-0000-4000-8000-000000000001","projectId":"aaaaaaaa-0000-4000-8000-000000000001","type":"rtu","designation":"RTU-1","slot":1,"isExisting":false,"data":{"unitType":"RTU"},"naState":{"sections":{},"fields":{}}}', 'devA', 1001),
 (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'airflowRows', 'cccccccc-0000-4000-8000-000000000001', 'create', '',
   '{"id":"cccccccc-0000-4000-8000-000000000001","projectId":"aaaaaaaa-0000-4000-8000-000000000001","equipmentId":"bbbbbbbb-0000-4000-8000-000000000001","table":"supply","order":1,"data":{"no":"S-1"},"na":{}}', 'devA', 1002),
 (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"SN-1"', 'devA', 1003),
 (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'naState.fields.fla', '{"notation":"Not Avail."}', 'devA', 1004),
 (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'set', 'blueprints.0.sheet', '"M-101"', 'devA', 1005),
 (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'set', 'customScope.rtu.static', 'false', 'devA', 1006),
 (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'set', 'tolerance', '0.05', 'devA', 1007),
 (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'designation', '"RTU-1A"', 'devA', 1008),
 (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.nonsense.path', '1', 'devA', 1009);

-- device B (user B) edits the same field later, then an OLDER edit from device C arrives: LWW keeps B's
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
insert into public.field_changes (id, project_id, table_name, record_id, op, field, value, device_id, client_ts) values
 (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"SN-B"', 'devB', 2000),
 (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"SN-OLD"', 'devC', 1500);

select name, info, blueprints, custom_scope, tolerance from public.projects;
select designation, data, na_state from public.equipment;
select table_key, sort_order, data from public.airflow_rows;
select field, value, device_id, applied, note from public.field_changes order by server_seq;

-- user B cannot append as someone else
\set ON_ERROR_STOP off
insert into public.field_changes (id, project_id, table_name, record_id, op, field, value, user_id, device_id, client_ts)
values (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"spoof"', '11111111-1111-4111-8111-111111111111', 'devB', 3000);
-- outsider: sees nothing, cannot write
set request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select 'outsider sees projects:' as t, count(*) from public.projects;
select 'outsider sees changes:' as t, count(*) from public.field_changes;
insert into public.field_changes (id, project_id, table_name, record_id, op, field, value, device_id, client_ts)
values (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'data.serial', '"hack"', 'devX', 9000);
insert into storage.objects (bucket_id, name) values ('photos', 'aaaaaaaa-0000-4000-8000-000000000001/p1.jpg');
-- member: can upload into the project folder
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
insert into storage.objects (bucket_id, name) values ('photos', 'aaaaaaaa-0000-4000-8000-000000000001/p1.jpg');
select 'member sees photos:' as t, count(*) from storage.objects;
-- delete cascades
insert into public.field_changes (id, project_id, table_name, record_id, op, field, value, device_id, client_ts) values
 (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'delete', '', null, 'devB', 4000);
select 'after delete: equipment' as t, count(*) from public.equipment;
select 'after delete: rows' as t, count(*) from public.airflow_rows;
reset role;
select serial from (select data->>'serial' as serial from public.equipment) x;
