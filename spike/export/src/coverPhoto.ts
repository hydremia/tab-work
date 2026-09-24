/**
 * Cover photo: find the "Project Photo" picture on the Cover Page drawing, compute its box from the
 * sheet's column widths / row heights, centre-crop the supplied JPEG to that aspect ratio, downscale,
 * and re-encode as JPEG.
 *
 * Pure JS (jpeg-js), so it also runs in a browser; the real app should use a canvas / createImageBitmap
 * instead (much faster, honours EXIF orientation, decodes HEIC on iOS Safari).
 */
import jpeg from 'jpeg-js';
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

/** Centre-crop to `aspect` (width / height), box-filter downscale to at most maxWidth, encode JPEG. */
export function cropResizeJpeg(src: Uint8Array, aspect: number, maxWidth = 1600, quality = 85): CroppedPhoto {
  const img = jpeg.decode(src, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 200 });
  const W = img.width, H = img.height;
  let cw = W, ch = Math.round(W / aspect);
  if (ch > H) { ch = H; cw = Math.round(H * aspect); }
  const cx0 = Math.floor((W - cw) / 2), cy0 = Math.floor((H - ch) / 2);
  const tw = Math.min(maxWidth, cw), th = Math.max(1, Math.round(tw / aspect));
  const out = new Uint8Array(tw * th * 4);
  const sx = cw / tw, sy = ch / th;
  const data = img.data;
  for (let ty = 0; ty < th; ty++) {
    const y0 = cy0 + Math.floor(ty * sy), y1 = Math.max(y0 + 1, cy0 + Math.floor((ty + 1) * sy));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = cx0 + Math.floor(tx * sx), x1 = Math.max(x0 + 1, cx0 + Math.floor((tx + 1) * sx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * W + x0) * 4;
        for (let x = x0; x < x1; x++, i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
      }
      const o = (ty * tw + tx) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  const enc = jpeg.encode({ data: out, width: tw, height: th }, quality);
  return { jpeg: new Uint8Array(enc.data), width: tw, height: th, srcWidth: W, srcHeight: H, crop: { x: cx0, y: cy0, w: cw, h: ch } };
}
