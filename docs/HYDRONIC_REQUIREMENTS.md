# Hydronic report: what NEBB requires (for ROADMAP §7.2)

Source: *NEBB Procedural Standard for TAB of Environmental Systems*, 9th Ed. (2019), the licensed copy in the
repository root (the PDF's password is the last part of its file name). The sources are §5.3.13 – 5.3.24 (report
forms), §6.7 – 6.8 (pressure and flow measurement) and Section 9 (hydronic procedures). This file summarises them as
requirements for the app. It is not a copy of the standard: read the standard for the wording. NEBB accepts
customised forms as long as every listed item is reported (§5.1). The report-wide items in §5.2 (title,
certification, ToC, summary, page rules, instruments, abbreviations) are the same as for airside, and the airside
workbook already covers them.

## 1. Report forms (§5.3) → equipment types in the app

| NEBB form | Design / submittal | Actual / test |
|---|---|---|
| **5.3.13 Pump** | designation, service, manufacturer, model / size, design flow, head, total connected load, motor HP, pump / motor rpm, impeller size | pump serial; motor mfr, HP, rated rpm, frame, phase, rated V / A, SF; operating V / A; corrected nameplate amps; actual BHP; **pump-off (standing) pressure**; **no-flow suction / discharge pressure and no-flow head**; **impeller diameter**; final suction / discharge pressure; **total dynamic head**; final flow; operating rpm; operating Hz / speed setting; final setpoints |
| **5.3.14 Pump, integrated variable speed** | as 5.3.13 | serial, motor nameplate data, standing pressure, final flow; Hz / speed, BHP, V / A, rpm **only if the pump's drive shows them** |
| **5.3.15 Balancing valve, fixed or adjustable orifice** | designation, service, manufacturer, model, size, flow | dial setting (adjustable), **ΔP**, **calculated flow** |
| **5.3.16 Balancing valve, self-adjusting (auto-flow / PICV)** | designation, service, manufacturer, model, size, operating ΔP range, tag flow, flow | ΔP (if the valve has ports), **tag flow when the ΔP is within the range** |
| **5.3.17 Ultrasonic flow measurement** (when used) | system served, measurement location, flow | pipe size, material, wall thickness; transducer size / type; configuration; spacing; flow |
| **5.3.18 Chiller, water-cooled** | designation, mfr, model; evaporator and condenser flow and ΔP | serial; evaporator flow and ΔP; condenser flow and ΔP |
| **5.3.19 Chiller, air-cooled** | designation, mfr, model; evaporator flow and ΔP | serial; evaporator flow and ΔP |
| 5.3.20 Compressor / condenser | outside the scope of TAB | none |
| **5.3.21 Cooling tower** | designation, mfr, model, water flow | serial, water flow |
| **5.3.22 Hot-water boiler** (burner and combustion out of scope) | designation, mfr, model, water flow, water ΔP | serial, water flow, water ΔP |
| **5.3.23 Heat exchanger, water to water** | designation, location, service, mfr, model; primary and secondary flow and ΔP | serial; primary and secondary flow and ΔP |
| **5.3.24 Heat exchanger, steam to water** | designation, location, service, mfr, model, water flow, water ΔP | serial, water flow, water ΔP |

**What this means for the app:**

- **There is no coil or terminal form.** Terminals (coils, fan coils, VAV reheat, radiant panels, chilled beams) are
  reported through the **balancing valve** serving them (5.3.15 / 5.3.16). Water and air temperatures are **not**
  required. They are only needed for the heat-transfer flow method, which is the least accurate (§9.3.6). The app
  should make them optional.
- **Chillers, boilers, heat exchangers and towers are small forms** (flow and ΔP only) and can share one page layout,
  like Small Fans on the airside.
- **Pumps are the big form,** the counterpart of the RTU Data page: nameplate, electrical (same as a fan motor),
  shut-off test, operating point.

## 2. How flow is measured (§9.3): the app's calculation methods

Six methods; the form records which one was used:

1. **Flow meter / flow fitting** (venturi, orifice plate, and so on): ΔP read against the device's chart or its Cv.
2. **Calibrated balancing valve** (preferred with 1): valve model, size, **setting**, and ΔP against the
   manufacturer's chart. A self-adjusting valve reports its tag flow, provided the ΔP is within its range.
3. **Pump curve:** the shut-off head confirms the impeller, then the operating head gives the flow from the
   (corrected) curve.
4. **Equipment pressure loss:** measured ΔP against the certified rated flow and ΔP (flow = rated flow ×
   √(ΔP measured / ΔP rated)).
