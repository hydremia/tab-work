"""Structural check of a revision 09 workbook against its revision 08 source (no LibreOffice needed: revision 09
changes no formula, value, row or column, only styles, four row heights, one print scale, one picture and one hidden
sheet).

    python tools/verify_rev09.py "08 - a2b_Blank_TAB_Workbook 10-12-26.xlsm" "09 - a2b_Blank_TAB_Workbook <date>.xlsm"

Checks: every part other than the expected ones is byte-identical; on the four edited sheets every cell keeps its
formula and value and only the expected cells change style; the four Abbreviations rows have their new heights and
the rest are unchanged; styles.xml gained exactly four cellXfs; NEBB Cert has four pictures (rows 0 / 26 / 52 / 78) over
two pages and the firm sheet is hidden; the revision name reads "09". Exit code 1 on any failure.
"""
import re
import sys
import zipfile

sys.path.insert(0, __import__("os").path.dirname(__file__))
from xlsm_parts import _sheet_files  # noqa: E402

a, b = sys.argv[1], sys.argv[2]
fails = []
checks = 0


def check(name, ok, detail=""):
    global checks
    checks += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}{f' - {detail}' if detail else ''}")
    if not ok:
        fails.append(name)


def cells(xml):
    """ref -> (style, formula, value) for every cell."""
    out = {}
    for m in re.finditer(r'<c r="([A-Z]+\d+)"([^>]*)(?:/>|>(.*?)</c>)', xml, re.S):
        s = re.search(r's="(\d+)"', m.group(2))
        body = m.group(3) or ""
        f = re.search(r"<f\b[^>]*>(.*?)</f>|<f\b[^>]*/>", body, re.S)
        v = re.search(r"<v>(.*?)</v>|<is>(.*?)</is>", body, re.S)
        out[m.group(1)] = (s.group(1) if s else None, f.group(0) if f else None, v.group(0) if v else None)
    return out


def rows(xml):
    return {m.group(1): m.group(0) for m in re.finditer(r'<row r="(\d+)"[^>]*>', xml)}


