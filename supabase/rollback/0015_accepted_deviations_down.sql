-- Undo 0015: acceptance changes (`accepted.<key>` on equipment) are refused again by the apply trigger, because the
-- field is no longer mapped. The column and its data stay, so 0015 re-applies cleanly.
delete from public.sync_columns where table_name = 'equipment' and app_key = 'accepted';
