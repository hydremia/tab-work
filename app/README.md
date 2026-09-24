# TAB App (`app/`)

Offline-first, mobile-first PWA for HVAC test-adjust-balance field data entry. It fills and reads the a2b TAB
workbook, **revision 05** (`05 - a2b_Blank_TAB_Workbook 9-23-26.xlsm` at the repository root). Plan and decisions:
[`docs/ROADMAP.md`](../docs/ROADMAP.md), [`docs/TRACKER.md`](../docs/TRACKER.md),
[`docs/REQUIRED_FIELDS.md`](../docs/REQUIRED_FIELDS.md).

Stack: React 19 + TypeScript (strict) + Vite 7, React Router 7, `vite-plugin-pwa` (installable, offline app shell,
auto-update), Dexie (IndexedDB), Supabase (optional, behind env vars), Vitest + Testing Library + fake-indexeddb,
ESLint + Prettier. The workbook engine is the shared package [`packages/workbook`](../packages/workbook).

## Run it

Node 22. From the **repository root** (npm workspaces: `app`, `packages/*`, `spike/export`):

```
npm install
npm run dev            # http://localhost:5173  (copies the template into app/public/templates first)
```

Scripts (run in `app/`, or from the root with `-w app`):

| Script                                   | What it does                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `dev`                                    | Vite dev server (the service worker is off in dev)                                                       |
| `build`                                  | Type-check (`tsc -b`) and build to `dist/`, incl. the service worker and manifest                        |
| `preview`                                | Serve `dist/` on http://localhost:4173 (use this to test offline / install)                              |
| `lint` / `typecheck` / `test` / `format` | ESLint, `tsc`, Vitest (jsdom + fake-indexeddb), Prettier                                                 |
| `e2e`                                    | Browser walk-through of the vertical slice with Playwright's Chromium (see below)                        |
| `copy-template`                          | Copies the rev 05 template from the repository root to `public/templates/` (runs before `dev` / `build`) |

The root `package.json` also has `lint`, `typecheck`, `test` (package + app) and `build`; CI
(`.github/workflows/ci.yml`) runs those.

## Environment and local mode

Copy `.env.example` to `.env.local` and fill in both values to enable Supabase:

| Variable                 | Value                                                     |
| ------------------------ | --------------------------------------------------------- |
| `VITE_SUPABASE_URL`      | Supabase project URL                                      |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key. Never the `service_role` key. |

With either value missing the app runs in **local mode**: a "Local mode — not signed in / not syncing" banner,
everything is saved in IndexedDB on this device, and every edit still lands in the sync outbox (so nothing is lost
when sync is switched on later). With both set, the header offers **Sign in with Microsoft**
(`supabase.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email' } })`) and the status pill shows
Synced / N unsynced / Offline. Backend setup: [`supabase/README.md`](../supabase/README.md).

## Structure

```
src/
  data/        Dexie schema (db.ts), record types (types.ts), repository (repo.ts: setField + creates/deletes),
               live-query hooks (hooks.ts), device / user identity, dotted-path helpers
  sync/        outbox.ts (pending / markSynced / applyRemoteChanges, last writer wins), engine.ts
               (LocalSyncEngine no-op, SupabaseSyncEngine push/pull), SyncProvider.tsx (status, online/offline)
  auth/        lazy Supabase client + Microsoft sign-in
  domain/      equipmentTypes.ts (capacities from the template map), specs/ (field definitions per type: RTU and
               VAV complete, others identity-only), completion.ts (gray/amber/green/red engine), calc.ts, conditions.ts
  workbook/    adapter.ts (app records <-> ProjectData), exportProject.ts / importProject.ts (browser I/O)
  ui/          components/ (inputs with autosave, N/A menu, status badges, airflow table, photo slots) and pages/
e2e/run-e2e.ts Playwright walk-through;  scripts/  template copy, icon generation
```

### Data model and saving

