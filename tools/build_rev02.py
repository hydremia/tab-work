"""Revision 02: merged per-unit sheets (Option B).

    python3 tools/build_rev02.py        # reads the 01 workbook, writes 02 - a2b_Blank_TAB_Workbook <date>.xlsm

Each RTU / MAU / ERV / fan gets one compact page (unit data block + outlet
tables) and one continuation page (extra outlet rows; for MAUs the supply
measurement methods). VAV terminals are two per page. The old Data / Airflow
sheet pairs and the MAU Supply Methods sheet are removed; everything else is
carried over from revision 01 unchanged.
"""
import copy
import datetime as dt
import glob
import os
import re
import sys
import tempfile

from openpyxl import load_workbook
from openpyxl.formula.translate import Translator
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.pagebreak import Break

sys.path.insert(0, os.path.dirname(__file__))
import xlsm_parts  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sorted(glob.glob(os.path.join(ROOT, "01 - a2b_Blank_TAB_Workbook *.xlsm")))[-1]
STAMP = os.environ.get("TAB_BUILD_DATE", dt.date.today().strftime("%-m-%-d-%y"))
OUT = os.path.join(ROOT, f"02 - a2b_Blank_TAB_Workbook {STAMP}.xlsm")
EDE = "'{Equipment Data Entry}'"
DD = "'{Dropdowns}'"
PAGE = 52
THIN = Side(style="thin")
LOG = []


def log(m):
    LOG.append(m); print("  -", m)


def anchors(ws, label="System"):
    return [c.row for c in ws["B"] if c.value == label]


def merged_set(ws):
    return {str(m) for m in ws.merged_cells.ranges}


def merge(ws, rng):
    if rng not in merged_set(ws):
        ws.merge_cells(rng)


def copy_style(s, d):
    d.font = copy.copy(s.font); d.border = copy.copy(s.border); d.fill = copy.copy(s.fill)
    d.number_format = s.number_format; d.alignment = copy.copy(s.alignment); d.protection = copy.copy(s.protection)


def copy_block(src, r1, r2, dst, d1, c1=1, c2=14, values=True):
    """Copy rows r1..r2 (cols c1..c2) of src to dst starting at row d1: styles, heights, merges,
    values; same-sheet relative formula refs are translated by the row offset."""
    off = d1 - r1
    for r in range(r1, r2 + 1):
        dst.row_dimensions[r + off].height = src.row_dimensions[r].height or 13.35
        for c in range(c1, c2 + 1):
            s = src.cell(r, c); d = dst.cell(r + off, c)
            if type(d).__name__ == "MergedCell":
                continue
            copy_style(s, d)
            if values and s.value is not None and type(s).__name__ != "MergedCell":
                v = s.value
                if isinstance(v, str) and v.startswith("="):
                    v = Translator(v, origin=s.coordinate).translate_formula(d.coordinate)
                d.value = v
    for m in src.merged_cells.ranges:
        if r1 <= m.min_row and m.max_row <= r2 and c1 <= m.min_col and m.max_col <= c2:
            merge(dst, f"{get_column_letter(m.min_col)}{m.min_row + off}:{get_column_letter(m.max_col)}{m.max_row + off}")


def outlet_rows(dst, hdr_src, hdr_r, row_src, row_r, top, n, title=None):
    """Two header rows copied from hdr_src rows hdr_r,hdr_r+1 at `top`, then n outlet rows styled
    like row_src[row_r] with the G/J/L/M formulas. Returns (first_row, last_row)."""
    copy_block(hdr_src, hdr_r, hdr_r + 1, dst, top)
    if title:
        dst.cell(top, 2).value = title
    first = top + 2
    for i in range(n):
        r = first + i
        copy_block(row_src, row_r, row_r, dst, r, values=False)
        dst[f"G{r}"] = f'=IF(F{r}="", "", H{r}/F{r})'
        dst[f"J{r}"] = f'=IF(I{r}="", "", I{r}*$F{r})'
        dst[f"L{r}"] = f'=IF(K{r}="", "", K{r}*$F{r})'
        dst[f"M{r}"] = f'=IF(OR(H{r}="",H{r}=0),"",IF(K{r}="",IF(J{r}="","",J{r}/H{r}),L{r}/H{r}))'
    return first, first + n - 1


