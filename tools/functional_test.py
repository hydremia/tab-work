"""Functional test for the revised TAB workbook.

    python3 tools/functional_test.py "01 - a2b_Blank_TAB_Workbook <date>.xlsm"

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
ra = wb["RTU Airflow"]
for r, v, h in ((9, 400, 420), (10, 350, 360), (11, 300, 320)):
    ra[f"F{r}"] = 1.0; ra[f"H{r}"] = h; ra[f"K{r}"] = v
ra["F48"] = 2.0; ra["H48"] = 800; ra["K48"] = 380
rd = wb["RTU Data"]
rd["E17"] = 7.6; rd["E19"] = 470; rd["F19"] = 465; rd["G19"] = 468; rd["E20"] = 6.0; rd["F20"] = 6.1; rd["G20"] = 5.9
rd["E24"] = -0.5; rd["E25"] = 0.9; rd["D24"] = -0.3
fa = wb["Fan Airflow"]; fa["F499"] = 1.0; fa["H499"] = 500; fa["K499"] = 450
ma = wb["MAU Airflow"]; ma["F254"] = 1.5; ma["H254"] = 280; ma["K254"] = 200
h = wb["Hoods"]; h["E18"] = "Captrate (VelGrid)"; h["E19"] = "Evergreen VelGrid"
for i, v in enumerate([177, 187, 183, 175, 162]):
    h[f"I{10+i}"] = '16" x 20"'; h[f"S{10+i}"] = v
h["P10"] = 170; h["Q10"] = 180; h["R10"] = 175
ms = wb["MAU Supply Methods"]; ms["D8"] = 96; ms["G8"] = 12; ms["J8"] = 1
for c in "DEFGHIJKLM":
    ms[f"{c}9"] = 300; ms[f"{c}10"] = 300
ms["C14"] = '16" x 20"'; ms["C15"] = 400; ms["D14"] = '12" x 24"'; ms["D15"] = 300
ms["D20"] = 1; ms["H20"] = 0.175
ms["E23"] = "PSP"; ms["K23"] = 2100
ms["D236"] = 2; ms["H236"] = 0.65; ms["E239"] = "Profile Pressure"        # block 10 (anchor 220)
ea = wb["ERV Airflow"]; ea["F9"] = 1; ea["H9"] = 1500; ea["K9"] = 700; ea["F30"] = 1; ea["H30"] = 1400; ea["K30"] = 650
t = wb["Traverses"]; t["H8"] = 2.0
for i, c in enumerate("CDEFGHIJKL"):
    t[f"{c}10"] = 480 + i * 4
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
    ("RTU Data K9 total design", g("RTU Data", "K9"), 1100),
    ("RTU Data L9 total final", g("RTU Data", "L9"), 1050),
    ("RTU Data M9 %", r(g("RTU Data", "M9")), r(1050 / 1100)),
    ("RTU Data K10 OA design", g("RTU Data", "K10"), 800),
    ("RTU Data L10 OA final", g("RTU Data", "L10"), 760),
    ("RTU Data K11 return design", g("RTU Data", "K11"), 300),
    ("RTU Data L11 return final", g("RTU Data", "L11"), 290),
    ("RTU Data D18 corrected FLA", r(g("RTU Data", "D18"), 3), r(460 / ((470 + 465 + 468) / 3) * 7.6, 3)),
    ("RTU Data G18 est BHP", r(g("RTU Data", "G18"), 3), r(((470 + 465 + 468) / 3) * ((6 + 6.1 + 5.9) / 3) * 0.8 * 0.9 * 1.732 / 746, 3)),
    ("RTU Data L12 unit ESP actual", g("RTU Data", "L12"), 1.2),
    ("RTU Data F24 fan TSP", g("RTU Data", "F24"), 1.4),
    ("RTU Data C40 phase RTU-2", g("RTU Data", "C40"), "1-phase"),
    ("RTU Data B40 voltage RTU-2", g("RTU Data", "B40"), 208),
    ("RTU Data D27 RTU-2 name", g("RTU Data", "D27"), "RTU-2"),
    ("RTU Data D53 blank unit", g("RTU Data", "D53"), None),
    ("RTU Data K56 blank OA design", g("RTU Data", "K56"), None),
    ("RTU Airflow M9 %", r(g("RTU Airflow", "M9")), r(400 / 420)),
    ("RTU Airflow M12 blank row", g("RTU Airflow", "M12"), None),
    ("Fan Data K499 total design (block 21)", g("Fan Data (EFs, TFs, etc.)", "K499"), 500),
    ("Fan Data L499 total final", g("Fan Data (EFs, TFs, etc.)", "L499"), 450),
    ("Fan Data D494 name", g("Fan Data (EFs, TFs, etc.)", "D494"), "EF-21"),
    ("MAU Airflow L254 CFM", g("MAU Airflow", "L254"), 300),
    ("Hoods L10 final vel", g("Hoods", "L10"), 177),
    ("Hoods J10 initial vel avg", g("Hoods", "J10"), 175),
    ("Hoods M10 final CFM", r(g("Hoods", "M10")), r(177 * 1.73 * 1.34)),
    ("Hoods F22 final total (CaptiveAire 2049.2888)", r(g("Hoods", "F22")), 2049.2888),
    ("Hoods H22 %", r(g("Hoods", "H22")), r(2049.2888 / 2000)),
    ("Hoods F23 CFM/ft", r(g("Hoods", "F23"), 2), r(2049.2888 / 8, 2)),
    ("Hoods E11 length", g("Hoods", "E11"), 8),
    ("MAU Methods M8 PSP K", g("MAU Supply Methods", "M8"), 0.88),
    ("MAU Methods E11 PSP CFM", r(g("MAU Supply Methods", "E11"), 2), r(P, 2)),
    ("MAU Methods K11 CFM/ft", r(g("MAU Supply Methods", "K11"), 2), r(P / 8, 2)),
    ("MAU Methods C16 filter 16x20", r(g("MAU Supply Methods", "C16"), 2), r(400 * 1.75 * 1.35, 2)),
    ("MAU Methods D16 filter 12x24", r(g("MAU Supply Methods", "D16"), 2), r(300 * 1.52 * 1.35, 2)),
    ("MAU Methods E17 grid total", r(g("MAU Supply Methods", "E17"), 2), r(400 * 1.75 * 1.35 + 300 * 1.52 * 1.35, 2)),
    ("MAU Methods K20 profile interp", r(g("MAU Supply Methods", "K20"), 3), r((697.15 + 805.62) / 2, 3)),
    ("MAU Methods E24 method total", r(g("MAU Supply Methods", "E24"), 2), r(P, 2)),
    ("MAU Data K9 design from methods", g("MAU Data", "K9"), 2100),
    ("MAU Data L9 actual = PSP", r(g("MAU Data", "L9"), 2), r(P, 2)),
    ("MAU Methods K236 profile size2 @0.65 (table top)", r(g("MAU Supply Methods", "K236"), 2), 6589.5),
    ("MAU Data L228 actual (block 10) = profile", r(g("MAU Data", "L228"), 2), 6589.5),
    ("ERV Data K9 supply design", g("ERV Data", "K9"), 1500),
    ("ERV Data L9 supply final", g("ERV Data", "L9"), 700),
    ("ERV Data K10 exhaust design", g("ERV Data", "K10"), 1400),
    ("ERV Data L10 exhaust final", g("ERV Data", "L10"), 650),
    ("ERV Data K11 supply dP", g("ERV Data", "K11"), 0.35),
    ("ERV Data K13 fan rpm design", g("ERV Data", "K13"), 950),
    ("Building Balance C57 ERV OA design", g("Building Balance", "C57"), 1500),
    ("Building Balance K57 ERV exhaust actual", g("Building Balance", "K57"), 650),
    ("Building Balance C7 RTU-1 OA design", g("Building Balance", "C7"), 800),
    ("Building Balance E7 RTU-1 OA actual", g("Building Balance", "E7"), 760),
    ("Building Balance C67 OA total (800+2100+1500)", g("Building Balance", "C67"), 4400),
    ("Building Balance H69 design balance (4400-1900)", g("Building Balance", "H69"), 2500),
    ("VAV Data D4 name", g("VAV Data", "D4"), "VAV-1"),
    ("VAV Data D6 terminal type", g("VAV Data", "D6"), "Pressure Independent"),
    ("VAV Data L9 max design", g("VAV Data", "L9"), 600),
    ("VAV Data D13 inlet size", g("VAV Data", "D13"), 8),
    ("Traverses L8 final vel avg", g("Traverses", "L8"), 498),
    ("Traverses M8 CFM", g("Traverses", "M8"), 996),
    ("Traverses B10 count text", g("Traverses", "B10"), "Profile (10 pts)"),
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
