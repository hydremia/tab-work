-- 0015: accepted deviations (2026-10-20). An out-of-tolerance reading accepted on review is stored on its unit
-- (`equipment.accepted`: airflow row id or 'total' -> {name, userId, deviceId, at, ratio, reason}) and synced like
-- `review`: a field change `accepted.<key>` on the equipment record. The app shows the line amber instead of red and
-- the unit can be reviewed; the export colours the "% of design" cell neutral. Safe to run again.

alter table public.equipment add column if not exists accepted jsonb;

insert into public.sync_columns (table_name, app_key, column_name, kind) values
  ('equipment', 'accepted', 'accepted', 'jsonb')
on conflict (table_name, app_key) do nothing;
