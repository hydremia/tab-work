# TAB App (`app/`)

Offline-first, mobile-first PWA for HVAC test-adjust-balance field data entry. It fills and reads the a2b TAB
workbook, **revision 05** (`05 - a2b_Blank_TAB_Workbook 9-23-26.xlsm` at the repository root). Plan and decisions:
[`docs/ROADMAP.md`](../docs/ROADMAP.md), [`docs/TRACKER.md`](../docs/TRACKER.md),
[`docs/REQUIRED_FIELDS.md`](../docs/REQUIRED_FIELDS.md).

Stack: React 19 + TypeScript (strict) + Vite 7, React Router 7, `vite-plugin-pwa` (installable, offline app shell,
update on prompt), Dexie (IndexedDB), Supabase (optional, behind env vars), Vitest + Testing Library + fake-indexeddb,
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
| `serve-dist`                             | Serve `dist/` with the production headers (CSP, caching) and SPA fallback, http://localhost:4173         |
| `hosting-config`                         | Regenerate `vercel.json`, `netlify.toml`, `public/_headers`, `public/_redirects` from `deploy/hosting.ts` |
| `pwa-check`                              | Check a build: manifest, icons, iOS meta tags, service-worker precache, headers files (no browser)        |
| `icons`                                  | Redraw the icon set (`scripts/make-icons.mjs`) and its preview `docs/screenshots/28-icons.png`           |

The root `package.json` also has `lint`, `typecheck`, `test` (package + app) and `build`; CI
(`.github/workflows/ci.yml`) runs those, then `pwa-check`, and uploads `dist/` as the artifact `app-dist-<commit>`.
Deploying (Vercel, Netlify, Cloudflare Pages), the security headers and how to verify a deploy:
[`docs/DEPLOY.md`](../docs/DEPLOY.md).

## Install, updates, export reminder, Share

- **Install** (`src/pwaState.ts`, `ui/components/PwaPrompts.tsx`): `beforeinstallprompt` is captured
  (`registerPwa()` in `src/pwa.ts`) and the Projects screen shows *Install app*; on iPhone / iPad (no such event) a
  *Share → Add to Home Screen* hint. Hidden when running standalone or after `appinstalled`; *Not now* / *Got it* is
  remembered in `localStorage` (best effort).
- **Updates:** `registerType: 'prompt'`. A new service worker installs and waits; `onNeedRefresh` shows the toast
  *Update available — Reload* (Root of `App.tsx`); Reload posts `SKIP_WAITING` and reloads once the new worker
  controls the page. `clientsClaim` keeps the first install in control right away (offline from the first visit).
  `registration.update()` runs hourly while online.
- **Export reminder** (`data/exportStatus.ts`, `ui/components/ExportReminder.tsx`): changes since the newest export =
  history entries of kind edit / create / delete after the export's own `revision` event (fallback: the revision's
  time when that event was pruned). Project cards and the Export tab show *Last exported … · N changes since*;
  `ProjectLayout` blocks in-app navigation out of the project (`useBlocker`) in local mode while N > 0, unless
  snoozed for the day (`localStorage`). Moving inside the project, re-importing its workbook and deleting it are
  never blocked.
- **Share…** (`ui/components/ShareFile.tsx`): after a workbook / PDF / zip export, `navigator.share({ files })` where
  `navigator.canShare` accepts the file (iOS: all; Android Chrome: PDFs), else *Download again*.

## Environment and local mode

Copy `.env.example` to `.env.local` and fill in both values to enable Supabase:

| Variable                 | Value                                                     |
| ------------------------ | --------------------------------------------------------- |
| `VITE_SUPABASE_URL`      | Supabase project URL                                      |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key. Never the `service_role` key. |

With either value missing the app runs in **local mode**: a "Local mode — not signed in / not syncing" banner,
everything is saved in IndexedDB on this device, and every edit still lands in the sync outbox (so nothing is lost
when sync is switched on later). With both set, the app offers **Sign in with Microsoft** and syncs (next section).
Switching it on for real (migrations, bucket, Azure provider, Vercel, first sign-in, rollback):
[`docs/SYNC_SETUP.md`](../docs/SYNC_SETUP.md). Backend reference: [`supabase/README.md`](../supabase/README.md).

## Sign-in and sync (Phase 5)

Built and tested without accounts: against an in-memory fake server with the server's rules
(`src/sync/fakeServer.ts`, the same rules as `supabase/migrations/0003_sync_rules.sql`) and a mocked Supabase auth
client. Nothing has run against a real Supabase project yet.

**Sign-in** (`src/sync/cloud.ts`, `src/auth/supabase.ts`, pages in `src/ui/pages/SyncPages.tsx`). The status pill in the
header opens **Sync & account** (`/account`): sync state, last sync, *Sync now*, *Sign in with Microsoft*, *Sign out*,
and projects kept on this device only. Sign-in is the Supabase Azure provider with PKCE: Microsoft → Supabase →
`/auth/callback`, which exchanges the code for the session (errors from Microsoft, e.g. "not assigned to the app", are
shown there with *Try again*). The session is kept in localStorage and refreshed automatically, so the app opens signed
in. **Sign out** asks first and, when changes have not synced, says how many and that they stay on the device; local
data is kept and syncing stops until someone signs in again. **First sign-in on a device with local projects**:
syncing waits (pill *Choose projects*, banner) until the user picks on **Move projects to the cloud** (`/cloud-setup`)
which projects to upload (all ticked); they go up through the normal push, the others stay on this device only
(`meta.localOnlyProjects`, never pushed; *Move to the cloud* later from Sync & account).

**Engine** (`src/sync/engine.ts`, `CloudSyncEngine` over a `SyncBackend`: `supabaseBackend.ts` or the fake). A sync =
measure the clock offset → pull → release held changes → push → pull again if something was pushed → photo files. It
runs 1.5 s after an edit, every 30 s, when the device comes back online, and on a Realtime insert hint.

