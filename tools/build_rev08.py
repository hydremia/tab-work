"""Revision 08 = revision 07 with the static pressure profile in each unit's real component order (docs/TRACKER.md,
"Template revision 08"; research doc "Unit Static Profile Component Order: Research Findings").

Packaged rooftop units and DOAS put the heat AFTER the supply fan (blow-through heat), reheat coils right after the
cooling coil, and desiccant dehumidifiers the wheel after the coil; the revision 05-07 strip drew every unit as
Filter, Wheel / Core, Coil, Heat / Burner, Fan (5 fixed components, fan last). Revision 08:

     (DOAS: the wheel downstream of the coil, as on the Addison DOAS a technician found pulling water off the coil
     into the wheel; an energy-recovery wheel ahead of the coil is a unit configuration in the app's library)
  1. unit_profile   RTUs / MAUs / ERVs / Fans, every block (rows P+19 ... P+25, P = block anchor):
                      P+19  B: inlet label, C:H: components 1-6 for the unit type ({Dropdowns} AH1:AO7)
                      P+20  B: entering static (typed), C:H: leaving static of components 1-6 (typed), in airflow order
                      P+21  C:H: "Δ x.xx" = this reading - the reading just before it (an absent "—" component is
                            skipped; an unmeasured one leaves the next Δ blank)
                      P+22  unit type (D, unchanged) and the caption
                      P+23  fan inlet (the last reading before the fan) and discharge (the last reading) with labels
                      P+24  (the rev 05-07 strip, cleared)
                      P+25  Fan TSP (E) = first number at / after the fan (its own leaving static, else past a
                            blow-through heat section the discharge) - fan inlet; ESP (I, "Unit ESP actual" reads
                            it) = discharge - entering; Unit ΔP (M) = fan inlet - entering. A notation (N/A, Not
                            Avail., Not Acc.) where a result needs a number blanks the result, as before.
                    Helper formulas sit outside the print area (columns P:Y of rows P+20 ... P+22). The "—" greying is
                    redone for the six columns.
  2. dropdowns      {Dropdowns} AH1:AO7: unit types RTU, DOAS, DHU (new), MAU, ERV, EF with up to 6 components:
                      RTU   RA / OA  Filter  Coil      Reheat    Fan     Heat    —
                      DOAS  OA       Filter  Coil      Wheel     Reheat  Fan     Heat
                      DHU   OA       Filter  Coil      Desiccant Fan     Heat    —
                      MAU   OA       Filter  Burner    Fan       —       —       —
                      ERV   OA / EA  Filter  Core      Fan       —       —       —
                      EF    Inlet    Fan     —         —         —       —       —
                    Unit.Type = AH2:AH7; a2b.TemplateRevision = "08"

    TAB_BUILD_DATE=10-12-26 python3 tools/build_rev08.py      # newest 07 file -> 08 - a2b_Blank_TAB_Workbook <date>.xlsm
"""
import datetime as dt
import glob
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(__file__))
from sheetxml import Sheet, _expand  # noqa: E402
from xlsm_parts import _sheet_files  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAMP = os.environ.get("TAB_BUILD_DATE", dt.date.today().strftime("%-m-%-d-%y"))
OUT = os.path.join(ROOT, f"08 - a2b_Blank_TAB_Workbook {STAMP}.xlsm")

UNIT_SHEETS = {"RTUs": 40, "MAUs": 10, "ERVs": 10, "Fans": 40}
STRIDE = 104
DASH = "—"
SLOTS = ["C", "D", "E", "F", "G", "H"]  # components 1-6
# helpers, outside the print area (A:N): P = the entering static ("component 0"), Q:V = components 1-6
HELP = ["Q", "R", "S", "T", "U", "V"]

UNIT_TYPES = [
    ("RTU", "RA / OA", ["Filter", "Coil", "Reheat", "Fan", "Heat", DASH]),
    ("DOAS", "OA", ["Filter", "Coil", "Wheel", "Reheat", "Fan", "Heat"]),
    ("DHU", "OA", ["Filter", "Coil", "Desiccant", "Fan", "Heat", DASH]),
    ("MAU", "OA", ["Filter", "Burner", "Fan", DASH, DASH, DASH]),
    ("ERV", "OA / EA", ["Filter", "Core", "Fan", DASH, DASH, DASH]),
    ("EF", "Inlet", ["Fan", DASH, DASH, DASH, DASH, DASH]),
]
TABLE = "'{Dropdowns}'!$AI$2:$AO$7"
TYPES = "'{Dropdowns}'!$AH$2:$AH$7"


def anchors(n):
    return [4 + STRIDE * i for i in range(n)]


def drop_conditionals(sh, cells):
    """Remove every conditional format whose range touches one of `cells`; returns the dxf ids they used."""
    dxfs = []

    def fix(m):
        if _expand(m.group(1)) & cells:
            dxfs.extend(re.findall(r'dxfId="(\d+)"', m.group(0)))
            return ""
        return m.group(0)
    sh.tail = re.sub(r'<conditionalFormatting sqref="([^"]+)"[^>]*>.*?</conditionalFormatting>', fix, sh.tail,
                     flags=re.S)
    return dxfs


