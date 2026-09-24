-- Grants that a real Supabase project gives by default (default privileges). Test-only, after the migration.
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
