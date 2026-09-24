"""Functional test for the revision 05 TAB workbook.

    python3 tools/functional_test_rev05.py "05 - a2b_Blank_TAB_Workbook <date>.xlsm" ["04 - a2b_Blank_TAB_Workbook <date>.xlsm"]

Every run recalculates copies of the workbook with LibreOffice (libreoffice-calc; the xlsx skill's
recalc.py is used when present, otherwise soffice headless) and checks:

  0. blank template: no error cells
  A. revision 04 sample data: the 133 revision 04 checks with identical expected values, plus the
     cover-page links; then the same data in the revision 04 file, and every computed cell of the
     two workbooks is compared (only the fixed cover links and the {Dropdowns} sheet may differ)
  B. N/A notations (N/A, Not Avail., Not Acc.) typed into numeric inputs on every unit sheet:
     dependent cells blank or computed from the remaining numbers, totals skip the N/A rows,
     the notation still shows in the input cell, no error cells.  The same data in revision 04 is
     recalculated too, to show how many #VALUE! / #DIV/0! cells revision 05 removes.
  C. stress: sample data + a notation in every empty cell of every unit sheet and the data-entry
     sheet: no error cells
  D. MAU profile-pressure CFM at 0.15 / 0.20 / 0.30 / 0.35 in. w.g. for housing sizes 1-5 equals
     the revision 01 curve; {Dropdowns} U1:Z12 equals revision 01; moved lists and names work
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
from itertools import cycle

from openpyxl import load_workbook
from openpyxl.cell.cell import MergedCell

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = sys.argv[1]
REV04 = sys.argv[2] if len(sys.argv) > 2 else sorted(glob.glob(os.path.join(ROOT, "04 - a2b_Blank_TAB_Workbook *.xlsm")))[-1]
REV01 = sorted(glob.glob(os.path.join(ROOT, "01 - a2b_Blank_TAB_Workbook *.xlsm")))[-1]
tmpdir = tempfile.mkdtemp()
ERRS = ("#VALUE!", "#DIV/0!", "#REF!", "#NAME?", "#N/A", "#NUM!", "#NULL!", "Err:")
NOTES = ("N/A", "Not Avail.", "Not Acc.")
results = []          # (section, name, got, expected, ok)


def recalc(path):
    skill = sorted(glob.glob("/root/.claude/skills/synced/*/xlsx/scripts/recalc.py"))
    if skill:
        out = subprocess.run([sys.executable, skill[0], path, "600"], capture_output=True, text=True,
                             cwd=os.path.dirname(skill[0]))
        try:
            res = json.loads(out.stdout)
        except ValueError:
            res = {}
        if "total_formulas" not in res:          # error cells are counted by this test, not treated as failure here
            raise SystemExit(f"LibreOffice recalculation failed for {path}: {out.stdout[-400:]} {out.stderr[-400:]}")
        return
    outdir = os.path.join(tmpdir, "conv")
    os.makedirs(outdir, exist_ok=True)
    r = subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xlsx", "--outdir", outdir, path],
                       capture_output=True, text=True, timeout=900)
    conv = os.path.join(outdir, os.path.splitext(os.path.basename(path))[0] + ".xlsx")
    if not os.path.exists(conv):
        raise SystemExit(f"soffice could not recalculate {path}: {r.stdout} {r.stderr}")
    shutil.move(conv, path)


def prepared(src, name, *fills):
    path = os.path.join(tmpdir, name + ".xlsm")
    shutil.copy(src, path)
    if fills:
        wb = load_workbook(path, keep_vba=True)
        for f in fills:
            f(wb)
        wb.save(path)
    recalc(path)
    return load_workbook(path, data_only=True)


def count_errors(wb):
    return sum(1 for ws in wb.worksheets for row in ws.iter_rows() for c in row
               if isinstance(c.value, str) and c.value.startswith(ERRS))


def check(section, name, got, exp):
    ok = (got == exp) or (isinstance(got, (int, float)) and isinstance(exp, (int, float))
                          and not isinstance(got, bool) and abs(got - exp) < 1e-6)
    results.append((section, name, got, exp, ok))


r4 = lambda x, n=4: round(x, n) if isinstance(x, (int, float)) else x


# ----------------------------------------------------------------------------------------- fills
def fill_rev04(wb):
    """Exactly the sample data of tools/functional_test_rev04.py."""
    ede = wb["{Equipment Data Entry}"]
    for col, val in zip("BCDEFGHIJKLMNOPQ", ["RTU-1", "Dining", "Roof", "Carrier", "48TC", 5, 0.8, 1100, 3.2, 6.0, "A42", 14, 460, "3-phase", 4000, 800]):
        ede[f"{col}7"] = val
    ede["B8"] = "RTU-2"; ede["O8"] = "1-phase"; ede["N8"] = 208
    ede["B101"] = "EF-21"; ede["C101"] = "Kitchen"; ede["B102"] = "EF-22"
    ede["B52"] = "MUA-1"; ede["B61"] = "MUA-10"
    ede["B65"] = "ERV-1"; ede["C65"] = "Offices"; ede["P65"] = 1500; ede["Q65"] = 1400; ede["R65"] = 0.35; ede["S65"] = 0.40; ede["I65"] = 950
    ede["B126"] = "KH-1"; ede["E126"] = "CaptiveAire"; ede["F126"] = 2000; ede["I126"] = 8
    for col, val in zip("BCDEFGHIJKLM", ["VAV-1", "Rm 101", "Ceiling", "Titus", "DESV", 8, "Pressure Independent", 600, 150, 200, None, "AV-101"]):
        ede[f"{col}150"] = val
    rt = wb["RTUs"]
    for r, v, h in ((33, 400, 420), (34, 350, 360), (35, 300, 320)):
        rt[f"F{r}"] = 1.0; rt[f"H{r}"] = h; rt[f"K{r}"] = v
    rt["F60"] = 1.0; rt["H60"] = 100; rt["K60"] = 90
    rt["F51"] = 2.0; rt["H51"] = 800; rt["K51"] = 380
    rt["E17"] = 7.6; rt["E19"] = 470; rt["F19"] = 465; rt["G19"] = 468; rt["E20"] = 6.0; rt["F20"] = 6.1; rt["G20"] = 5.9
    rt["C24"] = -0.3; rt["C25"] = -0.5; rt["E25"] = -0.7; rt["G25"] = 0.9
    fn = wb["Fans"]; fn["F2113"] = 1.0; fn["H2113"] = 500; fn["K2113"] = 450
    fn["C24"] = -0.5; fn["G25"] = 0.3
    mu = wb["MAUs"]; mu["F33"] = 1.5; mu["H33"] = 280; mu["K33"] = 200
    mu["D59"] = 96; mu["G59"] = 12; mu["J59"] = 1
    for c in "DEFGHIJKLM":
        mu[f"{c}60"] = 300; mu[f"{c}61"] = 300
    mu["C65"] = '16" x 20"'; mu["C66"] = 400; mu["D65"] = '12" x 24"'; mu["D66"] = 300
    mu["D71"] = 1; mu["H71"] = 0.175
    mu["E74"] = "PSP"; mu["K74"] = 2100
    mu["D1007"] = 2; mu["H1007"] = 0.65; mu["E1010"] = "Profile Pressure"
    h = wb["Hoods"]; h["E18"] = "Captrate (VelGrid)"; h["E19"] = "Evergreen VelGrid"
    for i, v in enumerate([177, 187, 183, 175, 162]):
        h[f"I{10+i}"] = '16" x 20"'; h[f"S{10+i}"] = v
    h["P10"] = 170; h["Q10"] = 180; h["R10"] = 175
    ev = wb["ERVs"]; ev["F33"] = 1; ev["H33"] = 1500; ev["K33"] = 700; ev["F43"] = 1; ev["H43"] = 1400; ev["K43"] = 650
    va = wb["VAVs"]; va["F17"] = 1; va["H17"] = 300; va["K17"] = 290
    for col, val in zip("BCDEFGHIJ", ["EF-S1", "Toilet 101", "Ceiling", "Greenheck", "SP-A110", 0.05, 115, "1-phase", 110]):
        ede[f"{col}233"] = val
    sf = wb["Small Fans"]; sf["F16"] = 1.0; sf["H16"] = 110; sf["K16"] = 100; sf["K12"] = 3.0; sf["L9"] = 0.25
    t = wb["Traverses"]
    t["D9"] = "Rectangular"; t["G9"] = 24; t["I9"] = 12; t["K9"] = 0
    for i in range(12):
        t.cell(11 + i % 10, 16 + i // 10).value = 480 + i * 4
    t["D24"] = "Round"; t["G24"] = 10
    for i in range(16):
        t.cell(26 + i % 10, 16 + i // 10).value = 600 if i < 8 else 620


def fill_report_date(wb):
    wb["{Project Information}"]["E14"] = "9/23/26"


NA_INPUTS = {}        # (sheet, cell) -> notation typed by fill_na, checked after recalculation


def fill_na(wb):
    def put(sheet, cell, val):
        wb[sheet][cell] = val
        if isinstance(val, str) and val in NOTES:
            NA_INPUTS[(sheet, cell)] = val
    ede = "{Equipment Data Entry}"
    # RTU-1: an all-notation outlet row, an outlet with N/A Ak, two N/A motor readings
    for c, v in (("F36", 1.0), ("H36", "N/A"), ("I36", "Not Acc."), ("K36", "Not Avail."),
                 ("F37", "Not Acc."), ("H37", 200), ("I37", 300), ("K37", 150),
                 ("F19", "Not Acc."), ("E20", "N/A")):
        put("RTUs", c, v)
    # RTU-2 (1-phase, 208 V): leg-1 volts not accessible, design CFM N/A on its only outlet, OA design N/A
    put(ede, "H8", "N/A")
    for c, v in (("E121", 5.0), ("E123", "Not Acc."), ("F123", 206), ("E124", 4.2),
                 ("F137", 1.5), ("H137", "N/A"), ("K137", 400), ("H155", "Not Avail.")):
        put("RTUs", c, v)
    # RTU-3: coil leaving static not accessible
    put(ede, "B9", "RTU-3")
    for c, v in (("C232", -0.3), ("C233", -0.5), ("E233", "Not Acc."), ("G233", 0.9)):
        put("RTUs", c, v)
    # MAU-1: one PSP reading N/A (another changed so the average shows the skip), filter-grid N/A size / velocity
    for c, v in (("D60", "N/A"), ("E60", 490), ("E65", "N/A"), ("E66", 500), ("F65", '16" x 20"'), ("F66", "Not Acc.")):
        put("MAUs", c, v)
    # MAU-2: profile pressure not accessible, design N/A, method Profile Pressure; MAU-3: housing size N/A
    put(ede, "B53", "MUA-2")
    for c, v in (("D175", 3), ("H175", "Not Acc."), ("E178", "Profile Pressure"), ("K178", "N/A"),
                 ("D279", "N/A"), ("H279", 0.3)):
        put("MAUs", c, v)
    # ERV-1: supply outlet with N/A design, exhaust inlet with N/A Ak; exhaust dP design N/A
    put(ede, "S65", "N/A")
    for c, v in (("F34", 2.0), ("H34", "N/A"), ("K34", 100), ("F44", "Not Avail."), ("H44", 100), ("I44", 300)):
        put("ERVs", c, v)
    # Fans: fan 21 second outlet final velocity N/A; fan 2 inlet static N/A and FLA N/A
    put(ede, "N82", 115)
    for c, v in (("F2114", 1.0), ("H2114", 300), ("K2114", "Not Acc."),
                 ("C128", "N/A"), ("G129", 0.4), ("E121", "N/A"), ("E123", 118)):
        put("Fans", c, v)
    # Small fans: fan 1 outlet with N/A design; fan 2 outlet with N/A Ak
    put(ede, "B234", "EF-S2")
    for c, v in (("F17", 0.5), ("H17", "N/A"), ("I17", 200), ("K17", 220),
                 ("F40", "Not Acc."), ("H40", 90), ("K40", 500)):
        put("Small Fans", c, v)
    # VAVs: VAV-1 second outlet final N/A; VAV-2 max design N/A
    put(ede, "B151", "VAV-2"); put(ede, "I151", "N/A")
    for c, v in (("F18", 0.5), ("H18", 200), ("K18", "N/A")):
        put("VAVs", c, v)
    # Hoods: KH-1 one of three readings N/A (initial and final), a filter with N/A size, a filter with no readings;
    # KH-2 design CFM and length N/A
    for c, v in (("T10", "N/A"), ("Q10", "Not Acc."), ("I15", "N/A"), ("S15", 150),
                 ("I16", '16" x 20"'), ("S16", "Not Acc."), ("T16", "N/A"), ("U16", "Not Avail."),
                 ("E39", "Captrate (VelGrid)"), ("I31", '16" x 20"'), ("S31", 200)):
        put("Hoods", c, v)
    put(ede, "B127", "KH-2"); put(ede, "F127", "N/A"); put(ede, "I127", "Not Avail.")
    # Traverses: T-1 2nd quick-entry reading N/A and initial VEL N/A; T-2 a grid cell typed Not Acc.;
    # T-3 width not accessible
    for c, v in (("P12", "N/A"), ("J7", "Not Acc."), ("D27", "Not Acc."),
                 ("D39", "Rectangular"), ("G39", "N/A"), ("I39", 12), ("J37", 500)):
        put("Traverses", c, v)


def fill_stress(wb):
    """A notation in every empty (non-merged) cell of the unit sheets and of the data-entry rows."""
    notes = cycle(NOTES)
    for name in ("RTUs", "MAUs", "ERVs", "Fans", "Small Fans", "VAVs", "Hoods", "Traverses"):
        ws = wb[name]
        for row in ws.iter_rows(min_row=4, max_row=ws.max_row, min_col=2, max_col=23):
            for c in row:
                if c.value is None and not isinstance(c, MergedCell):
                    c.value = next(notes)
    ws = wb["{Equipment Data Entry}"]
    for row in ws.iter_rows(min_row=7, max_row=ws.max_row, min_col=2, max_col=20):
        for c in row:
            if c.value is None and not isinstance(c, MergedCell):
                c.value = next(notes)
    wb["Equipment Summary"]["E5"] = "N/A"


PROFILE_ROUNDS = ((0.15, 0.2), (0.3, 0.35))


def fill_profile(k):
    def f(wb):
        mu = wb["MAUs"]
        for u in range(10):
            size, p = u % 5 + 1, PROFILE_ROUNDS[k][u // 5]
            mu[f"D{71 + 104 * u}"] = size
            mu[f"H{71 + 104 * u}"] = p
    return f


# ----------------------------------------------------------------------------------------- 0. blank
wb0 = prepared(SRC, "blank")
blank_errors = count_errors(wb0)
check("0 blank", "error cells in the blank template", blank_errors, 0)

# ----------------------------------------------------------------------------------------- A. rev 04 checks
wbA = prepared(SRC, "A05", fill_rev04, fill_report_date)
g = lambda s, c: wbA[s][c].value
r = r4
P = 300 * (96 - 2 - 2) * 12 * 0.88 / 144
REV04_CHECKS = [
    ("RTUs K9 total design (1100 + 100 cont.)", g("RTUs", "K9"), 1200),
    ("RTUs L9 total final (1050 + 90)", g("RTUs", "L9"), 1140),
    ("RTUs M9 %", r(g("RTUs", "M9")), r(1140 / 1200)),
    ("RTUs K10 OA design", g("RTUs", "K10"), 800),
    ("RTUs L10 OA final", g("RTUs", "L10"), 760),
    ("RTUs K11 return design", g("RTUs", "K11"), 400),
    ("RTUs L11 return final", g("RTUs", "L11"), 380),
    ("RTUs H46 RA row design = total - OA", g("RTUs", "H46"), 400),
    ("RTUs L46 RA row final", g("RTUs", "L46"), 380),
    ("RTUs H43 supply total", g("RTUs", "H43"), 1200),
    ("RTUs H98 continuation subtotal (shifted layout)", g("RTUs", "H98"), 100),
    ("RTUs D18 corrected FLA", r(g("RTUs", "D18"), 3), r(460 / ((470 + 465 + 468) / 3) * 7.6, 3)),
    ("RTUs G18 est BHP", r(g("RTUs", "G18"), 3), r(((470 + 465 + 468) / 3) * ((6 + 6.1 + 5.9) / 3) * 0.8 * 0.9 * 1.732 / 746, 3)),
    ("RTUs L12 unit ESP actual", g("RTUs", "L12"), 1.2),
    ("RTUs D24 ent coil = lvg filter", g("RTUs", "D24"), -0.5),
    ("RTUs E24 ent coil (wheel absent) = lvg filter", g("RTUs", "E24"), -0.5),
    ("RTUs G24 fan inlet = lvg coil (heat blank)", r(g("RTUs", "G24"), 3), -0.7),
    ("RTUs E29 fan TSP 0.9-(-0.7)", r(g("RTUs", "E29"), 3), 1.6),
    ("RTUs I29 ESP 0.9-(-0.3)", r(g("RTUs", "I29"), 3), 1.2),
    ("RTUs M29 unit dP inlet->fan", r(g("RTUs", "M29"), 3), -0.4),
    ("RTUs D26 unit type default", g("RTUs", "D26"), "RTU"),
    ("RTUs B27 inlet box label", g("RTUs", "B27"), "RA / OA"),
    ("RTUs F27 wheel box shows dash for RTU", g("RTUs", "F27"), "—"),
    ("RTUs C28 static entering filter", g("RTUs", "C28"), -0.3),
    ("RTUs G28 static after wheel blank (absent)", g("RTUs", "G28"), None),
    ("RTUs I28 static after coil", r(g("RTUs", "I28"), 3), -0.7),
    ("RTUs M28 fan discharge", g("RTUs", "M28"), 0.9),
    ("RTUs D28 filter dP text", g("RTUs", "D28"), "Δ -0.20"),
    ("RTUs D23 component label", g("RTUs", "D23"), "—"),
    ("MAUs D26 unit type default", g("MAUs", "D26"), "MAU"),
    ("MAUs H27 MAU component 3 = Burner", g("MAUs", "H27"), "Burner"),
    ("Fans D26 unit type default", g("Fans", "D26"), "EF"),
    ("Fans G24 fan inlet passes through absent components", r(g("Fans", "G24"), 3), -0.5),
    ("Fans E29 EF TSP 0.3-(-0.5)", r(g("Fans", "E29"), 3), 0.8),
    ("Fans I29 EF ESP", r(g("Fans", "I29"), 3), 0.8),
    ("Fans L10 unit ESP actual = strip ESP", r(g("Fans", "L10"), 3), 0.8),
    ("ERVs F27 ERV component 2 = Core", g("ERVs", "F27"), "Core"),
    ("RTUs C121 phase RTU-2", g("RTUs", "C121"), "1-phase"),
    ("RTUs B121 voltage RTU-2", g("RTUs", "B121"), 208),
    ("RTUs D108 RTU-2 name", g("RTUs", "D108"), "RTU-2"),
    ("RTUs D56 cont. page name", g("RTUs", "D56"), "RTU-1"),
    ("RTUs D212 blank unit", g("RTUs", "D212"), None),
    ("RTUs K218 blank OA design", g("RTUs", "K218"), None),
    ("RTUs M33 %", r(g("RTUs", "M33")), r(400 / 420)),
    ("RTUs M36 blank row", g("RTUs", "M36"), None),
    ("Fans K2089 total design (fan 21)", g("Fans", "K2089"), 500),
    ("Fans L2089 total final", g("Fans", "L2089"), 450),
    ("Fans D2084 name", g("Fans", "D2084"), "EF-21"),
    ("MAUs L33 CFM", g("MAUs", "L33"), 300),
    ("Hoods L10 final vel", g("Hoods", "L10"), 177),
    ("Hoods J10 initial vel avg", g("Hoods", "J10"), 175),
    ("Hoods M10 final CFM", r(g("Hoods", "M10")), r(177 * 1.73 * 1.34)),
    ("Hoods F22 final total (CaptiveAire 2049.2888)", r(g("Hoods", "F22")), 2049.2888),
    ("Hoods H22 %", r(g("Hoods", "H22")), r(2049.2888 / 2000)),
    ("Hoods F23 CFM/ft", r(g("Hoods", "F23"), 2), r(2049.2888 / 8, 2)),
    ("Hoods E11 length", g("Hoods", "E11"), 8),
    ("MAUs M59 PSP K", g("MAUs", "M59"), 0.88),
    ("MAUs E62 PSP CFM", r(g("MAUs", "E62"), 2), r(P, 2)),
    ("MAUs K62 CFM/ft", r(g("MAUs", "K62"), 2), r(P / 8, 2)),
    ("MAUs C67 filter 16x20", r(g("MAUs", "C67"), 2), r(400 * 1.75 * 1.35, 2)),
    ("MAUs D67 filter 12x24", r(g("MAUs", "D67"), 2), r(300 * 1.52 * 1.35, 2)),
    ("MAUs E68 grid total", r(g("MAUs", "E68"), 2), r(400 * 1.75 * 1.35 + 300 * 1.52 * 1.35, 2)),
    ("MAUs K71 profile interp", r(g("MAUs", "K71"), 3), r((697.15 + 805.62) / 2, 3)),
    ("MAUs E75 method total", r(g("MAUs", "E75"), 2), r(P, 2)),
    ("MAUs K9 design from methods", g("MAUs", "K9"), 2100),
    ("MAUs L9 actual = PSP", r(g("MAUs", "L9"), 2), r(P, 2)),
    ("MAUs K1007 profile size2 @0.65", r(g("MAUs", "K1007"), 2), 6589.5),
    ("MAUs L945 unit 10 actual = profile", r(g("MAUs", "L945"), 2), 6589.5),
    ("ERVs K9 supply design", g("ERVs", "K9"), 1500),
    ("ERVs L9 supply final", g("ERVs", "L9"), 700),
    ("ERVs K10 exhaust design", g("ERVs", "K10"), 1400),
    ("ERVs L10 exhaust final", g("ERVs", "L10"), 650),
    ("ERVs K11 supply dP", g("ERVs", "K11"), 0.35),
    ("ERVs K13 fan rpm design", g("ERVs", "K13"), 950),
    ("Building Balance C57 ERV OA design", g("Building Balance", "C57"), 1500),
    ("Building Balance K57 ERV exhaust actual", g("Building Balance", "K57"), 650),
    ("Building Balance C7 RTU-1 OA design", g("Building Balance", "C7"), 800),
    ("Building Balance E7 RTU-1 OA actual", g("Building Balance", "E7"), 760),
    ("Building Balance I27 EF-21 design", g("Building Balance", "I27"), 500),
    ("Cover Page G35 report date blank (moved block)", g("Cover Page", "G35"), None),
    ("Cover Page C31 project name label (moved block)", g("Cover Page", "C32"), "PROJECT NAME"),
    ("Cover Page B9 CERTIFIED (moved up)", g("Cover Page", "B9"), "CERTIFIED"),
    ("Cover Page H49 certification number (moved)", g("Cover Page", "H49"), 3673),
    ("Building Balance C87 OA total (800+2100+1500)", g("Building Balance", "C87"), 4400),
    ("VAVs D4 name", g("VAVs", "D4"), "VAV-1"),
    ("VAVs D6 terminal type", g("VAVs", "D6"), "Pressure Independent"),
    ("VAVs L9 max design", g("VAVs", "L9"), 600),
    ("VAVs M9 max actual = outlet total", g("VAVs", "M9"), 290),
    ("VAVs D13 inlet size", g("VAVs", "D13"), 8),
    ("Traverses M9 point count (rect 24x12 -> 4 x 3, NEBB >=3 at >=12 in)", g("Traverses", "M9"), "4 x 3"),
    ("Traverses H7 free area 24x12", g("Traverses", "H7"), 2.0),
    ("Traverses F7 size text", g("Traverses", "F7"), '24" x 12"'),
    ("Traverses D10 first position (3 in)", g("Traverses", "D10"), 3),
    ("Traverses G10 4th position (21 in)", g("Traverses", "G10"), 21),
    ("Traverses H10 5th position blank", g("Traverses", "H10"), None),
    ("Traverses B11 depth 1 (2 in)", g("Traverses", "B11"), 2),
    ("Traverses B13 depth 3 (10 in)", g("Traverses", "B13"), 10),
    ("Traverses B14 depth 4 blank", g("Traverses", "B14"), None),
    ("Traverses D11 grid(1,1) from quick #1", g("Traverses", "D11"), 480),
    ("Traverses G11 grid(1,4) from quick #4", g("Traverses", "G11"), 492),
    ("Traverses D12 grid(2,1) from quick #5", g("Traverses", "D12"), 496),
    ("Traverses G13 grid(3,4) from quick #12", g("Traverses", "G13"), 524),
    ("Traverses H11 outside grid blank", g("Traverses", "H11"), None),
    ("Traverses D14 row 4 blank (nH=3)", g("Traverses", "D14"), None),
    ("Traverses N9 nW helper", g("Traverses", "N9"), 4),
    ("Traverses N11 total points", g("Traverses", "N11"), 12),
    ("Traverses L7 final vel avg (12 readings)", g("Traverses", "L7"), 502),
    ("Traverses M7 CFM 502 x 2", g("Traverses", "M7"), 1004),
    ("Traverses M24 round 10in -> 8 x 2 axes", g("Traverses", "M24"), "8 x 2 axes"),
    ("Traverses H22 round free area", g("Traverses", "H22"), round(3.14159265 * 25 / 144, 3)),
    ("Traverses D25 round pos 1 (0.323 in)", g("Traverses", "D25"), round(5 * (1 - (7 / 8) ** 0.5), 1)),
    ("Traverses K25 round pos 8 (9.7 in)", g("Traverses", "K25"), round(10 - 5 * (1 - (7 / 8) ** 0.5), 1)),
    ("Traverses L25 pos 9 blank", g("Traverses", "L25"), None),
    ("Traverses B26 axis label", g("Traverses", "B26"), "Axis 1 (0°)"),
    ("Traverses L22 round vel avg (quick entry)", g("Traverses", "L22"), 610),
    ("Traverses D27 axis 2 first reading", g("Traverses", "D27"), 620),
    ("Small Fans D4 name", g("Small Fans", "D4"), "EF-S1"),
    ("Small Fans K8 total design", g("Small Fans", "K8"), 110),
    ("Small Fans L8 total final", g("Small Fans", "L8"), 100),
    ("Small Fans D12 HP", g("Small Fans", "D12"), 0.05),
    ("Small Fans F12 phase", g("Small Fans", "F12"), "1-phase"),
    ("Building Balance H67 small fan name", g("Building Balance", "H67"), "EF-S1"),
    ("Building Balance I67 small fan design", g("Building Balance", "I67"), 110),
    ("Building Balance I87 exhaust total (500+1400+110)", g("Building Balance", "I87"), 2010),
    ("Building Balance H89 design balance (4400-2010)", g("Building Balance", "H89"), 2390),
    ("Equipment Summary B9 RTU-1", g("Equipment Summary", "B9"), "RTU-1"),
    ("Equipment Summary D9 design", g("Equipment Summary", "D9"), 1200),
    ("Equipment Summary E9 actual", g("Equipment Summary", "E9"), 1140),
    ("Equipment Summary M9 status OK (5%)", g("Equipment Summary", "M9"), "OK"),
    ("Equipment Summary G9 OA design", g("Equipment Summary", "G9"), 800),
    ("Equipment Summary L9 amps avg", g("Equipment Summary", "L9"), 6.0),
    ("Equipment Summary B10 RTU-2 (no data)", g("Equipment Summary", "B10"), "RTU-2"),
    ("Equipment Summary M10 status blank", g("Equipment Summary", "M10"), None),
]
for name, got, exp in REV04_CHECKS:
    check("A rev04", name, got, exp)
check("A cover", "Cover Page G32 PROJECT NAME = {Project Information}!E2", g("Cover Page", "G32"), "{ProjectCode}")
check("A cover", "Cover Page G34 PROJECT ADDRESS = {Project Information}!E3", g("Cover Page", "G34"), "{Address}")
check("A cover", "Cover Page G36 REPORT DATE = {Project Information}!E14", g("Cover Page", "G36"), "9/23/26")
check("A rev04", "error cells with the revision 04 sample data", count_errors(wbA), 0)

# identical results to revision 04 with the same data
wbA4 = prepared(REV04, "A04", fill_rev04, fill_report_date)
diffs = []
for ws in wbA.worksheets:
    if ws.title == "{Dropdowns}":
        continue
    ws4 = wbA4[ws.title]
    for row in ws.iter_rows(min_row=1, max_row=max(ws.max_row, ws4.max_row), max_col=max(ws.max_column, ws4.max_column)):
        for c in row:
            if ws.title == "Cover Page" and c.coordinate in ("G32", "G34", "G36"):
                continue
            if ws.title == "Building Balance" and c.coordinate[0] in "HIKM" and 47 <= c.row <= 56:
                continue                                  # new Small Fans 21-30 rows (checked in section E)
            a, b = c.value, ws4[c.coordinate].value
            same = a == b or (isinstance(a, (int, float)) and isinstance(b, (int, float)) and abs(a - b) < 1e-9)
            if not same:
                diffs.append((ws.title, c.coordinate, a, b))
check("A same as rev04", "cells differing from revision 04 with the same data (excl. fixed cover links, {Dropdowns}, Building Balance small fans 21-30)",
      len(diffs), 0)

# ----------------------------------------------------------------------------------------- B. N/A notations
wbB = prepared(SRC, "B05", fill_rev04, fill_na)
g = lambda s, c: wbB[s][c].value
S = "B notations"
b_checks = [
    # RTU-1: all-notation row adds nothing, N/A-Ak row keeps its numeric design only
    ("RTUs G36/J36/L36/M36 blank for the N/A outlet row", [g("RTUs", c) for c in ("G36", "J36", "L36", "M36")], [None] * 4),
    ("RTUs G37 design VEL blank (Ak Not Acc.)", g("RTUs", "G37"), None),
    ("RTUs J37 / L37 CFM blank (Ak Not Acc.)", [g("RTUs", "J37"), g("RTUs", "L37")], [None, None]),
    ("RTUs M37 % blank", g("RTUs", "M37"), None),
    ("RTUs H43 supply design total skips N/A (1200 + 200)", g("RTUs", "H43"), 1400),
    ("RTUs L43 supply final total skips N/A rows", g("RTUs", "L43"), 1140),
    ("RTUs K9 / L9 / M9", [g("RTUs", "K9"), g("RTUs", "L9"), r(g("RTUs", "M9"))], [1400, 1140, r(1140 / 1400)]),
    ("RTUs K11 return design 1400 - 800", g("RTUs", "K11"), 600),
    ("RTUs D18 corrected FLA from volts 470 / 468 (leg 2 Not Acc.)", r(g("RTUs", "D18"), 4), r(460 / 469 * 7.6, 4)),
    ("RTUs G18 BHP from remaining legs (3-phase)", r(g("RTUs", "G18"), 4), r(469 * 6.0 * 0.8 * 0.9 * 1.732 / 746, 4)),
    ("RTUs L12 ESP unchanged", g("RTUs", "L12"), 1.2),
    # RTU-2
    ("RTUs K116 design ESP shows N/A from data entry", g("RTUs", "K116"), "N/A"),
    ("RTUs D122 corrected FLA 1-phase from leg 2 (208/206*5)", r(g("RTUs", "D122"), 4), r(208 / 206 * 5, 4)),
    ("RTUs G122 BHP 1-phase blank (leg-1 volts Not Acc.)", g("RTUs", "G122"), None),
    ("RTUs L137 CFM 400 x 1.5", g("RTUs", "L137"), 600),
    ("RTUs G137 / M137 blank (design N/A)", [g("RTUs", "G137"), g("RTUs", "M137")], [None, None]),
    ("RTUs K113 design total blank, L113 600, M113 blank", [g("RTUs", "K113"), g("RTUs", "L113"), g("RTUs", "M113")], [None, 600, None]),
    ("RTUs K114 OA design blank (OA row design Not Avail.)", g("RTUs", "K114"), None),
    ("RTUs K115 return design blank", g("RTUs", "K115"), None),
    # RTU-3 static profile
    ("RTUs F232 heat entering shows Not Acc.", g("RTUs", "F232"), "Not Acc."),
    ("RTUs H236 coil dP blank", g("RTUs", "H236"), None),
    ("RTUs I236 coil leaving shows Not Acc.", g("RTUs", "I236"), "Not Acc."),
    ("RTUs E237 fan TSP blank (fan inlet unknown)", g("RTUs", "E237"), None),
    ("RTUs I237 ESP 0.9 - (-0.3)", r(g("RTUs", "I237"), 3), 1.2),
    ("RTUs M237 unit dP blank", g("RTUs", "M237"), None),
    ("RTUs L220 unit ESP actual", r(g("RTUs", "L220"), 3), 1.2),
    # MAUs
    ("MAUs E62 PSP CFM, N/A reading skipped (avg 310 of 19)", r(g("MAUs", "E62"), 2), r(310 * 92 * 12 * 0.88 / 144, 2)),
    ("MAUs L9 actual = PSP", r(g("MAUs", "L9"), 2), r(310 * 92 * 12 * 0.88 / 144, 2)),
    ("MAUs E67 filter with N/A size blank (not 0)", g("MAUs", "E67"), None),
    ("MAUs F67 filter with Not Acc. velocity blank", g("MAUs", "F67"), None),
    ("MAUs E68 grid total skips them", r(g("MAUs", "E68"), 2), r(400 * 1.75 * 1.35 + 300 * 1.52 * 1.35, 2)),
    ("MAUs K175 profile CFM blank (pressure Not Acc., not 'too high')", g("MAUs", "K175"), None),
    ("MAUs E179 method total blank", g("MAUs", "E179"), None),
    ("MAUs K113 design shows N/A, L113 blank, M113 blank", [g("MAUs", "K113"), g("MAUs", "L113"), g("MAUs", "M113")], ["N/A", None, None]),
    ("MAUs K279 profile CFM blank (housing N/A)", g("MAUs", "K279"), None),
    # ERVs
    ("ERVs L34 CFM 100 x 2", g("ERVs", "L34"), 200),
    ("ERVs M34 blank", g("ERVs", "M34"), None),
    ("ERVs K9 / L9 / M9 (supply 1500 / 900)", [g("ERVs", "K9"), g("ERVs", "L9"), r(g("ERVs", "M9"))], [1500, 900, 0.6]),
    ("ERVs G44 / J44 blank (Ak Not Avail.)", [g("ERVs", "G44"), g("ERVs", "J44")], [None, None]),
    ("ERVs K10 exhaust design 1400 + 100", g("ERVs", "K10"), 1500),
    ("ERVs L10 exhaust final", g("ERVs", "L10"), 650),
    ("ERVs K12 exhaust dP design shows N/A", g("ERVs", "K12"), "N/A"),
    # Fans
    ("Fans L2114 / M2114 blank (final VEL Not Acc.)", [g("Fans", "L2114"), g("Fans", "M2114")], [None, None]),
    ("Fans K2089 / L2089 / M2089", [g("Fans", "K2089"), g("Fans", "L2089"), r(g("Fans", "M2089"))], [800, 450, r(450 / 800)]),
    ("Fans E133 / I133 blank (inlet static N/A)", [g("Fans", "E133"), g("Fans", "I133")], [None, None]),
    ("Fans L114 unit ESP actual blank", g("Fans", "L114"), None),
    ("Fans D122 corrected FLA blank (FLA N/A)", g("Fans", "D122"), None),
    # Small fans
    ("Small Fans J17 / L17", [g("Small Fans", "J17"), g("Small Fans", "L17")], [100, 110]),
    ("Small Fans G17 / M17 blank (design N/A)", [g("Small Fans", "G17"), g("Small Fans", "M17")], [None, None]),
    ("Small Fans K8 / L8 / M8", [g("Small Fans", "K8"), g("Small Fans", "L8"), r(g("Small Fans", "M8"))], [110, 210, r(210 / 110)]),
    ("Small Fans G40 / L40 blank (Ak Not Acc.)", [g("Small Fans", "G40"), g("Small Fans", "L40")], [None, None]),
    ("Small Fans K32 / L32 / M32", [g("Small Fans", "K32"), g("Small Fans", "L32"), g("Small Fans", "M32")], [90, None, None]),
    # VAVs
    ("VAVs L18 / M18 blank", [g("VAVs", "L18"), g("VAVs", "M18")], [None, None]),
    ("VAVs M9 actual max = 290 (N/A outlet skipped)", g("VAVs", "M9"), 290),
    ("VAVs L35 VAV-2 max design shows N/A", g("VAVs", "L35"), "N/A"),
    # Hoods
    ("Hoods J10 initial avg of 170 / 175 (Q10 Not Acc.)", g("Hoods", "J10"), 172.5),
    ("Hoods K10 initial CFM", r(g("Hoods", "K10")), r(172.5 * 1.73 * 1.34)),
    ("Hoods L10 final avg 177 (T10 N/A)", g("Hoods", "L10"), 177),
    ("Hoods M15 CFM blank for N/A filter size (not 0)", g("Hoods", "M15"), None),
    ("Hoods L16 / M16 blank (all three readings notations)", [g("Hoods", "L16"), g("Hoods", "M16")], [None, None]),
    ("Hoods F22 final total unchanged", r(g("Hoods", "F22")), 2049.2888),
    ("Hoods H22 %", r(g("Hoods", "H22")), r(2049.2888 / 2000)),
    ("Hoods M31 KH-2 CFM", r(g("Hoods", "M31")), r(200 * 1.73 * 1.34)),
    ("Hoods B43 KH-2 design shows N/A", g("Hoods", "B43"), "N/A"),
    ("Hoods H43 / F44 blank (design N/A, length Not Avail.)", [g("Hoods", "H43"), g("Hoods", "F44")], [None, None]),
    # Traverses
    ("Traverses E11 grid shows the N/A quick-entry reading", g("Traverses", "E11"), "N/A"),
    ("Traverses L7 average of the other 11 readings", g("Traverses", "L7"), round((sum(480 + i * 4 for i in range(12)) - 484) / 11)),
    ("Traverses M7 CFM", g("Traverses", "M7"), round(round((sum(480 + i * 4 for i in range(12)) - 484) / 11) * 2.0)),
    ("Traverses K7 initial CFM blank (VEL Not Acc.)", g("Traverses", "K7"), None),
    ("Traverses L22 round average of 15 readings", g("Traverses", "L22"), round((8 * 600 + 7 * 620) / 15)),
    ("Traverses H37 / N39 / M39 / D40 / K37 blank (width N/A)",
     [g("Traverses", c) for c in ("H37", "N39", "M39", "D40", "K37")], [None] * 5),
    # rollups
    ("Equipment Summary D9 / E9 / F9", [g("Equipment Summary", "D9"), g("Equipment Summary", "E9"), r(g("Equipment Summary", "F9"))], [1400, 1140, r(1140 / 1400)]),
    ("Equipment Summary M9 status Check", g("Equipment Summary", "M9"), "Check"),
    ("Equipment Summary L9 amps avg of 6.1 / 5.9", g("Equipment Summary", "L9"), 6.0),
    ("Equipment Summary D10 / E10 / F10 / M10 (RTU-2)", [g("Equipment Summary", c) for c in ("D10", "E10", "F10", "M10")], [None, 600, None, None]),
    ("Equipment Summary I10 design ESP shows N/A", g("Equipment Summary", "I10"), "N/A"),
    ("Building Balance C8 RTU-2 OA design blank", g("Building Balance", "C8"), None),
    ("Building Balance C48 MUA-2 design shows N/A", g("Building Balance", "C48"), "N/A"),
    ("Building Balance G48 blank", g("Building Balance", "G48"), None),
    ("Building Balance C87 OA total skips N/A (800 + 2100 + 1500)", g("Building Balance", "C87"), 4400),
    ("Building Balance I27 EF-21 design", g("Building Balance", "I27"), 800),
    ("Building Balance I57 / K57 ERV exhaust", [g("Building Balance", "I57"), g("Building Balance", "K57")], [1500, 650]),
    ("Building Balance I67 / K67 small fan 1", [g("Building Balance", "I67"), g("Building Balance", "K67")], [110, 210]),
    ("Building Balance I68 / K68 / M68 small fan 2", [g("Building Balance", c) for c in ("I68", "K68", "M68")], [90, None, None]),
    ("Building Balance I87 exhaust total (800 + 1500 + 110 + 90)", g("Building Balance", "I87"), 2500),
    ("Building Balance H89 design balance (4400 - 2500)", g("Building Balance", "H89"), 1900),
]
for name, got, exp in b_checks:
    check(S, name, got, exp)
shown = sum(1 for (sh, c), v in NA_INPUTS.items() if wbB[sh][c].value == v)
check(S, f"notation still shows in all {len(NA_INPUTS)} input cells", shown, len(NA_INPUTS))
check(S, "error cells with notations in the inputs", count_errors(wbB), 0)
wbB4 = prepared(REV04, "B04", fill_rev04, fill_na)
rev04_na_errors = count_errors(wbB4)

# ----------------------------------------------------------------------------------------- C. stress
wbC = prepared(SRC, "C05", fill_rev04, fill_stress)
check("C stress", "error cells with a notation in every empty input cell", count_errors(wbC), 0)
check("C stress", "RTUs K9 still 1200 with notations everywhere else", wbC["RTUs"]["K9"].value, 1200)
check("C stress", "Hoods F22 still 2049.2888", r4(wbC["Hoods"]["F22"].value), 2049.2888)

# ----------------------------------------------------------------------------------------- D. profile curve
w1 = load_workbook(REV01, data_only=True)["{Dropdowns}"]
w5 = load_workbook(SRC)
dd = w5["{Dropdowns}"]
curve_ok = sum(1 for rr in range(1, 13) for cc in range(21, 27) if dd.cell(rr, cc).value == w1.cell(rr, cc).value)
check("D profile", "{Dropdowns} U1:Z12 cells equal revision 01", curve_ok, 72)
check("D profile", "Duct.Shape name -> AF2:AF3 holding Rectangular / Round",
      (w5.defined_names["Duct.Shape"].value, dd["AF2"].value, dd["AF3"].value), ("'{Dropdowns}'!$AF$2:$AF$3", "Rectangular", "Round"))
check("D profile", "Unit.Type name -> AH2:AH6", (w5.defined_names["Unit.Type"].value, [dd[f"AH{i}"].value for i in range(2, 7)]),
      ("'{Dropdowns}'!$AH$2:$AH$6", ["RTU", "DOAS", "MAU", "ERV", "EF"]))
check("D profile", "{Dropdowns} AA1:AD6 cleared", [dd.cell(rr, cc).value for rr in range(1, 7) for cc in range(27, 31)], [None] * 24)
check("D profile", "Airflow.Method -> T2:T5 without Traverse (T6 empty)",
      (w5.defined_names["Airflow.Method"].value, [dd[f"T{i}"].value for i in range(2, 7)]),
      ("'{Dropdowns}'!$T$2:$T$5", ["Outlets", "PSP", "Filter Grid", "Profile Pressure", None]))
for k, (p1, p2) in enumerate(PROFILE_ROUNDS):
    wbD = prepared(SRC, f"D{k}", fill_profile(k))
    for u in range(10):
        size, p = u % 5 + 1, (p1, p2)[u // 5]
        row = [rr for rr in range(2, 13) if abs(w1.cell(rr, 21).value - p) < 1e-9][0]
        exp = w1.cell(row, 21 + size).value
        check("D profile", f"MAUs K{71 + 104 * u} housing {size} @ {p} = rev 01 {exp}", r4(wbD["MAUs"][f"K{71 + 104 * u}"].value, 3), r4(exp, 3))
    check("D profile", f"error cells (round {k + 1})", count_errors(wbD), 0)

# ----------------------------------------------------------------------------------------- E. Building Balance small fans 21-30
def fill_small_21_30(wb):
    ede, sf = wb["{Equipment Data Entry}"], wb["Small Fans"]
    for n, design, final in ((21, 200, 180), (30, 150, 160), (31, 999, 999)):
        ede[f"B{232 + n}"] = f"EF-S{n}"
        row = 4 + 24 * (n - 1) + 12
        sf[f"F{row}"] = 1.0; sf[f"H{row}"] = design; sf[f"K{row}"] = final


wbE = prepared(SRC, "E05", fill_rev04, fill_small_21_30)
bb = wbE["Building Balance"]
S = "E balance"
check(S, "H47 / I47 / K47 / M47 = EF-S21 200 / 180 / 0.9", [bb["H47"].value, bb["I47"].value, bb["K47"].value, r4(bb["M47"].value)],
      ["EF-S21", 200, 180, 0.9])
check(S, "H56 / I56 / K56 = EF-S30 150 / 160", [bb["H56"].value, bb["I56"].value, bb["K56"].value], ["EF-S30", 150, 160])
check(S, "H48:H55 blank (fans 22-29 unused)", [bb[f"H{r}"].value for r in range(48, 56)], [None] * 8)
base = wbA["Building Balance"]["I87"].value
base = base if isinstance(base, (int, float)) else 0
check(S, "I87 exhaust design total = sample total + 200 + 150 (fan 31 not listed)", bb["I87"].value, base + 350)
check(S, "error cells", count_errors(wbE), 0)

# ----------------------------------------------------------------------------------------- F. 24" x 24" supply filter
def fill_grid_24(wb):
    mu = wb["MAUs"]
    mu["C65"] = '24" x 24"'; mu["C66"] = 300


wbF = prepared(SRC, "F05", fill_rev04, fill_grid_24)
dF = load_workbook(SRC)["{Dropdowns}"]
check("F filter 24x24", "{Dropdowns}!H45 key and AP1 source note",
      (dF["H45"].value, str(dF["AP1"].value).startswith("Source: CaptiveAire")), ('Supply Filter (VelGrid)|24" x 24"', True))
check("F filter 24x24", "MAUs C67 = 300 x 3.36 x 1.35", r4(wbF["MAUs"]["C67"].value), r4(300 * 3.36 * 1.35))
check("F filter 24x24", "error cells", count_errors(wbF), 0)

# ----------------------------------------------------------------------------------------- report
bad = [x for x in results if not x[4]]
sections = {}
for sec, *_rest, ok in results:
    t = sections.setdefault(sec, [0, 0]); t[0] += ok; t[1] += 1
for sec, (a, n) in sections.items():
    print(f"  {sec:18s} {a}/{n}")
print(f"{len(results) - len(bad)}/{len(results)} checks passed; blank template {blank_errors} error cells; "
      f"revision 04 with the same notation data: {rev04_na_errors} error cells")
for b in bad:
    print("FAIL", b)
for d in diffs[:20]:
    print("DIFF vs rev04", d)
shutil.rmtree(tmpdir, ignore_errors=True)
sys.exit(1 if bad else 0)