5. **Heat transfer:** GPM = BTU/h ÷ (500 × ΔT). This is the least accurate.
6. **Ultrasonic** clamp-on meter (form 5.3.17).

**Units:** §9.3.2 warns that the gauge and the manufacturer's chart must use the same pressure unit. The app
should store ΔP with its unit (psi, ft w.g., in. w.g., kPa) and convert. 1 psi = 2.31 ft w.g. of water; glycol
changes the specific gravity.

**Readings taken at different elevations** (gauges, hoses, taps) have to be corrected (§6.7.4 e). The pump
shut-off and operating readings are corrected to the pump centreline (§9.5.1 j).

## 3. Balancing rules (§9.4, 9.5): checks and a balancing assistant

- **Tolerance: ±10 % of design flow** for every measured flow (§9.4). This is the same colour rule as airside.
- **Proof of a wide-open path.** At least one path from the pump to a terminal has every balancing valve fully open.
  Downstream of every adjusted branch valve there is another wide-open path. The app can check this if each valve
  records "wide open" and the system tree (pump → branch → terminal) is known.
- **Pump test sequence** (§9.5.1): standing pressure with the pumps off; rotation; V / A and rpm against nameplate;
  shut-off head; impeller confirmed on the curve (or a parallel curve drawn); wide-open total head; flow from the
  curve; set to about 110 % of design where the head allows; final pressures, flow, V / A. It maps onto the pump form.
- **Proportional (ratio) method** (§9.4.1): measure every terminal on a branch, leave the lowest-% valve alone, and
  bring each of the others to the same % in turn. Then do the same for the branches, then trim the pump.
  **Deterministic assistant:** after the first pass the app can sort the terminals by % of design, name the valve
  to adjust next and the target reading, and show when the branch is balanced.
- **Stepwise method** (§9.4.2): start at the pump, set each valve about 10 % under design, and repeat passes until
  everything is within ±10 % with one valve wide open.
- **Variable flow** (§9.5.3): balance at simulated full load. The diversity factor is the pump's rated flow ÷ the
  sum of the terminals' design flows. **Record the control setpoint** (the ΔP setpoint for the VFD) for the
  controls contractor.
- **Primary / secondary** (§9.5.4): balance the primary loop first, with the decoupler never closed.
- **Three-way valves** (§9.5.2): set the bypass to the specified flow, or to the coil's ΔP when none is specified.
- At the end, **memory stops set and valves marked** at their final settings (a checkbox per valve).

## 4. Proposed skeleton (mirrors the airside workbook)

| Airside | Hydronic |
|---|---|
| Project Information, Narrative, Summary New / (E), Abbreviations, Calibration, Certification | the same (shared) |
| Equipment Data Entry | **Hydronic Equipment Data Entry**: pumps, valves (per system), chillers, boilers, HX, towers |
| RTU Data + Airflow (per unit) | **Pump Data** (per pump; shut-off test and curve point) |
| VAV / outlet airflow pages (per system) | **Balancing Valve pages** per system / branch: designation, service, model, size, setting, ΔP, calculated flow, design flow, %, wide open ✓, memory stop ✓ |
| Small Fans (compact, several per page) | **Plant equipment** (chiller / boiler / HX / tower: flow and ΔP), several per page |
| Traverses | **Ultrasonic readings** (5.3.17), when used |
| Building Balance | **System Summary**: pump flow against the sum of the terminals, diversity, VFD setpoint |

**Decisions (a2b, 2026-09-29):**

1. **A separate hydronic workbook**, sharing Project Information with the airside one. Airside-only jobs are
   unchanged.
2. **Mostly pumps and balancing valves.** Build those first: Pump Data, Balancing Valve pages, System Summary.
   Chillers, boilers, heat exchangers, towers and ultrasonic readings come later, on the compact plant page.
