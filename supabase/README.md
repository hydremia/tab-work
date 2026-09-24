# Supabase backend (not deployed yet)

`migrations/0001_init.sql`, `0002_review_lock.sql` and `0003_sync_rules.sql` create everything the TAB App needs on
Supabase. **Nothing has been applied to a Supabase project yet**: the app runs in local-only mode until
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set (see [`app/README.md`](../app/README.md)). Account setup:
[`docs/SETUP_ACCOUNTS.md`](../docs/SETUP_ACCOUNTS.md); switching sign-in and sync on, step by step (migrations, bucket,
Azure provider, Vercel, first sign-in, two-device check, rollback): **[`docs/SYNC_SETUP.md`](../docs/SYNC_SETUP.md)**.

## What the migration creates

| Object | Purpose |
|---|---|
| `organizations`, `profiles` | One organization (`a2b`, seeded). Every new auth user gets a profile in it (trigger on `auth.users`). |
| `projects`, `equipment`, `airflow_rows`, `issues`, `photos`, `instruments` | The app's records (same shape as `app/src/data/types.ts`; JSON columns for field values and N/A marks). |
| `field_changes` | The sync log: devices push their outbox here; `server_seq` is the pull cursor. |
| `sync_columns` | Data map from the app's field keys (camelCase) to columns. |
| trigger `field_changes_apply` | Applies each pushed change to its record: create / set (dotted paths into JSON columns) / delete. **Last writer wins** per record + field by client timestamp; the losing edit stays in the log with `applied = false`. |
| RLS on every table | All users are equal: any signed-in member of the organization can read and write everything in it; nobody else sees anything. `field_changes` is append-only and a user can only append as themselves. |
| Storage bucket `photos` | Private; object path `<project_id>/<photo_id>.<ext>`; members of the project's organization can read / write. |
| Realtime | `field_changes` is added to the `supabase_realtime` publication (live updates, Phase 5). |

`0002_review_lock.sql` adds `equipment.review` and `projects.lock` (jsonb) and their `sync_columns` rows.

### 0003: server-side sync rules

`0003_sync_rules.sql` replaces the apply trigger so the server enforces what every device's repository enforces, and
fixes three problems found by testing the sync engine against a fake server and this schema on PostgreSQL 16:

