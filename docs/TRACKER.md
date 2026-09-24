# TAB App — Project Tracker

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

Last updated: 2026-09-23

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
| 2026-09-23 | Template capacity is fixed as-is (40 RTU / 10 MAU / 40 Fan / 80 VAV / 20 VAV airflow / 20 Hood / 49 Traverse). The app blocks adding past these limits. |
| 2026-09-23 | Each export is a frozen revision. A copy of every issued workbook and PDF is also kept in the app's revision history. |
| 2026-09-23 | Issues have separate New and Existing numbering and link to equipment or "General (N/A)". The Photo Report defaults to 4 photos per page. |
| 2026-09-23 | Users are internal only (Techs and PMs). The app is a home-screen web app on all device types. No app stores. |
| 2026-09-23 | Completion rules: most fields required, N/A allowed at field, section or equipment level, plus project scope profiles (Full TAB, Airflow Only, Custom). |
| 2026-09-23 | ~~Fixed the two template formula bugs~~ **Reverted:** both were already fixed in revision 01. The 4-16-26 backup is restored to the original upload. |
| 2026-09-23 | Follow-up exports fill the **previously issued workbook** (kept from re-import), so hand formatting in Excel is preserved. Re-import diff: accept or decline each change. Only same-field edits in both places are flagged as collisions. |
| 2026-09-23 | Equipment tagged New/Existing. All users have equal permissions. Tolerance ±10%. Equipment photos are required unless N/A. |
| 2026-09-23 | PR #1 merged into `main`. **N/A (option A):** revision 05 hardens formulas so `N/A`, `Not Avail.` and `Not Acc.` print in numeric cells without errors. |
| 2026-09-23 | Full offline support is required. Most sites are online, so sync runs continuously when connected, and offline is the fallback rather than the normal mode. |
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
- [ ] Template map: remaining areas (Building Balance spare OA rows, hood/traverse page remarks, Certification). Convert to versioned JSON per template revision.
- [x] **Export spike** (`spike/export`, `npm run spike`): 71 PASS / 0 FAIL. 634 cells written directly into the XML; 66 of 83 parts byte-identical, VBA unchanged; 0 error cells after recalculation; 189/189 expected values; import round trip with 0 differences (also after a LibreOffice re-save); 6/6 unsafe writes rejected.
- [x] **Spike:** cover photo cropped (≈1.685:1) and inserted into the Cover Page drawing
- [ ] **Open the spike export in desktop Excel**: no repair prompt, recalculation on open, macros/ToC button, dropdown values, cover photo proportions, print layout
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
- [ ] Keep the re-imported issued workbook as the base for the next export (F1)
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
- [ ] Access control: M365 sign-in only; all users have equal permissions
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
