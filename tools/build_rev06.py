"""Revision 06 = revision 05 with a2b's own report look in the e2s website's colours (styles only).

Styles, print headers and page layout change (never a cell's address, formula or value): every cell, formula, name, validation, VBA module, drawing and print setting is copied
byte-for-byte from revision 05, so the app's template map (cell positions) is the same and a rev 05 workbook's data
reads the same. The look is changed where Excel keeps it, in the shared cell formats:

  1. header bands   the template's light-blue header fill (theme accent 1, 40 % tint): centred header cells (section
                    titles and column headers) -> solid steel blue with white bold text; the other cells on it (row labels
                    such as "Manufacturer") -> pale steel blue with deep-blue text
  2. grey fills     the 25 % grey (theme background, darker) -> light blue-grey
  3. input cells    the pale-yellow input fill -> white (an exported report is read, not typed into)
  4. grid lines     thin / hair borders in black or automatic -> blue-grey; medium / thick borders -> e2s green,
                    so each table keeps a firm outline while its inner grid recedes
  5. titles         fonts of 14 pt and more -> deep steel blue; the page titles in each sheet's print header ("Rooftop
                    Unit Report") -> near-black (Excel's &K colour code; the header / footer text is otherwise unchanged)

    TAB_BUILD_DATE=10-1-26 python3 tools/build_rev06.py            # newest 05 file -> 06 - a2b_Blank_TAB_Workbook <date>.xlsm
    python3 tools/build_rev06.py --restyle in.xlsm out.xlsm        # the same restyle on any rev 05 workbook (previews)
"""
import datetime as dt
import glob
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAMP = os.environ.get("TAB_BUILD_DATE", dt.date.today().strftime("%-m-%-d-%y"))
OUT = os.path.join(ROOT, f"06 - a2b_Blank_TAB_Workbook {STAMP}.xlsm")

# palette (ARGB): the e2s website (e2sbuildingperformance.com: steel-blue buttons and sections #4A7EC0, signature green
# #6AB23E, near-black bold headings on white)
BAND_STRONG = "FF4A7EC0"  # steel blue: centred header bands (white text)
LABEL_TEXT = "FF28518A"   # deep steel blue: text on the light bands, titles in cells
BAND = "FFE3ECF7"         # pale steel blue: row-label bands
SHADE = "FFEEF2F7"        # light blue-grey (the old 25 % grey)
RULE = "FFBFCCDB"         # blue-grey grid lines
OUTLINE = "FF6AB23E"      # e2s green: medium / thick table outlines
TITLE = "FF1F1F1F"        # near-black: page titles (the website's headings)
WHITE = "FFFFFFFF"
INK = BAND_STRONG

HEADER_FILL = re.compile(r'<fgColor theme="4" tint="0\.39\d*"\s*/>')
GREY_FILL = re.compile(r'<fgColor theme="0" tint="-0\.24\d*"\s*/>')
YELLOW_FILL = re.compile(r'<fgColor rgb="FFFFFFE0"\s*/>')


EXTRA = {}


def _block(xml, tag):
    m = re.search(rf"<{tag}\b[^>]*>(.*?)</{tag}>", xml, re.S)
    return m


def _items(inner, tag):
    return re.findall(rf"<{tag}\b[^>]*/>|<{tag}\b[^>]*>.*?</{tag}>", inner, re.S)


def _set_color(el, argb):
    """Set (or add) the <color> of a font element."""
    if re.search(r"<color\b[^>]*/>", el):
        return re.sub(r"<color\b[^>]*/>", f'<color rgb="{argb}"/>', el, count=1)
    if el.endswith("/>"):
        return el[:-2] + f'><color rgb="{argb}"/></font>'
    # <color> goes after <b/><i/><strike/>...<sz/> in CT_Font order; before <name> is accepted by Excel
    return re.sub(r"(<name\b)", f'<color rgb="{argb}"/>\\1', el, count=1) if "<name" in el else el.replace(
        "</font>", f'<color rgb="{argb}"/></font>'
    )


