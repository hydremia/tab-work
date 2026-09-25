# Workbook Analysis — revision 04 (`04 - a2b_Blank_TAB_Workbook 9-18-26.xlsm`)

This is the basis for the **Template Map** (Phase 0). Everything below was read from the revision 04 file with
openpyxl and by opening the zip/XML directly (2026-09-23). Revision 05 only changes formulas (N/A hardening), not
the layout, so these cell addresses apply to revision 05 too.

**Conventions**

- **P** = the block's anchor row (the row whose column B says `System`). Row offsets are written `+n` from P.
- **Q** = P + 52, the continuation page of a two-page unit.
- **In** = a cell the app writes. **ƒ** = a formula cell. The app must never write to a formula cell.
- **EDE** = the `{Equipment Data Entry}` sheet. `EDE:G` means "column G of this unit's EDE row".
- `[List]` = the cell has a dropdown that uses that named list (the values are in §6).

---

## 1. Sheet inventory (in tab order)

| # | Sheet (XML part) | Visible | Role | Capacity |
|---|---|---|---|---|
| 1 | Cover Page (`sheet1`) | yes | Title, project photo box, project lines, firm block | 1 page |
| 2 | ToC (`sheet2`) | yes | Table of contents. Page numbers are typed text, refreshed by the macro. Has the "Sync" form button. | 1 page |
| 3 | Narrative (`sheet3`) | yes | One free-text box (system set-up description) | 1 page |
| 4 | Summary - New (`sheet4`) | yes | Numbered remarks for new equipment | 50 printed rows |
| 5 | Summary - (E) (`sheet5`) | yes | Numbered remarks for existing equipment | 50 printed rows |
| 6 | {Project Information} (`sheet6`) | yes | **Input:** project header fields and drawing list | — |
| 7 | {Equipment Data Entry} (`sheet7`) | yes | **Input:** design schedule, one row per unit. Unit pages pull from it. | see §3 |
| 8 | {Dropdowns} (`sheet8`) | **hidden** | Dropdown lists, CaptiveAire/Evergreen constants, unit-type table | — |
| 9 | Equipment Summary (`sheet9`) | yes | One line per unit, all formulas. Tolerance cell E5 is the only input. | 160 unit lines |
| 10 | Building Balance (`sheet10`) | yes | OA vs exhaust totals (formulas), building pressure table (input) | 1 page |
| 11 | RTUs (`sheet11`) | yes | Rooftop units / AHUs / DOAS | **40** units × 2 pages |
| 12 | MAUs (`sheet12`) | yes | Make-up air / supply fan units, incl. supply methods | **10** units × 2 pages |
| 13 | ERVs (`sheet13`) | yes | Energy / heat recovery units | **10** units × 2 pages |
| 14 | Fans (`sheet14`) | yes | Exhaust, transfer, kitchen exhaust fans | **40** units × 2 pages |
| 15 | Small Fans (`sheet15`) | yes | Direct-drive fans under 1/6 hp (NEBB 5.3.6) | **40** blocks, 2 per page |
| 16 | VAVs (`sheet16`) | yes | VAV / fan-powered terminals, each with its own outlet table | **80** blocks, 2 per page |
| 17 | Hoods (`sheet17`) | yes | Kitchen hoods, Evergreen filter method | **20** hoods, 2 per page |
| 18 | Traverses (`sheet18`) | yes | Duct pitot traverses with point grid | **48** traverses, 3 per page |
| 19 | Photos (`sheet19`) | **hidden** | Legacy photo slots with descriptions (not used by the app) | 20 slots |
| 20 | Certification (`sheet20`) | yes | Certification text, stamp box, signature and date lines | 1 page |
| 21 | NEBB Cert  (`sheet21`, trailing space in the name) | yes | Certificate images | — |
| 22 | NEBB Frm Cert (`sheet22`) | yes | Firm certificate image | — |
| 23 | Abbreviations (`sheet23`) | yes | Legend, includes `N/A`, `Not Avail.`, `Not Acc.` | — |
| 24 | Calibration (`sheet24`) | yes | Instrument list | 8 instruments |

No sheet is protected, so Excel does not enforce which cells are inputs. The "locked" flag is not a reliable
signal either. The input/formula split below comes from the cell contents and from the formulas that reference
each cell.

## 2. Repeating blocks (strides verified on every block)

