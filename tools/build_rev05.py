"""Revision 05 = revision 04 with formulas that tolerate text notations in numeric inputs, plus three fixes.

Build steps (each a function below, each listed in docs/build-log-rev05.txt):

  1. step_cover_links      Cover Page PROJECT NAME / ADDRESS / REPORT DATE point back at {Project Information}
                           E2 / E3 / E14 (rev 04 moved the block and the relative refs moved to E12 / E13 / E24).
  2. step_dropdowns        {Dropdowns} U1:Z12 MAU burner profile-pressure curve restored to the revision 01 values
                           (rev 03 wrote the duct-shape list over W1:W3, rev 04 the unit-type table over X1:AD6);
                           the two lists move to AF1:AF3 and AH1:AN6 and their names / lookups are repointed.
  3. step_notation_guards  every formula: text notations read as blank (below).
  (Building Balance rows for small fans 21-40 are not added: there is room for 10 more exhaust rows only.)

Techs (and later the app) type the report notations from the Abbreviations legend
(N/A, Not Avail., Not Acc., N/L) into numeric input cells.  In revision 04 any
formula doing arithmetic on such a cell showed #VALUE!.  Step 3 rewrites every
formula so that a text value is treated like a blank:

  * each formula is parsed (tokenizer + precedence parser in this file);
  * every single-cell reference used as an arithmetic operand (+ - * / ^, unary
    minus, the ordering comparisons < > <= >=, the numeric arguments of ROUND,
    ROUNDUP, SQRT, ABS, INDEX row/column, ...) is collected;
  * the smallest enclosing sub-expression that is a *result* of the formula (the
    whole formula or a THEN/ELSE branch of an IF chain) is wrapped as
        IF(OR(ISTEXT(ref1),ISTEXT(ref2),...),"",<original sub-expression>)
    so only the branch that would have used the text goes blank; other branches
    (e.g. the 3-phase average when leg 1 reads "Not Acc.") keep computing;
  * AVERAGE(...) whose cells could all be text gets COUNT(...)=0 in the same guard
    (unless an enclosing IF already tests it), so it cannot give #DIV/0!;
  * a text key in a lookup whose failure IFERROR turns into 0 (hood / MAU filter
    size and filter type) is guarded against the notations explicitly, so an N/A
    filter size gives a blank CFM instead of 0.

ISTEXT(empty cell) is FALSE, so blanks and numbers evaluate exactly as before;
the only values that change are ones that were an error in revision 04.
SUM / AVERAGE / COUNT over ranges already skip text, so totals and 3-reading
averages skip N/A cells and average the remaining readings.

Only the changed worksheet XML (formulas, and the {Dropdowns} cells) and the two defined
names in workbook.xml are rewritten; every other part (VBA, drawings, cover photo, styles,
validations, print setup) is copied byte-for-byte from revision 04.

    TAB_BUILD_DATE=9-23-26 python3 tools/build_rev05.py   # newest 04 file -> 05 - a2b_Blank_TAB_Workbook <date>.xlsm
    python3 tools/build_rev05.py --selftest [workbook]    # transform unit cases + parser round-trip of every formula
"""
import datetime as dt
import glob
import html
import os
import re
import sys
import zipfile
from collections import Counter, OrderedDict

sys.path.insert(0, os.path.dirname(__file__))
from xlsm_parts import _sheet_files  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAMP = os.environ.get("TAB_BUILD_DATE", dt.date.today().strftime("%-m-%-d-%y"))
OUT = os.path.join(ROOT, f"05 - a2b_Blank_TAB_Workbook {STAMP}.xlsm")
NOTATIONS = ("N/A", "Not Avail.", "Not Acc.", "N/L")   # Abbreviations sheet, reporting nomenclatures

# --------------------------------------------------------------------------- tokenizer
_SHEET = r"(?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!"
_CELL = r"\$?[A-Z]{1,3}\$?\d+"
_REF_RE = re.compile(
    rf"(?P<sheet>{_SHEET})?(?P<ref>{_CELL}(?::{_CELL})?|\$?[A-Z]{{1,3}}:\$?[A-Z]{{1,3}}|\$?\d+:\$?\d+)(?![\w(])")
_NUM_RE = re.compile(r"\d+(?:\.\d*)?(?:[Ee][+-]?\d+)?|\.\d+(?:[Ee][+-]?\d+)?")
_FUNC_RE = re.compile(r"(?:_xlfn\.)?[A-Za-z_][\w.]*(?=\()")
_NAME_RE = re.compile(r"[A-Za-z_\\][\w.]*")
_OPS = ("<>", "<=", ">=", "+", "-", "*", "/", "^", "&", "=", "<", ">", "%")


