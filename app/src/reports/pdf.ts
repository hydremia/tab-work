/**
 * PDF rendering of a ReportModel with pdf-lib (runs in the browser, offline, and in Node for tests).
 * Fonts: the standard PDF Helvetica family (built into every PDF reader; nothing is fetched or embedded from the
 * network). Text is limited to the WinAnsi character set; other characters are replaced (see `sanitizer`).
 * Images are loaded one at a time through `loadImage` (the browser loader downscales each photo to about 200 dpi at
 * its printed size), and the renderer yields to the event loop between photos so the UI stays responsive.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  CONTENT_TOP,
  CONTENT_W,
  CAPTION_LINES,
  CAPTION_SIZE,
  COL_GAP,
  FOOTER_H,
  GROUP_HEAD_H,
  LABEL_SIZE,
  LINE_GAP,
  MARGIN_BOTTOM,
  MARGIN_TOP,
  MARGIN_X,
  PAGE_H,
  PAGE_W,
  ROW_GAP,
  cellBox,
  chunk,
  embedEdgePx,
  fitContain,
  flow,
  gridOf,
  pageCount,
  wrapText,
  type FlowBlock,
} from './layout';
import type { IssueEntry, ReportModel, ReportPhoto } from './model';

export interface LoadedImage {
  bytes: Uint8Array;
  type: 'jpg' | 'png';
}
/** Load one photo's image bytes, downscaled to at most maxEdgePx (null: not available). */
export type ImageLoader = (photoId: string, maxEdgePx: number) => Promise<LoadedImage | null>;

export interface RenderOptions {
  loadImage: ImageLoader;
  /** Called after each photo is placed (done, total). */
  onProgress?: (done: number, total: number) => void;
  /** Creation date written into the PDF info (default now). */
  now?: Date;
}

const INK = rgb(0.08, 0.12, 0.17);
const MUTED = rgb(0.36, 0.41, 0.48);
const RULE = rgb(0.78, 0.81, 0.85);
const BRAND = rgb(0.06, 0.3, 0.51);
const BAND = rgb(0.93, 0.95, 0.97);
const RED = rgb(0.64, 0.14, 0.11);
const GREEN = rgb(0.09, 0.41, 0.23);

const REPLACE: Record<string, string> = {
  Δ: 'd', // Δ
  '≥': '>=',
  '≤': '<=',
  '→': '->',
  '←': '<-',
  '−': '-',
  '≈': '~',
  ' ': ' ',
  ' ': ' ',
  '✓': 'v',
  '✔': 'v',
  '•': '•',
};

/** Replace characters the font cannot encode (WinAnsi); keeps newlines. */
export function sanitizer(font: PDFFont): (s: string) => string {
  const ok = new Set(font.getCharacterSet());
  return (s: string) => {
    let out = '';
    for (const ch of s.normalize('NFC')) {
      const cp = ch.codePointAt(0)!;
      if (ch === '\n' || ok.has(cp)) out += ch;
      else if (REPLACE[ch] !== undefined && [...REPLACE[ch]].every((c) => ok.has(c.codePointAt(0)!)))
        out += REPLACE[ch];
      else if (cp === 9) out += ' ';
      else {
        const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
        out += base && [...base].every((c) => ok.has(c.codePointAt(0)!)) ? base : '?';
      }
    }
    return out;
  };
}

interface Block extends FlowBlock {
  /** Title drawn above the block when it continues a group on a new page. */
  contTitle?: string;
  draw: (page: PDFPage, top: number) => Promise<void>;
}

const yOf = (top: number) => PAGE_H - CONTENT_TOP - top;

