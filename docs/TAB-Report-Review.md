# TAB Report Review – Findings and Recommendations

Reviewed files (as committed in this repo):

| File | Role |
|---|---|
| `00 - a2b_Blank_TAB_Workbook 4-16-26.xlsm` | Blank a2b TAB Report workbook (24 sheets, 1 VBA module `SyncToCPageCounts`) |
| `tb-worksheet-evergreen 2.xlsx` | Evergreen Telemetry field worksheets (hood filters, PSP, supply-fan filters, direct-fired profile pressure, building pressures) |

Method: every cell, formula, merged range, validation, conditional format, page setup and defined name was extracted programmatically and the repeating unit blocks were compared against each other and against the sheets they link to. Two limitations of this pass:

* LibreOffice cannot load files in this cloud sandbox, so no PDF/page render was produced. Page-fill figures below come from row heights, page breaks and print scale.
* nebb.org is blocked by the sandbox network policy. The NEBB gap analysis is based on the 9th Edition (2019) *Procedural Standard for TAB of Environmental Systems* Section on reports/forms from memory plus public specification summaries. Items marked **(confirm)** should be checked against your copy of the standard.

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

## 3. NEBB reporting requirements – gap analysis

NEBB 9th Ed. presents report content in shall/should/may language; a certified report must contain all "shall" data for each component and the common report items. The template already covers most of it. Gaps and risks:

| Area | NEBB expectation **(confirm against your copy)** | Template status | Gap / recommendation |
|---|---|---|---|
| Title page | Project, location, TAB firm, NEBB firm cert no., report date | Present | Add report date and "Report No./Revision" (only project TAB dates exist). |
| Certification page | Statement, CP name, NEBB CP number, **signature and date**, NEBB seal | Statement, name, number, expiration present | **No signature line / signed-date cells.** Add. Seal image is on the NEBB Cert sheet only. |
| Table of contents | Required | Present | Page numbers static (see macro); fix typo. |
| Summary / remarks | Deviations beyond tolerance, items not completed, reasons | Present (New / Existing) | OK. Add "NEBB tolerance ±10% unless otherwise specified" statement and a place to state the applicable tolerance. |
| Exception notation | "N/A" alone is **not permitted**; must state Not Available / Not Applicable / Not Accessible | Abbreviations legend defines "N/A = Not Applicable" | Remove "N/A" from the legend; add the three NEBB notations. |
| Instrument list | Instrument, manufacturer, model, serial, calibration date (within calibration interval) | Present | Make it per-project input (link to a small instrument table) rather than hard-coded; add "Range/Accuracy" column (should). |
| Abbreviations | Should | Present | Fix "Killowatt" (2×), "V = Volts €", duplicate kW. |
| System schematic / outlet identification | Shall identify outlets on a drawing or schematic | ToC lists "Mechanical Floorplan(s)" as external | OK if attached; add a placeholder page so the ToC page count is right. |
| Fan / AHU / RTU data | Unit ID, area served, location, mfr, model, **serial**, fan type/arrangement/class, drive (sheaves, belts, C-C), motor mfr, HP, RPM, V/Ph/**Hz**, FLA, SF, frame; design vs actual CFM (SA/RA/OA), RPM, SP (suction/discharge/TSP/ESP), filter/coil ΔP, amps and volts **per phase**, VFD Hz | Nearly all present | Add fan type/arrangement (or drive type: belt/direct), nameplate Hz, motor manufacturer link, and label the three voltage/amp cells L1-L2-L3 (or T1-T2-T3). "OA damper position" exists but no minimum-OA setting record. |
| Air temperatures | AHU/RTU: OA, RA, MA, SA temps (should; shall where coils are tested) | Absent on RTU Data | Add a 4-cell temperature strip (dry-bulb; wet-bulb optional). |
| Outlets / diffusers | ID, location, type/size, Ak, design vel/CFM, initial, final, % | Present | Add "Type" (neck vs face) or note the Ak source; NEBB wants the Ak basis identifiable. |
| Duct traverses | Duct size, area, number of readings, avg velocity, CFM, duct SP, temperature, instrument | Present (single line per traverse) | Add "No. of readings" cell; consider optional velocity grid for large ducts. |
| VAV / terminals | ID, mfr, model/size, inlet size, design max/min, actual max/min, controller/DDC reading, inlet SP | VAV Data has max/min/fan CFM, address, cal factor | Add "Controller reading" and "Inlet SP". No Data-Entry link (manual) – acceptable but inconsistent. |
| Kitchen hoods | Hood mfr/model, type, dimensions, filter type/size/qty, design/actual exhaust, associated EF, MUA | Present except dimensions/qty | See §4 – align with Evergreen method. |
| ERV / HRU | Same as AHU plus exhaust side | **No sheet** although Data Entry has an ERV section | Add an ERV page (supply + exhaust airflow, wheel/core) or delete the Data Entry section. |
| Hydronic | Pumps/coils if in scope | None (a hydronic DP instrument is listed) | Confirm out of scope; if so remove the instrument line from the template default. |
| Building pressurization | Should record relative pressures where specified | Building Balance has "Measured Building Pressure" (one cell) | Add reference-to-space rows (e.g. Kitchen–Dining, Building–Outdoor) – the Evergreen "Building Pressures" sheet does exactly this. |

---

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

### How the TAB Report Hoods page differs

`Hoods!K10 = J10 × (I10 × $E$18 / 144)` – velocity × **gross** filter face area (width × height), no free-area factor, no instrument K-factor, one reading per filter, no filter-type selection, no hood length / CFM-per-foot.

Effect of the difference (TAB Report CFM ÷ Evergreen CFM for the same velocity reading):

| Filter | Captrate (K 1.34) | Baffle (K 1.28) |
|---|---|---|
| 12×12 | 1.08 | 1.13 |
| 16×16 | 0.98 | 1.03 |
| 16×20 | 0.96 | 1.00 |
| 20×20 | 0.93 | 0.97 |
| 24×24 | 0.89 | 0.93 |

So the two methods agree within a few percent for 16×20 baffle filters and diverge up to 13 % for small filters and ~10 % for large ones. Since the Evergreen constants come from the instrument manufacturer's worksheet, are revision-controlled (rev 2.1) and distinguish Captrate vs baffle, **the Evergreen worksheet should be treated as the authoritative method** and the Hoods page brought in line.

### Recommendations to align

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

## 6. Suggested order of work (pending answers to the questions in the session)

1. Patch the eight link defects in §2.1 directly in the workbook XML (preserves images, VBA, validations) and re-verify with the consistency script.
2. Normalise blank-unit display (`""` instead of 0) and guard the % / BHP formulas.
3. Strip dead external links and `#REF!` names; fix ToC/Abbreviations text; clean the certificate sheets.
4. Add signature/date lines, NEBB exception notations, temperature strip, Hz, fan type, per-phase labels, traverse reading count.
5. Rebuild Hoods with the Evergreen method; add PSP / filter-grid / profile-pressure blocks to MAU.
6. Print-order + hide-unused-rows macro (Option A) and ToC sync button.
7. Design the merged per-unit sheet (Option B) as the next template version.
