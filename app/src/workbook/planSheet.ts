/**
 * Reading a plan sheet for "Import from plan" (browser; lazy-loaded): the page's text and vector geometry through
 * pdf.js, the air device tags (domain/planDevices.ts) placed on their symbols (domain/planSymbols.ts).
 *
 * A sheet whose text was plotted as strokes (CAD SHX fonts) or scanned has no text layer: its hexagon tag frames
 * are found in the geometry, each frame's inside is rendered at about 300 dpi (the outline left out, the halves of
 * a divided hexagon apart) and read by text recognition (tesseract.js, as the schedule import does), and the words
 * go through the same tag reader. Coordinates: PDF points, y downwards, on the upright page.
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PlanSheetDevice } from '../data/types';
import { planDevices, type PlanDevice } from '../domain/planDevices';
import { glyphs, placeDevices, tagFrames, type Frame } from '../domain/planSymbols';
import { wordsToPage, type PdfPageText } from '../domain/pdfTables';
import type { Word } from '../domain/tableGrid';
import { readPdfGeometry, type PlanPath } from './pdfGeometry';
import { readPdfText } from './pdfText';
import { Ocr, type Progress } from './pdfSchedules';

export interface PlanSheetRead {
  page: number;
  pageCount: number;
  width: number;
  height: number;
  devices: PlanSheetDevice[];
  /** the devices came (at least partly) from text recognition */
  ocr: boolean;
  /** tag frames read by text recognition (for the sheet view) */
  frames: Frame[];
}

/** A plan sheet's pages (count and sizes), to pick the page. */
export async function planPdfInfo(
  bytes: Uint8Array,
): Promise<{ pageCount: number; sizes: { width: number; height: number }[] }> {
  const { doc, destroy } = await open(bytes);
  try {
    const sizes: { width: number; height: number }[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, 40); n++) {
      const v = (await doc.getPage(n)).getViewport({ scale: 1 });
      sizes.push({ width: v.width, height: v.height });
    }
    return { pageCount: doc.numPages, sizes };
  } finally {
    await destroy();
  }
}

async function open(bytes: Uint8Array): Promise<{ doc: PDFDocumentProxy; destroy: () => Promise<void> }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}

/** The page rendered at `scale` (1 = 72 dpi) onto a canvas, for the sheet view and thumbnails. */
export async function renderPlanPage(
  bytes: Uint8Array,
  page: number,
  scale: number,
  maxPixels = 16_000_000,
): Promise<HTMLCanvasElement> {
  const { doc, destroy } = await open(bytes);
  try {
    const p = await doc.getPage(page);
    const v1 = p.getViewport({ scale: 1 });
    const s = Math.min(scale, Math.sqrt(maxPixels / (v1.width * v1.height)));
    const viewport = p.getViewport({ scale: s });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvas;
  } finally {
    await destroy();
  }
}

/** A region of the page (points, y downwards) rendered at `scale`. */
async function renderRegion(
  page: PDFPageProxy,
  scale: number,
  r: { x0: number; y0: number; x1: number; y1: number },
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((r.x1 - r.x0) * scale));
  canvas.height = Math.max(1, Math.round((r.y1 - r.y0) * scale));
  const viewport = page.getViewport({ scale, offsetX: -r.x0 * scale, offsetY: -r.y0 * scale });
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** Fewer text-layer devices than this on a page with tag frames: read the frames too. */
const FEW_DEVICES = 3;
const OCR_SCALE = 300 / 72;
const OCR_UPSCALE = 3;
const OCR_PAD = 40;

/**
 * The inside of each tag frame as words (page points). A hexagon's slanted sides are left out by taking the middle
 * 66 % of its width; a divider at mid-height (type over CFM) splits it in two reads.
 */