def total_row(dst, tot_src, tot_r, r, ranges, label="Total"):
    """Total row styled like tot_src[tot_r]; ranges = list of (first,last) row spans to sum."""
    copy_block(tot_src, tot_r, tot_r, dst, r, values=False)
    dst.cell(r, 3).value = label
    for col in "HJL":
        parts = "+".join(f"SUM({col}{a}:{col}{b})" for a, b in ranges)
        dst[f"{col}{r}"] = f'=IF({parts}=0,"",{parts})'
    dst[f"M{r}"] = f'=IF(OR(H{r}="",H{r}=0),"",IF(L{r}="",IF(J{r}="","",J{r}/H{r}),L{r}/H{r}))'


def remarks(dst, src, src_r, r, label="Remarks", lines=2):
    copy_block(src, src_r, src_r + 1, dst, r, values=False)
    for i in range(2, lines + 1):
        copy_block(src, src_r + 1, src_r + 1, dst, r + i, values=False)
    dst.cell(r, 2).value = label


def system_rows(dst, src, r, ede_row, cont=False):
    copy_block(src, 4, 5, dst, r, values=False)
    dst[f"B{r}"] = "System (cont.)" if cont else "System"
    dst[f"D{r}"] = f'=IF({EDE}!B{ede_row}="","",{EDE}!B{ede_row})'
    dst[f"G{r}"] = "Service"
    dst[f"I{r}"] = f'=IF({EDE}!C{ede_row}="","",{EDE}!C{ede_row})'


def dv(ws, cells, name):
    d = DataValidation(type="list", formula1=name, allow_blank=True); d.sqref = " ".join(cells); ws.add_data_validation(d)


def new_sheet(wb, name, like, widths_from, header_src):
    ws = wb.create_sheet(name)
    for col, dim in widths_from.column_dimensions.items():
        if dim.width:
            ws.column_dimensions[col].width = dim.width
    ws.sheet_format.defaultRowHeight = 13.35
    ws.sheet_format.defaultColWidth = 6.86
    ws.column_dimensions["C"].width = 9.7; ws.column_dimensions["D"].width = 6.0
    copy_block(header_src, 1, 3, ws, 1)
    for m in header_src.merged_cells.ranges:
        if m.max_row <= 3:
            merge(ws, str(m))
    ws.print_title_rows = "1:3"
    ws.page_margins = copy.copy(like.page_margins)
    ws.page_setup.orientation = "portrait"; ws.page_setup.scale = 93
    ws.sheet_view.showGridLines = like.sheet_view.showGridLines
    return ws


