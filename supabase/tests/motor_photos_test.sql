-- Tests for 0012_motor_photos.sql on plain PostgreSQL (see supabase/README.md "Checking the migrations locally").
-- Run after supabase_stub.sql, 0001 … 0012 and grants_for_stub.sql on an empty database. Every check prints
-- "PASS <name>" or stops with "FAIL <name>: ..." (ON_ERROR_STOP), so a clean run ends with "ALL 0012 TESTS PASSED".
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

insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'a@a2b.com');

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select t.push(gen_random_uuid(), 'projects', 'aaaaaaaa-0000-4000-8000-000000000001', 'create', '', '{"name":"P1"}', 'devA', 1000,
  'aaaaaaaa-0000-4000-8000-000000000001');
select t.push(gen_random_uuid(), 'equipment', 'bbbbbbbb-0000-4000-8000-000000000001', 'create', '',
  '{"type":"rtu","slot":1,"designation":"RTU-1"}', 'devA', 1001, 'aaaaaaaa-0000-4000-8000-000000000001');

-- a motor photo of the unit, and a second unit photo (several photos per slot are just several rows)
select t.push(gen_random_uuid(), 'photos', 'eeeeeeee-0000-4000-8000-000000000001', 'create', '',
  '{"category":"motor","equipmentId":"bbbbbbbb-0000-4000-8000-000000000001"}', 'devA', 2000,
  'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('a motor photo is created', (select category from public.photos
  where id = 'eeeeeeee-0000-4000-8000-000000000001') = 'motor');
select t.push(gen_random_uuid(), 'photos', 'eeeeeeee-0000-4000-8000-000000000002', 'create', '',
  '{"category":"unit","equipmentId":"bbbbbbbb-0000-4000-8000-000000000001"}', 'devA', 2001,
  'aaaaaaaa-0000-4000-8000-000000000001');
select t.push(gen_random_uuid(), 'photos', 'eeeeeeee-0000-4000-8000-000000000003', 'create', '',
  '{"category":"unit","equipmentId":"bbbbbbbb-0000-4000-8000-000000000001"}', 'devA', 2002,
  'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('two unit photos on one unit', (select count(*) from public.photos
  where category = 'unit' and equipment_id = 'bbbbbbbb-0000-4000-8000-000000000001') = 2);
select t.fails('an unknown category is still refused',
  $q$select t.push(gen_random_uuid(), 'photos', 'eeeeeeee-0000-4000-8000-000000000009', 'create', '',
    '{"category":"selfie","equipmentId":"bbbbbbbb-0000-4000-8000-000000000001"}', 'devA', 2003,
    'aaaaaaaa-0000-4000-8000-000000000001')$q$, 'photos_category_check');
reset role;
select 'ALL 0012 TESTS PASSED';
