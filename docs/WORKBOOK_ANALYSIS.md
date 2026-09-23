# Workbook Analysis — `00 - a2b_Blank_TAB_Workbook 4-16-26.xlsm`

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

## Template bugs found — FIXED 2026-09-23

1. **`RTU Data!C40`**, the phase for RTU slot 2, references `'{Equipment Data Entry}'!O7` (RTU-1's phase)
   instead of `O8`. Every other slot follows the pattern (O9, O10, …). **Fixed:** now `O8`.
2. **`{Equipment Data Entry}!P2` / `P3`** (header technician and date) reference `'{Project Information}'!I12`
   and `I11`, which are empty. All other sheets correctly use `E12` / `E11`. **Fixed:** now `E12` / `E11`.

Both fixes were made by editing the sheet XML directly, so macros, images, styles and print settings are
unchanged. The workbook is also set to fully recalculate on open, so Excel refreshes the cached values.

## Export constraints

- The file contains `vbaProject.bin` (the `SyncToCPageCounts` module), drawings and images (logo, cover,
  certificates), a web extension (task pane add-in), printer settings and about 80 defined names.
- Saving through openpyxl drops the images, drawings and web extension. Saving through other libraries
  risks the same. **Export must write values directly into `xl/worksheets/sheetN.xml` (and
  `sharedStrings`) inside the original zip.**
- The cover photo requires replacing or adding a media part in `xl/drawings/drawing1.xml` (Cover Page).
- After filling cells, set the workbook to recalculate fully on open (`fullCalcOnLoad`), so Excel refreshes
  the formula results.

## Photos

Equipment photos (unit, tag/label, OA damper position) and deficiency photos are **not** part of the current
workbook. They will be exported as a **separate Photo Report**. The hidden `Photos` sheet (20 slots) could
optionally be filled for small projects. *See Q6.*
