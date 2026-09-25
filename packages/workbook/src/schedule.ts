/**
 * Schedule readers for the app's "Import schedule":
 *  - readScheduleSection(): the {Equipment Data Entry} rows of an existing TAB workbook, nothing else (no unit
 *    blocks, no project sections), keyed by the template map's EDE field keys;
 *  - readSheetRows(): the cell values of every worksheet of any .xlsx / .xlsm (an engineer's schedule), as a grid.
 */
import { loadWorkbookZip } from './zipLimits.js';
import {
  cellValue,
  colToNum,
  dateStyleIds,
  listSheets,
  loadSharedStrings,
  parseCells,
  readText,
  serialToIso,
  splitRef,
} from './ooxml.js';
import { TEMPLATE_MAP, type TemplateMap } from './templateMap.js';
import type { Value } from './types.js';

export interface ScheduleRow {
  /** Row n of the type's EDE section (= its block number). */
  slot: number;
  values: Record<string, Value>;
}

/** Whether the file is a TAB workbook (it has the {Equipment Data Entry} sheet). */
export async function hasScheduleSection(bytes: Uint8Array, map: TemplateMap = TEMPLATE_MAP): Promise<boolean> {
  const zip = await loadWorkbookZip(bytes);
  const sheet = map.equipment.find((d) => d.ede)?.ede?.sheet;
  return (await listSheets(zip)).some((s) => s.name === sheet);
}

/**
 * The used rows of every EDE section, by equipment type. A row is used when any of its cells has a value; the
 * untouched template's sample designation (RTU-1, MUA-1 …) alone in row 1 is not a unit. Dates are not in the EDE.
 */
export async function readScheduleSection(
  bytes: Uint8Array,
  map: TemplateMap = TEMPLATE_MAP,
): Promise<Record<string, ScheduleRow[]>> {
  const zip = await loadWorkbookZip(bytes);
  const sheets = await listSheets(zip);
  const sst = await loadSharedStrings(zip);
  const out: Record<string, ScheduleRow[]> = {};
  const cache = new Map<string, ReturnType<typeof parseCells>>();
  for (const def of map.equipment) {
    if (!def.ede) continue;
    const sheetName = def.ede.sheet;
    if (!cache.has(sheetName)) {
      const info = sheets.find((s) => s.name === sheetName);
      if (!info) throw new Error(`workbook has no sheet "${sheetName}"`);
      cache.set(sheetName, parseCells(await readText(zip, info.part)));
    }
    const cells = cache.get(sheetName)!;
    const rows: ScheduleRow[] = [];
    for (let slot = 1; slot <= def.capacity; slot++) {
      const r = def.ede.firstRow + slot - 1;
      const values: Record<string, Value> = {};
      for (const fd of def.ede.fields) {
        const v = cellValue(cells.get(`${fd.col}${r}`), sst);
        if (v === null || v === '' || typeof v === 'boolean') continue;
        values[fd.key] = typeof v === 'string' ? v.trim() : fd.type === 'text' ? String(v) : v;
        if (values[fd.key] === '') delete values[fd.key];
      }
      const keys = Object.keys(values);
      if (!keys.length) continue;
      if (slot === 1 && keys.length === 1 && values.designation === def.ede.sampleDesignation) continue;
      rows.push({ slot, values });
    }
    if (rows.length) out[def.key] = rows;
  }
  return out;
}

export interface SheetRows {
  name: string;
  /** Rows top to bottom (blank rows kept inside the used range), columns A.. as values; null = blank. */
  rows: (string | number | null)[][];
}

/** Cell values of every worksheet of a workbook (for pasting-like import of an engineer's schedule). */
export async function readSheetRows(bytes: Uint8Array): Promise<SheetRows[]> {
  const zip = await loadWorkbookZip(bytes);
  const sst = await loadSharedStrings(zip);
  const out: SheetRows[] = [];
  const styles = zip.file('xl/styles.xml') ? await readText(zip, 'xl/styles.xml') : '';
  const dateIds = styles ? dateStyleIds(styles) : new Set<number>();
  for (const info of await listSheets(zip)) {
    const cells = parseCells(await readText(zip, info.part));
    const grid: (string | number | null)[][] = [];
    for (const cell of cells.values()) {
      const v = cellValue(cell, sst);
      if (v === null || v === '' || typeof v === 'boolean') continue;
      const { col, row } = splitRef(cell.ref);
      const c = colToNum(col) - 1;
      const val = typeof v === 'number' && cell.s !== undefined && dateIds.has(Number(cell.s)) ? serialToIso(v) : v;
      (grid[row - 1] ??= [])[c] = typeof val === 'string' ? val.trim() : val;
    }
    // dense rows, trailing blank rows dropped
    const width = grid.reduce((m, r) => Math.max(m, r?.length ?? 0), 0);
    const rows = Array.from({ length: grid.length }, (_, i) =>
      Array.from({ length: width }, (_, j) => grid[i]?.[j] ?? null),
    );
    while (rows.length && rows[rows.length - 1].every((x) => x === null || x === '')) rows.pop();
    // leading blank rows dropped too (a schedule often starts a few rows down)
    while (rows.length && rows[0].every((x) => x === null || x === '')) rows.shift();
    out.push({ name: info.name, rows });
  }
  return out;
}
