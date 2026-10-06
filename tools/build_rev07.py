"""Revision 07 = revision 06 with the cells the app needed (docs/TRACKER.md, "Template revision 07", items 1-9).

Revision 07 is the first revision since 05 that adds and moves cells; the app keeps a map of each layout (rev 05 / 06
and rev 07) so issued rev 05 / 06 workbooks still import and re-issue. Every step edits the sheet XML directly
(tools/sheetxml.py): VBA, drawings, styles, print setup and every untouched cell are copied byte-for-byte.

  1. unit_drive_rows     RTUs / MAUs / ERVs / Fans: drive rows "Motor sheave | Bore" and "Fan pulley | Bore" (the
                         sheave / pulley from {Equipment Data Entry} as before, the two bores typed beside them); the
                         "Shv Bore M/F" box at the top of the page removed
  2. unit_motor_hp       a "Motor HP (nameplate)" line under the measured amperage (E P+17)
  3. unit_bhp            Estimated BHP = HP x average measured amps / FLA (nameplate HP when entered, else the
                         scheduled HP; corrected FLA when it can be calculated, else the nameplate FLA), replacing
                         V x A x 0.8 x 0.9 (x 1.732) / 746
  4. mau_page2           MAUs continuation page: PSP initial + final readings (each with its CFM), Filter Grid initial
                         + final velocity per filter (each with its CFM and total), an Intake Screens table (4 screens,
                         VEL x Ak, initial / final) and "Intake" in the method list and the Method Total; the outlet
                         rows on this page go from 22 to 12 (supply capacity 38 -> 28)
  5. fans_hood_line      Fans: the last outlet row on page 1 is a "measured at hood" line (the hoods, design /
                         initial / final CFM, in the fan's totals); outlet capacity 56 -> 55
  6. balance_exclusions  Building Balance: an Excl. flag per unit row (columns P / Q, outside the print area); the
                         row's % shows "Excl.", the row is greyed and the totals leave it out; the reason on a fourth
                         line under the notes (row 105)
  7. summary_observations Summary - New / (E): an Observations list (20 lines, rows 66-85) on the page after the
                         deficiencies
  8. traverse_flat_oval  Traverses: "Flat Oval" in the duct shapes (NEBB 2019 6.3.3h): the flat part as a rectangle
                         (W - H) x H with the rectangular rules, the two ends as one round of diameter H on the
                         horizontal axis (6 / 8 / 10 points, half at each end), CFM per part, added
  9. dropdowns           Airflow.Method + Intake, Duct.Shape + Flat Oval; the revision name a2b.TemplateRevision = "07"

    TAB_BUILD_DATE=10-6-26 python3 tools/build_rev07.py      # newest 06 file -> 07 - a2b_Blank_TAB_Workbook <date>.xlsm
"""
import datetime as dt
import glob
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(__file__))
from sheetxml import Sheet, cols, col_letter, col_num, shift_row_refs  # noqa: E402
from xlsm_parts import _sheet_files  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAMP = os.environ.get("TAB_BUILD_DATE", dt.date.today().strftime("%-m-%-d-%y"))
OUT = os.path.join(ROOT, f"07 - a2b_Blank_TAB_Workbook {STAMP}.xlsm")

UNIT_SHEETS = {"RTUs": 40, "MAUs": 10, "ERVs": 10, "Fans": 40}
STRIDE = 104
EDE = "'{Equipment Data Entry}'"


def anchors(n):
    return [4 + STRIDE * i for i in range(n)]


