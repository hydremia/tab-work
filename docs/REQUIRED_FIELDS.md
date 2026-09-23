# Required Fields & Completion Rules (Proposal v1)

Mark up anything that is wrong. The goal is that **most things are required**, but any field, section or whole
piece of equipment can be set to **N/A** when it doesn't apply to the project or scope.

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
4. **Automatic.** The app sets N/A based on other answers, e.g. *Direct drive* → Drive Data is N/A. *No VFD* →
   VSD Frequency is N/A. *No OA* → OA damper position, OA airflow and OA damper photo are N/A.

### Project scope profiles
Chosen when a project is created, and can be changed later.

| Profile | What's required |
|---|---|
| **Full TAB** (default) | Everything below |
| **Airflow Only** | Identity fields, design CFM and airflow readings (outlets, traverses, hood filters). Unit data, motor, drive, static profile, misc. info and equipment photos are all set to N/A. |
| **Custom** | Turn sections on or off by equipment type |

### Color states (recap)
| Gray | Amber | Green | Red |
|---|---|---|---|
| Nothing entered | Required field(s) still blank | All required fields are filled or N/A | Linked open issue, or a reading out of tolerance (default ±10% of design, configurable per project) |

### Prelim vs. final readings
Airflow rows count as complete when they have **a reading in either Initial or Final**. The app only warns
about rows with Initial but no Final; that doesn't block green. This fits prelim reports that are partly
finalized.

### N/A reasons
These match the legend already on revision 04's Abbreviations sheet. The tech picks one:
**N/A** = Not Applicable · **Not Avail.** = Not Available · **Not Acc.** = Not Accessible.

### N1 — How N/A appears in numeric cells
A blank cell must **not** mean N/A (decided). Text in a cell that a formula multiplies (e.g. `VEL × Ak`)
causes a `#VALUE!` error in today's formulas. The options are:

| Option | What prints | Template change | Notes |
|---|---|---|---|
| **A. Hardened formulas (recommended)** | The notation itself (`N/A`, `Not Avail.`, `Not Acc.`) in the cell | Revision 05: wrap calcs that read input cells in number checks, e.g. `IF(ISNUMBER(I17), I17*$F17, "")`, so text displays and is skipped in totals and averages | Clearest report. Also fixes the same error for anyone typing N/A by hand in Excel today. Would be checked with the existing functional test suite before release. |
| B. Blank cell + note | Blank cell, with the notation written in that block's Remarks/Technician Notes (e.g. "Serial No.: Not Acc.") | None | Works with no template change, but the reader has to look in two places. |
| C. Section-level only | For a whole N/A section, the notation goes in the section's first text cell and the numeric cells stay blank | None | Only suits whole sections, not single fields. Could be combined with B. |

Text cells (serial, manufacturer, notes…) get the notation directly under every option.

---

## Project level

| Section | Required | Optional |
|---|---|---|
| Project Information | Project name, physical address, mechanical engineer, mechanical contractor, TAB date(s), technician(s), project manager | Architect, electrical engineer, general contractor, blueprints used/revision date |
| Cover photo | Required (can be set to N/A) | |
| Calibration | At least one instrument, each with a calibration date. The date is flagged if it is more than 12 months before the TAB date. | |
| Issues | Each issue needs New/Existing, a remark, a status (Open/Closed), and equipment **or** "General (N/A)" | Comments, photos |

---

## RTU / AHU, MAU / SF, ERV, Fans (EF, TF, KEF)

These all use the same *Data* sheet layout.

| Section | Fields | Notes |
|---|---|---|
| **Identity** | Designation, area served, location | Always required, even in the Airflow Only profile |
| **Design data** (from the schedule) | Manufacturer, model, HP, unit ESP, fan RPM, voltage, phase, design total CFM | Design OA CFM is required for RTU/MAU/ERV. It is N/A for exhaust fans. |
| **Unit data** | Serial number | |
| **Motor data** | Motor manufacturer, HP, RPM, SF, FLA, frame, measured voltage, measured amperage | |
| **Drive data** (belt drive only) | Motor sheave, fan pulley, belt(s), C to C | Automatically N/A for direct drive. *Drive Change Data* is optional and only filled when a drive was changed. |
| **Direct drive** (direct drive only) | Initial and final setting: RPM, VFD, or DCV. Only the one that applies. | Automatically N/A for belt drive |
| **RPM data** | Final motor RPM, final fan RPM | VSD frequency is required if a VFD is present. OA damper position is required if the unit has OA. |
| **Static pressure profile** | Entering/exiting at the filter/coil and fan | TSP and ESP are calculated by the workbook |
| **Misc. unit info** | Design fan rotation, actual fan rotation | |
| **Filters** | Design filter type, installed filter type, size, qty | N/A if the unit has no filters |
| **Airflow** (the *Airflow* sheet) | At least one supply outlet row. Every row needs No., area served, size, Ak, design CFM, and a reading. | Return and OA rows are required if they apply. The OA row is automatically N/A if design OA is 0. |
| **Photos** | Unit, unit label/tag | All required unless marked N/A. The OA damper photo only applies to units with OA. |
| Technician notes, remarks | Optional | |

## VAV boxes

| Section | Fields | Notes |
|---|---|---|
| **Identity** | Designation (system), service, area served, location | Always required |
| **Unit data** | Manufacturer, model, serial number, size | |
| **Design & performance** | Max CFM, min CFM (design and actual), BAS address, calibration factor | Fan CFM only for fan-powered boxes. Otherwise automatically N/A. |
| **Airflow** (*VAV Airflow* sheet) | Same row rules as above | Revision 04: every VAV has its own airflow table |
| **Photos** | Unit/tag | Required unless N/A |

## Kitchen hoods

| Section | Fields | Notes |
|---|---|---|
| **Identity** | Designation, area served | |
| **Design info** | Hood manufacturer, design CFM, associated exhaust fan | |
| **Hood data** | Model, serial number, hood type, filter manufacturer, filter height | |
| **Filter readings** | At least one filter row: width and a velocity reading | |
| **Photos** | Hood, hood tag | Required unless N/A |

## Traverses

| Fields | Notes |
|---|---|
| Point (T-#), area served, size, Ak, design CFM, a reading (Initial or Final VEL), instrument | Duct static pressure and temperature are optional |

---

## Questions on this proposal

- **R1.** ✅ ±10% standard tolerance.
- **R2.** ✅ Photos (unit, tag, OA damper) are required for green unless marked N/A.
- **R3.** ✅ Capacities equal. Revision 04 already gives all 80 VAVs their own airflow table (the 20-page limit was in the old 4-16-26 file).
- **R4.** ✅ Blank must not mean N/A. See **N1** above for the options.

> Note: this proposal was drafted against the old 4-16-26 layout. It will be refreshed for revision 04
> (hood filter type/instrument, Small Fans, ERVs, traverse duct shape/size, MAU supply method).
