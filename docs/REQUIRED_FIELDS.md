# Required Fields & Completion Rules (Proposal v2, revision 04 layout)

Mark up anything that is wrong. The goal is that **most things are required**, but any field, section or whole
piece of equipment can be set to **N/A** when it doesn't apply to the project or scope.

v2 keeps every decision from v1 and updates the equipment sections to the fields that really exist in
revision 04 (and 05). The cell-by-cell map is in [WORKBOOK_ANALYSIS.md](./WORKBOOK_ANALYSIS.md). Items marked
**(new)** are new in v2 and still need your OK.

## How it works

### Field states
Each field is always in one of three states:

| State | Counts toward "complete"? |
|---|---|
| **Value entered** | ✅ |
| **N/A**, with an optional reason | ✅ |
| **Blank** | ❌ keeps the equipment amber |

N/A can be set at four levels. Each level can be overridden by the level below it:
1. **Project scope profile.** Sets N/A for whole sections on every piece of equipment (see below).
2. **Section.** For example, "Drive Data: N/A" on one fan.
3. **Field.** For example, "Serial Number: N/A (nameplate missing)".
4. **Automatic.** The app sets N/A based on other answers. The full list is in
   [Automatic N/A rules](#automatic-na-rules) below.

### Project scope profiles
Chosen when a project is created, and can be changed later.

| Profile | What's required |
|---|---|
| **Full TAB** (default) | Everything below |
| **Airflow Only** | Identity fields, design CFM and airflow readings (outlets, MAU supply method, VAV max/min, traverses, hood filters) and the instrument used. Unit data, motor, drive, RPM, static profile, misc. info and equipment photos are all set to N/A. |
| **Custom** | Turn sections on or off by equipment type |

### Color states (recap)
| Gray | Amber | Green | Red |
|---|---|---|---|
| Nothing entered | Required field(s) still blank | All required fields are filled or N/A | Linked open issue, or a reading out of tolerance (default ±10% of design, configurable per project) |

The project tolerance is also written to the workbook's **Equipment Summary** (cell E5), so the printed
"OK / Check" column matches the app.

### Prelim vs. final readings
Airflow rows count as complete when they have **a reading in either Initial or Final**. The app only warns
about rows with Initial but no Final; that doesn't block green. This fits prelim reports that are partly
finalized.

### N/A reasons
These match the legend already on the workbook's Abbreviations sheet. The tech picks one:
**N/A** = Not Applicable · **Not Avail.** = Not Available · **Not Acc.** = Not Accessible.

### N1 — How N/A appears in numeric cells ✅ decided: option A
A blank cell must **not** mean N/A. **Revision 05 hardens the formulas**, e.g.
`IF(ISNUMBER(I17), I17*$F17, "")`, so the notation itself (`N/A`, `Not Avail.`, `Not Acc.`) prints in the cell
and is skipped in totals and averages. This also fixes the same error for anyone typing N/A by hand in Excel.
Text cells (serial, manufacturer, notes…) always get the notation directly.

**Export rule (decided 2026-09-24):** every N/A is written into the workbook. N/A you set yourself is written
as the notation you chose. N/A the app sets (automatic rules such as direct drive → drive data, and the project scope
profile) is written as `N/A`. No cell is left blank to mean N/A.

**Photos on re-import (decided 2026-09-24):** photos are not stored in the workbook. Re-importing into the same
project keeps its photos. Importing into a new project brings units back amber until their photos are added.

(Options B "blank cell + note in Remarks" and C "section-level only" were not chosen.)

---

## Project level

| Section | Required | Conditional / optional |
|---|---|---|
| **Project Information** | Project name, physical address, mechanical engineer, mechanical contractor, TAB date(s), technician(s), project manager, report date | Optional: architect, electrical engineer, general contractor, blueprints used (up to 9 sheets, each with a revision date) |
| **Cover photo** | Required (can be set to N/A) | The app crops it to the cover box shape (about 1.685 : 1, wide) |
| **Narrative** | Required: system set-up description (one text box) | Can be N/A for a prelim report ✅ R5 |
| **Calibration** | At least one instrument, each with type, manufacturer, model, serial and calibration date (8 slots). The date is flagged if it is more than 12 months before the TAB date. | The template's 7 a2b instruments are pre-loaded. **(new)** The app flags any instrument chosen on a unit page that has no calibration row. |
| **Issues** | Each issue needs New/Existing, a remark, a status (Open/Closed), and equipment **or** "General (N/A)" | Optional: comments, photos. New issues go to *Summary - New* and existing ones to *Summary - (E)*, each numbered separately, 50 per sheet. |
| **Building pressures** **(new)** (Building Balance) | Building vs. Outdoors ΔP | Kitchen vs. Dining ΔP is required when the project has kitchen hoods, otherwise automatically N/A. One spare pair, remarks and notes are optional. |
| **Certification** | Signature and date **required on the final report** | Stamp image. Automatically N/A on a prelim report. ✅ R5 |

Building Balance and Equipment Summary are all formulas, so they need no entry.

---

## RTU / AHU / DOAS (RTUs sheet)

| Section | Fields | Notes |
|---|---|---|
| **Identity** | Designation, area served, location | Always required, even in Airflow Only. Tagged New/Existing. |
| **Design data** (schedule) | Manufacturer, model, HP, unit ESP, fan RPM, voltage, phase | Design total CFM and design OA CFM are required in the app. ✅ R8: **both are checked.** The schedule design CFM and the sum of the outlet design CFMs are compared, and any discrepancy is **highlighted as a callout** on the unit (and listed in a project-wide "Design discrepancies" view). |
| **Unit type** **(new)** | RTU or DOAS | Sets which static-profile boxes apply (see auto-N/A) |
| **Unit data** | Serial number | |
| **Motor data** | Motor manufacturer, motor RPM, service factor, FLA, frame, measured voltage, measured amperage | Measured volts/amps: 3 legs for 3-phase, 1 for single-phase. Corrected FLA and BHP are calculated. |
| **Drive data** | Drive type (Belt / Direct / ECM), motor sheave, fan pulley, belt(s), C to C, sheave bore M/F | Sheaves, belts, C to C and bore are automatically N/A unless the drive type is Belt. **(new)** In revision 04 the sheave/belt values come from the schedule, so a changed drive is recorded by updating those values (and noting it in Remarks). |
| **Misc. unit info** | Fan rotation design, fan rotation actual, filter type/size/qty, final settings | Filters are N/A if the unit has none. *Final settings* is free text (e.g. VFD 48 Hz, ECM dial 7). |
| **RPM data** | Final motor RPM, final fan RPM | Initial values are optional. VSD frequency (final) is required if a VFD is present. |
| **OA damper position** | Required if the unit has OA | Automatically N/A when design OA is 0 |
| **Static pressure profile** | Entering static at the first component, and leaving static at every component that applies to the unit type (Filter, Wheel, Coil, Heat, Fan) | Fan TSP, ESP and unit ΔP are calculated |
| **Airflow** | Instrument, and at least one supply outlet row. Every row needs No., area served, type, size, Ak, design CFM and a reading. Up to 48 supply rows. | Return rows (up to 6) are optional; the first return row is calculated as total − OA. The OA row (1) is required if design OA > 0, otherwise automatically N/A. *Ak basis / notes* is optional. |
| **Photos** | Unit, unit label/tag, OA damper | All required unless marked N/A. The OA damper photo only applies to units with OA. |
| Remarks | Optional | 3 lines on page 1, 2 on the continuation page |

## MAU / supply fan (MAUs sheet)

Same as RTU, with these differences:

| Section | Fields | Notes |
|---|---|---|
| **Unit type** | MAU (Filter, Burner, Fan) | |
| **OA damper, OA and return rows** | — | Not on the MAU page |
| **Supply airflow method** | **Method used**: Outlets, PSP, Filter Grid, Profile Pressure | Required. Only the chosen method's inputs are required; the other methods are automatically N/A. |
| — Outlets | Instrument and outlet rows (up to 38), same row rules as RTU | Required when method = Outlets. Optional otherwise. |
| — PSP (perforated supply plenum) | Length, width (6–24 in list), number of blanks, velocity readings (up to 20) | K-factor, CFM and CFM/ft are calculated |
| — Filter grid | Filter size and velocity for each filter (up to 11) | Supply Filter (VelGrid) constants, K 1.35 |
| — Profile pressure | Housing size (1–5), burner profile pressure (0.15–0.65 in. w.g.) | CFM comes from the manufacturer's curve (see the revision 05 note in WORKBOOK_ANALYSIS §8) |
| **Design CFM override** | Optional | When filled, it replaces the outlet design total |
| **Photos** | Unit, unit label/tag | OA damper photo is N/A |

Note: "Traverse" was removed from the Method list in revision 05 (B2: not needed for MAUs).

## ERV / heat recovery (ERVs sheet)

Same as RTU for identity, unit data, motor, drive, RPM, misc. info and static profile (unit type ERV: Filter,
Core, Fan), with these differences:

| Section | Fields | Notes |
|---|---|---|
| **Design data** | Design supply CFM, design exhaust CFM, design supply ΔP, design exhaust ΔP | No unit ESP line on the ERV page |
| **Primary (supply) airflow** | Supply instrument and outlet rows (up to 24) | Same row rules as RTU |
| **Secondary (exhaust) airflow** | Exhaust instrument and inlet rows (up to 24) | Same row rules |
| **Pressure drops** | Actual supply ΔP, actual exhaust ΔP | |
| **OA damper** | — | N/A on ERVs |
| **Photos** | Unit, unit label/tag | |

## Fans: EF, TF, KEF (Fans sheet)

Same as RTU for identity, design data, unit data, motor, drive, RPM and misc. info, with these differences:

| Section | Fields | Notes |
|---|---|---|
| **Design data** | Design OA CFM is N/A | |
| **Static pressure profile** | Unit type EF: fan inlet (entering) and fan discharge (leaving) only | Filter, wheel, coil and heat are automatically N/A |
| **Airflow** | Instrument and at least one register/grille row (up to 56) | No return or OA rows |
| **OA damper** | — | N/A |
| **Photos** | Unit, unit label/tag | |

## Small exhaust fans (Small Fans sheet, direct drive under 1/6 hp, NEBB 5.3.6)

NEBB only requires designation, service, manufacturer, model and design/actual airflow for these, so the page
is short. ✅ R6: you asked for **model, serial and amps**. Manufacturer and airflow stay required because NEBB
5.3.6 requires them. Everything else is optional.

| Section | Fields | Notes |
|---|---|---|
| **Identity** | Designation, area served, location | Always required |
| **Required** | Manufacturer, model, **serial number**, **measured amps**, design CFM | |
| **Optional** | HP, voltage, phase, unit ESP design/actual, fan RPM design/actual, speed setting design/actual, final settings | |
| **Airflow** | Instrument and at least one outlet row (up to 6) | Same row rules as RTU |
| **Photos** | Unit/tag | Required unless N/A |

Note: Building Balance lists small fans 1–30 (21–30 added in revision 05). The app warns if a project has more than 30 small fans, because 31–40 would be missing from the building exhaust total.

## VAV / fan-powered terminals (VAVs sheet)

| Section | Fields | Notes |
|---|---|---|
| **Identity** | Designation (system), service/area served, location | Always required |
| **Design data** (schedule) | Manufacturer, model, inlet size, terminal type, design max CFM, design min CFM, DDC address | Heating CFM design only if scheduled. Fan CFM design only for fan-powered types. |
| **Unit data** | Serial number, calibration factor, DDC max / min (one text field, e.g. "600 / 150") | |
| **Performance (actual)** | Actual min CFM | Actual max is calculated from the outlet readings. Actual heating CFM is required only when design heating CFM is scheduled. Actual fan CFM is required only for fan-powered terminals, otherwise automatically N/A. |
| **Airflow** | Instrument and at least one outlet row (up to 6) | Same row rules as RTU |
| **Photos** | Unit/tag | Required unless N/A |
| Remarks | Optional | 2 lines |

## Kitchen hoods (Hoods sheet)

| Section | Fields | Notes |
|---|---|---|
| **Identity** | Designation, area served | Always required |
| **Design info** | Hood manufacturer, design CFM, hood length (ft), associated exhaust fan | CFM per ft is calculated |
| **Hood data** | Model, serial number, hood type, filter manufacturer, **filter type**, **instrument** | Filter type sets the free area and K-factor used for CFM |
| **Filter readings** | At least one filter row: filter size and a reading (up to 14 rows) | **VelGrid** filter types (Baffle, Captrate, Supply Filter): 1 reading per filter, Initial and/or Final. **Airfoil** types (Condensate Baffle, HVC / Slot): **3 readings** per filter, averaged by the workbook. A "No Filter" row is automatically N/A for readings. |
| **Photos** | Hood, hood tag | Required unless N/A |
| Technician notes | Optional | Off-print |
| Remarks | Optional | 5 lines per page, shared by the two hoods on that page |

The app should only offer filter sizes that exist for the chosen filter type. Other combinations give 0 CFM in
the workbook.

## Traverses (Traverses sheet)

| Section | Fields | Notes |
|---|---|---|
| **Identity** | Point (T-#), area served, design CFM | |
| **Duct** | Duct shape (Rectangular / Round), width or diameter, height, liner thickness | Height is automatically N/A for round ducts. Liner is optional (blank = none). Size text, Ak, point count and positions are calculated. |
| **Readings** | Final: the full point grid, typed in reading order through quick entry (up to 80). Initial: one average velocity. | Complete when Initial **or** Final is present (prelim rule). Warn when fewer readings are entered than the calculated point count. |
| **Conditions** | Instrument, duct static pressure, temperature | ✅ R7: **all three required** |
| Remarks | Optional | 3 lines per page, shared by the three traverses on that page |

---

## Automatic N/A rules

| When… | …these become N/A |
|---|---|
| Drive type is Direct or ECM | Motor sheave, fan pulley, belt(s), C to C, sheave bore M/F |
| No VFD on the unit | VSD frequency (initial and final) |
| Design OA CFM is 0 or blank (RTUs) | OA damper position, OA airflow row, OA damper photo |
| Unit type shows "—" for a component (e.g. no Wheel on an RTU, only Fan on an EF) | That component's static pressure (exported as a **blank** cell, not "N/A": the workbook's strip skips a blank component and passes the entering static on; an "N/A" there would blank the downstream ΔP and fan TSP) |
| Phase is 1-phase | Voltage and amperage legs 2 and 3 |
| Unit has no filters | Filter type/size/qty, filter static pressures (the filter's leaving static is exported blank, as above) |
| MAU method is not Outlets | Outlet rows become optional. The other methods' inputs are N/A. |
| VAV terminal type is not fan-powered | Fan CFM (design and actual) |
| VAV heating CFM not scheduled | Actual heating CFM |
| Hood filter size is "No Filter" | Readings on that row |
| Hood filter type is VelGrid | Readings 2 and 3 on every row |
| Duct shape is Round | Duct height |
| Project has no kitchen hoods | Kitchen vs. Dining pressure |
| Prelim report | Certification signature/date, Narrative (optional) |
| Scope profile is Airflow Only | Unit data, motor, drive, RPM, static profile, misc. info, equipment photos |

---

## Questions on this proposal

- **R1.** ✅ ±10% standard tolerance.
- **R2.** ✅ Photos (unit, tag, OA damper) are required for green unless marked N/A.
- **R3.** ✅ Capacities equal. Revision 04 already gives all 80 VAVs their own airflow table.
- **R4.** ✅ Blank must not mean N/A. Option A (hardened formulas, revision 05) chosen; see **N1**.
- **R5.** ✅ Narrative required (N/A allowed on prelims). Certification signature and date required on final reports.
- **R6.** ✅ Small fans: model, serial and amps required (plus manufacturer and airflow, which NEBB requires). The rest is optional.
- **R7.** ✅ Traverses: instrument, duct SP and temperature all required.
- **R8.** ✅ Check both: schedule design CFM vs. the outlet design sum, with a highlighted callout when they disagree.
