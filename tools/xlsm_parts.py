"""Restore package parts that openpyxl drops when it re-saves an .xlsm.

openpyxl keeps cells, formulas, styles, validations, conditional formats,
defined names, external links and VBA, but it drops:
  * <drawing> images on sheets it cannot round-trip (certificate scans)
  * <legacyDrawingHF> header/footer pictures (the a2b logo on every page)
  * <controls> form-control buttons (the ToC macro button) and ctrlProps
  * printerSettings, webextensions, calcChain (harmless)

restore(original_path, edited_path, output_path, sheet_map) copies the
drawing / VML / media / ctrlProps parts back from the original package and
re-links them into the edited sheet XML, matching sheets by title.
"""
import re
import zipfile
from xml.sax.saxutils import escape

NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _sheet_files(z):
    """title -> (sheet part name, rels part name) for a workbook package."""
    wb = z.read("xl/workbook.xml").decode()
    rels = z.read("xl/_rels/workbook.xml.rels").decode()
    rid_to_target = {}
    for m in re.finditer(r"<Relationship\b[^>]*>", rels):
        tag = m.group(0)
        rid = re.search(r'Id="([^"]+)"', tag).group(1)
        tgt = re.search(r'Target="([^"]+)"', tag).group(1)
        rid_to_target[rid] = tgt
    out = {}
    for m in re.finditer(r"<sheet\b[^>]*>", wb):
        tag = m.group(0)
        name = re.search(r'name="([^"]+)"', tag).group(1)
        rid = re.search(r'r:id="([^"]+)"', tag).group(1)
        tgt = rid_to_target[rid]
        part = "xl/" + tgt.lstrip("/").removeprefix("xl/")
        base = part.rsplit("/", 1)[1]
        out[name.replace("&amp;", "&")] = (part, f"xl/worksheets/_rels/{base}.rels")
    return out


def _rels(z, part):
    if part in z.namelist():
        return dict(re.findall(r'Id="([^"]+)"[^>]*Target="([^"]+)"', z.read(part).decode())) | \
            {k: v for v, k in re.findall(r'Target="([^"]+)"[^>]*Id="([^"]+)"', z.read(part).decode())}
    return {}


def _rel_type_target(z, part):
    """rId -> (Type, Target) for a rels part."""
    res = {}
    if part not in z.namelist():
        return res
    for m in re.finditer(r"<Relationship\b[^>]*/>", z.read(part).decode()):
        tag = m.group(0)
        rid = re.search(r'Id="([^"]+)"', tag).group(1)
        typ = re.search(r'Type="([^"]+)"', tag).group(1)
        tgt = re.search(r'Target="([^"]+)"', tag).group(1)
        mode = re.search(r'TargetMode="([^"]+)"', tag)
        res[rid] = (typ, tgt, mode.group(1) if mode else None)
    return res


def _resolve(base_part, target):
    """Resolve a relative Target against the directory of base_part."""
    if target.startswith("/"):
        return target.lstrip("/")
    parts = base_part.split("/")[:-1]
    for seg in target.split("/"):
        if seg == "..":
            parts.pop()
        elif seg and seg != ".":
            parts.append(seg)
    return "/".join(parts)


KEEP_ELEMS = ("drawing", "legacyDrawing", "legacyDrawingHF", "picture", "controls")


