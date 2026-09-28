/**
 * Stamp and signature images on the Certification sheet. The template has no picture there (sheet20 has no drawing),
 * only an empty bordered stamp box (C51:G56), the signature line (I53:L53, the signer's name is written into it) and a
 * placeholder note (C50 "… insert the stamp image here …"). The exporter adds a drawing to the sheet (or reuses the one
 * a previously exported workbook has) with up to two named pictures:
 *  - "TAB App Stamp": fitted into the stamp box, centred, aspect kept;
 *  - "TAB App Signature": fitted into the area above the signature line right of the "Signature:" label, sitting on
 *    the line (bottom aligned), aspect kept.
 * Pictures of these names from an earlier export are replaced (never duplicated) or removed when the image is gone.
 * The placeholder note is cleared when an image is placed. The images come in encoded (PNG or JPEG) with their pixel
 * size; nothing is decoded here.
 */
import type JSZip from 'jszip';
import { anchorSizeEmu, drawingPictures, type AnchorBox } from './coverPhoto.js';
import { attr, colToNum, parseRels, readText, relsPathFor, resolveTarget, splitRef } from './ooxml.js';

export interface CertImage {
  bytes: Uint8Array;
  type: 'png' | 'jpeg';
  /** Pixel size (for the aspect ratio). */
  width: number;
  height: number;
}

export interface CertImages {
  stamp?: CertImage | null;
  signature?: CertImage | null;
}

export interface CertImagesDef {
  sheet: string;
  /** Box the stamp is fitted into (a cell range). */
  stamp: string;
  /** Box the signature is fitted into, bottom aligned (a cell range). */
  signature: string;
  /** Cell holding the template's "insert the stamp image here" note, cleared when an image is placed. */
  placeholder: string;
}

export const CERT_PICTURE_NAMES = { stamp: 'TAB App Stamp', signature: 'TAB App Signature' } as const;

export interface CertImagesReport {
  placed: ('stamp' | 'signature')[];
  removed: number;
  drawingPart: string | null;
  createdDrawing: boolean;
}

const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_DRAWING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';
const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const CT_DRAWING = 'application/vnd.openxmlformats-officedocument.drawing+xml';
const EMU_PER_PT = 12700;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A cell range as a zero-based, end-exclusive anchor box. */
function rangeBox(range: string): AnchorBox {
  const [a, b = a] = range.split(':');
  const s = splitRef(a), e = splitRef(b);
  return {
    fromCol: colToNum(s.col) - 1, fromColOff: 0, fromRow: s.row - 1, fromRowOff: 0,
    toCol: colToNum(e.col), toColOff: 0, toRow: e.row, toRowOff: 0,
  };
}

/** Cell + offset of a point `emu` along the columns (or rows) from `start`. */
function locate(sheetXml: string, axis: 'col' | 'row', start: number, emu: number): { idx: number; off: number } {
  let idx = start;
  let left = Math.max(0, Math.round(emu));
  for (let guard = 0; guard < 200; guard++) {
    const one: AnchorBox = axis === 'col'
      ? { fromCol: idx, fromColOff: 0, fromRow: 0, fromRowOff: 0, toCol: idx + 1, toColOff: 0, toRow: 0, toRowOff: 0 }
      : { fromCol: 0, fromColOff: 0, fromRow: idx, fromRowOff: 0, toCol: 0, toColOff: 0, toRow: idx + 1, toRowOff: 0 };
    const size = axis === 'col' ? anchorSizeEmu(sheetXml, one).cx : anchorSizeEmu(sheetXml, one).cy;
    if (left < size || size <= 0) return { idx, off: left };
    left -= size;
    idx++;
  }
  return { idx, off: 0 };
}

/** Fit an image into a box (with padding), aligned; returns the picture's anchor and size in EMU. */
export function fitInBox(
  sheetXml: string, range: string, img: Pick<CertImage, 'width' | 'height'>, align: 'centre' | 'bottom', padPt = 3,
): { anchor: AnchorBox; cx: number; cy: number } {
  const box = rangeBox(range);
  const { cx: bw, cy: bh } = anchorSizeEmu(sheetXml, box);
  const pad = padPt * EMU_PER_PT;
  const aw = Math.max(1, bw - 2 * pad), ah = Math.max(1, bh - 2 * pad);
  const scale = Math.min(aw / img.width, ah / img.height);
  const cx = Math.round(img.width * scale), cy = Math.round(img.height * scale);
  const x = pad + (aw - cx) / 2;
  const y = align === 'centre' ? pad + (ah - cy) / 2 : pad + (ah - cy);
  const f = { c: locate(sheetXml, 'col', box.fromCol, x), r: locate(sheetXml, 'row', box.fromRow, y) };
  const t = { c: locate(sheetXml, 'col', box.fromCol, x + cx), r: locate(sheetXml, 'row', box.fromRow, y + cy) };
  return {
    anchor: {
      fromCol: f.c.idx, fromColOff: f.c.off, fromRow: f.r.idx, fromRowOff: f.r.off,
      toCol: t.c.idx, toColOff: t.c.off, toRow: t.r.idx, toRowOff: t.r.off,
    },
    cx, cy,
  };
}

