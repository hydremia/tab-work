# Admin runbook: setting up a technician for the multi-user pilot

For the a2b admin: the person who owns the Microsoft 365, Supabase and Vercel accounts. Use it this week to get
**you and one technician working the same project from two devices**. Cloud sync is already live on the
tab-app-test project; it covers the one step left there, adding the technician, preparing the project and the
first site day. It also covers adding or removing
people later.

The technician's own guide is **[guide/NEW_TECH.md](./guide/NEW_TECH.md)**. Send them that link once Part B is done.

| Part | What | Who | Time |
|---|---|---|---|
| [A](#part-a-finish-the-cloud-setup) | Finish the cloud setup: apply migration 0014, confirm | you | 15 minutes |
| [B](#part-b-add-the-technician) | Add the technician | you | 10 minutes |
| [C](#part-c-prepare-the-pilot-project) | Prepare the pilot project | you | 30–60 minutes |
| [D](#part-d-day-one-on-site-with-the-technician) | Day one on site | you + the tech | 15 minutes at the start |
| [E](#part-e-later-adding-and-removing-people) | Later: adding and removing people | you | 5 minutes each |
| [F](#part-f-if-sync-isnt-ready-in-time) | If sync isn't ready in time | you | n/a |

---

## Part A: finish the cloud setup

Cloud sync is already live on the **tab-app-test** Supabase project, the pilot environment. Status as checked on
Oct 9, 2026:

| Piece | Status |
|---|---|
| Supabase project | Done: **tab-app-test** |
| Database migrations 0001–0013 | Done |
| Migration 0014 (unit configuration library) | **To do** |
| Photos bucket (private) | Done |
| Microsoft sign-in (Entra app + Supabase Azure provider) | Done: two people have signed in with Microsoft |
| Vercel settings (the app pointed at tab-app-test) | Confirm: the pilot app's pill shows a cloud icon and your initials, not *Local* |

- [ ] **Apply migration 0014** before anyone uses the unit configuration library. Until it is applied the server
      refuses library changes, so a device that adds or edits a unit configuration (including *Add the researched
      product lines*) can get stuck with a sync error. Supabase → SQL Editor → New query → paste all of
      `supabase/migrations/0014_unit_library.sql` → **Run** (safe to run again).
- [ ] **Re-run the check query** below: every row should say *ok*, with 83 mapped sync fields.
- [ ] **Confirm the pill** on the pilot app shows a cloud icon and your initials.
- [ ] **Calendar the Entra client secret expiry** (Entra → App registrations → TAB App → Certificates & secrets), if
      it isn't already. When it lapses, nobody can sign in.
- [ ] Optional: a quick two-device check on a throw-away project (a unit added on your phone appears on your laptop
      within 30 seconds; a photo comes across), then delete it.

The check query (Supabase → SQL Editor; read-only, also in [supabase/verify_setup.sql](../supabase/verify_setup.sql)):

```sql
select check_name, result,
       case when result = expected then 'ok' else 'MISSING / CHECK' end as status,
       expected
from (values
  ('0001 tables + sync log',       (to_regclass('public.field_changes') is not null)::text, 'true'),
  ('0001 photos bucket private',   (select coalesce(bool_and(not public), false)::text from storage.buckets where id = 'photos'), 'true'),
  ('0001 organization a2b',        (select count(*)::text from public.organizations where name = 'a2b'), '1'),
  ('0002 review/lock columns',     (select (count(*) > 0)::text from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name like 'lock%'), 'true'),
  ('0003 server clock',            (to_regprocedure('public.server_time_ms()') is not null)::text, 'true'),
  ('0005 field_changes.units',     (select count(*)::text from information_schema.columns where table_name = 'field_changes' and column_name = 'units'), '1'),
  ('0006 cert_profiles',           (to_regclass('public.cert_profiles') is not null)::text, 'true'),
  ('0007 device_name',             (select count(*)::text from information_schema.columns where table_name = 'field_changes' and column_name = 'device_name'), '1'),
  ('0008 hydronic types',          (select coalesce(bool_or(pg_get_constraintdef(oid) like '%valveSystem%'), false)::text from pg_constraint where conname = 'equipment_type_check'), 'true'),
  ('0009 valve_library',           (to_regclass('public.valve_library') is not null)::text, 'true'),
  ('0010 pump_library',            (to_regclass('public.pump_library') is not null)::text, 'true'),
  ('0011 issues.airflow_row_id',   (select count(*)::text from information_schema.columns where table_name = 'issues' and column_name = 'airflow_row_id'), '1'),
  ('0012 motor photos',            (select coalesce(bool_or(pg_get_constraintdef(oid) like '%motor%'), false)::text from pg_constraint where conname = 'photos_category_check'), 'true'),
  ('0013 issues.issue_type',       (select count(*)::text from information_schema.columns where table_name = 'issues' and column_name = 'issue_type'), '1'),
  ('0014 unit_library',            (to_regclass('public.unit_library') is not null)::text, 'true'),
  ('0001-0014 mapped sync fields', (select count(*)::text from public.sync_columns), '83')
) as t(check_name, result, expected)
union all
select 'users signed in via ' || coalesce(raw_app_meta_data->>'provider', '?'), count(*)::text, 'info', '-'
from auth.users
group by 1;
```

A future production project (`tab-app-prod`) repeats the full setup in [SYNC_SETUP.md](./SYNC_SETUP.md); the pilot
doesn't need it. If sync ever has to be switched off, [SYNC_SETUP.md §10](./SYNC_SETUP.md#10-rollback-plan) is the
rollback plan, and [Part F](#part-f-if-sync-isnt-ready-in-time) says how to work meanwhile.

---

## Part B: add the technician

There are no app-side accounts, roles or invitations. Anyone who can sign in with a company Microsoft account
(and is in the **TAB App Users** group, if you turned assignment on) gets in. Every user can do everything:
add units, review, issue and unlock reports, delete projects. The first sign-in creates their profile, using the
name from Microsoft. That name is what the History shows (*RTU-3 · Serial number · Dana Kim · Phone*).

- [ ] **Microsoft 365 account.** The tech needs a normal company account (`first.last@…`) with a password and
      MFA set up. Check that the **display name** in M365 is their real name, because that's what the History
      shows.
- [ ] **Group.** If assignment is required: **entra.microsoft.com → Enterprise applications → TAB App → Users
      and groups → Add user/group** → the tech (or add them to the **TAB App Users** group).
- [ ] **Their devices.** Decide which phone, tablet or laptop they'll use on site. A company device is best. On a
      personal phone, tell them about **Sign out and remove data from this device** for when they leave.
      iPhone / iPad: **Safari** only. Android: **Chrome**. Laptop: **Chrome** or **Edge**.
- [ ] **Send them** the app link and **[guide/NEW_TECH.md](./guide/NEW_TECH.md)**. Ask them to do its *Before
      the job* checklist from home or the office on Wi-Fi.
- [ ] **Check it worked.** Their first sign-in shows in Supabase → **Authentication → Users**. In the app, any
      change they make shows their name in a project's **History** tab.

**What the tech sees on first sign-in:** every company project downloads to their device. There's no per-project
sharing. Photos download when they're opened. If their device had Local-mode projects from before, it asks them
to **Move projects to the cloud**. Tell them to untick practice projects.

---

## Part C: prepare the pilot project

Do this on your device, signed in, before the site day.

1. **Create the project**, or open the one you've already started (made while signed in, it's already in the cloud). Fill **Info**:
   engineer, contractors, **Technician(s)** (both names), PM, TAB date, scope profile, tolerance.
2. **Add every unit from the schedule** with **Import schedule** (paste from Excel), so the units exist before
   anyone is on site. Two people adding units at the same moment can make the app move one unit to another
   workbook block. It handles this on its own, but it's tidier to avoid.
3. **Unit types for the pilot** (template revision 08):
   - **Carrier RTUs** → type **RTU**. The unit library matches 48-series models: heat after the fan.
   - **Addison DOAS** → type **DOAS**: Filter → Coil → Wheel → Reheat → Fan → Heat. Set **Has reheat coil?**
     and **Unit has filters?** from the unit. If the real airflow order differs, add or edit the unit's entry on the
     **Library** page (*Add unit configuration*). The diagram and graphics follow it.
   - **Greenheck EFs** → **Fans** (type **EF**).
4. **Instruments.** Make sure both people's instruments are in the **Library** with current calibration dates.
   Each person picks their own instrument on the units they test.
5. **Split the work.** Agree who takes which units. Different fields merge on their own, but two people
   typing in the **same field** before either has synced gives a conflict to resolve. Splitting by unit (you:
   RTU-1 to RTU-4, tech: DOAS and EFs) avoids nearly all of them.
6. **Export once** (*Prelim*) and save it to Dropbox, as a starting point and a backup.

---

## Part D: day one on site with the technician

Fifteen minutes at the truck, before the first unit:

- [ ] Both devices show the pill **Synced**, and the tech's account button shows their initials.
- [ ] The tech's device is named (*Name this device* banner: *Tech's Phone*, *Tablet*…).
- [ ] The project is on the tech's device, with the units.
- [ ] Tech: open one assigned unit and type a test value in a remark; you see it on your device within a minute.
      Then delete it.
- [ ] Agree the rules:
  - Each person fills **their own units**. If you must touch the other's unit, say so first.
  - **Mark N/A**, never leave a field blank on purpose.
  - Lost signal in a basement? Keep working. Edits wait on the phone and send when the signal comes back. The pill
    shows *Offline · N unsynced*.
  - **Only the admin (you) issues the report** (*Issue report as …*). Issuing **locks the project for both**:
    the tech's form turns read-only, and any edit they made offline before the lock reached them is held on their
    phone (Attention tab: *not synced*) until you **Unlock**.
  - **Check the Attention tab** at the end of the day. Conflicts show there, with both values.
  - **Don't delete projects.** Signed in, a delete removes the project for everyone.
- [ ] End of day: both pills say **Synced** (no *unsynced* count). You export the workbook and save it to Dropbox.
      The Dropbox copy is still the official record.

**Who did what:** the **History** tab names the person and the device for every change. A review (blue) clears
itself if anyone changes the unit afterwards.

---

## Part E: later, adding and removing people

**Add a person:** Part B only (account, group, the guide).

**Remove a person (they leave, or the pilot ends):**

1. If they used a **personal device**, first ask them to tap **Sync & account → Sign out and remove data from this
   device** while online, so nothing unsynced is lost. Company device: do it yourself.
2. Remove them from **TAB App Users** in Entra, or disable their M365 account. That stops **new** sign-ins.
3. **Also delete them in Supabase:** **Authentication → Users** → the user → **Delete user**. Step 2 alone doesn't
   end a device that is already signed in, because the app keeps its Supabase session alive on its own. Deleting
   the user ends it. Their past changes stay in every History, with their name. If they ever come back, they just
   sign in again.

**Shared or borrowed device:** always **Sign out and remove data from this device** at the end. Plain **Sign out**
keeps the projects on the device.

**Things to keep an eye on (calendar them):**

- The Entra **client secret expiry** (Part A). When it expires, nobody can sign in.
- Supabase **storage** (photos) under the Pro plan's 100 GB. See the Photos FAQ in the user guide.
- New app versions sometimes need a **new database migration**. The pull request and [SYNC_SETUP.md §2](./SYNC_SETUP.md#2-apply-the-database-migrations-0001--0014)
  say which one, and it has to be applied **before** people use the new feature.

---

## Part F: if sync isn't ready in time

Local mode can't merge two people's work on one project. A workbook re-import treats the other person's blank
fields as changes, so don't try to stitch two copies together. Pick one of these instead:

- **One device holds the project.** The tech takes readings on paper or a shared notepad, and you enter them.
  Or the tech enters them on *your* tablet.
- **Split by project, not by unit.** If there are two jobs, each person runs a whole project on their own device.
- Either way, **export every evening** and save to Dropbox. In Local mode the exported file is the only backup.

Sync is already on for tab-app-test, so this only applies if it has to be switched off for a while.
