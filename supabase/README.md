# Supabase backend (not deployed yet)

`migrations/0001_init.sql` creates everything the TAB App needs on Supabase. **Nothing has been applied to a
Supabase project yet**: the app runs in local-only mode until `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set
(see [`app/README.md`](../app/README.md)). Account setup: [`docs/SETUP_ACCOUNTS.md`](../docs/SETUP_ACCOUNTS.md).

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

Who can sign in at all is controlled in Microsoft Entra ID (single-tenant app registration, optionally
"assignment required" + a "TAB App Users" group), so "member of the organization" = "has a company M365 account".

## Apply it

1. Create the projects `tab-app-dev` and `tab-app-prod` (docs/SETUP_ACCOUNTS.md §2).
2. Either
   - **CLI:** `npm i -g supabase` (or `npx supabase`), then from the repository root
     `supabase link --project-ref <ref>` and `supabase db push`; or
   - **Dashboard:** SQL Editor → New query → paste `migrations/0001_init.sql` → Run.
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

The app calls `supabase.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email' } })`.

## Checking the migration locally (no Supabase needed)

`tests/` holds a stand-in for Supabase's `auth` / `storage` schemas and a smoke test. On any empty PostgreSQL 15+
database:

```
psql -d <empty db> -v ON_ERROR_STOP=1 -f supabase/tests/supabase_stub.sql \
     -f supabase/migrations/0001_init.sql -f supabase/migrations/0002_review_lock.sql \
     -f supabase/tests/grants_for_stub.sql
psql -d <empty db> -f supabase/tests/smoke_test.sql
```

`0002_review_lock.sql` (Phase 6) adds `equipment.review` and `projects.lock` (jsonb) and their `sync_columns` rows; checked
on PostgreSQL 16 (applies cleanly, the smoke test still passes, `apply_set` writes both fields).

Last run (PostgreSQL 16.13): the migration applies cleanly; creates, nested JSON sets
(`blueprints.0.sheet`, `customScope.rtu.static`, `naState.fields.fla`), last-writer-wins (an older edit arriving
later is kept with `applied = false`), cascading delete; RLS rejects a spoofed `user_id`, a user of another
organization (sees 0 rows, cannot write) and that user's photo upload.

## Not done yet

- The app's `SupabaseSyncEngine` (push / pull of `field_changes`) is written but has never run against a real
  project. Realtime subscription, photo upload and conflict review are Phase 5.
- Two offline devices can give two units the same workbook slot; resolving that on pull is Phase 5
  (`equipment.slot` is deliberately not unique).
