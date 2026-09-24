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
  domain/      equipmentTypes.ts (capacities from the template map), specs/ (field definitions for all 8 types;
               unitSections.ts = the data block RTUs / MAUs / ERVs / Fans share), completion.ts (gray/amber/green/red
               engine), calc.ts (outlet CFM / %), equipmentCalcs.ts (MAU PSP / filter grid / profile pressure, ERV,
               hood, traverse and Building Balance calcs mirroring the workbook), staticProfile.ts / motorCalcs.ts
               (static-pressure strip, TSP / ESP / unit ΔP, corrected FLA, estimated BHP), conditions.ts
  workbook/    adapter.ts (app records <-> ProjectData), exportProject.ts / importProject.ts (browser I/O)
  ui/          components/ (inputs with autosave, N/A menu, status badges, spec-driven row tables, reading grids,
               live-calc panels, photo slots) and pages/
e2e/run-e2e.ts Playwright walk-through (+ newTypes.ts: MAU, ERV, fan, small fan, hood, traverse);  scripts/  template
               copy, icon generation
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
drive, design OA 0, no VFD, 1-phase, no filters, unit-type components, VAV not fan-powered / no heating, MAU supply
method not chosen, hood VelGrid readings 2–3 and "No Filter" rows, round-duct height). A section can be set to
"Include (override scope)". Status is shown with a different icon shape per state, not color alone.

### Equipment forms

Every type is a spec in `src/domain/specs/` (data: sections, fields, required / conditional / optional flags,
dropdown lists from `@a2b/workbook`, automatic N/A rules, photos). Besides fields a section can hold:

- **row tables** (own records per row): outlets / inlets (RTU, MAU, ERV supply + exhaust, fans 56, small fans 6,
  VAVs), hood filters (size from the sizes that have constants for the filter type, stored exactly as `16" x 20"`;
  1 reading for VelGrid types, 3 for Airfoil) and the MAU filter grid (up to 11). Add, fill-down and duplicate rows.
- **reading runs** (`data.<key>_<i>`, one field per reading): MAU PSP velocities (20) and the traverse quick entry
  (80, laid out on the calculated point grid with the insertion positions). A reading or the whole run can be N/A.
- **live-calc panels** that mirror the workbook formulas: PSP CFM and CFM/ft (Evergreen K 0.88 / 0.95), filter
  grid (velocity × free area × 1.35), burner profile pressure (restored curve, linear interpolation, range
  warnings), MAU method total vs. design (override or outlet total), ERV supply / exhaust totals, hood CFM per
  filter / total / % / CFM per ft, traverse size, Ak, point layout, positions, VEL and CFM.