# --------------------------------------------------------------------------- #
def build_unit_sheet(wb, kind):
    """kind: RTU | MAU | ERV | Fan"""
    spec = {
        "RTU": dict(name="RTUs", data="RTU Data", air="RTU Airflow", ede=7, n=40, oa=True, sup_title="Supply Air Diffuser / Outlet Airflow", cont_title="Supply Air Outlets (cont.)"),
        "MAU": dict(name="MAUs", data="MAU Data", air="MAU Airflow", ede=52, n=10, oa=False, sup_title="Supply Air Diffuser / Outlet Airflow", cont_title="Supply Air Outlets (cont.)"),
        "ERV": dict(name="ERVs", data="ERV Data", air="ERV Airflow", ede=65, n=10, oa=False, sup_title="Supply Air Outlet Airflow", cont_title="Supply Air Outlets (cont.)"),
        "Fan": dict(name="Fans", data="Fan Data (EFs, TFs, etc.)", air="Fan Airflow", ede=81, n=40, oa=False, sup_title="Register / Grille / Diffuser Airflow", cont_title="Registers / Grilles (cont.)"),
    }[kind]
    data, air = wb[spec["data"]], wb[spec["air"]]
    rtu_air = wb["RTU Airflow"]
    ws = new_sheet(wb, spec["name"], data, rtu_air, data)
    meth = wb["MAU Supply Methods"] if kind == "MAU" else None
    sf_cells, volt_cells, phase_cells, drive_cells, instr_cells = [], [], [], [], []
    for u in range(spec["n"]):
        P = 4 + u * 2 * PAGE; Q = P + PAGE; ede_row = spec["ede"] + u
        # ---- page 1: system, mini line, data block
        system_rows(ws, data, P, ede_row)
        copy_block(data, 6, 25, ws, P + 2)
        # re-point Data Entry references to this unit, and same-sheet refs are already translated
        for row in ws.iter_rows(min_row=P + 2, max_row=P + 21, max_col=14):
            for c in row:
                if isinstance(c.value, str) and "{Equipment Data Entry}" in c.value:
                    c.value = re.sub(r"(\{Equipment Data Entry\}'!\$?[A-Z]+\$?)\d+", lambda m: f"{m.group(1)}{ede_row}", c.value)
        drive_cells.append(f"D{P+2}"); sf_cells.append(f"G{P+12}"); volt_cells.append(f"B{P+13}"); phase_cells.append(f"C{P+13}")
        # ---- page 1: instrument line + tables
        copy_block(air, 6, 6, ws, P + 22); instr_cells.append(f"D{P+22}")
        if kind == "RTU":
            s1a, s1b = outlet_rows(ws, rtu_air, 7, rtu_air, 9, P + 23, 14, spec["sup_title"])
            tot = P + 39
            c1a, c1b = Q + 4, Q + 37
            total_row(ws, rtu_air, 37, tot, [(s1a, s1b), (c1a, c1b)])
            r1a, r1b = outlet_rows(ws, rtu_air, 39, rtu_air, 42, P + 40, 2)
            rtot = P + 44; rc1a, rc1b = Q + 41, Q + 44
            total_row(ws, rtu_air, 44, rtot, [(r1a, r1b), (rc1a, rc1b)])
            o1a, _ = outlet_rows(ws, rtu_air, 46, rtu_air, 48, P + 45, 1)
            oa_row = o1a
            ws[f"H{r1a}"] = f'=IF(H{tot}="","",H{tot}-N(H{oa_row}))'
            ws[f"L{r1a}"] = f'=IF(L{oa_row}="","",L{tot}-N(L{oa_row}))'
            remarks(ws, rtu_air, 50, P + 48)
            # data block links
            ws[f"K{P+5}"] = f"=H{tot}"; ws[f"L{P+5}"] = f"=L{tot}"
            ws[f"K{P+6}"] = f'=IF(N(H{oa_row})=0,"",H{oa_row})'; ws[f"L{P+6}"] = f"=L{oa_row}"
            # ---- page 2
            system_rows(ws, data, Q, ede_row, cont=True)
            outlet_rows(ws, rtu_air, 7, rtu_air, 9, Q + 2, 34, spec["cont_title"])
            total_row(ws, rtu_air, 37, Q + 38, [(c1a, c1b)], "Subtotal (this page)")
            outlet_rows(ws, rtu_air, 39, rtu_air, 42, Q + 39, 4, "Return Air Inlets (cont.)")
            total_row(ws, rtu_air, 44, Q + 45, [(rc1a, rc1b)], "Subtotal (this page)")
            remarks(ws, rtu_air, 50, Q + 46, "Remarks (cont.)", 3)
        elif kind == "ERV":
            s1a, s1b = outlet_rows(ws, rtu_air, 7, rtu_air, 9, P + 23, 8, spec["sup_title"])
            stot = P + 33; c1a, c1b = Q + 4, Q + 19
            total_row(ws, rtu_air, 37, stot, [(s1a, s1b), (c1a, c1b)])
            copy_block(air, 27, 27, ws, P + 34); instr_cells.append(f"D{P+34}")
            e1a, e1b = outlet_rows(ws, rtu_air, 7, rtu_air, 9, P + 35, 8, "Exhaust Air Inlet Airflow")
            etot = P + 45; c2a, c2b = Q + 24, Q + 39
            total_row(ws, rtu_air, 37, etot, [(e1a, e1b), (c2a, c2b)])
            remarks(ws, rtu_air, 50, P + 47)
            ws[f"K{P+5}"] = f"=H{stot}"; ws[f"L{P+5}"] = f"=L{stot}"
            ws[f"K{P+6}"] = f"=H{etot}"; ws[f"L{P+6}"] = f"=L{etot}"
            system_rows(ws, data, Q, ede_row, cont=True)
            outlet_rows(ws, rtu_air, 7, rtu_air, 9, Q + 2, 16, spec["cont_title"])
            total_row(ws, rtu_air, 37, Q + 20, [(c1a, c1b)], "Subtotal (this page)")
            outlet_rows(ws, rtu_air, 7, rtu_air, 9, Q + 22, 16, "Exhaust Air Inlets (cont.)")
            total_row(ws, rtu_air, 37, Q + 40, [(c2a, c2b)], "Subtotal (this page)")
            remarks(ws, rtu_air, 50, Q + 42, "Remarks (cont.)", 3)
        else:  # MAU, Fan
            n1 = 20
            s1a, s1b = outlet_rows(ws, rtu_air, 7, rtu_air, 9, P + 23, n1, spec["sup_title"])
            tot = P + 23 + 2 + n1
            if kind == "MAU":
                c1a, c1b = Q + 25, Q + 46
            else:
                c1a, c1b = Q + 4, Q + 43
            total_row(ws, rtu_air, 37, tot, [(s1a, s1b), (c1a, c1b)])
            remarks(ws, rtu_air, 50, tot + 2, lines=3)
            system_rows(ws, data, Q, ede_row, cont=True)
            if kind == "MAU":
                # methods block: copy the 10-unit methods sheet block u (anchor 4+24u, rows +3..+20) to Q+2
                a = 4 + u * 24
                copy_block(meth, a + 3, a + 20, ws, Q + 2)
                ws[f"B{Q+17}"] = "Airflow Basis for Total Airflow (page 1)"
                m_sel, m_des, m_tot = f"E{Q+18}", f"K{Q+18}", f"E{Q+19}"
                ws[f"K{P+5}"] = f'=IF({m_des}="",H{tot},{m_des})'
                ws[f"L{P+5}"] = f'=IF(OR({m_sel}="",{m_sel}="Outlets"),L{tot},{m_tot})'
                outlet_rows(ws, rtu_air, 7, rtu_air, 9, Q + 23, 22, spec["cont_title"])
                total_row(ws, rtu_air, 37, Q + 47, [(c1a, c1b)], "Subtotal (this page)")
                remarks(ws, rtu_air, 50, Q + 49, "Remarks (cont.)", 1)
            else:
                ws[f"K{P+5}"] = f"=H{tot}"; ws[f"L{P+5}"] = f"=L{tot}"
                outlet_rows(ws, rtu_air, 7, rtu_air, 9, Q + 2, 40, spec["cont_title"])
                total_row(ws, rtu_air, 37, Q + 44, [(c1a, c1b)], "Subtotal (this page)")
                remarks(ws, rtu_air, 50, Q + 46, "Remarks (cont.)", 3)
        for r in range(P, Q + PAGE):
            if ws.row_dimensions[r].height is None:
                ws.row_dimensions[r].height = 13.35
        ws.row_breaks.append(Break(id=P + PAGE - 1)); ws.row_breaks.append(Break(id=Q + PAGE - 1))
    dv(ws, drive_cells, "Drive.Type"); dv(ws, instr_cells, "Airflow.Instrument")
    dv(ws, sf_cells, "Service.Factors2"); dv(ws, volt_cells, "Voltage.Options"); dv(ws, phase_cells, "Phase")
    if kind == "MAU":
        m_sel_cells = [f"E{4 + u*2*PAGE + PAGE + 18}" for u in range(spec["n"])]
        dv(ws, m_sel_cells, "Airflow.Method")
        dv(ws, [f"G{4 + u*2*PAGE + PAGE + 3}" for u in range(spec["n"])], "PSP.Width")
        dv(ws, [f"{get_column_letter(c)}{4 + u*2*PAGE + PAGE + 9}" for u in range(spec["n"]) for c in range(3, 14)], "Hood.FilterSize")
        d = DataValidation(type="whole", operator="between", formula1="1", formula2="5", allow_blank=True)
        d.sqref = " ".join(f"D{4 + u*2*PAGE + PAGE + 15}" for u in range(spec["n"])); ws.add_data_validation(d)
    default_units = 4 if spec["n"] == 40 else 2
    ws.print_area = f"A1:N{4 + default_units * 2 * PAGE - 1}"   # PrintReport macro resets this to the used units
    log(f"{spec['name']}: {spec['n']} units x 2 pages built from {spec['data']} + {spec['air']}")
    return ws