def restyle(styles, log):
    # ---- fills
    fb = _block(styles, "fills")
    fills = _items(fb.group(1), "fill")
    header_ids, n_grey, n_yellow = set(), 0, 0
    for i, f in enumerate(fills):
        if HEADER_FILL.search(f):
            fills[i] = f'<fill><patternFill patternType="solid"><fgColor rgb="{BAND}"/><bgColor indexed="64"/></patternFill></fill>'
            header_ids.add(i)
        elif GREY_FILL.search(f):
            fills[i] = f'<fill><patternFill patternType="solid"><fgColor rgb="{SHADE}"/><bgColor indexed="64"/></patternFill></fill>'
            n_grey += 1
        elif YELLOW_FILL.search(f):
            fills[i] = f'<fill><patternFill patternType="solid"><fgColor rgb="{WHITE}"/></patternFill></fill>'
            n_yellow += 1
    fills.append(f'<fill><patternFill patternType="solid"><fgColor rgb="{INK}"/><bgColor indexed="64"/></patternFill></fill>')
    navy_fill = len(fills) - 1
    styles = styles.replace(fb.group(0), re.sub(r'count="\d+"', f'count="{len(fills)}"', fb.group(0).split(">", 1)[0] + ">", 1) + "".join(fills) + "</fills>", 1)
    log.append(f"  fills: {len(header_ids)} header band(s) -> {BAND}, {n_grey} grey -> {SHADE}, {n_yellow} input yellow -> white")

    # ---- fonts: text on header bands and large titles -> brand blues (new font entries, so other uses keep theirs)
    fo = _block(styles, "fonts")
    fonts = _items(fo.group(1), "font")
    xb = _block(styles, "cellXfs")
    xfs = _items(xb.group(1), "xf")
    navy_font = {}

    def deep(fid):
        if fid not in navy_font:
            fonts.append(_set_color(fonts[fid], LABEL_TEXT))
            navy_font[fid] = len(fonts) - 1
        return navy_font[fid]

    white_font = {}

    def white(fid):
        if fid not in white_font:
            f = _set_color(fonts[fid], WHITE)
            if "<b" not in f:
                f = f.replace("<font>", "<font><b/>", 1)
            fonts.append(f)
            white_font[fid] = len(fonts) - 1
        return white_font[fid]

    n_band_text = n_title = n_strong = 0
    for i, x in enumerate(xfs):
        fid = int(re.search(r'fontId="(\d+)"', x).group(1))
        fill = int(re.search(r'fillId="(\d+)"', x).group(1))
        size = re.search(r'<sz val="([\d.]+)"', fonts[fid])
        color = re.search(r'<color\b([^>]*)/>', fonts[fid])
        dark = color is None or re.search(r'theme="1"|rgb="FF000000"|indexed="(8|64)"|auto="1"', color.group(1))
        centred = re.search(r'horizontal="(center|centerContinuous)"', x)
        if fill in header_ids and dark and centred:
            y = re.sub(r'fontId="\d+"', f'fontId="{white(fid)}"', x, count=1)
            xfs[i] = re.sub(r'fillId="\d+"', f'fillId="{navy_fill}"', y, count=1)
            n_strong += 1
        elif fill in header_ids and dark:
            xfs[i] = re.sub(r'fontId="\d+"', f'fontId="{deep(fid)}"', x, count=1)
            n_band_text += 1
        elif size and float(size.group(1)) >= 14 and dark:
            xfs[i] = re.sub(r'fontId="\d+"', f'fontId="{deep(fid)}"', x, count=1)
            n_title += 1
        if 'applyFont="' not in xfs[i] and xfs[i] != x:
            xfs[i] = xfs[i].replace("<xf ", '<xf applyFont="1" ', 1)
    # two formats for the Building Balance notes box: a band across the top and the note lines
    EXTRA["notes_head"] = len(xfs)
    xfs.append(
        f'<xf numFmtId="0" fontId="{white(1)}" fillId="{navy_fill}" borderId="1" applyFont="1" applyFill="1" applyBorder="1"'
        ' applyAlignment="1" xfId="0"><alignment horizontal="left" vertical="center" indent="1"/></xf>'
    )
    EXTRA["notes_line"] = len(xfs)
    xfs.append(
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1" xfId="0">'
        '<alignment horizontal="left" vertical="center" wrapText="1" indent="1"/></xf>'
    )
    new_fonts = "".join(fonts)
    styles = styles.replace(fo.group(0), re.sub(r'count="\d+"', f'count="{len(fonts)}"', fo.group(0).split(">", 1)[0] + ">", 1) + new_fonts + "</fonts>", 1)
    xb = _block(styles, "cellXfs")
    head = re.sub(r'count="\d+"', f'count="{len(xfs)}"', xb.group(0).split(">", 1)[0] + ">", 1)
    styles = styles.replace(xb.group(0), head + "".join(xfs) + "</cellXfs>", 1)
    log.append(
        f"  headers: {n_strong} centred header formats -> steel-blue band / white text, {n_band_text} label formats -> pale blue /"
        f" deep-blue text, {n_title} title formats -> deep blue ({len(navy_font) + len(white_font)} new fonts, 1 new fill)"
    )

    # ---- borders: thin grid lighter, heavy lines e2s green
    bb = _block(styles, "borders")
    n_thin = n_heavy = 0

    def edge(m):
        nonlocal n_thin, n_heavy
        tag, style, body = m.group(1), m.group(2), m.group(3) or ""
        if style in ("thin", "hair", "dotted", "dashed"):
            # black, automatic or the template's grey (theme background, darker): the light grid colour
            if not re.search(r'rgb="(?!FF000000)[0-9A-F]{8}"', body):
                n_thin += 1
                return f'<{tag} style="{style}"><color rgb="{RULE}"/></{tag}>'
        elif style in ("medium", "thick", "double", "mediumDashed"):
            n_heavy += 1
            return f'<{tag} style="{style}"><color rgb="{OUTLINE}"/></{tag}>'
        return m.group(0)

    inner = re.sub(r'<(left|right|top|bottom|diagonal)\s+style="(\w+)"\s*(?:/>|>(.*?)</\1>)', edge, bb.group(1), flags=re.S)
    styles = styles.replace(bb.group(1), inner, 1)
    log.append(f"  borders: {n_thin} thin edges -> {RULE}, {n_heavy} heavy edges -> {OUTLINE}")
    return styles