- **static profile and motor panels** (RTUs, MAUs, ERVs, fans), calculated on exactly the values the export writes
  (`unitCells()` in `workbook/adapter.ts`, so N/A marks count as the workbook's notation text):
  - the workbook's schematic strip (inlet → components → fan, leaving statics, `Δ` per component, "absent" for a
    `—` component), fan TSP, ESP and unit ΔP. Formulas (revision 05, identical on every block, P = anchor):
    entering k+1 = leaving k if not blank, else entering k (a blank passes through, a notation is passed on);
    ΔP k = leaving k − entering k (blank for a `—` component, a blank or a text operand; printed as
    `"Δ "&TEXT(…,"0.00")`); **TSP** = fan leaving − fan entering; **ESP** = fan leaving − unit entering
    (= "Unit ESP actual" on RTUs / MAUs / fans, shown next to the design unit ESP); **unit ΔP** = fan entering −
    unit entering;
  - average volts / amps (numeric legs only), **corrected FLA** = rated V ÷ AVERAGE(volts) × FLA (blank when volts
    L1 is blank, when FLA or the rated voltage is blank / text, or no volts leg is a number), **estimated BHP** =
    1-phase: V1 × A1 × 0.8 × 0.9 ÷ 746 (blank when L1 volts or amps is text; a blank L1 counts as 0), otherwise
    (any phase that isn't `1-phase`, incl. blank) AVERAGE(volts) × AVERAGE(amps) × 0.8 × 0.9 × 1.732 ÷ 746;
  - values marked **report** are the ones the workbook prints (same formula, same N/A rules);
  - amber field checks (warnings, never blocking or changing the unit color): a measured amps leg above corrected
    FLA × SF (nameplate FLA if the corrected FLA can't be calculated, SF 1.0 if none), estimated BHP above the
    nameplate HP, and the actual ESP outside ± the project tolerance of the design unit ESP (also shown in the unit
    summary beside the R8 design-CFM discrepancies).

MAU: the "Method used" selector shows only that method's inputs; the other methods' inputs are automatically N/A
even if values were entered before (kept, restored when switching back, exported as `N/A`). Outlet rows are
required only with Outlets. MAU (method total), hood (total) and traverse (CFM) are checked against design with the
project tolerance at unit level; outlet tables row by row. Small fans past slot 30 show the Building Balance
warning.

## How export works

1. `toProjectData()` turns the project's records into the workbook library's `ProjectData`: field keys route to the
   {Equipment Data Entry} row or the unit block by the template map; explicit N/A marks become `N/A` / `Not Avail.` /
   `Not Acc.` in the cell (revision 05 formulas skip them); automatic and scope-profile N/A are written as `N/A` too (a blank cell never means N/A), and on import a plain `N/A` the app would set by itself is read back as automatic. **Exception:** the leaving static of
   a static-profile component that is `—` on the unit type (or the filter on a unit without filters) is left blank:
   the workbook's strip reads a blank as "component absent" and passes the entering static through, while an `N/A`
   would be passed on and blank the downstream ΔP, the fan TSP and the unit ΔP; app-only answers
   ("VFD on the unit?") are not written; linked issues get a `RTU-1: ` prefix.
2. The template (`public/templates/tab-template-rev05.xlsm`, copied from the repo root at dev/build time and
   precached by the service worker) is fetched, `exportWorkbook()` patches only input cells in the sheet XML
   (formulas, macros, styles, print setup untouched), and the cover photo is cropped in the browser
   (`createImageBitmap` with EXIF orientation + canvas) to the cover box.
3. The browser downloads `<Project> - TAB Report <date>.xlsm`. Works offline.

N/A tables (e.g. an unchosen MAU filter grid) and N/A reading runs are written as the notation in their first cell;
hood filter readings go to the off-print P–U cells only (never the J/L averages); traverse readings go to the P:W
quick entry only; hood and traverse remarks use the page's shared remark box (hoods: lines 1–3 / 4–5, traverses:
one line each).

Import runs `importWorkbook()` on a picked file and `fromProjectData()`; the confirmation screen creates a new
project or updates an existing one field by field (the full accept/decline diff review is Phase 3). Photos are not
in the workbook, so they don't round-trip.

## Tests

- `npm test`: 147 tests (11 in `packages/workbook`: list and constants copies vs. the template, a map audit that
  fills **every** block of every type, round trip, safety; 136 in the app): outbox and repository, remote apply,
  completion engine for all 8 types (colors, N/A levels, scope profiles, auto rules incl. MAU method switching,
  small-fan R6, traverse R7, hood readings, tolerance, R8 discrepancies), live calcs against the workbook's values
  (hood 5 × 16" x 20" Captrate = 2049.29 CFM, PSP, profile-pressure curve, traverse Ak / positions for 24" × 12" and
  10" round), static profile and motor data against the revision 04/05 functional-test and export-spike values
  (incl. notation cases), a **generated LibreOffice cross-check** (`staticMotor.recalc.test.ts`: 52 varied RTUs /
  MAUs / ERVs / fans — every unit type, 1- / 3- / blank phase, blank and N/A legs, negative statics, notations in the
  chain — exported onto the template, recalculated, 1,446 cells equal to the app's functions, max deviation ~5e-14;
  skipped where `soffice` is missing, e.g. CI), adapter mapping and a **round trip against the real template** with a fully filled unit of every
  type incl. N/A cases (app project → export → import → app project, equal), and jsdom UI tests.
- `npm run build && npm run e2e`: serves `dist/` with `vite preview` and drives Chromium at 390 × 844 through
  create project → project info (+ cover photo) → 2 RTUs → RTU-1 filled (outlet rows, fill-down, one N/A) → card
  colors → tolerance → one MAU (PSP; method switched to Filter Grid and back), ERV, fan, small fan, hood and
  traverse filled to green → export (download checked with the importer in Node, incl. the browser-cropped cover
  photo) → **LibreOffice recalculation** of the export: 0 error cells and the MAU method total, hood total,
  traverse CFM, ERV totals, Building Balance totals and the TSP / ESP / unit ΔP / ΔP texts / corrected FLA / BHP
  of RTU-1, MAU-1, ERV-1 and EF-1 equal the app's live calcs and what the panels showed → reload (IndexedDB) → offline
  (service worker shell, edits, export) → re-import. Uses `PLAYWRIGHT_BROWSERS_PATH` or `CHROMIUM_PATH` (falls back
  to `/opt/pw-browsers/chromium`) and `soffice` for the recalculation; never downloads a browser. Screenshots go to
  `e2e-screenshots/` (git-ignored); a few are kept in [`docs/screenshots/`](../docs/screenshots) (07–12: the new
  forms; 13: RTU motor and static-profile panels).

## Not done yet

Supabase sync against a live project (engine written, untested); photo upload and reports (Phase 4–5);
import diff/merge review and issued-report revisions (Phase 3); Building Balance pressures, Certification; the hood schedule's "KEF interlock" column (EDE G, info only, not linked) is not
written (the hood page's own "Associated exhaust fan" is).