| Sheet | Blocks | Anchor rows (P) | Stride | Per page | Page breaks |
|---|---|---|---|---|---|
| RTUs | 40 | 4, 108, 212 … 4060 | 104 (2 × 52-row pages) | 1 unit per 2 pages; continuation page at Q = P + 52 | manual breaks after every page (80) |
| MAUs | 10 | 4, 108 … 940 | 104 | same as RTUs | 20 |
| ERVs | 10 | 4, 108 … 940 | 104 | same as RTUs | 20 |
| Fans | 40 | 4, 108 … 4060 | 104 | same as RTUs | 80 |
| Small Fans | 40 | 4, 28, 52 … 940 | 24 | 2 | after every 2nd block (rows 51, 99, …) |
| VAVs | 80 | 4, 30, 56 … 2058 | 26 | 2 | after every 2nd block |
| Hoods | 20 | 4, 25, 53, 74, 102, 123 … 445, 466 | alternates **21 / 28** (page = 49 rows) | 2 | **none** (the macro sets print areas) |
| Traverses | 48 | 5, 20, 35, 54, 69, 84 … 770 | 15 inside a page, page = 49 rows | 3 | after rows 52, 101, 150 … 787 |

Formulas: anchor of unit *n* (1-based):
RTUs/MAUs/ERVs/Fans `P = 4 + 104(n−1)`, Small Fans `4 + 24(n−1)`, VAVs `4 + 26(n−1)`,
Hoods `4 + 49⌊(n−1)/2⌋ + 21·((n−1) mod 2)`, Traverses `5 + 49⌊(n−1)/3⌋ + 15·((n−1) mod 3)`.

Unit *n* on a unit sheet always reads EDE row *(section start + n − 1)* (§3). Headers on rows 2–3 of every
report sheet (Project, Address, Technician, Date) are formulas from {Project Information}.

## 3. {Project Information} and {Equipment Data Entry}

### {Project Information} — all input

| Cell | Field | Template value (overwrite on export) |
|---|---|---|
| E2:L2 | Project Name | `{ProjectCode}` |
| E3:L3 | Physical Address | `{Address}` |
| E4:L4 | Architect | `Architect Firm` |
| E5:L5 | Mechanical Engineer | `Mechanical Eng.` |
| E6:L6 | Electrical Engineer | `Electrical Eng.` |
| E7:L7 | General Contractor | `General Con.` |
| E8:L8 | Mechanical Contractor | `Mechanical Con.` |
| E11:H11 | Project TAB Date(s) | `2026-04-20` (a date) |
| E12:H12 | Technician(s) | `TBD` |
| E13:H13 | Project Manager | `TBD` |
| E14:H14 | Report Date | blank |
| B17:D25 / E17:F25 | Blueprints used / revision date | 9 rows (B:D sheet, E:F date) |

### {Equipment Data Entry} (EDE) — all input, no dropdowns

Row 1 of each section is pre-filled with a sample designation (`RTU-1`, `MUA-1`, `ERV-1`, `EF-1`, `H-1`,
`VAV-1`, `EF-S1`). The export must clear or overwrite these, otherwise unit 1 looks "used" to the macro.

| Section | Rows | Columns (header text) | Linked to unit pages? |
|---|---|---|---|
| RTU / AHU | 7–46 (40) | B Designation, C Area Served, D Location, E Manufacturer, F Model, G HP, H Unit ESP, I Fan RPM, J Motor Sheave, K Fan Pulley, L Belts, M C to C, N Voltage, O Phase, P Design Total CFM, Q Design OA CFM | B–O yes. **P and Q are not linked** (sheet says "INFO ONLY"). Design CFM on the unit page is the sum of the outlet design CFMs. |
| MAU / SF | 52–61 (10) | same as RTU | B–O yes; P, Q not linked |
| ERV | 65–74 (10) | B–O as RTU, P Design Supply CFM, Q Design Exhaust CFM, R Design Supply ΔP, S Design Exhaust ΔP | B–G, I–O, R, S yes. **H (ESP), P and Q are not linked**, although the header says "Linked to ERV Data". |
| Exhaust fans | 81–120 (40) | same as RTU | B–O yes; P, Q not linked |
| Hoods | 126–145 (20) | B Designation, C Area Served, D Location, E Manufacturer, F Design Airflow, G KEF Interlock, H Model, I Hood Length (ft) | B, C, E, F, H, I yes. **D and G not linked** (the hood page has its own "Associated Exhaust Fan" input). |
| VAV / fan-powered | 150–229 (80) | B Designation, C Area Served, D Location, E Manufacturer, F Model, G Inlet Size, H Terminal Type, I Design Max CFM, J Design Min CFM, K Heating CFM, L Fan CFM, M DDC Address | all |
| Small exhaust fans | 233–272 (40) | B Designation, C Area Served, D Location, E Manufacturer, F Model, G HP, H Voltage, I Phase, J Design CFM | B–I yes. **J not linked** (design comes from the outlet table). |

