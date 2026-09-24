/**
 * importWorkbook: read the template map's input cells back out of a workbook -> ProjectData.
 * Handles inline strings (our export), shared strings (Excel / LibreOffice re-saves), numbers and dates.
 */
import JSZip from 'jszip';
import { cellValue, listSheets, loadSharedStrings, parseCells, RawCell, readText, serialToIso, usToIso } from './ooxml.js';
import { anchorRow, blockLayout, fieldPreset, FieldType, Layout, sequenceCells, tableRows, TEMPLATE_MAP, TemplateMap } from './templateMap.js';
import type { Cell, LayoutData, ProjectData, UnitData, Value } from './types.js';

export interface ImportOptions { map?: TemplateMap }
export interface ImportReport { warnings: string[] }

export async function importWorkbook(bytes: Uint8Array, opts: ImportOptions = {}): Promise<ProjectData> {
  return (await importWorkbookWithReport(bytes, opts)).project;
}

export async function importWorkbookWithReport(bytes: Uint8Array, opts: ImportOptions = {}): Promise<{ project: ProjectData; report: ImportReport }> {
  const map = opts.map ?? TEMPLATE_MAP;
  const zip = await JSZip.loadAsync(bytes);
  const sheets = await listSheets(zip);
  const sst = await loadSharedStrings(zip);
  const report: ImportReport = { warnings: [] };
  const cache = new Map<string, Map<string, RawCell>>();
  const cellsOf = async (sheet: string) => {
    if (!cache.has(sheet)) {
      const info = sheets.find((s) => s.name === sheet);
      if (!info) throw new Error(`workbook has no sheet "${sheet}"`);
      cache.set(sheet, parseCells(await readText(zip, info.part)));
    }
    return cache.get(sheet)!;
  };

  const read = (cells: Map<string, RawCell>, ref: string, type: FieldType, where: string,
    ignore: readonly (string | number)[] = []): Value | undefined => {
    const raw = cellValue(cells.get(ref), sst);
    if (raw === null || raw === '' || typeof raw === 'boolean') return undefined;
    if (cells.get(ref)?.formula !== undefined) report.warnings.push(`${where}: ${ref} is a formula cell`);
    if (ignore.includes(raw)) return undefined;
    if (type === 'date') {
      if (typeof raw === 'number') return serialToIso(raw);
      const iso = usToIso(raw);
      return iso ?? raw;
    }
    if (type === 'text' && typeof raw === 'number') return String(raw);
    return raw;
  };

  const readLayout = async (layout: Layout, sheet: string, base: number, where: string): Promise<LayoutData> => {
    const cells = await cellsOf(sheet);
    const out: LayoutData = {};
    for (const fd of layout.fields ?? []) {
      const ignore = [...(fd.placeholder !== undefined ? [fd.placeholder] : []), ...(fd.blankValues ?? [])];
      const v = read(cells, `${fd.col}${base + fd.row}`, fd.type, `${where}.${fd.key}`, ignore);
      if (v !== undefined) (out.fields ??= {})[fd.key] = v;
    }
    for (const td of layout.tables ?? []) {
      const rows: Record<string, Cell>[] = tableRows(td).map((r) => {
        const rec: Record<string, Cell> = {};
        for (const col of td.columns) {
          if (r.omit.includes(col.col)) continue;
          const v = read(cells, `${col.col}${base + r.row}`, col.type, `${where}.${td.key}`);
          if (v !== undefined) rec[col.key] = v;
        }
        return rec;
      });
      while (rows.length && !Object.keys(rows[rows.length - 1]).length) rows.pop();
      if (rows.length) (out.tables ??= {})[td.key] = rows;
    }
    for (const ld of layout.lines ?? []) {
      const lines: (string | null)[] = ld.cells.map((c) => {
        const v = read(cells, `${c.col}${base + c.row}`, 'text', `${where}.${ld.key}`);
        return v === undefined ? null : String(v);
      });
      while (lines.length && lines[lines.length - 1] === null) lines.pop();
      if (lines.length) (out.lines ??= {})[ld.key] = lines;
    }
    for (const sd of layout.sequences ?? []) {
      const vals: Cell[] = sequenceCells(sd).map((c) => read(cells, `${c.col}${base + c.row}`, sd.type, `${where}.${sd.key}`) ?? null);
      while (vals.length && vals[vals.length - 1] === null) vals.pop();
      if (vals.length) (out.sequences ??= {})[sd.key] = vals;
    }
    for (const cd of layout.columnTables ?? []) {
      const items: Record<string, Cell>[] = cd.cols.map((col) => {
        const rec: Record<string, Cell> = {};
        for (const fd of cd.fields) {
          const v = read(cells, `${col}${base + fd.row}`, fd.type, `${where}.${cd.key}`);
          if (v !== undefined) rec[fd.key] = v;
        }
        return rec;
      });
      while (items.length && !Object.keys(items[items.length - 1]).length) items.pop();
      if (items.length) (out.columnTables ??= {})[cd.key] = items;
    }
    return out;
  };

  const project: ProjectData = { templateRevision: map.revision, sections: {}, equipment: {} };
  for (const sec of map.sections) {
    const data = await readLayout(sec, sec.sheet, 0, `sections.${sec.key}`);
    if (Object.keys(data).length) project.sections[sec.key] = data;
  }
  for (const def of map.equipment) {
    const units: UnitData[] = [];
    for (let slot = 1; slot <= def.capacity; slot++) {
      const where = `equipment.${def.key}[slot ${slot}]`;
      const unit: UnitData = { slot };
      if (def.ede) {
        const cells = await cellsOf(def.ede.sheet);
        const row = def.ede.firstRow + slot - 1;
        for (const fd of def.ede.fields) {
          const v = read(cells, `${fd.col}${row}`, fd.type, `${where}.schedule.${fd.key}`);
          if (v !== undefined) (unit.schedule ??= {})[fd.key] = v;
        }
      }
      const data = await readLayout(blockLayout(def, slot), def.block.sheet, anchorRow(def.block.anchor, slot), where);
      // a slot is used when it has a designation or any value other than the template's presets
      const presets = new Map((def.block.fields ?? []).map((f) => [f.key, fieldPreset(f, slot)] as const).filter(([, p]) => p !== undefined));
      const blockData = Object.entries(data.fields ?? {}).some(([k, v]) => presets.get(k) !== v)
        || Object.keys(data).some((k) => k !== 'fields');
      // the untouched template's sample designation (RTU-1, MUA-1, ...) alone does not make slot 1 a unit
      const onlySample = slot === 1 && !blockData && unit.schedule !== undefined && Object.keys(unit.schedule).length === 1
        && unit.schedule.designation === def.ede?.sampleDesignation;
      const meaningful = (blockData || unit.schedule !== undefined) && !onlySample;
      if (!meaningful) continue;
      units.push({ ...unit, ...data });
    }
    if (units.length) project.equipment[def.key] = units;
  }
  return { project, report };
}

