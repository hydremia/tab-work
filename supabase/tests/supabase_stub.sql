-- Minimal stand-ins for the Supabase auth / storage schemas and roles, so 0001_init.sql can be checked on a
-- plain local PostgreSQL. Test-only: never run this on a Supabase project.
do $$ begin if not exists (select 1 from pg_roles where rolname = $q$authenticated$q$) then create role authenticated nologin; create role anon nologin; end if; end $$;
create schema auth; create schema storage;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema auth, storage to authenticated;
grant execute on function auth.uid() to authenticated;
grant all on storage.objects to authenticated;
-- Supabase's default privileges: everything created in public (tables, functions) is granted to anon and authenticated
-- (functions are also executable by PUBLIC, as in plain PostgreSQL), so a migration must revoke what they must not have.
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
