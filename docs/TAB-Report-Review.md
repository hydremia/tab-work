# TAB Report Review – Findings and Recommendations

Reviewed files (as committed in this repo):

| File | Role |
|---|---|
| `00 - a2b_Blank_TAB_Workbook 4-16-26.xlsm` | Blank a2b TAB Report workbook (24 sheets, 1 VBA module `SyncToCPageCounts`) |
| `tb-worksheet-evergreen 2.xlsx` | Evergreen Telemetry field worksheets (hood filters, PSP, supply-fan filters, direct-fired profile pressure, building pressures) |

Method: every cell, formula, merged range, validation, conditional format, page setup and defined name was extracted programmatically and the repeating unit blocks were compared against each other and against the sheets they link to. LibreOffice cannot load files in this cloud sandbox, so no PDF/page render was produced; page-fill figures come from row heights, page breaks and print scale. The NEBB gap analysis in Section 3 was verified against the 9th Edition PDF in this repo (Section 5, Standards for Reports and Forms).

---

## 1. Workbook structure (as found)

Flow of data:

```
{Project Information}  ──►  every page header (Project / Address / Technician / Date)
{Equipment Data Entry} ──►  RTU Data / MAU Data / Fan Data / Hoods  (designation, area, mfr, model, HP, ESP, RPM, sheaves, belts, V/Ph)
RTU/MAU/Fan Airflow    ──►  RTU/MAU/Fan Data "Total Airflow" and "Outside Airflow" design/actual
RTU/MAU/Fan Data       ──►  Building Balance (OA design/actual per RTU & MAU, exhaust per fan)
```

Capacity built into the template:

| Sheet | Unit blocks | Linked to Equipment Data Entry rows | Print area covers |
|---|---|---|---|
| RTU Data / RTU Airflow | 40 / 40 | B7–B46 (43 rows available) | 15 units / 13 units |
| MAU Data / MAU Airflow | 10 / 20 | B52–B61 / B52–B71 | 2 units / 2 units |
| Fan Data / Fan Airflow | 40 / 40 | B81–B120 | 8 fans / 8 fans |
| VAV Data / VAV 1-20 Airflow | 80 / 20 | none (fully manual) | 2 / 2 |
| Hoods | 20 | B126–B145 (only 126–136 have a header block) | 2 |
| Traverses | 49 single-point blocks | none | 7 |
| ERV / HRV | none | B65–B78 section exists in Data Entry but has **no report sheet** | – |

The hidden `{Dropdowns}` sheet feeds validations for Voltage, Phase, Service Factor, Filter Size (Hoods) and Traverse Instrument.

---

## 2. Internal consistency – defects found

Ordered by impact on a delivered report. Cell references are exact.

### 2.1 Wrong links (would print wrong numbers)