def restore(original_path, edited_path, output_path, extra_sheet_sources=None, footer=None, skip_footer=(), header_overrides=None):
    """Rebuild output_path from edited_path plus the graphic parts of original_path.

    extra_sheet_sources: {new_sheet_title: original_sheet_title} for sheets that
    were added by the edit and should borrow the original sheet's header/footer
    logo (legacyDrawingHF).
    """
    zo = zipfile.ZipFile(original_path)
    ze = zipfile.ZipFile(edited_path)
    orig_sheets = _sheet_files(zo)
    new_sheets = _sheet_files(ze)
    extra_sheet_sources = extra_sheet_sources or {}
    header_overrides = header_overrides or {}

    out_parts = {}          # part name -> bytes
    content_types_add = {}  # extension -> content type / override
    # start from every edited part except graphic parts openpyxl generated itself
    for name in ze.namelist():
        if name.startswith(("xl/drawings/", "xl/media/", "xl/ctrlProps/")):
            continue
        out_parts[name] = ze.read(name)

    orig_names = set(zo.namelist())

    def copy_part(name):
        if name in orig_names and name not in out_parts:
            out_parts[name] = zo.read(name)
            # drawings/vml have their own rels (to media)
            d, b = name.rsplit("/", 1)
            rel = f"{d}/_rels/{b}.rels"
            if rel in orig_names:
                out_parts[rel] = zo.read(rel)
                for _rid, (_t, tgt, mode) in _rel_type_target(zo, rel).items():
                    if mode != "External":
                        copy_part(_resolve(name, tgt))

    for title, (new_part, new_rels) in new_sheets.items():
        src_title = title if title in orig_sheets else extra_sheet_sources.get(title)
        if src_title is None:
            continue
        o_part, o_rels = orig_sheets[src_title]
        o_xml = zo.read(o_part).decode()
        o_relmap = _rel_type_target(zo, o_rels)
        n_xml = out_parts[new_part].decode()
        # strip whatever openpyxl wrote for these elements, and their rels
        n_rels_xml = out_parts.get(new_rels, b"").decode() if new_rels in out_parts else ""
        for el in KEEP_ELEMS:
            for m in re.finditer(rf"<{el}\b[^>]*?(?:/>|>.*?</{el}>)", n_xml, re.S):
                for rid in re.findall(r'r:id="([^"]+)"', m.group(0)):
                    n_rels_xml = re.sub(rf'<Relationship\b[^>]*Id="{rid}"[^>]*/>', "", n_rels_xml)
            n_xml = re.sub(rf"<{el}\b[^>]*?(?:/>|>.*?</{el}>)", "", n_xml, flags=re.S)
        # collect original elements to re-insert (only sheet graphics, not e.g. tableParts)
        inserts = []
        existing_rids = set(re.findall(r'Id="([^"]+)"', n_rels_xml))
        next_id = 1000
        for el in KEEP_ELEMS:
            for m in re.finditer(rf"<{el}\b[^>]*?(?:/>|>.*?</{el}>)", o_xml, re.S):
                frag = m.group(0)
                for rid in sorted(set(re.findall(r'r:id="([^"]+)"', frag))):
                    typ, tgt, mode = o_relmap[rid]
                    new_rid = f"rId{next_id}"; next_id += 1
                    while new_rid in existing_rids:
                        new_rid = f"rId{next_id}"; next_id += 1
                    existing_rids.add(new_rid)
                    frag = frag.replace(f'r:id="{rid}"', f'r:id="{new_rid}"')
                    n_rels_xml = _add_rel(n_rels_xml, new_rid, typ, tgt)
                    if mode != "External":
                        copy_part(_resolve(o_part, tgt))
                inserts.append((el, frag))
        # original headerFooter (openpyxl re-serialises it with a stray space)
        hf = re.search(r"<headerFooter\b.*?</headerFooter>|<headerFooter\b[^>]*/>", o_xml if title in orig_sheets else n_xml, re.S)
        hf_xml = hf.group(0) if hf else ""
        if title in header_overrides:
            logo = "&amp;L&amp;G" if "<legacyDrawingHF" in o_xml else ""
            hf_xml = re.sub(r"<oddHeader>.*?</oddHeader>", "", hf_xml, flags=re.S)
            new_hdr = f'<oddHeader>{logo}&amp;C&amp;"+,Bold"&amp;16{escape(header_overrides[title])}</oddHeader>'
            hf_xml = ("<headerFooter>" + new_hdr + hf_xml.replace("<headerFooter>", "").replace("</headerFooter>", "") + "</headerFooter>") if hf_xml else "<headerFooter>" + new_hdr + "</headerFooter>"
        if footer and title not in skip_footer:
            hdr = re.search(r"<oddHeader>.*?</oddHeader>", hf_xml, re.S)
            hf_xml = "<headerFooter>" + (hdr.group(0) if hdr else "") + f"<oddFooter>{footer}</oddFooter></headerFooter>"
        if hf_xml:
            if re.search(r"<headerFooter\b", n_xml):
                n_xml = re.sub(r"<headerFooter\b.*?</headerFooter>|<headerFooter\b[^>]*/>", lambda _m: hf_xml, n_xml, count=1, flags=re.S)
            else:
                n_xml = _insert_in_order(n_xml, [("headerFooter", hf_xml)])
        if inserts:
            n_xml = _insert_in_order(n_xml, inserts)
            n_xml = _ensure_namespaces(n_xml, o_xml)
        out_parts[new_part] = n_xml.encode()
        if n_rels_xml:
            out_parts[new_rels] = n_rels_xml.encode()

    # content types: make sure every restored part extension / override exists
    ct = out_parts["[Content_Types].xml"].decode()
    ct_orig = zo.read("[Content_Types].xml").decode()
    for name in list(out_parts):
        if name.startswith(("xl/drawings/", "xl/media/", "xl/ctrlProps/")):
            ext = name.rsplit(".", 1)[-1].lower()
            if f'Extension="{ext}"' not in ct and f'Extension="{ext.upper()}"' not in ct:
                m = re.search(rf'<Default Extension="{ext}"[^>]*/>', ct_orig, re.I)
                if m:
                    ct = ct.replace("</Types>", m.group(0) + "</Types>")
            ov = re.search(rf'<Override PartName="/{re.escape(name)}"[^>]*/>', ct_orig)
            if ov and ov.group(0) not in ct:
                ct = ct.replace("</Types>", ov.group(0) + "</Types>")
    out_parts["[Content_Types].xml"] = ct.encode()

    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zw:
        # [Content_Types].xml first, like Excel does
        zw.writestr("[Content_Types].xml", out_parts.pop("[Content_Types].xml"))
        for name, data in out_parts.items():
            zw.writestr(name, data)
    return sorted(set(zo.namelist()) - set(out_parts) - {"[Content_Types].xml"})