def header_colour(sheet_xml):
    """Print-header titles near-black: '&C&"+,Bold"&16Rooftop Unit Report' -> the same with &K<INK> before the text."""
    def fix(m):
        body = m.group(2)
        body = re.sub(r"&amp;K[0-9A-Fa-f]{6}", "", body)
        body = re.sub(r"(&amp;C(?:&amp;&quot;[^&]*&quot;|&amp;\"[^&]*\"|&amp;\d+)*)", lambda k: k.group(1) + "&amp;K" + TITLE[2:], body, count=1)
        return f"<{m.group(1)}>{body}</{m.group(1)}>"

    return re.sub(r"<(oddHeader|evenHeader|firstHeader)>(.*?)</\1>", fix, sheet_xml, flags=re.S)


# ------------------------------------------------------------------------------------------ sheet-level polish
SLACK = 1.04          # pages fit the printable height with 4 % to spare (printer drivers measure rows differently)
HOOD_FIRST, HOOD_PAGE = 52, 49   # Hoods: two hoods per page, first page rows 1-52, then 49 rows a page


def page_break_view(x):
    """Every printable sheet opens in Page Break Preview."""
    m = re.search(r"<sheetView\b[^>]*?(/?)>", x)
    if not m:
        return x
    tag = re.sub(r'\sview="\w+"', "", m.group(0))
    tag = tag.replace("<sheetView", '<sheetView view="pageBreakPreview"', 1)
    if "zoomScaleSheetLayoutView" not in tag:
        tag = tag.replace("<sheetView", '<sheetView zoomScaleSheetLayoutView="100"', 1)
    return x.replace(m.group(0), tag, 1)


def _row_heights(x):
    dflt = float(re.search(r'<sheetFormatPr[^>]*defaultRowHeight="([\d.]+)"', x).group(1))
    hts = {int(r): float(h) for r, h in re.findall(r'<row r="(\d+)"[^>]*?\bht="([\d.]+)"', x)}
    hidden = {int(r) for r in re.findall(r'<row r="(\d+)"[^>]*\bhidden="1"', x)}
    return lambda r: 0.0 if r in hidden else hts.get(r, dflt)


def add_breaks(x, ids):
    """Manual page breaks after the given rows (kept with any already there)."""
    old = sorted({int(b) for b in re.findall(r'<brk id="(\d+)"', x)} | set(ids))
    rb = f'<rowBreaks count="{len(old)}" manualBreakCount="{len(old)}">' + "".join(
        f'<brk id="{b}" max="16383" man="1"/>' for b in old) + "</rowBreaks>"
    if re.search(r"<rowBreaks\b", x):
        return re.sub(r"<rowBreaks\b.*?</rowBreaks>|<rowBreaks\b[^>]*/>", rb, x, count=1, flags=re.S)
    for after in (r"</headerFooter>", r"<headerFooter\b[^>]*/>", r"<pageSetup\b[^>]*/>"):
        m = re.search(after, x)
        if m:
            return x[: m.end()] + rb + x[m.end():]
    return x


