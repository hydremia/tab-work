/**
 * Printed pages of a sheet, worked out from its XML the way Excel paginates it: the print area (or the used rows),
 * hidden rows, row heights, manual row breaks, print titles and the page setup (paper, margins, scale or fit to
 * page). Used at export to drop page breaks that would print an empty page, to keep the Summary tables to the pages
 * they fill, and to write the table of contents' page numbers.
 *
 * Excel's own pagination also depends on fonts and printer metrics; this follows its rules on the template's sizes
 * (rows of fixed height, manual breaks on every unit sheet), which is what decides the page count of these sheets.
 * Columns are only read for fit-to-width.
 */
import { attr, parseDefinedNames } from './ooxml.js';

export interface Area {
  r1: number;
  r2: number;
  c1: number;
  c2: number;
}

export interface SheetLayout {
  /** height in points of every row of the area (0 when hidden) */
  height: (row: number) => number;
  hidden: (row: number) => boolean;
  /** manual row breaks: a new page starts after row `id` */
  breaks: number[];
  /** printable page size in points (paper less margins) */
  pageW: number;
  pageH: number;
  /** 1 = 100 % (the fit-to-page scale when the sheet fits to pages) */
  scale: number;
  /** fit to page: pages tall (0 = as many as needed), wide */
  fit: { tall: number; wide: number } | null;
  colWidth: (col: number) => number;
}

const PAPER: Record<string, [number, number]> = {
  '1': [612, 792], // letter
  '5': [612, 1008], // legal
  '9': [595.3, 841.9], // A4
  '3': [792, 1224], // tabloid
};

/** Column width (characters, Calibri 11) in points: Excel's pixel width (7 px a digit + 5 px padding) at 96 dpi. */
const charsToPt = (w: number) => (Math.trunc(((256 * w + Math.trunc(128 / 7)) / 256) * 7) * 3) / 4;

export function sheetLayout(xml: string): SheetLayout {
  const fmt = /<sheetFormatPr\b[^>]*>/.exec(xml)?.[0] ?? '';
  const defaultHt = Number(attr(fmt, 'defaultRowHeight') ?? 15);
  const defaultCol = Number(attr(fmt, 'defaultColWidth') ?? Number(attr(fmt, 'baseColWidth') ?? 8) + 0.71);
  const rows = new Map<number, { ht: number; hidden: boolean }>();
  for (const m of xml.matchAll(/<row\b([^>]*?)\/?>/g)) {
    const r = Number(attr(m[0], 'r'));
    const ht = attr(m[0], 'ht');
    rows.set(r, { ht: ht === undefined ? defaultHt : Number(ht), hidden: attr(m[0], 'hidden') === '1' });
  }
  const cols: { min: number; max: number; w: number; hidden: boolean }[] = [];
  for (const m of xml.matchAll(/<col\b[^>]*\/?>/g))
    cols.push({
      min: Number(attr(m[0], 'min')),
      max: Number(attr(m[0], 'max')),
      w: Number(attr(m[0], 'width') ?? defaultCol),
      hidden: attr(m[0], 'hidden') === '1',
    });
  const breaks = [...(/<rowBreaks\b[\s\S]*?<\/rowBreaks>/.exec(xml)?.[0] ?? '').matchAll(/<brk\b[^>]*>/g)]
    .filter((b) => attr(b[0], 'man') !== '0')
    .map((b) => Number(attr(b[0], 'id')))
    .sort((a, b) => a - b);
  const setup = /<pageSetup\b[^>]*>/.exec(xml)?.[0] ?? '';
  const margins = /<pageMargins\b[^>]*>/.exec(xml)?.[0] ?? '';
  const m = (k: string, d: number) => Number(attr(margins, k) ?? d) * 72;
  let [w, h] = PAPER[attr(setup, 'paperSize') ?? '1'] ?? PAPER['1'];
  if (attr(setup, 'orientation') === 'landscape') [w, h] = [h, w];
  const fitToPage = /<pageSetUpPr\b[^>]*\bfitToPage="(1|true)"/.test(xml);
  return {
    height: (r) => (rows.get(r)?.hidden ? 0 : (rows.get(r)?.ht ?? defaultHt)),
    hidden: (r) => rows.get(r)?.hidden ?? false,
    breaks,
    pageW: w - m('left', 0.7) - m('right', 0.7),
    pageH: h - m('top', 0.75) - m('bottom', 0.75),
    scale: Number(attr(setup, 'scale') ?? 100) / 100,
    fit: fitToPage
      ? { tall: Number(attr(setup, 'fitToHeight') ?? 1), wide: Number(attr(setup, 'fitToWidth') ?? 1) }
      : null,
    colWidth: (c) => {
      const d = cols.find((x) => c >= x.min && c <= x.max);
      return d?.hidden ? 0 : charsToPt(d ? d.w : defaultCol);
    },
  };
}

