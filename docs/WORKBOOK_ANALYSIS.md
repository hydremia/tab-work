# Workbook Analysis — `00 - a2b_Blank_TAB_Workbook 4-16-26.xlsm`

> ⚠️ **SUPERSEDED (2026-09-23).** This analysis was done on the **old 4-16-26 backup**. The current template is
> **`04 - a2b_Blank_TAB_Workbook 9-18-26.xlsm`** (revision 04). It lives on branch `claude/tab-report-review-3divp8`,
> [PR #1](https://github.com/hydremia/tab-work/pull/1), which is not yet merged. Revisions 01–04 already fixed the
> link bugs listed below, adopted the Evergreen hood method, and restructured the sheets (RTUs, MAUs, ERVs, Fans,
> Small Fans, VAVs, Hoods, Traverses, Equipment Summary, Narrative). The template map must be built from revision 04.
> The sections below are kept only for history.

Findings from inspecting the template. This is the basis for the Template Map (Phase 0).

## Sheet inventory

| Sheet | Role | Repeating capacity |
|---|---|---|
| Cover Page | Title page with formulas pulling from Project Information. Has an image (cover photo / logo). | — |
| ToC | Table of contents. Page counts come from the `SyncToCPageCounts` macro. | — |
| Summary - New / Summary - (E) | Numbered remarks: `# / Remark / Status / Comments` (has a data validation list) | 1 page each |
| **{Project Information}** | **Input:** project name, address, architect, mech/elec engineer, GC, mech contractor, TAB dates, technicians, PM, blueprints and revision date | — |
| **{Equipment Data Entry}** | **Input:** design schedule by group. Most other sheets pull from here. | RTU/AHU rows 7–46 (40); MAU/SF rows 52–61 (10); ERV rows 65–77; EF/KEF rows 81–120 (40); Hoods rows 126+ |
| {Dropdowns} (hidden) | List values: SF, Voltage, Phase, Filter Size, Traverse Instrument, plus about 80 named ranges | — |
| Building Balance | OA / exhaust totals by unit | — |
| RTU Data | Field test data per unit (motor, drives, RPM, static profile, filters, notes) | **40 blocks** |
| RTU Airflow | Supply outlets (28 rows), return (3), OA (1) per unit | **40 blocks** (49-row stride) |
| MAU Data / MAU Airflow | Same structure as RTU | **10 blocks** |
| Fan Data (EFs, TFs, etc.) / Fan Airflow | Same structure as RTU | **40 blocks** |
| VAV Data | Box data (max/min CFM, size, calibration factor…) | **80 blocks** |
| VAV 1-20 Airflow | Outlet readings per box | **20 blocks** |
| Hoods | Hood data and filter readings | **20 blocks** |
| Traverses | Pitot traverse points, instrument, duct SP, temperature | **49 traverses** |
| Photos (hidden) | Photo placeholders with descriptions | 20 slots |
| Certification / NEBB Cert / NEBB Frm Cert / Abbreviations / Calibration | Mostly static. Calibration lists the instruments. | — |

Blocks repeat at fixed row strides. For example, RTU Data blocks start at rows 4, 27, 53, 76, …, which
alternates between 23 and 26 rows because of page breaks. The template map must record each block's start row
explicitly rather than assume a fixed stride.

## Input vs. formula cells

- Data sheets pull design values from `{Equipment Data Entry}` through formulas (designation, manufacturer,
  model, HP, ESP, RPM, sheaves, belts, voltage/phase, design CFM).
- Field inputs are the blank cells: serial number, motor manufacturer, FLA, frame, measured volts/amps, static
  pressures, RPMs, VFD Hz, OA damper position, filter info, drive change data, technician notes, and outlet
  size/Ak/velocity readings.
- Calculated in Excel: CFM = VEL × Ak, % of design, totals, return = total − OA, TSP/ESP, corrected FLA,
  estimated BHP. **Export must not overwrite these cells.**

## Template bugs found (already fixed in revision 01)

1. **`RTU Data!C40`**, the phase for RTU slot 2, references `'{Equipment Data Entry}'!O7` (RTU-1's phase)
   instead of `O8`. Every other slot follows the pattern (O9, O10, …). **Fixed:** now `O8`.
2. **`{Equipment Data Entry}!P2` / `P3`** (header technician and date) reference `'{Project Information}'!I12`
   and `I11`, which are empty. All other sheets correctly use `E12` / `E11`. **Fixed:** now `E12` / `E11`.

Both were already fixed in revision 01 (`b468be8`, "RTU Data return air/ESP/phase" and the header formulas).
Revision 04 has the `E12`/`E11` references. A duplicate fix applied to the 4-16-26 backup on 2026-09-23 was
**reverted**, so the backup stays byte-identical to the original upload.

## Export constraints

- The file contains `vbaProject.bin` (the `SyncToCPageCounts` module), drawings and images (logo, cover,
  certificates), a web extension (task pane add-in), printer settings and about 80 defined names.
- Saving through openpyxl drops the images, drawings and web extension. Saving through other libraries
  risks the same. **Export must write values directly into `xl/worksheets/sheetN.xml` (and
  `sharedStrings`) inside the original zip.**
- The cover photo requires replacing or adding a media part in `xl/drawings/drawing1.xml` (Cover Page).
- After filling cells, set the workbook to recalculate fully on open (`fullCalcOnLoad`), so Excel refreshes
  the formula results.

## Hoods sheet vs. Evergreen worksheet (`tb-worksheet-evergreen 2.xlsx`)

**Correction: these were aligned in revision 01 and carried through revision 04.** The table below describes the *old* 4-16-26 file only.
In the old file, The workbook's Hoods sheet calculates each filter's CFM as
`VEL × (width × height / 144)`, which is **gross face area with no correction factor**. It has up to 14 filter
rows per hood, one filter height per hood, and a design/initial/final total.

The Evergreen worksheet has the following, which our template is missing:

| Evergreen sheet | Method | In our template? |
|---|---|---|
| Exhaust with Baffle Filters | CFM = **free area** (looked up by filter size) × VEL × **K-factor** (Captrate vs. Baffle). Filter type per hood, hood **length**, **CFM/ft** | ❌ No free area, K-factor, filter type or length/CFM-per-ft |
| PSP Supply | Perforated supply plenum: length, width, # of blanks, up to 15 velocity readings, averaged, then lookup factors; CFM and CFM/ft | ❌ |
| Supply Fan Filters | Filter size lookup (free area × factor) × VEL | ❌ |
| HVC or Slot Filters | 3 readings per filter, averaged × lookup factors | ❌ |
| Condensate Baffle Filters | 3 readings per filter, averaged × lookup factors | ❌ |
| Direct Fired Profile Pres. CFM | Heater housing size + burner profile pressure → CFM from the manufacturer's curve (piecewise linear) | ❌ |
| Building Pressures | Kitchen vs. dining room pressure and the difference | ❌ |

**What revision 04 has:** Hoods CFM = velocity × Evergreen free area × K-factor, by filter type and size. Filter
Type and Instrument dropdowns. 3 readings per filter (averaged). Hood length and CFM/ft. **MAU Supply Methods**
section (PSP, supply filter grid K 1.35, direct-fired burner profile pressure) with a "Method used" selector on
the MAUs page. **Measured Building Pressures** table (incl. Kitchen–Dining) on Building Balance. Constants are on
`{Dropdowns}` H–L. A cleaned reference copy is in `tb-worksheet-evergreen 3 (reference).xlsx`. Details and the
quantified before/after comparison (the old page under-read Captrate 16×20 hoods by 4.1%) are in
`docs/TAB-Report-Review.md` §4 on that branch.

Note: the Calibration sheet lists an *Evergreen Telemetry "Three Pounder"* balometer, so these are that
manufacturer's hood-measurement methods.

## Photos

Equipment photos (unit, tag/label, OA damper position) and deficiency photos are **not** part of the current
workbook. They will be exported as a **separate Photo Report**. The hidden `Photos` sheet (20 slots) could
optionally be filled for small projects. *See Q6.*