// ------------------------------------------------------------------------------------------ comparison
/** Keep only what the workbook can hold: drop undefined/null values, empty containers and non-mapped keys. */
export function normalizeProject(p: ProjectData): ProjectData {
  const clean = (x: unknown): unknown => {
    if (Array.isArray(x)) {
      const arr = x.map(clean);
      while (arr.length && (arr[arr.length - 1] === undefined || arr[arr.length - 1] === null)) arr.pop();
      return arr.length ? arr : undefined;
    }
    if (x && typeof x === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(x)) {
        const c = clean(v);
        if (c !== undefined && c !== null) o[k] = c;
      }
      return Object.keys(o).length ? o : undefined;
    }
    return x === '' ? undefined : x;
  };
  const { name: _n, coverPhoto: _c, ...rest } = p;
  const out = clean(rest) as ProjectData;
  out.sections ??= {};
  out.equipment ??= {};
  for (const k of Object.keys(out.equipment)) out.equipment[k] = [...out.equipment[k]].sort((a, b) => a.slot - b.slot);
  return out;
}

/** Path-level differences between two JSON-like values. */
export function diff(a: unknown, b: unknown, path = ''): string[] {
  if (typeof a === 'number' && typeof b === 'number') return a === b ? [] : [`${path}: ${a} != ${b}`];
  if (a === b) return [];
  if (Array.isArray(a) && Array.isArray(b)) {
    const out: string[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) out.push(...diff(a[i], b[i], `${path}[${i}]`));
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out: string[] = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      out.push(...diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
    }
    return out;
  }
  return [`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`];
}
