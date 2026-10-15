/**
 * Final report: the report PDF Excel makes from the workbook (TABReport "Print Report"), with the app's figures
 * (reports/graphics.ts, inline mode) placed right after the pages they belong to, every page numbered "Page x of N",
 * and the table of contents' page numbers moved to match.
 *
 *   - a unit's figures (static profile, outlet charts, pump curve) follow its last page: the page of its sheet (by the
 *     page title in the print header, e.g. "Rooftop Unit Report") whose "System" box names the unit, so the
 *     continuation page comes first when it is printed;
 *   - a traverse's figures follow the Traverses page that names it (three traverses a page: their figures follow in
 *     order);
 *   - the summary follows the Building Balance (or the hydronic System Summary);
 *   - figures whose unit is not found follow the last page of their sheet, or the end of the report.
 *
 * The workbook PDF's own footer ("Page 7" or "Page 7 of 55") is covered and written again; pages without one (the
 * cover) stay unnumbered but are counted. The table of contents' numbers are found from each entry's label (the
 * section's first page in the report), not from the workbook's numbers, which can be stale. Pure planning (planReport) is separate from the PDF work so it is tested on
 * text alone.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PdfPageText } from '../domain/pdfTables';
import type { EquipmentTypeKey } from '../domain/equipmentTypes';
import type { FigureGroup } from './graphics';

/** The page title (print header) of each type's report sheet, airside rev 06 and hydronic H01. */
export const SHEET_TITLES: Partial<Record<EquipmentTypeKey, string>> = {
  rtu: 'Rooftop Unit Report',
  mau: 'Make-up Air Unit Report',
  erv: 'Energy Recovery Unit Report',
  fan: 'Fan Report',
  smallFan: 'Small Exhaust Fan Report',
  vav: 'VAV Terminal Report',
  hood: 'Hood Airflow Report',
  traverse: 'Traverse Measurement Report',
  pump: 'Pump Report',
  valveSystem: 'Balancing Valve Report',
  plant: 'Plant Equipment Report',
  flowMeasurement: 'Flow Measurement Report',
};
const SUMMARY_AFTER = ['Building Balance Report', 'Hydronic System Summary', 'Equipment Summary'];
const ALL_TITLES = [...Object.values(SHEET_TITLES), ...SUMMARY_AFTER];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PagePlan {
  src: 'report' | 'graphics';
  /** 0-based page in its source PDF */
  page: number;
}