# ------------------------------------------------------------------------------------------ 1-3: unit blocks
def unit_blocks(sheets, log):
    for name, cap in UNIT_SHEETS.items():
        sh = sheets[name]
        for P in anchors(cap):
            r2, r12, r13, r14, r15, r17 = P + 2, P + 12, P + 13, P + 14, P + 15, P + 17
            # 1. the top-of-page "Shv Bore M/F:" box goes
            assert sh.value(f"K{r2}") == "Shv Bore M/F:", (name, P, sh.value(f"K{r2}"))
            for c in ("K", "L", "M"):
                sh.delete(f"{c}{r2}")
            # drive rows: label I:J, sheave / pulley K (from the data entry), "Bore" L, bore M (typed)
            value_style = sh.style(f"K{P + 5}")  # the design Total Airflow cell (on every unit sheet)
            for r, label in ((r12, "Motor sheave"), (r13, "Fan pulley")):
                old = sh.value(f"L{r}")
                assert old and old.startswith("=IF(" + EDE), (name, r, old)
                sh.unmerge(f"I{r}:K{r}")
                sh.unmerge(f"L{r}:M{r}")
                sh.text(f"I{r}", label)
                sh.merge(f"I{r}:J{r}")
                sh.formula(f"K{r}", old, style=value_style)
                sh.text(f"L{r}", "Bore", style=sh.style(f"E{P + 12}"))
                sh.blank(f"M{r}", style=sh.style(f"G{P + 13}"))
            # 2. Motor HP (nameplate) under the measured amperage: label B:D, value E:G
            assert all(sh.value(f"{c}{r17}") is None for c in "BCDEFG"), (name, r17)
            for c in "BCD":
                sh.blank(f"{c}{r17}", style=sh.style(f"{c}{r15}"))
            sh.text(f"B{r17}", "Motor HP (nameplate)", style=sh.style(f"B{r15}"))
            sh.merge(f"B{r17}:D{r17}")
            for c in "EFG":
                sh.blank(f"{c}{r17}", style=sh.style(f"E{r15}"))
            sh.merge(f"E{r17}:G{r17}")
            # 3. Estimated BHP = HP x avg amps / FLA
            amps = f"E{P + 16}:G{P + 16}"
            hp = f"IF(N(E{r17})>0,E{r17},N(D{r12}))"
            fla = f"IF(N(D{r14})>0,D{r14},N(E{r13}))"
            sh.formula(f"G{r14}", f'IF(OR(COUNT({amps})=0,{hp}=0,{fla}=0),"",{hp}*AVERAGE({amps})/{fla})')
        log.append(f"  {name}: {cap} blocks: drive rows with motor / fan bore (M P+12 / M P+13), Shv Bore M/F box removed,"
                   f" Motor HP (nameplate) E P+17, Estimated BHP = HP x amps / FLA")


# ------------------------------------------------------------------------------------------ 4: MAU page 2
def remap_formula(f, rows):
    """Same-sheet references to the given rows move (old row -> new row); other sheets' references are left."""
    def fix(m):
        if m.group(1):
            return m.group(0)
        r = int(m.group(3))
        return f"{m.group(2)}{rows.get(r, r)}"
    return re.sub(r"('[^']*'!|\b[A-Za-z_][\w.]*!)?(\$?[A-Z]{1,2}\$?)(\d+)(?![\d(])", fix, f)


