/**
 * exportWorkbook: fill the TAB workbook template with a project by patching ONLY input cells directly in
 * the sheet XML (JSZip + string patching). Every package part that is not touched is copied unchanged,
 * so VBA, drawings, header logos, form controls, validations and conditional formats survive.
 */
import JSZip from 'jszip';
import {
  attr, cellValue, colToNum, dateStyleIds, isoToSerial, isoToUs, listSheets, parseCells, parseCellTag, parseDefinedNames,
  parseRels, RawCell, readText, relsPathFor, resolveTarget, sheetDataRange, splitRef, workbookPart, xmlEscape,
} from './ooxml.js';
import {
  anchorRow, ColumnDef, FieldDef, Layout, NOTATIONS, sequenceCells, tableRows, TEMPLATE_MAP, TemplateMap,
} from './templateMap.js';
import { anchorSizeEmu, cropResizeJpeg, drawingPictures } from './coverPhoto.js';
import type { Cell, LayoutData, ProjectData } from './types.js';

export class FormulaCellError extends Error {
  constructor(public sheet: string, public ref: string, public formula: string, public source: string) {
    super(`Refusing to write ${source} into ${sheet}!${ref}: the template cell is a formula (=${formula.slice(0, 80)})`);
    this.name = 'FormulaCellError';
  }
}
export class MapError extends Error { constructor(msg: string) { super(msg); this.name = 'MapError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }

export interface ExportOptions {
  /** Cover photo (JPEG bytes). Omitted: the template placeholder picture stays. */
  coverPhoto?: Uint8Array;
  coverPhotoMaxWidth?: number;
  jpegQuality?: number;
  /** Alternative map (tests). */
  map?: TemplateMap;
}

export interface ExportReport {
  cellsWritten: number;
  cellsCleared: number;
  cellsCreated: number;
  rowsCreated: number;
  changedParts: string[];
  addedParts: string[];
  removedParts: string[];
  cachedValuesStripped: number;
  warnings: string[];
  coverPhoto?: {
    part: string; replacedPart: string; relId: string; boxAspect: number; boxDetail: string;
    width: number; height: number; srcWidth: number; srcHeight: number; bytes: number;
  };
}

type CellWrite = { kind: 'text'; text: string } | { kind: 'number'; n: number } | { kind: 'clear' };

// ------------------------------------------------------------------------------------------ sheet patcher
class SheetPatcher {
  private cells: Map<string, RawCell>;
  private merges: { c1: number; r1: number; c2: number; r2: number; ref: string }[];
  private colStyles: { min: number; max: number; style?: string }[];
  readonly writes = new Map<string, { w: CellWrite; source: string; styleFrom?: string }>();
  stats = { written: 0, cleared: 0, created: 0, rowsCreated: 0 };

  constructor(readonly sheet: string, readonly part: string, public xml: string) {
    this.cells = parseCells(xml);
    this.merges = [...xml.matchAll(/<mergeCell\b[^>]*ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g)].map((m) => ({
      c1: colToNum(m[1]), r1: Number(m[2]), c2: colToNum(m[3]), r2: Number(m[4]), ref: `${m[1]}${m[2]}:${m[3]}${m[4]}`,
    }));
    this.colStyles = [...xml.matchAll(/<col\b[^>]*\/>/g)].map((m) => ({
      min: Number(attr(m[0], 'min')), max: Number(attr(m[0], 'max')), style: attr(m[0], 'style'),
    }));
  }

  cell(ref: string): RawCell | undefined { return this.cells.get(ref); }

  /** Queue a write, after the safety checks: not a formula, not hidden under a merge, not written twice. */
  set(ref: string, w: CellWrite, source: string, styleFrom?: string): void {
    const cur = this.cells.get(ref);
    if (cur?.formula !== undefined) throw new FormulaCellError(this.sheet, ref, cur.formula, source);
    const { col, row } = splitRef(ref);
    const c = colToNum(col);
    const mg = this.merges.find((m) => c >= m.c1 && c <= m.c2 && row >= m.r1 && row <= m.r2);
    if (mg && (mg.c1 !== c || mg.r1 !== row)) {
      throw new MapError(`${source}: ${this.sheet}!${ref} is inside merged range ${mg.ref} but not its top-left cell (the value would be hidden)`);
    }
    const prev = this.writes.get(ref);
    if (prev && JSON.stringify(prev.w) !== JSON.stringify(w)) {
      throw new MapError(`${this.sheet}!${ref} written twice: by ${prev.source} and by ${source}`);
    }
    this.writes.set(ref, { w, source, styleFrom });
  }