Rows 2–3 (Project/Technician/Address/Date) are formulas. Phase must be typed exactly `1-phase` or `3-phase`:
the BHP formula tests `C17="1-phase"`.

## 4. Unit block maps

Outlet table rows (all unit sheets and VAVs) share one layout:

| B | C | D | E | F | G | H | I | J | K | L | M |
|---|---|---|---|---|---|---|---|---|---|---|---|
| No. **In** | Area served **In** | Type **In** | Size **In** | Ak **In** | Design VEL ƒ (H/F) | Design CFM **In** | Initial VEL **In** | Initial CFM ƒ | Final VEL **In** | Final CFM ƒ | % ƒ |

`%` uses Final when present, otherwise Initial. Totals and subtotals are ƒ.

### 4.1 RTUs (also the base layout for MAUs, ERVs, Fans)

| Row | Input cells | Formula cells (source) |
|---|---|---|
| +0 | — | D System (EDE:B), I Service (EDE:C) |
| +2 | D Drive Type `[Drive.Type]`, G Rotation design, J Rotation actual, M Sheave bore M/F | — |
| +4 | — | D Manufacturer (EDE:E) |
| +5 | — | D Model (EDE:F); K Total design = supply total, L Total actual, M % |
| +6 | D:G Serial No. | K OA design = OA row design, L OA actual, M % |
| +7 | — | D Area (=Service); K/L Return = Total − OA |
| +8 | — | D Location (EDE:D); K Unit ESP design (EDE:H), L ESP actual = profile ESP |
| +9 | — | K Fan RPM design (EDE:I), L = final fan RPM (+18 L) |
| +10 | L:M Filter type / size / qty (one text cell) | — |
| +11 | D:G Motor manufacturer | — |
| +12 | F Motor RPM, G Service factor `[Service.Factors2]` ¹ | D HP (EDE:G); L Motor sheave (EDE:J) |
| +13 | E FLA, G Frame | B Voltage (EDE:N) ², C Phase (EDE:O) ²; L Fan sheave (EDE:K) |
| +14 | — | D Corrected FLA, G Estimated BHP; J Belts (EDE:L), L C to C (EDE:M) |
| +15 | E, F, G Measured voltage (3 legs); L:M Final settings (text) | — |
| +16 | E, F, G Measured amperage (3 legs) | — |
| +17 | K / L Motor RPM initial / final | — |
| +18 | K / L Fan RPM initial / final | — |
| +19 | K / L VSD frequency initial / final | C–G component labels (from unit type) |
| +20 | C Entering static (first component); **RTU only:** L OA damper position | D–G entering statics (= previous leaving) |
| +21 | C, D, E, F, G Leaving static for components 1–5 | — |
| +22 | D:E Unit type `[Unit.Type]` (pre-set `RTU`) | — |
| +23 … +25 | — | Profile strip: labels, statics, ΔPs, Fan TSP (E), ESP (I), unit ΔP (M) |
| +26 | D:F Instrument `[Airflow.Instrument]`, I:M Ak basis / notes | — |
| +29 … +38 | Supply outlets, 10 rows | +39 Total |
| +42 … +43 | Return inlets, 2 rows ³ | +44 Total |
| +47 | Outside air, 1 row | — |
| +48 … +50 | Remarks: D:M, B:M, B:M (3 lines) | — |
| Q+4 … Q+41 | Supply outlets (cont.), 38 rows | Q+42 Subtotal |
| Q+45 … Q+48 | Return inlets (cont.), 4 rows | Q+49 Subtotal |
| Q+50 … Q+51 | Remarks (cont.): D:M, B:M | Q+0 System / Service (EDE) |

Capacity per RTU: **48 supply, 6 return, 1 OA**.
Static profile components by unit type (`{Dropdowns}` X1:AD6): RTU = Filter, —, Coil, Heat, Fan;
DOAS = Filter, Wheel, Coil, Heat, Fan; MAU = Filter, —, Burner, —, Fan; ERV = Filter, Core, —, —, Fan;
EF = —, —, —, —, Fan. A component marked "—" is greyed out and should be N/A in the app.

¹ The SF cell holds the text `SF` as a placeholder, and the list includes `SF` as its first entry (the named
range starts on the header row). Treat `SF` as blank.
² Voltage and phase are formulas **and** carry dropdowns. Picking a value in Excel replaces the formula. The app
should write voltage/phase to EDE:N/O only.
³ The first return row's **Design CFM (H) and Final CFM (L) are formulas** (Total − OA). Only the other return
rows take a typed Final CFM. A Final VEL typed in the first return row has no effect on its CFM.

### 4.2 MAUs (differences from RTUs)

