"""Functional test for the revision 03 TAB workbook (rev 02 checks + small fans, traverse grids, equipment summary).

    python3 tools/functional_test_rev03.py "03 - a2b_Blank_TAB_Workbook <date>.xlsm"

Fills sample data into a temporary copy, recalculates it with LibreOffice (needs
libreoffice-calc; the xlsx skill's recalc.py or plain soffice is used), then
compares 60 computed cells with hand-worked expectations, including the
CaptiveAire hood example (5 x 16x20 Captrate filters -> 2049.29 CFM).
"""
import os
import shutil
import subprocess
import sys
import tempfile

from openpyxl import load_workbook

SRC = sys.argv[1]
tmpdir = tempfile.mkdtemp()
path = os.path.join(tmpdir, "functest.xlsm")
shutil.copy(SRC, path)

wb = load_workbook(path, keep_vba=True)
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
rt = wb["RTUs"]                      # unit 1: page 1 rows 4-55, page 2 rows 56-107
for r, v, h in ((29, 400, 420), (30, 350, 360), (31, 300, 320)):
    rt[f"F{r}"] = 1.0; rt[f"H{r}"] = h; rt[f"K{r}"] = v
rt["F60"] = 1.0; rt["H60"] = 100; rt["K60"] = 90          # continuation-page outlet
rt["F51"] = 2.0; rt["H51"] = 800; rt["K51"] = 380         # outside air row
rt["E17"] = 7.6; rt["E19"] = 470; rt["F19"] = 465; rt["G19"] = 468; rt["E20"] = 6.0; rt["F20"] = 6.1; rt["G20"] = 5.9
rt["E24"] = -0.5; rt["E25"] = 0.9; rt["D24"] = -0.3
fn = wb["Fans"]; fn["F2109"] = 1.0; fn["H2109"] = 500; fn["K2109"] = 450    # fan 21, first outlet
mu = wb["MAUs"]; mu["F29"] = 1.5; mu["H29"] = 280; mu["K29"] = 200
mu["D59"] = 96; mu["G59"] = 12; mu["J59"] = 1                              # PSP on page 2
for c in "DEFGHIJKLM":
    mu[f"{c}60"] = 300; mu[f"{c}61"] = 300
mu["C65"] = '16" x 20"'; mu["C66"] = 400; mu["D65"] = '12" x 24"'; mu["D66"] = 300
mu["D71"] = 1; mu["H71"] = 0.175
mu["E74"] = "PSP"; mu["K74"] = 2100
mu["D1007"] = 2; mu["H1007"] = 0.65; mu["E1010"] = "Profile Pressure"        # unit 10 page 2
h = wb["Hoods"]; h["E18"] = "Captrate (VelGrid)"; h["E19"] = "Evergreen VelGrid"
for i, v in enumerate([177, 187, 183, 175, 162]):
    h[f"I{10+i}"] = '16" x 20"'; h[f"S{10+i}"] = v
h["P10"] = 170; h["Q10"] = 180; h["R10"] = 175
ev = wb["ERVs"]; ev["F29"] = 1; ev["H29"] = 1500; ev["K29"] = 700; ev["F41"] = 1; ev["H41"] = 1400; ev["K41"] = 650
va = wb["VAVs"]; va["F17"] = 1; va["H17"] = 300; va["K17"] = 290
for col, val in zip("BCDEFGHIJ", ["EF-S1", "Toilet 101", "Ceiling", "Greenheck", "SP-A110", 0.05, 115, "1-phase", 110]):
    ede[f"{col}233"] = val
sf = wb["Small Fans"]; sf["F16"] = 1.0; sf["H16"] = 110; sf["K16"] = 100; sf["K12"] = 3.0; sf["L9"] = 0.25
t = wb["Traverses"]                      # traverse 1 rows 5-19, traverse 2 rows 20-34
t["D9"] = "Rectangular"; t["G9"] = 24; t["I9"] = 12; t["K9"] = 0
for i, c in enumerate("DEFG"):
    t[f"{c}11"] = 480 + i * 4; t[f"{c}12"] = 500 + i * 4          # 4 x 2 grid, avg 498
t["D24"] = "Round"; t["G24"] = 10
for i, c in enumerate("DEFGHIJK"):
    t[f"{c}26"] = 600; t[f"{c}27"] = 620                          # 8 x 2 axes, avg 610