- **Push**: the outbox oldest first, 200 changes per request (one request is atomic on the server); each row carries
  the device's pull position (`base_seq`) and a server-corrected timestamp. A retried push is harmless: the server skips
  ids it already has. An edit made while its push is in flight (the outbox coalesces repeated edits of a field into the
  unsynced entry) is kept: the pushed value stays under its id and the newer value is re-queued under a new id.
- **Pull**: the organization's log by `server_seq`, 500 per page. The saved restart point only advances over rows
  older than 2 minutes (server time), so a request that got a lower seq but committed later is not skipped; re-read
  rows are recognised by id. Applied in server order, last writer wins per field (the server's rule), remote changes
  logged as synced; a pulled project delete cascades on the device.
- **Clocks**: timestamps decide which of two edits of a field wins ("the later edit wins", also for edits made offline
  hours before they sync), so each sync measures the offset to the server clock (`server_time_ms()`, half the round
  trip) and pushes `ts + offset`; pulled timestamps are converted back. A phone whose clock is 10 minutes fast does not
  win every conflict. (Assumes the offset is about the same between an offline edit and its push.)
- **Report lock from another device**: the pull brings the lock, the forms turn read-only and an edit typed meanwhile
  is refused with a message (*Not saved: the report was issued as Prelim; unlock the project to edit.*, a toast for
  any refused save). Edits made on this device *before* the lock arrived are **held** (`synced = 2`) instead of pushed
  (or when the server answers `TAB_LOCKED`): kept on the device, listed in Attention as *N changes not synced*, pushed
  automatically when the project is unlocked, or **discarded** (records rebuilt from the log without them).
- **Photos** (`src/sync/photoSync.ts`): files upload after their project is on the server (bucket `photos`,
  `<projectId>/<photoId>.jpg`), retried with backoff 5 s, 10 s, 20 s … ≤ 1 h; the queue is in IndexedDB, so it resumes
  after a reload (an upload interrupted by closing the app is retried). A photo deleted after upload queues the file's
  removal; other devices get the record delete. Photos pulled from other devices show *Downloading…* until their file
  is fetched (a few per sync).

**Conflicts** (`src/sync/conflicts.ts`, docs/ROADMAP.md rule). Two edits of the *same field* conflict when neither
device had seen the other's edit: `A.baseSeq < B.serverSeq` and `B.baseSeq < A.serverSeq` (an edit not on the server
yet cannot have been seen). The later edit wins everywhere; **both** devices record the conflict when they pull the
other's edit (Dexie v5 table `conflicts` + a history event), so an ordinary later correction ("I saw your value and
changed it") is not flagged and different fields merge silently. Shown as a **Conflict** badge on the unit card, a flag
on the field's label, a *Sync conflicts* card on the unit page and a **Conflicts** group at the top of the Attention
tab (counted in its badge): both values, which device, when. **Keep current** closes it; **Use "…"** restores the other
value through `setField` (a normal edit: it syncs, wins everywhere and settles the conflict on the other device;
refused while locked). A later deliberate edit of the field also settles it.

