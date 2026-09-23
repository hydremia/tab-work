# TAB App — Project Tracker

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

Last updated: 2026-09-23

## Open questions (need answers to finish Phase 0)

| # | Question | Answer |
|---|---|---|
| Q1 | How many users and roles (techs, PMs, office)? Will customers or GCs ever need view access? | Techs and PMs, both in the field and in the office. **No outside access** for now. |
| Q2 | Does the company use Microsoft 365? Where do reports live today (SharePoint, OneDrive, Dropbox, server)? Should users sign in with their Microsoft accounts? | **Yes, M365.** Reports, project files and templates live in a **Dropbox** shared by the whole team. |
| Q3 | Which devices do techs carry: iPhone, Android, iPad, Windows laptop? | All of them. |
| Q4 | How often do sites have no signal (roofs, basements)? Confirms how much offline support we need. | |
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
| F1 | **Formatting fixes after export:** export fills the template with the app's data, so formatting fixed by hand in an issued workbook would be lost on the next export. Proposal: follow-up exports can use the **previously issued workbook as the base** (you pick it from Dropbox), so hand fixes carry forward. Recurring fixes get made in the template itself. OK? | |
| F2 | **Re-import rule:** on re-import, remarks and comments from the workbook are offered as updates (accept/reject each one), and readings that differ are highlighted for review. OK? | |
| F3 | **New vs Existing:** tag each piece of equipment New or Existing (default New), so its issues go to the matching Summary sheet by default? | |
| F4 | **Roles:** just two, **Tech** and **PM** (the PM can also manage projects and team members), plus one **Admin**. Anything a tech should *not* be able to do, e.g. export or issue a report? | |
| R1–R4 | Questions at the bottom of [REQUIRED_FIELDS.md](./REQUIRED_FIELDS.md) (tolerance, required photos, VAV airflow pages, N/A in numeric cells) | |

## Decisions log

| Date | Decision |
|---|---|
| 2026-09-22 | Equipment and deficiency photos are exported as a separate Photo Report, not placed in the workbook. The cover photo is placed in the workbook. |
| 2026-09-22 | Proposed stack: React/TS PWA + Supabase + direct-XML Excel export. *(Pending confirmation after Q2/Q12.)* |
| 2026-09-22 | The app writes input cells only. Excel formulas stay authoritative. |
| 2026-09-23 | Sign-in with Microsoft 365 (Entra ID). ~~Dropbox API integration~~ → **none**: exports download to the device and users save them to Dropbox themselves. Photos are stored in Supabase Storage. |
| 2026-09-23 | Re-importing an issued workbook is a core feature. It needs an import **diff/merge review** plus issued-report snapshots (revisions). |
| 2026-09-23 | Three separate exports: **TAB Workbook** (.xlsm), **Issues Report**, **Photo Report**, plus a combined Issues + Photos report. Deficiency photos are numbered to their issue #. |
| 2026-09-23 | Template capacity is fixed as-is (40 RTU / 10 MAU / 40 Fan / 80 VAV / 20 VAV airflow / 20 Hood / 49 Traverse). The app blocks adding past these limits. |
| 2026-09-23 | Each export is a frozen revision. A copy of every issued workbook and PDF is also kept in the app's revision history. |
| 2026-09-23 | Issues have separate New and Existing numbering and link to equipment or "General (N/A)". The Photo Report defaults to 4 photos per page. |
| 2026-09-23 | Users are internal only (Techs and PMs). The app is a home-screen web app on all device types. No app stores. |
| 2026-09-23 | Completion rules: most fields required, N/A allowed at field, section or equipment level, plus project scope profiles (Full TAB, Airflow Only, Custom). |
| 2026-09-23 | ~~Fixed the two template formula bugs~~ **Reverted:** both were already fixed in revision 01. The 4-16-26 backup is restored to the original upload. |
| 2026-09-23 | **The app targets revision 04 (`04 - a2b_Blank_TAB_Workbook 9-18-26.xlsm`)**, which includes the Evergreen hood method, MAU supply methods, building pressures, cover photo box, traverse grids, Equipment Summary and Small Fans. |

