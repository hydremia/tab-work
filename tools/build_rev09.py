"""Revision 09 = revision 08 with the report polish from the CAP final report (docs/TRACKER.md, "Template revision 09
queue"). No cell, formula, row or column moves: a revision 08 workbook stays a compatible base and the app's revision 08
map describes revision 09 unchanged.

  1. abbreviations  The four Abbreviations lines that printed cut off wrap instead: B14 (C2C …), B45 (SD/RG/EG …),
                    B46 (LSD/PSP …) and H39 (N/A = … where that is the reason) get wrap-text copies of their styles
                    and their rows grow to two lines (26.7 pt; H39 three lines, 40.05 pt). The sheet prints at 92 %
                    (was 99 %) so it still fits one page.
  2. area_served    Equipment Summary column C ("Area Served", every unit line, style 517 → copy with shrink-to-fit):
                    a long area is shrunk to the cell instead of being cut at ~22 characters.
  3. hoods_fill     The Hoods sheet's solid yellow working fill (style 287: hood / model manufacturer, design airflow
                    and model number cells, 44 per sheet) leaves the template itself; the export no longer has to clear
                    it. The "Filter Type" label's conditional yellow when blank stays as a fill-in prompt (decision).
  4. nebb_certs     Four certificates on two pages: the firm certificate's picture moves onto "NEBB Cert " as the
                    second picture of page 2 (row 78, under the third technician certificate) and the "NEBB Frm Cert"
                    sheet is hidden (hidden sheets don't print; the ToC's Appendix A entry already covers both sheets).
  5. calibration    The Calibration header "Manufacturer" (E11) takes the other headers' style (369: bold 12 pt,
                    theme colour) instead of its own 14 pt blue one (370).
  6. revision       a2b.TemplateRevision = "09".

    TAB_BUILD_DATE=10-21-26 python tools/build_rev09.py      # newest 08 file -> 09 - a2b_Blank_TAB_Workbook <date>.xlsm
    python tools/build_rev09.py <source.xlsm> <output.xlsm>   # explicit files, no build log
"""
import datetime as dt
import glob
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(__file__))
from xlsm_parts import _sheet_files  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAMP = os.environ.get("TAB_BUILD_DATE") or f"{dt.date.today().month}-{dt.date.today().day}-{dt.date.today().year % 100}"
OUT = os.path.join(ROOT, f"09 - a2b_Blank_TAB_Workbook {STAMP}.xlsm")

IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"


# ------------------------------------------------------------------------------------------ styles.xml helpers
def _xfs(styles):
    m = re.search(r"<cellXfs\b[^>]*>(.*?)</cellXfs>", styles, re.S)
    assert m, "cellXfs"
    return m, re.findall(r"<xf\b[^>]*/>|<xf\b[^>]*>.*?</xf>", m.group(1), re.S)


def clone_xf(styles, idx, mutate):
    """Append a copy of cellXfs[idx] changed by mutate(xml) -> xml; returns (styles, new index)."""
    block, xfs = _xfs(styles)
    new = mutate(xfs[idx])
    assert new != xfs[idx], idx
    xfs.append(new)
    inner = "".join(xfs)
    head = re.sub(r'count="\d+"', f'count="{len(xfs)}"', block.group(0)[: block.group(0).index(">") + 1])
    return styles[: block.start()] + head + inner + "</cellXfs>" + styles[block.end():], len(xfs) - 1


def with_alignment(xml, **attrs):
    """The xf with these alignment attributes added (an <alignment> element created when missing)."""
    extra = "".join(f' {k}="{v}"' for k, v in attrs.items())
    if "<alignment" in xml:
        return re.sub(r"<alignment\b([^>]*?)/>", lambda m: f"<alignment{m.group(1)}{extra}/>", xml, count=1)
    if xml.endswith("/>"):
        xml = xml[:-2] + f' applyAlignment="1"><alignment{extra}/></xf>'
    else:
        xml = xml.replace("</xf>", f"<alignment{extra}/></xf>", 1)
    return xml


def restyle(sheet_xml, refs, old, new):
    """Cells `refs` (or every cell of the sheet when refs is None) with style `old` get style `new`; returns count."""
    n = 0

    def fix(m):
        nonlocal n
        if refs is None or m.group(1) in refs:
            n += 1
            return f'<c r="{m.group(1)}" s="{new}"'
        return m.group(0)

    out = re.sub(rf'<c r="([A-Z]+\d+)" s="{old}"', fix, sheet_xml)
    return out, n


def set_row_height(sheet_xml, r, ht):
    m = re.search(rf'<row r="{r}"[^>]*>', sheet_xml)
    assert m, r
    tag = m.group(0)
    assert 'customHeight="1"' in tag, tag
    new = re.sub(r'ht="[\d.]+"', f'ht="{ht}"', tag)
    assert new != tag
    return sheet_xml.replace(tag, new, 1)


