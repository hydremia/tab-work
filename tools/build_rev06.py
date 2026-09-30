"""Revision 06 = revision 05 with a2b's own report look in the e2s website's colours (styles only).

Only xl/styles.xml and the print-header colour change: every cell, formula, name, validation, VBA module, drawing and print setting is copied
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
    new_fonts = "".join(fonts)
    styles = styles.replace(fo.group(0), re.sub(r'count="\d+"', f'count="{len(fonts)}"', fo.group(0).split(">", 1)[0] + ">", 1) + new_fonts + "</fonts>", 1)
    xb = _block(styles, "cellXfs")
    styles = styles.replace(xb.group(1), "".join(xfs), 1)
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
            if not re.search(r'rgb="(?!FF000000)[0-9A-F]{8}"|theme="(?!1")', body):
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


def rewrite(src, out, log):
    n_headers = 0
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "xl/styles.xml":
                data = restyle(data.decode("utf-8"), log).encode("utf-8")
            elif re.match(r"xl/worksheets/sheet\d+\.xml$", item.filename):
                x = data.decode("utf-8")
                y = header_colour(x)
                if y != x:
                    n_headers += 1
                    data = y.encode("utf-8")
            zout.writestr(item, data)
    log.append(f"  print headers: page titles near-black on {n_headers} sheets")


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
        with open(os.path.join(ROOT, "docs", "build-log-rev06.txt"), "w") as fh:
            fh.write("\n".join(log) + "\n")
    print("\n".join(log))
