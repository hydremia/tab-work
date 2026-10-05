-- Undo 0013: issueType is no longer synced (the column and its values stay; 0013 re-applies cleanly).
-- Run only once no device uses the app version with observations: its observations would reach the server as deficiencies.
delete from public.sync_columns where table_name = 'issues' and app_key = 'issueType';
