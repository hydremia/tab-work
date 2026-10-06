"""A small editor for worksheet XML (the template's sheets: inline strings, no shared formulas).

Only what the template builds need: read / write single cells (text, number, formula, blank with a style), copy a
cell's style, row heights, merges, data validations, conditional formats and print breaks. Everything else in the
part (sheet views, page setup, header / footer, drawings, controls, extLst) is kept byte-for-byte.

    sh = Sheet(xml)
    sh.text("B6", "Drive Type:", style="425")
    sh.formula("G18", 'IF(E20="","",E20*2)', style=sh.style("E19"))
    sh.merge("B21:D21")
    xml = sh.xml()
"""
import re
from xml.sax.saxutils import escape


def col_num(col):
    n = 0
    for ch in col:
        n = n * 26 + ord(ch) - 64
    return n


def col_letter(n):
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def split_ref(ref):
    m = re.fullmatch(r"([A-Z]+)(\d+)", ref)
    return m.group(1), int(m.group(2))


def cols(a, b):
    return [col_letter(i) for i in range(col_num(a), col_num(b) + 1)]


def _expand(sqref):
    """'B2:C3 D5' -> {'B2','C2','B3','C3','D5'}"""
    out = set()
    for part in sqref.split():
        if ":" in part:
            a, b = part.split(":")
            ca, ra = split_ref(a)
            cb, rb = split_ref(b)
            for r in range(ra, rb + 1):
                for c in range(col_num(ca), col_num(cb) + 1):
                    out.add(f"{col_letter(c)}{r}")
        else:
            out.add(part)
    return out