def _add_rel(rels_xml, rid, typ, tgt):
    tag = f'<Relationship Id="{rid}" Type="{typ}" Target="{escape(tgt, {chr(34): "&quot;"})}"/>'
    if not rels_xml.strip():
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                + tag + "</Relationships>")
    return rels_xml.replace("</Relationships>", tag + "</Relationships>")


# CT_Worksheet child order (subset that matters after pageSetup/headerFooter)
ORDER = ["sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData", "sheetCalcPr",
         "sheetProtection", "protectedRanges", "scenarios", "autoFilter", "sortState", "dataConsolidate",
         "customSheetViews", "mergeCells", "phoneticPr", "conditionalFormatting", "dataValidations",
         "hyperlinks", "printOptions", "pageMargins", "pageSetup", "headerFooter", "rowBreaks", "colBreaks",
         "customProperties", "cellWatches", "ignoredErrors", "smartTags", "drawing", "legacyDrawing",
         "legacyDrawingHF", "drawingHF", "picture", "oleObjects", "controls", "webPublishItems", "tableParts",
         "extLst"]


def _insert_in_order(xml, inserts):
    """Insert (element, fragment) pairs at the schema-correct position."""
    for el, frag in inserts:
        idx = ORDER.index(el)
        # find first existing element that comes after `el` in ORDER
        pos = None
        for later in ORDER[idx + 1:]:
            m = re.search(rf"<{later}\b", xml)
            if m:
                pos = m.start()
                break
        if pos is None:
            pos = xml.rfind("</worksheet>")
        xml = xml[:pos] + frag + xml[pos:]
    return xml


def _ensure_namespaces(new_xml, orig_xml):
    """Copy xmlns declarations (mc, x14ac, xr, …) from the original root tag so
    re-inserted fragments such as <controls> with mc:AlternateContent parse."""
    o_root = re.search(r"<worksheet\b[^>]*>", orig_xml).group(0)
    n_root_m = re.search(r"<worksheet\b[^>]*>", new_xml)
    n_root = n_root_m.group(0)
    add = ""
    for m in re.finditer(r'(xmlns:(\w+))="([^"]+)"', o_root):
        if m.group(1) not in n_root:
            add += f' {m.group(1)}="{m.group(3)}"'
    ign = re.search(r'mc:Ignorable="([^"]+)"', o_root)
    if ign and "mc:Ignorable" not in n_root and "xmlns:mc" in (n_root + add):
        add += f' mc:Ignorable="{ign.group(1)}"'
    if add:
        n_root = n_root[:-1] + add + ">"
        new_xml = new_xml[:n_root_m.start()] + n_root + new_xml[n_root_m.end():]
    return new_xml


