/**
 * Cover photo: find the "Project Photo" picture on the Cover Page drawing and compute its box from the
 * sheet's column widths / row heights. The pixel work (centre crop to the box aspect, downscale, JPEG encode)
 * is platform specific and injected into the exporter as a `CoverPhotoCropper`:
 *  - browser: `cropCoverPhotoBrowser` in ./coverPhotoBrowser.ts (createImageBitmap + canvas, honours EXIF
 *    orientation, decodes HEIC on iOS Safari);
 *  - Node: `cropResizeJpeg` in spike/export/src/coverPhotoNode.ts (jpeg-js, pure JS).
 */
import { attr } from './ooxml.js';

export interface AnchorBox {
  fromCol: number; fromColOff: number; fromRow: number; fromRowOff: number;
  toCol: number; toColOff: number; toRow: number; toRowOff: number;
}

/** twoCellAnchor blocks of a drawing part, with the picture name and blip relationship id. */
export function drawingPictures(drawingXml: string): { name: string; embed?: string; anchor?: AnchorBox; xml: string }[] {
  const out: { name: string; embed?: string; anchor?: AnchorBox; xml: string }[] = [];
  for (const m of drawingXml.matchAll(/<xdr:(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[\s\S]*?<\/xdr:\1>/g)) {
    const xml = m[0];
    const nv = /<xdr:cNvPr\b[^>]*>/.exec(xml);
    const blip = /<a:blip\b[^>]*>/.exec(xml);
    const n = (tag: string, name: string) => Number(new RegExp(`<xdr:${tag}>[\\s\\S]*?<xdr:${name}>(-?\\d+)<`).exec(xml)?.[1]);
    const anchor = m[1] === 'twoCellAnchor' ? {
      fromCol: n('from', 'col'), fromColOff: n('from', 'colOff'), fromRow: n('from', 'row'), fromRowOff: n('from', 'rowOff'),
      toCol: n('to', 'col'), toColOff: n('to', 'colOff'), toRow: n('to', 'row'), toRowOff: n('to', 'rowOff'),
    } : undefined;
    out.push({ name: nv ? attr(nv[0], 'name') ?? '' : '', embed: blip ? attr(blip[0], 'r:embed') : undefined, anchor, xml });
  }
  return out;
}

const EMU_PER_PX = 9525;
const EMU_PER_PT = 12700;
/** Maximum digit width of the workbook's default font (Calibri 11 -> 7 px). */
const MDW = 7;

/** Excel column width (characters, as stored in <col width>) -> pixels at 96 dpi. */
export function colWidthPx(width: number): number {
  return Math.trunc(((256 * width + Math.trunc(128 / MDW)) / 256) * MDW);
}

/** Size of an anchor box in EMU, from the sheet's <cols> widths and <row ht> heights. */
export function anchorSizeEmu(sheetXml: string, a: AnchorBox): { cx: number; cy: number; detail: string } {
  const fmt = /<sheetFormatPr\b[^>]*>/.exec(sheetXml)?.[0] ?? '';
  const defColW = Number(attr(fmt, 'defaultColWidth') ?? (Number(attr(fmt, 'baseColWidth') ?? 8) + 0.7109375));
  const defRowHt = Number(attr(fmt, 'defaultRowHeight') ?? 15);
  const colW = (c1: number) => { // c1: 1-based column number
    for (const m of sheetXml.matchAll(/<col\b[^>]*\/>/g)) {
      const min = Number(attr(m[0], 'min')), max = Number(attr(m[0], 'max'));
      if (c1 >= min && c1 <= max) return attr(m[0], 'hidden') === '1' ? 0 : Number(attr(m[0], 'width') ?? defColW);
    }
    return defColW;
  };
  const rowHt = (r1: number) => {
    const m = new RegExp(`<row\\b[^>]*\\sr="${r1}"[^>]*>`).exec(sheetXml);
    if (m && attr(m[0], 'hidden') === '1') return 0;
    return Number((m && attr(m[0], 'ht')) ?? defRowHt);
  };
  let cx = 0, cy = 0;
  const widths: number[] = [], heights: number[] = [];
  for (let c = a.fromCol; c < a.toCol; c++) { const px = colWidthPx(colW(c + 1)); widths.push(px); cx += px * EMU_PER_PX; }
  for (let r = a.fromRow; r < a.toRow; r++) { const pt = rowHt(r + 1); heights.push(pt); cy += pt * EMU_PER_PT; }
  cx += a.toColOff - a.fromColOff;
  cy += a.toRowOff - a.fromRowOff;
  const detail = `${widths.length} cols (${[...new Set(widths)].join('/')} px) x ${heights.length} rows (${[...new Set(heights)].join('/')} pt)`;
  return { cx, cy, detail };
}

export interface CroppedPhoto {
  jpeg: Uint8Array;
  width: number; height: number;
  srcWidth: number; srcHeight: number;
  crop: { x: number; y: number; w: number; h: number };
}

/** Centre-crop `src` (encoded image bytes) to `aspect` (width / height), downscale to at most maxWidth, encode JPEG. */
export type CoverPhotoCropper = (src: Uint8Array, aspect: number, maxWidth: number, quality: number) => CroppedPhoto | Promise<CroppedPhoto>;

/** Centre crop rectangle of a W x H image for the given aspect, and the output size (at most maxWidth wide). */
export function centreCrop(W: number, H: number, aspect: number, maxWidth: number):
  { x: number; y: number; w: number; h: number; outW: number; outH: number } {
  let cw = W, ch = Math.round(W / aspect);
  if (ch > H) { ch = H; cw = Math.round(H * aspect); }
  const x = Math.floor((W - cw) / 2), y = Math.floor((H - ch) / 2);
  const outW = Math.min(maxWidth, cw), outH = Math.max(1, Math.round(outW / aspect));
  return { x, y, w: cw, h: ch, outW, outH };
}