# ------------------------------------------------------------------------------------------ 1: abbreviations
def abbreviations(sheets, styles, log):
    xml = sheets["Abbreviations"]
    for ref, start in (("B14", "C2C = Center to Center"), ("B45", "SD/RG/EG ="), ("B46", "LSD/PSP ="),
                       ("H39", "N/A = Not Applicable (state")):
        m = re.search(rf'<c r="{ref}" s="(\d+)" t="inlineStr"><is><t[^>]*>([^<]*)</t>', xml)
        assert m and m.group(2).startswith(start), (ref, m and m.group(2))
    assert re.search(r'<c r="B14" s="154"', xml) and re.search(r'<c r="H39" s="325"', xml)
    styles, wrap_left = clone_xf(styles, 154, lambda x: with_alignment(x, wrapText="1"))
    styles, wrap_right = clone_xf(styles, 325, lambda x: with_alignment(x, wrapText="1"))
    xml, n1 = restyle(xml, {"B14", "B45", "B46"}, 154, wrap_left)
    xml, n2 = restyle(xml, {"H39"}, 325, wrap_right)
    assert (n1, n2) == (3, 1), (n1, n2)
    for r, ht in ((14, 26.7), (45, 26.7), (46, 26.7), (39, 40.05)):
        xml = set_row_height(xml, r, ht)
    assert xml.count('<pageSetup orientation="portrait" scale="99"/>') == 1
    xml = xml.replace('<pageSetup orientation="portrait" scale="99"/>', '<pageSetup orientation="portrait" scale="92"/>')
    sheets["Abbreviations"] = xml
    log.append(f"  Abbreviations: B14, B45, B46 wrap (style {wrap_left}), H39 wraps (style {wrap_right});"
               " rows 14 / 45 / 46 = 26.7 pt, row 39 = 40.05 pt; print scale 99 -> 92 % (one page)")
    return styles


# ------------------------------------------------------------------------------------------ 2: Area Served
def area_served(sheets, styles, log):
    xml = sheets["Equipment Summary"]
    cols = set(re.findall(r'<c r="([A-Z]+)\d+" s="517"', xml))
    assert cols == {"C"}, cols
    styles, shrink = clone_xf(styles, 517, lambda x: with_alignment(x, shrinkToFit="1"))
    xml, n = restyle(xml, None, 517, shrink)
    assert n == 160, n
    sheets["Equipment Summary"] = xml
    log.append(f"  Equipment Summary: Area Served (column C, {n} unit lines) shrinks to fit (style 517 -> {shrink})")
    return styles


# ------------------------------------------------------------------------------------------ 3: Hoods fill
def hoods_fill(sheets, styles, log):
    _, xfs = _xfs(styles)
    fills = re.findall(r"<fill>.*?</fill>|<fill/>", re.search(r"<fills\b[^>]*>(.*?)</fills>", styles, re.S).group(1), re.S)
    yellow = {i for i, f in enumerate(fills) if 'patternType="solid"' in f and 'rgb="FFFFFF00"' in f}
    marked = [i for i, x in enumerate(xfs) if int(re.search(r'fillId="(\d+)"', x).group(1)) in yellow]
    assert marked == [287], marked
    xml = sheets["Hoods"]
    styles, plain = clone_xf(styles, 287, lambda x: re.sub(r'\sapplyFill="[^"]*"', "", x.replace('fillId="12"', 'fillId="0"')))
    xml, n = restyle(xml, None, 287, plain)
    assert n == 44, n
    sheets["Hoods"] = xml
    log.append(f"  Hoods: the solid yellow working fill removed from {n} cells (style 287 -> {plain}); the Filter Type"
               " label's conditional yellow when blank stays")
    return styles


