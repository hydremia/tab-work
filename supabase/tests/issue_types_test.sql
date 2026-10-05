-- Tests for 0013_issue_types.sql on plain PostgreSQL (see supabase/README.md "Checking the migrations locally").
-- Run after supabase_stub.sql, 0001 … 0013 and grants_for_stub.sql on an empty database. Every check prints
-- "PASS <name>" or stops with "FAIL <name>: ..." (ON_ERROR_STOP), so a clean run ends with "ALL 0013 TESTS PASSED".
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

-- an issue without a type (every app version before observations) is a deficiency
select t.push(gen_random_uuid(), 'issues', 'cccccccc-0000-4000-8000-000000000001', 'create', '',
  '{"kind":"new","number":1,"remark":"Belt worn"}', 'devA', 2000, 'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('an untyped issue is a deficiency', (select issue_type from public.issues
  where id = 'cccccccc-0000-4000-8000-000000000001') = 'deficiency');

-- an observation, numbered 1 next to deficiency 1
select t.push(gen_random_uuid(), 'issues', 'cccccccc-0000-4000-8000-000000000002', 'create', '',
  '{"kind":"new","number":1,"remark":"Filters recently changed","issueType":"observation"}', 'devA', 2001,
  'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('an observation is created', (select issue_type from public.issues
  where id = 'cccccccc-0000-4000-8000-000000000002') = 'observation');

-- a deficiency turned into an observation (and its new number)
select t.push(gen_random_uuid(), 'issues', 'cccccccc-0000-4000-8000-000000000001', 'set', 'issueType', '"observation"',
  'devA', 2002, 'aaaaaaaa-0000-4000-8000-000000000001');
select t.push(gen_random_uuid(), 'issues', 'cccccccc-0000-4000-8000-000000000001', 'set', 'number', '2',
  'devA', 2003, 'aaaaaaaa-0000-4000-8000-000000000001');
select t.ok('the type is set', (select issue_type || number from public.issues
  where id = 'cccccccc-0000-4000-8000-000000000001') = 'observation2');

select t.fails('an unknown type is refused',
  $q$select t.push(gen_random_uuid(), 'issues', 'cccccccc-0000-4000-8000-000000000003', 'create', '',
    '{"kind":"new","number":3,"issueType":"remark"}', 'devA', 2004,
    'aaaaaaaa-0000-4000-8000-000000000001')$q$, 'issues_issue_type_check');
reset role;
select 'ALL 0013 TESTS PASSED';