def build_vav_sheet(wb):
    data, air, rtu_air = wb["VAV Data"], wb["VAV 1-20 Airflow"], wb["RTU Airflow"]
    ws = new_sheet(wb, "VAVs", data, rtu_air, data)
    instr = []
    for u in range(80):
        P = 4 + u * 26; ede_row = 150 + u
        copy_block(data, 4, 14, ws, P)
        for row in ws.iter_rows(min_row=P, max_row=P + 10, max_col=14):
            for c in row:
                if isinstance(c.value, str) and "{Equipment Data Entry}" in c.value:
                    c.value = re.sub(r"(\{Equipment Data Entry\}'!\$?[A-Z]+\$?)\d+", lambda m: f"{m.group(1)}{ede_row}", c.value)
        instr.append(f"L{P+2}")
        a, b = outlet_rows(ws, rtu_air, 7, rtu_air, 9, P + 11, 6, "Register / Grille / Diffuser Airflow")
        total_row(ws, rtu_air, 37, P + 19, [(a, b)])
        remarks(ws, rtu_air, 50, P + 20, lines=1)
        # actual max CFM on the data block = outlet total
        ws[f"M{P+5}"] = f"=L{P+19}"
        for r in range(P, P + 26):
            if ws.row_dimensions[r].height is None:
                ws.row_dimensions[r].height = 13.35
        if u % 2 == 1:
            ws.row_breaks.append(Break(id=P + 25))
    dv(ws, instr, "Airflow.Instrument")
    ws.print_area = f"A1:N{4 + 4 * 26 - 1}"   # 2 pages; PrintReport macro resets this
    log("VAVs: 80 terminals, two per page, built from VAV Data + VAV 1-20 Airflow")
    return ws


