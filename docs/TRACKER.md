# TAB App — Project Tracker

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

Last updated: 2026-09-24

## Open questions (need answers to finish Phase 0)

| # | Question | Answer |
|---|---|---|
| Q1 | How many users and roles (techs, PMs, office)? Will customers or GCs ever need view access? | Techs and PMs, both in the field and in the office. **No outside access** for now. |
| Q2 | Does the company use Microsoft 365? Where do reports live today (SharePoint, OneDrive, Dropbox, server)? Should users sign in with their Microsoft accounts? | **Yes, M365.** Reports, project files and templates live in a **Dropbox** shared by the whole team. |
| Q3 | Which devices do techs carry: iPhone, Android, iPad, Windows laptop? | All of them. |
| Q4 | How often do sites have no signal (roofs, basements)? Confirms how much offline support we need. | **Most sites have signal** (Wi-Fi, MiFi or phone network), but the app must **fully support offline** work. |
| Q5 | After export, will anyone edit the workbook in Excel and then need those edits back in the app? Or is export one-way once the report is finalized? | **Round trip required.** An issued preliminary report must be importable back into the app for follow-up work. |
| Q6 | Photo Report format: PDF with 2–4 photos per page and captions, grouped by equipment? Should deficiency photos be numbered to match Summary remark #? Keep or retire the hidden `Photos` sheet? | **Yes, number deficiency photos to match issues.** Photos and Issues export as their own combined report, and each can also be exported separately. |
| Q7 | Capacity overflow: what happens today when a job has more than 40 RTUs, more than 20 VAV airflow pages, etc.? Second workbook or extra blocks? | **Not needed.** Current capacity is enough. The app enforces the template limits. |
| Q8 | Is the Evergreen kitchen-hood worksheet (`tb-worksheet-evergreen 2.xlsx`) in scope, and when? | **Already aligned** in revisions 01–04 (see E1). |
| Q9 | Who defines "complete" for each equipment type? (I'll propose default required fields for you to adjust.) | Most fields required, with N/A allowed. Includes an Airflow-Only scope. Proposal in [REQUIRED_FIELDS.md](./REQUIRED_FIELDS.md). |
| Q10 | Summary – New vs. Summary – (E): does each piece of equipment get tagged as new or existing? | |
| Q11 | Should equipment photos (unit, tag, OA damper) be *required* for "complete" (green)? | |
| Q12 | Distribution: is an installable web app (PWA) acceptable, or do you want App Store / Play Store apps? | **Home-screen web app (PWA) is fine.** No app stores. |

## Follow-up questions (round 2)

| # | Question | Answer |
|---|---|---|
| N1 | **Follow-up workflow:** after a preliminary report is issued, does follow-up data *replace* prelim values, or go into the "Final" columns while prelim stays as "Initial"? Should each issued report be kept as a frozen revision (Prelim, Rev 1, Final…)? | A prelim can already have some Final-column data, which the follow-up revises. The **exported Excel (and its PDF) is the static record** of each issued report. |
| N2 | **Edits in Excel between issue and re-import:** who edits the issued workbook, and what do they typically change (remarks, readings, formatting)? When a re-imported value differs from the app, which should win? | **Remarks** get polished or revised, and **formatting** gets fixed. Readings are rarely changed. |
| N3 | **Dropbox setup:** Dropbox Business/Team account? What is the project folder convention (e.g. `/Projects/{Job#} {Name}/TAB/`)? Should the app save exports there automatically? Should photo originals be mirrored there too? | Dropbox Business. **No integration needed:** users save exports into Dropbox themselves. Photos are stored in cloud storage (Supabase), not in Dropbox. |
| N4 | **Issue fields:** the Summary sheets hold `# / Remark / Status (Open, Closed) / Comments`. Do issues also need linked equipment, priority, responsible party (e.g. mech contractor), date found and date closed? Does numbering run continuously across New and (E), or restart per sheet? | **Separate numbering for New and Existing**, because they go to different parties. Issues link to equipment **or** "General (N/A)". No other fields for now. |
| N5 | **Issues/Photo Report layout:** branded a2b header? Photos per page (2, 4, 6)? Group by equipment or by issue #? Word/PDF or Excel output? A sample of a past report would help. | **4 photos per page** by default. |
| N6 | **Admin access:** who administers M365 (to register the app for Microsoft sign-in) and the team Dropbox (to approve the app)? | Asked what's needed. Answered in [SETUP_ACCOUNTS.md](./SETUP_ACCOUNTS.md). |
| N7 | Still open from round 1: **Q3 devices**, **Q10 New vs Existing tagging**, **Q12 PWA acceptable** | |
| N8 | *(answered above)* Still open from round 1: **Q1 users and roles**, **Q8 Evergreen worksheet**, **Q9/Q11 completeness rules**. I'll propose defaults for Q9/Q11. | |

## Follow-up questions (round 3)

| # | Question | Answer |
|---|---|---|
| E1 | **Hoods vs Evergreen:** was the alignment done in a different copy of the workbook? | **Yes, already done in revision 01** (branch `claude/tab-report-review-3divp8`, [PR #1](https://github.com/hydremia/tab-work/pull/1)) and carried through revision 04. My earlier gap list was checked against the old 4-16-26 backup by mistake. |
| F1 | **Formatting fixes after export:** export fills the template with the app's data, so formatting fixed by hand in an issued workbook would be lost on the next export. Proposal: follow-up exports can use the **previously issued workbook as the base** (you pick it from Dropbox), so hand fixes carry forward. Recurring fixes get made in the template itself. OK? || Hand formatting is done and saved in Excel. **Decision:** when an issued workbook is re-imported, the app keeps that file and uses it as the **base for the next export**, so hand formatting carries forward with no extra step. The blank template is used only for a project's first export. |
| F2 | **Re-import rule:** on re-import, remarks and comments from the workbook are offered as updates (accept/reject each one), and readings that differ are highlighted for review. OK? || **Yes.** Changed values are highlighted, and you accept or decline each one. A *collision* only happens when the same field changed **in both** Excel and the app since the last export. Formatting never collides, because it is not compared. |
| F3 | **New vs Existing:** tag each piece of equipment New or Existing (default New), so its issues go to the matching Summary sheet by default? || **Yes.** Each piece of equipment is tagged New or Existing (default New), and its issues go to the matching Summary sheet. |
| F4 | **Roles:** just two, **Tech** and **PM** (the PM can also manage projects and team members), plus one **Admin**. Anything a tech should *not* be able to do, e.g. export or issue a report? || **All users have all permissions.** No role tiers. Access is controlled by who can sign in with M365. |
| R1–R4 | Questions at the bottom of [REQUIRED_FIELDS.md](./REQUIRED_FIELDS.md) (tolerance, required photos, VAV airflow pages, N/A in numeric cells) || R1: **±10%** standard. R2: **photos required** (unit, tag, OA damper) unless marked N/A. R3: **capacities equal**; revision 04 already has 80 VAVs, each with its own airflow table. R4: **no blank-means-N/A**; options are in REQUIRED_FIELDS.md (N1). |

## Open (round 4)

| # | Question | Answer |
|---|---|---|
| M1 | OK to merge [PR #1](https://github.com/hydremia/tab-work/pull/1) (revisions 01–04) into `main` so revision 04 is the official template the app builds on? | **Yes. Merged 2026-09-23** (merge commit `2ae8812`). |
| N1 | How N/A appears in numeric cells: pick an option from [REQUIRED_FIELDS.md](./REQUIRED_FIELDS.md#n1--how-na-appears-in-numeric-cells) | **Option A:** hardened formulas in revision 05. The notation prints in the cell and calculations skip it. |

## Open (round 5)

| # | Question | Answer |
|---|---|---|
| B1 | Building Balance has room for only 10 more exhaust rows. Add Small Fans 21–30 there now, or insert 10 rows above the totals (which shifts totals and the print area) so all 21–40 fit? | **Option 2:** Small Fans 21–30 use the 10 free exhaust rows (done in revision 05). 31–40 stay off the sheet (rarely needed); the app warns past 30. |
| B2 | MAU "Method used = Traverse" has no calculation. Link it to a traverse on the Traverses sheet, or remove the option? | **Remove it.** Not needed for MAUs. Done in revision 05 (`Airflow.Method` = Outlets, PSP, Filter Grid, Profile Pressure). |
| R5–R8 | New questions at the bottom of [REQUIRED_FIELDS.md](./REQUIRED_FIELDS.md) (narrative/certification, small-fan optional fields, traverse fields, design CFM source) | R5 yes. R6: small fans require model, serial, amps (+ manufacturer and airflow per NEBB). R7: traverse instrument, SP and temp all required. R8: **check both** and highlight discrepancies. |

## Decisions log

| Date | Decision |
|---|---|
| 2026-09-22 | Equipment and deficiency photos are exported as a separate Photo Report, not placed in the workbook. The cover photo is placed in the workbook. |
| 2026-09-22 | Proposed stack: React/TS PWA + Supabase + direct-XML Excel export. *(Pending confirmation after Q2/Q12.)* |
| 2026-09-22 | The app writes input cells only. Excel formulas stay authoritative. |
| 2026-09-23 | Sign-in with Microsoft 365 (Entra ID). ~~Dropbox API integration~~ → **none**: exports download to the device and users save them to Dropbox themselves. Photos are stored in Supabase Storage. |
| 2026-09-23 | Re-importing an issued workbook is a core feature. It needs an import **diff/merge review** plus issued-report snapshots (revisions). |
| 2026-09-23 | Three separate exports: **TAB Workbook** (.xlsm), **Issues Report**, **Photo Report**, plus a combined Issues + Photos report. Deficiency photos are numbered to their issue #. |
| 2026-09-23 | Template capacity is fixed as-is (40 RTU / 10 MAU / 40 Fan / 80 VAV / 20 VAV airflow / 20 Hood / 48 Traverse; *corrected 2026-09-24: the template has T-1 … T-48, see below*). The app blocks adding past these limits. |
| 2026-09-23 | Each export is a frozen revision. A copy of every issued workbook and PDF is also kept in the app's revision history. |
| 2026-09-23 | Issues have separate New and Existing numbering and link to equipment or "General (N/A)". The Photo Report defaults to 4 photos per page. |
| 2026-09-23 | Users are internal only (Techs and PMs). The app is a home-screen web app on all device types. No app stores. |
| 2026-09-23 | Completion rules: most fields required, N/A allowed at field, section or equipment level, plus project scope profiles (Full TAB, Airflow Only, Custom). |
| 2026-09-23 | ~~Fixed the two template formula bugs~~ **Reverted:** both were already fixed in revision 01. The 4-16-26 backup is restored to the original upload. |
| 2026-09-23 | Follow-up exports fill the **previously issued workbook** (kept from re-import), so hand formatting in Excel is preserved. Re-import diff: accept or decline each change. Only same-field edits in both places are flagged as collisions. |
| 2026-09-23 | Equipment tagged New/Existing. All users have equal permissions. Tolerance ±10%. Equipment photos are required unless N/A. |
| 2026-09-23 | PR #1 merged into `main`. **N/A (option A):** revision 05 hardens formulas so `N/A`, `Not Avail.` and `Not Acc.` print in numeric cells without errors. |
| 2026-09-23 | Full offline support is required. Most sites are online, so sync runs continuously when connected, and offline is the fallback rather than the normal mode. |
| 2026-09-24 | Photo Report: units flow onto the same page (no page break per unit), which is how the report already works; page 1 holds one row because of the title block. Issue numbering **N-3 / E-3** and deficiency photos **Photo N-3.1** approved. |
| 2026-09-24 | **Exception approved:** the leaving static of a component the unit type doesn't have (and the filter leaving static on a unit with no filters) is exported **blank**, because the workbook reads blank there as "component absent". Writing N/A blanked fan TSP / unit ΔP downstream. Everything else follows "blank never means N/A". |
| 2026-09-24 | **24" × 24" supply filter fixed** in revision 05 (rebuilt): `{Dropdowns}!H45` key restored, source note moved to AP1. The MAU filter grid now calculates that size, and the app offers it. |
| 2026-09-24 | Export writes **every** N/A: automatic and scope-profile N/A as `N/A`, never a blank. Photos are not in the workbook: re-import into the same project keeps them; a new project comes back amber until photos are added. |
| 2026-09-24 | Schedule import: a schedule row whose designation already exists **updates** that unit, writing only the values the schedule has (blank cells never clear app values); new units take the next free slots in row order (EDE slot numbers of a source workbook are not kept). Rows with an invalid number / phase / select value, no designation, a repeated designation, or past capacity are skipped (not partly imported). *(Claude, pending user review)* |
| 2026-09-24 | Schedule import targets = the {Equipment Data Entry} columns the app has a field for (hood "KEF interlock" not imported); traverses (no EDE section) import designation, area served, design CFM, shape, width, height, liner. `460/3/60` fills voltage and a blank phase; voltages outside 115–600 V standard values are a warning only. A first row is taken as headers only when it maps ≥ 2 columns (a cell with digits must match a header exactly). *(Claude, pending user review)* |
| 2026-09-24 | Duplicate copies the schedule and set-up (unit type, drive, motor nameplate incl. FLA / SF, filters, VFD answer, instrument, MAU method / PSP / housing, hood / filter type, small-fan design values), their N/A marks and section N/A marks, New/Existing; never serial, readings, remarks, photos or whole-unit N/A. Outlet / filter rows copied without readings (default on). *(Claude, pending user review)* |
| 2026-09-24 | Building pressures are stored as project fields (`info.bb*`) on Project Info. Rows 97 and 98 keep the template labels (Building / Outdoors, Kitchen / Dining, not editable, always written); the spare pair is fully free text. Kitchen vs Dining is automatically N/A when the project has **no hood unit** (exported `N/A`, read back as automatic). Building Balance is now reset on export onto a base workbook. *(Claude, pending user review)* |
| 2026-09-24 | Project-level completion card on Info: required project fields, narrative, cover photo (now N/A-able), calibration (≥ 1 complete instrument, no half-filled rows), building pressures. Certification is not in the app yet. *(Claude, pending user review)* |
| 2026-09-24 | Needs attention: missing required photos listed for **started** units only; closed issues not listed; capacity lists types at capacity and small fans past slot 30; an instrument kind counts as calibrated when any matching row is in date. Readings also imply meters (volts / amps → multimeter, RPM → tachometer, statics → manometer). Kind → meter mapping: Flow Hood → balometer / flow hood; Velocity Grid, Pitot, Manometer/…, Evergreen VelGrid / Airfoil → (micro)manometer; anemometers → that meter; DDC and "Other" → none. It is a separate Attention tab (count badge) plus a card on the Equipment tab. *(Claude, pending user review)* |
| 2026-09-24 | Route-level lazy loading: every page is its own chunk (main bundle ~515 kB, Vite's 600 kB limit unchanged); the section-chip bar is now opaque. *(Claude, pending user review)* |
| 2026-09-24 | **Review / sign-off:** any user can mark a unit Reviewed, only while it is **green** (checked again by the repository). The reviewer types a name once per device (remembered locally); the review stores name, user id, device id and time as a synced field. Blue is shown only while the unit is still green: a reviewed unit that turns red (e.g. an issue opened on it) shows red. **Automatic clear** on any change of the unit itself: its fields, N/A marks, New / Existing, outlet / filter rows, photos (also through schedule import and re-import). Not cleared by: issue edits (they turn the unit red instead), project-level changes (tolerance, scope), or applying another device's edit (that device clears the review and syncs it). *(Claude, pending user review)* |
| 2026-09-24 | **Report lock:** *Issue report* = export + lock in one step (confirm dialog); the plain *Export* button stays for working copies and does not lock. While locked **every** write to the project is refused by the repository (not only the UI): fields, reviews, rows, issues, photos, instruments, schedule import, re-import (the review screen is blocked and offers Unlock). Allowed while locked: exports and PDF reports (read-only), deleting the whole project, unlocking. Any user can unlock (F4), after a confirm that names the issued revision and the next suggested label (Prelim → Rev 1). The lock is a synced project field; the server stores it but does not enforce it. Photos can still be viewed from the Photos tab while locked (read-only viewer), not from the unit page. *(Claude, pending user review)* |
| 2026-09-24 | **Change history:** a separate append-only local `history` table (Dexie v4), because the sync outbox coalesces repeated unsynced edits of a field and would lose intermediate values; new outbox entries also carry `previous`. The v4 upgrade backfills the history from the outbox (no old values, shown as "—"). The history is per device (not pushed); changes pulled from other devices are added as they are applied. **Prune policy:** at start-up, drop entries older than 12 months and keep at most the newest 5,000 per project (≤ ~2.5 MB); a project's history is deleted with the project. *(Claude, pending user review)* |
| 2026-09-24 | **Traverse capacity is 48**, not 49: revision 05's Traverses sheet has 48 blocks (T-1 … T-48, 3 per page, rows 5 … 787), as WORKBOOK_ANALYSIS.md and the app say. The 2026-09-23 capacity entry above is corrected. (The "49 single-point blocks" in TAB-Report-Review.md describe the original 4-16-26 workbook and stay as history.) *(Claude, pending user review)* |
| 2026-09-24 | **Hosting:** Vercel is the primary host, built from the repository root (npm workspace: `npm ci`, `npm run build`, output `app/dist`); Netlify and Cloudflare Pages work from the same `_headers` / `_redirects`. All four config files are generated from one definition (`app/deploy/hosting.ts`; a test fails when they are stale). Steps in [DEPLOY.md](./DEPLOY.md). Nothing is deployed and no account is created. *(Claude, pending user review)* |
| 2026-09-24 | **Security headers:** strict CSP without `unsafe-inline` / `unsafe-eval` (scripts and styles from the app only; images also `blob:` / `data:`; `connect-src` the app + any `*.supabase.co` by default, narrowed to one project with `VITE_SUPABASE_URL=… npm run hosting-config -w app`; `frame-ancestors 'none'`), Permissions-Policy with only the camera allowed, `nosniff`, `strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, COOP `same-origin`, HSTS 2 years. Caching: `index.html`, `sw.js`, workbox, manifest and the (unhashed) template revalidate on every request; `/assets/*` immutable for a year; icons one day. The e2e now runs against a local server with exactly these headers (`app/deploy/serve-dist.ts`) and fails on any CSP violation. *(Claude, pending user review)* |
| 2026-09-24 | **Updates:** the service worker no longer activates a new version on its own (it could reload the page while someone types). A new version downloads in the background and shows **"Update available — Reload"**; *Later* hides it and the version starts when the app is next opened fresh. Open apps also check for a new version every hour. **Install:** the Projects screen shows an *Install app* card when the browser offers installation (Chrome / Edge / Android) and a *Share → Add to Home Screen* hint on iPhone / iPad; *Not now* / *Got it* is remembered per device. iOS status bar: `black-translucent` (the navy header runs under it). *(Claude, pending user review)* |
| 2026-09-24 | **App icons:** "a2b" in white over a light-blue airflow line and "TAB", on the app navy (#0f4c81 → #0a365d); drawn as paths (no font), rendered to PNG 192 / 512, maskable 192 / 512, apple-touch 180, favicon SVG / ICO (preview: `docs/screenshots/28-icons.png`). Manifest: *a2b TAB* / *TAB*, standalone, any orientation, categories business / productivity / utilities, background #f3f5f8 (the app's page color). *(Claude, pending user review)* |
| 2026-09-24 | **Export reminder (local mode):** the project card and the Export tab show "Last exported … (label) · N changes since" (N = saved edits, creates and deletes in the change history since the newest export; amber while N > 0 in local mode). Leaving a project in the app with N > 0 asks *Export before you leave?* (Go to Export / Leave without exporting / Don't remind me again today, per project and device). Closing the tab or app is **not** intercepted: phones and installed apps ignore `beforeunload`, and on a laptop it would also nag on every reload. *(Claude, pending user review)* |
| 2026-09-24 | **Share… after an export:** the file is always downloaded as before; where the browser can share that file type (`navigator.canShare`), the result box adds **Share…** (share sheet → Dropbox), otherwise **Download again**. iOS shares every export; Chrome on Android shares PDFs but not `.xlsm` / `.zip`, so Android keeps the Dropbox → Upload route for the workbook. *(Claude, pending user review)* |
| 2026-09-24 | **Wording:** the red status and its Equipment filter chip are now **"Issue / tolerance"** (an open issue or a reading out of tolerance); **"Needs attention"** is only the Attention tab's wider list (red items plus amber warnings). Units and photos not tied to one unit are **"General (N/A)"** everywhere in the app (issue link, photo *Attach to*, photo viewer, issue groups); the PDF reports keep the heading *General*. The export result no longer shows the workbook writer's notes (sheet / cell / field names): they are behind a collapsed *Technical details*; user-level warnings (e.g. the base workbook could not be used) still show. The dead "Full form coming soon (Phase 2)" paths are removed (every type has its full form). *(Claude, pending user review)* |
| 2026-09-24 | **Custom scope profile covers every type:** Info lists RTUs, MAUs, ERVs, fans, small fans, VAVs, hoods and traverses (one collapsible group each, "2 of 14 sections off"). Fix found on the way: under Custom, a switched-off section that has airflow fields showed *Complete* instead of *N/A (scope)* (the Airflow Only partial-section rule was applied to Custom too); the unit's color was already right. *(Claude, pending user review)* |
| 2026-09-24 | **CI:** the build job also runs `npm run pwa-check -w app` (manifest, icon files and sizes, iOS meta tags, no inline script, service-worker precache incl. the template, update-on-prompt, headers files; no browser or external service — Lighthouse no longer has a PWA category) and uploads `app/dist` as `app-dist-<commit>` (14 days) for a preview without hosting. *(Claude, pending user review)* |
| 2026-09-23 | **Revision 05 built.** The app now targets revision 05 (same layout as 04, so the revision 04 analysis applies). |
| 2026-09-23 | **The app targets revision 04 (`04 - a2b_Blank_TAB_Workbook 9-18-26.xlsm`)**, which includes the Evergreen hood method, MAU supply methods, building pressures, cover photo box, traverse grids, Equipment Summary and Small Fans. |

---

## Phase 0 — Discovery & template spike
- [x] Inventory workbook sheets, blocks and capacities ([WORKBOOK_ANALYSIS.md](./WORKBOOK_ANALYSIS.md))
- [x] Draft roadmap, architecture and services list ([ROADMAP.md](./ROADMAP.md))
- [x] Answer open questions (all rounds answered)
- [x] ~~Fix template bugs~~: already fixed in revision 01. The duplicate fix on the 4-16-26 backup was reverted.
- [x] Merge [PR #1](https://github.com/hydremia/tab-work/pull/1) (revisions 01–04) into `main`
- [x] **Revision 05** (`05 - a2b_Blank_TAB_Workbook 9-23-26.xlsm`): N/A-safe formulas, cover-page link fix, burner profile curve restored. 262/262 checks, 0 error cells (LibreOffice). Merged via [PR #2](https://github.com/hydremia/tab-work/pull/2). Still needs a check in desktop Excel.
- [x] Building Balance: Small Fans 21–30 added in revision 05 (B1). The app warns past 30.
- [x] Redo the workbook analysis and required fields on revision 04 (`04 - a2b_Blank_TAB_Workbook 9-18-26.xlsm`)
- [x] Template map v1 (`spike/export/src/templateMap.ts`): project info, EDE, cover, RTU/MAU/ERV/Fan/Small Fan/VAV/Hood/Traverse blocks, Summaries, Narrative, Calibration, Building Balance pressures. Audited on the first and last block of every type.
- [~] Template map: remaining areas. Hood/traverse page remarks and traverse point labels done; every block of every type audited (`packages/workbook/src/mapAudit.test.ts`). Still to do: Building Balance spare OA rows, Certification, versioned JSON per template revision.
- [x] **Export spike** (`spike/export`, `npm run spike`): 71 PASS / 0 FAIL. 634 cells written directly into the XML; 66 of 83 parts byte-identical, VBA unchanged; 0 error cells after recalculation; 189/189 expected values; import round trip with 0 differences (also after a LibreOffice re-save); 6/6 unsafe writes rejected.
- [x] **Spike:** cover photo cropped (≈1.685:1) and inserted into the Cover Page drawing
- [ ] **Open the spike export in desktop Excel**: no repair prompt, recalculation on open, macros/ToC button, dropdown values, cover photo proportions, print layout
- [x] Propose default required fields per equipment type ([REQUIRED_FIELDS.md](./REQUIRED_FIELDS.md))
- [x] Accounts and admin setup checklist ([SETUP_ACCOUNTS.md](./SETUP_ACCOUNTS.md))
- [x] Compare Hoods sheet with the Evergreen worksheet (aligned in revision 01; see E1)

## Phase 1 — Foundation
- [~] Create Supabase project (dev and prod) and GitHub repo structure. Repo structure done (`app/`, `packages/workbook/`, `supabase/`, npm workspaces). Supabase projects still to be created (SETUP_ACCOUNTS.md §2).
- [x] Scaffold PWA (Vite, React, TS, routing, UI kit, mobile-first layout): `app/`. Plain CSS instead of a UI kit; installable, offline app shell, update on prompt ("Update available — Reload").
- [~] Lint, format, unit tests, GitHub Actions CI, preview deploys. ESLint, Prettier, Vitest, Playwright e2e walk (under the production headers), `.github/workflows/ci.yml` (+ PWA check, `app-dist-<commit>` artifact) done. Hosting config for Vercel / Netlify / Cloudflare Pages, security headers, icons, install and update prompts done ([DEPLOY.md](./DEPLOY.md)); preview deploys wait for the hosting account.
- [~] Auth: Sign in with Microsoft (Entra ID app registration). "Sign in with Microsoft" (Supabase Azure provider) is wired behind `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; the app runs in local mode without them. Entra app registration and Supabase provider settings pending ([supabase/README.md](../supabase/README.md)).
- [x] DB schema, migrations and row-level security policies: `supabase/migrations/0001_init.sql` (tables, `field_changes` sync log with last-writer-wins trigger, RLS on every table, `photos` bucket). Checked on local PostgreSQL 16; not yet applied to a Supabase project.
- [x] Project list, create project and project membership. Membership = the organization (all users equal, F4); no per-project membership.

## Phase 2 — Core data entry (offline, single device)
- [x] Local DB (IndexedDB/Dexie) and field-change log (every edit via `setField`, outbox coalescing; sync push/pull engine written, not yet run against Supabase)
- [x] Project Information form (incl. report date, blueprints, narrative, scope/tolerance, cover photo, instruments)
- [x] Equipment list by type, with add, duplicate and bulk schedule import. List by type with rollups and filters, add (capacities enforced, New/Existing), **duplicate** (next designation / slot, design data, rows without readings) and **bulk schedule import** (paste, CSV / Excel file, or a TAB workbook's {Equipment Data Entry}; header mapping, validation, preview, capacity limits; every value through setField).
- [x] Building Balance pressures in the app (Project Info; project-level completion; export rows 97–99 + notes; import; re-import diff)
- [x] Needs-attention view (project-wide list, grouped and linked; count badge on the Attention tab and the Equipment tab)
- [x] Forms generated from the template map: RTU/AHU, MAU/SF, ERV, EF/KEF, VAV, Hoods, Traverses. Every type has a complete spec-driven form (MAU supply methods Outlets / PSP / Filter Grid / Profile Pressure, ERV supply + exhaust, fans, small fans (R6), hood filter readings (VelGrid / Airfoil), traverse point grid (R7)); round trip against the rev 05 template and LibreOffice cross-check in the e2e run.
- [x] Airflow outlet entry (fast numeric keypad, fill-down): decimal keypad, new row copies area/type/size/Ak and numbers S-1 → S-2
- [x] Calc engine (CFM, %, totals, TSP/ESP, corrected FLA, BHP) with tests against Excel values. CFM = VEL × Ak, % of design, totals; MAU PSP / filter grid / profile pressure / method total, ERV totals, hood filter CFM and totals, traverse layout / Ak / CFM, Building Balance totals, static-pressure strip (component ΔP, fan TSP, ESP = Unit ESP actual, unit ΔP), corrected FLA and estimated BHP, all checked against the workbook (unit tests, a generated LibreOffice cross-check of 52 units / 1,446 cells, and the LibreOffice recalculation in e2e). Amber checks: amps > corrected FLA × SF, BHP > HP, ESP vs design unit ESP.
- [x] Completion status engine and color coding (card, type rollup, project rollup, filters)
- [x] N/A handling (field, section, equipment, automatic) and project scope profiles. Automatic rules for every type (incl. MAU unchosen methods, hood VelGrid readings 2–3 and No Filter rows, round-duct height); N/A tables and reading runs are exported as the notation in their first cell.
- [x] Tolerance flags
- [~] Offline verification (airplane-mode test). Automated offline run in Chromium passes (app shell, edits, export); a real phone in airplane mode is still to do.

## Phase 3 — Excel export & import (first usable release)
- [ ] Export engine (XML patching, shared strings, `fullCalcOnLoad`)
- [ ] Export all sheets in the template map
- [ ] Capacity limits enforced in the app (no overflow handling needed)
- [ ] Import engine (read inputs from an existing workbook into the app)
- [x] Re-import of an issued workbook into an existing project with a diff/merge review screen
- [x] Issued-report snapshots and revision history (Prelim, Rev 1, Final…)
- [x] Keep the re-imported issued workbook as the base for the next export (F1)
- [ ] Round-trip test suite (import → export → cell diff)
- [ ] Validate on a real completed project workbook

## Phase 4 — Photos
- [x] Capture from camera or camera roll; compression and EXIF orientation
- [x] Categories: cover, deficiency, unit, tag/label, OA damper, other; captions
- [x] Cover photo placed in the workbook on export (since the app skeleton; checked by e2e)
- [x] Photo Report export (format per N5)
- [x] Issues Report export; combined Issues + Photos report
- [x] Deficiency photos numbered to their issue # (format: Photo N-3.1 / Photo E-3.1, see app/README.md)
- [x] Zip export of originals

## Phase 5 — Cloud sync & multi-user
- [ ] Push/pull sync of field changes
- [ ] Realtime updates for other users on the same project
- [~] Conflict detection, flags and history view. History view done (Phase 6: per project and per unit, incl. synced changes); conflict flags are recorded by the outbox (`conflict = 1`) but not shown yet.
- [ ] Background photo upload queue with retry
- [ ] Access control: M365 sign-in only; all users have equal permissions
- [ ] "Unsynced changes" indicator; ask the browser for persistent storage
- [ ] Two-device concurrent editing test

## Phase 6 — Reporting workflow
- [ ] Deficiency tracker → Summary remarks
- [~] Instrument/calibration library → Calibration sheet and traverse instrument fields. New projects pre-load the template's 7 a2b instruments; add / edit / remove (8 slots); unit, traverse and hood instrument pickers warn when no calibration row covers the kind; calibration older than 12 months before the TAB date flagged (Info and Needs attention). Still to do: a shared (cross-project) instrument library.
- [x] Review and sign-off, report lock. Any user marks a green unit *Reviewed* (blue state on cards and rollups, "RTUs 5/8 complete, 3 reviewed", project-level reviewed summary); any later change of the unit clears the review automatically. Export tab → **Issue report** (Prelim / Rev 1 / Final …) exports the revision and locks the project: banner "Issued as Rev 1 on <date> — unlock to edit", read-only forms, writes refused by the repository, imports / re-import blocked; **Unlock for follow-up** (confirm, suggests the next label). Review and lock are synced fields (`supabase/migrations/0002_review_lock.sql`). Screenshots 23–25.
- [x] Audit history view. Append-only local `history` table (Dexie v4, backfilled from the outbox): every edit with old → new values, creates / deletes, review, automatic review clear, lock / unlock, export / re-import events, changes pulled from other devices. History tab (filters: unit, field, date range, user / device; grouped by day and runs of edits) and a History section on each unit page. Kept 12 months, max 5,000 entries per project.

## Phase 7 — Pilot & rollout
- [ ] Pilot on one live project
- [ ] Fix issues from the pilot
- [x] User guide / quick-start ([docs/guide/](./guide/USER_GUIDE.md)): incl. review / issue / History, install, update, Share and the export reminder
- [ ] Roll out to all techs

## Phase 8+ — Enhancements (backlog)
- [ ] Nameplate photo → auto-fill (AI vision)
- [ ] QR/barcode equipment tags
- [ ] Tablet grid (spreadsheet-style) entry mode
- [ ] PM multi-project dashboard
- [ ] ToC page counts calculated on export
- [ ] Native wrapper (Capacitor) if needed for iOS