def fit_scale(x, name, log):
    """Lower a fixed print scale until every manual page fits with SLACK (no extra automatic break on any laptop)."""
    ps = re.search(r"<pageSetup\b[^>]*/>", x)
    if not ps or re.search(r'<pageSetUpPr\b[^>]*fitToPage="1"', x):
        return x
    brks = sorted(int(b) for b in re.findall(r'<brk id="(\d+)"', x))
    if not brks:
        return x
    dim = re.search(r'<dimension ref="[A-Z]+\d+:[A-Z]+(\d+)"', x)
    last = int(dim.group(1)) if dim else brks[-1] + 60
    h = _row_heights(x)
    starts = [1] + [b + 1 for b in brks]
    ends = [b for b in brks] + [last]
    tallest = max(sum(h(r) for r in range(a, e + 1)) for a, e in zip(starts, ends) if e >= a)
    pm = re.search(r"<pageMargins\b[^>]*/>", x).group(0)
    top = float(re.search(r'\btop="([\d.]+)"', pm).group(1))
    bot = float(re.search(r'\bbottom="([\d.]+)"', pm).group(1))
    land = 'orientation="landscape"' in ps.group(0)
    usable = ((8.5 if land else 11.0) - top - bot) * 72
    cur = int(re.search(r'scale="(\d+)"', ps.group(0)).group(1)) if "scale=" in ps.group(0) else 100
    need = int(usable / (tallest * SLACK) * 100)
    if need >= cur:
        return x
    tag = re.sub(r'\sscale="\d+"', "", ps.group(0)).replace("<pageSetup", f'<pageSetup scale="{need}"', 1)
    log.append(f"    {name}: tallest page {tallest:.0f} pt, print scale {cur} % -> {need} %")
    return x.replace(ps.group(0), tag, 1)


def narrative_rows(x):
    """The set-up blurb (C9:L10) gets room for its four lines."""
    for r in (9, 10):
        x = re.sub(rf'(<row r="{r}"[^>]*?\bht=")[\d.]+(")', r"\g<1>28\2", x, count=1)
    return x


def balance_notes(x):
    """Building Balance notes: one box across B:M (a band "Notes" and three lines), B102:B104 stay the note cells."""
    head, line = EXTRA["notes_head"], EXTRA["notes_line"]
    cols = "BCDEFGHIJKLM"

    def row_cells(r, style, first=None):
        cells = "".join(
            f'<c r="{c}{r}" s="{style}" t="inlineStr"><is><t>{first}</t></is></c>' if (c == "B" and first) else f'<c r="{c}{r}" s="{style}"/>'
            for c in cols)
        return cells

    def set_row(xml, r, cells, ht):
        m = re.search(rf'<row r="{r}"[^>]*?(?:/>|>.*?</row>)', xml, re.S)
        tag = re.search(rf'<row r="{r}"[^>]*?(/?)>', m.group(0)).group(0).rstrip("/>").rstrip("/") + ">"
        tag = re.sub(r'\bht="[\d.]+"', f'ht="{ht}"', tag)
        tag = re.sub(r'\sspans="[^"]*"', "", tag)
        return xml.replace(m.group(0), f"{tag}{cells}</row>", 1)

    # row 100: a plain spacer (the old bordered B100 goes)
    x = re.sub(r'(<row r="100"[^>]*>)<c r="B100"[^>]*?(?:/>|>.*?</c>)', r"\1", x, count=1, flags=re.S)
    x = set_row(x, 101, row_cells(101, head, "Notes"), 16)
    for r in (102, 103, 104):
        # keep a note the B cell may hold (restyling a filled-in workbook)
        b = re.search(rf'<c r="B{r}"[^>]*?(?:/>|>(.*?)</c>)', x, re.S)
        cells = row_cells(r, line)
        if b and b.group(1):
            t = re.search(r'\bt="(\w+)"', b.group(0))
            tt = ' t="%s"' % t.group(1) if t else ""
            cells = cells.replace(f'<c r="B{r}" s="{line}"/>', f'<c r="B{r}" s="{line}"{tt}>{b.group(1)}</c>', 1)
        x = set_row(x, r, cells, 18)
    merges = [f"B{r}:M{r}" for r in (101, 102, 103, 104)]
    mc = re.search(r'<mergeCells count="(\d+)">', x)
    x = x.replace(mc.group(0), f'<mergeCells count="{int(mc.group(1)) + len(merges)}">', 1)
    x = x.replace("</mergeCells>", "".join(f'<mergeCell ref="{m}"/>' for m in merges) + "</mergeCells>", 1)
    return x