  private newCellXml(ref: string, style: string | undefined, w: CellWrite): string {
    const s = style !== undefined ? ` s="${style}"` : '';
    if (w.kind === 'clear') return `<c r="${ref}"${s}/>`;
    if (w.kind === 'number') return `<c r="${ref}"${s}><v>${numberText(w.n)}</v></c>`;
    const sp = /^\s|\s$|\n/.test(w.text) ? ' xml:space="preserve"' : '';
    return `<c r="${ref}"${s} t="inlineStr"><is><t${sp}>${xmlEscape(w.text)}</t></is></c>`;
  }

  private defaultStyle(col: string, rowAttrs: string | undefined): string | undefined {
    if (rowAttrs && attr(`<row${rowAttrs}>`, 'customFormat') === '1') return attr(`<row${rowAttrs}>`, 's');
    const c = colToNum(col);
    return this.colStyles.find((x) => c >= x.min && c <= x.max)?.style;
  }

  /** Apply every queued write; returns true when the XML changed. */
  apply(): boolean {
    if (!this.writes.size) return false;
    const byRow = new Map<number, Map<string, CellWrite>>();
    for (const [ref, { w }] of this.writes) {
      const { row } = splitRef(ref);
      if (!byRow.has(row)) byRow.set(row, new Map());
      byRow.get(row)!.set(ref, w);
    }
    const sd = sheetDataRange(this.xml);
    const inner = this.xml.slice(sd.innerStart, sd.innerEnd);
    const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    let out = '';
    let last = 0;
    const done = new Set<number>();
    const pending = [...byRow.keys()].sort((a, b) => a - b);
    let changed = false;
    const emitNewRows = (beforeRow: number) => {
      let s = '';
      while (pending.length && pending[0] < beforeRow) {
        const r = pending.shift()!;
        if (done.has(r)) continue;
        const cells = this.buildRow(r, undefined, '');
        if (cells !== null) { s += `<row r="${r}">${cells}</row>`; this.stats.rowsCreated++; changed = true; }
        done.add(r);
      }
      return s;
    };
    for (const m of inner.matchAll(rowRe)) {
      const r = Number(attr(`<row${m[1]}>`, 'r'));
      out += inner.slice(last, m.index) + emitNewRows(r);
      last = m.index! + m[0].length;
      if (byRow.has(r)) {
        const cells = this.buildRow(r, m[1], m[2] ?? '');
        if (cells !== null && cells !== (m[2] ?? '')) {
          out += `<row${m[1]}>${cells}</row>`;
          changed = true;
        } else out += m[0];
        done.add(r);
        if (pending[0] === r) pending.shift();
      } else out += m[0];
    }
    out += inner.slice(last) + emitNewRows(Number.MAX_SAFE_INTEGER);
    if (!changed) return false;
    const open = sd.selfClosing ? '<sheetData>' : this.xml.slice(sd.start, sd.innerStart);
    this.xml = this.xml.slice(0, sd.start) + open + out + '</sheetData>' + this.xml.slice(sd.end);
    this.extendDimension();
    return true;
  }