def mau_page2(sheets, log):
    sh = sheets["MAUs"]
    for P in anchors(UNIT_SHEETS["MAUs"]):
        Q = P + 52
        old = {k: sh.row_cells(Q + k) for k in range(2, 48)}
        attrs = {k: sh.row_attrs(Q + k) for k in range(2, 48)}
        assert sh.value(f"B{Q + 4}") == "Vel 1-10" and sh.value(f"B{Q + 23}") == "Supply Air Outlets (cont.)", P

        def cells_of(k, new_row, text=None, refs=None):
            """Old row Q+k's cells at row new_row (formula row numbers moved by `refs`, B text replaced)."""
            out = {}
            for c, x in old[k].items():
                x = re.sub(r'\br="([A-Z]+)\d+"', lambda m: f'r="{m.group(1)}{new_row}"', x, count=1)
                if refs:
                    x = re.sub(r"<f>(.*?)</f>", lambda m: "<f>" + remap_formula(m.group(1), refs) + "</f>", x, flags=re.S)
                out[c] = x
            sh.set_row_cells(new_row, out, attrs[k])
            if text is not None:
                sh.text(f"B{new_row}", text)

        sh.unmerge_rows(Q + 2, Q + 46)
        for r in range(Q + 4, Q + 47):
            sh.clear_row(r)
        R = lambda k: Q + k  # noqa: E731

        # PSP: initial and final readings, a CFM for each
        cells_of(4, R(4), "Initial 1-10")
        cells_of(5, R(5), "Initial 11-20")
        cells_of(4, R(6), "Final 1-10")
        cells_of(5, R(7), "Final 11-20")
        cells_of(6, R(8), "PSP CFM initial")
        L, W, B, K = f"D{R(3)}", f"G{R(3)}", f"J{R(3)}", f"M{R(3)}"

        def psp(r1, r2):
            v = f"D{r1}:M{r2}"
            return (f'IF(OR({L}="",{W}="",COUNT({v})=0),"",IF(OR(ISTEXT({L}),ISTEXT({W})),"",'
                    f"AVERAGE({v})*({L}-2-2*N({B}))*{W}*N({K})/144))")
        sh.formula(f"E{R(8)}", psp(R(4), R(5)))
        sh.text(f"H{R(8)}", "PSP CFM final")
        sh.formula(f"K{R(8)}", psp(R(6), R(7)))
        for m in ("B{}:D{}", "E{}:G{}", "H{}:J{}", "K{}:M{}"):
            sh.merge(m.format(R(8), R(8)))
        sh.clear_row(R(9))

        # Filter Grid: size, initial and final velocity, a CFM row for each, totals
        cells_of(8, R(10))
        cells_of(9, R(11))
        cells_of(10, R(12), "Initial velocity (fpm)")
        cells_of(10, R(13), "Final velocity (fpm)")
        cells_of(11, R(14), "CFM init", {Q + 9: R(11), Q + 10: R(12)})
        cells_of(11, R(15), "CFM fin.", {Q + 9: R(11), Q + 10: R(13)})
        cells_of(6, R(16), "Total CFM initial")
        sh.formula(f"E{R(16)}", f'IF(SUM(C{R(14)}:M{R(14)})=0,"",SUM(C{R(14)}:M{R(14)}))')
        sh.text(f"H{R(16)}", "Total CFM final")
        sh.formula(f"K{R(16)}", f'IF(SUM(C{R(15)}:M{R(15)})=0,"",SUM(C{R(15)}:M{R(15)}))')
        for m in ("B{0}:D{0}", "E{0}:G{0}", "H{0}:J{0}", "K{0}:M{0}"):
            sh.merge(m.format(R(16)))
        sh.merge(f"B{R(10)}:M{R(10)}")
        sh.clear_row(R(17))

        # burner profile pressure (moved down)
        cells_of(14, R(18))
        cells_of(15, R(19), None, {Q + 15: R(19)})
        sh.merge(f"B{R(18)}:M{R(18)}")
        for m in ("B{0}:C{0}", "E{0}:G{0}", "I{0}:J{0}", "K{0}:M{0}"):
            sh.merge(m.format(R(19)))
        sh.clear_row(R(20))

        # Intake screens: No. | Size | Ak | Initial VEL, CFM | Final VEL, CFM (4 screens and a total)
        cells_of(23, R(21), "Intake Screens: CFM = VEL × Ak")
        for c in ("G", "H", "M"):
            sh.text(f"{c}{R(21)}", "")
        cells_of(24, R(22))
        sh.text(f"C{R(22)}", "Size")
        for c in ("D", "E"):
            sh.blank(f"{c}{R(22)}", style=sh.style(f"C{R(22)}"))
        sh.merge(f"B{R(21)}:F{R(21)}")
        sh.merge(f"G{R(21)}:H{R(22)}")
        sh.merge(f"I{R(21)}:J{R(21)}")
        sh.merge(f"K{R(21)}:L{R(21)}")
        sh.merge(f"M{R(21)}:M{R(22)}")
        sh.merge(f"C{R(22)}:E{R(22)}")
        first_outlet = Q + 25
        for i in range(4):
            r = R(23 + i)
            sh.set_row_cells(r, {c: shift_row_refs(x, first_outlet, r) for c, x in old[25].items()}, attrs[25])
            sh.blank(f"D{r}", style=sh.style(f"C{r}"))
            sh.blank(f"G{r}", style=sh.style(f"H{r}"))
            sh.blank(f"M{r}", style=sh.style(f"M{r}"))
            sh.merge(f"C{r}:E{r}")
            sh.merge(f"G{r}:H{r}")
        tot = R(27)
        sh.set_row_cells(tot, {c: shift_row_refs(x, Q + 47, tot) for c, x in sh.row_cells(Q + 47).items()}, attrs[47])
        sh.blank(f"H{tot}", style=sh.style(f"H{tot}"))
        sh.blank(f"M{tot}", style=sh.style(f"M{tot}"))
        sh.text(f"C{tot}", "Total")
        for c in ("J", "L"):
            sh.formula(f"{c}{tot}", f'IF(SUM({c}{R(23)}:{c}{R(26)})=0,"",SUM({c}{R(23)}:{c}{R(26)}))')
        sh.merge(f"C{tot}:D{tot}")
        sh.clear_row(R(28))

        # airflow basis (moved down): Intake in the Method Total, the final readings (else the initial ones)
        cells_of(17, R(29))
        cells_of(18, R(30))
        cells_of(19, R(31))
        m = f"E{R(30)}"
        either = lambda a, b: f'IF({b}="",{a},{b})'  # noqa: E731
        sh.formula(f"E{R(31)}", (
            f'IF({m}="","",IF({m}="PSP",{either(f"E{R(8)}", f"K{R(8)}")},IF({m}="Filter Grid",'
            f'{either(f"E{R(16)}", f"K{R(16)}")},IF({m}="Profile Pressure",K{R(19)},IF({m}="Intake",'
            f'{either(f"J{tot}", f"L{tot}")},"")))))'))
        sh.merge(f"B{R(29)}:M{R(29)}")
        for r in (R(30), R(31)):
            for mm in ("B{0}:D{0}", "E{0}:G{0}", "H{0}:J{0}", "K{0}:M{0}"):
                sh.merge(mm.format(r))
        sh.clear_row(R(32))

        # supply outlets (cont.): 12 rows
        cells_of(23, R(33))
        cells_of(24, R(34))
        for i in range(12):
            r = R(35 + i)
            sh.set_row_cells(r, {c: shift_row_refs(x, Q + 25 + i, r) for c, x in old[25 + i].items()}, attrs[25 + i])
        sh.merge(f"B{R(33)}:F{R(33)}")
        for c in ("G", "H", "M"):
            sh.merge(f"{c}{R(33)}:{c}{R(34)}")
        sh.merge(f"I{R(33)}:J{R(33)}")
        sh.merge(f"K{R(33)}:L{R(33)}")
        # restore the merges the rows above kept
        sh.merge(f"B{R(2)}:M{R(2)}")
        for mm in ("B{0}:C{0}", "E{0}:F{0}", "H{0}:I{0}", "K{0}:L{0}"):
            sh.merge(mm.format(R(3)))
        for r in range(R(4), R(8)):
            sh.merge(f"B{r}:C{r}")

        # totals that sum the page-2 outlets, the page-1 airflow lines
        n_sums = 0
        for r in (P + 45, Q + 47):
            for c, x in list(sh.rows[r][1].items()):
                y, n = re.subn(rf"\b([A-Z]){Q + 25}:([A-Z]){Q + 46}\b", rf"\g<1>{R(35)}:\g<2>{R(46)}", x)
                sh.rows[r][1][c] = y
                n_sums += n
        assert n_sums == 12, (P, n_sums)  # H, J, L (each range twice) on the page-1 total and the page-2 subtotal
        sh.formula(f"K{P + 5}", f'IF(K{R(30)}="",H{P + 45},K{R(30)})')
        sh.formula(f"L{P + 5}", f'IF(OR(E{R(30)}="",E{R(30)}="Outlets"),L{P + 45},E{R(31)})')
        # nothing on page 1 may still point at a page-2 row that moved
        for r in range(P, Q):
            for c, x in sh.rows.get(r, [None, {}])[1].items():
                f = re.search(r"<f>(.*?)</f>", x, re.S)
                if not f or (r == P + 5 and c in ("K", "L")):
                    continue
                local = re.sub(r"'[^']*'![$A-Z]+\$?\d+(:\$?[A-Z]+\$?\d+)?", "", f.group(1))
                for ref in re.findall(r"(?<![A-Za-z$])\$?[A-Z]{1,2}\$?(\d+)", local):
                    assert not (Q + 2 <= int(ref) <= Q + 34), (P, r, c, f.group(1)[:200])

    # validations: the method, the filter sizes and the burner housing moved down
    blocks = anchors(UNIT_SHEETS["MAUs"])
    sh.set_validation("Airflow.Method", [f"E{P + 52 + 30}" for P in blocks])
    size_refs = [f"{c}{P + 52 + 11}" for c in cols("C", "M") for P in blocks]
    old_size = [f"{c}{P + 52 + 9}" for c in cols("C", "M") for P in blocks]
    sh.drop_validation_refs(old_size)
    sh.set_validation("Hood.FilterSize", size_refs)
    housing = re.search(r'<dataValidation\b[^>]*sqref="([^"]*)"[^>]*type="whole"', sh.tail)
    sh.tail = sh.tail.replace(housing.group(0), housing.group(0).replace(
        housing.group(1), " ".join(f"D{P + 52 + 19}" for P in blocks)), 1)
    log.append("  MAUs: page 2 rebuilt: PSP initial / final (D:M Q+4..Q+7, CFMs E / K Q+8), Filter Grid size Q+11,"
               " initial / final velocity Q+12 / Q+13, CFMs Q+14 / Q+15, totals E / K Q+16, burner Q+19, Intake Screens"
               " Q+23..Q+26 (total Q+27), method E Q+30 (+ Intake), Method Total E Q+31, outlets Q+35..Q+46 (12)")