| Rule / fix | Detail |
|---|---|
| **Idempotent re-push** (bug fix) | The app pushes with `upsert(…, { ignoreDuplicates: true })` = `ON CONFLICT (id) DO NOTHING`, but PostgreSQL fires BEFORE INSERT triggers *before* the conflict check: a retried push re-applied its changes, so a retried *create* reset the record to its created values (undoing other devices' later edits) and could bring a deleted record back. The trigger now skips a change whose id is already in the log (the device-generated id is the idempotency key). A create never overwrites an existing record or revives a deleted one (logged with `applied = false`). |
| **Project delete syncs** (bug fix) | The insert policy ran after the trigger had deleted the project, found no project and rejected the row, so a project delete could never sync. Changes now carry `org_id` (set by the trigger from the project, or from the project's earlier changes once it is gone) and the read / append policies check it — which also lets other devices pull the delete. |
| **Report lock** | While `projects.lock` is an object, every change to the project's records is refused except setting / clearing the lock and deleting the whole project (the device rules). The error: SQLSTATE `P0001`, message `TAB_LOCKED: the report was issued as <label>; unlock the project to edit.`, hint `TAB_LOCKED`, detail JSON `{change_id, project_id, lock}`. The app maps it to its `LockedError` and **holds** that project's pending changes on the device until it is unlocked. Nothing of the refused request is applied (one request is one transaction). |
| **Review clearing** | A device that changes a reviewed unit clears the review itself (synced). When a change of a unit, its rows or photos reaches the server and the device had *not* seen the unit's review (its `base_seq` is older than the review's `server_seq`, or unknown), the server clears the review with a change of its own (`device_id = 'server'`, ordered after the change, timestamp after the review), which every device pulls. Issues and project-level changes never clear a review. |
| `base_seq` | The device's pull position when the change was made; used for the review rule and by the devices to detect conflicts. |
| `server_time_ms()` | The server clock (ms); devices measure their clock offset with it (timestamps are server-corrected). |
| Explicit checks | `TAB_FORBIDDEN` when a change is not made as the signed-in user, targets another organization's project (RLS still checks both), or names a record of another project than its `project_id` (a project change must name the project itself; a deleted project's id stays its organization's). |
| Privileges | `anon` has nothing on the tables and functions. The SECURITY DEFINER internals (`apply_set`, `change_units`, `project_org`, the trigger functions) are not executable over the API; `authenticated` executes only the RLS helpers and `server_time_ms()`. Record tables are read-only for `authenticated`: every write goes through `field_changes` (so the lock, the log and the other devices always see it). |
| Storage | Photo files of a deleted project stay readable / removable by its organization (the deleting device removes them). |

Rollback: `rollback/0003_sync_rules_down.sql` restores the 0001 / 0002 rules and keeps the data (docs/SYNC_SETUP.md §10).

Who can sign in at all is controlled in Microsoft Entra ID (single-tenant app registration, optionally
"assignment required" + a "TAB App Users" group), so "member of the organization" = "has a company M365 account".

## Apply it

1. Create the projects `tab-app-dev` and `tab-app-prod` (docs/SETUP_ACCOUNTS.md §2).
2. Either
   - **CLI:** `npm i -g supabase` (or `npx supabase`), then from the repository root
     `supabase link --project-ref <ref>` and `supabase db push`; or
   - **Dashboard:** SQL Editor → New query → paste `migrations/0001_init.sql` → Run; then `0002_review_lock.sql`,
     then `0003_sync_rules.sql` (in this order). Full walk-through: [docs/SYNC_SETUP.md](../docs/SYNC_SETUP.md).
3. Settings → API: copy the **Project URL** and the **anon public** key into the app's environment
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`: `app/.env.local` for development, the hosting provider's
   environment settings for deploys). Never use the `service_role` key in the app.

## Sign in with Microsoft (Azure provider)

In **Microsoft Entra ID** (docs/SETUP_ACCOUNTS.md §1): App registrations → New registration → name `TAB App`,
**Accounts in this organizational directory only**, redirect URI (Web) =
`https://<project-ref>.supabase.co/auth/v1/callback`. Create a client secret. API permissions: `openid`, `email`,
`profile`, `User.Read` → Grant admin consent.

In **Supabase** → Authentication → Sign In / Providers → **Azure**:

| Setting | Value |
|---|---|
| Enabled | on |
| Application (client) ID | from the app registration |
| Secret value | the client secret's **value** |
| Azure Tenant URL | `https://login.microsoftonline.com/<directory-tenant-id>` (the company tenant only, not `common`) |

Authentication → URL Configuration: **Site URL** = the app's URL (e.g. `https://tab.<yourdomain>.com`); add
`http://localhost:5173` and any preview-deploy URLs to **Redirect URLs**. Optionally turn off email sign-ups so
Microsoft is the only way in.

The app calls `supabase.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email', redirectTo: '<app>/auth/callback' } })`
(PKCE); `/auth/callback` exchanges the code for the session. Add `https://<app>/auth/callback` (and
`http://localhost:5173/auth/callback`) to **Redirect URLs**.

## Checking the migrations locally (no Supabase needed)

`tests/` holds a stand-in for Supabase's `auth` / `storage` schemas and two tests. On an empty PostgreSQL 15+ database:

```
psql -d <empty db> -v ON_ERROR_STOP=1 -f supabase/tests/supabase_stub.sql \
     -f supabase/migrations/0001_init.sql -f supabase/migrations/0002_review_lock.sql \
     -f supabase/migrations/0003_sync_rules.sql -f supabase/tests/grants_for_stub.sql
psql -d <empty db> -f supabase/tests/sync_rules_test.sql    # ends with "ALL SYNC RULE TESTS PASSED"
psql -d <other empty db, same setup> -f supabase/tests/smoke_test.sql
```

`sync_rules_test.sql` asserts every rule and stops at the first failure (`PASS <name>` per check). **Last run
(PostgreSQL 16.13, 2026-09-24): 48 PASS, "ALL SYNC RULE TESTS PASSED"**: creates / sets, changes carry the organization,
a re-pushed create is not applied again (a later rename kept) and every re-pushed change is logged once, last writer
wins, spoofed user rejected (`TAB_FORBIDDEN`), another organization sees no projects / changes and cannot edit, lock,
unlock, delete or upload, review cleared by the server only for a change made without knowing the review (not by an
issue), locked project refuses field edits / new units / row deletes / reviews / project fields with `TAB_LOCKED`
(SQLSTATE P0001, the detail names the refused change, nothing applied or logged), a retry of a change accepted before
the lock is skipped without error, unlock then edit works (also both in one request), a locked project can be deleted
as a whole (cascade) and other members pull the delete, a create of a deleted record is logged but not applied, photo
files of a deleted project can be removed, server clock; and (security review) a change filed under one project cannot
edit / delete another project's or organization's record or bypass a lock that way, another organization cannot
re-create a deleted project's id, `apply_set` & co. are not callable by `authenticated` or `anon`, `anon` reads
nothing, members cannot write record tables directly (`supabase_stub.sql` models Supabase's default privileges, so the
migrations' revokes are tested as on Supabase). `smoke_test.sql` (the 0001 checks) still passes on 0001–0003
(the spoofed user / outsider are now refused by the trigger's explicit checks before RLS). The two bugs fixed by 0003
were first reproduced on 0001 + 0002 (a retried create reverted a rename; a project delete failed RLS). The rollback
script was checked the same way (smoke test as on 0001, 0003 re-applies).

The same rules run in the app's in-memory fake server (`app/src/sync/fakeServer.ts`, unit tests in
`fakeServer.test.ts` mirroring the SQL test) that the sync engine is tested against.

## Not done yet

- Nothing has run against a real Supabase project: the sync engine, photo transfers, sign-in and the Realtime hint are
  tested against the fake server (same rules) and a mocked Supabase auth client; the SQL on local PostgreSQL 16.
- Two offline devices can give two units the same workbook slot; resolving that on pull is still to do
  (`equipment.slot` is deliberately not unique).
- The server does not check "review only when green" (it cannot compute completion); the devices do.
- The newer photo fields (`order`, `width`, `height`, `capturedAt`, `gps`) have no server columns: they sync through
  `field_changes` (kept with `applied = false, note = 'unknown field'`, and applied by the devices) but are not in the
  `photos` table.