  /** New inner XML of row r, or null when nothing changes. */
  private buildRow(r: number, rowAttrs: string | undefined, inner: string): string | null {
    const writes = byRowRefs(this.writes, r);
    const existing = [...inner.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)];
    // make sure the regex consumed the whole row (anything else in a row would be unexpected)
    if (existing.map((m) => m[0]).join('') !== inner.replace(/^\s+|\s+$/g, '')) {
      throw new Error(`${this.sheet} row ${r}: unexpected content in <row>`);
    }
    const parts: { col: number; xml: string }[] = [];
    let changed = false;
    const seen = new Set<string>();
    for (const m of existing) {
      const cell = parseCellTag(m[1], m[2]);
      seen.add(cell.ref);
      const w = writes.get(cell.ref);
      if (!w) { parts.push({ col: colToNum(cell.col), xml: m[0] }); continue; }
      const hasValue = cell.v !== undefined && cell.v !== '' || cell.inline !== undefined;
      if (w.kind === 'clear' && !hasValue) { parts.push({ col: colToNum(cell.col), xml: m[0] }); continue; }
      const xml = this.newCellXml(cell.ref, cell.s, w);
      if (xml !== m[0]) changed = true;
      w.kind === 'clear' ? this.stats.cleared++ : this.stats.written++;
      parts.push({ col: colToNum(cell.col), xml });
    }
    for (const [ref, w] of writes) {
      if (seen.has(ref) || w.kind === 'clear') continue;
      const { col } = splitRef(ref);
      // a cell missing from the template: take the style of the map's styleFrom sibling, else row / column default
      const from = this.writes.get(ref)!.styleFrom;
      const sibling = from ? existing.map((m) => parseCellTag(m[1], m[2])).find((c) => c.col === from) : undefined;
      const style = sibling?.s ?? this.defaultStyle(col, rowAttrs);
      parts.push({ col: colToNum(col), xml: this.newCellXml(ref, style, w) });
      this.stats.written++; this.stats.created++; changed = true;
    }
    if (!changed) return null;
    parts.sort((a, b) => a.col - b.col);
    return parts.map((p) => p.xml).join('');
  }