export interface ReportPlan {
  order: PagePlan[];
  /** where each group went: after report page n (0-based), or -1 = the end */
  placed: { key: string; unit: string | null; after: number; how: 'unit' | 'sheet' | 'summary' | 'end' }[];
  /** the workbook footer's page number on each report page (absent: no footer) */
  footers: Map<number, Box & { size: number }>;
  /**
   * table of contents entries: "page 12" on report page `page`, pointing at report page `target` (0-based; -1: the
   * entry's section is not in the report, its number is removed)
   */
  toc: { page: number; box: Box; size: number; target: number; label: string }[];
  titles: (string | null)[];
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Item {
  s: string;
  x: number;
  y: number;
  w: number;
  size: number;
}

function itemsOf(p: PdfPageText): Item[] {
  return p.items
    .map((it) => {
      const [a, b, , , e, f] = it.transform;
      return { s: norm(it.str), x: e, y: f, w: it.width, size: Math.hypot(a, b) || it.height || 8 };
    })
    .filter((it) => it.s);
}

/** The page's title: a known sheet title in the top part of the page (the print header), the longest that fits. */
export function pageTitle(p: PdfPageText): string | null {
  // the table of contents' title is a cell, not the print header
  if (itemsOf(p).some((it) => it.s === 'Table of Contents' && it.y >= p.height * 0.6)) return 'Table of Contents';
  const top = norm(
    itemsOf(p)
      .filter((it) => it.y >= p.height * 0.82)
      .map((it) => it.s)
      .join(' '),
  );
  let best: string | null = null;
  for (const t of ALL_TITLES)
    if (new RegExp(`(^| )${esc(t)}( |$)`).test(top) && (!best || t.length > best.length)) best = t;
  return best;
}

/** Lines of text (items on one baseline joined) in a band of the page. */
function lines(items: readonly Item[]): { s: string; box: Box; size: number }[] {
  const rows = new Map<number, Item[]>();
  for (const it of items) {
    const k = Math.round(it.y / 2);
    rows.set(k, [...(rows.get(k) ?? []), it]);
  }
  return [...rows.values()].map((r) => {
    r.sort((a, b) => a.x - b.x);
    const x = r[0].x;
    const x2 = Math.max(...r.map((i) => i.x + i.w));
    const size = Math.max(...r.map((i) => i.size));
    return {
      s: norm(r.map((i) => i.s).join(' ')),
      box: { x, y: Math.min(...r.map((i) => i.y)), w: x2 - x, h: size },
      size,
    };
  });
}

const FOOTER = /^Page\s*\d+(\s*of\s*\d+)?$/i;

/**
 * The section a ToC entry names, by its label: the first page of the section in the report (print-header titles, or
 * the heading text for the pages without one). The workbook's own "page n" can be stale (the template's numbers, or
 * counted before pages were hidden), so the target is found, not trusted; an unknown label keeps its number.
 */
const TOC_SECTIONS: { label: RegExp; titles?: string[]; text?: RegExp }[] = [
  { label: /^table of contents/i, titles: ['Table of Contents'] },
  { label: /^report summary/i, text: /Report Summary (-|and Remarks)/ },
  { label: /equipment summary|building balance/i, titles: ['Equipment Summary', 'Building Balance Report'] },
  { label: /hydronic system summary/i, titles: ['Hydronic System Summary'] },
  { label: /^appendix a\b|certifications?$/i, text: /^Certification Information$/ },
  { label: /^appendix b\b|abbreviation/i, text: /^Abbreviation Legend$/ },
  { label: /^appendix c\b|calibration/i, text: /^Instrumentation and Calibration/ },
  { label: /floor ?plan|schematic/i }, // attached separately: never in the workbook's PDF
  { label: /site photos/i, text: /^Site Photos$/ },
  { label: /rooftop/i, titles: ['Rooftop Unit Report'] },
  { label: /make-?up air/i, titles: ['Make-up Air Unit Report'] },
  { label: /energy recovery/i, titles: ['Energy Recovery Unit Report'] },
  { label: /^fans\b|exhaust fans|vav/i, titles: ['Fan Report', 'Small Exhaust Fan Report', 'VAV Terminal Report'] },
  { label: /hood/i, titles: ['Hood Airflow Report'] },
  { label: /traverse/i, titles: ['Traverse Measurement Report'] },
  { label: /^pumps?\b/i, titles: ['Pump Report'] },
  { label: /balancing valve/i, titles: ['Balancing Valve Report'] },
  { label: /plant equipment|flow measurement/i, titles: ['Plant Equipment Report', 'Flow Measurement Report'] },
];

/** Where a ToC entry points: a page index, -1 when its section is not in the report, null for an unknown label. */
function tocTarget(label: string, pages: readonly PdfPageText[], titles: readonly (string | null)[]): number | null {
  const sec = TOC_SECTIONS.find((x) => x.label.test(label));
  if (!sec) return null;
  for (let i = 0; i < pages.length; i++) {
    if (sec.titles?.includes(titles[i] ?? '')) return i;
    if (sec.text && titles[i] !== 'Table of Contents' && itemsOf(pages[i]).some((it) => sec.text!.test(it.s))) return i;
  }
  return -1;
}
/** TABReport's SyncToCPageCounts writes "page 12" (lower case; the footer is "Page 2") */
const TOC_ENTRY = /^page\s*(\d+)$/;

/** Where a unit's figures go: the last page of its sheet whose "System" box names it (or any mention of it). */
function unitAnchor(pages: readonly PdfPageText[], titles: readonly (string | null)[], g: FigureGroup): number {
  const title = g.type ? SHEET_TITLES[g.type] : undefined;
  if (!title || !g.unit) return -1;
  const unit = norm(g.unit);
  const token = new RegExp(`(^| )${esc(unit)}( |$)`);
  let strong = -1;
  let weak = -1;
  pages.forEach((p, i) => {
    if (titles[i] !== title) return;
    const items = itemsOf(p);
    for (let k = 0; k < items.length; k++) {
      if (items[k].s === unit && k > 0 && /^System( \(cont\.\))?$/.test(items[k - 1].s)) strong = i;
      else if (/^System( \(cont\.\))? /.test(items[k].s) && items[k].s.replace(/^System( \(cont\.\))? /, '') === unit)
        strong = i;
    }
    if (token.test(norm(items.map((it) => it.s).join(' ')))) weak = i;
  });
  return strong >= 0 ? strong : weak;
}

export function planReport(pages: readonly PdfPageText[], groups: readonly FigureGroup[]): ReportPlan {
  const titles = pages.map(pageTitle);
  const lastOf = (t: string) => titles.lastIndexOf(t);
  const after = new Map<number, FigureGroup[]>();
  const atEnd: FigureGroup[] = [];
  const placed: ReportPlan['placed'] = [];
  for (const g of groups) {
    let at = -1;
    let how: ReportPlan['placed'][number]['how'] = 'end';
    if (g.key === 'summary') {
      for (const t of SUMMARY_AFTER) {
        at = lastOf(t);
        if (at >= 0) break;
      }
      how = 'summary';
    } else {
      at = unitAnchor(pages, titles, g);
      how = 'unit';
      if (at < 0 && g.type && SHEET_TITLES[g.type]) {
        at = lastOf(SHEET_TITLES[g.type]!);
        how = 'sheet';
      }
    }
    if (at < 0) {
      atEnd.push(g);
      placed.push({ key: g.key, unit: g.unit, after: -1, how: 'end' });
    } else {
      after.set(at, [...(after.get(at) ?? []), g]);
      placed.push({ key: g.key, unit: g.unit, after: at, how });
    }
  }
  const order: PagePlan[] = [];
  const push = (gs: readonly FigureGroup[]) => {
    for (const g of gs) for (let k = 0; k < g.pageCount; k++) order.push({ src: 'graphics', page: g.firstPage + k });
  };
  pages.forEach((_, i) => {
    order.push({ src: 'report', page: i });
    push(after.get(i) ?? []);
  });
  push(atEnd);

  const footers: ReportPlan['footers'] = new Map();
  const toc: ReportPlan['toc'] = [];
  pages.forEach((p, i) => {
    const items = itemsOf(p);
    const foot = lines(items.filter((it) => it.y < Math.min(72, p.height * 0.1))).find((l) => FOOTER.test(l.s));
    if (foot) footers.set(i, { ...foot.box, size: foot.size });
    if (titles[i] === 'Table of Contents')
      for (const it of items) {
        if (foot && Math.abs(it.y - foot.box.y) < 2) continue; // the footer itself ("Page 2" reads as an entry)
        const m = TOC_ENTRY.exec(it.s);
        if (!m) continue;
        const n = Number(m[1]);
        // the entry's label: the text left of the number on its line
        const label = norm(
          items
            .filter((o) => o !== it && Math.abs(o.y - it.y) < Math.max(3, it.size * 0.6) && o.x < it.x)
            .sort((a, b) => a.x - b.x)
            .map((o) => o.s)
            .join(' '),
        );
        const found = tocTarget(label, pages, titles);
        const target = found ?? (n >= 1 && n <= pages.length ? n - 1 : null);
        if (target === null) continue;
        toc.push({ page: i, box: { x: it.x, y: it.y, w: it.w, h: it.size }, size: it.size, target, label });
      }
  });
  return { order, placed, footers, toc, titles };
}

export interface AssembleResult {
  bytes: Uint8Array;
  pages: number;
  plan: ReportPlan;
}

/**
 * Builds the final report from the workbook's report PDF, the inline figures and their groups. `readText` reads the
 * report's text (workbook/pdfText.ts; passed in so this module stays free of pdf.js).
 */
export async function assembleReport(
  reportBytes: Uint8Array,
  graphics: { bytes: Uint8Array; groups: readonly FigureGroup[] },
  readText: (bytes: Uint8Array) => Promise<{ pages: PdfPageText[]; pageCount: number }>,
  meta: { title: string; author: string; now?: Date },
  /**
   * Pages appended after the report (the photo report, rendered without page numbers): numbered on with the report
   * at `number` (right-aligned), and the ToC entry matching `toc` (its label) points at their first page.
   */
  appendix?: { bytes: Uint8Array; number: { right: number; y: number; size: number }; toc: RegExp },
): Promise<AssembleResult> {
  const report = await PDFDocument.load(reportBytes, { ignoreEncryption: true });
  const { pages: text, pageCount } = await readText(reportBytes);
  if (pageCount !== report.getPageCount() || text.length !== pageCount)
    throw new Error(`Could not read every page of the report PDF (${text.length} of ${report.getPageCount()}).`);
  const plan = planReport(text, graphics.bytes.length ? graphics.groups : []);
  const fig = graphics.bytes.length ? await PDFDocument.load(graphics.bytes) : null;

  const out = await PDFDocument.create();
  const now = meta.now ?? new Date();
  out.setTitle(meta.title, { showInWindowTitleBar: true });
  out.setAuthor(meta.author);
  out.setCreator('a2b TAB App');
  out.setProducer('a2b TAB App (pdf-lib)');
  out.setCreationDate(now);
  out.setModificationDate(now);
  const font = await out.embedFont(StandardFonts.Helvetica);
  const reportPages = await out.copyPages(report, report.getPageIndices());
  const figPages = fig ? await out.copyPages(fig, fig.getPageIndices()) : [];
  const app = appendix?.bytes.length ? await PDFDocument.load(appendix.bytes) : null;
  const appPages = app ? await out.copyPages(app, app.getPageIndices()) : [];
  const total = plan.order.length + appPages.length;
  const position = new Map<number, number>(); // report page -> 1-based page in the final report
  plan.order.forEach((o, i) => o.src === 'report' && position.set(o.page, i + 1));
  const ink = rgb(0, 0, 0);
  const white = rgb(1, 1, 1);

  plan.order.forEach((o, i) => {
    const page = o.src === 'report' ? reportPages[o.page] : figPages[o.page];
    out.addPage(page);
    const label = `Page ${i + 1} of ${total}`;
    if (o.src === 'graphics') {
      const { width } = page.getSize();
      page.drawText(label, { x: width / 2 - font.widthOfTextAtSize(label, 8) / 2, y: 22, size: 8, font, color: ink });
      return;
    }
    // text positions are read upright from the page's crop box: only plain pages get their numbers rewritten
    const upright = page.getRotation().angle % 360 === 0;
    const { x: ox, y: oy } = page.getMediaBox();
    if (!upright) return;
    const foot = plan.footers.get(o.page);
    if (foot) {
      page.drawRectangle({
        x: ox + foot.x - 2,
        y: oy + foot.y - foot.size * 0.3,
        width: foot.w + 4,
        height: foot.size * 1.3,
        color: white,
      });
      const size = Math.max(6, Math.min(10, foot.size));
      const cx = ox + foot.x + foot.w / 2;
      page.drawText(label, { x: cx - font.widthOfTextAtSize(label, size) / 2, y: oy + foot.y, size, font, color: ink });
    }
    for (const t of plan.toc.filter((e) => e.page === o.page)) {
      const appended = t.target < 0 && appPages.length > 0 && appendix!.toc.test(t.label);
      const n = t.target >= 0 ? position.get(t.target) : appended ? plan.order.length + 1 : undefined;
      if (t.target >= 0 && !n) continue;
      const s = n ? `page ${n}` : '';
      const size = Math.max(6, Math.min(12, t.size));
      page.drawRectangle({
        x: ox + t.box.x - 1,
        y: oy + t.box.y - t.size * 0.3,
        width: Math.max(t.box.w, font.widthOfTextAtSize(s, size)) + 3,
        height: t.size * 1.3,
        color: white,
      });
      page.drawText(s, { x: ox + t.box.x, y: oy + t.box.y, size, font, color: ink });
    }
  });
  appPages.forEach((page, k) => {
    out.addPage(page);
    const label = `Page ${plan.order.length + k + 1} of ${total}`;
    const { right, y, size } = appendix!.number;
    page.drawText(label, {
      x: right - font.widthOfTextAtSize(label, size),
      y,
      size,
      font,
      color: rgb(0.36, 0.41, 0.48),
    });
  });
  return { bytes: await out.save(), pages: total, plan };
}