| Row | Input cells | Formula cells |
|---|---|---|
| +5 | — | K Total design = Design CFM override (Q+18) if typed, else outlet total; L Total actual = outlets, or the selected method's CFM |
| +6 | — | K Unit ESP (EDE:H), L = profile ESP |
| +7 | — | K Fan RPM (EDE:I), L = final fan RPM |
| +20 | C Entering static (no OA damper field) | |
| +22 | D:E Unit type (pre-set `MAU`) | |
| +29 … +44 | Supply outlets, 16 rows | +45 Total |
| +47 … +50 | Remarks, 4 lines | |
| **Q+3** | **PSP:** D Length (in), G Width `[PSP.Width]`, J Blanks | M K-factor (from width) |
| Q+4 … Q+5 | PSP velocities D:M (20 readings) | Q+6 E PSP CFM, K CFM/ft |
| Q+9 | **Filter grid:** C:M Filter size `[Hood.FilterSize]` (11 filters) | |
| Q+10 | C:M Velocity (fpm) | Q+11 CFM per filter, Q+12 E Grid total |
| Q+15 | **Burner profile pressure:** D Housing size (whole number 1–5), H Profile pressure (in. w.g.) | K Derived CFM |
| Q+18 | E:G **Method used** `[Airflow.Method]`, K:M Design CFM override | |
| Q+19 | K:M Remarks | E Method total CFM |
| Q+25 … Q+46 | Supply outlets (cont.), 22 rows | Q+47 Subtotal |
| Q+49 … Q+50 | Remarks (cont.), 2 lines | |

No OA / return tables. Capacity: **38 outlets**. Method list (rev 05): Outlets, PSP, Filter Grid, Profile Pressure.

### 4.3 ERVs (differences from RTUs)

| Row | Input cells | Formula cells |
|---|---|---|
| +5 | — | K / L Supply airflow design / actual (supply table totals) |
| +6 | — | K / L Exhaust airflow design / actual (exhaust table totals) |
| +7 | L Supply ΔP actual | K Supply ΔP design (EDE:R) |
| +8 | L Exhaust ΔP actual | K Exhaust ΔP design (EDE:S) |
| +9 | — | K Fan RPM (EDE:I), L = final fan RPM |
| +20 | C Entering static (no OA damper field) | |
| +22 | D:E Unit type (pre-set `ERV`) | |
| +26 | Supply instrument D:F, Ak notes I:M | |
| +29 … +34 | Supply outlets, 6 rows | +35 Total |
| +36 | Exhaust instrument D:F `[Airflow.Instrument]`, Ak notes I:M | |
| +39 … +44 | Exhaust inlets, 6 rows | +45 Total |
| +47 … +49 | Remarks, 3 lines | |
| Q+4 … Q+21 | Supply (cont.), 18 rows | Q+22 Subtotal |
| Q+26 … Q+43 | Exhaust (cont.), 18 rows | Q+44 Subtotal |
| Q+46 … Q+47 | Remarks (cont.), 2 lines | |

No Unit ESP row on the data block (the strip still computes ESP). Capacity: **24 supply, 24 exhaust**.

### 4.4 Fans (differences from RTUs)

Data block as MAUs (+5 Total, +6 Unit ESP, +7 Fan RPM; no OA damper; unit type pre-set `EF`).
Outlets +29 … +44 (16 rows), Total +45, Remarks +47 … +50 (4 lines). Continuation Q+4 … Q+43 (40 rows),
Subtotal Q+44, Remarks Q+46 … Q+49 (4 lines). Capacity: **56 outlets**.

### 4.5 Small Fans (P = 4 + 24(n−1))

| Row | Input cells | Formula cells |
|---|---|---|
| +0 | — | D System (EDE:B), I Service (EDE:C) |
| +3 | — | D Manufacturer (EDE:E) |
| +4 | — | D Model (EDE:F); K Total design = outlet design total, L actual, M % |
| +5 | D:G Serial No.; K Unit ESP design, L Unit ESP actual | — |
| +6 | K / L Fan RPM design / actual | D Area (EDE:C) |
| +7 | K / L Speed setting design / actual | D Location (EDE:D) |
| +8 | K:M Measured amps | D HP (EDE:G), E Voltage (EDE:H), F Phase (EDE:I) ⁴ |
| +9 | D:G Instrument `[Airflow.Instrument]`, K:M Final settings | — |
| +12 … +17 | Outlets, 6 rows | +18 Total |
| +19 … +20 | Remarks, 2 lines | — |

⁴ G at +8 is an empty bordered cell with no label and nothing reads it. Leave it alone.

### 4.6 VAVs (P = 4 + 26(n−1))

