/**
 * The printed report's page layout, settled at export after the unused blocks are hidden and the print areas fitted
 * (what TABReport's Print Report and SyncToCPageCounts would do, and what they missed):
 *
 *   1. a ruled table longer than its first page (the Summary deficiencies) keeps its empty rows only on that page;
 *   2. Summary - (E) is hidden when the project has no existing equipment and nothing to list on it;
 *   3. a manual page break whose page holds no visible row is removed: Excel prints such a page with only the title
 *      rows (every unit's empty continuation page did, in the CAP report);
 *   4. every printed sheet is centred horizontally on the paper (the cover, fitted to one page, sat left);
 *   5. the table of contents gets each entry's first page ("page n"), counted over the printed sheets in tab order
 *      (sheets named "{…}" and hidden sheets don't print); an entry whose sheets print nothing is hidden.
 */
import type JSZip from 'jszip';
import { setRowsHidden, setSheetHidden } from './hideBlocks.js';
import { attr, readText, xmlEscape } from './ooxml.js';
import {
  addRowBreaks,
  emptyPageBreaks,
  paginate,
  printSettings,
  removeRowBreaks,
  sheetLayout,
  usedArea,
  type Area,
} from './pagination.js';
import { tableRows, type TemplateMap } from './templateMap.js';
import type { ProjectData } from './types.js';

type Sheet = { name: string; part: string; index: number };

export interface LayoutReport {
  /** printed pages per sheet, in tab order */
  pages: { sheet: string; pages: number }[];
  breaksRemoved: number;
  /** ToC entries written: label prefix -> first page (null: hidden) */
  toc: { label: string; page: number | null }[];
}

const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const isHidden = (wbXml: string, index: number) =>
  /\bstate="(hidden|veryHidden)"/.test([...wbXml.matchAll(/<sheet\b[^>]*\/?>/g)][index]?.[0] ?? '');
const printable = (name: string) => !name.startsWith('{');

export async function layoutReport(
  zip: JSZip,
  sheets: readonly Sheet[],
  wbXml: string,
  map: TemplateMap,
  project: ProjectData,
  sst: readonly string[] = [],
  appended: readonly string[] = [],
): Promise<{ xml: string; report: LayoutReport }> {
  let wb = wbXml;
  const report: LayoutReport = { pages: [], breaksRemoved: 0, toc: [] };
  const areaOf = (s: Sheet, xml: string): Area | null => printSettings(wb, s.index).area ?? usedArea(xml);

  // 1. ruled tables: empty rows only on the first page
  for (const sec of map.sections)
    for (const t of sec.tables ?? []) {
      if (!t.fillFirstPage) continue;
      const s = sheets.find((x) => x.name === sec.sheet);
      if (!s) continue;
      const rows = tableRows(t).map((r) => r.row);
      const from = Math.min(...rows);
      const to = Math.max(...rows);
      let xml = await readText(zip, s.part);
      xml = setRowsHidden(xml, from, to, new Set()); // a re-export starts from every row shown
      const area = areaOf(s, xml);
      if (!area) continue;
      const pages = paginate(sheetLayout(xml), area, printSettings(wb, s.index).titles);
      const firstPageEnd = pages[0]?.[1] ?? to;
      const data = project.sections[sec.key]?.tables?.[t.key] ?? [];
      const lastUsed = data.reduce((m, r, i) => (Object.values(r).some((v) => !blank(v)) ? i : m), -1);
      const keep = Math.max(firstPageEnd, lastUsed >= 0 ? rows[lastUsed] : from);
      const hide = new Set(rows.filter((r) => r > keep));
      zip.file(s.part, setRowsHidden(xml, from, to, hide));
    }

  // 2. Summary - (E) only when there is existing equipment or something on it
  const existingSec = map.sections.find((x) => x.key === 'issuesExisting');
  const existingSheet = existingSec && sheets.find((x) => x.name === existingSec.sheet);
  if (existingSec && existingSheet) {
    const anyRows = Object.values(project.sections[existingSec.key]?.tables ?? {}).some((rows) =>
      rows.some((r) => Object.values(r).some((v) => !blank(v))),
    );
    const anyExisting = Object.values(project.equipment).some((units) => units.some((u) => u.existing));
    wb = setSheetHidden(wb, existingSheet.index, !anyRows && !anyExisting);
  }

  // 3. page breaks that would print an empty page; 4. pages per printed sheet
  const pagesOf = new Map<string, number>();
  for (const s of sheets) {
    if (!printable(s.name) || isHidden(wb, s.index)) {
      pagesOf.set(s.name, 0);
      continue;
    }
    let xml = await readText(zip, s.part);
    // every printed page centred across the paper (a sheet fitted to one page tall prints narrower than the margins
    // and, left-aligned, sat off-centre: the cover)
    const centred = centreHorizontally(xml);
    if (centred !== xml) {
      xml = centred;
      zip.file(s.part, xml);
    }
    const area = areaOf(s, xml);
    if (!area) {
      pagesOf.set(s.name, 0);
      continue;
    }
    const owned = map.toc?.exportPaged.includes(s.name) ?? false;
    if (owned) xml = removeRowBreaks(xml, sheetLayout(xml).breaks); // set again below, from this export's rows
    const empty = emptyPageBreaks(sheetLayout(xml), area);
    if (empty.length) {
      xml = removeRowBreaks(xml, empty);
      zip.file(s.part, xml);
      report.breaksRemoved += empty.length;
    }
    const layout = sheetLayout(xml);
    const pages = paginate(layout, area, printSettings(wb, s.index).titles);
    // a sheet whose breaks the export sets: the page ends counted here become manual breaks, so Excel prints the
    // pages counted here (its own fit-to-width scale can differ a little)
    if (owned) {
      xml = addRowBreaks(
        xml,
        pages.slice(0, -1).map((p) => p[1]),
      );
      zip.file(s.part, xml);
    }
    pagesOf.set(s.name, pages.length);
  }
  for (const s of sheets) if (pagesOf.get(s.name)) report.pages.push({ sheet: s.name, pages: pagesOf.get(s.name)! });

  // ToC
  const toc = map.toc;
  const tocSheet = toc && sheets.find((x) => x.name === toc.sheet);
  if (toc && tocSheet && pagesOf.get(toc.sheet)) {
    const firstPage = new Map<string, number>();
    let n = 1;
    for (const s of sheets) {
      const p = pagesOf.get(s.name) ?? 0;
      if (p) firstPage.set(s.name, n);
      n += p;
    }
    let xml = await readText(zip, tocSheet.part);
    const hide = new Set<number>();
    const rows = toc.entries.map((e) => e.row);
    for (const e of toc.entries) {
      const label = cellText(xml, `${toc.labelCol}${e.row}`, sst);
      // a ToC laid out differently (or relabelled by hand) is left as it is
      if (label === null || !label.toLowerCase().startsWith(e.label.toLowerCase())) continue;
      const starts = e.sheets.map((sh) => firstPage.get(sh)).filter((p): p is number => p !== undefined);
      // a section the final report appends (the photo report) starts after the last printed page
      const page = starts.length ? Math.min(...starts) : e.appended && appended.includes(e.appended) ? n : null;
      report.toc.push({ label: e.label, page });
      if (page === null) for (let k = 0; k < toc.rowsPerEntry; k++) hide.add(e.row + k);
      else xml = setCellText(xml, `${toc.pageCol}${e.row}`, `page ${page}`);
    }
    xml = setRowsHidden(xml, Math.min(...rows), Math.max(...rows) + toc.rowsPerEntry - 1, hide);
    zip.file(tocSheet.part, xml);
  }
  return { xml: wb, report };
}

