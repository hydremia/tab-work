-- Undo 0012: motor photos become 'other' (kept, on their unit), and the category check is the 0001 one again.
update public.photos set category = 'other' where category = 'motor';
alter table public.photos drop constraint if exists photos_category_check;
alter table public.photos add constraint photos_category_check
  check (category in ('cover', 'unit', 'tag', 'oa_damper', 'deficiency', 'other'));