/** A1-style area "$A$1:$N$419" (the sheet name already removed). */
export function parseArea(ref: string): Area | null {
  const m = /\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/.exec(ref);
  if (!m) return null;
  const col = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  return { c1: col(m[1]), r1: Number(m[2]), c2: col(m[3]), r2: Number(m[4]) };
}

/** The sheet's print area and title rows from the workbook's defined names (localSheetId = the sheet's index). */
export function printSettings(wbXml: string, index: number): { area: Area | null; titles: [number, number] | null } {
  const names = parseDefinedNames(wbXml).filter((n) => n.localSheetId === index);
  const area = names.find((n) => n.name === '_xlnm.Print_Area');
  const titles = names.find((n) => n.name === '_xlnm.Print_Titles');
  const t = titles ? /\$(\d+):\$(\d+)/.exec(titles.ref) : null;
  return {
    area: area ? parseArea(area.ref.split(',')[0].replace(/^.*!/, '')) : null,
    titles: t ? [Number(t[1]), Number(t[2])] : null,
  };
}

/** Rows used by the sheet (no print area): first to last row holding a cell. */
export function usedArea(xml: string): Area | null {
  const refs = [...xml.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"/g)];
  if (!refs.length) return null;
  const rows = refs.map((m) => Number(m[2]));
  return { r1: Math.min(...rows), r2: Math.max(...rows), c1: 1, c2: 14 };
}

/** The printed pages, each as the [first, last] visible row on it. An area with no visible row prints nothing. */
export function paginate(layout: SheetLayout, area: Area, titles: [number, number] | null = null): [number, number][] {
  const visible: number[] = [];
  for (let r = area.r1; r <= area.r2; r++) if (!layout.hidden(r) && layout.height(r) > 0) visible.push(r);
  if (!visible.length) return [];
  let scale = layout.scale;
  if (layout.fit) {
    let width = 0;
    for (let c = area.c1; c <= area.c2; c++) width += layout.colWidth(c);
    const tall = visible.reduce((s, r) => s + layout.height(r), 0);
    const sW = layout.fit.wide > 0 && width > 0 ? (layout.pageW * layout.fit.wide) / width : Infinity;
    const sH = layout.fit.tall > 0 && tall > 0 ? (layout.pageH * layout.fit.tall) / tall : Infinity;
    if (layout.fit.tall === 1 && layout.fit.wide >= 1) return [[visible[0], visible[visible.length - 1]]];
    // Excel's own fit scale depends on printer metrics: count with the larger of this estimate and the scale the
    // sheet was saved with, so a page never holds more rows here than in Excel (the export then fixes these page
    // ends with manual breaks, which Excel follows)
    scale = Math.min(1, Math.max(0.1, Math.min(sW, sH), layout.scale));
  }
  const avail = layout.pageH / scale;
  const titleH =
    titles && titles[0] >= area.r1
      ? Array.from({ length: titles[1] - titles[0] + 1 }, (_, i) => layout.height(titles[0] + i)).reduce(
          (a, b) => a + b,
          0,
        )
      : 0;
  const manual = new Set(layout.breaks);
  const pages: [number, number][] = [];
  let first = -1;
  let last = -1;
  let used = 0;
  const close = () => {
    if (first >= 0) pages.push([first, last]);
    first = -1;
    used = titleH;
  };
  used = 0;
  let prev = area.r1 - 1;
  for (const r of visible) {
    // a manual break between the previous visible row and this one
    for (let b = prev; b < r; b++)
      if (manual.has(b) && first >= 0) {
        close();
        break;
      }
    const h = layout.height(r);
    if (first >= 0 && used + h > avail + 0.01) close();
    if (first < 0) first = r;
    last = r;
    used += h;
    prev = r;
  }
  close();
  return pages;
}

/** Manual breaks whose page would hold no visible row (Excel prints such a page with only the title rows). */
export function emptyPageBreaks(layout: SheetLayout, area: Area): number[] {
  const inArea = layout.breaks.filter((b) => b >= area.r1 && b < area.r2);
  const out: number[] = [];
  inArea.forEach((b, i) => {
    const end = Math.min(area.r2, inArea[i + 1] ?? area.r2);
    let any = false;
    for (let r = b + 1; r <= end && !any; r++) any = !layout.hidden(r) && layout.height(r) > 0;
    if (!any) out.push(b);
  });
  return out;
}

/** Add manual row breaks (a new page after each row id) to the sheet XML. */
export function addRowBreaks(xml: string, ids: readonly number[]): string {
  if (!ids.length) return xml;
  const existing = [...(/<rowBreaks\b[\s\S]*?<\/rowBreaks>/.exec(xml)?.[0] ?? '').matchAll(/<brk\b[^>]*\/>/g)].map(
    (b) => b[0],
  );
  const have = new Set(existing.map((b) => Number(attr(b, 'id'))));
  const all = [
    ...existing,
    ...ids.filter((id) => !have.has(id)).map((id) => `<brk id="${id}" max="16383" man="1"/>`),
  ].sort((a, b) => Number(attr(a, 'id')) - Number(attr(b, 'id')));
  const block = `<rowBreaks count="${all.length}" manualBreakCount="${all.filter((b) => attr(b, 'man') !== '0').length}">${all.join('')}</rowBreaks>`;
  if (/<rowBreaks\b/.test(xml)) return xml.replace(/<rowBreaks\b[\s\S]*?<\/rowBreaks>/, block);
  // schema order: rowBreaks follows headerFooter (and comes before colBreaks / drawing / legacyDrawing …)
  const after = /<\/headerFooter>|<headerFooter\b[^>]*\/>/.exec(xml);
  if (after) return xml.slice(0, after.index + after[0].length) + block + xml.slice(after.index + after[0].length);
  const before =
    /<(colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/.exec(
      xml,
    );
  return before
    ? xml.slice(0, before.index) + block + xml.slice(before.index)
    : xml.replace('</worksheet>', `${block}</worksheet>`);
}

/** Remove the given manual row breaks from the sheet XML (the count attributes follow). */
export function removeRowBreaks(xml: string, ids: readonly number[]): string {
  if (!ids.length) return xml;
  const drop = new Set(ids);
  return xml.replace(/<rowBreaks\b([^>]*)>([\s\S]*?)<\/rowBreaks>/, (_m, _a: string, inner: string) => {
    const kept = [...inner.matchAll(/<brk\b[^>]*\/>/g)]
      .map((b) => b[0])
      .filter((b) => !drop.has(Number(attr(b, 'id'))));
    if (!kept.length) return '';
    const manual = kept.filter((b) => attr(b, 'man') !== '0').length;
    return `<rowBreaks count="${kept.length}" manualBreakCount="${manual}">${kept.join('')}</rowBreaks>`;
  });
}