def recolour_logo(png_bytes):
    """Cover logo a²b: purple letters -> steel blue, blue superscript -> e2s green (anti-aliasing kept)."""
    import io
    from PIL import Image

    im = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    px = im.load()
    blue = tuple(int(BAND_STRONG[i:i + 2], 16) for i in (2, 4, 6))
    green = tuple(int(OUTLINE[i:i + 2], 16) for i in (2, 4, 6))
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a == 0 or min(r, g, b) > 245:
                continue
            if g > r:  # blue source (0, 112, 192): coverage from the red channel
                k, tgt = (255 - r) / 255, green
            else:  # purple source (112, 48, 160): coverage from the green channel
                k, tgt = (255 - g) / 207, blue
            k = max(0.0, min(1.0, k))
            px[x, y] = tuple(int(round(255 * (1 - k) + c * k)) for c in tgt) + (a,)
    out = io.BytesIO()
    im.save(out, "PNG", optimize=True)
    return out.getvalue()


def rewrite(src, out, log):
    sys.path.insert(0, os.path.dirname(__file__))
    from xlsm_parts import _sheet_files

    with zipfile.ZipFile(src) as zin:
        styles = restyle(zin.read("xl/styles.xml").decode("utf-8"), log)
        titles = {part: title for title, (part, _) in _sheet_files(zin).items()}
        wb = zin.read("xl/workbook.xml").decode("utf-8")
        order = [part for part in titles]  # workbook order (localSheetId)
        printable = {int(i) for i in re.findall(r'<definedName name="_xlnm.Print_Area" localSheetId="(\d+)"', wb)}
        n_headers = n_views = 0
        log.append("  layout:")
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename == "xl/styles.xml":
                    data = styles.encode("utf-8")
                elif item.filename == "xl/media/image1.png":
                    data = recolour_logo(data)
                    log.append("    Cover Page: a2b logo -> steel blue, green 2")
                elif item.filename in titles:
                    name = titles[item.filename]
                    x = data.decode("utf-8")
                    y = header_colour(x)
                    n_headers += y != x
                    if order.index(item.filename) in printable:
                        y = page_break_view(y)
                        n_views += 1
                    if name == "Hoods":
                        dim = int(re.search(r'<dimension ref="[A-Z]+\d+:[A-Z]+(\d+)"', y).group(1))
                        ids = list(range(HOOD_FIRST, dim, HOOD_PAGE))
                        y = add_breaks(y, ids)
                        log.append(f"    Hoods: {len(ids)} page breaks (two hoods a page)")
                    y = fit_scale(y, name, log)
                    if name == "Narrative":
                        y = narrative_rows(y)
                        log.append("    Narrative: set-up blurb rows 9-10 -> 28 pt (the whole text shows)")
                    if name == "Building Balance":
                        y = balance_notes(y)
                        log.append("    Building Balance: notes as one box across B:M (band + 3 lines, B102:B104 kept)")
                    data = y.encode("utf-8")
                zout.writestr(item, data)
    log.append(f"  print headers: page titles near-black on {n_headers} sheets; Page Break Preview on {n_views} sheets")


STAMP_PNG = os.path.join(ROOT, "tools", "assets", "nebb-stamp.png")


def place_stamp(path, log):
    """The certified professional's NEBB stamp in the Certification stamp box (C51:G56), placed by the app's own
    exporter code (tools/place_template_stamp.mts) as the picture "a2b NEBB Stamp". An export replaces it with the
    certification profile's stamp when the profile has one."""
    import subprocess

    if not os.path.exists(STAMP_PNG):
        log.append("  stamp: tools/assets/nebb-stamp.png missing, no stamp placed")
        return
    subprocess.run(
        ["npx", "tsx", os.path.join(ROOT, "tools", "place_template_stamp.mts"), path, STAMP_PNG],
        check=True, cwd=ROOT,
    )
    log.append("  stamp: NEBB stamp (tools/assets/nebb-stamp.png) in the Certification stamp box, picture 'a2b NEBB Stamp'")


def newest_rev05():
    files = sorted(glob.glob(os.path.join(ROOT, "05 - a2b_Blank_TAB_Workbook *.xlsm")), key=os.path.getmtime)
    if not files:
        sys.exit("no revision 05 workbook found")
    return files[-1]


if __name__ == "__main__":
    log = []
    if len(sys.argv) == 4 and sys.argv[1] == "--restyle":
        rewrite(sys.argv[2], sys.argv[3], log)
    else:
        src = newest_rev05()
        log.append(f"Source: {os.path.basename(src)}")
        log.append("Restyle (xl/styles.xml only):")
        rewrite(src, OUT, log)
        place_stamp(OUT, log)
        with open(os.path.join(ROOT, "docs", "build-log-rev06.txt"), "w") as fh:
            fh.write("\n".join(log) + "\n")
    print("\n".join(log))
