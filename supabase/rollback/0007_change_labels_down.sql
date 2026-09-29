-- Rollback of 0007_change_labels.sql: no more names on new changes (the columns and the names already stored stay).
drop trigger if exists field_changes_label on public.field_changes;
drop function if exists public.label_field_change();
