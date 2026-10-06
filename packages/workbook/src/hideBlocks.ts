/**
 * Hide unused blocks at export: what TABReport's HideUnusedBlocks macro does in Excel, written into the workbook by
 * the export so the report prints clean without the macro (and in LibreOffice). Decided from the project data (which
 * slots are used, which inputs were written), never from formula results, which the export cannot calculate:
 *
 *   - a unit sheet with no units of its type is hidden (sheet state), and shown again once it has one;
 *   - RTUs / MAUs / ERVs / Fans: unused blocks hidden; a continuation page hidden when the unit wrote nothing there
 *     (the macro's test, any typed text on the page, always held: the template's own labels count); everything after
 *     the last used unit hidden;
 *   - VAVs / Small Fans: unused blocks hidden;
 *   - Hoods (two a page) and Traverses (three a page): unused blocks hidden, the page's shared remark box kept while
 *     a unit on the page is used;
 *   - inside the used blocks, empty table rows (between a "No." header and its Total / Subtotal / Remarks) hidden;
 *     a table with no line at all keeps its first (empty) row;
 *   - Equipment Summary: the lines of unused units hidden, and a type's heading when none of its lines is left;
 *   - Building Balance rows 7-86: a line hidden when neither side names a used unit (or a typed spare OA row).
 *
 * Every row of a managed range is set (hidden or shown), so a re-export onto an issued workbook shows again what was
 * hidden before. ShowAllBlocks (the macro) or Excel's Unhide shows everything.
 */
import type JSZip from 'jszip';
import { cellValue, colToNum, parseCells, type RawCell, readText, splitRef } from './ooxml.js';
import {
  anchorRow,
  blockLayout,
  sequenceCells,
  tableRows,
  type EquipmentDef,
  type Layout,
  type TemplateMap,
} from './templateMap.js';
import type { LayoutData, ProjectData } from './types.js';

type Sheet = { name: string; part: string; index: number };

const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** Rows (relative to the block anchor) that hold a written value of the unit's block. */
function writtenRows(layout: Layout, data: LayoutData): Set<number> {
  const rows = new Set<number>();
  for (const fd of layout.fields ?? []) if (!blank(data.fields?.[fd.key])) rows.add(fd.row);
  for (const td of layout.tables ?? []) {
    const slots = tableRows(td);
    (data.tables?.[td.key] ?? []).forEach((r, i) => {
      if (slots[i] && Object.values(r).some((v) => !blank(v))) rows.add(slots[i].row);
    });
  }
  for (const ld of layout.lines ?? [])
    (data.lines?.[ld.key] ?? []).forEach((l, i) => {
      if (!blank(l) && ld.cells[i]) rows.add(ld.cells[i].row);
    });
  for (const sd of layout.sequences ?? []) {
    const cells = sequenceCells(sd);
    (data.sequences?.[sd.key] ?? []).forEach((v, i) => {
      if (!blank(v) && cells[i]) rows.add(cells[i].row);
    });
  }
  for (const cd of layout.columnTables ?? [])
    for (const item of data.columnTables?.[cd.key] ?? [])
      for (const fd of cd.fields) if (!blank(item[fd.key])) rows.add(fd.row);
  return rows;
}

/** Rows of empty table lines in [from, to]: between a "No." header and its Total / Subtotal / Remarks. */
function emptyTableRows(cells: Map<string, RawCell>, sst: string[], from: number, to: number): number[] {
  const byRow = new Map<number, RawCell[]>();
  for (const c of cells.values()) {
    const { row } = splitRef(c.ref);
    if (row < from || row > to) continue;
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row)!.push(c);
  }
  const text = (row: number, col: string) => {
    const v = cellValue(cells.get(`${col}${row}`), sst);
    return v === null || typeof v === 'boolean' ? '' : String(v).trim();
  };
  const out: number[] = [];
  let table: { empty: number[]; any: boolean } | null = null;
  // an all-empty table keeps its first row (the table stays visible); otherwise every empty row goes
  const close = () => {
    if (table) out.push(...(table.any ? table.empty : table.empty.slice(1)));
    table = null;
  };
  for (let r = from; r <= to; r++) {
    if (text(r, 'B') === 'No.') {
      close();
      table = { empty: [], any: false };
      continue;
    }
    if (/^(Total|Subtotal)/.test(text(r, 'C')) || /^Remarks/.test(text(r, 'B'))) {
      close();
      continue;
    }
    if (!table) continue;
    // a line is empty when none of its typed cells (B:M, formulas aside) holds a value
    const typed = (byRow.get(r) ?? []).filter((c) => {
      const n = colToNum(c.col);
      return n >= 2 && n <= 13 && c.formula === undefined && !blank(cellValue(c, sst));
    });
    if (typed.length) (table as { any: boolean }).any = true;
    else (table as { empty: number[] }).empty.push(r);
  }
  close();
  return out;
}