def building_balance(wb):
    ws = wb["Building Balance"]
    for r in range(7, 47):
        u = r - 7; P = 4 + u * 2 * PAGE
        ws[f"C{r}"] = f"=IF('RTUs'!K{P+6}=\"\",\"\",'RTUs'!K{P+6})"; ws[f"E{r}"] = f"=IF('RTUs'!L{P+6}=\"\",\"\",'RTUs'!L{P+6})"
        ws[f"I{r}"] = f"=IF('Fans'!K{P+5}=\"\",\"\",'Fans'!K{P+5})"; ws[f"K{r}"] = f"=IF('Fans'!L{P+5}=\"\",\"\",'Fans'!L{P+5})"
    for r in range(47, 57):
        u = r - 47; P = 4 + u * 2 * PAGE
        ws[f"C{r}"] = f"=IF('MAUs'!K{P+5}=\"\",\"\",'MAUs'!K{P+5})"; ws[f"E{r}"] = f"=IF('MAUs'!L{P+5}=\"\",\"\",'MAUs'!L{P+5})"
    for r in range(57, 67):
        u = r - 57; P = 4 + u * 2 * PAGE
        ws[f"C{r}"] = f"=IF('ERVs'!K{P+5}=\"\",\"\",'ERVs'!K{P+5})"; ws[f"E{r}"] = f"=IF('ERVs'!L{P+5}=\"\",\"\",'ERVs'!L{P+5})"
        ws[f"I{r}"] = f"=IF('ERVs'!K{P+6}=\"\",\"\",'ERVs'!K{P+6})"; ws[f"K{r}"] = f"=IF('ERVs'!L{P+6}=\"\",\"\",'ERVs'!L{P+6})"
    log("Building Balance re-pointed to the merged sheets")