class Tok:
    __slots__ = ("kind", "text", "start", "end")

    def __init__(self, kind, text, start):
        self.kind, self.text, self.start, self.end = kind, text, start, start + len(text)

    def __repr__(self):
        return f"{self.kind}:{self.text}"


def tokenize(s):
    toks, i, n = [], 0, len(s)
    while i < n:
        ch = s[i]
        if ch in " \t\r\n":
            i += 1
            continue
        if ch == '"':
            j = i + 1
            while True:
                j = s.index('"', j)
                if j + 1 < n and s[j + 1] == '"':
                    j += 2
                    continue
                break
            toks.append(Tok("STR", s[i:j + 1], i)); i = j + 1; continue
        m = _REF_RE.match(s, i)
        if m and (ch in "$'" or not _FUNC_RE.match(s, i) or m.group("sheet")):
            toks.append(Tok("REF", m.group(0), i)); i = m.end(); continue
        m = _FUNC_RE.match(s, i)
        if m:
            toks.append(Tok("FUNC", m.group(0), i)); i = m.end(); continue
        m = _NUM_RE.match(s, i)
        if m:
            toks.append(Tok("NUM", m.group(0), i)); i = m.end(); continue
        m = _NAME_RE.match(s, i)
        if m:
            toks.append(Tok("NAME", m.group(0), i)); i = m.end(); continue
        if ch == "(":
            toks.append(Tok("LP", ch, i)); i += 1; continue
        if ch == ")":
            toks.append(Tok("RP", ch, i)); i += 1; continue
        if ch == ",":
            toks.append(Tok("COMMA", ch, i)); i += 1; continue
        for op in _OPS:
            if s.startswith(op, i):
                toks.append(Tok("OP", op, i)); i += len(op); break
        else:
            raise ValueError(f"cannot tokenize at {i}: {s[i:i + 20]!r} in {s!r}")
    return toks


# --------------------------------------------------------------------------- parser
class Node:
    __slots__ = ("kind", "op", "kids", "start", "end", "text")

    def __init__(self, kind, start, end, op=None, kids=(), text=None):
        self.kind, self.start, self.end, self.op, self.kids, self.text = kind, start, end, op, list(kids), text


_BIN = [("=", "<>", "<", ">", "<=", ">="), ("&",), ("+", "-"), ("*", "/"), ("^",)]


class Parser:
    def __init__(self, s):
        self.s, self.t, self.i = s, tokenize(s), 0

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else None

    def take(self, kind=None, text=None):
        tok = self.peek()
        if tok is None or (kind and tok.kind != kind) or (text and tok.text != text):
            raise ValueError(f"parse error at token {self.i} ({tok}) in {self.s!r}")
        self.i += 1
        return tok

    def parse(self):
        node = self.expr(0)
        if self.peek() is not None:
            raise ValueError(f"trailing tokens in {self.s!r}")
        return node

    def expr(self, level):
        if level == len(_BIN):
            return self.unary()
        left = self.expr(level + 1)
        while (tok := self.peek()) is not None and tok.kind == "OP" and tok.text in _BIN[level]:
            self.i += 1
            right = self.expr(level + 1)
            left = Node("bin", left.start, right.end, tok.text, (left, right))
        return left

    def unary(self):
        tok = self.peek()
        if tok is not None and tok.kind == "OP" and tok.text in "+-":
            self.i += 1
            kid = self.unary()
            return Node("neg", tok.start, kid.end, tok.text, (kid,))
        node = self.primary()
        while (tok := self.peek()) is not None and tok.kind == "OP" and tok.text == "%":
            self.i += 1
            node = Node("pct", node.start, tok.end, "%", (node,))
        return node

    def primary(self):
        tok = self.take()
        if tok.kind in ("NUM", "STR", "REF", "NAME"):
            return Node(tok.kind.lower(), tok.start, tok.end, text=tok.text)
        if tok.kind == "LP":
            inner = self.expr(0)
            rp = self.take("RP")
            return Node("paren", tok.start, rp.end, kids=(inner,))
        if tok.kind == "FUNC":
            self.take("LP")
            args = []
            if self.peek() is not None and self.peek().kind == "RP":
                rp = self.take("RP")
            else:
                while True:
                    args.append(self.expr(0))
                    nxt = self.take()
                    if nxt.kind == "RP":
                        rp = nxt
                        break
                    if nxt.kind != "COMMA":
                        raise ValueError(f"expected , or ) in {self.s!r}")
            return Node("func", tok.start, rp.end, tok.text.upper().removeprefix("_XLFN."), args)
        raise ValueError(f"unexpected {tok} in {self.s!r}")