---

## Phase 0 — Discovery & template spike
- [x] Inventory workbook sheets, blocks and capacities ([WORKBOOK_ANALYSIS.md](./WORKBOOK_ANALYSIS.md))
- [x] Draft roadmap, architecture and services list ([ROADMAP.md](./ROADMAP.md))
- [~] Answer open questions (round 1 and 2 answered; round 3 E1, F1–F4, R1–R4 open)
- [x] ~~Fix template bugs~~: already fixed in revision 01. The duplicate fix on the 4-16-26 backup was reverted.
- [ ] **Merge [PR #1](https://github.com/hydremia/tab-work/pull/1) (revisions 01–04) into `main`** so the app plan and the current template are on one branch
- [ ] **Redo the workbook analysis on revision 04** (`04 - a2b_Blank_TAB_Workbook 9-18-26.xlsm`)
- [ ] Template map v1: Project Information, Equipment Data Entry, Cover Page
- [ ] Template map v1: RTU Data / RTU Airflow (all 40 blocks)
- [ ] Template map v1: MAU, Fans, VAV, Hoods, Traverses, Summary, Calibration
- [ ] **Spike:** write values into the .xlsm through XML patching, open it in desktop Excel, and verify macros, images, formulas and print setup
- [ ] **Spike:** insert a cover photo into the Cover Page drawing
- [x] Propose default required fields per equipment type ([REQUIRED_FIELDS.md](./REQUIRED_FIELDS.md))
- [x] Accounts and admin setup checklist ([SETUP_ACCOUNTS.md](./SETUP_ACCOUNTS.md))
- [x] Compare Hoods sheet with the Evergreen worksheet (aligned in revision 01; see E1)

## Phase 1 — Foundation
- [ ] Create Supabase project (dev and prod) and GitHub repo structure
- [ ] Scaffold PWA (Vite, React, TS, routing, UI kit, mobile-first layout)
- [ ] Lint, format, unit tests, GitHub Actions CI, preview deploys
- [ ] Auth: Sign in with Microsoft (Entra ID app registration)
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
- [ ] N/A handling (field, section, equipment, automatic) and project scope profiles
- [ ] Tolerance flags
- [ ] Offline verification (airplane-mode test)

## Phase 3 — Excel export & import (first usable release)
- [ ] Export engine (XML patching, shared strings, `fullCalcOnLoad`)
- [ ] Export all sheets in the template map
- [ ] Capacity limits enforced in the app (no overflow handling needed)
- [ ] Import engine (read inputs from an existing workbook into the app)
- [ ] Re-import of an issued workbook into an existing project with a diff/merge review screen
- [ ] Issued-report snapshots and revision history (Prelim, Rev 1, Final…)
- [ ] Export-onto-previous-issued-workbook option (F1)
- [ ] Round-trip test suite (import → export → cell diff)
- [ ] Validate on a real completed project workbook

## Phase 4 — Photos
- [ ] Capture from camera or camera roll; compression and EXIF orientation
- [ ] Categories: cover, deficiency, unit, tag/label, OA damper, other; captions
- [ ] Cover photo placed in the workbook on export
- [ ] Photo Report export (format per N5)
- [ ] Issues Report export; combined Issues + Photos report
- [ ] Deficiency photos numbered to their issue # (e.g. Photo 3.1, 3.2)
- [ ] Zip export of originals

## Phase 5 — Cloud sync & multi-user
- [ ] Push/pull sync of field changes
- [ ] Realtime updates for other users on the same project
- [ ] Conflict detection, flags and history view
- [ ] Background photo upload queue with retry
- [ ] Roles and permissions (Tech / PM / Admin)
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
- [ ] ToC page counts calculated on export
- [ ] Native wrapper (Capacitor) if needed for iOS