  private extendDimension(): void {
    const m = /<dimension\b[^>]*ref="([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?"/.exec(this.xml);
    if (!m) return;
    let c1 = colToNum(m[1]), r1 = Number(m[2]), c2 = colToNum(m[3] ?? m[1]), r2 = Number(m[4] ?? m[2]);
    for (const ref of this.writes.keys()) {
      const { col, row } = splitRef(ref);
      const c = colToNum(col);
      c1 = Math.min(c1, c); c2 = Math.max(c2, c); r1 = Math.min(r1, row); r2 = Math.max(r2, row);
    }
    const toCol = (n: number) => { let s = ''; while (n > 0) { const k = (n - 1) % 26; s = String.fromCharCode(65 + k) + s; n = Math.floor((n - 1) / 26); } return s; };
    const ref = `${toCol(c1)}${r1}:${toCol(c2)}${r2}`;
    this.xml = this.xml.replace(/(<dimension\b[^>]*ref=")[^"]*(")/, `$1${ref}$2`);
  }
}

function byRowRefs(writes: Map<string, { w: CellWrite }>, r: number): Map<string, CellWrite> {
  const out = new Map<string, CellWrite>();
  for (const [ref, { w }] of writes) if (splitRef(ref).row === r) out.set(ref, w);
  return out;
}

function numberText(n: number): string {
  if (!Number.isFinite(n)) throw new ValidationError(`not a finite number: ${n}`);
  return String(n);
}

// ------------------------------------------------------------------------------------------ export
export async function exportWorkbook(templateBytes: Uint8Array, project: ProjectData, opts: ExportOptions = {}): Promise<Uint8Array> {
  return (await exportWorkbookWithReport(templateBytes, project, opts)).bytes;
}

export async function exportWorkbookWithReport(templateBytes: Uint8Array, project: ProjectData, opts: ExportOptions = {}):
  Promise<{ bytes: Uint8Array; report: ExportReport }> {
  const map = opts.map ?? TEMPLATE_MAP;
  if (project.templateRevision !== map.revision) {
    throw new ValidationError(`project is for template revision ${project.templateRevision}, the map is revision ${map.revision}`);
  }
  const zip = await JSZip.loadAsync(templateBytes);
  const original = new Map<string, Uint8Array>();
  for (const name of Object.keys(zip.files)) if (!zip.files[name].dir) original.set(name, await zip.files[name].async('uint8array'));

  const report: ExportReport = {
    cellsWritten: 0, cellsCleared: 0, cellsCreated: 0, rowsCreated: 0, changedParts: [], addedParts: [], removedParts: [],
    cachedValuesStripped: 0, warnings: [],
  };
  const sheets = await listSheets(zip);
  const wbPart = await workbookPart(zip);
  const wbXml = await readText(zip, wbPart);
  const stylesRel = parseRels(await readText(zip, relsPathFor(wbPart))).find((r) => r.type.endsWith('/styles'));
  const dateStyles = stylesRel ? dateStyleIds(await readText(zip, resolveTarget(wbPart, stylesRel.target))) : new Set<number>();

  const patchers = new Map<string, SheetPatcher>();
  const patcher = async (sheet: string): Promise<SheetPatcher> => {
    if (!patchers.has(sheet)) {
      const info = sheets.find((s) => s.name === sheet);
      if (!info) throw new MapError(`template has no sheet named "${sheet}"`);
      patchers.set(sheet, new SheetPatcher(sheet, info.part, await readText(zip, info.part)));
    }
    return patchers.get(sheet)!;
  };

  // named lists, read from the template itself
  const names = parseDefinedNames(wbXml);
  const listCache = new Map<string, (string | number)[]>();
  const listValues = async (name: string): Promise<(string | number)[]> => {
    if (listCache.has(name)) return listCache.get(name)!;
    const dn = names.find((n) => n.name === name && n.localSheetId === undefined);
    if (!dn) throw new MapError(`template has no defined name ${name}`);
    const m = /^'?(.*?)'?!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(dn.ref);
    if (!m) throw new MapError(`defined name ${name} is not a simple range: ${dn.ref}`);
    const sheetName = m[1].replace(/''/g, "'");
    const info = sheets.find((s) => s.name === sheetName)!;
    const cells = parseCells(await readText(zip, info.part));
    const vals: (string | number)[] = [];
    for (let c = colToNum(m[2]); c <= colToNum(m[4]); c++) {
      for (let r = Number(m[3]); r <= Number(m[5]); r++) {
        const v = cellValue(cells.get(`${numToColLocal(c)}${r}`), []);
        if (v !== null && typeof v !== 'boolean') vals.push(v);
      }
    }
    listCache.set(name, vals);
    return vals;
  };

  const dateTextFallbackWarned = new Set<string>();
  const toWrite = async (def: { key: string; type: FieldDef['type']; list?: string; values?: readonly (string | number)[] },
    value: Cell, sheet: SheetPatcher, ref: string, path: string): Promise<CellWrite> => {
    if (value === null) return { kind: 'clear' };
    const isNotation = typeof value === 'string' && (NOTATIONS as readonly string[]).includes(value);
    switch (def.type) {
      case 'text':
        if (typeof value === 'number') return { kind: 'text', text: String(value) };
        if (value.length > 32767) throw new ValidationError(`${path}: text longer than Excel's 32,767 character cell limit`);
        return { kind: 'text', text: value };
      case 'number':
        if (typeof value === 'number') { numberText(value); return { kind: 'number', n: value }; }
        if (isNotation) return { kind: 'text', text: value };
        throw new ValidationError(`${path}: expected a number or ${NOTATIONS.join(' / ')}, got "${value}"`);
      case 'date': {
        if (isNotation) return { kind: 'text', text: value as string };
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError(`${path}: expected an ISO date YYYY-MM-DD, got "${value}"`);
        const serial = isoToSerial(value);
        const style = sheet.cell(ref)?.s;
        if (style !== undefined && dateStyles.has(Number(style))) return { kind: 'number', n: serial };
        const key = `${sheet.sheet}:${def.key}`;
        if (!dateTextFallbackWarned.has(key)) {
          dateTextFallbackWarned.add(key);
          report.warnings.push(`${sheet.sheet}!${ref} (${def.key}) has no date number format in the template; dates written as text M/D/YYYY`);
        }
        return { kind: 'text', text: isoToUs(value) };
      }
      case 'list': {
        const allowed = def.values ?? (def.list ? await listValues(def.list) : []);
        if (isNotation) return { kind: 'text', text: value as string };
        const hit = allowed.find((a) => a === value || (typeof a === 'number' && Number(value) === a && String(value).trim() !== ''));
        if (hit === undefined) {
          throw new ValidationError(`${path}: "${value}" is not in list ${def.list ?? JSON.stringify(def.values)} (${allowed.join(', ')})`);
        }
        return typeof hit === 'number' ? { kind: 'number', n: hit } : { kind: 'text', text: hit };
      }
    }
  };

  const writeLayout = async (layout: Layout, sheetName: string, base: number, data: LayoutData, path: string) => {
    const sh = await patcher(sheetName);
    for (const [k, v] of Object.entries(data.fields ?? {})) {
      const def = layout.fields?.find((x) => x.key === k);
      if (!def) throw new MapError(`${path}.fields.${k}: not in the template map`);
      if (v === undefined) continue;
      const ref = `${def.col}${base + def.row}`;
      sh.set(ref, await toWrite(def, v, sh, ref, `${path}.${k}`), `${path}.${k}`);
    }
    for (const [k, rows] of Object.entries(data.tables ?? {})) {
      const def = layout.tables?.find((x) => x.key === k);
      if (!def) throw new MapError(`${path}.tables.${k}: not in the template map`);
      const slots = tableRows(def);
      if (rows.length > slots.length) throw new ValidationError(`${path}.${k}: ${rows.length} rows, the template has room for ${slots.length}`);
      for (let i = 0; i < slots.length; i++) {
        const row = rows[i];
        for (const col of def.columns) {
          if (slots[i].omit.includes(col.col)) {
            if (row && row[col.key] !== undefined && row[col.key] !== null) {
              report.warnings.push(`${path}.${k}[${i}].${col.key} ignored: ${sheetName}!${col.col}${base + slots[i].row} is a formula on this row`);
            }
            continue;
          }
          const ref = `${col.col}${base + slots[i].row}`;
          const v: Cell | undefined = row ? row[col.key] : null; // rows past the end are cleared (the list replaces the table)
          if (v === undefined) continue;
          sh.set(ref, await toWrite(col, v, sh, ref, `${path}.${k}[${i}].${col.key}`), `${path}.${k}[${i}].${col.key}`, col.styleFrom);
        }
        for (const key of Object.keys(row ?? {})) {
          if (!def.columns.some((cd: ColumnDef) => cd.key === key)) throw new MapError(`${path}.${k}[${i}].${key}: not a column of ${k}`);
        }
      }
    }
    for (const [k, lines] of Object.entries(data.lines ?? {})) {
      const def = layout.lines?.find((x) => x.key === k);
      if (!def) throw new MapError(`${path}.lines.${k}: not in the template map`);
      if (lines.length > def.cells.length) throw new ValidationError(`${path}.${k}: ${lines.length} lines, room for ${def.cells.length}`);
      for (let i = 0; i < def.cells.length; i++) {
        const ref = `${def.cells[i].col}${base + def.cells[i].row}`;
        const v = i < lines.length ? lines[i] : null;
        sh.set(ref, v === null ? { kind: 'clear' } : { kind: 'text', text: v }, `${path}.${k}[${i}]`);
      }
    }
    for (const [k, vals] of Object.entries(data.sequences ?? {})) {
      const def = layout.sequences?.find((x) => x.key === k);
      if (!def) throw new MapError(`${path}.sequences.${k}: not in the template map`);
      const cellsInOrder = sequenceCells(def);
      if (vals.length > cellsInOrder.length) throw new ValidationError(`${path}.${k}: ${vals.length} readings, room for ${cellsInOrder.length}`);
      for (let i = 0; i < cellsInOrder.length; i++) {
        const ref = `${cellsInOrder[i].col}${base + cellsInOrder[i].row}`;
        const v = i < vals.length ? vals[i] : null;
        sh.set(ref, await toWrite({ key: k, type: def.type }, v, sh, ref, `${path}.${k}[${i}]`), `${path}.${k}[${i}]`);
      }
    }
    for (const [k, items] of Object.entries(data.columnTables ?? {})) {
      const def = layout.columnTables?.find((x) => x.key === k);
      if (!def) throw new MapError(`${path}.columnTables.${k}: not in the template map`);
      if (items.length > def.cols.length) throw new ValidationError(`${path}.${k}: ${items.length} items, room for ${def.cols.length}`);
      for (let i = 0; i < def.cols.length; i++) {
        for (const fd of def.fields) {
          const ref = `${def.cols[i]}${base + fd.row}`;
          const v: Cell | undefined = i < items.length ? items[i][fd.key] : null;
          if (v === undefined) continue;
          sh.set(ref, await toWrite(fd, v, sh, ref, `${path}.${k}[${i}].${fd.key}`), `${path}.${k}[${i}].${fd.key}`);
        }
      }
    }
  };

  // ---- single-sheet sections
  for (const [key, data] of Object.entries(project.sections)) {
    const sec = map.sections.find((s) => s.key === key);
    if (!sec) throw new MapError(`sections.${key}: not in the template map`);
    await writeLayout(sec, sec.sheet, 0, data, `sections.${key}`);
  }
  // template placeholders in fields the project does not supply are cleared
  for (const sec of map.sections) {
    for (const fd of sec.fields ?? []) {
      if (fd.placeholder === undefined || project.sections[sec.key]?.fields?.[fd.key] !== undefined) continue;
      const sh = await patcher(sec.sheet);
      const ref = `${fd.col}${fd.row}`;
      if (cellValue(sh.cell(ref), []) === fd.placeholder) sh.set(ref, { kind: 'clear' }, `placeholder ${sec.key}.${fd.key}`);
    }
  }

  // ---- equipment
  for (const [key, units] of Object.entries(project.equipment)) {
    const def = map.equipment.find((e) => e.key === key);
    if (!def) throw new MapError(`equipment.${key}: not in the template map`);
    const seen = new Set<number>();
    for (const u of units) {
      const path = `equipment.${key}[slot ${u.slot}]`;
      if (!Number.isInteger(u.slot) || u.slot < 1 || u.slot > def.capacity) throw new ValidationError(`${path}: slot must be 1..${def.capacity}`);
      if (seen.has(u.slot)) throw new ValidationError(`${path}: slot used twice`);
      seen.add(u.slot);
      if (u.schedule) {
        if (!def.ede) throw new MapError(`${path}.schedule: ${key} has no data-entry section`);
        const sh = await patcher(def.ede.sheet);
        const row = def.ede.firstRow + u.slot - 1;
        for (const [k, v] of Object.entries(u.schedule)) {
          const fd = def.ede.fields.find((x) => x.key === k);
          if (!fd) throw new MapError(`${path}.schedule.${k}: not in the template map`);
          if (v === undefined) continue;
          const ref = `${fd.col}${row}`;
          sh.set(ref, await toWrite(fd, v, sh, ref, `${path}.schedule.${k}`), `${path}.schedule.${k}`);
        }
      }
      await writeLayout(def.block, def.block.sheet, anchorRow(def.block.anchor, u.slot), u, path);
    }
  }
  // sample designations (RTU-1, MUA-1, ...) on the first data-entry row of unused sections
  for (const def of map.equipment) {
    if (!def.ede?.sampleDesignation) continue;
    const slot1 = project.equipment[def.key]?.find((u) => u.slot === 1);
    if (slot1?.schedule?.designation !== undefined) continue;
    const sh = await patcher(def.ede.sheet);
    const ref = `B${def.ede.firstRow}`;
    if (cellValue(sh.cell(ref), []) === def.ede.sampleDesignation) sh.set(ref, { kind: 'clear' }, `sample designation ${def.ede.sampleDesignation}`);
  }

  // ---- apply sheet patches
  for (const p of patchers.values()) {
    if (p.apply()) zip.file(p.part, p.xml);
    report.cellsWritten += p.stats.written; report.cellsCleared += p.stats.cleared;
    report.cellsCreated += p.stats.created; report.rowsCreated += p.stats.rowsCreated;
  }

  // ---- stale cached values in formula cells, full recalculation on load
  for (const s of sheets) {
    const xml = await readText(zip, s.part);
    let n = 0;
    const fixed = xml.replace(/<c\b([^>]*?)>(<f\b[^>]*?(?:\/>|>[^<]*<\/f>))<v>([^<]+)<\/v><\/c>/g, (_m, a: string, fx: string) => {
      n++;
      return `<c${a.replace(/\st="[^"]*"/, '')}>${fx}<v></v></c>`;
    });
    if (n) { zip.file(s.part, fixed); report.cachedValuesStripped += n; }
  }
  const calcPr = /<calcPr\b[^>]*\/?>/.exec(wbXml);
  if (!calcPr || attr(calcPr[0], 'fullCalcOnLoad') !== '1') {
    const newCalc = calcPr
      ? calcPr[0].replace(/\sfullCalcOnLoad="[^"]*"/, '').replace(/<calcPr/, '<calcPr fullCalcOnLoad="1"')
      : '<calcPr fullCalcOnLoad="1"/>';
    zip.file(wbPart, calcPr ? wbXml.replace(calcPr[0], newCalc) : wbXml.replace('</workbook>', `${newCalc}</workbook>`));
    report.warnings.push('workbook.xml: fullCalcOnLoad was not set; added');
  }
  if (zip.file('xl/calcChain.xml')) report.warnings.push('xl/calcChain.xml present (left as is)');

  // ---- cover photo
  if (opts.coverPhoto) report.coverPhoto = await replaceCoverPhoto(zip, sheets, map, opts);

  // ---- report changed / added / removed parts
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue;
    const before = original.get(name);
    if (!before) { report.addedParts.push(name); continue; }
    const after = await zip.files[name].async('uint8array');
    if (!bytesEqual(before, after)) report.changedParts.push(name);
  }
  for (const name of original.keys()) if (!zip.file(name)) report.removedParts.push(name);

  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { bytes, report };
}

function numToColLocal(n: number): string {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ------------------------------------------------------------------------------------------ cover photo
async function replaceCoverPhoto(zip: JSZip, sheets: { name: string; part: string }[], map: TemplateMap, opts: ExportOptions):
  Promise<NonNullable<ExportReport['coverPhoto']>> {
  const sheet = sheets.find((s) => s.name === map.coverPhoto.sheet);
  if (!sheet) throw new MapError(`no sheet ${map.coverPhoto.sheet}`);
  const sheetXml = await readText(zip, sheet.part);
  const drawingTag = /<drawing\b[^>]*\/>/.exec(sheetXml);
  if (!drawingTag) throw new MapError(`${map.coverPhoto.sheet} has no drawing`);
  const sheetRels = parseRels(await readText(zip, relsPathFor(sheet.part)));
  const dRel = sheetRels.find((r) => r.id === attr(drawingTag[0], 'r:id'))!;
  const drawingPart = resolveTarget(sheet.part, dRel.target);
  const drawingXml = await readText(zip, drawingPart);
  const pic = drawingPictures(drawingXml).find((p) => p.name === map.coverPhoto.pictureName);
  if (!pic || !pic.embed || !pic.anchor) throw new MapError(`picture "${map.coverPhoto.pictureName}" (two-cell anchored) not found in ${drawingPart}`);
  const drawingRelsPart = relsPathFor(drawingPart);
  const drawingRelsXml = await readText(zip, drawingRelsPart);
  const imgRel = parseRels(drawingRelsXml).find((r) => r.id === pic.embed);
  if (!imgRel) throw new MapError(`${drawingRelsPart} has no relationship ${pic.embed}`);
  const oldMedia = resolveTarget(drawingPart, imgRel.target);

  const box = anchorSizeEmu(sheetXml, pic.anchor);
  const aspect = box.cx / box.cy;
  const photo = cropResizeJpeg(opts.coverPhoto!, aspect, opts.coverPhotoMaxWidth ?? 1600, opts.jpegQuality ?? 85);

  // new media part imageN.jpeg (next free N)
  const used = Object.keys(zip.files).map((n) => /^xl\/media\/image(\d+)\./.exec(n)?.[1]).filter(Boolean).map(Number);
  const newMedia = `xl/media/image${Math.max(0, ...used) + 1}.jpeg`;
  zip.file(newMedia, photo.jpeg);
  const newTarget = `../media/${newMedia.split('/').pop()}`;
  zip.file(drawingRelsPart, drawingRelsXml.replace(imgRel.tag, imgRel.tag.replace(/Target="[^"]*"/, `Target="${newTarget}"`)));

  // [Content_Types].xml: a Default for .jpeg must exist
  let ct = await readText(zip, '[Content_Types].xml');
  if (!/<Default\b[^>]*Extension="jpeg"/i.test(ct)) {
    ct = ct.replace('</Types>', '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>');
    zip.file('[Content_Types].xml', ct);
  }
  // drop the old placeholder image if nothing else points at it (no orphan parts)
  let stillUsed = false;
  for (const name of Object.keys(zip.files)) {
    if (!name.endsWith('.rels') || zip.files[name].dir) continue;
    const owner = name.replace(/_rels\/([^/]+)\.rels$/, '$1');
    for (const r of parseRels(await readText(zip, name))) if (!r.external && resolveTarget(owner, r.target) === oldMedia) stillUsed = true;
  }
  if (!stillUsed) {
    zip.remove(oldMedia);
    const ov = new RegExp(`<Override\\b[^>]*PartName="/${oldMedia.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`);
    if (ov.test(ct)) zip.file('[Content_Types].xml', ct.replace(ov, ''));
  }
  return {
    part: newMedia, replacedPart: oldMedia, relId: imgRel.id, boxAspect: aspect, boxDetail: box.detail,
    width: photo.width, height: photo.height, srcWidth: photo.srcWidth, srcHeight: photo.srcHeight, bytes: photo.jpeg.length,
  };
}