# ------------------------------------------------------------------------------------------ 1: unit profile
def unit_profile(sheets, log):
    for name, cap in UNIT_SHEETS.items():
        sh = sheets[name]
        for P in anchors(cap):
            L, R, D, U, S1, S2, T = (P + k for k in (19, 20, 21, 22, 23, 24, 25))
            ut = f"$D${U}"
            # the revision 07 layout this step replaces
            assert sh.value(f"B{R}") == "Ent." and sh.value(f"B{D}") == "Lvg.", (name, P)
            assert sh.value(f"C{L}").startswith("=IFERROR(INDEX('{Dropdowns}'!$AI$2:$AN$6"), (name, P)
            assert sh.value(f"D{U}") is not None and sh.value(f"B{T}") == "Fan TSP", (name, P)
            for c in ("E", "I", "M"):
                assert sh.value(f"{c}{T}").startswith("=IF(OR("), (name, P, c)
            st_label = sh.style(f"C{L}")
            st_input = sh.style(f"C{D}")
            st_head = sh.style(f"B{R}")
            st_delta = sh.style(f"D{S2}")
            st_res_label, st_res = sh.style(f"B{T}"), sh.style(f"E{T}")
            # old conditional formats (the "—" greying of rows P+20 / P+21 and the strip labels)
            old = {f"{c}{r}" for r in (R, D, S1) for c in "BCDEFGHIJKLM"}
            dxfs = drop_conditionals(sh, old)
            assert dxfs, (name, P)
            grey = dxfs[-1]
            # clear rows P+19 ... P+21 and the strip (P+23 / P+24), B:H / B:M
            for r in (L, R, D):
                for c in "BCDEFGH":
                    sh.delete(f"{c}{r}")
            for r in (S1, S2):
                for c in "BCDEFGHIJKLM":
                    sh.delete(f"{c}{r}")
            # P+19: inlet label and components 1-6
            idx = lambda k: f'IFERROR(INDEX({TABLE},MATCH({ut},{TYPES},0),{k}),"")'  # noqa: E731
            sh.formula(f"B{L}", idx(1), style=st_label)
            for k, c in enumerate(SLOTS, start=1):
                sh.formula(f"{c}{L}", idx(k + 1), style=st_label)
            # P+20: the readings (typed): B entering, C:H leaving static of components 1-6
            for c in ["B"] + SLOTS:
                sh.blank(f"{c}{R}", style=st_input)
            # helpers: Q:V row P+20 = the reading just before component k ("—" components skipped, an unmeasured
            # one leaves it blank); row P+21 = the first number at / after k; row P+22 = the last reading at / before k
            # (P = the entering static). Readings are numbers or notations; "" is no reading.
            for k, (c, h) in enumerate(zip(SLOTS, HELP)):
                if k == 0:
                    sh.formula(f"{h}{R}", f'IF(B{R}="","",B{R})', style=None)
                else:
                    pc, ph = SLOTS[k - 1], HELP[k - 1]
                    sh.formula(f"{h}{R}", f'IF({pc}{L}="{DASH}",{ph}{R},IF({pc}{R}="","",{pc}{R}))', style=None)
            for k in range(5, -1, -1):
                c, h = SLOTS[k], HELP[k]
                nxt = '""' if k == 5 else f"{HELP[k + 1]}{D}"
                # a notation is skipped here: a fan leaving static marked Not Acc. (blow-through units) gives way to the
                # discharge past the heat section
                sh.formula(f"{h}{D}", f'IF(OR({c}{R}="",ISTEXT({c}{R})),{nxt},{c}{R})', style=None)
            sh.formula(f"P{U}", f'IF(B{R}="","",B{R})', style=None)
            for k, (c, h) in enumerate(zip(SLOTS, HELP)):
                prev = "P" if k == 0 else HELP[k - 1]
                sh.formula(f"{h}{U}", f'IF({c}{R}="",{prev}{U},{c}{R})', style=None)
            # W: the fan's column (1-6); X: fan inlet (last reading before the fan); Y: the first reading at / after the
            # fan (the fan's own leaving static, else the discharge past a blow-through heat section)
            sh.formula(f"W{R}", f'IFERROR(MATCH("Fan",$C${L}:$H${L},0),"")', style=None)
            sh.formula(f"X{R}", f'IF(W{R}="","",INDEX(P{U}:U{U},W{R}))', style=None)
            sh.formula(f"Y{R}", f'IF(W{R}="","",INDEX(Q{D}:V{D},W{R}))', style=None)
            # P+21: Δ of each component (this reading - the reading just before it)
            sh.text(f"B{D}", "Δ", style=st_head)
            for c, h in zip(SLOTS, HELP):
                sh.formula(f"{c}{D}", (f'IF(OR({c}{L}="{DASH}",{c}{R}="",{h}{R}=""),"",'
                                       f'IF(OR(ISTEXT({c}{R}),ISTEXT({h}{R})),"","Δ "&TEXT({c}{R}-{h}{R},"0.00")))'),
                           style=st_delta)
            # P+22: caption
            sh.text(f"F{U}", "Airflow left to right. Δ = this reading minus the one before it; in. w.g.")
            # P+23: fan inlet and discharge
            sh.text(f"B{S1}", "Fan inlet", style=st_res_label)
            sh.formula(f"D{S1}", f'IF(X{R}="","",X{R})', style=st_res)
            sh.text(f"F{S1}", "Discharge", style=st_res_label)
            sh.formula(f"I{S1}", f'IF(V{U}="","",V{U})', style=st_res)
            sh.merge(f"B{S1}:C{S1}")
            sh.merge(f"F{S1}:H{S1}")
            # P+25: TSP / ESP / Unit ΔP
            sh.formula(f"E{T}", f'IF(OR(X{R}="",Y{R}=""),"",IF(OR(ISTEXT(X{R}),ISTEXT(Y{R})),"",Y{R}-X{R}))')
            sh.formula(f"I{T}", f'IF(OR(B{R}="",V{U}=""),"",IF(OR(ISTEXT(B{R}),ISTEXT(V{U})),"",V{U}-B{R}))')
            sh.formula(f"M{T}", f'IF(OR(B{R}="",X{R}=""),"",IF(OR(ISTEXT(B{R}),ISTEXT(X{R})),"",X{R}-B{R}))')
            # "—" components: their reading and Δ greyed
            for c in SLOTS:
                sh.add_conditional(f"{c}{R}:{c}{D}", f'${c}${L}="{DASH}"', grey)
        log.append(f"  {name}: {cap} blocks: profile P+19 labels B:H (inlet + 6 components), P+20 readings B:H, P+21 Δ C:H,"
                   " P+23 fan inlet / discharge, P+25 TSP / ESP / Unit ΔP from the fan's column; helpers P:Y")


