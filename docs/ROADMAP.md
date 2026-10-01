# TAB App — Plan & Roadmap

**Goal:** One data-entry interface for live TAB projects that works well on a phone and moves data cleanly
into and out of the a2b TAB Workbook, **revision 06** (`06 - a2b_Blank_TAB_Workbook 10-1-26.xlsm`: revision 05's
layout and N/A-safe formulas in a2b's own look).

**Status:** Phase 0 (Discovery). Progress is tracked in [`TRACKER.md`](./TRACKER.md). What we learned about
the template is in [`WORKBOOK_ANALYSIS.md`](./WORKBOOK_ANALYSIS.md).

---

## 1. Guiding principles

1. **The app is the source of truth while a project is live. The Excel workbook is what gets delivered.**
   Import gets existing or in-progress workbooks into the app. Export produces a workbook that is identical to
   one filled in by hand: same formatting, formulas, macros and page setup.
2. **Offline first.** Jobsites (rooftops, mechanical rooms, basements) often have no signal. All entry and
   photo capture works offline and syncs when the device reconnects.
   *Field profile (2026-09-29):* most sites have usable 5G on the tech's phone or an open Wi-Fi. Some have patchy
   access and a few have none. Phones and tablets are the main devices, so sync has to cope with a connection that
   comes and goes all day, not just a clean offline or online.
3. **Driven by the template.** A versioned *template map* (JSON) defines every sheet, block, field and
   cell. Forms, validation, completeness rules, import and export are all generated from that map. When the
   workbook changes (e.g. a new revision after 4-16-26), we update the map, not the app code.
4. **The app only writes inputs; Excel does the math.** The workbook already calculates CFM, % of design, TSP/ESP,
   corrected FLA and BHP. The app shows the same results live on the phone, and export fills in only the
   input cells so the workbook's formulas stay authoritative.
5. **Photos live in the app.** Equipment and deficiency photos are *not* part of the current workbook.
   They are exported as a separate **Photo Report**. Only the cover photo is placed inside the workbook.

---

## 2. Proposed architecture

```
 ┌──────────────────────────── Phone / Tablet / Laptop ────────────────────────────┐
 │  PWA (React + TypeScript, installable, works offline)                           │
 │   • Forms generated from Template Map      • Live calc engine (mirrors Excel)   │
 │   • Camera / camera-roll capture           • Completion status (color coding)   │
 │   • Local DB (IndexedDB) + outbound queue  • Excel import / export (in browser) │
 └───────────────▲──────────────────────────────────────────────▲─────────────────┘
                 │ sync (push local changes / pull remote)       │ photo upload queue
 ┌───────────────┴──────────────────────── Supabase ─────────────┴─────────────────┐
 │  Auth (email / Microsoft SSO)   Postgres + Row-Level Security   Realtime (live) │
 │  Storage (photos, exported reports, imported workbooks)   Edge Functions (PDF)  │
 └─────────────────────────────────────────────────────────────────────────────────┘
```

| Layer | Choice | Why |
|---|---|---|
| Front end | React + TypeScript + Vite, installable **PWA** | One codebase for iPhone, Android, iPad and desktop. Installs from a link, so no app-store review. It can be wrapped with Capacitor later if we need native features. |
| Local storage | IndexedDB via Dexie | Keeps whole projects and queued photos on the device for offline work. |
| Backend | **Supabase** (Postgres, Auth, Storage, Realtime) | One service covers the database, logins, file storage and live updates. Row-level security gives per-project access. It's standard Postgres, so we aren't locked in. |
| Excel I/O | JSZip plus direct OOXML (XML) patching of the template | Common libraries (openpyxl, SheetJS community, ExcelJS) **drop images, drawings and add-ins or damage VBA** when they save. Writing values straight into the template's sheet XML keeps everything intact. Runs in the browser, so export works offline. |
| Issues & Photo Reports | Generated PDF (client-side with pdf-lib, or an Edge Function). Issues-only, Photos-only, or combined. Plus a zip of originals | Keeps photos out of the workbook. Deficiency photos are numbered to their issue #. |
| Hosting | Vercel, Netlify or Cloudflare Pages | Static PWA hosting with preview deploys for every PR. |
| Monitoring | Sentry (free tier) | Captures crashes and sync errors from devices in the field. |

**Confirmed:** the company uses Microsoft 365, and all project files live in a team **Dropbox**.
- **Sign-in:** Microsoft accounts through Entra ID. Supabase Auth supports this as the Azure provider.
  Setup steps are in [SETUP_ACCOUNTS.md](./SETUP_ACCOUNTS.md).
- **Dropbox: no integration.** Exports download to the device, and users save them into the project's Dropbox folder
  as they do today (Dropbox desktop folder, or the phone share sheet). Re-import means picking the file the same way.
- **Photos** are stored in Supabase Storage (managed cloud storage), not Dropbox and not self-hosted.
- Every export is also kept in the app as a frozen revision (Prelim, Rev 1…).

### Data model (first draft)

- `organizations`, `users`, `project_members`: internal users only, all with equal permissions
- `projects`: project information fields, cover photo, template version
- `equipment`: `id (uuid)`, `project_id`, `type` (RTU, MAU, ERV, EF, VAV, Hood, Traverse…), `designation`
  (e.g. RTU-1), `slot` (block index in the workbook), `data` (JSON of field values), `status`
- `airflow_rows`: outlet and traverse rows belonging to one piece of equipment (grille no., size, Ak, design, initial and final readings)
- `deficiencies`: numbered items that feed *Summary* remarks, with status, comments and linked equipment/photos
- `photos`: `id`, `project_id`, `category` (cover | deficiency | unit | tag | oa_damper | other),
  `equipment_id?`, `deficiency_id?`, caption, storage path, thumbnail, EXIF time and GPS
- `instruments`: instruments and calibration records, feeding the *Calibration* sheet
- `field_changes`: `(record, field, value, user, device, timestamp)`, which serves as the sync log and audit trail

### Sync & multi-user strategy

You described a push/pull sequence, and that's the right model, but at the **field level** rather than
the whole report. Two techs working on the same project at once won't overwrite each other.

- Every edit is saved locally first as a field change, then pushed when online. Pull brings down other users' changes.
- Supabase Realtime pushes changes to everyone who has the project open, so updates appear live.
- **Conflicts:** if two people edit the *same field* while offline, the later edit wins and the earlier value
  is kept in history and flagged for review. Edits to different fields merge without any conflict.
- Photos upload in the background from a retry queue, and a thumbnail shows immediately.
- Optional soft locks ("Mike is editing RTU-3") when someone opens a piece of equipment.

### Completion status (color coding)

Each equipment type has **required-field rules** defined in the template map:

| Color | State | Rule |
|---|---|---|
| Gray | Not started | No field data entered |
| Amber | In progress | Some required fields are missing |
| Green | Complete | All required fields filled and photos attached (if required) |
| Red | Issue / tolerance (was "Needs attention") | Open deficiency, **or** a reading outside tolerance (e.g. airflow outside ±10% of design, which will be configurable) |
| Blue (optional) | Reviewed | A teammate has signed off |

Any field, section or piece of equipment can be marked **N/A**, and projects have a scope profile (Full TAB,
**Airflow Only**, Custom). Full rules are in [REQUIRED_FIELDS.md](./REQUIRED_FIELDS.md).

Status shows on each equipment card, as rollups per type and per project (e.g. "RTUs 12/18 complete"), and as
a filter ("show me everything still missing data").

---

## 3. Additional functionality to consider

The items marked ★ are the ones I'd recommend putting in the first release.

- ★ **Offline mode**, covered above. Without it the app will fail on real jobsites.
- ★ **Import the equipment schedule** from Excel/CSV, or paste it from the engineer's schedule, to pre-fill the
  *Equipment Data Entry* page in bulk.
- ★ **Deficiency tracker** with auto-numbering, status and photos that flows into *Summary – New / (E)* remarks.
- ★ **Tolerance flags** that highlight out-of-range readings on the spot, before leaving the site.
- ★ **Duplicate equipment** and **fill-down** for large groups of similar VAVs and grilles.
- **Instrument/calibration library.** Techs pick their instrument once, and the *Calibration* sheet and
  traverse instrument fields fill automatically.
- **Review and sign-off workflow.** The tech marks a unit complete, the PM reviews it, and the report is locked for issue.
- **Audit trail**: who changed what and when, which comes free with the sync log.
- **Nameplate photo → auto-fill** (AI vision reads manufacturer, model, serial, HP, FLA, voltage), with the tech confirming each value.
- **QR/barcode tags** on equipment to jump straight to its record.
- **Tablet grid mode**, a spreadsheet-style view for fast entry of long outlet lists.
- **Progress dashboard** for PMs across all active projects.
- **Page-count/ToC sync** built into the export. This replaces the need to run the `SyncToCPageCounts` macro, if possible.

---

## 4. Services, accounts & approximate cost

Prices are approximate. Confirm current pricing when signing up.

| Service | Purpose | Tier / approx. cost |
|---|---|---|
| **Supabase** | Database, auth, photo storage, realtime, functions | Free for development. **Pro about $25/mo** for production (includes about 100 GB of storage, with low per-GB overage after that) |
| **Vercel / Netlify / Cloudflare Pages** | Hosting the app | Free to about $20/mo |
| **GitHub** (already have) | Code, issues, CI (Actions) | Free or existing plan |
| **Domain** (e.g. `tab.a2bair.com`) | App URL | About $15/yr, or a subdomain of an existing domain |
| **Sentry** | Error monitoring | Free tier |
| **Microsoft Entra ID app registration** | Sign in with Microsoft 365 accounts | Included with M365 (needs an M365 admin) |
| *Optional* Apple Developer and Google Play | Only if we publish native store apps | $99/yr and $25 one-time |
| *Optional* Anthropic API | Nameplate photo reading | Pay-per-use, likely a few dollars a month |

**Storage estimate:** photos compressed on the device (about 2000 px, JPEG) run 300–500 KB each. At 200 photos per project that's about
100 MB, so 100 projects is about 10 GB. That fits comfortably within Supabase Pro. Originals can be kept if needed.

---

## 5. Phases

Each phase ends with something usable or a proven risk. Estimates assume part-time development with Claude Code
doing most of the implementation.

| Phase | Name | Outcome / exit criteria |
|---|---|---|
| **0** | Discovery & template spike | Open questions answered. Template map drafted for every sheet. **Spike proven:** fill the blank .xlsm from code, open it in Excel, and confirm macros, logos, cover image, formulas and print setup are intact. |
| **1** | Foundation | Repo scaffold (PWA, TypeScript, lint, tests, CI, preview deploys). Supabase project with auth and schema. Login and a project list. |
| **2** | Core data entry (single device, offline) | Project info, equipment list, and full forms for RTU, MAU/ERV, Fans, VAV, Hoods and Traverses. Live calcs match Excel. Completion color coding. Works in airplane mode. |
| **3** | Excel export & import | Export a complete workbook from the app. Import an existing workbook, **including re-importing an issued prelim for follow-up**, with a diff/merge review. Issued-report revisions. Option to export onto the previously issued workbook. Round-trip tests. **This is the first release usable on a real job.** |
| **4** | Photos & Issues reports | Camera or camera-roll capture, compression, categories, captions. Cover photo goes into the workbook. **Issues Report, Photo Report and combined report** exports, with deficiency photos numbered by issue. |
| **5** | Cloud sync & multi-user | Field-level push/pull, realtime updates, conflict flags, roles and permissions, background photo upload. Two techs on one project at the same time. |
| **6** | Reporting workflow | Deficiency tracker feeding Summary remarks, instrument/calibration library, review and sign-off, audit history. |
| **7** | Pilot & hardening | Run one live project start to finish, fix what we find, write the user guide, roll out to all techs. |
| **8+** | Enhancements | Nameplate auto-fill, QR tags, tablet grid mode, PM dashboard, Evergreen worksheet, native app wrapper if needed. |
| **9+** | Beyond the workbook | Better report design and graphics, a hydronic report, deterministic report prep from design documents, automated report review. See section 7. |

Why this order: the Excel export (Phase 3) is where the business value is, and it's also the biggest technical
risk, so we prove it in the Phase 0 spike before building anything else. Sync comes after the data entry
works on one device. The data model is designed for sync from day one (UUIDs, field-level change log), so
adding sync later doesn't require a rewrite.

---

## 6. Key risks

| Risk | Mitigation |
|---|---|
| Export damages the workbook (lost macros, images or styles) | Patch the template XML directly and never re-save it through a general-purpose library. Test that the file opens in desktop Excel. |
| Re-importing an issued report that was edited in Excel | Import shows a field-by-field diff to accept or reject changes. Every issued report is kept as a frozen revision. |
| Template changes over time | Versioned template map, and each project records which template version it uses. |
| Fixed capacity (e.g. 40 RTU slots, 20 VAV airflow pages) | Confirmed large enough. The app blocks adding past each limit. |
| Offline conflicts | Field-level merge, conflict flags and full history, so nothing is silently lost. |
| iOS PWA limits (storage eviction, background upload) | Ask the browser for persistent storage, show an "unsynced items" indicator, and use the Capacitor wrapper if needed. |
| Calc drift between app and Excel | Unit tests that compare the app's calculations against values computed by Excel. |

---

## 7. Future directions (added 2026-09-29, not scheduled)

These four came up after the first two-device test. None of them is needed for the pilot. Each note says what
the app already has to build on, the approach I'd suggest, and what we need from a2b first.

### 7.1 A better-looking report

The workbook stays the data of record: it's what NEBB-style review and the office know. The question is how to
present it better. Two routes, and they can be combined:

- **A. Improve the workbook itself (template rev 06).** Add colour for tolerance using conditional formatting
  (green in tolerance, amber close to the limit, red outside), cleaner borders and section bands, and a consistent
  header. It's cheap, stays in Excel, and the app's export already keeps the workbook's formatting.
- **B. A graphics appendix generated by the app (PDF)**, delivered with the workbook. It uses the same approach as
  the Issues and Photo reports (`app/src/reports`), which already make PDFs. The app has all the data, so it can
  draw what Excel can't draw well:
  - **Static pressure profile on a unit diagram.** A schematic RTU / AHU (OA / RA → filter → coil → fan → SA) with
    each reading at its tap, the pressure drop across every component, and TSP / ESP against design. It makes a
    loaded filter or a restrictive coil obvious at a glance.
  - **Duct traverse cross-section.** The round (equal-area rings on two or three diameters) or rectangular grid,
    each point shaded by velocity, the average marked, and points far from the average highlighted. Add a
    uniformity figure (the spread of the readings) so the reader can tell whether the traverse location was a
    good one.
  - **Outlet charts.** Design and actual CFM per outlet with the ±10 % band shaded, per system and per VAV, and the
    system total against the unit's measured airflow.
  - **Summary page.** Units tested, % in tolerance, open deficiencies by severity, and the building pressure
    diagram.

**Other ideas:**
- A floor plan with the outlets marked and coloured by % of design. This comes almost for free once 7.3's plan
  markup exists.
- A year-over-year comparison for re-tests.
- A QR code on the cover that opens an online version of the report.

**Needs from a2b:** 2–3 reports (ours or others') whose look we like, plus a decision on route A, B or both. I'd
start with B's traverse and static-profile graphics, because they add the most and don't touch the template.

### 7.2 Hydronic report

**Goal:** the same app and the same kind of workbook for water-side TAB, mirroring the airside skeleton. That means
Project Information, an Equipment Data Entry page, a data page and a readings page per equipment type, Summary
remarks, Instruments, Certification, and the same N/A, colour and review rules.

- **What NEBB requires** (read from the 9th Edition, §5.3.13 – 5.3.24 and Section 9; details in
  [`HYDRONIC_REQUIREMENTS.md`](./HYDRONIC_REQUIREMENTS.md)):
  - **Pumps** are the big form: nameplate, electrical, standing pressure, shut-off test that confirms the
    impeller, operating suction / discharge / TDH, flow, speed setting. Integrated variable-speed pumps report
    less.
  - **Balancing valves** (fixed / adjustable orifice: setting, ΔP, calculated flow; self-adjusting: tag flow and
    ΔP within range).
  - **Ultrasonic** flow readings, when used.
  - **Chillers, boilers, heat exchangers and cooling towers**: flow and ΔP only.
  - **No coil or terminal form:** terminals are reported through the valve that serves them. Water and air
    temperatures are optional (only the least accurate flow method uses them).
  - Tolerance **±10 % of design flow**, plus proof of a wide-open path through the system.
- **Calculations the app can do live** (the same "Excel does the math, the app shows it" principle):
  - GPM from a valve's ΔP and setting (the manufacturer's chart, or Cv × √ΔP);
  - flow from equipment ΔP against rated;
  - TDH from suction and discharge, with the elevation correction;
  - flow on the pump curve;
  - optional 500 × GPM × ΔT;
  - % of design and tolerance flags;
  - ΔP stored with its unit, because NEBB warns about mixing gauge and chart units.
- **A balancing assistant** (deterministic): NEBB's proportional method is a fixed sequence. After the first pass
  the app sorts the terminals by % of design, names the next valve to adjust and its target reading, and shows when
  the branch is balanced.
- **A balancing-valve library,** like the calibration library: valve models with their Cv or flow charts, so a
  tech picks *B&G CB-1½* and a setting and gets GPM.
- **No template yet:** I can draft the hydronic workbook *from* the airside one (same styles, headers, page setup
  and macro; proposed sheet list in HYDRONIC_REQUIREMENTS §4), write its template map, and generate the app forms from the map as for airside. The same
  map-driven code then covers both.

**Needs from a2b:**
- any past hydronic reports, even from other firms;
- which equipment types are common on a2b jobs;
- whether hydronic is a separate workbook per project or extra sheets in the airside one. I'd suggest a separate
  workbook with a shared Project Information, so airside-only jobs stay unchanged.

### 7.3 Report prep from design documents (deterministic, no LLM)

Every value that is filled in automatically is marked *from the schedule / drawings*, with its source (file, sheet,
page), and is shown for review before it's accepted, like the re-import review screen.

1. **Mechanical schedules → Equipment Data Entry.** *Already done for Excel, CSV and pasted schedules* (Import
   schedule). Next steps:
   - **Vector PDF schedules.** Drawings exported from Revit or AutoCAD keep their text with positions. The app can
     read those, find the header row by keywords (CFM, ESP, HP, RPM, MODEL, VOLTS…), rebuild the columns by x
     position and turn each row into a unit. This is deterministic and reliable on vector PDFs.
   - **Header dictionary.** Engineers label columns differently (*E.S.P.*, *EXT SP*, *External Static*). A synonym
     list maps them to fields. When the user corrects a mapping, the app remembers it for that engineering firm.
   - **Scanned PDFs** need OCR (Tesseract runs in the browser, no LLM). It works, but expect to review more.
2. **Air devices from the plans → the outlet report.** Grille tags on vector plans (e.g. `A-1 / 12×12 / 150`) are
   text the app can match with the pattern from the drawing's legend.
   - **Output:** each outlet's type, neck size and design CFM, with its position on the sheet, counted per sheet.
   - **The user's part:** tap a VAV or unit and lasso its outlets. The app then fills that system's airflow table
     in order (S-1, S-2…) and checks the design total against the VAV or unit schedule.
3. **Ductwork tracing** (the most advanced step: highlight whole systems, fill the duct, mark every register).
   - **On PDFs it's possible but brittle.** Duct walls are just pairs of lines once a drawing is flattened, and
     every firm draws differently. I'd do it as *assisted*: the user taps the unit, and the app follows the
     connected duct lines and highlights them, with the user fixing the gaps.
   - **The reliable route is the model itself.** If the engineer can provide the Revit model or an IFC export,
     systems, ducts and air terminals with their design CFM are explicit data. Highlighting a system and building
     the outlet report from it is then fully deterministic.
   - **Recommendation:** ask on the next few jobs whether an IFC or Revit file is available.

The marked-up plan from steps 2 and 3 then doubles as the report graphic in 7.1.

**Needs from a2b:** 3–4 real drawing sets (PDF, plus DWG / IFC / Revit where available) from different engineers,
with the report we produced for each. They are both the development data and the test set.

### 7.4 Automated report review (deterministic)

The app already checks completeness (colours), tolerance and missing items. A **review report** would add rule
checks, each with a severity and a link to the value. It would run on the app's projects *and on any imported
workbook*, for example a report from another tech or firm.

- **Arithmetic and consistency:**
  - outlet totals against the VAV or unit measured airflow;
  - traverse CFM against the sum of the outlets it serves;
  - OA + RA ≈ SA;
  - the building balance adds up;
  - CFM = velocity × Ak recalculated;
  - the same designation spelled the same on every sheet.
- **Physics sanity:**
  - operating amps against corrected FLA × service factor;
  - voltage within ±10 % of nameplate, and phase imbalance over 2 %;
  - BHP against motor HP;
  - fan-law check (the rpm change against the airflow change);
  - static profile signs and order (suction negative, discharge positive, ESP ≤ TSP);
  - filter pressure drop in a plausible range;
  - values outside physical ranges (a typo such as 85 in. w.g.).
- **Design against source:** design values in the report against the imported schedule (7.3). This catches
  transcription errors.
- **Paperwork (NEBB 5.2):**
  - instruments calibrated within 12 months of the test dates;
  - an instrument named on every page that needs one;
  - test dates inside the project dates and before the report date;
  - certification complete, with the stamp and signature;
  - the narrative present;
  - every abbreviation used is defined.
- **Remarks coverage:**
  - every out-of-tolerance reading has a remark or an issue;
  - every open issue has a photo;
  - every *Not Accessible* has a reason.
- **Hydronic, once 7.2 exists:**
  - pump flow against the sum of its terminals;
  - at least one wide-open valve path, and memory stops marked;
  - the shut-off head matches the impeller on the curve;
  - the VFD setpoint recorded on variable-flow systems;
  - ΔP units consistent with the valve chart.

The output is a checklist the reviewer works through before **Mark reviewed** and **Issue report**, and it can also
be printed as a QA sheet. The thresholds (for example 2 % imbalance or 10 % tolerance) are settings, so a2b can tune
them.

**Needs from a2b:** the checks a reviewer already makes by hand (even a rough list), and the thresholds a2b uses.

### 7.5 Equipment performance library: pump curves, fan curves, component pressure drops (added 2026-09-29)

This uses the same pattern as the valve library: data entered once from **real submittals and data sheets**, shared
with the team, each entry naming its source, and added to as equipment turns up. "Stock" curves for common equipment
are only worth having when they come from a published data sheet: a curve that is roughly right gives a flow or a
verdict that is precisely wrong in a certified report.

| Library | What an entry holds | What the app does with it |
|---|---|---|
| **Pump curves** (first) | make, model, speed; per impeller diameter the points (GPM, head ft); optional NPSH and BHP curves | NEBB 9.3.4 **pump-curve flow method**, done deterministically: the shut-off head picks the impeller (or a curve drawn parallel to the nearest one, as NEBB describes); the final TDH gives the flow on that curve. It fills the pump's final flow with the working shown, and draws the curve with the operating point on the pump page / report appendix (§7.1). |
| **Fan curves** | make, model, fan size, class; per RPM the points (CFM, static pressure in. w.g.), and BHP | Operating point from the measured RPM and TSP: the expected CFM, checked against the measured airflow (a large gap means a measurement or system problem); fan laws for the RPM needed to reach design (the sheave change to recommend); the curve with the operating point in the report appendix. |
| **Component pressure drops** | coil / filter / wheel / heat section: rated ΔP at a rated CFM (from the unit submittal) | The **expected static profile** of a unit at the measured airflow (ΔP scales with (CFM / rated CFM)²), drawn next to the measured one on the unit diagram (§7.1): a loaded filter or a restrictive coil stands out. Filters: clean vs. dirty ΔP. |
| **Motors** (small) | HP, RPM, FLA, SF, efficiency | Pre-fills motor data; the BHP estimate gets the real efficiency instead of the workbook's fixed 0.9. |

**How entries get in:**
- **Typed from the submittal:** the curve points read at a few flows (5–8 points per curve is enough for straight
  interpolation). The app draws what was entered over a picture of the submittal page, so it is easy to check.
- **Picture tracing (later):** photograph or import the submittal's curve page, click the axes' end values, then click
  along each curve. The points are read from the picture: this is deterministic, with no AI involved.
- **Manufacturer selection software exports** (Greenheck CAPS, Loren Cook, Bell & Gossett ESP-Systemwize and others)
  often give tables or CSV files, which import directly.

**Order I'd suggest:** pump curves first. They complete a NEBB method the hydronic report already uses, and pumps are
a2b's main hydronic equipment. Then component pressure drops, which pair with the static-profile diagram in §7.1.
Then fan curves.

**Needs from a2b:** a few real submittals (pump and fan curve pages, AHU / RTU component data) to shape the entry forms
and to test against.