# ------------------------------------------------------------------------------------------ 5: Fans hood line
def fans_hood_line(sheets, log):
    sh = sheets["Fans"]
    for P in anchors(UNIT_SHEETS["Fans"]):
        r = P + 44
        assert sh.value(f"C{P + 45}") == "Total", P
        for c in ("G", "J", "L"):
            sh.blank(f"{c}{r}", style=sh.style(f"{c}{r}"))
        sh.blank(f"D{r}", style=sh.style(f"C{r}"))
        for c in ("E", "F", "G"):
            sh.blank(f"{c}{r}", style=sh.style(f"C{r}"))
        sh.merge(f"C{r}:G{r}")
        # % of design: the final CFM, else the initial one (the line has CFMs, no velocities)
        sh.formula(f"M{r}", (f'IF(OR(H{r}="",H{r}=0),"",IF(L{r}="",IF(J{r}="","",IF(OR(ISTEXT(J{r}),ISTEXT(H{r})),"",'
                             f'J{r}/H{r})),IF(OR(ISTEXT(L{r}),ISTEXT(H{r})),"",L{r}/H{r})))'))
    log.append("  Fans: P+44 is the 'measured at hood' line (hoods C:G, design H, initial J, final L CFM; % M), in the"
               " fan totals; 15 outlet rows on page 1")