function pictureXml(id: number, name: string, relId: string, fit: { anchor: AnchorBox; cx: number; cy: number }): string {
  const a = fit.anchor;
  return `<xdr:twoCellAnchor editAs="oneCell">` +
    `<xdr:from><xdr:col>${a.fromCol}</xdr:col><xdr:colOff>${a.fromColOff}</xdr:colOff><xdr:row>${a.fromRow}</xdr:row><xdr:rowOff>${a.fromRowOff}</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>${a.toCol}</xdr:col><xdr:colOff>${a.toColOff}</xdr:colOff><xdr:row>${a.toRow}</xdr:row><xdr:rowOff>${a.toRowOff}</xdr:rowOff></xdr:to>` +
    `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${name}" descr="${name}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
    `<xdr:blipFill><a:blip xmlns:r="${NS_R}" r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${fit.cx}" cy="${fit.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
    `</xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`;
}

const EMPTY_DRAWING =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"></xdr:wsDr>';
const EMPTY_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

const nextRelId = (relsXml: string) =>
  `rId${Math.max(0, ...parseRels(relsXml).map((r) => Number(/^rId(\d+)$/.exec(r.id)?.[1] ?? 0))) + 1}`;

/** Elements that follow <drawing> in a worksheet (CT_Worksheet order). */
const AFTER_DRAWING = ['legacyDrawing', 'legacyDrawingHF', 'drawingHF', 'picture', 'oleObjects', 'controls',
  'webPublishItems', 'tableParts', 'extLst'];

async function ensureDefault(zip: JSZip, ext: string, type: string): Promise<void> {
  const ct = await readText(zip, '[Content_Types].xml');
  if (!new RegExp(`<Default\\b[^>]*Extension="${ext}"`, 'i').test(ct))
    zip.file('[Content_Types].xml', ct.replace('</Types>', `<Default Extension="${ext}" ContentType="${type}"/></Types>`));
}

/** Is a part still the target of any relationship? */
async function referenced(zip: JSZip, part: string): Promise<boolean> {
  for (const name of Object.keys(zip.files)) {
    if (!name.endsWith('.rels') || zip.files[name].dir) continue;
    const owner = name.replace(/_rels\/([^/]+)\.rels$/, '$1');
    for (const r of parseRels(await readText(zip, name))) if (!r.external && resolveTarget(owner, r.target) === part) return true;
  }
  return false;
}

/** Place / replace / remove the stamp and signature pictures on the certification sheet. */
export async function placeCertImages(
  zip: JSZip, sheets: { name: string; part: string }[], def: CertImagesDef, images: CertImages,
): Promise<CertImagesReport> {
  const report: CertImagesReport = { placed: [], removed: 0, drawingPart: null, createdDrawing: false };
  const sheet = sheets.find((s) => s.name === def.sheet);
  if (!sheet) throw new Error(`no sheet ${def.sheet}`);
  let sheetXml = await readText(zip, sheet.part);
  const want = (['stamp', 'signature'] as const).filter((k) => images[k]);
  const sheetRelsPart = relsPathFor(sheet.part);
  let sheetRels = zip.file(sheetRelsPart) ? await readText(zip, sheetRelsPart) : EMPTY_RELS;

  // the sheet's drawing: existing (a workbook exported before, or a template with one) or new
  let drawingPart: string | null = null;
  const drawingTag = /<drawing\b[^>]*\/>/.exec(sheetXml);
  if (drawingTag) {
    const rel = parseRels(sheetRels).find((r) => r.id === attr(drawingTag[0], 'r:id'));
    if (rel) drawingPart = resolveTarget(sheet.part, rel.target);
  }
  if (!drawingPart) {
    if (!want.length) return report; // nothing there, nothing to place
    const used = Object.keys(zip.files).map((n) => /^xl\/drawings\/drawing(\d+)\.xml$/.exec(n)?.[1]).filter(Boolean).map(Number);
    drawingPart = `xl/drawings/drawing${Math.max(0, ...used) + 1}.xml`;
    zip.file(drawingPart, EMPTY_DRAWING);
    const ct = await readText(zip, '[Content_Types].xml');
    zip.file('[Content_Types].xml', ct.replace('</Types>', `<Override PartName="/${drawingPart}" ContentType="${CT_DRAWING}"/></Types>`));
    const rId = nextRelId(sheetRels);
    sheetRels = sheetRels.replace('</Relationships>',
      `<Relationship Id="${rId}" Type="${REL_DRAWING}" Target="../drawings/${drawingPart.split('/').pop()}"/></Relationships>`);
    zip.file(sheetRelsPart, sheetRels);
    if (!/<worksheet\b[^>]*\sxmlns:r=/.test(sheetXml)) sheetXml = sheetXml.replace(/<worksheet\b/, `<worksheet xmlns:r="${NS_R}"`);
    const tag = `<drawing r:id="${rId}"/>`;
    const next = AFTER_DRAWING.map((n) => new RegExp(`<${n}\\b`).exec(sheetXml)?.index).filter((i): i is number => i !== undefined);
    const at = next.length ? Math.min(...next) : sheetXml.lastIndexOf('</worksheet>');
    sheetXml = sheetXml.slice(0, at) + tag + sheetXml.slice(at);
    report.createdDrawing = true;
  }
  report.drawingPart = drawingPart;
  const drawingRelsPart = relsPathFor(drawingPart);
  let drawingXml = await readText(zip, drawingPart);
  let drawingRels = zip.file(drawingRelsPart) ? await readText(zip, drawingRelsPart) : EMPTY_RELS;

  // remove our pictures from an earlier export (and their image parts when nothing else uses them)
  const ours = new Set<string>(Object.values(CERT_PICTURE_NAMES));
  const oldMedia: string[] = [];
  for (const pic of drawingPictures(drawingXml)) {
    if (!ours.has(pic.name)) continue;
    drawingXml = drawingXml.replace(pic.xml, '');
    report.removed++;
    const rel = parseRels(drawingRels).find((r) => r.id === pic.embed);
    if (rel) {
      drawingRels = drawingRels.replace(rel.tag, '');
      oldMedia.push(resolveTarget(drawingPart, rel.target));
    }
  }

  // add the images
  let nextId = Math.max(0, ...[...drawingXml.matchAll(/<xdr:cNvPr\b[^>]*\sid="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  for (const k of want) {
    const img = images[k]!;
    const used = Object.keys(zip.files).map((n) => /^xl\/media\/image(\d+)\./.exec(n)?.[1]).filter(Boolean).map(Number);
    const media = `xl/media/image${Math.max(0, ...used) + 1}.${img.type === 'png' ? 'png' : 'jpeg'}`;
    zip.file(media, img.bytes);
    await ensureDefault(zip, img.type === 'png' ? 'png' : 'jpeg', img.type === 'png' ? 'image/png' : 'image/jpeg');
    const rId = nextRelId(drawingRels);
    drawingRels = drawingRels.replace('</Relationships>',
      `<Relationship Id="${rId}" Type="${REL_IMAGE}" Target="../media/${media.split('/').pop()}"/></Relationships>`);
    const fit = k === 'stamp' ? fitInBox(sheetXml, def.stamp, img, 'centre') : fitInBox(sheetXml, def.signature, img, 'bottom', 1);
    drawingXml = drawingXml.replace('</xdr:wsDr>', `${pictureXml(nextId++, CERT_PICTURE_NAMES[k], rId, fit)}</xdr:wsDr>`);
    report.placed.push(k);
  }
  zip.file(drawingPart, drawingXml);
  zip.file(drawingRelsPart, drawingRels);
  for (const m of oldMedia) if (!(await referenced(zip, m))) zip.remove(m);

  // the template's "insert the stamp image here" note goes once an image is on the page
  if (want.length) {
    const cell = new RegExp(`<c r="${esc(def.placeholder)}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`).exec(sheetXml);
    if (cell) {
      const s = attr(`<c${cell[1]}>`, 's');
      sheetXml = sheetXml.replace(cell[0], `<c r="${def.placeholder}"${s ? ` s="${s}"` : ''}/>`);
    }
  }
  zip.file(sheet.part, sheetXml);
  return report;
}