# --------------------------------------------------------------------------- #
# Post-build picture helpers (operate on a finished package)
# --------------------------------------------------------------------------- #
def _sheet_part_and_drawing(z, title):
    part, rels = _sheet_files(z)[title]
    rmap = _rel_type_target(z, rels)
    for rid, (typ, tgt, mode) in rmap.items():
        if typ.endswith("/drawing"):
            return part, rels, _resolve(part, tgt), rid
    return part, rels, None, None


def add_picture(package_path, sheet_title, png_path, frm, to, name="Picture", shift_anchors=None):
    """Append a two-cell-anchored picture to sheet_title's drawing (must already have one).

    frm / to: (col, row) zero-based cell indexes. shift_anchors: {picture name: row delta}
    applied to existing anchors on the same drawing before the new picture is added.
    """
    z = zipfile.ZipFile(package_path)
    parts = {n: z.read(n) for n in z.namelist()}
    z.close()
    part, rels, drawing, _ = _sheet_part_and_drawing(zipfile.ZipFile(package_path), sheet_title)
    if drawing is None:
        raise ValueError(f"{sheet_title} has no drawing part")
    d_rels = drawing.rsplit("/", 1)[0] + "/_rels/" + drawing.rsplit("/", 1)[1] + ".rels"
    dx = parts[drawing].decode()
    rx = parts.get(d_rels, b"").decode()
    # shift existing anchors
    for pic_name, delta in (shift_anchors or {}).items():
        def shift(m):
            block = m.group(0)
            if f'name="{pic_name}"' not in block:
                return block
            return re.sub(r"<xdr:row>(\d+)</xdr:row>", lambda r: f"<xdr:row>{int(r.group(1)) + delta}</xdr:row>", block)
        dx = re.sub(r"<xdr:twoCellAnchor.*?</xdr:twoCellAnchor>", shift, dx, flags=re.S)
    # media part
    n = 1
    while f"xl/media/image{n}.png" in parts or f"xl/media/image{n}.jpeg" in parts or f"xl/media/image{n}.jpg" in parts:
        n += 1
    media = f"xl/media/image{n}.png"
    parts[media] = open(png_path, "rb").read()
    rid = "rId" + str(1000 + n)
    rx = _add_rel(rx, rid, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", f"../media/image{n}.png")
    ids = [int(x) for x in re.findall(r'<xdr:cNvPr id="(\d+)"', dx)] or [0]
    pic = (f'<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>{frm[0]}</xdr:col><xdr:colOff>0</xdr:colOff>'
           f'<xdr:row>{frm[1]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>{to[0]}</xdr:col><xdr:colOff>0</xdr:colOff>'
           f'<xdr:row>{to[1]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="{max(ids) + 1}" name="{escape(name)}"/>'
           f'<xdr:cNvPicPr><a:picLocks noChangeAspect="0"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="{NS_R}" r:embed="{rid}"/>'
           f'<a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm>'
           f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>')
    if "xmlns:a=" not in dx.split(">", 1)[0] + dx.split(">", 2)[1]:
        dx = dx.replace("<xdr:wsDr ", '<xdr:wsDr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ', 1)
    dx = dx.replace("</xdr:wsDr>", pic + "</xdr:wsDr>")
    parts[drawing] = dx.encode(); parts[d_rels] = rx.encode()
    ct = parts["[Content_Types].xml"].decode()
    if 'Extension="png"' not in ct:
        ct = ct.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>')
    parts["[Content_Types].xml"] = ct.encode()
    with zipfile.ZipFile(package_path, "w", zipfile.ZIP_DEFLATED) as zw:
        zw.writestr("[Content_Types].xml", parts.pop("[Content_Types].xml"))
        for k, v in parts.items():
            zw.writestr(k, v)
