/**
 * Schedule tables from a PDF or a photo (browser; lazy-loaded with the schedule file reader).
 *
 *   lines    every page is rendered at about 100 dpi and its ruling lines found (domain/rasterLines.ts)
 *   words    from the PDF's text layer; a page without one (text drawn as outlines, a scan) or a photo is read by text
 *            recognition (tesseract.js, served from /ocr, offline once cached): only inside the tables the lines
 *            form (plus a margin above for the title), at about 200 dpi, in tiles a phone can handle
 *   tables   words into the cells of the grid (domain/tableGrid.ts); tables without lines fall back to the
 *            whitespace method (domain/pdfTables.ts)
 * Coordinates: PDF points, y downwards, on the upright page (the viewport at scale 1).
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cleanOcrCell, cleanOcrWord } from '../domain/ocrClean';
import { pageWords, pdfTables, wordsToPage, type PdfPageText, type PdfTable } from '../domain/pdfTables';
import { autoMap } from '../domain/scheduleImport';
import type { EquipmentTypeKey } from '../domain/equipmentTypes';
import { findLines, toGray, type HLine, type VLine } from '../domain/rasterLines';
import { gridTables, tableBoxes, type GridTable, type Word } from '../domain/tableGrid';

export type Progress = (message: string) => void;

export interface FoundTable extends PdfTable {
  /** read by text recognition */
  ocr: boolean;
  /** body cells OCR was unsure of: [row index in `rows`, column] */
  lowConfidence: [number, number][];
}

export const MAX_PDF_PAGES = 200;
const LINE_DPI = 100;
const OCR_DPI = 200;
/** a canvas larger than this fails on phones (iOS: 16.7 MP) */
const MAX_CANVAS_PX = 12_000_000;
const TILE_PX = 2400;
const TILE_OVERLAP_PX = 96;
/** room above a table for its title, points */
const TITLE_MARGIN = 40;

type Lines = { h: HLine[]; v: VLine[] };

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Ruling lines of a raster, returned in the caller's units (px / scale). */
function linesOf(canvas: HTMLCanvasElement, scale: number, dpi = 72 * scale): Lines {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const found = findLines(toGray(img.data, canvas.width, canvas.height), {
    threshold: 230,
    minLength: Math.max(20, Math.round(0.3 * dpi)),
    maxThickness: Math.max(4, Math.round(dpi / 18)),
  });
  return {
    h: found.h.map((l) => ({ y: l.y / scale, x0: l.x0 / scale, x1: l.x1 / scale })),
    v: found.v.map((l) => ({ x: l.x / scale, y0: l.y0 / scale, y1: l.y1 / scale })),
  };
}

async function renderRegion(
  page: PDFPageProxy,
  scale: number,
  r: { x0: number; y0: number; x1: number; y1: number },
): Promise<HTMLCanvasElement> {
  const canvas = canvasOf((r.x1 - r.x0) * scale, (r.y1 - r.y0) * scale);
  const viewport = page.getViewport({ scale, offsetX: -r.x0 * scale, offsetY: -r.y0 * scale });
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}

// ------------------------------------------------------------------------------------------ text recognition
/** WebAssembly SIMD (every current browser): a module using one SIMD instruction validates. */
function simdSupported(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
      ]),
    );
  } catch {
    return false;
  }
}
type OcrWorker = Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>;

/** One tesseract worker for a whole file (created on first use, terminated by the caller). */
export class Ocr {
  private worker: Promise<OcrWorker> | null = null;
  constructor(private readonly progress: Progress = () => undefined) {}