wb.save(path)

# recalculate
skill = [d for d in subprocess.run("ls -d /root/.claude/skills/synced/*/xlsx/scripts/recalc.py 2>/dev/null", shell=True, capture_output=True, text=True).stdout.split()]
if skill:
    subprocess.run([sys.executable, skill[0], path, "600"], capture_output=True, text=True)
else:
    subprocess.run(["soffice", "--headless", "--convert-to", "xlsm", "--outdir", tmpdir, path], capture_output=True, text=True, timeout=900)

wb = load_workbook(path, data_only=True)
g = lambda s, c: wb[s][c].value
r = lambda x, n=4: round(x, n) if isinstance(x, (int, float)) else x
P = 300 * (96 - 2 - 2) * 12 * 0.88 / 144
checks = [
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
    ("RTUs H94 continuation subtotal", g("RTUs", "H94"), 100),
    ("RTUs D18 corrected FLA", r(g("RTUs", "D18"), 3), r(460 / ((470 + 465 + 468) / 3) * 7.6, 3)),
    ("RTUs G18 est BHP", r(g("RTUs", "G18"), 3), r(((470 + 465 + 468) / 3) * ((6 + 6.1 + 5.9) / 3) * 0.8 * 0.9 * 1.732 / 746, 3)),
    ("RTUs L12 unit ESP actual", g("RTUs", "L12"), 1.2),
    ("RTUs F24 fan TSP", g("RTUs", "F24"), 1.4),
    ("RTUs C121 phase RTU-2", g("RTUs", "C121"), "1-phase"),
    ("RTUs B121 voltage RTU-2", g("RTUs", "B121"), 208),
    ("RTUs D108 RTU-2 name", g("RTUs", "D108"), "RTU-2"),
    ("RTUs D56 cont. page name", g("RTUs", "D56"), "RTU-1"),
    ("RTUs D212 blank unit", g("RTUs", "D212"), None),
    ("RTUs K218 blank OA design", g("RTUs", "K218"), None),
    ("RTUs M29 %", r(g("RTUs", "M29")), r(400 / 420)),
    ("RTUs M32 blank row", g("RTUs", "M32"), None),
    ("Fans K2089 total design (fan 21)", g("Fans", "K2089"), 500),
    ("Fans L2089 total final", g("Fans", "L2089"), 450),
    ("Fans D2084 name", g("Fans", "D2084"), "EF-21"),
    ("MAUs L29 CFM", g("MAUs", "L29"), 300),
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
    ("Traverses L7 final vel avg (8 readings)", g("Traverses", "L7"), 496),
    ("Traverses M7 CFM 496 x 2", g("Traverses", "M7"), 992),
    ("Traverses M24 round 10in -> 8 x 2 axes", g("Traverses", "M24"), "8 x 2 axes"),
    ("Traverses H22 round free area", g("Traverses", "H22"), round(3.14159265*25/144, 3)),
    ("Traverses D25 round pos 1 (0.323 in)", g("Traverses", "D25"), round(5*(1-(7/8)**0.5), 1)),
    ("Traverses K25 round pos 8 (9.7 in)", g("Traverses", "K25"), round(10 - 5*(1-(7/8)**0.5), 1)),
    ("Traverses L25 pos 9 blank", g("Traverses", "L25"), None),
    ("Traverses B26 axis label", g("Traverses", "B26"), "Axis 1 (0°)"),
    ("Traverses L22 round vel avg", g("Traverses", "L22"), 610),
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
    ("Cover G26 report date blank", g("Cover Page", "G26"), None),
]
bad = []
for name, got, exp in checks:
    ok = (got == exp) or (isinstance(got, (int, float)) and isinstance(exp, (int, float)) and abs(got - exp) < 1e-6)
    if not ok:
        bad.append((name, got, exp))
ERRS = ("#VALUE!", "#DIV/0!", "#REF!", "#NAME?", "#N/A", "#NUM!", "#NULL!", "Err:")
errs = sum(1 for ws in wb.worksheets for row in ws.iter_rows() for c in row if isinstance(c.value, str) and c.value.startswith(ERRS))
print(f"{len(checks) - len(bad)}/{len(checks)} checks passed; {errs} error cells after recalculation")
for b in bad:
    print("FAIL", b)
shutil.rmtree(tmpdir, ignore_errors=True)
sys.exit(1 if bad or errs else 0)