def unparse(node, s):
    """Rebuild the text of a node from its children (used for the round-trip self-test)."""
    if not node.kids:
        return s[node.start:node.end]
    out, pos = [], node.start
    for k in node.kids:
        out.append(s[pos:k.start]); out.append(unparse(k, s)); pos = k.end
    out.append(s[pos:node.end])
    return "".join(out)


# --------------------------------------------------------------------------- transform
ARITH = {"+", "-", "*", "/", "^", "<", ">", "<=", ">="}
NUMERIC_FUNCS = {"ROUND", "ROUNDUP", "ROUNDDOWN", "SQRT", "ABS", "INT", "MOD", "POWER", "EXP", "LN", "LOG",
                 "LOG10", "TRUNC", "SIGN", "CEILING", "FLOOR", "PI", "RADIANS", "DEGREES", "SIN", "COS", "TAN"}
# functions whose arguments are handled natively (text in a reference is skipped, or the argument is text / logic)
KNOWN_FUNCS = NUMERIC_FUNCS | {"IF", "IFERROR", "INDEX", "MATCH", "SUM", "AVERAGE", "COUNT", "COUNTA", "MIN", "MAX",
                               "N", "AND", "OR", "NOT", "TEXT", "ISTEXT", "ISNUMBER", "ISBLANK", "LEN", "VLOOKUP"}


def refkey(text):
    """Normalise a single-cell reference for de-duplication ($ and quoting ignored)."""
    if "!" in text:
        sheet, cell = text.rsplit("!", 1)
        sheet = sheet.strip("'").replace("''", "'")
    else:
        sheet, cell = "", text
    return sheet + "!" + cell.replace("$", "")


def is_cell(node):
    return node.kind == "ref" and ":" not in node.text


def cellset(args):
    """Set of cells named by an argument list of plain references (ranges expanded), or None."""
    from openpyxl.utils import range_boundaries
    out = set()
    for part in args.split(","):
        part = part.strip()
        if not re.fullmatch(rf"(?:{_SHEET})?{_CELL}(?::{_CELL})?", part):
            return None
        sheet, _, rng = part.rpartition("!")
        c1, r1, c2, r2 = range_boundaries(rng.replace("$", ""))
        if (c2 - c1 + 1) * (r2 - r1 + 1) > 400:
            return None
        out |= {(sheet.strip("'"), c, r) for c in range(c1, c2 + 1) for r in range(r1, r2 + 1)}
    return frozenset(out)


def count_guards(cond):
    """Cell sets S for which the condition text contains COUNT(S)=0 as itself or as an OR(...) term."""
    cond = cond.strip()
    if not (cond.startswith("COUNT(") or cond.startswith("OR(")):
        return ()
    return tuple(c for c in (cellset(m.group(1)) for m in re.finditer(r"COUNT\(([^()]*)\)=0", cond)) if c)