export async function readFrames(
  doc: PDFDocumentProxy,
  pageNo: number,
  frames: readonly Frame[],
  paths: readonly PlanPath[],
  ocr: Ocr,
  progress: Progress,
): Promise<Word[]> {
  const page = await doc.getPage(pageNo);
  const words: Word[] = [];
  let k = 0;
  for (const f of frames) {
    progress(`Reading tag ${++k} of ${frames.length}…`);
    const w = f.x1 - f.x0;
    const h = f.y1 - f.y0;
    const mid = (f.y0 + f.y1) / 2;
    // the frame's own path: a horizontal run at mid-height is a divider
    const outline = paths.find(
      (p) =>
        Math.abs(p.x0 - f.x0) < 0.5 &&
        Math.abs(p.y0 - f.y0) < 0.5 &&
        Math.abs(p.x1 - f.x1) < 0.5 &&
        Math.abs(p.y1 - f.y1) < 0.5,
    );
    const divided = Boolean(
      outline?.pts.some(
        (p, i) =>
          i < outline.pts.length - 1 &&
          Math.abs(p[1] - outline.pts[i + 1][1]) < 0.6 &&
          Math.abs(p[1] - mid) < 0.15 * h &&
          Math.abs(p[0] - outline.pts[i + 1][0]) > 0.6 * w,
      ),
    );
    const x0 = f.x0 + 0.17 * w;
    const x1 = f.x1 - 0.17 * w;
    const regions = divided
      ? [
          { x0, x1, y0: f.y0 + 0.9, y1: mid - 0.8 },
          { x0, x1, y0: mid + 0.8, y1: f.y1 - 0.9 },
        ]
      : [{ x0, x1, y0: f.y0 + 0.9, y1: f.y1 - 0.9 }];
    for (const r of regions) {
      if (r.y1 - r.y0 < 2 || r.x1 - r.x0 < 2) continue;
      const small = await renderRegion(page, OCR_SCALE, r);
      // upscaled with a white margin: short strokes read better with room around them
      const big = document.createElement('canvas');
      big.width = small.width * OCR_UPSCALE + 2 * OCR_PAD;
      big.height = small.height * OCR_UPSCALE + 2 * OCR_PAD;
      const ctx = big.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, big.width, big.height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(small, OCR_PAD, OCR_PAD, small.width * OCR_UPSCALE, small.height * OCR_UPSCALE);
      for (const wd of await ocr.words(big, 'sparse')) {
        if (!/^[A-Z0-9][A-Z0-9,.-]*$/i.test(wd.text)) continue; // bits of the outline read as punctuation
        const k = OCR_SCALE * OCR_UPSCALE;
        words.push({
          text: wd.text,
          conf: wd.conf,
          x0: r.x0 + (wd.x0 - OCR_PAD) / k,
          y0: r.y0 + (wd.y0 - OCR_PAD) / k,
          x1: r.x0 + (wd.x1 - OCR_PAD) / k,
          y1: r.y0 + (wd.y1 - OCR_PAD) / k,
        });
      }
    }
  }
  page.cleanup();
  return words;
}

/** Placed devices → the sheet's device records (stable keys: tag index and index within the tag). */
export function toSheetDevices(
  devices: readonly PlanDevice[],
  placed: readonly { device: PlanDevice; index: number; x: number; y: number; how: PlanSheetDevice['how'] }[],
): PlanSheetDevice[] {
  const tagIndex = new Map<PlanDevice, number>();
  devices.forEach((d, i) => tagIndex.set(d, i));
  return placed.map((p) => ({
    key: `d${tagIndex.get(p.device) ?? 0}-${p.index}`,
    tag: { x: p.device.x, y: p.device.y, box: p.device.box, lines: p.device.lines },
    type: p.device.type,
    size: p.device.size,
    cfm: p.device.cfm,
    x: p.x,
    y: p.y,
    how: p.how,
    count: p.device.count,
    index: p.index,
  }));
}

/**
 * Read one page of a drawing: its devices placed on the sheet. `knownTypes` are the air device schedule's marks when
 * the user has imported it.
 */
export async function readPlanSheet(
  bytes: Uint8Array,
  pageNo: number,
  opts: { knownTypes?: readonly string[]; progress?: Progress; ocr?: boolean } = {},
): Promise<PlanSheetRead> {
  const progress = opts.progress ?? (() => undefined);
  progress('Reading the sheet’s text…');
  const { pages: textPages, pageCount } = await readPdfText(bytes.slice(), pageNo);
  const text: PdfPageText | undefined = textPages[pageNo - 1];
  if (!text) throw new Error(`The file has ${pageCount} page${pageCount === 1 ? '' : 's'}.`);
  progress('Reading the sheet’s lines…');
  const geo = (await readPdfGeometry(bytes, [pageNo])).pages[0];
  let found = planDevices(text, opts.knownTypes).devices;
  let ocrUsed = false;
  let frames: Frame[] = [];
  if (opts.ocr !== false && found.length < FEW_DEVICES) {
    frames = tagFrames(geo.paths);
    if (frames.length >= FEW_DEVICES) {
      const { doc, destroy } = await open(bytes);
      const ocr = new Ocr(progress);
      try {
        const words = await readFrames(doc, pageNo, frames, geo.paths, ocr, progress);
        const page = wordsToPage(words, pageNo, geo.width, geo.height);
        const fromOcr = planDevices(page, opts.knownTypes).devices;
        found = [...found, ...fromOcr];
        ocrUsed = fromOcr.length > 0;
      } finally {
        await ocr.stop();
        await destroy();
      }
    }
  }
  progress('Placing the devices…');
  const gs = glyphs(geo.paths);
  const placed = placeDevices(found, geo.paths, gs);
  return {
    page: pageNo,
    pageCount,
    width: geo.width,
    height: geo.height,
    devices: toSheetDevices(found, placed),
    ocr: ocrUsed,
    frames: ocrUsed ? frames : [],
  };
}
