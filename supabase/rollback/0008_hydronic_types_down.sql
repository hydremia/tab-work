-- Undo 0008: the airside equipment types only. Fails while hydronic units exist (delete them first, or keep 0008).
alter table public.equipment drop constraint if exists equipment_type_check;
alter table public.equipment add constraint equipment_type_check check (type in (
  'rtu', 'mau', 'erv', 'fan', 'smallFan', 'vav', 'hood', 'traverse'
));