**Server rules** (0003, also in the fake server): lock refusals, review clearing when a change reaches the server for
a unit whose review the device had not seen, idempotent retries, project deletes; see
[`supabase/README.md`](../supabase/README.md#0003-server-side-sync-rules).

## Structure

```
src/
  data/        Dexie schema (db.ts), record types (types.ts), repository (repo.ts: setField + creates/deletes, report
               lock, review), change history (history.ts: append / prune), live-query hooks (hooks.ts), device / user
               identity, dotted-path helpers
  sync/        outbox.ts (pending / markSynced / hold / release / applyRemoteChanges, last writer wins), engine.ts
               (LocalSyncEngine no-op, CloudSyncEngine), backend.ts (SyncBackend interface, row mapping, errors),
               supabaseBackend.ts, fakeServer.ts + fakeBackend.ts (in-memory server with the 0003 rules; tests),
               fakeHttp.ts (the fake over HTTP, VITE_FAKE_SYNC builds only), conflicts.ts (detection, resolve,
               discard held), photoSync.ts (upload / delete / download queue), cloud.ts (auth + backend, lazy),
               SyncProvider.tsx (status, online/offline, onboarding, sign-in / out)
  auth/        supabase.ts: lazy Supabase client, Microsoft sign-in (PKCE), callback, sign-out
  domain/      historyView.ts (history labels, old / new text, filters, grouping), projectFields.ts,
               scheduleImport.ts (schedule paste / file -> preview), duplicate.ts, projectCompletion.ts (project-level
               completion incl. building pressures), attention.ts (needs-attention list), instruments.ts (instrument
               kinds vs. calibration rows),
               equipmentTypes.ts (capacities from the template map), specs/ (field definitions for all 8 types;
               unitSections.ts = the data block RTUs / MAUs / ERVs / Fans share), completion.ts (gray/amber/green/red
               engine), calc.ts (outlet CFM / %), equipmentCalcs.ts (MAU PSP / filter grid / profile pressure, ERV,
               hood, traverse and Building Balance calcs mirroring the workbook), staticProfile.ts / motorCalcs.ts
               (static-pressure strip, TSP / ESP / unit ΔP, corrected FLA, estimated BHP), conditions.ts
  workbook/    adapter.ts (app records <-> ProjectData), exportProject.ts / importProject.ts (browser I/O),
               reimportDiff.ts (three-way diff, pure), reimportApply.ts (decisions -> operations), revisions.ts
  photos/      exif.ts (EXIF orientation / capture time / GPS, image math), process.ts (decode, orient, downscale,
               thumbnail), capture.ts (process + store, persistent storage), labels.ts (groups, numbering, zip names)
  reports/     layout.ts (page / grid / pagination math, text wrap), model.ts (what goes in a report), pdf.ts
               (pdf-lib renderer), generate.ts (browser entry: IndexedDB loader, zip, download)
  ui/          components/ (inputs with autosave, N/A menu, status badges, spec-driven row tables, reading grids,
               live-calc panels, photo slots) and pages/
deploy/       hosting.ts (headers, caching, CSP, SPA fallback for every host), serve-dist.ts (local server with them),
               pwa-check.ts, write-hosting-config.ts
e2e/run-e2e.ts Playwright walk-through (+ newTypes.ts: MAU, ERV, fan, small fan, hood, traverse; reimport.ts;
               photos.ts: photos, issues with photos, PDF reports, zip; features.ts: schedule import, duplicate,
               building pressures, needs attention; workflow.ts: review, issue / lock, unlock,
               history; deploy.ts: install prompt, update toast, Share / fallback, export reminder, custom scope on a MAU);
               scripts/  template copy, icon generation
```

### Data model and saving

Tables: `projects`, `equipment` (uuid, type, designation, slot, New/Existing, `data` = field values keyed by the
template map's field keys, `naState` = field / section / unit N/A marks), `airflowRows`, `issues` (numbered
separately for New and Existing), `photos` (Blob + metadata), `instruments`, `fieldChanges` (the outbox / audit log),
`meta`.

**Every write goes through `setField(table, id, 'data.serial', value)`**, which updates the record and appends a
FieldChange (record, field, value, previous value, user, device, timestamp, `synced = 0`) and a history entry in one
Dexie transaction. Consecutive unsynced edits of the same field are coalesced in the outbox (not in the history).
Inputs keep a local draft and commit after a short pause and on blur. The repository also enforces the report lock
and clears reviews (next section).

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

## Review, report lock and change history (Phase 6)

**Review / sign-off.** Any user (decision F4) can mark a **green** unit *Reviewed* on its page (unit summary → reviewer
name, remembered on the device → *Mark reviewed*). `markReviewed()` (repo) re-checks the completion and stores
`equipment.review = { name, userId, deviceId, at }` **through `setField`**, so it syncs. A reviewed unit shows the
**blue** state (own icon shape: a filled square with a double check) on its card, badge and the progress bars; rollups
count it as complete *and* reviewed: "RTUs 5/8 complete, 3 reviewed", "12 of 20 complete · 3 reviewed" on the
Equipment tab and the project list, "Reviewed: 3 of 20 units" on Export; filters *To review* / *Reviewed*. Blue is a
display state (`displayColor()`): the completion engine still says green, and a reviewed unit that stops being green
(e.g. an issue opened on it) shows its real color. **Any change to a reviewed unit** — its fields, N/A marks, New /
Existing, outlet / filter rows (added, edited, removed), its photos — **clears the review in the same transaction**
(`review = null`, history entry *Review cleared automatically*). This happens in the repository, so imports and schedule
imports clear it too. Another device's edit is cleared by that device (the clear syncs). *Clear review* is also a button.

**Report lock.** Export tab → **Issue report as Prelim / Rev 1 …**: after a confirm dialog, the workbook is exported as
that revision (the normal export: downloaded, kept as a revision, marked *Issued*) and the project is locked:
`project.lock = { label, revisionId, name, userId, deviceId, at }`, a synced project field. While locked:
- the repository refuses **every** write to the project's records (`LockedError`: setField, create, delete, reviews,
  photos, issues, instruments, schedule import, re-import apply); only the `lock` field itself (unlock) and deleting
  the whole project are allowed. `prepareReview()` refuses a locked project too;