  private get(): Promise<OcrWorker> {
    this.worker ??= (async () => {
      this.progress('Loading text recognition…');
      const { createWorker, OEM } = await import('tesseract.js');
      const w = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: '/ocr/worker.min.js',
        // one of the two builds copied to /ocr (scripts/copy-ocr.mjs), not tesseract.js' own pick of four
        corePath: simdSupported() ? '/ocr/tesseract-core-simd-lstm.wasm.js' : '/ocr/tesseract-core-lstm.wasm.js',
        langPath: '/ocr',
        workerBlobURL: false,
        gzip: true,
        // the service worker caches /ocr (vite.config.ts); no second copy in IndexedDB
        cacheMethod: 'none',
      });
      await w.setParameters({ preserve_interword_spaces: '1' });
      return w;
    })();
    return this.worker;
  }

  private mode: 'sparse' | 'block' | null = null;

  /**
   * Words of a canvas, in the canvas' pixels. 'sparse': text anywhere (a table region); 'block': one cell read again
   * on its own (short words the sparse pass can drop).
   */
  async words(canvas: HTMLCanvasElement, mode: 'sparse' | 'block' = 'sparse'): Promise<Word[]> {
    const w = await this.get();
    if (this.mode !== mode) {
      const { PSM } = await import('tesseract.js');
      await w.setParameters({ tessedit_pageseg_mode: mode === 'sparse' ? PSM.SPARSE_TEXT : PSM.SINGLE_BLOCK });
      this.mode = mode;
    }
    const { data } = await w.recognize(canvas, {}, { blocks: true });
    const out: Word[] = [];
    for (const b of data.blocks ?? [])
      for (const p of b.paragraphs)
        for (const l of p.lines)
          for (const x of l.words) {
            const text = cleanOcrWord(x.text);
            if (text)
              out.push({ text, conf: x.confidence, x0: x.bbox.x0, y0: x.bbox.y0, x1: x.bbox.x1, y1: x.bbox.y1 });
          }
    return out;
  }

  async stop(): Promise<void> {
    if (this.worker) await (await this.worker).terminate();
    this.worker = null;
  }
}

/** Tiles over a region (px), overlapping; each word is kept by the tile whose core holds its centre. */
function tiles(width: number, height: number) {
  const out: {
    x: number;
    y: number;
    w: number;
    h: number;
    core: { x0: number; y0: number; x1: number; y1: number };
  }[] = [];
  const step = TILE_PX - TILE_OVERLAP_PX;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const w = Math.min(TILE_PX, width - x);
      const h = Math.min(TILE_PX, height - y);
      out.push({
        x,
        y,
        w,
        h,
        core: {
          x0: x === 0 ? 0 : x + TILE_OVERLAP_PX / 2,
          y0: y === 0 ? 0 : y + TILE_OVERLAP_PX / 2,
          x1: x + w >= width ? width : x + w - TILE_OVERLAP_PX / 2,
          y1: y + h >= height ? height : y + h - TILE_OVERLAP_PX / 2,
        },
      });
      if (x + w >= width) break;
    }
    if (y + Math.min(TILE_PX, height - y) >= height) break;
  }
  return out;
}

/**
 * A schedule: its title says so, or its header names a unit (designation) and at least one other field of some type.
 * Other grids on a drawing (revision blocks, legends, detail tables) are left out.
 */
function looksLikeSchedule(t: GridTable): boolean {
  if (t.title && /schedule/i.test(t.title)) return true;
  if (!t.hasHeader) return false;
  const types = t.type ? [t.type] : (['rtu', 'fan', 'vav', 'pump'] as EquipmentTypeKey[]);
  return types.some((type) => {
    const m = autoMap(t.rows[0], type);
    return m.includes('designation') && m.filter(Boolean).length >= 2;
  });
}

/**
 * The ruling lines of an OCR tile painted white: text recognition reads fragments of lines as letters ("TT", "ANT")
 * and lines touching text hide it.
 */