class Transformer:
    def __init__(self):
        self.notes = Counter()

    def run(self, formula):
        """formula without the leading '='.  Returns the rewritten formula (or the same string)."""
        s = self.s = formula
        root = Parser(s).parse()
        self.wraps = {}                     # id(node) -> OrderedDict(key -> guard term)
        self._walk(root, numeric=False, valuepos=True, known=())
        if not self.wraps:
            return formula
        self._dedupe(root, set())
        if not self.wraps:
            return formula
        return self._emit(root, s)

    def _walk(self, n, numeric, valuepos, known):
        """Returns OrderedDict key -> guard term for references that still need a guard above n.

        known: cell sets proven to hold at least one number here (we are in the ELSE branch
        of an IF whose condition is COUNT(set)=0 or OR(..., COUNT(set)=0, ...))."""
        pend = OrderedDict()

        def merge(d):
            for k, v in d.items():
                pend.setdefault(k, v)

        k = n.kind
        if k == "ref":
            if numeric:
                if is_cell(n):
                    pend[refkey(n.text)] = f"ISTEXT({n.text})"
                else:
                    self.notes["range used as arithmetic operand (left as is)"] += 1
        elif k == "name":
            if numeric and n.text.upper() not in ("TRUE", "FALSE"):
                self.notes[f"name {n.text} used as arithmetic operand (left as is)"] += 1
        elif k == "bin":
            num = n.op in ARITH
            for kid in n.kids:
                merge(self._walk(kid, num, False, known))
        elif k in ("neg", "pct"):
            merge(self._walk(n.kids[0], True, False, known))
        elif k == "paren":
            merge(self._walk(n.kids[0], numeric, False, known))
        elif k == "func":
            f = n.op
            if f not in KNOWN_FUNCS:
                self.notes[f"function {f} not classified (arguments treated as non-numeric)"] += 1
            if f == "AVERAGE" and n.kids:
                # AVERAGE over cells that all hold text (or nothing) is #DIV/0!
                args = self.s[n.kids[0].start:n.kids[-1].end]
                cells = cellset(args)
                if cells is None or not any(c <= cells for c in known):
                    pend["count:" + args] = f"COUNT({args})=0"
            for i, a in enumerate(n.kids):
                if f == "IF":
                    if i == 0:
                        merge(self._walk(a, False, False, known))
                    elif i == 1:
                        merge(self._walk(a, numeric, valuepos, known))
                    else:
                        merge(self._walk(a, numeric, valuepos, known + count_guards(self.s[n.kids[0].start:n.kids[0].end])))
                elif f == "IFERROR":
                    if i == 0 and numeric:
                        merge(self._lookup_keys(a))
                    merge(self._walk(a, numeric, False, known))
                elif f in NUMERIC_FUNCS:
                    merge(self._walk(a, True, False, known))
                elif f == "INDEX":
                    merge(self._walk(a, i > 0, False, known))
                elif f == "MATCH":
                    merge(self._walk(a, i == 2, False, known))
                else:
                    merge(self._walk(a, False, False, known))
        if valuepos and pend:
            self.wraps[id(n)] = pend
            return OrderedDict()
        return pend

    def _lookup_keys(self, n):
        """Text keys of MATCH lookups inside IFERROR(...) used in arithmetic: a notation there gives a blank."""
        out = OrderedDict()

        def keys(e):
            if is_cell(e):
                return [e]
            if e.kind == "bin" and e.op == "&":
                return [r for kid in e.kids for r in keys(kid)]
            if e.kind == "paren":
                return keys(e.kids[0])
            return []

        def visit(e):
            if e.kind == "func" and e.op == "MATCH" and e.kids:
                for r in keys(e.kids[0]):
                    key = "notation:" + refkey(r.text)
                    out.setdefault(key, ",".join(f'{r.text}="{t}"' for t in NOTATIONS))
            for kid in e.kids:
                visit(kid)

        visit(n)
        return out

    def _dedupe(self, n, guarded):
        g = self.wraps.get(id(n))
        if g is not None:
            for key in [key for key in g if key in guarded]:
                del g[key]
            if not g:
                del self.wraps[id(n)]
            else:
                guarded = guarded | set(g)
        for kid in n.kids:
            self._dedupe(kid, guarded)

    def _emit(self, n, s):
        if n.kids:
            out, pos = [], n.start
            for kid in n.kids:
                out.append(s[pos:kid.start]); out.append(self._emit(kid, s)); pos = kid.end
            out.append(s[pos:n.end])
            text = "".join(out)
        else:
            text = s[n.start:n.end]
        g = self.wraps.get(id(n))
        if g:
            terms = list(g.values())
            cond = terms[0] if len(terms) == 1 and "," not in terms[0] else "OR(" + ",".join(terms) + ")"
            text = f'IF({cond},"",{text})'
        return text


# --------------------------------------------------------------------------- XML helpers
_CELL_F = re.compile(r'(<c r="([A-Z]+\d+)"[^>]*>)<f>([^<]*)</f>')
_CELL_ANY = re.compile(r'<c r="([A-Z]+)(\d+)"[^>]*?(?:/>|>.*?</c>)', re.S)