# ------------------------------------------------------------------------------------------ 6: Building Balance
GREY_DXF = '<dxf><font><i/><color rgb="FF8A96A3"/></font></dxf>'


def balance_exclusions(sheets, styles, log):
    sh = sheets["Building Balance"]
    m = re.search(r'<dxfs count="(\d+)">', styles)
    dxf = int(m.group(1))
    styles = styles.replace(m.group(0), f'<dxfs count="{dxf + 1}">', 1).replace("</dxfs>", GREY_DXF + "</dxfs>", 1)
    # the % of an excluded row shows "Excl." (a % of design means nothing for a unit left out of the totals)
    for pct, flag, rows in (("G", "P", range(7, 67)), ("M", "Q", range(7, 87))):
        for r in rows:
            f = sh.value(f"{pct}{r}")
            assert f and f.startswith("=IF("), (pct, r, f)
            sh.formula(f"{pct}{r}", f'IF(${flag}{r}<>"","Excl.",{f[1:]})')
    for c, flag in (("C", "P"), ("E", "P"), ("I", "Q"), ("K", "Q")):
        net = f"SUM({c}7:{c}86)-SUMPRODUCT(--({flag}7:{flag}86<>\"\"),{c}7:{c}86)"
        sh.formula(f"{c}87", f'IF({net}=0,"",{net})')
    sh.add_conditional("B7:G86", '$P7<>""', dxf)
    sh.add_conditional("H7:M86", '$Q7<>""', dxf)
    head = sh.style("C6")
    sh.text("P5", "Excl.: type Excl. to leave a unit out of the totals")
    sh.text("P6", "Excl.", style=head)
    sh.text("Q6", "Excl.", style=head)
    # the reason on a fourth line under the notes
    line = sh.style("B102")
    for c in cols("B", "M"):
        sh.blank(f"{c}105", style=line)
    sh.row_height(105, 18)
    sh.merge("B105:M105")
    log.append("  Building Balance: Excl. flags P7:P66 (outside air) / Q7:Q86 (exhaust); 'Excl.' in the row's %, greyed"
               f" (dxf {dxf}), totals row 87 without them; exclusion note B105")
    return styles