/** Set `hidden` on every row of [from, to] (rows missing from sheetData are added when they must be hidden). */
export function setRowsHidden(xml: string, from: number, to: number, hide: ReadonlySet<number>): string {
  const sd = /<sheetData>([\s\S]*?)<\/sheetData>|<sheetData\s*\/>/.exec(xml);
  if (!sd) return xml;
  const inner = sd[1] ?? '';
  const seen = new Set<number>();
  let body = inner.replace(/<row\b([^>]*?)(\/?)>/g, (m, attrs: string, selfClose: string) => {
    const r = Number(/\br="(\d+)"/.exec(attrs)?.[1]);
    if (!(r >= from && r <= to)) return m;
    seen.add(r);
    const a = attrs.replace(/\s+hidden="[^"]*"/, '');
    return `<row${a}${hide.has(r) ? ' hidden="1"' : ''}${selfClose}>`;
  });
  const missing = [...hide].filter((r) => r >= from && r <= to && !seen.has(r)).sort((a, b) => a - b);
  if (missing.length) {
    // insert each missing row before the first row after it (sheetData keeps rows in order)
    for (const r of missing) {
      const next = [...body.matchAll(/<row\b[^>]*?\br="(\d+)"/g)].find((m) => Number(m[1]) > r);
      const tag = `<row r="${r}" hidden="1"/>`;
      body = next ? body.slice(0, next.index) + tag + body.slice(next.index) : body + tag;
    }
  }
  return xml.replace(sd[0], `<sheetData>${body}</sheetData>`);
}

const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

/** The block's rows: a linear block spans its stride; a paged block runs to the next block on its page. */
function blockRows(def: EquipmentDef, n: number): { start: number; end: number; pageStart: number; pageEnd: number } {
  const a = def.block.anchor;
  const start = anchorRow(a, n);
  if (a.kind === 'linear') return { start, end: start + a.stride - 1, pageStart: start, pageEnd: start + a.stride - 1 };
  const per = a.offsets.length;
  const pos = (n - 1) % per;
  const pageStart = start - a.offsets[pos];
  // blocks on a page are evenly spaced; the last one ends where the next would start (the page's remark box follows)
  const size = per > 1 ? a.offsets[1] - a.offsets[0] : a.pageRows;
  return { start, end: start + size - 1, pageStart, pageEnd: pageStart + a.pageRows - 1 };
}

export interface HideReport {
  /** Sheets hidden (no units) and sheets shown again. */
  hiddenSheets: string[];
  rowsHidden: number;
}