| Row | Input cells | Formula cells |
|---|---|---|
| +0 | — | D System (EDE:B), I Service (EDE:C) |
| +2 | L:M Instrument `[Airflow.Instrument]` | D:G Terminal type (EDE:H) |
| +4 | — | D Manufacturer (EDE:E) |
| +5 | — | D Model (EDE:F); L Max CFM design (EDE:I), **M Max actual = outlet final total** |
| +6 | D:G Serial No.; M Min CFM actual | L Min design (EDE:J) |
| +7 | M Fan CFM actual | D Area (EDE:C); L Fan CFM design (EDE:L) |
| +8 | — | D Location (EDE:D); L:M DDC address (EDE:M) |
| +9 | L:M Calibration factor | D Inlet size (EDE:G) |
| +10 | D:G DDC Max / Min (one text cell); M Heating CFM actual | L Heating design (EDE:K) |
| +13 … +18 | Outlets, 6 rows | +19 Total |
| +20 … +21 | Remarks, 2 lines | — |

Rows +22 … +25 are spacers.

### 4.7 Hoods (anchor H; two hoods per 49-row page)

| Row | Input cells | Formula cells |
|---|---|---|
| +0 | — | D System (EDE:B), I Service (EDE:C) |
| +1 … +3 | P Technician notes (off-print, 3 cells) | — |
| +4 | — | E Hood manufacturer (EDE:E) |
| +5 | — | E Design airflow (EDE:F) |
| +6 | E:G Associated exhaust fan | — |
| +7 | — | E Hood length ft (EDE:I) |
| +9 | — | E Manufacturer (= +4) |
| +10 | — | E Model (EDE:H) |
| +11 | E:G Serial No. | — |
| +12 | E:G Hood type | — |
| +13 | E:G Filter manufacturer | — |
| +14 | E:G Filter type `[Hood.FilterType]` | — |
| +15 | E:G Instrument `[Hood.Instrument]` | — |
| +18 | — | B Design, D Initial, F Final total CFM, H % |
| +19 | — | D / F CFM per ft |
| **+6 … +19** (14 filter rows) | I Filter size `[Hood.FilterSize]`; **P, Q, R Initial readings; S, T, U Final readings** (off-print) | J Initial VEL = average of P:R, K Initial CFM, L Final VEL = average of S:U, M Final CFM |

CFM per filter = average velocity × free area × K-factor, looked up by *filter type | size* on `{Dropdowns}`
H:K. **Every velocity goes into P–U**, including single VelGrid readings (type it in P / S). J and L are
averages; the sheet note suggests typing over them, but the app must not.
Remarks: one 5-line area per page, shared by both hoods: page start S = 4 + 49k, rows S+43 (D:M) and
S+44 … S+47 (B:M). The app gives the first hood on the page lines 1–3 and the second hood lines 4–5.

### 4.8 Traverses (anchor T; three per 49-row page)

| Row | Input cells | Formula cells |
|---|---|---|
| +2 | **B Point label** (typed text, pre-filled `T-1` … `T-48`; not a formula), C:E Area served, I Design CFM, **J Initial VEL** (single value) | F:G Size text, H Ak, K Initial CFM, **L Final VEL = average of the grid**, M Final CFM |
| +3 | D:G Instrument `[Traverse.Instrument]`, K Duct static pressure, M Temperature | — |
| +4 | D:E Duct shape `[Duct.Shape]`, G Width or diameter (in), I Height (in), K Liner thickness (in) | M Point layout (e.g. `4 x 3`, `8 x 2 axes`), N helper |
| +5 | — | D:M Traverse positions (in), N helper |
| +6 … +13 | — | B:C Depth / axis labels; **D:M reading grid (10 × 8), each cell linked to the quick-entry list** |
| +6 … +15 | **P:W Quick entry** (8 columns × 10 rows = 80 readings) | — |

Quick entry: reading *k* (1-based, grid order: across the first depth or axis, then the next) goes in column
P + ⌊(k−1)/10⌋, row T + 6 + ((k−1) mod 10). **The app writes readings to P:W only.** A value typed into the
grid replaces that cell's link. Points: rectangular, per axis < 12" = 2, otherwise ⌈L/6⌉ with a minimum of 3
(max 10 across × 8 down); round 6–9" = 6, 10–12" = 8, > 12" = 10 per axis, on two axes.
Remarks: one 3-line area per page, page start S = 5 + 49k: rows S+45 (D:M), S+46, S+47 (B:M). The app maps one line to each traverse on the page (1st: S+45, 2nd: S+46, 3rd: S+47).

## 5. Other input areas