class Sheet:
    def __init__(self, xml):
        m = re.search(r"<sheetData>(.*?)</sheetData>|<sheetData\s*/>", xml, re.S)
        self.head, self.tail = xml[: m.start()], xml[m.end():]
        inner = m.group(1) or ""
        self.rows = {}  # r -> [attrs (without r / spans), {col: cell xml}]
        for rm in re.finditer(r"<row\b([^>]*?)(?:/>|>(.*?)</row>)", inner, re.S):
            attrs = rm.group(1)
            r = int(re.search(r'\br="(\d+)"', attrs).group(1))
            attrs = re.sub(r'\s(r|spans)="[^"]*"', "", attrs)
            cells = {}
            for cm in re.finditer(r"<c\b[^>]*/>|<c\b[^>]*>.*?</c>", rm.group(2) or "", re.S):
                ref = re.search(r'\br="([A-Z]+)\d+"', cm.group(0)).group(1)
                cells[ref] = cm.group(0)
            self.rows[r] = [attrs, cells]
        mc = re.search(r"<mergeCells\b[^>]*>(.*?)</mergeCells>", self.tail, re.S)
        self.merges = re.findall(r'<mergeCell ref="([^"]+)"/>', mc.group(1)) if mc else []

    # ---------------------------------------------------------------------------- cells
    def _row(self, r):
        if r not in self.rows:
            self.rows[r] = [' ht="13.35" customHeight="1" s="162"', {}]
        return self.rows[r]

    def cell(self, ref):
        c, r = split_ref(ref)
        return self.rows.get(r, [None, {}])[1].get(c)

    def style(self, ref):
        x = self.cell(ref)
        m = re.search(r'\bs="(\d+)"', x) if x else None
        return m.group(1) if m else None

    def value(self, ref):
        """Text of an inline string, the number, or the formula ('=' + text); None when blank."""
        x = self.cell(ref)
        if not x:
            return None
        f = re.search(r"<f>(.*?)</f>", x, re.S)
        if f:
            return "=" + _unescape(f.group(1))
        t = re.search(r"<t[^>]*>(.*?)</t>", x, re.S)
        if t:
            return _unescape(t.group(1))
        v = re.search(r"<v>([^<]+)</v>", x)
        return float(v.group(1)) if v else None

    def _put(self, ref, body, style, t=None):
        c, r = split_ref(ref)
        if style == "keep":
            style = self.style(ref)
        s = f' s="{style}"' if style is not None else ""
        tt = f' t="{t}"' if t else ""
        self._row(r)[1][c] = f'<c r="{ref}"{s}{tt}>{body}</c>' if body is not None else f'<c r="{ref}"{s}/>'

    def text(self, ref, text, style="keep"):
        sp = ' xml:space="preserve"' if text != text.strip() else ""
        self._put(ref, f"<is><t{sp}>{escape(text)}</t></is>", style, "inlineStr")

    def number(self, ref, n, style="keep"):
        self._put(ref, f"<v>{n}</v>", style)

    def formula(self, ref, f, style="keep"):
        if f.startswith("="):
            f = f[1:]
        self._put(ref, f"<f>{escape(f)}</f><v></v>", style)

    def blank(self, ref, style="keep"):
        self._put(ref, None, style)

    def delete(self, ref):
        c, r = split_ref(ref)
        if r in self.rows:
            self.rows[r][1].pop(c, None)

    def clear_row(self, r, keep_attrs=True):
        attrs = self.rows[r][0] if (keep_attrs and r in self.rows) else ' ht="13.35" customHeight="1" s="162"'
        self.rows[r] = [attrs, {}]

    def row_cells(self, r):
        return dict(self.rows.get(r, [None, {}])[1])

    def set_row_cells(self, r, cells, attrs=None):
        """cells: {col: xml} (any r= inside is rewritten to row r)."""
        new = {c: re.sub(r'\br="([A-Z]+)\d+"', lambda m: f'r="{m.group(1)}{r}"', x, count=1) for c, x in cells.items()}
        self.rows[r] = [attrs if attrs is not None else self._row(r)[0], new]

    def row_height(self, r, ht):
        a = self._row(r)
        a[0] = re.sub(r'\sht="[\d.]+"', "", a[0])
        a[0] = f' ht="{ht}"' + (a[0] if "customHeight" in a[0] else ' customHeight="1"' + a[0])

    def row_attrs(self, r):
        return self._row(r)[0]

    # ---------------------------------------------------------------------------- merges
    def unmerge_rows(self, r1, r2):
        def inside(ref):
            a = ref.split(":")[0]
            return r1 <= split_ref(a)[1] <= r2
        self.merges = [m for m in self.merges if not inside(m)]

    def unmerge(self, ref):
        self.merges = [m for m in self.merges if m != ref]

    def merge(self, ref):
        if ref not in self.merges:
            self.merges.append(ref)

    # ---------------------------------------------------------------------------- validations / formats
    def validation_refs(self, formula1):
        m = re.search(rf'<dataValidation\b[^>]*sqref="([^"]*)"[^>]*>\s*<formula1>{re.escape(formula1)}</formula1>', self.tail)
        return m.group(1).split() if m else []

    def set_validation(self, formula1, refs, template_formula1=None):
        """Replace the sqref of the list validation on `formula1` (added, copying another validation's attributes,
        when it does not exist yet)."""
        sq = " ".join(refs)
        pat = rf'(<dataValidation\b[^>]*sqref=")[^"]*("[^>]*>\s*<formula1>{re.escape(formula1)}</formula1>)'
        if re.search(pat, self.tail):
            self.tail = re.sub(pat, lambda m: m.group(1) + sq + m.group(2), self.tail, count=1)
            return
        dv = (f'<dataValidation sqref="{sq}" showDropDown="0" showInputMessage="0" showErrorMessage="0" allowBlank="1" '
              f'type="list"><formula1>{formula1}</formula1></dataValidation>')
        if "<dataValidations" in self.tail:
            self.tail = re.sub(r"</dataValidations>", dv + "</dataValidations>", self.tail, count=1)
        else:
            self._insert_before(["hyperlinks", "printOptions", "pageMargins"], f'<dataValidations count="1">{dv}</dataValidations>')
        self._recount("dataValidations", "dataValidation")

    def drop_validation_refs(self, refs):
        """Remove cells from every validation's sqref (a validation left with none is removed)."""
        drop = set(refs)

        def fix(m):
            keep = [x for x in m.group(2).split() if not (_expand(x) & drop)]
            return "" if not keep else m.group(1) + " ".join(keep) + m.group(3)
        self.tail = re.sub(r'(<dataValidation\b[^>]*sqref=")([^"]*)("[^>]*>.*?</dataValidation>)', fix, self.tail, flags=re.S)
        self._recount("dataValidations", "dataValidation")

    def add_conditional(self, sqref, formula, dxf, priority=None):
        prio = priority or (max([int(p) for p in re.findall(r'priority="(\d+)"', self.tail)] or [0]) + 1)
        cf = (f'<conditionalFormatting sqref="{sqref}"><cfRule type="expression" priority="{prio}" dxfId="{dxf}">'
              f"<formula>{escape(formula)}</formula></cfRule></conditionalFormatting>")
        last = list(re.finditer(r"</conditionalFormatting>", self.tail))
        if last:
            i = last[-1].end()
            self.tail = self.tail[:i] + cf + self.tail[i:]
        else:
            self._insert_before(["dataValidations", "hyperlinks", "printOptions", "pageMargins"], cf)

    def add_breaks(self, rows):
        old = sorted({int(b) for b in re.findall(r'<brk id="(\d+)"', self.tail)} | set(rows))
        rb = f'<rowBreaks count="{len(old)}" manualBreakCount="{len(old)}">' + "".join(
            f'<brk id="{b}" max="16383" man="1"/>' for b in old) + "</rowBreaks>"
        if re.search(r"<rowBreaks\b", self.tail):
            self.tail = re.sub(r"<rowBreaks\b.*?</rowBreaks>|<rowBreaks\b[^>]*/>", rb, self.tail, count=1, flags=re.S)
        else:
            self._insert_before(["colBreaks", "customProperties", "cellWatches", "ignoredErrors", "smartTags", "drawing",
                                 "legacyDrawing", "legacyDrawingHF", "picture", "oleObjects", "controls", "tableParts",
                                 "extLst"], rb)

    def _insert_before(self, names, frag):
        for n in names:
            m = re.search(rf"<{n}\b", self.tail)
            if m:
                self.tail = self.tail[: m.start()] + frag + self.tail[m.start():]
                return
        self.tail = self.tail.replace("</worksheet>", frag + "</worksheet>")

    def _recount(self, outer, inner):
        n = len(re.findall(rf"<{inner}\b", self.tail))
        if n == 0:
            self.tail = re.sub(rf"<{outer}\b[^>]*>\s*</{outer}>", "", self.tail)
        else:
            self.tail = re.sub(rf'(<{outer}\b[^>]*count=")\d+(")', rf"\g<1>{n}\2", self.tail, count=1)

    # ---------------------------------------------------------------------------- output
    def xml(self):
        out = []
        for r in sorted(self.rows):
            attrs, cells = self.rows[r]
            body = "".join(cells[c] for c in sorted(cells, key=col_num))
            out.append(f'<row r="{r}"{attrs}>{body}</row>' if body else f'<row r="{r}"{attrs}></row>')
        tail = self.tail
        if self.merges:
            mc = f'<mergeCells count="{len(self.merges)}">' + "".join(f'<mergeCell ref="{m}"/>' for m in self.merges) + "</mergeCells>"
            if re.search(r"<mergeCells\b", tail):
                tail = re.sub(r"<mergeCells\b.*?</mergeCells>", mc, tail, count=1, flags=re.S)
            else:
                tail = mc + tail
        head = self.head
        last = max(self.rows) if self.rows else 1
        dim = re.search(r'<dimension ref="([A-Z]+\d+):([A-Z]+)(\d+)"', head)
        if dim and int(dim.group(3)) < last:
            head = head.replace(dim.group(0), f'<dimension ref="{dim.group(1)}:{dim.group(2)}{last}"', 1)
        return head + "<sheetData>" + "".join(out) + "</sheetData>" + tail


def _unescape(s):
    return s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'").replace("&amp;", "&")


def shift_row_refs(xml_cell, src, dst):
    """A cell copied from row src to row dst: its address and same-row references in its formula follow."""
    def fix_f(m):
        f = re.sub(rf"(?<![A-Za-z!$'])(\$?[A-Z]{{1,2}}){src}(?!\d)", lambda k: f"{k.group(1)}{dst}", m.group(1))
        return f"<f>{f}</f>"
    x = re.sub(r'\br="([A-Z]+)\d+"', lambda m: f'r="{m.group(1)}{dst}"', xml_cell, count=1)
    return re.sub(r"<f>(.*?)</f>", fix_f, x, flags=re.S)