def toc_and_misc(wb):
    toc = wb["ToC"]
    toc["C19"] = "Rooftop Units"; toc["C22"] = "Make-up Air Units"; toc["C25"] = "Energy Recovery Units"
    toc["C28"] = "Fans and VAV Terminals"
    cert = wb["Certification"]
    cert["C50"] = "NEBB Certified TAB Professional stamp – insert the stamp image here (Insert ▸ Pictures); signature may also be an image:"
    cert["C50"].font = Font(name=cert["C34"].font.name, size=9, bold=True)
    log("ToC entries renamed; certification stamp box captioned for an image stamp")


ORDER = ["Cover Page", "ToC", "Narrative", "Summary - New", "Summary - (E)", "{Project Information}", "{Equipment Data Entry}",
         "{Dropdowns}", "Building Balance", "RTUs", "MAUs", "ERVs", "Fans", "VAVs", "Hoods", "Traverses", "Photos",
         "Certification", "NEBB Cert ", "NEBB Frm Cert", "Abbreviations", "Calibration"]
OLD = ["RTU Data", "RTU Airflow", "MAU Data", "MAU Airflow", "MAU Supply Methods", "ERV Data", "ERV Airflow",
       "Fan Data (EFs, TFs, etc.)", "Fan Airflow", "VAV Data", "VAV 1-20 Airflow"]


def build(out=OUT):
    wb = load_workbook(SRC, keep_vba=True)
    for kind in ("RTU", "MAU", "ERV", "Fan"):
        build_unit_sheet(wb, kind)
    build_vav_sheet(wb)
    building_balance(wb)
    toc_and_misc(wb)
    for name in OLD:
        wb.remove(wb[name])
    wb._sheets = [wb[n] for n in ORDER]
    wb.active = 0
    for ws in wb.worksheets:
        ws.sheet_view.tabSelected = ws.title == "Cover Page"
    log("Old Data/Airflow sheets removed; sheet order: " + ", ".join(ORDER))
    tmp = tempfile.mktemp(suffix=".xlsm")
    wb.save(tmp)
    xlsm_parts.restore(SRC, tmp, out, footer="&amp;C&amp;8Page &amp;P", skip_footer=("Cover Page",),
                       extra_sheet_sources={"RTUs": "RTU Data", "MAUs": "MAU Data", "ERVs": "ERV Data",
                                            "Fans": "Fan Data (EFs, TFs, etc.)", "VAVs": "VAV 1-20 Airflow"},
                       header_overrides={"RTUs": "Rooftop Unit Report", "MAUs": "Make-up Air Unit Report",
                                         "ERVs": "Energy Recovery Unit Report", "Fans": "Fan Report",
                                         "VAVs": "VAV Terminal Report"})
    os.remove(tmp)
    with open(os.path.join(ROOT, "docs", "build-log-rev02.txt"), "w") as fh:
        fh.write("\n".join(LOG) + "\n")
    print("written", out)


if __name__ == "__main__":
    build()
