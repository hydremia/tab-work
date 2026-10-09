# Admin runbook: setting up a technician for the multi-user pilot

For the a2b admin: the person who owns the Microsoft 365, Supabase and Vercel accounts. Use it this week to get
**you and one technician working the same project from two devices**. It covers the one-time switch to cloud
sync, adding the technician, preparing the project and the first site day. It also covers adding or removing
people later.

The technician's own guide is **[guide/NEW_TECH.md](./guide/NEW_TECH.md)**. Send them that link once Part B is done.

| Part | What | Who | Time |
|---|---|---|---|
| [A](#part-a-switch-on-sign-in-and-cloud-sync-once-for-the-company) | Switch on sign-in and cloud sync (once for the company) | you + your M365 admin | about 1–2 hours |
| [B](#part-b-add-the-technician) | Add the technician | you | 10 minutes |
| [C](#part-c-prepare-the-pilot-project) | Prepare the pilot project | you | 30–60 minutes |
| [D](#part-d-day-one-on-site-with-the-technician) | Day one on site | you + the tech | 15 minutes at the start |
| [E](#part-e-later-adding-and-removing-people) | Later: adding and removing people | you | 5 minutes each |
| [F](#part-f-if-sync-isnt-ready-in-time) | If sync isn't ready in time | you | n/a |

---

## First: is sync already on?

Open the app (https://tab-work-app.vercel.app or your company address) and look at the top right.

- **A grey *Local* pill and the banner "Local mode — not signed in / not syncing"**: sync is **off**. Every device
  keeps its own separate copy, so two people can't work the same project. **Do Part A first.**
- **A cloud icon / *Synced* pill and a round account button with your initials**: sync is on. Skip to
  [Part B](#part-b-add-the-technician).

> Without sync, a project lives only on the device it was entered on. A tech's readings never reach your device
> unless they go through a workbook file. Don't start a two-person job in Local mode. See [Part F](#part-f-if-sync-isnt-ready-in-time)
> if you're stuck there.

---

## Part A: switch on sign-in and cloud sync (once for the company)

The app is already built for this. Turning it on means creating the accounts and pasting a few values into
Supabase and Vercel. The detailed, click-by-click steps are in **[SYNC_SETUP.md](./SYNC_SETUP.md)**. This is the
order to do them in, with what to have ready.

**Do it early in the week, not the night before.** Step A2 needs your Microsoft 365 admin. You also want a day
to run the two-device check (A6) on a throw-away project.

### A1. Supabase project (database, photos, sync)

[SETUP_ACCOUNTS.md §2](./SETUP_ACCOUNTS.md#2-supabase-database-photo-storage-live-sync)

- [ ] Create the production project (e.g. `tab-app-prod`) in your Supabase organization. Pro plan: daily backups.
- [ ] Apply the **14 database migrations, `0001` … `0014`, in order**:
      [SYNC_SETUP.md §2](./SYNC_SETUP.md#2-apply-the-database-migrations-0001--0014). Run the check queries at the
      end of that section. Every one must give the expected answer.
- [ ] Check that the private `photos` bucket exists ([SYNC_SETUP.md §3](./SYNC_SETUP.md#3-photo-storage)).

You can skip a separate dev project for a two-person pilot. If you do, run the two-device check (A6) on
production with a throw-away project, then delete it.

### A2. Microsoft sign-in (your M365 admin, about 15 minutes)

[SYNC_SETUP.md §4](./SYNC_SETUP.md#4-microsoft-entra-id-the-app-registration-m365-admin)

- [ ] App registration **TAB App**, single tenant, redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
- [ ] Client secret, 24 months. **Put a calendar reminder a month before it expires.** When it expires, nobody
      can sign in.
- [ ] *(Recommended)* **Assignment required = Yes**, and a group **TAB App Users**. You add or remove people through
      this group (Part B, Part E).
- [ ] The client ID, tenant ID and secret go to you through a password manager. Never send them by email, chat or
      the repository.

### A3. Supabase sign-in settings

[SYNC_SETUP.md §5](./SYNC_SETUP.md#5-supabase-switch-on-the-azure-provider-tenant-restricted)

- [ ] Azure provider on: client ID, the secret **value**, tenant URL `https://login.microsoftonline.com/<tenant ID>`
      (your tenant, never `common`).
- [ ] Email provider **off**, so Microsoft is the only way in.
- [ ] Site URL = the app's address. Redirect URLs include `<app address>/auth/callback`.

### A4. Vercel: the two settings, then redeploy

[SYNC_SETUP.md §6](./SYNC_SETUP.md#6-vercel-the-two-settings)

- [ ] `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the **anon public** key, never `service_role`) for
      Production.
- [ ] **Deployments → ⋯ → Redeploy.** The values are only read when the app is built.

### A5. Your first sign-in (moves your projects to the cloud)

[SYNC_SETUP.md §7](./SYNC_SETUP.md#7-first-sign-in)

1. On **your** device, the one that has your projects, open the app. Tap **Reload** on *Update available* if it
   shows. The pill now says **Not signed in**.
2. **Export every project you care about first** and save the files to Dropbox. That's your safety net.
3. Tap the pill → **Sync & account** → **Sign in with Microsoft** → your work account.
4. **Move projects to the cloud** lists every project on the device, all ticked. Untick old or test projects that
   don't need to be shared. Then tap **Upload N projects**.
5. Answer **Name this device** (e.g. *Laptop*).
6. Wait for the pill to say **Synced**. Photos keep uploading in the background for a few minutes.

The libraries (instruments, unit configurations, valves, pumps) and the certification profile on this device are
uploaded too, and shared with everyone who signs in.

### A6. Two-device check (15 minutes, before the tech is involved)

[SYNC_SETUP.md §8](./SYNC_SETUP.md#8-check-sync-between-two-devices-15-minutes)

Use your laptop and your phone (both signed in as you), and a throw-away project. At minimum, check that:

- [ ] a unit added on one device appears on the other within 30 seconds;
- [ ] a photo taken on the phone shows on the laptop;
- [ ] an offline edit on both devices to the same field shows a **Conflict** on the Attention tab, and resolving it
      clears it on both;
- [ ] **Issue report** on one device locks the project on the other.

Then delete the throw-away project (⋯ → **Delete project…**, which deletes it for everyone).

If something fails, see [SYNC_SETUP.md §9 Troubleshooting](./SYNC_SETUP.md#9-troubleshooting). If it can't be fixed
before the job, use [Part F](#part-f-if-sync-isnt-ready-in-time) and switch sync off again
([SYNC_SETUP.md §10](./SYNC_SETUP.md#10-rollback-plan)). Nobody loses data.

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

1. **Create the project**, or open the one you've already started; it's in the cloud since A5. Fill **Info**:
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

- The Entra **client secret expiry** (A2). When it expires, nobody can sign in.
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

Once sync is on, your first sign-in uploads the project (A5), and the tech gets it from then on.