/** Text of a cell: inline, shared (an Excel-saved workbook) or a plain value. */
function cellText(xml: string, ref: string, sst: readonly string[]): string | null {
  const m = new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`).exec(xml);
  if (!m) return null;
  const body = m[1] ?? '';
  const t = [...body.matchAll(/<t\b[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]).join('');
  if (t) return t;
  const v = /<v>([^<]*)<\/v>/.exec(body)?.[1] ?? '';
  return /\bt="s"/.test(m[0]) ? (sst[Number(v)] ?? '') : v;
}

/** Write inline text into an existing cell, keeping its style. */
function setCellText(xml: string, ref: string, text: string): string {
  const re = new RegExp(`<c\\b([^>]*\\br="${ref}"[^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const m = re.exec(xml);
  if (!m) return xml;
  const attrs = m[1].replace(/\s+t="[^"]*"/, '');
  const s = attr(`<c${attrs}>`, 's');
  return xml.replace(re, `<c r="${ref}"${s ? ` s="${s}"` : ''} t="inlineStr"><is><t>${xmlEscape(text)}</t></is></c>`);
}

/** printOptions horizontalCentered="1" (added before pageMargins, its place in the schema, when missing). */
export function centreHorizontally(xml: string): string {
  const po = /<printOptions\b[^>]*?(\/?)>/.exec(xml);
  if (po) {
    if (/\bhorizontalCentered="(1|true)"/.test(po[0])) return xml;
    const tag = po[0]
      .replace(/\s+horizontalCentered="[^"]*"/, '')
      .replace(/^<printOptions/, '<printOptions horizontalCentered="1"');
    return xml.replace(po[0], tag);
  }
  const at = /<pageMargins\b/.exec(xml) ?? /<pageSetup\b/.exec(xml);
  if (!at) return xml;
  return `${xml.slice(0, at.index)}<printOptions horizontalCentered="1"/>${xml.slice(at.index)}`;
}