| Sheet | Input cells | Notes |
|---|---|---|
| Cover Page | Project photo (drawing, §7) | All text is formulas or fixed firm text |
| Narrative | C12:L40 (one merged box) | Free text |
| Summary - New / Summary - (E) | Rows 13–62 (50 rows): B #, C:I Remark, J Status `["Open,Closed"]`, K:L Comments | The # is typed (not automatic). Closed rows are restyled by conditional format. The dropdown and format continue to row 100, but the print area stops at row 62. |
| Equipment Summary | E5 tolerance (0.1 = ±10%) | Status = `Check` when \|Actual ÷ Design − 1\| > E5. Sections: RTUs rows 9–48, MAUs 50–59, ERVs 61–70, Fans 72–111, Small Fans 113–152, Hoods 154–173. |
| Building Balance | Pressure table rows 97–99: B:D Test space, E:G Reference space, H:J ΔP (in. w.g.), K:M Remarks. Rows 97 and 98 are pre-labelled Building / Outdoors and Kitchen / Dining. Notes B102–B104. | OA side: RTUs rows 7–46, MAUs 47–56, ERVs 57–66, then rows 67–86 are **20 spare manual OA rows** (B, C:D, E:F; included in the total; G has no formula on these rows; mapped as table `spareOa`). Exhaust side: fans 7–46, ERV exhaust 57–66, small fans 67–86 (first 20 only). Totals row 87, balance rows 89 / 91. |
| Calibration | 8 instrument slots, rows 13, 16, 19 … 34 (3-row merges): B:D Type, E:F Manufacturer, G:I Model, J:K Serial, L:M Calibration date | 7 slots are pre-filled with a2b's instruments. The balometer is dated 2024-03-14 (more than 12 months old). |
| Certification | C30 / C32 / C34 (merged C:L): label + value texts `NEBB Certified Professional:  Isaac Rochester`, `Certification Number:  24053`, `Expiration Date: December 31, 2026` (the app writes label + its value); I53:L53 Signature, I56:L56 Date (General format: text). C51:G56 stamp box: an empty merged cell, **no picture** in the template (sheet20 has no drawing) | Firm lines C36 / C37 are fixed text (not mapped) |

## 6. Dropdown lists (`{Dropdowns}`)

| Name | Range | Values |
|---|---|---|
| Drive.Type | Q2:Q4 | Belt, Direct, ECM |
| Unit.Type | AH2:AH6 (rev 05; X2:X6 in rev 04) | RTU, DOAS, MAU, ERV, EF |
| Airflow.Instrument | P2:P8 | Flow Hood, Velocity Grid, Pitot Traverse, Hot Wire Anemometer, Rotating Vane Anemometer, DDC / Controller Reading, Other (see remarks) |
| Airflow.Method | T2:T5 (rev 05) | Outlets, PSP, Filter Grid, Profile Pressure ("Traverse" was T6 in rev 04; removed in rev 05) |
| PSP.Width | R2:R10 | 6, 9, 10, 12, 14, 16, 18, 20, 24 (in) |
| Hood.FilterType | M2:M6 | Baffle (VelGrid), Captrate (VelGrid), Condensate Baffle (Airfoil), HVC / Slot (Airfoil), Supply Filter (VelGrid) |
| Hood.FilterSize | N2:N17 | No Filter, 10" x 16", 10" x 20", 12" x 12", 12" x 16", 12" x 20", 12" x 24", 16" x 16", 16" x 20", 16" x 25", 20" x 20", 20" x 25", 24" x 24", 20" x 16", 16" Wide, 20" Wide. **Stored exactly as `16" x 20"`**, so the app must use these strings. |
| Hood.Instrument | O2:O4 | Evergreen VelGrid, Evergreen Airfoil, Other (see remarks) |
| Traverse.Instrument | F2:F9 | (blank), Manometer/Velocity Matrix, Manometer/Pitot Tube, Manometer/Airfoil, Rotating Vane Anemometer, Hot Wire Anemometer, Other Velocity Meter, Other Instrument |
| Duct.Shape | AF2:AF3 (rev 05; W2:W3 in rev 04) | Rectangular, Round |
| Service.Factors2 | A1:A6 | SF (header), SF 1.0, SF 1.15, SF 1.25, SF 1.35, SF 1.5 |
| Voltage.Options | B1:B7 | Voltage (header), 115, 120, 208, 230, 460, 480 |
| Phase | C1:C3 | Phase (header), 1-phase, 3-phase |

**Constants table quirk (found and fixed 2026-09-24):** row 45's key cell H45 held the long source note ("Source:
CaptiveAire / Evergreen …") instead of `Supply Filter (VelGrid)|24" x 24"`, so a 24" x 24" filter on the MAU filter
grid gave 0 CFM. ✅ The rebuilt revision 05 restores the key in H45 and moves the source note to `{Dropdowns}!AP1`
(build step 2d); the app offers that size.