# ------------------------------------------------------------------------------------------ 7: Summary observations
OBS_FIRST, OBS_ROWS = 66, 20


def summary_observations(sheets, log):
    for name in ("Summary - New", "Summary - (E)"):
        sh = sheets[name]
        hdr, body = sh.row_cells(12), sh.row_cells(14)
        assert sh.value("C12") == "Remark"
        sh.set_row_cells(64, {c: x for c, x in hdr.items()}, sh.row_attrs(12))
        for c in cols("B", "L"):
            sh.blank(f"{c}64", style=sh.style("B12"))
        sh.text("B64", "Observations (noted for the owner; no action required)")
        sh.merge("B64:L64")
        sh.set_row_cells(65, dict(hdr), sh.row_attrs(12))
        sh.text("B65", "Obs.")
        sh.text("C65", "Observation")
        sh.blank("J65", style=sh.style("D65"))
        sh.merge("C65:J65")
        sh.merge("K65:L65")
        for i in range(OBS_ROWS):
            r = OBS_FIRST + i
            sh.set_row_cells(r, dict(body), sh.row_attrs(14))
            sh.blank(f"J{r}", style=sh.style(f"D{r}"))
            sh.merge(f"C{r}:J{r}")
            sh.merge(f"K{r}:L{r}")
        sh.add_breaks([62])
        log.append(f"  {name}: Observations B64 (Obs. B, observation C:J, comments K:L) rows {OBS_FIRST}-{OBS_FIRST + OBS_ROWS - 1},"
                   " page break after row 62")


# ------------------------------------------------------------------------------------------ 8: flat oval traverses
TRAVERSES = 48


