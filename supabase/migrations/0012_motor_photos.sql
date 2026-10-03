-- =====================================================================================================================
-- a2b TAB App: motor photos
--
-- A unit's motor photo (the motor nameplate / label, or the motor itself when it has no visible label, e.g. a direct
-- drive motor) is its own photo category, 'motor', next to unit / tag / OA damper. The category check on
-- public.photos is replaced to allow it; nothing else changes (the category is synced as text). Re-runnable.
--
-- Run this BEFORE the app version with motor photos is used on any device: until then the server refuses a motor
-- photo and that device's pending changes wait.
--
-- Rollback: rollback/0012_motor_photos_down.sql (motor photos become 'other', the old check comes back).
-- =====================================================================================================================

alter table public.photos drop constraint if exists photos_category_check;
alter table public.photos add constraint photos_category_check
  check (category in ('cover', 'unit', 'tag', 'oa_damper', 'motor', 'deficiency', 'other'));