with zipfile.ZipFile(a) as za, zipfile.ZipFile(b) as zb:
    pa, pb = _sheet_files(za), _sheet_files(zb)
    names_a, names_b = {i.filename for i in za.infolist()}, {i.filename for i in zb.infolist()}
    check("same parts", names_a == names_b, f"{sorted(names_a ^ names_b)}")
    cert_dr = re.search(r'Target="\.\./drawings/(drawing\d+\.xml)"', za.read(pb["NEBB Cert "][1]).decode()).group(1)
    expected = {pb[t][0] for t in ("Abbreviations", "Equipment Summary", "Hoods", "Calibration")} | {
        "xl/workbook.xml", "xl/styles.xml", f"xl/drawings/{cert_dr}", f"xl/drawings/_rels/{cert_dr}.rels"}
    changed = {n for n in names_a & names_b if za.read(n) != zb.read(n)}
    check("only the expected parts changed", changed == expected, f"unexpected: {sorted(changed - expected)}, missing: {sorted(expected - changed)}")

    # sheets: formulas and values identical; styles differ only where meant
    allowed = {
        "Abbreviations": {"B14", "B45", "B46", "H39"},
        "Equipment Summary": {f"C{r}" for r in range(1, 174)},
        "Hoods": None,  # style 287 cells only (checked below)
        "Calibration": {"E11"},
    }
    for t, refs in allowed.items():
        ca, cb = cells(za.read(pa[t][0]).decode()), cells(zb.read(pb[t][0]).decode())
        check(f"{t}: same cells", set(ca) == set(cb))
        fv_same = all(ca[r][1:] == cb[r][1:] for r in ca)
        check(f"{t}: every formula and value unchanged", fv_same)
        diff = {r for r in ca if ca[r][0] != cb[r][0]}
        if t == "Hoods":
            check("Hoods: only the 44 yellow cells restyled", len(diff) == 44 and all(ca[r][0] == "287" for r in diff), f"{len(diff)}")
        elif t == "Equipment Summary":
            check("Equipment Summary: only Area Served cells restyled", diff and diff <= refs and all(ca[r][0] == "517" for r in diff), f"{len(diff)}")
        else:
            check(f"{t}: only {sorted(refs)} restyled", diff == refs, f"{sorted(diff)}")
    ra, rb = rows(za.read(pa["Abbreviations"][0]).decode()), rows(zb.read(pb["Abbreviations"][0]).decode())
    changed_rows = {r for r in ra if ra[r] != rb.get(r)}
    check("Abbreviations: rows 14 / 39 / 45 / 46 are the only row changes", changed_rows == {"14", "39", "45", "46"}, f"{sorted(changed_rows)}")
    check("Abbreviations: row heights", 'ht="26.7"' in rb["14"] and 'ht="40.05"' in rb["39"] and 'ht="26.7"' in rb["45"] and 'ht="26.7"' in rb["46"])
    xb = zb.read(pb["Abbreviations"][0]).decode()
    check("Abbreviations: print scale 92", '<pageSetup orientation="portrait" scale="92"/>' in xb)
    for t in ("Equipment Summary", "Hoods", "Calibration"):
        check(f"{t}: rows unchanged", rows(za.read(pa[t][0]).decode()) == rows(zb.read(pb[t][0]).decode()))

    sa, sb = za.read("xl/styles.xml").decode(), zb.read("xl/styles.xml").decode()
    n = lambda s: len(re.findall(r"<xf\b", re.search(r"<cellXfs\b[^>]*>(.*?)</cellXfs>", s, re.S).group(1)))  # noqa: E731
    check("styles: four cellXfs added, nothing else", n(sb) == n(sa) + 4 and re.sub(r"<cellXfs\b.*?</cellXfs>", "", sa, flags=re.S) == re.sub(r"<cellXfs\b.*?</cellXfs>", "", sb, flags=re.S), f"{n(sa)} -> {n(sb)}")
    xfs_b = re.findall(r"<xf\b[^>]*/>|<xf\b[^>]*>.*?</xf>", re.search(r"<cellXfs\b[^>]*>(.*?)</cellXfs>", sb, re.S).group(1), re.S)
    check("styles: the new xfs are wrap, wrap, shrink-to-fit and fill-less copies",
          'wrapText="1"' in xfs_b[-4] and 'wrapText="1"' in xfs_b[-3] and 'shrinkToFit="1"' in xfs_b[-2] and 'fillId="0"' in xfs_b[-1])

    dr = zb.read(f"xl/drawings/{cert_dr}").decode()
    pic_rows = re.findall(r"<xdr:row>(\d+)</xdr:row>", dr)
    check("NEBB Cert: four pictures at rows 0 / 26 / 52 / 78 (two a page, break after row 52)", pic_rows == ["0", "26", "52", "78"], f"{pic_rows}")
    rels = zb.read(f"xl/drawings/_rels/{cert_dr}.rels").decode()
    embeds = set(re.findall(r'r:embed="(rId\d+)"', dr))
    check("NEBB Cert: every picture's image relationship exists", all(f'Id="{e}"' in rels for e in embeds) and len(embeds) == 4)
    wb = zb.read("xl/workbook.xml").decode()
    check("NEBB Frm Cert hidden", re.search(r'<sheet\b[^>]*name="NEBB Frm Cert"[^>]*state="hidden"', wb) is not None)
    check("NEBB Cert visible, print area A1:N104 with the break at 52",
          re.search(r'<sheet\b[^>]*name="NEBB Cert "[^>]*state="visible"', wb) is not None
          and "'NEBB Cert '!$A$1:$N$104" in wb and '<brk id="52"' in zb.read(pb["NEBB Cert "][0]).decode())
    check('a2b.TemplateRevision = "09"', re.search(r'<definedName name="a2b\.TemplateRevision"[^>]*>"09"</definedName>', wb) is not None)
    wa = za.read("xl/workbook.xml").decode()
    norm = lambda s: re.sub(r'"0[89]"</definedName>', "", s).replace('name="NEBB Frm Cert" sheetId="22" state="hidden"', 'name="NEBB Frm Cert" sheetId="22" state="visible"')  # noqa: E731
    check("workbook.xml: nothing else changed", norm(wa) == norm(wb))

print(f"\n{checks - len(fails)}/{checks} checks passed" + (f"; FAILED: {fails}" if fails else ""))
sys.exit(1 if fails else 0)