- every project page shows the banner **"Issued as Rev 1 on Sep 24, 2026 — unlock to edit"** with *Unlock*; forms are
  read-only (`<fieldset disabled>`: Info, unit pages, Issues, Photos' add / viewer controls); Add equipment, Import
  schedule and Re-import are hidden / blocked (the import screen offers Unlock, then continues to the review);
- exports and PDF reports still work (they don't change data); the project list shows an *Issued* chip.
**Unlock for follow-up** (banner or Export tab): a confirm dialog naming the issued revision and the next label
(`suggestLabel()`: Prelim → Rev 1 → Rev 2). Who / when is in the history (and in the synced field change).

**Change history.** A separate **append-only** table `history` (Dexie schema **v4**), because the outbox coalesces
repeated unsynced edits of a field (one sync row, not one per pause) and would lose the intermediate values. Every
repository write appends an entry in the same transaction: project, time, kind (`edit`, `create`, `delete`, `review`,
`review-cleared`, `lock`, `unlock`, `import`, `revision`), table / record / field, the unit it belongs to (the unit, its
rows and photos, linked issues), **previous and new value**, user id, reviewer name, device, and the source
(re-import, schedule import, synced, automatic). Export / re-import revisions add an event; changes pulled from other
devices are added when applied (previous = the local value before). New outbox entries also carry `previous` (the value
before the first coalesced edit). The v4 upgrade backfills the history from the existing outbox / audit log; those
entries have no previous value and show "—". The history is local (each device builds it from its own edits plus what
it pulls); it is not pushed.
- **History tab** (`/p/:id/history`): newest first, grouped by day, then runs of edits by the same person on the same
  unit within 10 minutes; each line is "Field label: old → new" with readable labels ("Supply outlets S-2: Final VEL",
  "FLA N/A", "Kitchen vs Dining remarks", "Issue E-3 remark") or an event ("Report issued and locked as Prelim",
  "Report unlocked for follow-up (was Prelim)", "Marked reviewed by Dana", "Issued Prelim (file.xlsm)"). Filters
  (collapsible): unit (or project-level only), field text, date range, user / device.
- **Unit page → History**: the unit's own entries, with a link to the History tab filtered to it.
- **Storage:** `pruneHistory()` runs at start-up: entries older than **12 months** are dropped, and each project keeps at
  most the newest **5,000** (~0.2–0.5 kB each, so ≤ ~2.5 MB per project). Deleting a project deletes its history.
- Server: `supabase/migrations/0002_review_lock.sql` adds the `review` / `lock` columns and their sync-column rows
  (checked on PostgreSQL 16). Every device's repository enforces the lock, and since `0003_sync_rules.sql` the server
  does too (a change pushed into a locked project is refused and held on the device until the project is unlocked; see
  *Sign-in and sync*).

## Equipment schedule import

Equipment tab → **Import schedule** (or *Import* next to a type's heading, which preselects the type). Route
`/p/:id/schedule`, code in `domain/scheduleImport.ts` (pure) and `ui/pages/ScheduleImportPage.tsx`.

- **Sources.** *Paste rows*: rows copied from Excel or an engineer's schedule (tab-separated; comma / semicolon CSV
  with quotes also works). *CSV / Excel file*: `.csv` / `.tsv` / `.txt`, or `.xlsx` / `.xlsm` (every sheet read as a
  grid by `readSheetRows()` in `@a2b/workbook`; a sheet picker when there are several; date-formatted cells become ISO
  dates). *TAB workbook*: an existing a2b workbook; `readScheduleSection()` reads **only the {Equipment Data Entry}
  section** (every type at once; the untouched template's sample designations are ignored) — readings, remarks and
  project data are not imported (that is *Import workbook*). A TAB workbook picked as a CSV / Excel file is recognised
  and offered as a TAB workbook. File reading is lazy-loaded with the workbook library.
- **Columns.** The targets are the {Equipment Data Entry} columns the app has a field for (RTU / MAU / fan: designation,
  area served, location, manufacturer, model, HP, ESP, fan RPM, motor sheave, fan pulley, belts, C-C, voltage, phase,
  design total / OA CFM; ERV: supply / exhaust CFM and ΔP; small fans: HP, voltage, phase, design CFM; VAV: inlet
  size, terminal type, design max / min / heating / fan CFM, DDC address; hoods: manufacturer, design CFM, model,
  length; traverses (no EDE section): designation, area served, design CFM, shape, width, height, liner). The first row
  is taken as headers when it maps at least two columns (a checkbox overrides); headers are matched by synonyms
  ("Mark", "Tag", "Mfr", "Supply CFM", "OA CFM", "E.S.P.", "Max CFM", "Htg CFM", "DDC Address", "V/Ph/Hz" …; exact
  matches first, then the longest whole-word match, each field used once). Every column has a select to change or
  ignore it. Without headers the first column is the designation.
- **Validation (preview table).** Numbers: thousands separators, units (`1,200 CFM`, `0.75 in. w.g.`) and fractions
  (`1/2`, `1-1/2`, `¾`) are accepted; anything else is an error for that row. Phase: `1`, `1 ph`, `single`, `3`, `3Φ`,
  `three` … normalised to `1-phase` / `3-phase` (the BHP formula needs exactly that text); a `460/3/60` voltage fills
  the voltage and, when the phase is blank, the phase. Voltages outside 115 / 120 / 200 / 208 / 220 / 230 / 240 / 277 /
  380 / 460 / 480 / 575 / 600 are a warning. Selects (traverse shape) take a case-insensitive / prefix match. A row with
  no designation, a designation repeated in the paste (the later row) or an error is **skipped**. A designation that
  already exists (case-insensitive) **updates** that unit; the others are **new** and get the next free slots in order.
  Rows past the type's capacity (RTU 40, MAU 10, ERV 10, fans 40, small fans 40, VAV 80, hoods 20, traverses 48) are
  skipped as *over capacity*; small fans landing past slot 30 get the Building Balance warning. The summary shows new /
  updated / skipped and the count after the import against the capacity.
- **Writing.** `applyScheduleImport()` (repo): one transaction per type; a new unit is created like *Add equipment*
  (New or Existing as chosen), then **every value goes through `setField`** (field changes in the outbox). An update
  writes only the values the schedule has: a blank schedule cell never clears an app value.

## Duplicate a unit

Unit page → **Duplicate** (`duplicateEquipment()`, `domain/duplicate.ts`). The designation is suggested by
incrementing its trailing number past the ones in use (`VAV-12` → `VAV-13`, or `VAV-14` when 13 exists;
`EF-S3` → `EF-S4`); the unit goes into the next free slot (shown). Copied: the schedule fields and the unit's set-up
(unit type, drive type, motor nameplate, filters, VFD answer, instrument(s), MAU method / PSP size / housing, hood
type / filter type, small-fan design values), their field N/A marks and section N/A marks, New / Existing. Not copied:
serial number, readings, remarks, photos, the whole-unit N/A. Optionally (default on) the outlet / filter rows are
copied **without their readings** (initial / final velocities, hood readings, filter-grid velocities).

## Building pressures

Project Info → **Building pressures (Building Balance)**, stored as project fields `info.bb*` (so they sync, diff and
re-import like the other project fields): Building vs Outdoors ΔP (required) and remarks; Kitchen vs Dining ΔP
(required when the project has a hood, otherwise automatically N/A) and remarks; a spare pair (test space, reference
space, ΔP, remarks, all optional); notes (up to 3 lines). Every value can be marked N/A / Not Avail. / Not Acc.
Export writes the table to Building Balance rows 97–99 (B test space, E reference space, H ΔP, K remarks; B:E of the
first two rows always get the template's labels Building / Outdoors and Kitchen / Dining, so they print even when the
sheet was cleared) and the notes to B102–B104; the automatic kitchen N/A is written as `N/A` and read back as automatic.
These are typed input cells in revision 05 (no formulas; checked with the recalculation in the e2e run). The section is
reset when exporting onto a base workbook. The re-import review compares every pressure value and the notes (group
*Building pressures*; remarks and notes count as remarks for *Accept all remarks*).

**Project-level completion** (`domain/projectCompletion.ts`, card at the top of Info): project name and the required
Project Information fields (REQUIRED_FIELDS.md), narrative, cover photo (can now be marked N/A), calibration (at least
one instrument, every started row complete) and the building pressures. Each missing item links to its card.

## Needs attention

Project tab **Attention** (count badge on the tab and a card on the Equipment tab), `domain/attention.ts`. One list,
grouped, every item linked to the unit (and section) or page:
out of tolerance (outlet rows, MAU method / hood / traverse totals), open issues, design discrepancies (R8 schedule
design CFM vs. outlet design sum; unit ESP actual vs. design outside ± tolerance), motor checks (amps above corrected
FLA × SF, estimated BHP above the nameplate HP), missing required photos (started units only), calibration
(instruments used without a calibration row, or whose calibration date is more than 12 months before the TAB date or
missing), capacity (a type at its workbook capacity; small fans past slot 30).

## Instruments and calibration

New projects start with the template's 7 a2b instruments (`DEFAULT_INSTRUMENTS`); Info → Instruments edits, removes
and adds them (8 slots, the Calibration sheet's capacity). A calibration date more than 12 months before the TAB date is
flagged there. Unit, traverse and hood pages pick an instrument *kind* from the workbook's lists; the picker shows a
warning when no calibration row covers that kind (`domain/instruments.ts`: Flow Hood → a balometer / flow hood;
Velocity Grid, Pitot Traverse, the Manometer/… traverse kinds and the Evergreen VelGrid / Airfoil hood kinds → a
(micro)manometer; hot-wire and rotating-vane anemometers → that meter; DDC / controller readings and "Other" need none).
Readings imply meters for the needs-attention list too: volts / amps → a voltage / amperage meter, RPM → a tachometer,
static pressures → a manometer.

## Code splitting

Every page is its own chunk (`React.lazy` in `App.tsx`; the project list and the project frame load with the app), the
workbook library (JSZip) and pdf-lib load on first use. Main bundle ~550 kB (under Vite's 600 kB warning, which is left
at its default); every chunk is precached by the service worker, so pages still open offline.

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

Import runs `importWorkbook()` on a picked file and `fromProjectData()`. Photos are not in the workbook, so they
don't round-trip: a new project's units stay amber until photos are added; a re-import into the same project keeps
its photos.

## Re-import, revisions and the base workbook

**Revisions.** Every export is a frozen revision (label Prelim, Rev 1, Rev 2 … suggested, editable) kept in the
`revisions` table (Dexie schema v2): label, date, file name, size, the `.xlsm` bytes and the **baseline**, i.e. the
values the workbook holds (`importWorkbook()` of the exported file). The Export tab lists them (re-download, import
entries with accepted / declined counts). Revisions are local to the device (not in the sync outbox).

**Revision marker.** The exporter writes custom document properties `a2bTab.projectId`, `a2bTab.revisionId`,
`a2bTab.revisionLabel`, `a2bTab.exportedAt` (`docProps/custom.xml` + its relationship and content type; other
custom properties are kept; nothing on the sheets changes). Excel and LibreOffice keep custom properties when they
save (LibreOffice verified in the e2e; Excel not testable here).

**Re-import.** Export tab → *Re-import workbook*, or pick any workbook on the Import screen: a workbook whose marker
names a project on this device goes straight to the review; otherwise *Create new project* or *Compare with
project…* (two-way). The review (`workbook/reimportDiff.ts`, pure) is a three-way diff per value: base = the
baseline of the revision in the marker (else the project's latest export; with none, a two-way diff where every
difference is incoming), app = the project now, wb = the file. `wb == base` → nothing; `app == base` → incoming change
(accepted by default); `wb == app` → nothing; else a **collision** (no default: *Use app* / *Use workbook*, showing the
exported, app and workbook values). All three sides are compared as the workbook holds them (the app side is
exported first, all sides are read back with the importer's adapter, so automatic N/A never shows as a change) after
normalization: number noise (12 significant digits), numbers stored as text, date serials / US dates vs ISO, text
trimmed (line ends, trailing spaces, non-breaking spaces), N/A notation case (`n/a` → `N/A`, `not acc` → `Not Acc.`).
Formatting is never compared. Covered: project info, narrative, tolerance, blueprints, calibration, issues (remark,
status, comments, linked unit; issues added / removed), every unit field incl. N/A marks and whole-table / reading-run
N/A, outlet / filter rows (matched by table + position, or by `No.` when every row has a unique one; rows added /
removed), units added / removed (matched by type + slot; removing a unit is declined by default). Group actions:
*Accept all incoming*, *Accept all remarks*, *Accept all in this unit* (never resolve collisions). Unit colors after
the merge are previewed. **Apply** (enabled once every collision is resolved) writes the accepted values through
`setField` / `createRecord` / `deleteRecord` in one transaction (field changes in the outbox), keeps the file as the
project's **base workbook** and records an *Imported* revision. Cancel changes nothing. Building Balance pressures and
notes are compared too (group *Building pressures*).

**Export onto the base workbook (F1).** With a base workbook, the export writes into it instead of the blank template,
after `checkTemplateCompatibility()` (every template sheet and dropdown list present, every template formula still a
formula at the same address, and revision 05's N/A-safe formulas; revision 04 is rejected). Before writing, every input
cell the app owns (project sections, every block / data-entry row of every unit type, used or not) is reset to the
blank template's value, so values removed in the app are cleared (value only; the cell keeps the issued workbook's
style). Hand formatting — cell styles, column widths, row heights, text in non-input cells, other sheets, extra custom
properties — is kept. An Excel save's shared strings and stale `calcChain.xml` are handled (the chain is removed;
Excel rebuilds it). If the base is incompatible or the write fails, the export falls back to the blank template with a
warning. *Use the blank template instead* on the Export tab forgets the base.

**Storage on the device.** A revision-05 workbook is ~4 MB. Only the newest **5** exports of a project keep their
file (`KEEP_REVISION_FILES`); older revisions keep label, date, size and baseline values (tens to a few hundred KB),
which is all a re-import needs. The base workbook is one more file per project, so a project uses at most about
6 × 4 MB. Deleting a project deletes its revisions and base workbook.

## Photos

**Taking photos.** Every photo button offers *Take photo* (`<input capture="environment">`: opens the camera on a
phone) and *Choose* (camera roll / file picker, several at once where it makes sense); the Photos tab and the issue
editor also accept drag & drop on desktop. Unit forms keep their required slots (unit, tag / label, OA damper where
OA applies; each can be marked N/A) with icon buttons, real thumbnails and tap-to-view; the cover photo is on Info.

**Processing** (`src/photos/process.ts`, before anything is stored, one file at a time): decode with
`createImageBitmap(…, { imageOrientation: 'from-image' })` (fallback `<img>`), so EXIF orientation is applied; if a
browser returned a 90°-rotated JPEG un-rotated (detected from the swapped size) the rotation is applied on the
canvas (`orientationTransform`). Then downscale to a long edge of **2000 px**, JPEG **0.8**, plus a **320 px**
thumbnail (JPEG 0.7). The EXIF capture time (`capturedAt`) and GPS position (`gps`, metadata only) are read with a
small parser (`src/photos/exif.ts`); every other EXIF tag is dropped by the re-encode. HEIC: iPhone Safari hands
over a JPEG; a browser that cannot decode a file shows a clear message (HEIC-specific when the file is HEIC).

**Storage.** Dexie schema **v3**: `photos` gains `thumb`, `width`, `height`, `capturedAt`, `gps`, `order` and an
`issueId` index; the upgrade gives old photos an order and an upload-queue entry (their thumbnails fall back to the
full image). `photoUploads` is the upload queue for Supabase Storage (one entry per photo, `pending` → `done`,
bucket `photos`, path `<projectId>/<photoId>.jpg`); it only waits in local mode; signed in, `src/sync/photoSync.ts` uploads it (see *Sign-in and sync*). Photo
metadata syncs through the field-change outbox like every other record (the Blobs are never in the outbox). The
Photos tab shows the storage used by the project, the upload queue and whether storage is persistent:
`navigator.storage.persist()` is requested on the first photo and can be asked again from there.

**Categories and links.** cover, unit, tag, OA damper, deficiency, other. A photo has a caption, optional linked
unit, the linked issue (deficiency photos), created / captured time and an order within its group. Groups:
*Cover*, each *unit*, each *issue* (deficiency photos), *General*. Deleting a unit deletes its photos; deleting an
issue deletes its deficiency photos (both ask first).

**Photos tab**: required photos still missing (per unit, linking to the unit), add general / unit photos, filter by
category, thumbnails grouped by cover / unit / issue / general; tap for the viewer: full size, caption, category /
unit / issue reassignment, move earlier / later within the group, delete.

**Numbering** (`src/photos/labels.ts`; labels are computed, never stored):
- issues are numbered separately and shown as **N-1, N-2 …** (New, *Summary - New*) and **E-1, E-2 …**
  (Existing, *Summary - (E)*); the workbook still gets the plain number in its own sheet;
- the k-th deficiency photo of an issue is **Photo N-3.1, Photo N-3.2, Photo E-1.1** (the prefix keeps the two
  lists apart when both are in one report); moving a photo within its issue or moving an issue up / down (↑ ↓ on the
  issue card swap numbers) relabels them everywhere;
- unit photos: **RTU-1 · Unit**, **RTU-1 · Tag / label**, **RTU-1 · OA damper**, **RTU-1 · Other 2**; general photos
  **General 1, General 2**.

## Reports (PDF) and the photo zip

Export tab → *Photo and Issues reports*. Made in the browser, offline, with **pdf-lib** (lazy-loaded chunk
`generate-*.js`, 442 kB / 183 kB gzip, precached by the service worker; nothing in the main bundle). Fonts are the
PDF standard Helvetica family (no font files fetched or embedded); characters outside WinAnsi are replaced
(`Δ` → `d`, `≥` → `>=`, others `?`). US Letter, 42 pt side margins; every page has a running header (project name |
report title · label) and footer (firm | report date | **Page X of Y**). Page 1 starts with a title block: *a2b
accurate air balancing, llc*, report title, project name, address, report date and the report label, plus counts.

- **Photo Report**: one group per unit (equipment type order, then designation; heading "RTU-1 · type"), then
  *General*. Photos **4 per page** (2 × 2) by default, or 2 (1 × 2, large) or 6 (2 × 3). Each photo is scaled to fit
  its box without distortion, with its label and up to 3 caption lines under it. Row heights are chosen so a page
  always holds N photos even when every row starts a new group; a group that runs over gets a "(continued)" heading.
  Deficiency photos can be included (under their issue's unit, or General; caption defaults to the issue remark) or
  left out. The cover photo is in the workbook, not in this report.
- **Issues Report**: a *New Equipment* section and an *Existing Equipment* section (each can be exported alone —
  they go to different parties). Each issue is a block: shaded bar with **Issue N-3**, unit (or *General*) and
  OPEN / CLOSED, then Remark and Comments; its deficiency photos follow **directly under the issue** in the same
  2-column grid as the Photo Report.
- **Issues + Photos**: the Issues Report followed by the Photo Report (without deficiency photos, which are already
  under their issues).
- **Photos (.zip)**: the stored images (the processed 2000 px JPEGs; the camera originals are not kept), named
  `RTU-1 - Unit - 01.jpg`, `RTU-1 - Tag - 01.jpg`, `RTU-1 - OA Damper - 01.jpg`, `Issue N-3 - 1.jpg`,
  `General - 01.jpg`, `Cover.jpg`.

The report label defaults to the workbook revision just exported (or the latest export), and is editable. File
names follow the workbook export: `<Project> - Photo Report Rev 1 2026-09-24.pdf`, `… - Issues Report (New) …`.
Memory / speed: photos are read from IndexedDB and downscaled to ~200 dpi at their printed size **one at a time**
(about 100–200 kB each in the PDF), and the renderer yields to the event loop after each photo; a 200-photo report
is 51 pages (unit test). The zip is built in memory (the stored JPEGs, not recompressed).

## Tests

- `npm test`: 348 tests (23 in `packages/workbook`: the schedule readers (EDE section only, sheet grids), export onto an issued workbook (clearing, hand formatting kept,
  an Excel-style shared-strings save, formulas typed over inputs), the revision marker, the compatibility check (incl.
  revision 04 rejected), plus list and constants copies vs. the template, a map audit that
  fills **every** block of every type, round trip, safety; 325 in the app, incl. **sync** (54 tests, two or three
  simulated devices, each with its own IndexedDB, over the in-memory fake server: `sync/engine.test.ts` push batching
  and order, a lost-response retry applied once (also a re-pushed create after a rename / delete), partial failure
  mid-batch, a request refused as a whole, an edit while its push is in flight, offline → online, pull paging by cursor
  and the settle window (a late commit with a lower seq), a device clock 10 min fast, the report lock arriving from
  another device (local edits refused, earlier offline edits held then released on unlock, or refused by the server
  and held, or discarded), the own lock after own edits, a locked project deleted everywhere, server review clearing;
  `sync/conflicts.test.ts` same field on both devices flagged on both (either push order), later corrections /
  different fields / equal values not flagged, project fields, resolve keep / restore (settles the other device, refused
  while locked); `sync/photoSync.test.ts` upload after push, download on the other device, backoff 5 s → 10 s … 1 h,
  resume after reload, deletes propagate, whole-project delete; `sync/fakeServer.test.ts` the 0003 rules mirrored from
  the SQL test, error mapping, the Supabase backend's calls with a mocked client; jsdom `ui/sync.test.tsx` with a
  mocked Supabase auth client: local mode, sign-in (Azure, PKCE redirect to `/auth/callback`), callback code exchange,
  provider error, failed exchange, persisted session, first sign-in choosing projects to upload, device-only projects
  moved later, sign-out warning / cancel / data kept, the conflict UI (Attention group, unit badge, field flag, keep /
  use, held changes discarded) and the lock toast), `deploy/hosting.test.ts` (generated hosting files up to date, caching rules, CSP), `ui/deploy.test.tsx` (install card incl. the iPhone hint, update toast, export status and the leave reminder, Share… and its fallback, custom scope for every type), the Phase 6 workflow (`data/workflow.test.ts`: review only when green,
  blue rollups, automatic clear on field / row / photo changes but not on issue or remote edits, the lock refusing
  every kind of write at the repository level with nothing written, unlock, remote lock, lock / unlock / revision
  events, previous values while the outbox coalesces, schedule-import source, prune, the v3 → v4 upgrade; an issued
  export locking the project and blocking the re-import review; `domain/historyView.test.ts`: labels, values,
  grouping, filters; jsdom `ui/workflow.test.tsx`: Mark reviewed → blue, list rollup, lock banner and read-only form,
  Unlock with confirm, Export / Equipment / Import while locked, History tab and the unit's History), schedule import (paste / CSV parsing, header mapping, numbers / phase /
  V/Ph/Hz, preview with create / update / invalid / duplicate / over-capacity rows, apply through the outbox),
  duplicate (next designation, what is copied, rows without readings), building pressures (export, automatic kitchen
  N/A, import, re-import diff, project-level completion), needs attention and instrument / calibration matching, jsdom
  tests of the MAU form (method switching), the hood form, duplicate, the Attention tab, the pressure card and the
  schedule import page, photos (EXIF reader with generated JPEGs incl. big-endian / GPS, orientation transforms,
  downscale math, numbering / relabelling, zip names, photo repository and the v3 upgrade), reports (layout and
  pagination incl. a 200-photo report, the report model, PDFs checked with pdf-lib and `pdftotext`), the three-way re-import diff, apply through the outbox, revisions,
  export onto the base, the review screen and the schema upgrade): outbox and repository, remote apply,
  completion engine for all 8 types (colors, N/A levels, scope profiles, auto rules incl. MAU method switching,
  small-fan R6, traverse R7, hood readings, tolerance, R8 discrepancies), live calcs against the workbook's values
  (hood 5 × 16" x 20" Captrate = 2049.29 CFM, PSP, profile-pressure curve, traverse Ak / positions for 24" × 12" and
  10" round), static profile and motor data against the revision 04/05 functional-test and export-spike values
  (incl. notation cases), a **generated LibreOffice cross-check** (`staticMotor.recalc.test.ts`: 52 varied RTUs /
  MAUs / ERVs / fans — every unit type, 1- / 3- / blank phase, blank and N/A legs, negative statics, notations in the
  chain — exported onto the template, recalculated, 1,446 cells equal to the app's functions, max deviation ~5e-14;
  skipped where `soffice` is missing, e.g. CI), adapter mapping and a **round trip against the real template** with a fully filled unit of every
  type incl. N/A cases (app project → export → import → app project, equal), and jsdom UI tests.
- `npm run build && npm run e2e`: serves `dist/` with `deploy/serve-dist.ts` (the production headers, incl. the CSP;
  `E2E_SERVER=vite` uses `vite preview`; `E2E_PORT` changes the port) and drives Chromium at 390 × 844 through
  create project → project info (+ cover photo) → 2 RTUs → RTU-1 filled (outlet rows, fill-down, one N/A) → card
  colors → tolerance → one MAU (PSP; method switched to Filter Grid and back), ERV, fan, small fan, hood and
  traverse filled to green → export (download checked with the importer in Node, incl. the browser-cropped cover
  photo) → **LibreOffice recalculation** of the export: 0 error cells and the MAU method total, hood total,
  traverse CFM, ERV totals, Building Balance totals and the TSP / ESP / unit ΔP / ΔP texts / corrected FLA / BHP
  of RTU-1, MAU-1, ERV-1 and EF-1 equal the app's live calcs and what the panels showed → reload (IndexedDB) → offline
  (service worker shell, edits, export) → re-import → **issued-report round trip** (`e2e/reimport.ts`): export
  *Prelim* → Excel edits simulated as direct XML changes (remark polished and restyled, a reading changed, a reading
  also changed in the app, column width, row height, label text) → a LibreOffice re-save of it re-imported as an import
  source only (same review, Cancel) → re-import: 1 remark, 1 incoming reading, 1 collision, no false changes → resolve,
  apply → export *Rev 1* onto the issued workbook: formatting kept, VBA byte-identical, values read back correct.
  **Building pressures and needs attention** (`e2e/features.ts`, before the export): the pressure table filled on
  Info (kitchen row required: the project has a hood), exported to Building Balance B97:K99 / B102 and checked after
  the LibreOffice recalculation; the Attention tab lists RTU-1's ESP and BHP checks and the out-of-date balometer, the
  counts match, an item opens its unit at the section; the re-import walk also changes H97 in "Excel" and the review
  shows it as an incoming *Building vs Outdoors ΔP*. **Schedule import** (own project): 9 MAUs pasted without a header,
  then 4 RTUs with headers (one invalid CFM skipped, one column mapped by hand, phase / V/Ph/Hz normalised) and 2 MAUs
  (MAU-11 over capacity), duplicate RTU-3 → RTU-4 (slot 4), and the TAB workbook source (EDE only) of the main export.
  **Photos** (`e2e/photos.ts`): RTU-1's tag / OA damper N/A cleared (amber) → an EXIF-rotated JPEG (orientation 6,
  capture time, GPS) and a second photo attached (green again; the stored tag photo is checked upright pixel by
  pixel) → New / Existing issues with deficiency photos (N-1.1, N-1.2, E-1.1; reorder relabels) → Photos tab
  (groups, filter, missing list, storage) → Photo Report, Issues Report (all / New / Existing), combined report and
  zip downloaded and checked in Node (pdf-lib page counts, `pdftotext` labels, JSZip names); page 1 of the Photo
  and Issues reports rendered with `pdftoppm`. **Reporting workflow** (`e2e/workflow.ts`, own context, the export
  imported): RTU-1 made green → *Mark reviewed* → blue card and "RTUs 1/2 complete, 1 reviewed" → an edit clears the
  review → reviewed again → *Issue report* "Prelim" (download, banner, *Issued* revision, re-import blocked) → the unit
  form is read-only and typing changes nothing, no Add / Import → *Unlock* (confirm names Rev 1) → the edit saves, Rev 1
  suggested → History lists the review, the automatic clear, the issued revision, lock, unlock and the edits old → new;
  unit filter; the unit's History section. **Deployment features** (`e2e/deploy.ts`): the Install card after a
  `beforeinstallprompt` (the prompt is called once), the iPhone hint (dismissal survives a reload), the update toast
  after `sw.js` changes on the server (Reload activates the new worker), the export reminder when leaving a never-
  exported project and after an edit, *Download again* without Web Share, *Share…* of the `.xlsm` and a PDF with a
  Web Share stub, and a MAU section switched off by the Custom scope. **Two devices syncing** (`e2e/sync.ts`): a second
  build with `VITE_FAKE_SYNC=1` (`app/dist-fake`, git-ignored; the production build contains no fake code) served on
  `E2E_PORT + 1` with the fake sync server (`deploy/serve-dist.ts`, `SERVE_FAKE_SYNC=1`), two browser contexts:
  A imports a project while signed out, signs in (redirect to `/auth/callback`), *Move projects to the cloud* lists it,
  upload → *Synced*; B signs in and gets it; both go offline and change RTU-1's serial → the later value on both, both
  flag the field, list it on the unit page, badge the unit card and show the Attention tab's Conflicts group (screenshot
  29) → A restores its value → B gets it and B's conflict is settled → B signs out, the project stays
  (`E2E_SKIP_SYNC=1` skips this walk). Every page of every context is checked for
  **CSP violations** (none) and the production headers are checked on `/`.
  Uses `PLAYWRIGHT_BROWSERS_PATH` or `CHROMIUM_PATH` (falls back
  to `/opt/pw-browsers/chromium`) and `soffice` for the recalculation; never downloads a browser. Screenshots go to
  `e2e-screenshots/` (git-ignored); a few are kept in [`docs/screenshots/`](../docs/screenshots) (07–12: the new
  forms; 13: RTU motor and static-profile panels; 14: re-import review; 15: revisions; 16: Photos tab; 17: issue
  with deficiency photos; 18 / 19: page 1 of the Photo and Issues reports; 20: schedule import preview; 21: needs attention; 22: building
  pressures; 23: reviewed (blue) units; 24: locked (issued) unit page; 25: History; 26: install card; 27: export with
  Share…; 28: the icon set, rendered by `npm run icons`; 29: a sync conflict in the Attention tab).

## Not done yet

Sign-in and sync against a live Supabase project and Microsoft tenant (built and tested against the fake server and a
mocked auth client; steps in [`docs/SYNC_SETUP.md`](../docs/SYNC_SETUP.md)); two offline devices can give two units the
same workbook slot (not resolved on pull yet); a record deleted on one device while edited on another is not flagged as
a conflict (the history shows both); the history is per device (not synced, so a new device starts with what it pulls);
photos can't be opened from a unit page while the project is locked (use the Photos tab, whose viewer is read-only
then); server columns for the newer photo fields (`order`, `width`, `height`, `capturedAt`, `gps` sync through the log
but are not in the server's `photos` table); photos tested in Chromium only (no real iPhone camera / HEIC run);
revisions are not synced between devices; re-import behaviour after a real desktop-Excel save is untested (simulated
with XML edits); Certification; the Building Balance spare OA rows; the hood schedule's "KEF interlock" column (EDE G,
info only, not linked) is not written (the hood page's own "Associated exhaust fan" is).
