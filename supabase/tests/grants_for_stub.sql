-- Kept for the documented command line; the Supabase default privileges are now modelled in supabase_stub.sql
-- (default privileges, applied as each object is created, so the migrations' revokes take effect as on Supabase).
grant usage on schema public to authenticated;
