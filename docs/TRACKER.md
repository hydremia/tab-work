# TAB App — Project Tracker

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

Last updated: 2026-09-22

## Open questions (need answers to finish Phase 0)

| # | Question | Answer |
|---|---|---|
| Q1 | How many users and roles (techs, PMs, office)? Will customers or GCs ever need view access? | |
| Q2 | Does the company use Microsoft 365? Where do reports live today (SharePoint, OneDrive, Dropbox, server)? Should users sign in with their Microsoft accounts? | |
| Q3 | Which devices do techs carry: iPhone, Android, iPad, Windows laptop? | |
| Q4 | How often do sites have no signal (roofs, basements)? Confirms how much offline support we need. | |
| Q5 | After export, will anyone edit the workbook in Excel and then need those edits back in the app? Or is export one-way once the report is finalized? | |
| Q6 | Photo Report format: PDF with 2–4 photos per page and captions, grouped by equipment? Should deficiency photos be numbered to match Summary remark #? Keep or retire the hidden `Photos` sheet? | |
| Q7 | Capacity overflow: what happens today when a job has more than 40 RTUs, more than 20 VAV airflow pages, etc.? Second workbook or extra blocks? | |
| Q8 | Is the Evergreen kitchen-hood worksheet (`tb-worksheet-evergreen 2.xlsx`) in scope, and when? | |
| Q9 | Who defines "complete" for each equipment type? (I'll propose default required fields for you to adjust.) | |
| Q10 | Summary – New vs. Summary – (E): does each piece of equipment get tagged as new or existing? | |
| Q11 | Should equipment photos (unit, tag, OA damper) be *required* for "complete" (green)? | |
| Q12 | Distribution: is an installable web app (PWA) acceptable, or do you want App Store / Play Store apps? | |

## Decisions log

| Date | Decision |
|---|---|
| 2026-09-22 | Equipment and deficiency photos are exported as a separate Photo Report, not placed in the workbook. The cover photo is placed in the workbook. |
| 2026-09-22 | Proposed stack: React/TS PWA + Supabase + direct-XML Excel export. *(Pending confirmation after Q2/Q12.)* |
| 2026-09-22 | The app writes input cells only. Excel formulas stay authoritative. |

---

## Phase 0 — Discovery & template spike
- [x] Inventory workbook sheets, blocks and capacities ([WORKBOOK_ANALYSIS.md](./WORKBOOK_ANALYSIS.md))
- [x] Draft roadmap, architecture and services list ([ROADMAP.md](./ROADMAP.md))
- [ ] Answer open questions Q1–Q12
- [ ] Fix template bugs (`RTU Data!C40`, `{Equipment Data Entry}!P2:P3`) → new template revision
- [ ] Template map v1: Project Information, Equipment Data Entry, Cover Page
- [ ] Template map v1: RTU Data / RTU Airflow (all 40 blocks)
- [ ] Template map v1: MAU, Fans, VAV, Hoods, Traverses, Summary, Calibration
- [ ] **Spike:** write values into the .xlsm through XML patching, open it in desktop Excel, and verify macros, images, formulas and print setup
- [ ] **Spike:** insert a cover photo into the Cover Page drawing
- [ ] Propose default required fields per equipment type (for Q9)

## Phase 1 — Foundation
- [ ] Create Supabase project (dev and prod) and GitHub repo structure
- [ ] Scaffold PWA (Vite, React, TS, routing, UI kit, mobile-first layout)
- [ ] Lint, format, unit tests, GitHub Actions CI, preview deploys
- [ ] Auth (email magic link; Microsoft SSO if Q2 = yes)
- [ ] DB schema, migrations and row-level security policies
- [ ] Project list, create project and project membership

## Phase 2 — Core data entry (offline, single device)
- [ ] Local DB (IndexedDB/Dexie) and field-change log
- [ ] Project Information form
- [ ] Equipment list by type, with add, duplicate and bulk schedule import
- [ ] Forms generated from the template map: RTU/AHU, MAU/SF, ERV, EF/KEF, VAV, Hoods, Traverses
- [ ] Airflow outlet entry (fast numeric keypad, fill-down)
- [ ] Calc engine (CFM, %, totals, TSP/ESP, corrected FLA, BHP) with tests against Excel values
- [ ] Completion status engine and color coding (card, type rollup, project rollup, filters)
- [ ] Tolerance flags
- [ ] Offline verification (airplane-mode test)

## Phase 3 — Excel export & import (first usable release)
- [ ] Export engine (XML patching, shared strings, `fullCalcOnLoad`)
- [ ] Export all sheets in the template map
- [ ] Capacity overflow detection and policy (Q7)
- [ ] Import engine (read inputs from an existing workbook into the app)
- [ ] Round-trip test suite (import → export → cell diff)
- [ ] Validate on a real completed project workbook

## Phase 4 — Photos
- [ ] Capture from camera or camera roll; compression and EXIF orientation
- [ ] Categories: cover, deficiency, unit, tag/label, OA damper, other; captions
- [ ] Cover photo placed in the workbook on export
- [ ] Photo Report PDF export (format per Q6)
- [ ] Zip export of originals

## Phase 5 — Cloud sync & multi-user
- [ ] Push/pull sync of field changes
- [ ] Realtime updates for other users on the same project
- [ ] Conflict detection, flags and history view
- [ ] Background photo upload queue with retry
- [ ] Roles and permissions (tech / PM / reviewer / viewer)
- [ ] "Unsynced changes" indicator; ask the browser for persistent storage
- [ ] Two-device concurrent editing test

## Phase 6 — Reporting workflow
- [ ] Deficiency tracker → Summary remarks
- [ ] Instrument/calibration library → Calibration sheet and traverse instrument fields
- [ ] Review and sign-off, report lock
- [ ] Audit history view

## Phase 7 — Pilot & rollout
- [ ] Pilot on one live project
- [ ] Fix issues from the pilot
- [ ] User guide / quick-start
- [ ] Roll out to all techs

## Phase 8+ — Enhancements (backlog)
- [ ] Nameplate photo → auto-fill (AI vision)
- [ ] QR/barcode equipment tags
- [ ] Tablet grid (spreadsheet-style) entry mode
- [ ] PM multi-project dashboard
- [ ] Evergreen kitchen-hood worksheet template
- [ ] ToC page counts calculated on export
- [ ] Native wrapper (Capacitor) if needed for iOS