function eraseLines(canvas: HTMLCanvasElement, dpi: number): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const found = findLines(toGray(img.data, canvas.width, canvas.height), {
    threshold: 200,
    minLength: Math.max(24, Math.round(0.3 * dpi)),
    maxThickness: Math.max(4, Math.round(dpi / 15)),
  });
  const r = Math.max(2, Math.round(dpi / 60));
  ctx.fillStyle = '#fff';
  for (const l of found.h) ctx.fillRect(l.x0 - r, l.y - r, l.x1 - l.x0 + 2 * r, 2 * r + 1);
  for (const l of found.v) ctx.fillRect(l.x - r, l.y0 - r, 2 * r + 1, l.y1 - l.y0 + 2 * r);
}

type Box = { x0: number; y0: number; x1: number; y1: number };

/** A raster being read: `canvas` shows the units box (x0, y0) … at `scale` px per unit (lines already erased). */
interface Sheet {
  canvas: HTMLCanvasElement;
  scale: number;
  x0: number;
  y0: number;
}

function crop(sheet: Sheet, b: Box): HTMLCanvasElement | null {
  const x = Math.round((b.x0 - sheet.x0) * sheet.scale);
  const y = Math.round((b.y0 - sheet.y0) * sheet.scale);
  const w = Math.min(sheet.canvas.width - x, Math.round((b.x1 - b.x0) * sheet.scale));
  const h = Math.min(sheet.canvas.height - y, Math.round((b.y1 - b.y0) * sheet.scale));
  if (x < 0 || y < 0 || w < 4 || h < 4) return null;
  const c = canvasOf(w, h);
  c.getContext('2d')!.drawImage(sheet.canvas, x, y, w, h, 0, 0, w, h);
  return c;
}

const toUnits = (sheet: Sheet, ox: number, oy: number, w: Word): Word => ({
  ...w,
  x0: sheet.x0 + (ox + w.x0) / sheet.scale,
  y0: sheet.y0 + (oy + w.y0) / sheet.scale,
  x1: sheet.x0 + (ox + w.x1) / sheet.scale,
  y1: sheet.y0 + (oy + w.y1) / sheet.scale,
});

/** All words of a sheet, tile by tile. */
async function sheetWords(ocr: Ocr, sheet: Sheet, progress: Progress, label: string): Promise<Word[]> {
  const out: Word[] = [];
  const ts = tiles(sheet.canvas.width, sheet.canvas.height);
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    progress(`${label}: text recognition${ts.length > 1 ? `, part ${i + 1} of ${ts.length}` : ''}…`);
    const c = canvasOf(t.w, t.h);
    c.getContext('2d')!.drawImage(sheet.canvas, t.x, t.y, t.w, t.h, 0, 0, t.w, t.h);
    for (const w of await ocr.words(c)) {
      const cx = t.x + (w.x0 + w.x1) / 2;
      const cy = t.y + (w.y0 + w.y1) / 2;
      if (cx < t.core.x0 || cx >= t.core.x1 || cy < t.core.y0 || cy >= t.core.y1) continue;
      out.push(toUnits(sheet, t.x, t.y, w));
    }
  }
  return out;
}

/** One cell read again on its own (inside its borders), words in units. */
async function cellWords(ocr: Ocr, sheet: Sheet, box: Box): Promise<Word[]> {
  const pad = 2 / sheet.scale;
  const b = { x0: box.x0 + pad, y0: box.y0 + pad, x1: box.x1 - pad, y1: box.y1 - pad };
  const c = crop(sheet, b);
  if (!c) return [];
  const ox = Math.round((b.x0 - sheet.x0) * sheet.scale);
  const oy = Math.round((b.y0 - sheet.y0) * sheet.scale);
  return (await ocr.words(c, 'block')).map((w) => toUnits(sheet, ox, oy, w));
}

const inBox = (w: Word, b: Box) => {
  const cx = (w.x0 + w.x1) / 2;
  const cy = (w.y0 + w.y1) / 2;
  return cx >= b.x0 && cx < b.x1 && cy >= b.y0 && cy < b.y1;
};
const meanConf = (ws: Word[]) => (ws.length ? ws.reduce((a, w) => a + (w.conf ?? 0), 0) / ws.length : 0);