def traverse_anchor(n):
    return 5 + 49 * ((n - 1) // 3) + 15 * ((n - 1) % 3)


def traverse_flat_oval(sheets, log):
    sh = sheets["Traverses"]
    for n in range(1, TRAVERSES + 1):
        T = traverse_anchor(n)
        d, S, pos, g1, g8 = T + 2, T + 4, T + 5, T + 6, T + 13
        assert sh.value(f"B{T}") == "Airflow Traverse Measurement", (n, T)
        FO = f'$D${S}="Flat Oval"'
        W, H, L = f"$G${S}", f"$I${S}", f"N($K${S})"
        Wi, Hi = f"({W}-2*{L})", f"({H}-2*{L})"
        N9, N10, N11, R = f"$N${S}", f"$N${pos}", f"$N${g1}", f"$O${S}"
        QE = f"$P${g1}:$W${T + 15}"
        both = f'OR({W}="",{H}="")'
        txt = f"OR(ISTEXT({W}),ISTEXT({H}))"
        for c in ("O",):
            for r in range(S, S + 5):
                assert sh.value(f"{c}{r}") is None, (n, c, r)

        def wrap(ref, fo):
            old = sh.value(ref)
            assert old and old.startswith("="), (ref, old)
            sh.formula(ref, f"IF({FO},{fo},{old[1:]})")

        wrap(f"F{d}", f'IF({both},"",{W}&""" x "&{H}&""" oval")')
        wrap(f"H{d}", f'IF({both},"",IF({txt},"",ROUND((({Wi}-{Hi})*{Hi}+PI()*({Hi}/2)^2)/144,3)))')
        wrap(f"N{S}", f'IF({both},"",IF({txt},"",IF({W}-{H}<12,2,MIN(10,MAX(3,ROUNDUP(({W}-{H})/6,0))))))')
        wrap(f"N{pos}", f'IF({both},"",IF({txt},"",IF({H}<12,2,MIN(7,MAX(3,ROUNDUP({H}/6,0))))))')
        sh.formula(f"O{S}", f'IF(AND({FO},NOT({both}),NOT({txt})),IF({H}<=9,6,IF({H}<=12,8,10)),"")', style=None)
        wrap(f"N{g1}", f'IF(OR({N9}="",{N10}="",{R}=""),"",{N9}*{N10}+{R})')
        wrap(f"M{S}", f'IF({N11}="","",{N9}&"x"&{N10}&"+"&{R}&" ends")')
        for i, c in enumerate(cols("D", "M"), start=1):
            wrap(f"{c}{pos}", f'IF(OR({N9}="",ISTEXT({N9}),{i}>{N9}),"",ROUND(({i}-0.5)*({W}-{H})/{N9},1))')
        for j in range(1, 9):
            r = T + 5 + j
            wrap(f"B{r}", f'IF(OR({N10}="",ISTEXT({N10})),"",IF({j}<={N10},ROUND(({j}-0.5)*{H}/{N10},1),IF({j}={N10}+1,"Ends","")))')

            def read(k):
                cell = f"INDEX({QE},MOD({k}-1,10)+1,INT(({k}-1)/10)+1)"
                return f'IF({k}>80,"",IF({cell}="","",{cell}))'
            for i, c in enumerate(cols("D", "M"), start=1):
                rect = f"(({j}-1)*{N9}+{i})"
                end = f"({N9}*{N10}+{i})"
                wrap(f"{c}{r}", (f'IF(OR({N11}="",ISTEXT({N9}),ISTEXT({N10})),"",IF({j}<={N10},IF({i}>{N9},"",{read(rect)}),'
                                 f'IF(AND({j}={N10}+1,{i}<={R}),{read(end)},"")))'))
        # rectangle rows D(g1):M(g1 + N10 - 1), the ends row below them; AVERAGE skips the "" of empty grid cells
        rect = f"D{g1}:INDEX(M{g1}:M{g8},{N10})"
        ends = f"INDEX(D{g1}:D{g8},{N10}+1):INDEX(M{g1}:M{g8},{N10}+1)"

        def avg(rng):
            return f'IF(OR(NOT({FO}),N({N11})=0),"",IF(COUNT({rng})=0,"",AVERAGE({rng})))'
        sh.formula(f"O{S + 1}", avg(rect), style=None)
        sh.formula(f"O{S + 2}", avg(ends), style=None)
        sh.formula(f"O{S + 3}", f'IF(AND({FO},NOT({both}),NOT({txt})),({Wi}-{Hi})*{Hi}/144,"")', style=None)
        sh.formula(f"O{S + 4}", f'IF(AND({FO},NOT({both}),NOT({txt})),PI()*({Hi}/2)^2/144,"")', style=None)
        a, e, ar, ae = f"$O${S + 1}", f"$O${S + 2}", f"$O${S + 3}", f"$O${S + 4}"
        wrap(f"L{d}", f'IF(OR({a}="",{e}="",N({ar})+N({ae})=0),"",ROUND(({a}*{ar}+{e}*{ae})/({ar}+{ae}),0))')
    note = sh.value("P5")
    sh.text("P5", note + (" Flat oval (NEBB 6.3.3h): the flat part as a rectangle (W − H) × H with the rectangular rules,"
                          " the two ends as one round of diameter H on the horizontal axis (6 / 8 / 10 points, half at each"
                          " end); type the rectangle readings first (row by row), then the end points (left end, then right"
                          " end). Final VEL = (rectangle average × its area + ends average × circle area) ÷ total area."))
    log.append(f"  Traverses: {TRAVERSES} blocks: Flat Oval branches in Ak, size, points (N), grid, positions; helpers O"
               " (end points, rectangle / ends averages, areas); Final VEL area-weighted")


# ------------------------------------------------------------------------------------------ 9: lists, revision name
def dropdowns(sheets, wb, log):
    sh = sheets["{Dropdowns}"]
    assert sh.value("T6") is None and sh.value("AF4") is None
    sh.text("T6", "Intake", style=None)
    sh.text("AF4", "Flat Oval", style=None)
    wb = wb.replace("'{Dropdowns}'!$T$2:$T$5", "'{Dropdowns}'!$T$2:$T$6", 1)
    wb = wb.replace("'{Dropdowns}'!$AF$2:$AF$3", "'{Dropdowns}'!$AF$2:$AF$4", 1)
    assert "$T$2:$T$6" in wb and "$AF$2:$AF$4" in wb
    wb = wb.replace("</definedNames>", '<definedName name="a2b.TemplateRevision">"07"</definedName></definedNames>', 1)
    log.append("  {Dropdowns}: Airflow.Method T2:T6 (+ Intake), Duct.Shape AF2:AF4 (+ Flat Oval); a2b.TemplateRevision = \"07\"")
    return wb


def print_areas(wb, log):
    for sheet, last in (("Summary - New", 85), ("Summary - (E)", 85), ("Building Balance", 105)):
        q = re.escape(sheet)
        wb, n = re.subn(rf"('{q}'!\$A\$1:\$M\$)\d+", rf"\g<1>{last}", wb, count=1)
        assert n == 1, sheet
    # the observations page repeats the project / address lines (rows 1-3), like the unit sheets
    order = re.findall(r'<sheet\b[^>]*name="([^"]+)"', wb)
    titles = "".join(
        f'<definedName name="_xlnm.Print_Titles" localSheetId="{order.index(n)}">\'{n}\'!$1:$3</definedName>'
        for n in ("Summary - New", "Summary - (E)"))
    wb = wb.replace("</definedNames>", titles + "</definedNames>", 1)
    log.append("  print areas: Summary - New / (E) A1:M85 (print titles rows 1-3), Building Balance A1:M105")
    return wb


# ------------------------------------------------------------------------------------------ build
def newest_rev06():
    files = sorted(glob.glob(os.path.join(ROOT, "06 - a2b_Blank_TAB_Workbook *.xlsm")), key=os.path.getmtime)
    if not files:
        sys.exit("no revision 06 workbook found")
    return files[-1]


EDITED = ("RTUs", "MAUs", "ERVs", "Fans", "Building Balance", "Summary - New", "Summary - (E)", "Traverses", "{Dropdowns}")


def build(src, out, log):
    with zipfile.ZipFile(src) as zin:
        parts = _sheet_files(zin)
        sheets = {t: Sheet(zin.read(parts[t][0]).decode("utf-8")) for t in EDITED}
        wb = zin.read("xl/workbook.xml").decode("utf-8")
        styles = zin.read("xl/styles.xml").decode("utf-8")
        unit_blocks(sheets, log)
        mau_page2(sheets, log)
        fans_hood_line(sheets, log)
        styles = balance_exclusions(sheets, styles, log)
        summary_observations(sheets, log)
        traverse_flat_oval(sheets, log)
        wb = dropdowns(sheets, wb, log)
        wb = print_areas(wb, log)
        new = {parts[t][0]: sheets[t].xml() for t in EDITED}
        new["xl/workbook.xml"] = wb
        new["xl/styles.xml"] = styles
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
        src, out = newest_rev06(), OUT
    log.append(f"Source: {os.path.basename(src)}")
    log.append(f"Output: {os.path.basename(out)}")
    build(src, out, log)
    if len(sys.argv) != 3:
        with open(os.path.join(ROOT, "docs", "build-log-rev07.txt"), "w") as fh:
            fh.write("\n".join(log) + "\n")
    print("\n".join(log))