# ------------------------------------------------------------------------------------------ 4: NEBB certificates
def nebb_certs(zin, parts, new, wb, log):
    cert_part, cert_rels_part = parts["NEBB Cert "]
    firm_part, firm_rels_part = parts["NEBB Frm Cert"]
    drawing_of = lambda rels_part: re.search(r'Target="\.\./drawings/(drawing\d+\.xml)"', zin.read(rels_part).decode()).group(1)  # noqa: E731
    cert_drawing, firm_drawing = (f"xl/drawings/{drawing_of(p)}" for p in (cert_rels_part, firm_rels_part))
    cert_dr = zin.read(cert_drawing).decode("utf-8")
    firm_dr = zin.read(firm_drawing).decode("utf-8")
    cert_rels_path = cert_drawing.replace("drawings/", "drawings/_rels/") + ".rels"
    firm_rels_path = firm_drawing.replace("drawings/", "drawings/_rels/") + ".rels"
    cert_rels = zin.read(cert_rels_path).decode("utf-8")
    firm_rels = zin.read(firm_rels_path).decode("utf-8")
    # the three technician certificates: page 1 rows 0 and 26, page 2 row 52 (break after row 52, 52 rows a page)
    rows = re.findall(r"<xdr:from><xdr:col>2</xdr:col><xdr:colOff>\d+</xdr:colOff><xdr:row>(\d+)</xdr:row>", cert_dr)
    assert rows == ["0", "26", "52"], rows
    assert cert_dr.count("<xdr:oneCellAnchor>") == 3 and firm_dr.count("<xdr:oneCellAnchor>") == 1
    firm_pic = re.search(r"<xdr:oneCellAnchor>.*</xdr:oneCellAnchor>", firm_dr, re.S).group(0)
    firm_target = re.search(r'Id="(rId\d+)"[^>]*Target="([^"]+)"', firm_rels)
    firm_rid, firm_media = firm_target.group(1), firm_target.group(2)
    assert f'r:embed="{firm_rid}"' in firm_pic
    ids = [int(x) for x in re.findall(r'<xdr:cNvPr id="(\d+)"', cert_dr)]
    rids = [int(x) for x in re.findall(r'Id="rId(\d+)"', cert_rels)]
    new_rid = f"rId{max(rids) + 1}"
    pic = firm_pic.replace("<xdr:row>0</xdr:row>", "<xdr:row>78</xdr:row>", 1)
    assert pic != firm_pic
    pic = re.sub(r'<xdr:cNvPr id="\d+" name="[^"]*"', f'<xdr:cNvPr id="{max(ids) + 1}" name="Picture {len(ids) + 1}"', pic, count=1)
    pic = pic.replace(f'r:embed="{firm_rid}"', f'r:embed="{new_rid}"', 1)
    new[cert_drawing] = cert_dr.replace("</xdr:wsDr>", pic + "</xdr:wsDr>")
    new[cert_rels_path] = cert_rels.replace("</Relationships>", f'<Relationship Id="{new_rid}" Type="{IMAGE_REL}" Target="{firm_media}"/></Relationships>')
    tag = re.search(r'<sheet\b[^>]*name="NEBB Frm Cert"[^>]*/>', wb).group(0)
    assert 'state="visible"' in tag
    wb = wb.replace(tag, tag.replace('state="visible"', 'state="hidden"'), 1)
    log.append(f"  NEBB Cert : the firm certificate ({firm_media.split('/')[-1]}) added as the 4th picture, page 2 second slot"
               f" (row 78); NEBB Frm Cert hidden (its sheet, drawing and picture are kept; the ToC's Appendix A entry covers both)")
    return wb


# ------------------------------------------------------------------------------------------ 5: calibration header
def calibration(sheets, log):
    xml = sheets["Calibration"]
    assert re.search(r'<c r="E11" s="370" t="inlineStr"><is><t>Manufacturer</t>', xml)
    assert re.search(r'<c r="B11" s="369" t="inlineStr"><is><t>Instrument Type</t>', xml)
    xml, n = restyle(xml, {"E11"}, 370, 369)
    assert n == 1
    sheets["Calibration"] = xml
    log.append("  Calibration: header Manufacturer (E11) in the other headers' style (370 -> 369)")


# ------------------------------------------------------------------------------------------ 6: revision
def revision(wb, log):
    wb, n = re.subn(r'(<definedName name="a2b\.TemplateRevision"[^>]*>)"08"(</definedName>)', r'\g<1>"09"\2', wb)
    assert n == 1
    log.append('  a2b.TemplateRevision = "09"')
    return wb


# ------------------------------------------------------------------------------------------ build
def newest_rev08():
    files = sorted(glob.glob(os.path.join(ROOT, "08 - a2b_Blank_TAB_Workbook *.xlsm")), key=os.path.getmtime)
    if not files:
        sys.exit("no revision 08 workbook found")
    return files[-1]


EDITED = ("Abbreviations", "Equipment Summary", "Hoods", "Calibration")


def build(src, out, log):
    with zipfile.ZipFile(src) as zin:
        parts = _sheet_files(zin)
        sheets = {t: zin.read(parts[t][0]).decode("utf-8") for t in EDITED}
        wb = zin.read("xl/workbook.xml").decode("utf-8")
        styles = zin.read("xl/styles.xml").decode("utf-8")
        new = {}
        styles = abbreviations(sheets, styles, log)
        styles = area_served(sheets, styles, log)
        styles = hoods_fill(sheets, styles, log)
        wb = nebb_certs(zin, parts, new, wb, log)
        calibration(sheets, log)
        wb = revision(wb, log)
        for t in EDITED:
            new[parts[t][0]] = sheets[t]
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
        src, out = newest_rev08(), OUT
    log.append(f"Source: {os.path.basename(src)}")
    log.append(f"Output: {os.path.basename(out)}")
    build(src, out, log)
    if len(sys.argv) != 3:
        with open(os.path.join(ROOT, "docs", "build-log-rev09.txt"), "w", encoding="utf-8") as fh:
            fh.write("\n".join(log) + "\n")
    print("\n".join(log))
