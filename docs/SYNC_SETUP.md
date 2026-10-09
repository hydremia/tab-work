# Switching on sign-in and sync

The app works today in **local mode**: everything stays on the device. This guide switches on **Sign in with
Microsoft** and **cloud sync** once the accounts exist ([SETUP_ACCOUNTS.md](./SETUP_ACCOUNTS.md) §1–§3). Nothing
in the app's code has to change: sync turns on when two settings are added to the hosting provider.

**Who:** someone who can create the Supabase projects, plus your Microsoft 365 admin for step 4 (about 15 minutes of
their time). **Total time:** about an hour, most of it waiting for deploys.

**Before you start, have ready:**

- the Supabase projects `tab-app-dev` and `tab-app-prod` ([SETUP_ACCOUNTS.md §2](./SETUP_ACCOUNTS.md#2-supabase-database-photo-storage-live-sync));
- the Vercel project ([DEPLOY.md](./DEPLOY.md)) and the app's final web address (e.g. `https://tab.yourcompany.com`);
- a Microsoft 365 admin (Global Administrator or Application Administrator).

Do every step on **tab-app-dev** first, check it with a preview deploy (step 8), then repeat steps 2–6 on
**tab-app-prod**.

---

## 1. What gets set up

| Piece | Where | What it does |
|---|---|---|
| Database tables and rules | Supabase (6 SQL files) | Projects, units, readings, issues, photos, the change log; who may read and write; the report lock and review rules |
| Photo storage | Supabase Storage, bucket `photos` | The photo files (private: only signed-in company users) |
| Sign in with Microsoft | Microsoft Entra ID + Supabase "Azure" provider | Only accounts of your company's Microsoft 365 can sign in |
| Two settings | Vercel | Tell the app where the Supabase project is |

## 2. Apply the database migrations (0001 … 0011)

Eleven files, **in this order**. Each can be run again safely only where noted, so run each one once.

| File | What it adds |
|---|---|
| `supabase/migrations/0001_init.sql` | tables, the change log (`field_changes`) and its apply trigger, row-level security, the `photos` bucket |
| `supabase/migrations/0002_review_lock.sql` | the unit review and report-lock columns |
| `supabase/migrations/0003_sync_rules.sql` | server-side rules: report lock, review clearing, safe retries, project deletes, the server clock (re-runnable) |
| `supabase/migrations/0004_library_links.sql` | shared calibration library, link checks (units / issues of the same project), slot-move note (re-runnable) |
| `supabase/migrations/0005_review_deletes.sql` | a review signs off only the data the reviewer saw; a record added offline to a unit / issue deleted meanwhile no longer fails the push (re-runnable) |
| `supabase/migrations/0006_cert_profile.sql` | the shared certification profile (CP details, stamp and signature images) (re-runnable) |
| `supabase/migrations/0007_change_labels.sql` | the History on other devices names the person and the device (*Dana Kim · Phone*) (re-runnable) |
| `supabase/migrations/0008_hydronic_types.sql` | hydronic equipment (pumps, valve systems, plant, flow readings). **Apply before anyone adds a hydronic unit**: until then the server refuses them and that device's sync stops at the first one (re-runnable) |
| `supabase/migrations/0009_valve_library.sql` | the shared balancing-valve library (valve models from data sheets, picked on valve rows) (re-runnable) |
| `supabase/migrations/0010_pump_library.sql` | the shared pump-curve library (curves per impeller from curve sheets, picked on pumps) (re-runnable; needs 0009) |
| `supabase/migrations/0011_row_links.sql` | issues and photos of one airflow line (outlet, grille, valve row). **Apply before anyone links one**: until then the server refuses those changes (re-runnable) |
| `supabase/migrations/0012_motor_photos.sql` | the unit **motor** photo category. **Apply before the app with motor photos is used**: until then the server refuses a motor photo (re-runnable) |
| `supabase/migrations/0013_issue_types.sql` | **observations** (issues that don't flag their unit). **Apply before the app with observations is used**: until then an observation reaches the server as a deficiency (re-runnable) |
| `supabase/migrations/0014_unit_library.sql` | the shared **unit configuration library** (component order and documents per product line). Until it is applied, library edits stay on the device that made them (re-runnable) |

**Option A — in the browser (simplest):**

1. Supabase → your project → **SQL Editor** → **New query**.
2. Open `supabase/migrations/0001_init.sql` on GitHub (Raw), copy everything, paste, **Run**. It should end with
   "Success. No rows returned".
3. New query → the same with `0002_review_lock.sql`, then with `0003_sync_rules.sql`, then `0004_library_links.sql`, then
   `0005_review_deletes.sql`, then `0006_cert_profile.sql`, then `0007_change_labels.sql`, then `0008_hydronic_types.sql`, then `0009_valve_library.sql`, then `0010_pump_library.sql`, then `0011_row_links.sql`, then `0012_motor_photos.sql`, then `0013_issue_types.sql`, then `0014_unit_library.sql`.

**Option B — command line** (from a checkout of the repository, Node installed):

```
npx supabase login
npx supabase init                          # only if it says this is not a Supabase project; answer "n" to the questions
npx supabase link --project-ref <project-ref>
npx supabase db push                       # applies 0001 … 0011 in order; shows them and asks first
```

The project ref is the `xxxx` in `https://xxxx.supabase.co` (Settings → General). Never run `supabase test db` against
the project: the files in `supabase/tests/` are for a throw-away local PostgreSQL only.

**Check** (SQL Editor, new query):

```sql
select count(*) as mapped_fields from public.sync_columns;                       -- 73 (0001 … 0011)
select public.server_time_ms() > 0 as server_clock;                            -- true
select id, public, file_size_limit from storage.buckets where id = 'photos';   -- photos | false | 26214400
select name from public.organizations;                                          -- a2b
select count(*) from information_schema.columns
 where table_name = 'field_changes' and column_name = 'units';                -- 1 (0005 applied)
select count(*) from public.cert_profiles;                                      -- 0 (0006 applied)
select count(*) from information_schema.columns
 where table_name = 'field_changes' and column_name = 'device_name';          -- 1 (0007 applied)
select pg_get_constraintdef(oid) like '%valveSystem%' from pg_constraint
 where conname = 'equipment_type_check';                                         -- true (0008 applied)
select count(*) from public.valve_library;                                     -- 0 (0009 applied)
select count(*) from public.pump_library;                                      -- 0 (0010 applied)
select count(*) from information_schema.columns
 where table_name = 'issues' and column_name = 'airflow_row_id';             -- 1 (0011 applied)
```

## 3. Photo storage

Migration 0001 already created the private bucket **`photos`** (25 MB per file; JPEG, PNG, HEIC, WebP) and its access
rules. Check under **Storage**: the bucket `photos` is listed and marked *Private*; **Storage → Policies** shows four
policies on `objects` ("members read / upload / update / delete project photos").

If the bucket is missing (the SQL editor could not write to the storage schema): **Storage → New bucket** → name
`photos`, *Public bucket* **off**, *Restrict file upload size* **25 MB**, *Allowed MIME types*
`image/jpeg, image/png, image/heic, image/heif, image/webp` → Save. Then run 0003 once more (it recreates the policy
function; the policies from 0001 stay).

## 4. Microsoft Entra ID: the app registration (M365 admin)

1. **entra.microsoft.com → Identity → Applications → App registrations → New registration**
   - Name: `TAB App`
   - Supported account types: **Accounts in this organizational directory only (single tenant)**
   - Redirect URI: platform **Web**, value `https://<project-ref>.supabase.co/auth/v1/callback`
     (for dev: the dev project's ref; add the prod one later under *Authentication → Add URI*).
   - **Register.** Copy the **Application (client) ID** and the **Directory (tenant) ID** from the Overview page.
2. **Certificates & secrets → New client secret** → description `Supabase`, expiry 24 months → **Add**. Copy the
   **Value** now (it is shown once). Put a reminder in the calendar a month before it expires: when it does, nobody
   can sign in until a new secret is entered in Supabase (step 5).
3. **API permissions**: keep `Microsoft Graph → User.Read`; **Add a permission → Microsoft Graph → Delegated** →
   `openid`, `email`, `profile` → **Grant admin consent for <company>**.
4. *(Recommended)* limit who can sign in: **Enterprise applications → TAB App → Properties → Assignment required? Yes**,
   then **Users and groups → Add user/group** → a group such as "TAB App Users". Everyone else gets a Microsoft error
   page (AADSTS50105) instead of the app.

Send the client ID, tenant ID and secret value to the person doing step 5 through a password manager or similar,
never by chat or email, and never into the repository.

## 5. Supabase: switch on the Azure provider (tenant restricted)

**Authentication → Sign In / Providers → Azure:**

| Setting | Value |
|---|---|
| Enable Sign in with Azure | on |
| Application (client) ID | from step 4.1 |
| Secret Value | the secret **value** from step 4.2 (not its ID) |
| Azure Tenant URL | `https://login.microsoftonline.com/<Directory (tenant) ID>` — your tenant only, never `common` or `organizations` |

**Authentication → Sign In / Providers → Email:** switch **off** "Enable Email provider" (or at least "Allow new users to
sign up") so Microsoft is the only way in.

**Authentication → URL Configuration:**

- **Site URL:** the app's address, e.g. `https://tab.yourcompany.com` (dev project: the preview address or
  `http://localhost:5173`).
- **Redirect URLs** (the app comes back to `/auth/callback`):
  - `https://tab.yourcompany.com/auth/callback`
  - `http://localhost:5173/auth/callback` (development)
  - for Vercel previews (dev project only): `https://*-<your-team>.vercel.app/**`

## 6. Vercel: the two settings

**Vercel → the project → Settings → Environment Variables:**

| Name | Value | Environments |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://<prod-ref>.supabase.co` (Settings → API → Project URL) | Production |
| `VITE_SUPABASE_ANON_KEY` | the **anon public** key (Settings → API) | Production |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | the **tab-app-dev** values | Preview |

Never enter the `service_role` key anywhere in the app or Vercel. The values are read when the app is built:
**Deployments → ⋯ → Redeploy** after adding or changing them.

*(Optional, stricter)* allow network requests to your project only instead of any `*.supabase.co`:
`VITE_SUPABASE_URL=https://<prod-ref>.supabase.co npm run hosting-config -w app`, commit, deploy
([DEPLOY.md](./DEPLOY.md#headers-all-hosts)).

## 7. First sign-in

1. Open the app (preview first, for dev). The banner now says *Not signed in*, the status pill *Not signed in*.
2. Tap the status pill (top right) → **Sync & account** → **Sign in with Microsoft** → pick your work account →
   (first time: accept the permissions) → you are back in the app.
3. If this device already has projects from local mode, the app asks **"Move projects to the cloud"**: every project is
   listed and ticked. Untick any that should stay on this device only (you can move them later from *Sync & account*),
   then **Upload**. The pill shows *Syncing…*, then **Synced**.
4. Check in Supabase: **Table Editor → projects** lists the uploaded projects; **field_changes** has their changes;
   **Storage → photos** gets a folder per project as photos upload (in the background, a few seconds each).

Everyone else just signs in the same way; their device downloads the company's projects on first sign-in.

## 8. Check sync between two devices (15 minutes)

Use a throw-away project. Device A = a laptop, device B = a phone (or two browsers signed in as two people). On each,
answer the **Name this device** banner first (A: *Laptop*, B: *Phone*).

**Sync is automatic:** a change is sent about 2 seconds after you make it, each device checks for changes every 30
seconds, and a device that comes back online syncs straight away. **Sync now** (tap the status pill) only saves waiting.
So to make two changes collide, or to hold one back, a device has to be **offline** (airplane mode / Wi-Fi off) while
you make it.

| # | Do | Expect |
|---|---|---|
| 1 | A: new project "Sync test", add RTU-1 | B: appears within 30 s (or Sync now) |
| 2 | B: RTU-1 serial `111`; A: RTU-1 model `48FC` | both devices show both values (different fields merge). History on A: *RTU-1 · Serial number … · tech2 · Phone* |
| 3 | B: take a unit photo | A: the photo appears (thumbnail first says *Downloading…*) |
| 4 | Both offline. A: serial `AAA`. Then B: serial `BBB` | pills say *Offline · 1 unsynced* |
| 5 | A online, wait for *Synced*; then B online | both show `BBB` (the later edit); both show **Conflict** on RTU-1 and in the **Attention** tab with `AAA` as the other value |
| 6 | A: Attention → **Use "AAA"** | A and B show `AAA`; the conflict is gone on both |
| 7 | **B offline**, B: RTU-1 model `HELD` (pill: *1 unsynced*). A (online): Export → **Issue report** | A: the report is locked |
| 8 | B online | B: the lock banner appears and the form is read-only; `HELD` is kept on B and listed as *not synced* in Attention (A still shows `48FC`) |
| 9 | A: **Unlock** | B's held edit syncs: A shows `HELD` |
| 10 | A: ⋯ → **Delete project…** (the confirmation says *for everyone*) | it disappears on B too (within 30 s) |
| 11 | B: pill → **Sign out** | B keeps its other projects; nothing syncs until B signs in again |

## 9. Troubleshooting

| You see | Cause | Fix |
|---|---|---|
| Microsoft: *AADSTS50011 redirect URI mismatch* | step 4.1 URI differs from the project ref | App registration → Authentication: `https://<ref>.supabase.co/auth/v1/callback` exactly |
| Microsoft: *AADSTS50105 … not assigned* | assignment required and the person is not in the group | Enterprise applications → TAB App → Users and groups |
| App: *Sign-in didn't finish: … redirect* / back on the Supabase site | `/auth/callback` not in Redirect URLs | step 5, URL Configuration |
| Pill: *Sync error: … TAB_FORBIDDEN* or *row-level security* | the user has no profile (signed up before 0001 ran) or belongs to another organization | SQL: `insert into public.profiles (user_id, org_id, email) select id, (select id from public.organizations where name = 'a2b'), email from auth.users where email = '<email>';` |
| Pill: *Sync error: Failed to fetch* on a working network | CSP narrowed to another project, or the URL variable is wrong | check `VITE_SUPABASE_URL`, redeploy |
| Nobody can sign in, it worked before | the Entra client secret expired | step 4.2 new secret → step 5 |
| *Sign in with Microsoft* ends on `localhost` with an error | Supabase's Site URL is still its default and `<app>/auth/callback` isn't allowed, so Supabase falls back to the Site URL | step 5, URL Configuration: Site URL = the app's address, Redirect URLs += `<app>/auth/callback` (no redeploy) |
| Entra admin center: *AADSTS16000 … account does not exist in tenant* | signed in with a personal Microsoft account, which has no directory | sign in with a work account of the tenant (or create a test tenant: azure.microsoft.com/free with the personal account, then work in its *Default Directory*) |
| Supabase Azure panel shows an email / a short password in the client ID / secret fields | the browser's password manager autofilled them | clear them, paste the real values (client ID = a GUID, secret = the **Value**), turn off autofill for supabase.com |
| Vercel: *Remove the public framework prefix…* on `VITE_SUPABASE_*` | Vercel warns that `VITE_` values are visible in the browser | expected: the URL and anon key are public by design (row-level security protects the data); keep the names; "sensitive" variables are still passed to the build |
| Vercel build: `tsc: command not found`, 455 packages installed | the project's **Root Directory** is `app` (only the app workspace installs, `vercel.json` is ignored) | Settings → Build and Deployment → Root Directory: empty; overrides off; redeploy |
| Pill still says *Local* after adding the variables | the app was built before they were added, or the old version is cached | Redeploy; reload the app (tap *Reload* on *Update available*) |

## 10. Rollback plan

Sync can be switched off at any time **without losing data**: every device keeps its projects, and edits made while
sync is off wait on the device (the outbox) until it is on again.

1. **Switch the app back to local mode:** Vercel → Settings → Environment Variables → remove `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` → Redeploy. Open apps pick it up as an update (*Update available — Reload*). Or roll back
   to the previous deployment: **Deployments → the previous one → ⋯ → Instant Rollback**.
2. **Undo migration 0003 only** (if its rules cause trouble): SQL Editor → run
   `supabase/rollback/0003_sync_rules_down.sql`. It restores the 0001 / 0002 rules and keeps all data; 0003 can be
   applied again later. (Checked on PostgreSQL 16: after the rollback the 0001 smoke test behaves as before, and 0003
   re-applies cleanly.) Undo later ones first, newest first: **0011**
   (`supabase/rollback/0011_row_links_down.sql`: line links no longer synced; columns and values kept), **0010**
   (`supabase/rollback/0010_pump_library_down.sql`: pump library changes refused again; table and data kept), **0009**
   (`supabase/rollback/0009_valve_library_down.sql`: library changes refused again; table and data kept), **0008**
   (`supabase/rollback/0008_hydronic_types_down.sql`: airside types only; delete hydronic units first), **0007**
   (`supabase/rollback/0007_change_labels_down.sql`: names stop being filled in; the columns and names kept), **0006** (`supabase/rollback/0006_cert_profile_down.sql`:
   back to the 0005 rules, the profile table kept), **0005** (`supabase/rollback/0005_review_deletes_down.sql`: back
   to the 0004 rules, data kept), then **0004**: `supabase/rollback/0004_library_links_down.sql`
   restores the 0003 trigger and keeps all data (library changes pushed meanwhile are refused and wait on the devices
   until 0004 is applied again).
3. **Before changing production:** take a backup — Supabase → Database → Backups (Pro plan: daily backups, restore to a
   point in time), or `npx supabase db dump -f backup.sql --linked`.
4. **Nothing is only in the cloud:** any project can still be exported to the TAB workbook from any device that has it.

Microsoft sign-in can be removed independently: Supabase → Azure provider off (users are signed out at their next token
refresh) or Entra → delete the app registration.