# ------------------------------------------------------------------------------------------ 2: unit types, revision
def dropdowns(sheets, wb, log):
    sh = sheets["{Dropdowns}"]
    assert sh.value("AH1") == "Unit Type" and sh.value("AN1") == "Component 5" and sh.value("AO1") is None
    assert sh.value("AH7") is None
    style_head, style_cell = sh.style("AN1"), sh.style("AN2")
    sh.text("AO1", "Component 6", style=style_head)
    for i, (t, inlet, comps) in enumerate(UNIT_TYPES, start=2):
        sh.text(f"AH{i}", t, style=style_cell)
        sh.text(f"AI{i}", inlet, style=style_cell)
        for c, v in zip(["AJ", "AK", "AL", "AM", "AN", "AO"], comps):
            sh.text(f"{c}{i}", v, style=style_cell)
    n = wb.count("'{Dropdowns}'!$AH$2:$AH$6")
    assert n == 1, n
    wb = wb.replace("'{Dropdowns}'!$AH$2:$AH$6", "'{Dropdowns}'!$AH$2:$AH$7", 1)
    wb, n = re.subn(r'(<definedName name="a2b\.TemplateRevision"[^>]*>)"07"(</definedName>)', r'\g<1>"08"\2', wb)
    assert n == 1
    log.append("  {Dropdowns}: unit types AH1:AO7 (RTU, DOAS, DHU new, MAU, ERV, EF; 6 components, fan mid-profile);"
               " Unit.Type AH2:AH7; a2b.TemplateRevision = \"08\"")
    return wb


# ------------------------------------------------------------------------------------------ build
def newest_rev07():
    files = sorted(glob.glob(os.path.join(ROOT, "07 - a2b_Blank_TAB_Workbook *.xlsm")), key=os.path.getmtime)
    if not files:
        sys.exit("no revision 07 workbook found")
    return files[-1]


EDITED = ("RTUs", "MAUs", "ERVs", "Fans", "{Dropdowns}")


def build(src, out, log):
    with zipfile.ZipFile(src) as zin:
        parts = _sheet_files(zin)
        sheets = {t: Sheet(zin.read(parts[t][0]).decode("utf-8")) for t in EDITED}
        wb = zin.read("xl/workbook.xml").decode("utf-8")
        unit_profile(sheets, log)
        wb = dropdowns(sheets, wb, log)
        new = {parts[t][0]: sheets[t].xml() for t in EDITED}
        for t in EDITED:
            assert "$AI$2:$AN$6" not in new[parts[t][0]], t
        new["xl/workbook.xml"] = wb
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = new[item.filename].encode("utf-8") if item.filename in new else zin.read(item.filename)
                zout.writestr(item, data)
    log.append(f"  parts rewritten: {', '.join(sorted(new))}; every other part copied unchanged")


if __name__ == "__main__":
    log = []
    if len(sys.argv) == 3:
        src, out = sys.argv[1], sys.argv[2]
    else:
        src, out = newest_rev07(), OUT
    log.append(f"Source: {os.path.basename(src)}")
    log.append(f"Output: {os.path.basename(out)}")
    build(src, out, log)
    if len(sys.argv) != 3:
        with open(os.path.join(ROOT, "docs", "build-log-rev08.txt"), "w") as fh:
            fh.write("\n".join(log) + "\n")
    print("\n".join(log))
