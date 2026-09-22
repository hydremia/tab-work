# TAB App — Plan & Roadmap

**Goal:** One data-entry interface for live TAB projects that works well on a phone and moves data cleanly
into and out of the a2b TAB Workbook (`00 - a2b_Blank_TAB_Workbook 4-16-26.xlsm`).

**Status:** Phase 0 (Discovery). Progress is tracked in [`TRACKER.md`](./TRACKER.md). What we learned about
the template is in [`WORKBOOK_ANALYSIS.md`](./WORKBOOK_ANALYSIS.md).

---

## 1. Guiding principles

1. **The app is the source of truth while a project is live. The Excel workbook is what gets delivered.**
   Import gets existing or in-progress workbooks into the app. Export produces a workbook that is identical to
   one filled in by hand: same formatting, formulas, macros and page setup.
2. **Offline first.** Jobsites (rooftops, mechanical rooms, basements) often have no signal. All entry and
   photo capture works offline and syncs when the device reconnects.
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
| Photo Report | Generated PDF (client-side with pdf-lib, or an Edge Function), plus a zip of full-resolution originals | Keeps photos out of the workbook, as requested. |
| Hosting | Vercel, Netlify or Cloudflare Pages | Static PWA hosting with preview deploys for every PR. |
| Monitoring | Sentry (free tier) | Captures crashes and sync errors from devices in the field. |

**Alternative if the company runs on Microsoft 365:** sign in with Entra ID (Microsoft 365 accounts) and
store exported workbooks and photo reports in SharePoint/OneDrive through Microsoft Graph. We would likely
still use Supabase for the live database and sync. *See open question Q2.*

### Data model (first draft)

- `organizations`, `users`, `project_members(role: tech | pm | reviewer | viewer)`
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
| Red | Needs attention | Open deficiency, **or** a reading outside tolerance (e.g. airflow outside ±10% of design, which will be configurable) |
| Blue (optional) | Reviewed | PM or reviewer has signed off |

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
- Support for the **Evergreen kitchen-hood worksheet** (`tb-worksheet-evergreen 2.xlsx`) as a second template. *See Q8.*

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
| *Optional* Microsoft Entra ID app registration | "Sign in with Microsoft" / SharePoint export | Included with M365 |
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
| **3** | Excel export & import | Export a complete workbook from the app. Import an existing workbook into the app. Round-trip tests (import → export → diff = no changes). Checks for capacity overflow (more than 40 RTUs, etc.). **This is the first release usable on a real job.** |
| **4** | Photos | Camera or camera-roll capture, compression, categories (cover, deficiency, unit, tag, OA damper), captions. Cover photo goes into the workbook. **Separate Photo Report PDF** plus a zip export. |
| **5** | Cloud sync & multi-user | Field-level push/pull, realtime updates, conflict flags, roles and permissions, background photo upload. Two techs on one project at the same time. |
| **6** | Reporting workflow | Deficiency tracker feeding Summary remarks, instrument/calibration library, review and sign-off, audit history. |
| **7** | Pilot & hardening | Run one live project start to finish, fix what we find, write the user guide, roll out to all techs. |
| **8+** | Enhancements | Nameplate auto-fill, QR tags, tablet grid mode, PM dashboard, Evergreen worksheet, native app wrapper if needed. |

Why this order: the Excel export (Phase 3) is where the business value is, and it's also the biggest technical
risk, so we prove it in the Phase 0 spike before building anything else. Sync comes after the data entry
works on one device. The data model is designed for sync from day one (UUIDs, field-level change log), so
adding sync later doesn't require a rewrite.

---

## 6. Key risks

| Risk | Mitigation |
|---|---|
| Export damages the workbook (lost macros, images or styles) | Patch the template XML directly and never re-save it through a general-purpose library. Test that the file opens in desktop Excel. |
| Template changes over time | Versioned template map, and each project records which template version it uses. |
| Fixed capacity (e.g. 40 RTU slots, 20 VAV airflow pages) | Warn in the app and decide an overflow policy (*Q7*). |
| Offline conflicts | Field-level merge, conflict flags and full history, so nothing is silently lost. |
| iOS PWA limits (storage eviction, background upload) | Ask the browser for persistent storage, show an "unsynced items" indicator, and use the Capacitor wrapper if needed. |
| Calc drift between app and Excel | Unit tests that compare the app's calculations against values computed by Excel. |