Only a filter type/size pair that exists in the constants table (H2:K50) gives a CFM. Any other pair gives 0 with
no warning. For example, the MAU filter grid always uses Supply Filter (VelGrid), which has no 10×16, 10×20, 20×16
or slot sizes. The app should offer only valid pairs.

## 7. Package parts relevant to export

| Item | Revision 04 |
|---|---|
| Strings | **No `sharedStrings.xml`.** Every text cell is an inline string (`t="inlineStr"`). The app can write inline strings and never needs to touch a shared-string table. |
| Blank input cells | Already present as `<c r="…" s="…" t="n"></c>`. Replace the element in place and keep `s`, the style. |
| Formula cells | `<f>` with an empty `<v></v>`. **The template has no cached values.** A workbook read back after an app export shows no results until Excel has recalculated and saved it. |
| calcPr | `calcId="191029" fullCalcOnLoad="1"`, already set. No `calcChain.xml`. |
| Defined names | 21 workbook-level names (13 used by dropdowns; 8 unused leftovers: Filter_Size, Motor.Voltage, Service.Factors, Service.Factors1, Service_Factors, ServiceFactor, SF, Voltage1) + 21 print areas + 10 print-title ranges |
| Data validations | 37 dropdown/whole-number rules (RTUs 6, MAUs 10, ERVs 6, Fans 6, Small Fans 1, VAVs 1, Hoods 3, Traverses 2, Summaries 1 each). All but the two Summary lists apply to every block through a multi-area `sqref`. |
| Conditional formats | RTUs 400, Fans 400, MAUs 100, ERVs 100 (component grey-out), Hoods 39, Summaries 1 each |
| Print areas | Cover A1:M60, ToC A1:M50, Narrative A1:M41, Summaries A1:M62, EDE A1:S273, Equipment Summary A1:N173, Building Balance A1:M104, RTUs/Fans A1:N419 (first 4 units), MAUs/ERVs A1:N211 (first 2), Small Fans A1:N99, VAVs A1:N107, Hoods A1:N52 (first 2), Traverses A1:M101, Certification A1:M58, NEBB Cert A1:N162, NEBB Frm Cert A1:M51, Calibration A1:N40. `PrintReport` resets them to the used units. |
| VBA | `xl/vbaProject.bin` still holds only the old **`SyncToCPageCounts`** module. `tools/vba/TABReport.bas` (module `TABReport`: `PrintReport`, `HideUnusedBlocks`, `ShowAllBlocks`, `SyncToCPageCounts`) must be imported by hand once (README). The ToC button's macro is `[0]!SyncToCPageCounts.SyncToCPageCounts`, a reference that names the module. **After the old module is deleted, the button may need to be re-assigned** to `TABReport.SyncToCPageCounts`. This needs checking in Excel. |
| Header logo | `vmlDrawing*.vml` → `media/image3.png` on every report sheet (`legacyDrawingHF`) |
| Certificates | `drawing3.xml` (NEBB Cert: image4–6.jpeg), `drawing4.xml` (NEBB Frm Cert: image7.jpg) |
| Web extension, external links | None (removed in revision 01) |

**Cover photo.** `xl/worksheets/sheet1.xml` → `<drawing r:id="rId1000">` → `xl/drawings/drawing1.xml`, which has
three pictures: a2b logo (`rId1` → `image1.png`), family logo (`rId2` → `image2.jpeg`) and **"Project Photo"**
(`cNvPr id="4"`), a `twoCellAnchor editAs="oneCell"` from col 2/row 14 to col 12/row 30 (cells **C15:L30**),
`<a:stretch><a:fillRect/>` with `noChangeAspect="0"`, blip `r:embed="rId1008"` → `xl/media/image8.png` (a
1500 × 900 placeholder). To swap it, replace `image8.png`, or add a new media file and re-point `rId1008`
in `xl/drawings/_rels/drawing1.xml.rels` (the png, jpeg and jpg types are already in `[Content_Types].xml`).
The box is 480 × 285 px, about 5.0 × 2.97 in (10 columns of 48 px × 16 rows of 13.35 pt), so **≈ 1.685 : 1**.
The template's 1500 × 900 placeholder (1.67) agrees. An earlier figure of 1.85 double-counted column padding.
The picture is stretched to fill the box, so **crop the photo to about 1.685 : 1 first** or it will be distorted.
Verified by the export spike (`spike/export`). LibreOffice draws the box at about 1.83 : 1 because of how it sizes
columns, so the final check is in desktop Excel.