export async function hideUnusedBlocks(
  zip: JSZip,
  sheets: readonly Sheet[],
  wbXml: string,
  map: TemplateMap,
  project: ProjectData,
  sst: string[],
): Promise<{ xml: string; report: HideReport }> {
  const report: HideReport = { hiddenSheets: [], rowsHidden: 0 };
  let wb = wbXml;
  const write = async (sheet: Sheet, from: number, to: number, hide: Set<number>) => {
    const xml = await readText(zip, sheet.part);
    zip.file(sheet.part, setRowsHidden(xml, from, to, hide));
    report.rowsHidden += hide.size;
  };
  const used = new Map<string, Map<number, (typeof project.equipment)[string][number]>>();
  for (const [type, units] of Object.entries(project.equipment)) used.set(type, new Map(units.map((u) => [u.slot, u])));

  // ---- the unit sheets
  const bySheet = new Map<string, EquipmentDef[]>();
  for (const def of map.equipment) bySheet.set(def.block.sheet, [...(bySheet.get(def.block.sheet) ?? []), def]);
  for (const [name, defs] of bySheet) {
    const sheet = sheets.find((s) => s.name === name);
    if (!sheet || defs.length !== 1) continue;
    const def = defs[0];
    const units = used.get(def.key) ?? new Map();
    wb = setSheetHidden(wb, sheet.index, units.size === 0);
    if (units.size === 0) {
      report.hiddenSheets.push(name);
      continue;
    }
    const cells = parseCells(await readText(zip, sheet.part));
    const last = Math.max(...units.keys());
    const first = blockRows(def, 1);
    const end = blockRows(def, def.capacity).pageEnd;
    const hide = new Set<number>();
    const twoPage = def.block.anchor.kind === 'linear' && def.block.anchor.stride === 104;
    for (let n = 1; n <= def.capacity; n++) {
      const b = blockRows(def, n);
      const u = units.get(n);
      if (n > last && def.block.anchor.kind === 'linear') {
        range(b.start, b.end).forEach((r) => hide.add(r));
        continue;
      }
      if (!u) {
        range(b.start, b.end).forEach((r) => hide.add(r));
        continue;
      }
      if (twoPage) {
        const rows = writtenRows(blockLayout(def, n), u);
        const page2 = [...rows].some((r) => r >= 52);
        emptyTableRows(cells, sst, b.start, b.start + 51).forEach((r) => hide.add(r));
        if (page2) emptyTableRows(cells, sst, b.start + 52, b.end).forEach((r) => hide.add(r));
        else range(b.start + 52, b.end).forEach((r) => hide.add(r));
      } else emptyTableRows(cells, sst, b.start, b.end).forEach((r) => hide.add(r));
    }
    // paged sheets (hoods, traverses): a page with no used unit goes whole (its remark box too)
    if (def.block.anchor.kind === 'paged') {
      const per = def.block.anchor.offsets.length;
      for (let p = 0; p * per < def.capacity; p++) {
        const slots = range(p * per + 1, Math.min(def.capacity, (p + 1) * per));
        if (slots.some((n) => units.has(n))) continue;
        const b = blockRows(def, slots[0]);
        range(b.pageStart, b.pageEnd).forEach((r) => hide.add(r));
      }
    }
    await write(sheet, first.start, end, hide);
  }

  // ---- Equipment Summary and Building Balance: lines naming units (by their formulas' first reference)
  const unitAt = new Map<string, boolean>(); // "<sheet>!<row>" of a unit anchor or a data-entry row -> used
  for (const def of map.equipment) {
    for (let n = 1; n <= def.capacity; n++) {
      const isUsed = used.get(def.key)?.has(n) ?? false;
      unitAt.set(`${def.block.sheet}!${anchorRow(def.block.anchor, n)}`, isUsed);
      if (def.ede) unitAt.set(`${def.ede.sheet}!${def.ede.firstRow + n - 1}`, isUsed);
    }
  }
  /** Does the cell name a used unit (a formula pointing at a unit), hold typed text, or neither? */
  const names = (c: RawCell | undefined): boolean => {
    if (!c) return false;
    if (c.formula === undefined) return !blank(cellValue(c, sst));
    const m = /'?([^'!(,]+)'?!\$?[A-Z]+\$?(\d+)/.exec(c.formula.replace(/&apos;/g, "'"));
    return m ? (unitAt.get(`${m[1]}!${m[2]}`) ?? true) : true;
  };
  const summary = sheets.find((s) => s.name === 'Equipment Summary');
  if (summary) {
    const cells = parseCells(await readText(zip, summary.part));
    const rows = [...new Set([...cells.values()].map((c) => splitRef(c.ref).row))].sort((a, b) => a - b);
    const last = rows.at(-1) ?? 0;
    const hide = new Set<number>();
    let heading: number | null = null;
    let headingUsed = false;
    const closeHeading = () => {
      if (heading !== null && !headingUsed) hide.add(heading);
    };
    for (let r = 9; r <= last; r++) {
      const b = cells.get(`B${r}`);
      if (b && b.formula === undefined && !blank(cellValue(b, sst))) {
        closeHeading();
        heading = r;
        headingUsed = false;
        continue;
      }
      if (names(b)) headingUsed = true;
      else hide.add(r);
    }
    closeHeading();
    await write(summary, 9, last, hide);
  }
  const balance = sheets.find((s) => s.name === 'Building Balance');
  if (balance) {
    const cells = parseCells(await readText(zip, balance.part));
    const hide = new Set<number>();
    for (let r = 7; r <= 86; r++) if (!names(cells.get(`B${r}`)) && !names(cells.get(`H${r}`))) hide.add(r);
    await write(balance, 7, 86, hide);
  }
  return { xml: wb, report };
}

/** Hide (or show again) a sheet; the workbook's active tab moves off a hidden sheet. */
function setSheetHidden(wbXml: string, index: number, hidden: boolean): string {
  let i = -1;
  let xml = wbXml.replace(/<sheet\b[^>]*?\/>/g, (tag) => {
    i++;
    if (i !== index) return tag;
    const t = tag.replace(/\s+state="[^"]*"/, '');
    return hidden ? t.replace(/<sheet\b/, '<sheet state="hidden"') : t;
  });
  if (hidden) {
    const active = /<workbookView\b[^>]*\bactiveTab="(\d+)"/.exec(xml);
    if (active && Number(active[1]) === index) xml = xml.replace(/(\bactiveTab=")\d+"/, '$10"');
  }
  return xml;
}