Tables: `projects`, `equipment` (uuid, type, designation, slot, New/Existing, `data` = field values keyed by the
template map's field keys, `naState` = field / section / unit N/A marks), `airflowRows`, `issues` (numbered
separately for New and Existing), `photos` (Blob + metadata), `instruments`, `fieldChanges` (the outbox / audit log),
`meta`.

**Every write goes through `setField(table, id, 'data.serial', value)`**, which updates the record and appends a
FieldChange (record, field, value, user, device, timestamp, `synced = 0`) in one Dexie transaction. Consecutive
unsynced edits of the same field are coalesced. Inputs keep a local draft and commit after a short pause and on blur.

Airflow rows are **their own records**, not an array inside the unit: two people adding or editing different rows
of the same unit then never touch the same field, which is what the field-level sync merges on.

### Completion colors

`computeCompletion()` (pure, `src/domain/completion.ts`) takes the unit's field definitions, values, N/A marks,
rows, photos, the project's scope profile and tolerance, and open issues. Gray = nothing entered, amber = required
items missing, green = all required items filled or N/A, red = linked open issue or a reading outside ±tolerance
(default ±10 %). N/A levels: scope profile (Full TAB / Airflow Only / Custom), section, field, automatic (direct/ECM
drive, design OA 0, no VFD, 1-phase, no filters, unit-type components, VAV not fan-powered / no heating). A section
can be set to "Include (override scope)". Status is shown with a different icon shape per state, not color alone.

## How export works

1. `toProjectData()` turns the project's records into the workbook library's `ProjectData`: field keys route to the
   {Equipment Data Entry} row or the unit block by the template map; explicit N/A marks become `N/A` / `Not Avail.` /
   `Not Acc.` in the cell (revision 05 formulas skip them); automatic and scope-profile N/A are written as `N/A` too (a blank cell never means N/A), and on import a plain `N/A` the app would set by itself is read back as automatic; app-only answers
   ("VFD on the unit?") are not written; linked issues get a `RTU-1: ` prefix.
2. The template (`public/templates/tab-template-rev05.xlsm`, copied from the repo root at dev/build time and
   precached by the service worker) is fetched, `exportWorkbook()` patches only input cells in the sheet XML
   (formulas, macros, styles, print setup untouched), and the cover photo is cropped in the browser
   (`createImageBitmap` with EXIF orientation + canvas) to the cover box.
3. The browser downloads `<Project> - TAB Report <date>.xlsm`. Works offline.

Import runs `importWorkbook()` on a picked file and `fromProjectData()`; the confirmation screen creates a new
project or updates an existing one field by field (the full accept/decline diff review is Phase 3). Photos are not
in the workbook, so they don't round-trip.

## Tests

- `npm test`: 56 unit / component tests: outbox and repository (atomic setField, coalescing, rollback, cascades),
  remote apply (last writer wins, conflicts), completion engine (colors, all N/A levels, scope profiles, auto rules,
  tolerance incl. the ±10 % boundary, R8 discrepancy), adapter mapping and a **round trip against the real
  template** (app project → export → import → app project, equal), and jsdom UI tests (project list, create project,
  RTU form autosave / N/A / live CFM).
- `npm run build && npm run e2e`: serves `dist/` with `vite preview` and drives Chromium at 390 × 844 through
  create project → project info (+ cover photo) → 2 RTUs → RTU-1 filled (outlet rows, fill-down, one N/A) → card
  colors → tolerance → export (download checked with the importer in Node, incl. the browser-cropped cover photo)
  → reload (IndexedDB) → offline (service worker shell, edits, export) → re-import. Uses `PLAYWRIGHT_BROWSERS_PATH`
  or `CHROMIUM_PATH` (falls back to `/opt/pw-browsers/chromium`); never downloads a browser. Screenshots go to
  `e2e-screenshots/` (git-ignored); a few are kept in [`docs/screenshots/`](../docs/screenshots).

## Not done yet

Full forms for MAU, ERV, fans, small fans, hoods and traverses (they show identity + "coming soon" and can't turn
green); Supabase sync against a live project (engine written, untested); photo upload and reports (Phase 4–5);
import diff/merge review and issued-report revisions (Phase 3); Building Balance pressures, Certification.