## 8. Issues found in revision 04 (for revision 05)

1. **Cover Page project lines point at the wrong cells.** When the block was moved down 10 rows, its references
   moved too: G32 PROJECT NAME = `'{Project Information}'!E12` (Technician), G34 PROJECT ADDRESS = `E13`
   (Project Manager), G36 REPORT DATE = `E24` (a blueprint row). They should be `E2`, `E3`, `E14`. The
   absolute `$E$8/$E$5/$E$4` lines are fine. The functional test does not catch this: it checks G35, which is
   blank.
2. **MAU burner profile-pressure table partly overwritten.** The curve lives in `{Dropdowns}` U1:Z12 (housing
   sizes 1–5 in V–Z). Revision 03 wrote the Duct.Shape list into W1:W3 and revision 04 wrote the unit-type table
   into X1:AD6, over housing sizes 2–5. As a result, housing size 2 is wrong below 0.25 in. w.g. and sizes 3–5
   are wrong below 0.40 in. w.g., giving `#VALUE!` or a text result. Size 1 and higher pressures are fine. The
   revision 01 file has the original values. Fix: move the lists (or the curve) to free columns.
3. ✅ *Resolved in revision 05: option removed.* **MAU "Method used = Traverse"** was in the list, but the method-total formula has no Traverse branch. Actual
   airflow then shows blank.
4. EDE P/Q (design total / OA CFM) for RTUs, MAUs and fans, ERV P/Q/H, small-fan J and hood D/G are **not
   linked**. Design CFM on the pages comes from the outlet tables. The app must still write the outlet design
   CFMs, and ideally warn when the schedule value and the outlet sum differ.
5. Ambiguous input cells: SF placeholder text; voltage and phase cells that are formulas with dropdowns;
   the first return row's formula CFMs; the unlabelled bordered cell on Small Fans (+8 G); the hood note
   that invites typing over the J/L averages. See the footnotes in §4.
6. ✅ *Revision 05: small fans 21–30 added in rows 47–56 (H/I/K/M); 31–40 stay off by decision, and the app warns.* **Building Balance lists only small fans 1–20** (rows 67–86). Small fans 21–40 are missing from the
   exhaust total. Fans, RTUs, MAUs and ERVs are complete.
7. ToC lists "Mechanical Floorplan(s)" and "Site Photos" on page 24, but there are no such sheets (Photos is
   hidden). Hoods and Photos have `$A:$N` print-title columns (harmless). Hoods have no manual page breaks.

## 8b. Findings from the export spike (2026-09-24)

1. **Outlet Type column has no cells.** Outlet rows on every unit sheet have no `<c>` in column D (Type), for
   example 2,200 rows on RTUs and 2,240 on Fans. The export creates the cell and copies the style of the Size
   cell next to it. Revision 06 could add these cells.
2. **Blueprint revision dates** (`{Project Information}` E17:E25) are text-formatted, so dates are written as
   text (M/D/YYYY). Revision 06 could give these cells a date format.
3. **Traverse quick entry** (P:W) overlaps the next traverse's first row by one row. It's harmless because only
   P:W is written there.
4. **Calibration** model and serial are stored as numbers in some template rows, and are imported as strings.
   Export replaces the whole calibration list, so the app pre-loads the 7 a2b instruments into new projects
   instead of relying on the template rows.
5. **LibreOffice re-save is not safe to ship.** It shrinks `vbaProject.bin` from 93,696 to 17,920 bytes and the
   package from 83 to 55 parts. Only the app's direct-XML export is used for deliverables.

6. **Traverse point labels are inputs.** Traverses B+2 (`T-1` … `T-48`) is typed text in every block, not a formula
   (§4.8 listed it with the formula cells). The app writes the traverse designation there; on import a label equal
   to its block's pre-fill does not make the slot "used".

## 9. History

The earlier version of this file analysed the **4-16-26 original** (`00 - …`). Those findings are superseded:
the two link bugs it listed (`RTU Data!C40` phase, EDE `P2/P3` header) and about 1,000 other link and blank-cell
defects were fixed in revision 01. The Hoods page was rebuilt to the CaptiveAire/Evergreen method, with MAU
supply methods and building pressures added, in revision 01. Revision 02 merged the Data/Airflow sheets into one
two-page layout per unit. Revision 03 added Equipment Summary, Small Fans and traverse point grids. Revision 04
added the cover photo box, the static-pressure profile strip and traverse quick entry. Details are in
`docs/TAB-Report-Review.md`. Equipment and deficiency photos stay out of the workbook (separate Photo Report).
Only the cover photo goes in.