/**
 * The schedules on one sheet: its words into the grids the lines form, then a second look at the cells that need
 * one (empty where text is expected; read with low confidence: the more confident reading is kept).
 */
async function sheetTables(
  ocr: Ocr,
  sheet: Sheet,
  lines: Lines,
  known: readonly string[],
  pageNo: number,
  progress: Progress,
  label: string,
): Promise<FoundTable[]> {
  let words = await sheetWords(ocr, sheet, progress, label);
  const area: Box = {
    x0: sheet.x0,
    y0: sheet.y0,
    x1: sheet.x0 + sheet.canvas.width / sheet.scale,
    y1: sheet.y0 + sheet.canvas.height / sheet.scale,
  };
  const build = () =>
    gridTables(lines, words, known, pageNo, 3).filter(
      (t) => looksLikeSchedule(t) && inBox({ text: '', ...t.box }, area),
    );
  let grid = build();
  // at most 40 of each per table: each takes a moment on a phone
  const retry = grid.flatMap((t) => t.retry.slice(0, 40));
  const recheck = grid.flatMap((t) => t.recheck.slice(0, 40));
  if (retry.length || recheck.length) {
    progress(`${label}: checking ${retry.length + recheck.length} cells…`);
    for (const box of retry) words.push(...(await cellWords(ocr, sheet, box)));
    for (const box of recheck) {
      const again = await cellWords(ocr, sheet, box);
      const before = words.filter((w) => inBox(w, box));
      if (again.length && meanConf(again) > meanConf(before) + 5)
        words = [...words.filter((w) => !inBox(w, box)), ...again];
    }
    grid = build();
  }
  if (!grid.length) {
    // no schedule grid: the whitespace method on the words
    const size = { width: area.x1, height: area.y1 };
    return pdfTables([wordsToPage(words, pageNo, size.width, size.height)], known).map((t) => ({
      ...t,
      ocr: true,
      lowConfidence: [],
    }));
  }
  return grid.map((t) => ({
    page: t.page,
    title: t.title,
    hasHeader: t.hasHeader,
    type: t.type,
    rows: t.rows.map((r) => r.map((c) => cleanOcrCell(typeof c === 'string' ? c : null))),
    ocr: true,
    lowConfidence: t.lowConfidence,
  }));
}

/** Text-layer tables: the grid first, else the whitespace method. */
function textTables(lines: Lines, text: PdfPageText, known: readonly string[]): FoundTable[] {
  const grid = gridTables(lines, pageWords(text), known, text.page, 3).filter(looksLikeSchedule);
  if (grid.length)
    return grid.map((t) => ({
      page: t.page,
      title: t.title,
      hasHeader: t.hasHeader,
      type: t.type,
      rows: t.rows,
      ocr: false,
      lowConfidence: [],
    }));
  return pdfTables([text], known).map((t) => ({ ...t, ocr: false, lowConfidence: [] }));
}

