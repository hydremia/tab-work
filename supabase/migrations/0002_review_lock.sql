-- Phase 6 (reporting workflow): review sign-off per unit and the report lock per project.
-- Both are ordinary synced fields in the app (setField -> field_changes); these columns let the server-side record
-- tables keep them too (without them apply_set() ignores the keys; other devices still get them from field_changes).
--   equipment.review: { name, userId, deviceId, at } | null   (cleared by the app whenever the unit changes)
--   projects.lock:    { label, revisionId, name, userId, deviceId, at } | null   (set by "Issue report")
-- The lock is enforced by the app's repository on every device; the server does not refuse writes to a locked
-- project (all users have equal permissions, and unlocking is itself a synced edit).

alter table public.equipment add column if not exists review jsonb;
alter table public.projects  add column if not exists lock   jsonb;

insert into public.sync_columns (table_name, app_key, column_name, kind) values
  ('equipment', 'review', 'review', 'jsonb'),
  ('projects',  'lock',   'lock',   'jsonb')
on conflict (table_name, app_key) do nothing;
