-- Tests for 0006_cert_profile.sql on plain PostgreSQL (see supabase/README.md "Checking the migrations locally").
-- Run after supabase_stub.sql, 0001 … 0006 and grants_for_stub.sql on an empty database. Every check prints
-- "PASS <name>" or stops with "FAIL <name>: ..." (ON_ERROR_STOP), so a clean run ends with "ALL 0006 TESTS PASSED".
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

select t.push('00000000-0000-4000-8000-00000000e001', 'certProfiles', 'cccccccc-0000-4000-8000-00000000c001', 'create', '',
  '{"cpName":"Isaac Rochester","certNumber":"24053","expiration":"2026-12-31","stamp":null,"signature":null}',
  'devA', 1000, 'cccccccc-0000-4000-8000-00000000c001');
select t.ok('profile created in the member''s organization',
  (select org_id from public.cert_profiles) = (select id from public.organizations where name = 'a2b')
  and (select cp_name from public.cert_profiles) = 'Isaac Rochester');
select t.push(gen_random_uuid(), 'certProfiles', 'cccccccc-0000-4000-8000-00000000c001', 'set', 'stamp',
  '{"dataUrl":"data:image/png;base64,iVBORw0KGgo=","width":600,"height":600,"type":"png"}', 'devA', 1001,
  'cccccccc-0000-4000-8000-00000000c001');
select t.ok('stamp image stored', (select stamp ->> 'type' from public.cert_profiles) = 'png'
  and (select (stamp ->> 'width')::int from public.cert_profiles) = 600);

set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select t.push(gen_random_uuid(), 'certProfiles', 'cccccccc-0000-4000-8000-00000000c001', 'set', 'expiration', '"2027-12-31"',
  'devB', 2000, 'cccccccc-0000-4000-8000-00000000c001');
select t.ok('another member edits the profile and reads it', (select expiration from public.cert_profiles) = '2027-12-31'
  and (select count(*) from public.field_changes where table_name = 'certProfiles') = 3);
select t.fails('a profile change must name the profile itself',
  $$select t.push(gen_random_uuid(), 'certProfiles', 'cccccccc-0000-4000-8000-00000000c001', 'set', 'cpName', '"x"', 'devB', 2001,
    'aaaaaaaa-0000-4000-8000-000000000001')$$, 'must name the profile itself');
select t.fails('members cannot write the profile table directly',
  $$update public.cert_profiles set cp_name = 'hacked'$$, 'permission denied');

set request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select t.ok('another organization does not see it', (select count(*) from public.cert_profiles) = 0
  and (select count(*) from public.field_changes where table_name = 'certProfiles') = 0);
select t.fails('another organization cannot edit it',
  $$select t.push(gen_random_uuid(), 'certProfiles', 'cccccccc-0000-4000-8000-00000000c001', 'set', 'cpName', '"x"', 'devX', 3000,
    'cccccccc-0000-4000-8000-00000000c001')$$, 'TAB_FORBIDDEN');

-- earlier rules still hold: the library (0004) and projects
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select t.push(gen_random_uuid(), 'libraryInstruments', 'eeeeeeee-0000-4000-8000-000000000001', 'create', '', '{"type":"Balometer"}',
  'devA', 4000, 'eeeeeeee-0000-4000-8000-000000000001');
select t.ok('library instruments still work', (select type from public.instrument_library) = 'Balometer');
select t.push(gen_random_uuid(), 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'create', '', '{"name":"P1"}', 'devA', 4001,
  'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('projects still work', (select name from public.projects) = 'P1');
select t.push(gen_random_uuid(), 'certProfiles', 'cccccccc-0000-4000-8000-00000000c001', 'delete', '', 'null', 'devA', 5000,
  'cccccccc-0000-4000-8000-00000000c001');
select t.push(gen_random_uuid(), 'certProfiles', 'cccccccc-0000-4000-8000-00000000c001', 'create', '', '{"cpName":"again"}',
  'devA', 5001, 'cccccccc-0000-4000-8000-00000000c001');
select t.ok('a deleted profile is not brought back by a create', (select count(*) from public.cert_profiles) = 0);
-- ------------------------------------------------------------------------------------ review fixes (0006)
select t.fails('a member cannot push a change as the reserved device "server"',
  $$select t.push(gen_random_uuid(), 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'set', 'name', '"P1b"', 'server', 6000,
    'aaaaaaaa-0000-4000-8000-000000000001')$$, 'reserved');
select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'create', '',
  '{"type":"rtu","slot":1,"designation":"RTU-1"}', 'devA', 6001, 'aaaaaaaa-0000-4000-8000-000000000001');
reset role;
create table t.pos as select max(server_seq) as seq from public.field_changes;
grant select on t.pos to authenticated;
set role authenticated;
-- B adds an open issue on RTU-1 that A has not pulled; A's review is refused (and cleared by the server as 'server')
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select t.push(gen_random_uuid(), 'issues', 'dddddddd-0000-4000-8000-000000000001', 'create', '',
  '{"kind":"new","number":1,"status":"Open","equipmentId":"bbbbbbbb-0000-4000-8000-000000000001"}', 'devB', 6100,
  'aaaaaaaa-0000-4000-8000-000000000001', (select seq from t.pos));
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select t.push('00000000-0000-4000-8000-00000000f001', 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'review',
  '{"name":"Ann"}', 'devA', 6200, 'aaaaaaaa-0000-4000-8000-000000000001', (select seq from t.pos));
select t.ok('an issue added on another device refuses the review; the server''s own clear still goes in',
  not (select applied from public.field_changes where id = '00000000-0000-4000-8000-00000000f001')
  and (select count(*) from public.field_changes where device_id = 'server' and field = 'review') = 1);
-- issues still never clear a review (0003)
select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'set', 'review', '{"name":"Ann"}', 'devA', 6300,
  'aaaaaaaa-0000-4000-8000-000000000001', (select max(server_seq) from public.field_changes));
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select t.push(gen_random_uuid(), 'issues', 'dddddddd-0000-4000-8000-000000000001', 'set', 'remark', '"stuck"', 'devB', 6400,
  'aaaaaaaa-0000-4000-8000-000000000001', 1);
select t.ok('an issue edit still does not clear a review', (select jsonb_typeof(review) from public.equipment) = 'object');
select t.ok('issue changes record their unit', (select units from public.field_changes where table_name = 'issues' order by server_seq desc limit 1)
  = array['bbbbbbbb-0000-4000-8000-000000000001']::uuid[]);
reset role;
set role anon;
select t.ok('anon reads nothing of the profile', not has_table_privilege('anon', 'public.cert_profiles', 'select'));
reset role;
select 'ALL 0006 TESTS PASSED';
