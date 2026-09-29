-- Tests for 0007_change_labels.sql on plain PostgreSQL (see supabase/README.md "Checking the migrations locally").
-- Run after supabase_stub.sql, 0001 … 0007 and grants_for_stub.sql on an empty database; a clean run ends with
-- "ALL 0007 TESTS PASSED".
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
update auth.users set raw_user_meta_data = '{"full_name":"Tech One"}' where id = '11111111-1111-4111-8111-111111111111';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
-- the device claims another user's name: ignored, the server sets the signed-in user's
insert into public.field_changes (id, project_id, table_name, record_id, op, field, value, user_id, device_id, client_ts, user_name, device_name)
values ('00000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'projects', 'aaaaaaaa-0000-4000-8000-000000000001',
        'create', '', '{"name":"P1"}', auth.uid(), 'devA', 1000, 'Somebody Else', '  Laptop  ');
select t.ok('user name comes from the sign-in, not the device',
  (select user_name from public.field_changes where id = '00000000-0000-4000-8000-0000000000a1') = 'Tech One');
select t.ok('device name trimmed', (select device_name from public.field_changes where id = '00000000-0000-4000-8000-0000000000a1') = 'Laptop');
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
insert into public.field_changes (id, project_id, table_name, record_id, op, field, value, user_id, device_id, client_ts, device_name)
values ('00000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'projects', 'aaaaaaaa-0000-4000-8000-000000000001',
        'set', 'name', '"P1b"', auth.uid(), 'devB', 2000, repeat('x', 60));
select t.ok('no name in the profile: the email', (select user_name from public.field_changes where id = '00000000-0000-4000-8000-0000000000a2') = 'b@a2b.com');
select t.ok('device name at most 40 characters', (select length(device_name) from public.field_changes where id = '00000000-0000-4000-8000-0000000000a2') = 40);
insert into public.field_changes (id, project_id, table_name, record_id, op, field, value, user_id, device_id, client_ts)
values ('00000000-0000-4000-8000-0000000000a3', 'aaaaaaaa-0000-4000-8000-000000000001', 'projects', 'aaaaaaaa-0000-4000-8000-000000000001',
        'set', 'name', '"P1c"', auth.uid(), 'devB', 3000);
select t.ok('no device name: null', (select device_name from public.field_changes where id = '00000000-0000-4000-8000-0000000000a3') is null);
select t.ok('the change still applies (apply rules untouched)', (select name from public.projects) = 'P1c');
reset role;
select t.ok('label trigger not callable by members', not has_function_privilege('authenticated', 'public.label_field_change()', 'execute'));
select 'ALL 0007 TESTS PASSED';