// ------------------------------------------------------------------------------------------ PDF
export async function readPdfSchedules(
  bytes: Uint8Array,
  known: readonly string[],
  progress: Progress = () => undefined,
): Promise<{ tables: FoundTable[]; ocrPages: number; pageCount: number }> {
  const { textPages, doc, task } = await openPdf(bytes);
  const ocr = new Ocr(progress);
  const tables: FoundTable[] = [];
  let ocrPages = 0;
  try {
    for (const text of textPages) {
      const page = await doc.getPage(text.page);
      const label = `Page ${text.page} of ${doc.numPages}`;
      progress(`${label}: finding the tables…`);
      const view = page.getViewport({ scale: 1 });
      const lineScale = Math.min(LINE_DPI / 72, Math.sqrt(MAX_CANVAS_PX / (view.width * view.height)));
      const lines = linesOf(
        await renderRegion(page, lineScale, { x0: 0, y0: 0, x1: view.width, y1: view.height }),
        lineScale,
      );
      if (text.items.some((it) => it.str.trim())) {
        tables.push(...textTables(lines, text, known));
        page.cleanup();
        continue;
      }
      ocrPages++;
      // the schedule grids (with room for a title above); none: the whole page, at a lower resolution
      const boxes = tableBoxes(lines, 3).map((b) => ({
        x0: Math.max(0, b.x0 - 4),
        y0: Math.max(0, b.y0 - TITLE_MARGIN),
        x1: Math.min(view.width, b.x1 + 4),
        y1: Math.min(view.height, b.y1 + 4),
      }));
      const regions = boxes.length ? boxes : [{ x0: 0, y0: 0, x1: view.width, y1: view.height }];
      for (let i = 0; i < regions.length; i++) {
        const r = regions[i];
        const area = (r.x1 - r.x0) * (r.y1 - r.y0);
        // one render per table, as large as a phone's canvas allows (200 dpi when it fits)
        const scale = Math.min((boxes.length ? OCR_DPI : 150) / 72, Math.sqrt(MAX_CANVAS_PX / area));
        const tag = `${label}${regions.length > 1 ? `, table ${i + 1} of ${regions.length}` : ''}`;
        progress(`${tag}: text recognition…`);
        const canvas = await renderRegion(page, scale, r);
        eraseLines(canvas, 72 * scale);
        tables.push(
          ...(await sheetTables(ocr, { canvas, scale, x0: r.x0, y0: r.y0 }, lines, known, text.page, progress, tag)),
        );
      }
      page.cleanup();
    }
    return { tables, ocrPages, pageCount: doc.numPages };
  } finally {
    await ocr.stop();
    await task.destroy();
  }
}

async function openPdf(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  const task = pdfjs.getDocument({ data: bytes, verbosity: 0 });
  const doc: PDFDocumentProxy = await task.promise;
  const textPages: PdfPageText[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
    const page = await doc.getPage(n);
    const view = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const [a, b, c, d, e, f] = view.transform;
    const items = content.items.flatMap((it) => {
      if (!('str' in it)) return [];
      const [ia, ib, ic, id, ix, iy] = it.transform as number[];
      // the viewport transform brings a rotated sheet upright, then y is flipped back to upwards for pdfTables
      return [
        {
          str: it.str,
          width: it.width,
          height: it.height,
          transform: [
            a * ia + c * ib,
            -(b * ia + d * ib),
            a * ic + c * id,
            -(b * ic + d * id),
            a * ix + c * iy + e,
            view.height - (b * ix + d * iy + f),
          ],
        },
      ];
    });
    textPages.push({ page: n, width: view.width, height: view.height, items });
  }
  return { textPages, doc, task };
}

// ------------------------------------------------------------------------------------------ photos
/** A photo or scan of a schedule (JPEG / PNG / WebP): lines and text recognition on the image itself. */
export async function readImageSchedules(
  file: Blob,
  known: readonly string[],
  progress: Progress = () => undefined,
): Promise<FoundTable[]> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  // work at no more than ~12 MP (a phone photo is 12 MP: kept as is)
  const k = Math.min(1, Math.sqrt(MAX_CANVAS_PX / (bitmap.width * bitmap.height)));
  const W = Math.round(bitmap.width * k);
  const H = Math.round(bitmap.height * k);
  const canvas = canvasOf(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(bitmap, 0, 0, W, H);
  bitmap.close();
  progress('Finding the tables…');
  // a schedule photo: about 8 in. across the frame
  const dpi = W / 8;
  const lines = linesOf(canvas, 1, dpi);
  eraseLines(canvas, dpi);
  const ocr = new Ocr(progress);
  try {
    return await sheetTables(ocr, { canvas, scale: 1, x0: 0, y0: 0 }, lines, known, 1, progress, 'Photo');
  } finally {
    await ocr.stop();
  }
}