3. **Valve makes: B&G, Armstrong, some Nexus, and "Flow…"** (make to confirm: FDI / Flow Design, FlowCon, or
   another?). *The more the merrier; add as we go.* So the valve library is **data, not code**:
   - an organisation library synced like the calibration library, where anyone can add a valve model: make,
     model, size, type (fixed / adjustable / self-adjusting), and its flow data;
   - flow data as either **a Cv per setting** (the table from the manufacturer's sheet; flow = Cv × √ΔP psi), or,
     for a self-adjusting valve, **its rated flow and ΔP range**;
   - every entry notes its source (data sheet name and date). The app ships **only values entered from published
     manufacturer data**, never guessed ones. Seeding the four makes means collecting their current data sheets
     (Cv / setting tables), which is a data-entry job and can happen as valves turn up on jobs;
   - a valve not in the library can still be recorded with a manually entered flow (from the chart on the tag or
     a meter), marked *flow entered manually*.
4. **Temperatures optional** everywhere.

## 5. Workbook revision H01 (built 2026-09-29)

`H01 - a2b_Blank_Hydronic_Workbook 9-29-26.xlsm`, built from the airside revision 05 by
`tools/build_hydronic.py` (log: `docs/build-log-hydronic-h01.txt`). `tools/functional_test_hydronic.py`
recalculates it in LibreOffice: **39 PASS**. It checks that the blank template has no error cells, the pump head
from the gauges (including specific gravity and gauge elevation), the motor formulas, valve % and totals, the
System Summary sums by system, and N/A notations (blank results, no errors). It still has to be opened in desktop
Excel.

| Sheet | What it holds | The app writes |
|---|---|---|
| Cover Page, ToC, Narrative, Summary - New / (E), {Project Information}, Certification, NEBB Cert, NEBB Frm Cert, Calibration, Photos | as airside (the cover adds *HYDRONIC SYSTEMS*; the ToC lists the hydronic sections) | the same cells as airside |
| {Hydronic Data Entry} | pump design data, rows 7 – 26: designation, service, **system**, location, mfr, model / size, design GPM, head (ft), connected load, motor HP, RPM, impeller, voltage, phase, pump type | B – P |
| System Summary | 30 systems (B7 – B36): pump design / final GPM, valve design / final GPM (summed by system name), %, diversity, wide-open count, VFD setpoint | system name, service, pumps, VFD setpoint |
| Pumps | 20 pumps, two per page (26-row blocks from row 4, "Pump" in B): unit data, design vs actual (flow, head, RPM, impeller), motor (the fan page's block, with corrected FLA and BHP), pump test (standing, shut-off, wide open, final: suction / discharge in psi, head in ft), SG, gauge elevation, flow by meter or valve, VFD Hz, final setpoints, remarks | serial, flow method, actual flow / RPM / impeller, motor data and readings, gauge readings, SG, elevation, meter flow, VFD, setpoints, remarks |
| Valves | 25 pages, one system per page (52 rows, "System" in B): pumps, instrument, ΔP unit (psi / ft w.g.), method, memory stops; 38 valves: no., tag, serves, make / model, size, type F / A / S, design GPM, initial GPM, final setting / ΔP / GPM, %, wide open; total, remarks | everything but % and totals |
| Plant Equipment | 2 pages × 40 rows, one row per water circuit: unit, type, service, mfr, model, serial, circuit, design GPM / ΔP, actual GPM / ΔP, %, flow method | everything but % |
| Flow Measurements | 24 ultrasonic readings: system, location, pipe size, material, wall, transducer, configuration, spacing, design / measured GPM, % | everything but % |

**Macros.** `tools/vba/TABHydronic.bas` has the same entry points as the airside `TABReport.bas`: PrintReport,
HideUnusedBlocks, ShowAllBlocks and SyncToCPageCounts, adapted to these sheets. As with the airside module, import
it once into the template (Alt+F11 → Import) and delete the old SyncToCPageCounts module. The build can't embed VBA.

**Judgement calls (pending a2b review):**

1. **A valve's GPM is an input, not a formula.** Adjustable and fixed orifice valves read their flow from the
   manufacturer's chart at the setting and ΔP, and self-adjusting valves from the tag. The app looks this up in its
   valve library and writes the GPM; the workbook still does the %, totals and summaries. The airside equivalent is
   the velocity, which is also an input.
2. **One system per valve page**, with the system name in D. The System Summary adds up pumps
   ({Hydronic Data Entry} *System*) and valves by that name, so the names must match. The app will fill them from
   one list.
3. **Plant equipment is a table,** one row per water circuit (a water-cooled chiller has an evaporator row and a
   condenser row), not a form per unit. NEBB only asks for flow and ΔP, and accepts custom forms that report every
   item (§5.1).
4. **ΔP unit set per page** (psi or ft w.g.), because NEBB §9.3.2 warns about mixing gauge and chart units. Pump
   gauges are in psi and head is in ft (× 2.31 / SG).
5. **Initial GPM** is kept on the valve page, like *Initial* on the airside outlet tables. NEBB only requires the
   final values.
6. **Calibration** is unchanged from airside. Its list already includes the hydronic manometer (S-DP-250); the app
   replaces the rows with the project's instruments as on airside.