def xml_esc(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def get_formula(xml, coord):
    m = re.search(rf'<c r="{coord}"[^>]*><f>([^<]*)</f>', xml)
    return html.unescape(m.group(1)) if m else None


def set_formula(xml, coord, old, new):
    """Replace the formula of one cell; refuses if the current formula is not `old`."""
    cur = get_formula(xml, coord)
    if cur != old:
        raise ValueError(f"{coord}: expected ={old}, found ={cur}")
    return re.sub(rf'(<c r="{coord}"[^>]*>)<f>[^<]*</f>', lambda m: m.group(1) + "<f>" + xml_esc(new) + "</f>", xml, 1)


def _cell_xml(coord, value, style):
    s = f' s="{style}"' if style else ""
    if isinstance(value, (int, float)):
        return f'<c r="{coord}"{s} t="n"><v>{value!r}</v></c>'
    return f'<c r="{coord}"{s} t="inlineStr"><is><t>{xml_esc(value)}</t></is></c>'


def set_values(xml, values):
    """values: {coord: str | number | None}.  Rewrites those cells (None removes the value) in rows that exist,
    keeping every other cell of the row byte-for-byte and the existing style of a replaced cell."""
    from openpyxl.utils import column_index_from_string as ci
    byrow = {}
    for coord, v in values.items():
        m = re.fullmatch(r"([A-Z]+)(\d+)", coord)
        byrow.setdefault(int(m.group(2)), {})[m.group(1)] = v
    for r, cols in byrow.items():
        m = re.search(rf'(<row r="{r}"[^>]*>)(.*?)(</row>)', xml, re.S)
        if not m:
            raise ValueError(f"row {r} not present")
        cells = [(c.group(1), c.group(0)) for c in _CELL_ANY.finditer(m.group(2))]
        if "".join(x for _, x in cells) != m.group(2):
            raise ValueError(f"row {r}: unexpected content")
        cur = dict(cells)
        for col, v in cols.items():
            st = re.search(r' s="(\d+)"', cur.get(col, ""))
            if v is None:
                cur.pop(col, None)
            else:
                cur[col] = _cell_xml(f"{col}{r}", v, st.group(1) if st else None)
        body = "".join(cur[c] for c in sorted(cur, key=ci))
        xml = xml[:m.start()] + m.group(1) + body + m.group(3) + xml[m.end():]
    return xml


# --------------------------------------------------------------------------- build steps
def step_cover_links(parts, titles, log):
    """Cover Page project lines: rev 04 shifted the cover block down 10 rows and the relative references
    into {Project Information} moved with it (E2 -> E12, E3 -> E13, E14 -> E24).  Point them back at
    Project Name (E2), Physical Address (E3) and Report Date (E14)."""
    part = titles["Cover Page"]
    xml = parts[part]
    pi = "'{Project Information}'!"
    for coord, wrong, right, label in (("G32", "E12", "E2", "PROJECT NAME"), ("G34", "E13", "E3", "PROJECT ADDRESS"),
                                       ("G36", "E24", "E14", "REPORT DATE")):
        xml = set_formula(xml, coord, f'IF({pi}{wrong}="","",{pi}{wrong})', f'IF({pi}{right}="","",{pi}{right})')
        log.append(f"  Cover Page {coord} ({label}): {{Project Information}}!{wrong} -> {right}")
    log.append("  Cover Page G38 / G40 / G42 (contractor, engineer, architect) use absolute refs $E$8 / $E$5 / $E$4: correct")
    parts[part] = xml


# MAU direct-fired burner profile-pressure curve, {Dropdowns} U1:Z12 as built in revision 01
PROFILE_CURVE = [
    ["Profile Pressure (in. w.g.)", "Housing Size 1 CFM", "Housing Size 2 CFM", "Housing Size 3 CFM",
     "Housing Size 4 CFM", "Housing Size 5 CFM"],
    [0.15, 697.15, 2035.5, 1740.9, 3037.188, 4212.45], [0.2, 805.62, 2400, 1908.9, 3537.504, 9500],
    [0.25, 1166.76, 2718.6, 2289, 3931.944, 12730.5], [0.3, 1779.53, 3000, 4036.2, 4444.716, 15000],
    [0.35, 2036.25, 3346.5, 4676.7, 4795.56, 17008.5], [0.4, 2291.85, 4000, 4845, 6439.752, 19200],
    [0.45, 2450.196, 5209.5, 4979.1, 6769.836, 20976], [0.5, 2655.768, 5600, 5159.7, 6873.636, 21800],
    [0.55, 2797.446, 5778.75, 6913.2, 7500, 22287], [0.6, 2958.57, 6300, 7919.1, 13562.508, 23500],
    [0.65, 3139.14, 6589.5, 8820, 16000, 24598.5],
]
DUCT_SHAPE_OLD, DUCT_SHAPE_NEW = "W", "AF"                   # list W1:W3 -> AF1:AF3
UNIT_OLD = ["X", "Y", "Z", "AA", "AB", "AC", "AD"]           # table X1:AD6 -> AH1:AN6
UNIT_NEW = ["AH", "AI", "AJ", "AK", "AL", "AM", "AN"]


def step_dropdowns(parts, titles, log, wb_part="xl/workbook.xml"):
    """Restore the profile-pressure curve in {Dropdowns} U1:Z12 (rev 03 wrote the duct-shape list over W1:W3 and
    rev 04 the unit-type table over X1:AD6), move both lists to free columns and repoint names and lookups."""
    part = titles["{Dropdowns}"]
    xml = parts[part]
    from openpyxl.utils import get_column_letter as gl
    # read what is there now (the moved lists), from the XML
    def val(coord):
        m = re.search(rf'<c r="{coord}"[^>]*?(?:/>|>(.*?)</c>)', xml, re.S)
        if not m or not m.group(1):
            return None
        body = m.group(1)
        t = re.search(r"<t[^>]*>(.*?)</t>", body, re.S)
        if t:
            return html.unescape(t.group(1))
        v = re.search(r"<v>(.*?)</v>", body)
        x = float(v.group(1))
        return int(x) if x.is_integer() else x
    shape = {r: val(f"{DUCT_SHAPE_OLD}{r}") for r in range(1, 4)}
    unit = {(c, r): val(f"{c}{r}") for c in UNIT_OLD for r in range(1, 7)}
    if shape[1] != "Duct Shape" or unit[("X", 1)] != "Unit Type":
        raise ValueError("{Dropdowns} W1 / X1 do not hold the lists this step expects")
    values = {}
    for r in range(1, 13):
        for i, v in enumerate(PROFILE_CURVE[r - 1]):
            values[f"{gl(21 + i)}{r}"] = v                   # U..Z
    for c in UNIT_OLD[3:]:                                  # AA..AD are not part of the curve: clear
        for r in range(1, 7):
            values[f"{c}{r}"] = None
    for r in range(1, 4):
        values[f"{DUCT_SHAPE_NEW}{r}"] = shape[r]
    for (c, r), v in unit.items():
        values[f"{UNIT_NEW[UNIT_OLD.index(c)]}{r}"] = v
    restored = sum(1 for r in range(1, 13) for i in range(6)
                   if val(f"{gl(21 + i)}{r}") != PROFILE_CURVE[r - 1][i])
    xml = set_values(xml, values)
    xml = xml.replace('<dimension ref="A1:AD50"/>', '<dimension ref="A1:AN50"/>', 1)
    parts[part] = xml
    log.append(f"  {{Dropdowns}} U1:Z12 profile-pressure curve restored from revision 01 ({restored} of 72 cells were overwritten)")
    log.append(f"  Duct Shape list W1:W3 -> {DUCT_SHAPE_NEW}1:{DUCT_SHAPE_NEW}3; unit-type table X1:AD6 -> AH1:AN6")
    # defined names
    wb = parts[wb_part]
    for name, old, new in (("Duct.Shape", "$W$2:$W$3", "$AF$2:$AF$3"), ("Unit.Type", "$X$2:$X$6", "$AH$2:$AH$6")):
        tag_old = f"<definedName name=\"{name}\">'{{Dropdowns}}'!{old}</definedName>"
        if wb.count(tag_old) != 1:
            raise ValueError(f"defined name {name} not as expected")
        wb = wb.replace(tag_old, tag_old.replace(old, new))
        log.append(f"  defined name {name}: {old} -> {new} (data validations use the name)")
    parts[wb_part] = wb
    # lookups in the unit sheets
    reps = (("'{Dropdowns}'!$Y$2:$AD$6", "'{Dropdowns}'!$AI$2:$AN$6"),
            ("'{Dropdowns}'!$X$2:$X$6", "'{Dropdowns}'!$AH$2:$AH$6"))
    for title, p in titles.items():
        x = parts[p]
        n = sum(x.count(a) for a, _ in reps)
        if n:
            for a, b in reps:
                x = x.replace(a, b)
            parts[p] = x
            log.append(f"  {title}: {n} unit-type lookup references repointed")
        if re.search(r"Dropdowns\}'!\$?(?:W|X|Y|Z|AA|AB|AC|AD)\$?[1-6](?!\d)", x) and title != "{Dropdowns}":
            leftover = re.findall(r"Dropdowns\}'!\$?(?:W|X|Y|Z|AA|AB|AC|AD)\$?\d+[^,)]*", x)
            if any(not s.startswith(("Dropdowns}'!$V$", "Dropdowns}'!$U$")) for s in leftover):
                raise ValueError(f"{title}: unexpected reference into the moved lists: {leftover[:3]}")



def step_remove_mau_traverse(parts, titles, log, wb_part="xl/workbook.xml"):
    """Drop "Traverse" from the MAU "Method used" list: no method-total formula handles it (user decision 2026-09-23)."""
    part = titles["{Dropdowns}"]
    xml = parts[part]
    cell = '<c r="T6" t="inlineStr"><is><t>Traverse</t></is></c>'
    if xml.count(cell) != 1:
        raise ValueError("{Dropdowns}!T6 does not hold the Traverse method as expected")
    parts[part] = xml.replace(cell, '<c r="T6"/>')
    wb = parts[wb_part]
    old = "<definedName name=\"Airflow.Method\">'{Dropdowns}'!$T$2:$T$6</definedName>"
    if wb.count(old) != 1:
        raise ValueError("defined name Airflow.Method not as expected")
    parts[wb_part] = wb.replace(old, old.replace("$T$6", "$T$5"))
    for title, p in titles.items():
        if title != "{Dropdowns}" and "'{Dropdowns}'!$T$" in parts[p]:
            raise ValueError(f"{title}: direct reference into the method list")
    log.append("  {Dropdowns}!T6 'Traverse' removed; Airflow.Method now $T$2:$T$5 (Outlets, PSP, Filter Grid, Profile Pressure)")


def step_notation_guards(parts, titles, log):
    """Every formula: text notations in numeric inputs read as blank (see module docstring)."""
    tr = Transformer()
    log.append("Formulas rewritten so text notations (" + ", ".join(NOTATIONS) + ") in numeric inputs read as blank:")
    examples, total = [], 0
    for title, part in titles.items():
        xml = parts[part]
        changes = []
        xml2, n = rewrite_sheet_xml(xml, tr, changes)
        log.append(f"  {title}: {n} of {xml.count('<f>')} formulas changed")
        total += n
        seen = set()
        for coord, a, b in changes:
            shape = re.sub(r"\d+", "#", a)
            if shape not in seen and len(seen) < 4:
                seen.add(shape)
                examples.append(f"  {title}!{coord}\n    was  ={a}\n    now  ={b}")
        parts[part] = xml2
    log.append(f"  total: {total} formulas changed")
    for note, k in sorted(tr.notes.items()):
        log.append(f"  note: {note} x{k}")
    return examples


def rewrite_sheet_xml(xml, tr, log_changes=None):
    changed = seen = 0

    def sub(m):
        nonlocal changed, seen
        seen += 1
        src = html.unescape(m.group(3))
        new = tr.run(src)
        if new == src:
            return m.group(0)
        changed += 1
        if log_changes is not None:
            log_changes.append((m.group(2), src, new))
        return f"{m.group(1)}<f>{xml_esc(new)}</f>"

    if re.search(r"<f [^>]*>", xml):
        raise ValueError("shared/array formulas present; the rewrite handles plain <f> only")
    out = _CELL_F.sub(sub, xml)
    if seen != xml.count("<f>"):
        raise ValueError(f"matched {seen} of {xml.count('<f>')} <f> elements")
    return out, changed


def newest_rev04():
    files = sorted(glob.glob(os.path.join(ROOT, "04 - a2b_Blank_TAB_Workbook *.xlsm")), key=os.path.getmtime)
    if not files:
        raise SystemExit("no 04 - a2b_Blank_TAB_Workbook *.xlsm found")
    return files[-1]


def build(src=None, out=OUT):
    src = src or newest_rev04()
    log = [f"Source: {os.path.basename(src)}"]
    with zipfile.ZipFile(src) as zin:
        infos = zin.infolist()
        raw = {i.filename: zin.read(i.filename) for i in infos}
        titles = {title: part for title, (part, _) in _sheet_files(zin).items()}
    parts = {p: raw[p].decode("utf-8") for p in list(titles.values()) + ["xl/workbook.xml"]}
    orig = dict(parts)
    log.append("Step 1 - cover page project links:")
    step_cover_links(parts, titles, log)
    log.append("Step 2 - {Dropdowns} profile-pressure curve restored, duct-shape / unit-type lists moved:")
    step_dropdowns(parts, titles, log)
    log.append("Step 2b - MAU 'Method used' list: Traverse option removed:")
    step_remove_mau_traverse(parts, titles, log)
    log.append("Step 3 - notation-tolerant formulas:")
    examples = step_notation_guards(parts, titles, log)
    log.append("Step 4 - Building Balance small fans 21-40: NOT done. The exhaust column has 10 free rows (47-56, "
               "beside the MAU rows); 20 more rows need a re-layout (rows inserted above the totals), left for a decision.")
    with zipfile.ZipFile(out, "w") as zout:
        for info in infos:
            data = raw[info.filename]
            if info.filename in parts and parts[info.filename] != orig[info.filename]:
                data = parts[info.filename].encode("utf-8")
            zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            zi.compress_type = info.compress_type
            zi.external_attr = info.external_attr
            zout.writestr(zi, data)
    changed = sorted(p for p in parts if parts[p] != orig[p])
    log.append(f"Package parts changed: {len(changed)} of {len(infos)} ({', '.join(changed)}); every other part "
               "(VBA, drawings, media, styles, rels, content types) copied byte-for-byte.")
    log.append("Examples (first formulas of each shape per sheet):")
    log.extend(examples)
    return log


# --------------------------------------------------------------------------- self-test
def selftest(path=None):
    tr = Transformer()
    cases = [
        ('IF(I17="", "", I17*$F17)', 'IF(I17="", "", IF(OR(ISTEXT(I17),ISTEXT($F17)),"",I17*$F17))'),
        ('IF(OR(H33="",H33=0),"",IF(K33="",IF(J33="","",J33/H33),L33/H33))',
         'IF(OR(H33="",H33=0),"",IF(K33="",IF(J33="","",IF(OR(ISTEXT(J33),ISTEXT(H33)),"",J33/H33)),'
         'IF(OR(ISTEXT(L33),ISTEXT(H33)),"",L33/H33)))'),
        ('H43', 'H43'),
        ('IF(SUM(H60:H97)=0,"",SUM(H60:H97))', 'IF(SUM(H60:H97)=0,"",SUM(H60:H97))'),
        ('IF(N(J7)*N(H7)=0,"",ROUND(N(J7)*N(H7),0))', 'IF(N(J7)*N(H7)=0,"",ROUND(N(J7)*N(H7),0))'),
        ('IF(OR(D9="",E9="",D9=0),"",IF(ABS(E9/D9-1)<=$E$5,"OK","Check"))',
         'IF(OR(D9="",E9="",D9=0),"",IF(OR(ISTEXT(E9),ISTEXT(D9),ISTEXT($E$5)),"",IF(ABS(E9/D9-1)<=$E$5,"OK","Check")))'),
        ('IF(OR(C23="—",C24="",C25=""),"","Δ "&TEXT(C25-C24,"0.00"))',
         'IF(OR(C23="—",C24="",C25=""),"",IF(OR(ISTEXT(C25),ISTEXT(C24)),"","Δ "&TEXT(C25-C24,"0.00")))'),
        ("'RTUs'!K9*2", "IF(ISTEXT('RTUs'!K9),\"\",'RTUs'!K9*2)"),
        ('IF(A1="",0,-A1)', 'IF(A1="",0,IF(ISTEXT(A1),"",-A1))'),
        ('IF(OR(E19="",E17="",B17=""),"",B17/AVERAGE(E19:G19)*E17)',
         'IF(OR(E19="",E17="",B17=""),"",IF(OR(ISTEXT(B17),COUNT(E19:G19)=0,ISTEXT(E17)),"",B17/AVERAGE(E19:G19)*E17))'),
        ('IF(OR(COUNT(E19:G19)=0,COUNT(E20:G20)=0),"",AVERAGE(E19,F19,G19)*AVERAGE(E20:G20))',
         'IF(OR(COUNT(E19:G19)=0,COUNT(E20:G20)=0),"",AVERAGE(E19,F19,G19)*AVERAGE(E20:G20))'),
        ('IF(COUNT(P10:R10)=0,"",AVERAGE(P10:R10))', 'IF(COUNT(P10:R10)=0,"",AVERAGE(P10:R10))'),
        ('AVERAGE(P10:R10)', 'IF(COUNT(P10:R10)=0,"",AVERAGE(P10:R10))'),
    ]
    bad = 0
    for src, exp in cases:
        got = tr.run(src)
        if got != exp:
            bad += 1
            print("FAIL", src, "\n  got", got, "\n  exp", exp)
    n = 0
    if path:
        from openpyxl import load_workbook
        wb = load_workbook(path)
        for ws in wb.worksheets:
            for row in ws.iter_rows():
                for c in row:
                    if isinstance(c.value, str) and c.value.startswith("="):
                        f = c.value[1:]
                        root = Parser(f).parse()
                        if unparse(root, f) != f:
                            bad += 1; print("ROUNDTRIP FAIL", ws.title, c.coordinate)
                        n += 1
    print(f"selftest: {len(cases)} transform cases, {n} formulas round-tripped, {bad} failures")
    return bad == 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(0 if selftest(sys.argv[-1] if sys.argv[-1].endswith(".xlsm") else None) else 1)
    lines = build()
    with open(os.path.join(ROOT, "docs", "build-log-rev05.txt"), "w") as fh:
        fh.write("\n".join(lines) + "\n")
    print("\n".join(lines[:40]))
    print("written", OUT)
