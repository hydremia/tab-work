-- =====================================================================================================================
-- a2b TAB App: who and which device, readable in every device's history
--
-- The history showed other people's changes as a user id and a device code. Each change now carries:
--  - user_name:   the signed-in user's name (Microsoft "name" / "full_name", else the email), set HERE by the server
--                 from auth.users, never taken from the device (a member can't post changes under another name);
--  - device_name: the name the device was given ("Phone", "Laptop", …), set by the device; trimmed, max 40 characters.
-- A separate BEFORE INSERT trigger (named to run after `field_changes_apply`), so the apply rules are untouched. The
-- server's own changes (device 'server') get the name of the user whose change caused them and no device name.
-- Rollback: rollback/0007_change_labels_down.sql.
-- =====================================================================================================================

alter table public.field_changes add column if not exists user_name   text;
alter table public.field_changes add column if not exists device_name text;

create or replace function public.label_field_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    select coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), nullif(u.raw_user_meta_data ->> 'name', ''), u.email)
      into new.user_name
      from auth.users u where u.id = auth.uid();
  else
    new.user_name := null;
  end if;
  new.device_name := case
    when new.device_id = 'server' then null
    else nullif(left(btrim(coalesce(new.device_name, '')), 40), '')
  end;
  return new;
end $$;

drop trigger if exists field_changes_label on public.field_changes;
create trigger field_changes_label
  before insert on public.field_changes
  for each row execute function public.label_field_change();

revoke execute on function public.label_field_change() from public, anon, authenticated;
