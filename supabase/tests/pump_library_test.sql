-- Tests for 0010_pump_library.sql on plain PostgreSQL (see supabase/README.md "Checking the migrations locally").
-- Run after supabase_stub.sql, 0001 … 0010 and grants_for_stub.sql on an empty database; a clean run ends with
-- "ALL 0010 TESTS PASSED".
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
create function t.lib(id uuid, rec uuid, op text, fld text, val jsonb, ts bigint) returns void language sql as $$
  insert into public.field_changes (id, project_id, table_name, record_id, op, field, value, user_id, device_id, client_ts)
  values (id, rec, 'libraryPumps', rec, op, fld, val, auth.uid(), 'devA', ts)
$$;
grant execute on function t.lib(uuid, uuid, text, text, jsonb, bigint) to authenticated;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select t.lib('00000000-0000-4000-8000-0000000000b1', 'dddddddd-0000-4000-8000-000000000001', 'create', '',
  '{"make":"Test","model":"TP","size":"2x2x9","rpm":1750,"curves":[{"impeller":9,"points":[{"gpm":0,"head":80},{"gpm":200,"head":60}]}],"source":"test data"}',
  1000);
select t.ok('a library pump is created with its curves',
  (select curves -> 0 -> 'points' -> 1 ->> 'head' from public.pump_library) = '60' and (select rpm from public.pump_library) = 1750);
select t.ok('it belongs to the organization',
  (select org_id from public.pump_library) = (select id from public.organizations where name = 'a2b'));
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select t.lib('00000000-0000-4000-8000-0000000000b2', 'dddddddd-0000-4000-8000-000000000001', 'set', 'rpm', '3500', 2000);
select t.ok('a colleague edits it', (select rpm from public.pump_library) = 3500);
select t.ok('members read it', (select count(*) from public.pump_library) = 1);
set request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select t.ok('another organization does not see it', (select count(*) from public.pump_library) = 0);
select t.fails('another organization cannot edit it',
  $$select t.lib('00000000-0000-4000-8000-0000000000b3', 'dddddddd-0000-4000-8000-000000000001', 'set', 'model', '"X"', 3000)$$,
  'another organization');
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select t.fails('a library change must name the pump itself',
  $$insert into public.field_changes (id, project_id, table_name, record_id, op, field, value, user_id, device_id, client_ts)
    values ('00000000-0000-4000-8000-0000000000b4', 'aaaaaaaa-0000-4000-8000-000000000009', 'libraryPumps',
            'dddddddd-0000-4000-8000-000000000001', 'set', 'model', '"Y"', auth.uid(), 'devA', 4000)$$,
  'must name');
select t.fails('members cannot write the table directly',
  $$update public.pump_library set model = 'Z'$$, 'permission denied');
select t.lib('00000000-0000-4000-8000-0000000000b5', 'dddddddd-0000-4000-8000-000000000001', 'delete', '', null, 5000);
select t.ok('deleted', (select count(*) from public.pump_library) = 0);
reset role;
select t.ok('trigger still not callable by members', not has_function_privilege('authenticated', 'public.apply_field_change()', 'execute'));
select t.ok('valve library changes still apply (0009 list kept)',
  position($q$'libraryValves', 'libraryPumps'$q$ in pg_get_functiondef('public.apply_field_change()'::regprocedure)) > 0);
select 'ALL 0010 TESTS PASSED';