| # | Sheet / cells | Problem | Fix |
|---|---|---|---|
| 1 | **Fan Data**, blocks 21–40 (rows 494–963): K499/L499, K522/L522 … K963/L963 | "Total Airflow" design/actual link to `'Fan Airflow'!H443, H464, H485…` (constant 21-row step). Fan Airflow blocks alternate 21/28 rows, so from fan 21 on every Data page points at the wrong fan's total, or at a non-total row (blank). Fan 21 should link to H513/L513, fan 22 to H534, fan 23 to H562 … fan 40 to H975. | Re-point 40 cells to the correct Fan Airflow total rows. |
| 2 | **MAU Airflow**, blocks 11–20 (rows 249–492): all J and L CFM cells, 280 cells | `=IF(I254="","",I254*$F$9)` – CFM uses the **first unit's first outlet Ak** (`$F$9`) instead of the row's own Ak (`$F254`). Every CFM for MUA-11…MUA-20 is wrong. | Replace `$F$9` with `$F<row>` in 280 cells. |
| 3 | **RTU Data** block 15 (row 347) K354/L354 and block 16 (row 370) K377/L377 | "Return Airflow" design/actual are `='RTU Airflow'!H772` / `H821` (the *next* unit's Total Airflow) instead of `=IF(K352="","",K352-K353)`. | Restore the subtraction formulas. |
| 4 | **RTU Data** L355 and L378 | "Unit ESP – Actual" is `='RTU Airflow'!L783` / `L832` (the next unit's OA final CFM) instead of `=F368` / `=F391` (fan ESP from the static profile). | Restore `=F<anchor+21>`. |
| 5 | **RTU Data** C40 | Phase for RTU-2 links to `'{Equipment Data Entry}'!O7` (RTU-1's phase) instead of `O8`. | Change to O8. |
| 6 | **RTU Data** K403 and K426 | "Return Airflow – Design" formula is missing (blank) in blocks 17 and 18. | Add `=IF(K401="","",K401-K402)` / `=IF(K424="","",K424-K425)`. |
| 7 | **RTU Data** K400/L400, K423/L423, K308/L308 | Stray links (`='RTU Airflow'!H870`, `H919`, `H674`) sitting in the "Design Criteria" header row and the "Motor Data" row. They print numbers in rows that should be blank. | Clear. |
| 8 | **RTU Data** K109, K132 | Return-air guard tests the wrong cell: `=IF(K81="","",K107-K108)` should test K107 (and K130). Harmless while K81 is populated, wrong when it is not. | Fix guard reference. |

### 2.2 Layout drift between identical blocks (cosmetic but visible)

* **Fan Data**: labels dropped in 19 of 40 blocks – "Flt/Coil" missing in blocks 7, 8, 9, 10, 19, 20, 27, 28, 37; "Drive Data" missing in 9, 10; "RPM Data" missing in 21, 22; one of the "Initial"/"Final"/"C to C" labels missing in 9, 10, 11, 12, 15, 16, 25, 26, 29, 30.
* **RTU Data / MAU Data**: block 1 shows a blank designation as blank (`='{Equipment Data Entry}'!B7`) but blocks 2+ wrap in `IF(x=0,0,x)` and print **0** for unused units. Same on RTU/MAU/Fan Airflow (`D53 ='{Equipment Data Entry}'!B8` prints 0). MAU Airflow I25+ (`Service`) also prints 0.
* **Hoods**: block 1 CFM formulas use `I10` while blocks 2+ use `$I31` – equivalent, just inconsistent.
* **RTU Airflow** return-air row: blocks 1–20 use `=IF(L48="","", L37-L48)`, blocks 21–40 use `=IF(L1028="", "", L1017-L1028)` – equivalent.
* **{Equipment Data Entry}** header P2/P3 read `'{Project Information}'!I12` / `I11` (empty cells); every other sheet reads E12/E11. Technician and Date never show on that sheet.

### 2.3 Formula hygiene

* **% columns** (`M9 =IF(K9="", J9/H9, L9/H9)` on every airflow sheet, `H22` on Hoods, `M37` totals) evaluate to `#VALUE!` / `#DIV/0!` on blank rows. Conditional formatting turns the font white when the Initial column is blank, so the error is *hidden*, not prevented. Any row where a tech types a final velocity but no initial, or a design CFM of 0, prints an error. Recommend `=IF(H9=0,"",IF(L9="",IF(J9="","",J9/H9),L9/H9))` or `IFERROR`.
* **Estimated BHP** (`G18`) shows `#DIV/0!` until amps are entered (visible in the blank). Hard-codes PF 0.8 and efficiency 0.9; the report should say so (footnote or label "est. @ PF 0.8, eff 0.9") since NEBB asks that calculated values be identifiable **(confirm)**.
* **Corrected FLA** `=B17/AVERAGE(E19:G19)*E17` is the standard nameplate-volts/measured-volts correction – OK. It references `E17` (FLA) which is an unlabeled input cell next to the "FLA" label in D17; fine, but the SF-adjusted amps (FLA × SF) is not computed anywhere although SF is collected.
* **Building Balance** `G7 =IF(E7="","",E7/C7)` errors if design (C7) is blank/0. Totals row guards it; unit rows do not.
* **Summary sheets**: remark table and validation run to row 100, print area stops at row 41 (68% scale). Remarks beyond row 41 silently drop off the printed report.
* **ToC** page numbers are typed constants. The `SyncToCPageCounts` macro recomputes them but has no button and is not documented on the sheet. Typo: "Appedindix B". "Mechanical Floorplan(s)" and "Site Photos" both say page 24; Photos sheet is hidden.
* **NEBB Cert / NEBB Frm Cert** sheets contain leftover text cells (E13 "Evergreen Telemetry", G13 "model", J13 "serial", G16, L25 = 2024-08-19, E31, G31) copied from the Calibration sheet, sitting under/over the certificate images. They print if any part is not covered by the image.
* **Calibration** sheet is hard-coded to specific instruments and calibration dates (Balometer 2024-03-14, Humidity 2025-01-31). Against the template's 2026-04-20 project date these are beyond 12 months. Treat as per-project inputs, not template constants.
* **Defined names / external links**: 12 external references to SharePoint/Dropbox/Downloads paths (Melink, Aztec, Target ERV, Hiti, "a2b_Remarks_Template.xlsx" …) and ~40 names that resolve to `#REF!`. Only six names are actually used (`Voltage.Options`, `Phase`, `Service.Factors2`, `Filter_Size`, `Traverse.Instrument`, `Motor.Voltage` on RTU Data B17 only). The rest cause the "update links" prompt, slow opening, and are a trust risk when the file is emailed. `Filter_Size`, `Phase`, `Motor.Voltage`, `Traverse.Instrument` also have sheet-scoped duplicates pointing at external file `[9]`.
* **Workbook size** is 3.2 MB for a blank; ~55% is four scanned certificate images (0.5–0.6 MB each) and the rest is 1.3 MB of formatted-but-unused rows on RTU Airflow (1961 rows) and the other unit sheets.

---

## 3. NEBB reporting requirements – gap analysis (verified against the 9th Edition, Section 5)

Source: *NEBB Procedural Standard for TAB of Environmental Systems*, 9th Ed. (2019), Section 5 "Standards for Reports and Forms" (5.2 Report Content, 5.3 Equipment Report Forms), read from the licensed copy in this repo. NEBB accepts customised forms as long as every listed item is reported (5.1).

| NEBB clause | Requirement | Original template | Status in revision 01 |
|---|---|---|---|
| 5.2.1 Title | "Certified Test, Adjust and Balance Report"; project name/address; engineer; HVAC contractor; firm name/address/cert. no. | All present | Report Date added (Project Information → Cover) |
| 5.2.2 Certification | Project; CP name; firm name; cert. number; expiration; **signed and dated NEBB stamp**; the exact verbiage | Verbiage said "is a *representation* of" (NEBB: "is a *record* of"); no firm line; no signature/date | Wording corrected verbatim; firm name and certification number line; stamp box, signature and date lines |
| 5.2.3 ToC | Page numbers or links; every data page uniquely numbered | Static page numbers, no page numbers printed on pages | "Page &P" footer on every sheet except the cover; ToC re-synced by the macro |
| 5.2.4 Summary / Remarks | **Narrative of system set-up conditions and rationale**; deficiencies with page references; items not obtainable | Remarks table only | New "Narrative" sheet; remarks pages unchanged (note the page in Comments) |
| 5.2.5 All pages | Unique designation; reporter's name and date on each form; sequential page numbers; remarks section | Name/date in every header; remarks on airflow pages only | Page numbers added; Data pages gained "Final Settings" line and printed filter data (see 5.3.3) |
| 5.2.6 Instruments | Type, manufacturer, model, serial, calibration date | Present, but hard-coded | Unchanged – treat as per-project input and check dates (Balometer 2024-03-14 and Humidity 2025-01-31 are stale) |
| 5.2.7 Abbreviations | Every abbreviation defined | Present (typos) | Fixed; Not Available / Not Accessible notations and outlet type codes added |
| 5.2.8 Drawings | Drawings/schematics identifying tested equipment | External attachment | Unchanged |
| 5.3.1 / 5.3.2 AHU & RTU | Design: airflows, TSP/ESP, fan rpm, motor HP/rpm/V/phase. Actual: serial; SA/RA/OA; motor mfr, HP, rpm, frame, phase, rated V/A, SF, operating V/A; corrected nameplate amps; BHP; **motor sheave OD/bore/PD, fan sheave OD/bore**, C-C, belts; fan rpm; TSP/ESP; SP profile; **final setpoints/settings**; operating Hz | Everything except sheave bore, final settings, drive type | Drive type, rotation, sheave bore, filters and final-settings cells added inside the printed block; sheave labels renamed |
| 5.3.3 Filter data | Location/service, MERV, quantity, size | Filter cells existed in columns R–X, **outside the print area** | "Filters: Type / Size / Qty" line now prints (row 14 of each block) |
| 5.3.4–5.3.6 Fans | As AHU plus suction/discharge SP; type of service | Present (Entering/Exiting profile = suction/discharge) | Same additions as RTU; ERV clone uses the same block |
| 5.3.7 Air devices | Outlet no., area, neck/overall size, design CFM, system total, **device type**; final velocity & Ak (when Ak≠1), final CFM, **instrument used** | No type column, no instrument | "Type" column (codes in Abbreviations) and per-system "Instrument / Ak basis" line on every airflow table |
| 5.3.8–5.3.11 VAV / FPB | Designation, **terminal type, inlet size**, design max/min, **heating CFM**; final max/min, DDC calibration factor, **DDC max/min**, instrument; fan CFM/speed for FPB | Max/min/fan CFM, address, cal factor only; no Data Entry link | Terminal type, inlet size, heating CFM, DDC max/min, instrument added; VAV Data Entry section (80 rows) drives VAV Data and VAV Airflow |
| 5.3.12 Duct traverse | System, traverse ID, location, design CFM, duct size, area; average velocity, CFM, temperature, SP, instrument, **velocity profile** | Average only | 22-point profile grid per traverse with reading count; Final VEL = profile average |
| 5.3.25 ERV (air to air) | Unit, location, service, mfr, model, serial; primary & secondary airflow and ΔP, design and actual | **No sheet** (Data Entry section existed) | ERV Data + ERV Airflow sheets (supply outlets and exhaust inlets per unit), Data Entry ΔP columns, Building Balance rows |
| 8.14.2 Kitchen hoods | Velocity readings at grease filters per the hood manufacturer's method are the accepted TAB method | Gross-area formula | Rebuilt on the CaptiveAire/Evergreen method (Section 4) |
| 8.19 Building pressure | Document building static where controlled/specified | Single "Measured Building Pressure" cell | Test-space / reference-space ΔP table (Building–Outdoors, Kitchen–Dining) |

Items I had listed as gaps before reading the standard and that are **not** NEBB "shall" items (left as optional): unit air temperatures, nameplate Hz, fan class/arrangement, instrument range/accuracy. The earlier statement that a bare "N/A" is disallowed does not appear in the 9th Edition text; the legend now simply adds the Not Available / Not Accessible notations.

## 4. Evergreen worksheet vs. Hood and Fan pages

### What the Evergreen file does

| Sheet | Method | Constants |
|---|---|---|
| Exhaust with Baffle Filters (VelGrid, rev 2.1) | CFM per filter = **free area × velocity × K**; K = 1.34 Captrate / 1.28 baffle; sums 11 filters, gives CFM/ft of hood | Free area ft²: 10×16 0.78, 10×20 0.99, 12×12 0.69, 12×16 0.97, 12×20 1.25, 12×24 1.52, 16×16 1.35, 16×20 1.73, 16×25 2.22, 20×20 2.23, 20×25 2.85, 24×24 3.36 |
| Supply Fan Filters (VelGrid, rev 1) | Same, K = 1.35, 12 filters | Free areas differ slightly from the exhaust table (16×16 1.36, 16×20 1.75, 16×25 2.24, 20×20 2.25, 20×25 2.88) |
| Condensate Baffle Filters (Airfoil, rev 0) | Average of **3 readings per filter** × constant | "Free area" 0.131 / 0.196 / 0.262 / 0.349 by size – these are Airfoil probe constants, not filter areas |
| HVC or Slot Filters (Airfoil, rev 0) | Same | 16" wide 0.2402, 20" wide 0.3027 |
| PSP Supply (VelGrid, rev 2) | CFM = avg of 16 readings × (length − 2 − 2·blanks) × width × K / 144; K = 0.88 (≤12" wide) or 0.95 (≥14") | |
| Direct Fired Profile Pres. CFM (rev 1) | Supply CFM from burner profile pressure, piecewise-linear per housing size 1–5 | |
| Building Pressures | Kitchen vs dining differential | |

### How the TAB Report Hoods page differed

`Hoods!K10 = J10 × (I10 × $E$18 / 144)` – velocity × **gross** filter face area (width × height); no free-area factor, no instrument K-factor, one reading per filter, no filter-type selection, no hood length / CFM-per-foot.

### Quantified alignment (same velocity readings, CaptiveAire worksheet vs. original TAB Hoods page)

The CaptiveAire file still contains a real job (job 4910813, four hoods, 16×20 filters, Captrate K). Feeding the same readings through both formulas:

| Hood | Filters | Σ velocity (fpm) | CaptiveAire worksheet CFM | Original TAB page CFM | Difference |
|---|---|---|---|---|---|
| Hood 1 | 5 | 884 | 2,049 | 1,964 | −4.1 % |
| Hood 2 | 6 | 760 | 1,762 | 1,689 | −4.1 % |
| Hood 3 | 5 | 731 | 1,695 | 1,624 | −4.1 % |
| Hood 4 | 10 | 1,078 | 2,499 | 2,396 | −4.1 % |
| **Total** | | | **8,005** | **7,673** | **−4.1 %** |

The ratio is constant for one filter size because both methods are linear in velocity; it changes with filter size and type (original TAB CFM ÷ CaptiveAire CFM):

| Filter | Captrate (K 1.34) | Baffle (K 1.28) |
|---|---|---|
| 12×12 | 1.08 | 1.13 |
| 16×16 | 0.98 | 1.03 |
| 16×20 | 0.96 | 1.00 |
| 20×20 | 0.93 | 0.97 |
| 24×24 | 0.89 | 0.93 |

So the original page under-reported Captrate hoods by 4 % at 16×20 and up to 11 % at 24×24, and over-reported small baffle filters by up to 13 %. A 4 % bias is inside the ±10 % NEBB tolerance on its own, but it consumes almost half of it before any measurement error, and it flips sign across sizes, so a hood mixing filter sizes could show a pass on the TAB page and a fail on the manufacturer's sheet. The CaptiveAire worksheet is the manufacturer's stated test method (NEBB 8.14.2 makes the manufacturer's method the accepted one), so revision 01 adopts it.

**Corrections applied to the TAB template (revision 01):**

* `CFM = velocity × free area × K-factor`, with free area and K looked up from the CaptiveAire tables by filter type and size (hidden `{Dropdowns}` sheet, columns H–L, source cited in H45).
* Filter Type dropdown: Baffle (VelGrid) K 1.28, Captrate (VelGrid) K 1.34, Condensate Baffle (Airfoil) probe constants, HVC/Slot (Airfoil) 16"/20" constants, Supply Filter (VelGrid) K 1.35.
* Instrument dropdown (VelGrid / Airfoil / Other), hood length from Data Entry, CFM per foot of hood, and three velocity readings per filter (off-print columns P–U; the printed velocity averages them, or a single value can be typed over it).
* Make-up air: new "MAU Supply Methods" sheet with the PSP formula (length − 2 − 2×blanks, width, K 0.88/0.95), the supply filter grid (K 1.35) and the direct-fired burner profile pressure table with linear interpolation; MAU Data "Total Airflow" follows whichever method is selected.
* Building pressure table (Kitchen–Dining etc.) on Building Balance.

### Remaining recommendations for the Evergreen file

1. **Hoods page**: add "Filter Type" (Baffle / Captrate / Condensate-Airfoil / HVC-Airfoil) and "Instrument" dropdowns; add a hidden reference table with the Evergreen free areas and K-factors; compute CFM per filter = velocity × free area × K via `INDEX/MATCH`; keep width/height only for display. Add hood length and "CFM/ft" (NEBB should-item, useful for hood listing checks). Allow 3 readings per filter for the Airfoil methods (average). Keep initial/final columns.
2. **Fan / MAU pages**: add an optional "Supply-side filter grid" block (Supply Fan Filters method) and a "PSP supply" block (16 readings, length, width, blanks) on MAU Airflow so make-up-air can be reported by the method actually used, not forced into the outlet table. Add a "Direct-fired burner profile pressure" line (housing size, profile pressure, derived CFM) to MAU Data as a secondary check.
3. **Building Balance**: replace the single "Measured Building Pressure" cell with a small table (Reference space / Test space / ΔP in. w.c.), pre-filled with Kitchen–Dining.
4. **Fix the Evergreen file too** (if it stays a field tool): `Supply Fan Filters` VLOOKUPs omit `FALSE` (approximate match on text, a mistyped size silently matches a neighbour); `PSP Supply!S31` shows `#DIV/0!`; two different free-area tables for the same filter sizes (exhaust vs supply) – pick one and cite the Evergreen document/revision it came from.

---

## 5. Format – what can be improved

### 5.1 Unit data and airflow side by side

Three ways to get "unit page then its airflow page" for every unit:

| Option | What changes | Effort | Risk |
|---|---|---|---|
| **A. Print-order macro** | Keep the sheets as they are; a macro prints (or exports to PDF) RTU Data page n followed by RTU Airflow page n, etc., and sets the ToC | Small (VBA only) | None to formulas; only the printed/PDF order changes. Viewing in Excel is unchanged. |
| **B. Merged per-type sheet** | New "RTU" sheet whose repeating block is [data block ~22 rows] + [airflow block ~44 rows] = one 2-page spread per unit; Building Balance and Data Entry links re-pointed | Large (rebuild 3 sheet pairs, re-link ~600 cells) | Moderate – but removes an entire class of the cross-sheet errors found in §2 because Total/OA/Return become same-block references. |
| **C. One page per unit** | Compact data block (12–14 rows) on top, outlet table (≈20 rows) below on a single page; overflow outlets on a continuation page | Large + design work | Loses the 28-outlet capacity per unit unless a continuation page is used. |

Recommendation: do **A now** (it also fixes the ToC page numbers) and build **B** as the next template version; C only if most projects have ≤15 outlets per unit.

### 5.2 Other layout improvements

* **Equipment summary table** (one line per unit: ID, area, design/actual SA, OA, RPM, amps, ESP, %): a reviewer sees the whole project in one landscape page before the detail. Can be generated from existing links.
* **Consistent block geometry**: RTU/MAU/Fan Data blocks are 23/26 rows alternating, Airflow 21/28 or 49 – this alternation is what produced the Fan Data 21-row-step error. Use one fixed block height per sheet and put page breaks every N blocks.
* **Don't print unused blocks**: a `BeforePrint` routine (or the print macro from Option A) that hides rows of blocks whose System cell is blank and sets print areas. Today the print areas are fixed (e.g. 13 RTUs, 8 fans) so blank units print as pages of zeros, or the tech has to re-set print areas per project.
* **Technician notes** (columns P–X) already sit outside print areas – good; document that convention on the Data Entry sheet.
* **Certifications**: combine "Certification", "NEBB Cert" and "NEBB Frm Cert" into one appendix with the two certificate images scaled to half-page each (saves 1–2 pages and 1 MB).

### 5.3 Reducing white space on the final report

Measured on the blank (rows with no label/formula per printed page):

| Page | Blank rows / page | Notes |
|---|---|---|
| RTU Data | 8–9 of 52 | Two ~23-row blocks per page at 93 % scale; ~35 % of each block is empty label columns (H, N) and spacer rows |
| Fan Data | 10–11 of 52 | Same block as RTU (with OA rows) although fans rarely need OA/RA rows |
| Fan / MAU Airflow | 12–13 of 52 | 14 outlet rows per fan; typical EFs have 1–4 outlets |
| Hoods | 13 of 52 | 14 filter rows per hood; 5–11 is typical |
| Traverses | 21 of 52 | 7 single-line traverses per page, each with a 3-row header + spacer |
| Summary | 36 of 41 | Printed at 68 % scale with 26-pt rows – large empty table |
| Calibration | 29 of 40 | 3-row merged cells for 7 instruments |
| VAV Data / VAV Airflow | page only 50 % full | Print area stops at 2 units |

Concrete levers, in order of payoff:

1. **Variable-height outlet tables**: hide unused outlet/filter rows at print time (macro) instead of fixed 14/28-row tables. Biggest saving on Fan/MAU Airflow, Hoods, Traverses.
2. **Fan Data compact block**: drop the OA/RA rows and "Direct Drive"/"Drive change" side panel from the printed area for fans; a 16-row fan block fits three fans per page.
3. **Traverses**: one header for the page, one row per traverse (ID, area, size, Ak, design, initial, final, SP, temp, instrument) – 20+ traverses per page instead of 7.
4. **Summary**: print at 100 % with 15-pt rows and let the table grow (dynamic print area); it is currently the most empty page in the report.
5. **Calibration**: single-row instruments (14 per page) with Range/Accuracy added.
6. **Row heights**: unit sheets use 13.3-pt rows with 3-pt spacer rows; standardising on 12.75 pt and removing spacer rows inside blocks gains ~10 % per page.
7. **Margins**: 0.7"/0.75" all round; 0.5" side margins fit the 13-column layout at 100 % instead of 93–99 % scale, which also makes the fonts consistently sized across sheets.

---

## 6. Revision 01 – what was built, how it was verified, what is left

Files (originals untouched as backups):

| File | Purpose |
|---|---|
| `01 - a2b_Blank_TAB_Workbook 9-9-26.xlsm` | Revised template generated from the 4-16-26 original |
| `tb-worksheet-evergreen 3 (reference).xlsx` | Cleaned CaptiveAire worksheet (job data removed, exact-match lookups, README) |
| `tools/build_workbook.py`, `tools/build_steps2.py` | Reproducible build: every change is a named function; re-run to regenerate |
| `tools/xlsm_parts.py` | Restores the certificate images, header logos and the ToC button that openpyxl drops |
| `tools/vba/TABReport.bas` | Macro module: ToC sync, hide unused blocks, interleaved Data/Airflow printing (Option A) |
| `tools/build_evergreen.py` | Generates the cleaned Evergreen reference workbook |
| `docs/build-log.txt` | Cell-level log of the last build |

### 6.1 Change log (revision 01)

1. **Link defects fixed** – Fan Data 21–40 totals (40 cells), MAU Airflow Ak (280 cells), RTU Data return-air/ESP/phase/stray cells (blocks 2, 5, 6, 13, 15–18); Traverses CFM tolerates a blank velocity; Outside Air design shows blank instead of 0 until entered.
2. **Formula hygiene** – blank units show blank instead of 0 (≈1,000 cells); % and ratio cells guarded (≈2,700 cells); BHP and corrected-FLA guarded; missing block labels (390) and formulas (28) filled from block 1; Data Entry header; Summary print area; ToC typo; Abbreviations; certificate-sheet leftovers.
3. **Cleanup** – 12 external links and 150 broken/external defined names removed (no "update links" prompt); six working lists kept plus seven new ones.
4. **NEBB 5.2 / 5.3** – certification wording, firm line, stamp box, signature/date; report date; page-number footers; Narrative sheet; drive type, rotation, sheave bore, filters, final settings on every Data block; Type column and instrument line on every airflow table; VAV terminal fields; traverse velocity profiles; ERV sheets; building pressure table.
5. **Evergreen alignment** – Hoods page rebuilt (Section 4); MAU Supply Methods sheet; reference constants on `{Dropdowns}`.
6. **Structure** – ERV Data/Airflow, MAU Supply Methods and Narrative sheets in reading order; ToC entry for ERVs; Data Entry gains ERV ΔP, hood length and an 80-row VAV section; Building Balance gains 10 ERV rows and fits to one page.
7. **Macros** – `tools/vba/TABReport.bas` supersedes `SyncToCPageCounts`: `PrintReport` hides unused blocks/rows, syncs the ToC and prints Data page n followed by Airflow page n (Option A). The module cannot be injected from this environment; import it once (Alt+F11 → File → Import) and delete the old module.

### 6.2 Verification performed (updated 2026-09-17)

| Check | Tool | Result |
|---|---|---|
| Full recalculation of revision 01 | LibreOffice Calc (`recalc.py`) | **0 error cells** in 17,783 formulas. The 4-16-26 original recalculates to 2,674 error cells (hidden by white conditional-format text). |
| Functional test with sample data | `tools/functional_test.py` | **61 / 61** hand-worked expectations match, including the CaptiveAire hood example (2,049.29 CFM), PSP, filter grid, burner-profile interpolation, fan 21 link, MAU unit 11 Ak, ERV rows, Building Balance totals, VAV links, traverse profile |
| Cross-block consistency and link mapping | `tools/verify_blocks.py`, `tools/verify_links.py` | 0 issues on all 13 unit sheets |
| Package integrity | XML parse of every part; openpyxl reopen | certificate images, header logos, ToC button, VBA project, validations, conditional formats present; no duplicate sheet code names |
| Print rendering | LibreOffice PDF with Carlito (Calibri-metric) font | 59 pages (original 53; +6 for Narrative, MAU Supply Methods, ERV Data/Airflow, Data Entry VAV page). Certification, Building Balance, Data Entry each fit one page. Pages inspected: RTU Data, RTU Airflow, Hoods, Traverses, VAV Data, ERV Data, MAU Supply Methods, Certification, Narrative, Building Balance, ToC |

Rendering exposed and fixed four layout problems in the first build: the Certification page spilled to two pages (now fit-to-page), the Narrative box inherited a solid fill, the new sheave/filter labels were truncated (labels now span I:K with the value in L:M), and the MAU Supply Methods titles overran the page. Three inherited header errors were also corrected: the MAU Data page was titled "Fan Data Report", VAV Data had no title, and VAV Airflow was titled "Fan Airflow Measurement Report".

Not verifiable here: Excel-specific behaviour (macro import, Excel's own pagination, which can differ from LibreOffice by a row or two). Open the 01 file in Excel and print-preview once.

### 6.3 Left for the next revision (Option B)

* Merged per-type sheets (Data block + Airflow block per unit) so the printed order no longer depends on the macro and the cross-sheet link class of errors disappears.
* Compact fan block (drop OA/RA rows), one-line traverses, dynamic Summary and Calibration tables (Section 5.3).
* Instrument list as per-project inputs with range/accuracy.

## 7. Revision 02 – merged per-unit sheets (Option B)

Decisions applied (2026-09-18): single compact page per unit with a continuation page; all reports go out as PDF; both Summary sheets kept; CaptiveAire constants authoritative; CP stamp applied as an image; PR opened for the branch.

| File | Purpose |
|---|---|
| `02 - a2b_Blank_TAB_Workbook 9-18-26.xlsm` | Revision 02, generated from revision 01 by `tools/build_rev02.py` |
| `tools/build_rev02.py` | Builds the merged sheets from the revision 01 Data / Airflow / Methods sheets |
| `tools/functional_test_rev02.py` | 68 expected values on the new layout |
| `tools/vba/TABReport.bas` | Rewritten for the revision 02 layout (see 7.3) |

### 7.1 Layout

| Sheet | Replaces | Page 1 (52 rows) | Page 2 (continuation) |
|---|---|---|---|
| **RTUs** (40) | RTU Data + RTU Airflow | unit data block, 14 supply outlets, total, 2 return inlets, 1 outside-air row, remarks | 34 more supply outlets, 4 more return inlets, subtotals, remarks |
| **MAUs** (10) | MAU Data + MAU Airflow + MAU Supply Methods | unit data block, 20 outlets, total, remarks | PSP / filter grid / burner profile pressure / method selection, 22 more outlets |
| **ERVs** (10) | ERV Data + ERV Airflow | unit data block, 8 supply outlets, 8 exhaust inlets, totals, remarks | 16 + 16 more, subtotals |
| **Fans** (40) | Fan Data + Fan Airflow | fan data block, 20 outlets, total, remarks | 40 more outlets |
| **VAVs** (80) | VAV Data + VAV 1-20 Airflow | two terminals per page: data block + 6 outlets + total + remark line | – |

Page-1 totals sum both pages; the continuation page shows a "Subtotal (this page)". The unit data block's Total / Outside / Return airflow cells now reference the same page, so the cross-sheet link errors of the original cannot recur. Building Balance points at the merged sheets. Hoods, Traverses and all front and back matter are unchanged from revision 01.

### 7.2 Verification

| Check | Result |
|---|---|
| LibreOffice recalculation | 0 error cells in 31,759 formulas |
| `tools/functional_test_rev02.py` | 68 / 68 (includes a continuation-page outlet feeding the page-1 total, unit-10 profile pressure, fan 21, ERV supply/exhaust, VAV outlet total to Actual Max) |
| `tools/verify_blocks.py` | 0 issues on all six unit sheets |
| Rendered PDF (Carlito font) | 49 pages with the default print areas (first 4 RTUs, 2 MAUs, 2 ERVs, 4 fans, 4 VAVs); pages inspected: RTU 1 and 2, MAU 1 and 2, ERV 1 and 2, Fan 1 and 2, VAV |
| References to removed sheets | none |

### 7.3 Macro (`tools/vba/TABReport.bas`)

`PrintReport` hides unused units, continuation pages without typed data and empty outlet rows (first row of each table stays), sets each sheet's print area to the last used unit, refreshes the ToC page numbers, then exports every visible report sheet to one PDF. Because the sheet order is now the reading order, no page interleaving is needed. Import the module once in Excel (Alt+F11 → File → Import) and delete the old `SyncToCPageCounts` module.

### 7.4 Remaining items (phase 3)

* One-line-per-traverse layout (20+ traverses per page) and dynamic Summary / Calibration tables.
* Equipment summary page (one line per unit).
* Instrument list with range / accuracy as per-project inputs; project-copy workflow.
* Optional: two fans per page for small exhaust fans.

## 8. Revision 03 – equipment summary, small exhaust fans, duct-traverse point grids

| File | Purpose |
|---|---|
| `03 - a2b_Blank_TAB_Workbook 9-18-26.xlsm` | Revision 03, generated from revision 02 by `tools/build_rev03.py` |
| `tools/functional_test_rev03.py` | 99 expected values (revision 02 checks plus the three additions) |

### 8.1 Equipment Summary (new sheet, before Building Balance)

One line per unit for RTUs, MAUs, ERVs, fans, small exhaust fans and kitchen hoods: Unit, Area Served, Design CFM, Actual CFM, %, OA (or exhaust) design/actual, ESP design/actual, final fan RPM, average measured amps, and a Status column that reads "Check" when |Actual ÷ Design − 1| exceeds the tolerance in cell E5 (default 10 %, editable per contract). Every value is a link to the unit page; the macro hides lines for units that do not exist.

### 8.2 Small Fans (new sheet, two per page)

For direct-drive exhaust fans under 1/6 hp, where NEBB 5.3.6 requires only designation, service, manufacturer, model and design/actual airflow. The block holds unit data, HP / volts / phase from a new Data Entry section (rows 233–272), measured amps, ESP, RPM, speed setting, instrument, final settings and six outlet rows. Twenty small-fan rows were added to the exhaust side of Building Balance (hidden while blank).

### 8.3 Traverses rebuilt with duct point grids (three per page)

Each traverse now carries a duct-shape dropdown (Rectangular / Round), width or diameter, height, liner thickness and a computed point layout per NEBB 6.3.3 equal-area method:

| Duct | Points | Positions (from the duct wall, inside the liner) |
|---|---|---|
| Rectangular, axis < 12" | 2 per axis | centres of equal strips: (i − ½) × L ÷ n |
| Rectangular, axis ≥ 12" | at least 3, spacing ≤ 6" (n = ⌈L ÷ 6⌉, capped at 10 across × 8 down) | same |
| Round 6–9" / 10–12" / > 12" | 6 / 8 / 10 per axis on two axes at 90° | centres of equal-area rings: D⁄2 × (1 − √((n − 2k + 1) ⁄ n)) and mirror |

The position row and depth column are formulas, the free area (Ak) is computed from the dimensions less liner, the Size text is generated, and Final VEL is the average of the grid. The grid is 10 columns × 8 rows, so a 60" × 48" duct (10 × 8 = 80 points) fits. Round ducts ≤ 5" are noted as 90 % of the centreline reading (note in P5, off-print). Capacity is 48 traverses.

### 8.4 Verification

| Check | Result |
|---|---|
| LibreOffice recalculation | 0 error cells in 36,003 formulas |
| `tools/functional_test_rev03.py` | 99 / 99, including a 24" × 12" rectangular traverse (4 × 3 points, positions 3/9/15/21 and 2/6/10, Ak 2.0) and a 10" round traverse (8 × 2 axes, first position 0.3", free area 0.545) |
| `tools/verify_blocks.py` | 0 issues on all seven unit sheets |
| Rendered PDF | 56 pages with default print areas; Equipment Summary, Small Fans, Traverses and Building Balance pages inspected |

The macro module (`tools/vba/TABReport.bas`) now also hides blank Equipment Summary lines, unused small-fan blocks and unused traverses (no shape or size entered), and covers the extra Building Balance rows.

## 9. Revision 04 – cover photo, static-pressure profile graphic, traverse quick entry

| File | Purpose |
|---|---|
| `04 - a2b_Blank_TAB_Workbook 9-18-26.xlsm` | Revision 04, generated by `tools/build_rev04.py` (runs the 02 and 03 builders with the revision 04 options on) |
| `tools/assets/project-photo-placeholder.png` | Placeholder picture placed in the cover photo box |
| `tools/functional_test_rev04.py` | 133 expected values |

### 9.1 Cover page photo

The cover now reads: a2b logo, "CERTIFIED / TEST, ADJUST, and BALANCE REPORT", a **project photo box (rows 15–30, columns C–L, about 5 × 3 in)**, the project lines, the firm block and the family logo. The box holds a placeholder picture; in Excel right-click it → *Change Picture…* and the storefront or signage photo takes its size and position. The page is set to fit one sheet.

### 9.2 Static-pressure profile graphic (every RTU, MAU, ERV and fan page)

The old two-column "Flt/Coil | Fan" table became a five-component table (Filter, Wheel, Coil, Heat, Fan) with Entering and Leaving rows. Only the leaving statics and the first entering static are typed; each component's entering static is taken from the previous measured leaving value, so absent or unmeasured components pass the value through.

Below it, a four-row **unit schematic strip**: a Unit type dropdown (RTU, DOAS, MAU, ERV, EF), then boxes for the inlet and the five components with arrows, the boundary static under each arrow, the component ΔP under each box, and a summary line with fan TSP, ESP and unit ΔP (inlet → fan). The Unit ESP "Actual" cell on the data block now reads the strip's ESP. Components that do not exist for the selected type show "—" and are greyed by conditional formatting:

| Unit type | Inlet | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| RTU (default on RTUs) | RA / OA | Filter | — | Coil | Heat | Fan |
| DOAS (Seasons-4, Munters, Addison…) | OA | Filter | Wheel | Coil | Heat | Fan |
| MAU (default on MAUs) | OA | Filter | — | Burner | — | Fan |
| ERV (default on ERVs) | OA / EA | Filter | Core | — | — | Fan |
| EF (default on Fans) | Inlet | — | — | — | — | Fan |

The table lives on the hidden `{Dropdowns}` sheet (X1:AD6); adding a row there adds a unit type. The strip took four rows on page 1, so page-1 outlet tables lost four rows (RTU 10 supply outlets, MAU/fan 16, ERV 6 + 6) and the continuation pages gained them.

Design note: the graphic is built from cells rather than a picture with linked callouts, so it prints identically in Excel and LibreOffice, needs no drawing objects, and is covered by the functional test. A pictorial unit drawing with cell-linked callouts is possible later if the schematic is not "graphic" enough.

### 9.3 Traverse quick entry

Each traverse has an off-print quick-entry list (columns P–W, ten cells per column, up to 80 readings). Readings are typed in reading order (across the first depth or axis, then the next) and the grid cells pick them up by position; a value typed directly into a grid cell replaces the link for that cell. Helper cells in column N (off-print) hold the computed points across, points down and total.

### 9.4 Verification

| Check | Result |
|---|---|
| LibreOffice recalculation | 0 error cells |
| `tools/functional_test_rev04.py` | 133 / 133, including the RTU chain (−0.30 / −0.50 / −0.70 / +0.90 → TSP 1.60, ESP 1.20), the EF pass-through case, DOAS/MAU/ERV component labels, quick-entry fill by position and the moved cover cells |
| `tools/verify_blocks.py` | 0 issues on all seven unit sheets |
| Rendered PDF | cover, RTU (as RTU and as DOAS), MAU, ERV, fan and traverse pages inspected |

## 10. Revision 05 – notations in numeric inputs, cover links, profile-pressure curve

| File | Purpose |
|---|---|
| `05 - a2b_Blank_TAB_Workbook 9-23-26.xlsm` | Revision 05, generated from revision 04 by `tools/build_rev05.py` (build log `docs/build-log-rev05.txt`) |
| `tools/functional_test_rev05.py` | 265 checks (rev 04 checks, same-as-rev-04 comparison, notations, stress, profile curve, MAU method list, Building Balance small fans 21-30, 24" x 24" supply filter) |

### 10.1 N/A, Not Avail., Not Acc. in numeric inputs

The notations from the Abbreviations legend can now be typed into any numeric input (velocities, Ak, design CFM, volts, amps, FLA, statics, RPM, filter size, duct dimensions, PSP / filter-grid / profile readings, data-entry design values). The text stays visible in the cell and counts as a blank everywhere it is used: the CFM, %, corrected FLA, BHP, ΔP, TSP / ESP, free area, point layout and CFM/ft cells that depend on it stay blank, and totals and averages (outlet totals, 3-reading hood averages, PSP and traverse grid averages, Equipment Summary, Building Balance) skip it and use the remaining numbers. A design value typed as N/A in `{Equipment Data Entry}` shows as N/A on the unit page and the summaries.

The build parses every formula and wraps the part that does arithmetic on an input in `IF(OR(ISTEXT(…)…),"",…)`, at the smallest THEN/ELSE branch that uses the value (so the 3-phase BHP still averages the two legs that were read when one is "Not Acc."). `ISTEXT` of an empty cell is FALSE, so numbers and blanks give exactly the revision 04 results; 31,917 of 41,787 formulas were rewritten. Other points:

* An `AVERAGE` whose readings could all be notations also tests `COUNT(…)=0`, so it gives a blank instead of #DIV/0!.
* A filter size or filter type entered as a notation gives a blank filter CFM (previously a failed lookup gave 0).
* A leaving static entered as a notation is passed to the next component's entering static as the notation, so the fan TSP / unit ΔP that depend on it are blank. It is not treated as "component absent".
* A notation in a size cell (for example a traverse width) still shows in the generated size text, for example `N/A" x 12"`.
* The data validations on the input cells do not block typed text (error alerts are off), so the notations can be typed in Excel.

### 10.2 Fixes

* **Cover page project lines.** Revision 04 moved the cover block down 10 rows, and the relative links moved with it. PROJECT NAME, PROJECT ADDRESS and REPORT DATE read `{Project Information}` E12 / E13 / E24 (technician, project manager, blank) and now read E2 / E3 / E14 again. Contractor, engineer and architect used absolute references and were already correct.
* **MAU burner profile-pressure curve.** The duct-shape list (rev 03) and the unit-type table (rev 04) had been written over `{Dropdowns}` W1:W3 and X1:AD6, which is inside the housing-size 2–5 columns of the curve at 0.15–0.35 in. w.g. (21 of 72 cells). The curve is restored to the revision 01 values. The duct-shape list moved to AF1:AF3 and the unit-type table to AH1:AN6. The names `Duct.Shape` and `Unit.Type` and the 2,200 unit-type lookup references (1,100 formulas) were repointed. The profile CFM now matches revision 01 at 0.15, 0.20, 0.30 and 0.35 for housing sizes 1–5.
* **Not changed:** Building Balance still lists small fans 1–20 only. The exhaust column has 10 free rows (47–56, beside the MAU rows), not the 20 needed, so adding fans 21–40 needs a re-layout and is left for a decision.

### 10.3 Verification

| Check | Result |
|---|---|
| LibreOffice recalculation, blank template | 0 error cells in 41,787 formulas |
| `tools/functional_test_rev05.py` | 265 / 265 (re-run 2026-09-24 after the MAU Traverse method removal, Building Balance small fans 21-30 (section E) and the 24" x 24" supply filter key (section F)): all 133 revision 04 checks with the same expected values, plus cover links (3). With the revision 04 sample data every cell equals revision 04 except the fixed cover links and `{Dropdowns}`. N/A checks on every unit sheet and the roll-ups: 88. Stress test, with a notation in every empty input cell of every unit sheet and the data-entry sheet: 0 error cells. Profile curve and method list: 27. |
| Same notation data in revision 04 | 180 error cells (all removed in revision 05) |
| `tools/build_rev05.py --selftest` | 13 transform cases; all 41,787 formulas parse and round-trip |
| `tools/verify_blocks.py` | 0 issues on all seven unit sheets |
| Package | 13 of 83 parts changed (12 worksheets + workbook.xml names); vbaProject.bin, drawings, media, styles byte-identical; 37 data validations, 1,041 conditional formats, 52 defined names, 21 print areas as in revision 04 |

**Update (2026-09-23):** the MAU "Method used" list no longer offers *Traverse*. No method-total formula handled it, and it isn't needed for MAUs. `{Dropdowns}!T6` was cleared and `Airflow.Method` is now `$T$2:$T$5` (build step 2b). No other cells changed.

**Update (2026-09-23):** Building Balance now lists **Small Fans 21–30** in the 10 empty exhaust rows (H/I/K/M 47–56, beside the MAU rows), using the same formulas as rows 67–86 (build step 2c). The totals already sum rows 7–86, and the macro's hide-unused routine checks column H, so no other change was needed. Small fans 31–40 are left off by decision (rarely needed).

**Update (2026-09-24):** `{Dropdowns}!H45` now holds the key `Supply Filter (VelGrid)|24" x 24"` again. An earlier build had written the constants' source note there, so a 24" x 24" filter on the MAU filter grid gave 0 CFM. The note moved to `{Dropdowns}!AP1` (build step 2d).