export async function renderReportPdf(
  model: ReportModel,
  opts: RenderOptions,
): Promise<{ bytes: Uint8Array; pages: number }> {
  const doc = await PDFDocument.create();
  const now = opts.now ?? new Date();
  const docTitle = `${model.title}${model.label ? ` ${model.label}` : ''} - ${model.projectName}`;
  doc.setTitle(docTitle, { showInWindowTitleBar: true });
  doc.setAuthor(model.firm);
  doc.setCreator('a2b TAB App');
  doc.setProducer('a2b TAB App (pdf-lib)');
  doc.setSubject(`${model.title} for ${model.projectName}`);
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const clean = sanitizer(regular);

  const text = (page: PDFPage, s: string, x: number, y: number, size: number, font = regular, color = INK) =>
    page.drawText(clean(s), { x, y, size, font, color });
  const width = (s: string, size: number, font = regular) => font.widthOfTextAtSize(clean(s), size);
  const wrap = (s: string, size: number, maxW: number, font = regular, maxLines = Infinity) =>
    wrapText(clean(s), (t) => font.widthOfTextAtSize(t, size), maxW, maxLines);
  /** Fit a single line into maxW (ellipsis). */
  const fitLine = (s: string, size: number, maxW: number, font = regular) =>
    wrap(s.replace(/\s+/g, ' '), size, maxW, font, 1)[0] ?? '';

  // ------------------------------------------------------------------ title block (page 1)
  const titleLines: { s: string; size: number; font: PDFFont; color: typeof INK; gap: number }[] = [
    { s: model.firm, size: 11, font: bold, color: BRAND, gap: 31 },
    { s: model.title, size: 20, font: bold, color: INK, gap: 22 },
    { s: model.projectName, size: 13, font: bold, color: INK, gap: 16 },
  ];
  if (model.address) titleLines.push({ s: model.address, size: 10, font: regular, color: INK, gap: 14 });
  titleLines.push({
    s: `Report date: ${model.reportDate}${model.label ? ` · Report: ${model.label}` : ''}`,
    size: 10,
    font: regular,
    color: INK,
    gap: 16,
  });
  for (const s of model.summary) titleLines.push({ s, size: 9.5, font: regular, color: MUTED, gap: 13 });
  const titleH = titleLines.reduce((m, l) => m + l.gap, 0) + 14;
  const drawTitle = (page: PDFPage) => {
    let y = yOf(0) - 12;
    for (const [i, l] of titleLines.entries()) {
      text(page, fitLine(l.s, l.size, CONTENT_W, l.font), MARGIN_X, y, l.size, l.font, l.color);
      if (i === 0)
        page.drawLine({
          start: { x: MARGIN_X, y: y - 7 },
          end: { x: PAGE_W - MARGIN_X, y: y - 7 },
          thickness: 1.2,
          color: BRAND,
        });
      y -= l.gap;
    }
    page.drawLine({
      start: { x: MARGIN_X, y: yOf(titleH) + 6 },
      end: { x: PAGE_W - MARGIN_X, y: yOf(titleH) + 6 },
      thickness: 0.6,
      color: RULE,
    });
  };

  // ------------------------------------------------------------------ blocks
  const cell = cellBox(model.perPage);
  const { cols } = gridOf(model.perPage);
  const totalPhotos =
    model.photoGroups.reduce((m, g) => m + g.photos.length, 0) +
    model.issueSections.reduce((m, s) => m + s.issues.reduce((k, i) => k + i.photos.length, 0), 0);
  let photosDone = 0;
  const edge = embedEdgePx(cell.imgW, cell.imgH);

  const drawHeading = (page: PDFPage, top: number, title: string, sub: string, size = 12) => {
    const y = yOf(top) - size - 2;
    const t = fitLine(title, size, CONTENT_W * 0.55, bold);
    text(page, t, MARGIN_X, y, size, bold);
    if (sub) {
      const x = MARGIN_X + width(t, size, bold) + 10;
      text(page, fitLine(sub, 9.5, PAGE_W - MARGIN_X - x, regular), x, y, 9.5, regular, MUTED);
    }
    page.drawLine({
      start: { x: MARGIN_X, y: y - 6 },
      end: { x: PAGE_W - MARGIN_X, y: y - 6 },
      thickness: 0.6,
      color: RULE,
    });
  };

  const drawPhotoCell = async (page: PDFPage, x: number, topY: number, p: ReportPhoto) => {
    const img = await opts.loadImage(p.id, edge).catch(() => null);
    let drawn = false;
    if (img) {
      try {
        const embedded = img.type === 'png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
        const f = fitContain(embedded.width, embedded.height, cell.imgW, cell.imgH);
        // centred horizontally, standing on the label (so the label is right under every photo of a row)
        page.drawImage(embedded, { x: x + f.dx, y: topY - cell.imgH, width: f.w, height: f.h });
        drawn = true;
      } catch {
        drawn = false;
      }
    }
    if (!drawn) {
      page.drawRectangle({ x, y: topY - cell.imgH, width: cell.imgW, height: cell.imgH, color: BAND });
      text(page, 'Image not available', x + 10, topY - cell.imgH / 2, 9, italic, MUTED);
    }
    let y = topY - cell.imgH - 4 - LABEL_SIZE;
    text(page, fitLine(p.label, LABEL_SIZE, cell.w, bold), x, y, LABEL_SIZE, bold);
    for (const line of p.caption ? wrap(p.caption, CAPTION_SIZE, cell.w, regular, CAPTION_LINES) : []) {
      y -= CAPTION_SIZE + LINE_GAP;
      text(page, line, x, y, CAPTION_SIZE, regular, MUTED);
    }
    photosDone++;
    opts.onProgress?.(photosDone, totalPhotos);
    // let the UI breathe between photos (and let the previous image's memory go)
    await new Promise((r) => setTimeout(r, 0));
  };

  const photoRows = (list: ReportPhoto[], contTitle: string): Block[] =>
    chunk(list, cols).map((row) => ({
      height: cell.h,
      continuationH: GROUP_HEAD_H + ROW_GAP,
      contTitle,
      draw: async (page, top) => {
        for (const [k, p] of row.entries()) await drawPhotoCell(page, MARGIN_X + k * (cell.w + COL_GAP), yOf(top), p);
      },
    }));

  const ISSUE_TEXT = 10;
  const ISSUE_LINE = ISSUE_TEXT + 3.5;
  const issueBlock = (i: IssueEntry): Block => {
    const labelW = 64;
    const textW = CONTENT_W - labelW - 8;
    const remark = wrap(i.remark || '(no remark)', ISSUE_TEXT, textW, i.remark ? regular : italic, 24);
    const comments = i.comments ? wrap(i.comments, ISSUE_TEXT, textW, regular, 16) : [];
    const bandH = 22;
    const height =
      bandH + 8 + remark.length * ISSUE_LINE + (comments.length ? 4 + comments.length * ISSUE_LINE : 0) + 4;
    return {
      height,
      keepWithNext: i.photos.length > 0,
      draw: async (page, top) => {
        const y0 = yOf(top);
        page.drawRectangle({ x: MARGIN_X, y: y0 - bandH, width: CONTENT_W, height: bandH, color: BAND });
        const title = `Issue ${i.label}`;
        text(page, title, MARGIN_X + 8, y0 - 15, 11, bold);
        const status = i.status.toUpperCase();
        const sw = width(status, 9.5, bold);
        text(page, status, PAGE_W - MARGIN_X - 8 - sw, y0 - 15, 9.5, bold, i.status === 'Open' ? RED : GREEN);
        const ex = MARGIN_X + 8 + width(title, 11, bold) + 12;
        text(page, fitLine(i.equipment, 10, PAGE_W - MARGIN_X - 20 - sw - ex), ex, y0 - 15, 10, regular, INK);
        let y = y0 - bandH - 8 - ISSUE_TEXT + 1;
        text(page, 'Remark', MARGIN_X + 8, y, 9, bold, MUTED);
        for (const line of remark) {
          text(page, line, MARGIN_X + labelW, y, ISSUE_TEXT, i.remark ? regular : italic, i.remark ? INK : MUTED);
          y -= ISSUE_LINE;
        }
        if (comments.length) {
          y -= 4;
          text(page, 'Comments', MARGIN_X + 8, y, 9, bold, MUTED);
          for (const line of comments) {
            text(page, line, MARGIN_X + labelW, y, ISSUE_TEXT, regular);
            y -= ISSUE_LINE;
          }
        }
      },
    };
  };

  const blocks: Block[] = [];
  for (const s of model.issueSections) {
    blocks.push({
      height: GROUP_HEAD_H + 4,
      keepWithNext: true,
      breakBefore: blocks.length > 0,
      draw: async (page, top) =>
        drawHeading(
          page,
          top,
          `${s.title}`,
          `${s.sheet} · ${s.issues.length} issue${s.issues.length === 1 ? '' : 's'}`,
          14,
        ),
    });
    if (!s.issues.length)
      blocks.push({
        height: 18,
        draw: async (page, top) => void text(page, 'No issues.', MARGIN_X, yOf(top) - 12, 10, italic, MUTED),
      });
    for (const i of s.issues) {
      blocks.push(issueBlock(i));
      blocks.push(...photoRows(i.photos, `Issue ${i.label} (continued)`));
    }
  }
  if (model.photoGroups.length && model.issueSections.length) {
    blocks.push({
      height: GROUP_HEAD_H + 4,
      keepWithNext: true,
      breakBefore: true,
      draw: async (page, top) => drawHeading(page, top, 'Photos', 'Equipment and general photos', 14),
    });
  }
  for (const g of model.photoGroups) {
    blocks.push({
      height: GROUP_HEAD_H,
      keepWithNext: true,
      draw: async (page, top) => drawHeading(page, top, g.title, g.subtitle.replace(`${g.title} – `, '')),
    });
    blocks.push(...photoRows(g.photos, `${g.title} (continued)`));
  }
  if (!blocks.length)
    blocks.push({
      height: 18,
      draw: async (page, top) =>
        void text(
          page,
          model.kind === 'photos' ? 'No photos.' : 'No issues.',
          MARGIN_X,
          yOf(top) - 12,
          10,
          italic,
          MUTED,
        ),
    });

  // ------------------------------------------------------------------ place and draw
  const placements = flow(blocks, titleH + 6);
  const nPages = pageCount(placements);
  const pages = Array.from({ length: nPages }, () => doc.addPage([PAGE_W, PAGE_H]));
  drawTitle(pages[0]);
  for (const [k, b] of blocks.entries()) {
    const at = placements[k];
    const page = pages[at.page];
    if (at.continued && b.contTitle) drawHeading(page, at.top - (b.continuationH ?? 0), b.contTitle, '', 11);
    await b.draw(page, at.top);
  }

  // ------------------------------------------------------------------ running header and footer
  const headRight = `${model.title}${model.label ? ` · ${model.label}` : ''}`;
  pages.forEach((page, i) => {
    const hy = PAGE_H - MARGIN_TOP - 10;
    const rw = width(headRight, 9);
    text(page, fitLine(model.projectName, 9, CONTENT_W - rw - 20, bold), MARGIN_X, hy, 9, bold, MUTED);
    text(page, headRight, PAGE_W - MARGIN_X - rw, hy, 9, regular, MUTED);
    page.drawLine({
      start: { x: MARGIN_X, y: hy - 7 },
      end: { x: PAGE_W - MARGIN_X, y: hy - 7 },
      thickness: 0.5,
      color: RULE,
    });
    const fy = MARGIN_BOTTOM + FOOTER_H - 14;
    page.drawLine({
      start: { x: MARGIN_X, y: fy + 12 },
      end: { x: PAGE_W - MARGIN_X, y: fy + 12 },
      thickness: 0.5,
      color: RULE,
    });
    text(page, model.firm, MARGIN_X, fy, 8.5, regular, MUTED);
    const pn = `Page ${i + 1} of ${nPages}`;
    text(page, pn, PAGE_W - MARGIN_X - width(pn, 8.5), fy, 8.5, regular, MUTED);
    const mid = model.reportDate;
    text(page, mid, (PAGE_W - width(mid, 8.5)) / 2, fy, 8.5, regular, MUTED);
  });

  return { bytes: await doc.save({ useObjectStreams: true }), pages: nPages };
}
