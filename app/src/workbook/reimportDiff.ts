/**
 * Three-way diff for re-importing an issued workbook (decision F2). Pure: no database, no DOM.
 *
 *   base = the values of the export the workbook came from (the revision's baseline snapshot)
 *   app  = the project in the app now
 *   wb   = the values read from the re-imported workbook
 *
 * Per value:  wb == base                          -> nothing to review (the app value stays, changed or not)
 *             wb != base, app == base             -> incoming change (default: accept)
 *             wb != base, app != base, wb == app  -> nothing to review
 *             wb != base, app != base, wb != app  -> collision (no default: the user picks app or workbook)
 * Without a baseline (a workbook the app never exported for this project) base = app: every difference is incoming.
 *
 * All three sides go through the same path before they are compared: workbook-shaped values (ProjectData) are
 * canonicalized by field type (number noise, text numbers, date serials / US dates vs ISO, N/A notation case,
 * trimming), then read into app records with the importer's own adapter (fromProjectData), which also turns a plain
 * "N/A" the app would set by itself back into automatic N/A. The app side is exported first (toProjectData), so it is
 * compared exactly as the workbook would hold it. Formatting is never compared.
 */
import {
  blockLayout,
  NOTATIONS,
  TEMPLATE_MAP,
  type Cell,
  type FieldType,
  type Layout,
  type LayoutData,
  type ProjectData,
} from '@a2b/workbook/map';
import { equipmentType, EQUIPMENT_TYPES, type EquipmentTypeKey } from '../domain/equipmentTypes';
import { getSpec, ROW_COLUMNS, type EquipmentSpec } from '../domain/specs';
import type { AirflowRow, FieldValue, NaMark } from '../data/types';
import { PRESSURE_INFO_KEYS, PRESSURE_LABELS } from '../domain/projectCompletion';
import { fromProjectData, PROJECT_INFO_KEYS, toProjectData, type ProjectBundle } from './adapter';

export type Val = string | number | null;

// ------------------------------------------------------------------------------------------ canonical values
const NOTATION_RE: [RegExp, string][] = [
  [/^n\s*\/\s*a$/i, 'N/A'],
  [/^not\s*avail\.?$/i, 'Not Avail.'],
  [/^not\s*acc\.?$/i, 'Not Acc.'],
];
const EPOCH = Date.UTC(1899, 11, 30);
const serialToIso = (n: number) => new Date(EPOCH + Math.round(n) * 86400000).toISOString().slice(0, 10);
function usToIso(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s.trim());
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}
const NUMERIC = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/** Round away float noise (0.30000000000000004 -> 0.3); 12 significant digits. */
export function canonicalNumber(n: number): number {
  if (!Number.isFinite(n)) return n;
  const r = Number(n.toPrecision(12));
  return Object.is(r, -0) ? 0 : r;
}

/** Canonical string: line endings, non-breaking spaces, trailing spaces per line, outer whitespace; notation case. */
export function canonicalText(s: string): string {
  const t = s
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .trim();
  for (const [re, n] of NOTATION_RE) if (re.test(t)) return n;
  return t;
}

/** One workbook cell in canonical form for its field type (undefined / blank -> null). */
export function canonicalCell(v: Cell | undefined, type?: FieldType): Cell {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') {
    if (type === 'date' && v > 0 && v < 2958466) return serialToIso(v);
    if (type === 'text') return String(canonicalNumber(v));
    return canonicalNumber(v);
  }
  const s = canonicalText(v);
  if (s === '') return null;
  if ((NOTATIONS as readonly string[]).includes(s)) return s;
  if (type === 'number' && NUMERIC.test(s.replace(/,/g, ''))) return canonicalNumber(Number(s.replace(/,/g, '')));
  if (type === 'date') {
    if (NUMERIC.test(s)) return serialToIso(Number(s));
    const iso = usToIso(s) ?? (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
    if (iso) return iso;
  }
  if (type === 'list' && NUMERIC.test(s)) return canonicalNumber(Number(s));
  return s;
}

function canonicalLayout(layout: Layout, data: LayoutData): LayoutData {
  const out: LayoutData = {};
  const typeOf = (list: readonly { key: string; type: FieldType }[] | undefined, key: string) =>
    list?.find((f) => f.key === key)?.type;
  const rec = (r: Record<string, Cell>, types: readonly { key: string; type: FieldType }[] | undefined) => {
    const o: Record<string, Cell> = {};
    for (const [k, v] of Object.entries(r)) {
      const c = canonicalCell(v, typeOf(types, k));
      if (c !== null) o[k] = c;
    }
    return o;
  };
  if (data.fields) out.fields = rec(data.fields, layout.fields);
  if (data.tables) {
    out.tables = {};
    for (const [k, rows] of Object.entries(data.tables)) {
      out.tables[k] = rows.map((r) => rec(r, layout.tables?.find((t) => t.key === k)?.columns));
    }
  }
  if (data.columnTables) {
    out.columnTables = {};
    for (const [k, rows] of Object.entries(data.columnTables)) {
      out.columnTables[k] = rows.map((r) => rec(r, layout.columnTables?.find((t) => t.key === k)?.fields));
    }
  }
  if (data.lines) {
    out.lines = {};
    for (const [k, lines] of Object.entries(data.lines)) {
      out.lines[k] = lines.map((l) => (l === null ? null : ((canonicalCell(l, 'text') as string | null) ?? null)));
    }
  }
  if (data.sequences) {
    out.sequences = {};
    for (const [k, vals] of Object.entries(data.sequences)) {
      const type = layout.sequences?.find((s) => s.key === k)?.type;
      out.sequences[k] = vals.map((v) => canonicalCell(v, type));
    }
  }
  return out;
}

/** Canonical copy of workbook values (see canonicalCell), typed by the template map. */
export function canonicalProjectData(pd: ProjectData): ProjectData {
  const out: ProjectData = { templateRevision: pd.templateRevision, sections: {}, equipment: {} };
  for (const [key, data] of Object.entries(pd.sections)) {
    const sec = TEMPLATE_MAP.sections.find((s) => s.key === key);
    if (sec) out.sections[key] = canonicalLayout(sec, data);
  }
  for (const [key, units] of Object.entries(pd.equipment)) {
    const def = TEMPLATE_MAP.equipment.find((d) => d.key === key);
    if (!def) continue;
    out.equipment[key] = units.map((u) => {
      const c = { ...canonicalLayout(blockLayout(def, u.slot), u), slot: u.slot } as typeof u;
      if (u.schedule) {
        c.schedule = {};
        for (const [k, v] of Object.entries(u.schedule)) {
          const cv = canonicalCell(v, def.ede?.fields.find((f) => f.key === k)?.type);
          if (cv !== null) c.schedule[k] = cv;
        }
      }
      return c;
    });
  }
  return out;
}

/** Workbook values -> app records, the same way for all three sides. */
export function readSide(pd: ProjectData): ProjectBundle {
  let n = 0;
  return fromProjectData(canonicalProjectData(pd), { now: 0, newId: () => `side-${++n}`, fallbackName: '' });
}

/** The app side: exported (as the workbook would hold it) and read back. */
export function appSide(app: ProjectBundle): { side: ProjectBundle; data: ProjectData } {
  const { data } = toProjectData(app);
  return { side: readSide(data), data };
}

export function sameVal(a: Val, b: Val): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
  if (typeof a === 'number' && typeof b === 'string' && NUMERIC.test(b)) return sameVal(a, Number(b));
  if (typeof b === 'number' && typeof a === 'string' && NUMERIC.test(a)) return sameVal(Number(a), b);
  return false;
}

// ------------------------------------------------------------------------------------------ flat records
export type RecKind = 'project' | 'blueprint' | 'instrument' | 'issue' | 'unit' | 'row';

/** Where a record lives: resolved back to app records when changes are applied. */
export type RecRef =
  | { kind: 'project' }
  | { kind: 'blueprint'; index: number }
  | { kind: 'instrument'; index: number }
  | { kind: 'issue'; issueKind: 'new' | 'existing'; number: number }
  | { kind: 'unit'; type: EquipmentTypeKey; slot: number }
  | { kind: 'row'; type: EquipmentTypeKey; slot: number; table: string; rowKey: string; index: number };

export interface FlatRec {
  key: string;
  ref: RecRef;
  cells: Record<string, Val>;
}

const unitKey = (type: string, slot: number) => `unit:${type}#${slot}`;
const valueOrMark = (v: FieldValue | undefined, mark: NaMark | null | undefined): Val => {
  if (v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '')) return v;
  return mark?.notation ?? null;
};
/** App-only answers derived from the data on import; never compared. */
const DERIVED = new Set(['hasVfd', 'hasFilters']);

const sortedRows = (rows: AirflowRow[], equipmentId: string, table: string) =>
  rows.filter((r) => r.equipmentId === equipmentId && r.table === table).sort((a, b) => a.order - b.order);

type RowMode = 'no' | 'pos';
const noKey = (r: AirflowRow) => {
  const v = r.data.no;
  return v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().toLowerCase();
};

/**
 * Rows are matched by table + position, or by their `No.` when every row of that table on all three sides has a
 * unique No. (so a row inserted in Excel does not shift the rows below it).
 */
function rowModes(sides: ProjectBundle[]): Map<string, RowMode> {
  const modes = new Map<string, RowMode>();
  const lists = new Map<string, AirflowRow[][]>();
  for (const b of sides) {
    for (const e of b.equipment) {
      for (const table of new Set(b.rows.filter((r) => r.equipmentId === e.id).map((r) => r.table))) {
        const k = `${unitKey(e.type, e.slot)}:${table}`;
        if (!lists.has(k)) lists.set(k, []);
        lists.get(k)!.push(sortedRows(b.rows, e.id, table));
      }
    }
  }
  for (const [k, ls] of lists) {
    const ok = ls.every((rows) => {
      const nos = rows.map(noKey);
      return nos.every((n) => n !== null) && new Set(nos).size === nos.length;
    });
    modes.set(k, ok ? 'no' : 'pos');
  }
  return modes;
}

export function flatten(b: ProjectBundle, modes: Map<string, RowMode>): Map<string, FlatRec> {
  const out = new Map<string, FlatRec>();
  const add = (r: FlatRec) => out.set(r.key, r);
  const p = b.project;
  const pc: Record<string, Val> = { name: p.name.trim() === '' ? null : p.name, tolerance: p.tolerance };
  for (const k of [...PROJECT_INFO_KEYS, 'narrative', ...PRESSURE_INFO_KEYS])
    pc[`info.${k}`] = valueOrMark(p.info[k], p.naState.fields[k]);
  add({ key: 'project', ref: { kind: 'project' }, cells: pc });
  p.blueprints
    .filter((bp) => bp.sheet.trim() !== '' || bp.revisionDate.trim() !== '')
    .forEach((bp, index) =>
      add({
        key: `bp#${index}`,
        ref: { kind: 'blueprint', index },
        cells: { sheet: bp.sheet.trim() || null, revisionDate: bp.revisionDate.trim() || null },
      }),
    );
  [...b.instruments]
    .sort((x, y) => x.order - y.order)
    .forEach((ins, index) =>
      add({
        key: `ins#${index}`,
        ref: { kind: 'instrument', index },
        cells: {
          type: ins.type || null,
          manufacturer: ins.manufacturer || null,
          model: ins.model || null,
          serial: ins.serial || null,
          calibrationDate: ins.calibrationDate || null,
        },
      }),
    );
  const byId = new Map(b.equipment.map((e) => [e.id, e]));
  for (const i of b.issues) {
    add({
      key: `issue:${i.kind}#${i.number}`,
      ref: { kind: 'issue', issueKind: i.kind, number: i.number },
      cells: {
        remark: i.remark.trim() || null,
        status: i.status,
        comments: i.comments.trim() || null,
        unit: i.equipmentId ? (byId.get(i.equipmentId)?.designation ?? null) : null,
      },
    });
  }
  for (const e of b.equipment) {
    const uk = unitKey(e.type, e.slot);
    const cells: Record<string, Val> = { designation: e.designation };
    for (const k of new Set([...Object.keys(e.data), ...Object.keys(e.naState.fields)])) {
      if (DERIVED.has(k)) continue;
      const v = valueOrMark(e.data[k], e.naState.fields[k]);
      if (v !== null) cells[k] = v;
    }
    add({ key: uk, ref: { kind: 'unit', type: e.type, slot: e.slot }, cells });
    for (const table of new Set(b.rows.filter((r) => r.equipmentId === e.id).map((r) => r.table))) {
      const mode = modes.get(`${uk}:${table}`) ?? 'pos';
      sortedRows(b.rows, e.id, table).forEach((r, index) => {
        const rowKey = mode === 'no' ? `no:${noKey(r)}` : `#${index}`;
        const rc: Record<string, Val> = {};
        for (const k of new Set([...Object.keys(r.data), ...Object.keys(r.na)])) {
          const v = valueOrMark(r.data[k], r.na[k]);
          if (v !== null) rc[k] = v;
        }
        add({
          key: `row:${e.type}#${e.slot}:${table}:${rowKey}`,
          ref: { kind: 'row', type: e.type, slot: e.slot, table, rowKey, index },
          cells: rc,
        });
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------ diff items
export type ItemKind = 'incoming' | 'collision';
/** field: one value; added / removed: a whole record (unit, row, issue ...) in the workbook but not the other side. */
export type ItemChange = 'field' | 'added' | 'removed' | 'restored';
export type Choice = 'wb' | 'app';

export interface DiffItem {
  id: string;
  recKey: string;
  ref: RecRef;
  kind: ItemKind;
  change: ItemChange;
  /** Field key inside the record (change 'field'). */
  cell?: string;
  group: string;
  groupTitle: string;
  groupOrder: number;
  section: string;
  label: string;
  base: Val;
  app: Val;
  wb: Val;
  /** A remark / comment / note (the "Accept all remarks" group action). */
  remark: boolean;
  /** Preselected choice: incoming changes are accepted, except removing a unit; collisions have none. */
  defaultChoice: Choice | null;
  note?: string;
}

export interface DiffResult {
  items: DiffItem[];
  /** 'three-way' with a baseline, 'two-way' without one (every difference is incoming). */
  mode: 'three-way' | 'two-way';
  counts: { incoming: number; collisions: number; equipmentAdded: number; remarks: number };
}

const PROJECT_LABELS: Record<string, string> = {
  name: 'Project name',
  tolerance: 'Airflow tolerance',
  'info.address': 'Physical address',
  'info.architect': 'Architect',
  'info.mechanicalEngineer': 'Mechanical engineer',
  'info.electricalEngineer': 'Electrical engineer',
  'info.generalContractor': 'General contractor',
  'info.mechanicalContractor': 'Mechanical contractor',
  'info.tabDate': 'TAB date',
  'info.technicians': 'Technician(s)',
  'info.projectManager': 'Project manager',
  'info.reportDate': 'Report date',
  'info.narrative': 'Narrative: system set-up description',
  ...Object.fromEntries(Object.entries(PRESSURE_LABELS).map(([k, v]) => [`info.${k}`, v])),
};
const INSTRUMENT_LABELS: Record<string, string> = {
  type: 'Type',
  manufacturer: 'Manufacturer',
  model: 'Model',
  serial: 'Serial',
  calibrationDate: 'Calibration date',
};
const ISSUE_LABELS: Record<string, string> = {
  remark: 'Remark',
  status: 'Status',
  comments: 'Comments',
  unit: 'Equipment',
};
const REMARK_UNIT_KEYS = new Set(['remarks', 'technicianNotes']);

interface FieldInfo {
  label: string;
  section: string;
}
function unitFieldInfo(spec: EquipmentSpec, key: string): FieldInfo {
  if (key === 'designation') return { label: 'Designation', section: spec.sections[0]?.label ?? 'Identity' };
  for (const s of spec.sections) {
    const f = s.fields.find((x) => x.key === key);
    if (f) return { label: f.label, section: s.label };
    for (const t of s.tables ?? [])
      if (key === `table:${t.key}`) return { label: `${t.label}: whole table`, section: s.label };
    for (const q of s.sequences ?? []) {
      if (key === `seq:${q.key}`) return { label: `${q.label}: all readings`, section: s.label };
      const m = new RegExp(`^${q.key}_(\\d+)$`).exec(key);
      if (m) return { label: `${q.label} #${m[1]}`, section: s.label };
    }
  }
  return { label: key, section: 'Other' };
}
function tableInfo(spec: EquipmentSpec, table: string): { label: string; section: string; col: (k: string) => string } {
  for (const s of spec.sections) {
    const t = s.tables?.find((x) => x.key === table);
    if (t) {
      const cols = t.columns ?? ROW_COLUMNS;
      return { label: t.label, section: s.label, col: (k) => cols.find((c) => c.key === k)?.label ?? k };
    }
  }
  return { label: table, section: 'Rows', col: (k) => k };
}

const TYPE_ORDER = new Map(EQUIPMENT_TYPES.map((t, i) => [t.key, i]));

/** A one-line summary of a record (added / removed items). */
function summary(rec: FlatRec | undefined): Val {
  if (!rec) return null;
  const vals = Object.entries(rec.cells)
    .filter(([k, v]) => v !== null && k !== 'status')
    .map(([, v]) => String(v));
  return vals.slice(0, 8).join(' · ') || '(empty)';
}

function sameCells(a: FlatRec, b: FlatRec): boolean {
  const keys = new Set([...Object.keys(a.cells), ...Object.keys(b.cells)]);
  return [...keys].every((k) => sameVal(a.cells[k] ?? null, b.cells[k] ?? null));
}

export interface DiffInput {
  /** Values of the export the workbook came from (null: none, two-way diff). */
  base: ProjectData | null;
  /** The project in the app now. */
  app: ProjectBundle;
  /** Values read from the re-imported workbook. */
  wb: ProjectData;
}

export interface DiffSides {
  base: ProjectBundle;
  app: ProjectBundle;
  wb: ProjectBundle;
}

export interface DiffFlats {
  base: Map<string, FlatRec>;
  app: Map<string, FlatRec>;
  wb: Map<string, FlatRec>;
}

export type FullDiff = DiffResult & { sides: DiffSides; flats: DiffFlats };

export function reimportDiff(input: DiffInput): FullDiff {
  const app = appSide(input.app).side;
  const wb = readSide(input.wb);
  const base = input.base ? readSide(input.base) : app;
  const modes = rowModes([base, app, wb]);
  const B = flatten(base, modes);
  const A = flatten(app, modes);
  const W = flatten(wb, modes);

  // group titles: the app's designation, else the workbook's
  const designation = (type: string, slot: number) =>
    (A.get(unitKey(type, slot))?.cells.designation ??
      W.get(unitKey(type, slot))?.cells.designation ??
      `${type} ${slot}`) as string;
  const place = (
    ref: RecRef,
  ): { group: string; groupTitle: string; groupOrder: number; section: string; spec?: EquipmentSpec } => {
    switch (ref.kind) {
      case 'project':
        return { group: 'project', groupTitle: 'Project information', groupOrder: 0, section: 'Project information' };
      case 'blueprint':
        return {
          group: 'project',
          groupTitle: 'Project information',
          groupOrder: 0,
          section: `Blueprint ${ref.index + 1}`,
        };
      case 'issue':
        return {
          group: 'issues',
          groupTitle: 'Issues / remarks',
          groupOrder: 2,
          section: `${ref.issueKind === 'new' ? 'Summary - New' : 'Summary - (E)'} #${ref.number}`,
        };
      case 'instrument':
        return {
          group: 'calibration',
          groupTitle: 'Calibration',
          groupOrder: 3,
          section: `Instrument ${ref.index + 1}`,
        };
      case 'unit':
      case 'row': {
        const spec = getSpec(ref.type);
        return {
          group: unitKey(ref.type, ref.slot),
          groupTitle: designation(ref.type, ref.slot),
          groupOrder: 10 + (TYPE_ORDER.get(ref.type) ?? 0) * 1000 + ref.slot,
          section: '',
          spec,
        };
      }
    }
  };

  const items: DiffItem[] = [];
  const unitPresence = new Set<string>(); // units added / removed as a whole: their rows are part of that item
  const keys = [...new Set([...B.keys(), ...A.keys(), ...W.keys()])];
  const isUnit = (k: string) => k.startsWith('unit:');
  const ordered = [...keys.filter(isUnit), ...keys.filter((k) => !isUnit(k))];

  for (const key of ordered) {
    const b = B.get(key);
    const a = A.get(key);
    const w = W.get(key);
    const rec = (w ?? a ?? b)!;
    const ref = rec.ref;
    if (ref.kind === 'row' && unitPresence.has(unitKey(ref.type, ref.slot))) continue;
    const where = place(ref);
    const recLabel = (): { label: string; section: string } => {
      switch (ref.kind) {
        case 'unit':
          return { label: designation(ref.type, ref.slot), section: equipmentType(ref.type).plural };
        case 'row': {
          const t = tableInfo(where.spec!, ref.table);
          const no = rec.cells.no;
          return { label: `${t.label} row ${no ?? ref.index + 1}`, section: t.section };
        }
        case 'issue':
          return { label: `Issue ${where.section}`, section: where.section };
        case 'instrument':
          return { label: where.section, section: where.section };
        case 'blueprint':
          return { label: where.section, section: 'Blueprints' };
        default:
          return { label: 'Project', section: where.section };
      }
    };
    const presence = (kind: ItemKind, change: ItemChange, note?: string) => {
      const { label, section } = recLabel();
      const isUnitRemoval = ref.kind === 'unit' && change === 'removed';
      items.push({
        id: `${key}|*`,
        recKey: key,
        ref,
        kind,
        change,
        ...where,
        section,
        label,
        base: summary(b),
        app: summary(a),
        wb: summary(w),
        remark: false,
        defaultChoice: kind === 'collision' ? null : isUnitRemoval ? 'app' : 'wb',
        note: isUnitRemoval ? 'Accepting deletes the unit, its rows and photos from the app.' : note,
      });
      if (ref.kind === 'unit') unitPresence.add(key);
    };

    if (!w && !b) continue; // only in the app (added after the export): stays
    if (w && !b && !a) {
      presence('incoming', 'added');
      continue;
    }
    if (!w && b) {
      if (!a) continue; // removed on both sides
      if (sameCells(a, b)) presence('incoming', 'removed');
      else presence('collision', 'removed', 'Removed in the workbook, changed in the app.');
      continue;
    }
    if (w && b && !a) {
      if (sameCells(w, b)) continue; // deleted in the app, untouched in the workbook: stays deleted
      presence('collision', 'restored', 'Deleted in the app, changed in the workbook.');
      continue;
    }
    // present in the workbook and the app (and maybe the base): value by value
    const bc = b?.cells ?? {};
    const ac = a!.cells;
    const wc = w!.cells;
    for (const cell of new Set([...Object.keys(bc), ...Object.keys(ac), ...Object.keys(wc)])) {
      const bv = bc[cell] ?? null;
      const av = ac[cell] ?? null;
      const wv = wc[cell] ?? null;
      if (sameVal(wv, bv)) continue;
      let kind: ItemKind;
      if (sameVal(av, bv)) kind = 'incoming';
      else if (sameVal(wv, av)) continue;
      else kind = 'collision';
      let info: FieldInfo;
      let remark = false;
      switch (ref.kind) {
        case 'project':
          info = { label: PROJECT_LABELS[cell] ?? cell, section: 'Project information' };
          remark = /^info\.bb(\w+Remarks|Notes)$/.test(cell);
          break;
        case 'blueprint':
          info = { label: cell === 'sheet' ? 'Sheet' : 'Revision date', section: where.section };
          break;
        case 'instrument':
          info = { label: INSTRUMENT_LABELS[cell] ?? cell, section: where.section };
          break;
        case 'issue':
          info = { label: ISSUE_LABELS[cell] ?? cell, section: where.section };
          remark = cell === 'remark' || cell === 'comments';
          break;
        case 'unit':
          info = unitFieldInfo(where.spec!, cell);
          remark = REMARK_UNIT_KEYS.has(cell);
          break;
        case 'row': {
          const t = tableInfo(where.spec!, ref.table);
          info = { label: `${t.label} ${rec.cells.no ?? `row ${ref.index + 1}`}: ${t.col(cell)}`, section: t.section };
          break;
        }
      }
      items.push({
        id: `${key}|${cell}`,
        recKey: key,
        ref,
        kind,
        change: 'field',
        cell,
        ...place(ref),
        ...(ref.kind === 'project' && cell === 'info.narrative'
          ? { group: 'narrative', groupTitle: 'Narrative', groupOrder: 1 }
          : {}),
        ...(ref.kind === 'project' && PRESSURE_INFO_KEYS.includes(cell.replace(/^info\./, ''))
          ? { group: 'pressures', groupTitle: 'Building pressures', groupOrder: 1 }
          : {}),
        section:
          ref.kind === 'project' && PRESSURE_INFO_KEYS.includes(cell.replace(/^info\./, ''))
            ? 'Building Balance'
            : info.section,
        label: info.label,
        base: bv,
        app: av,
        wb: wv,
        remark,
        defaultChoice: kind === 'incoming' ? 'wb' : null,
      });
    }
  }
  items.sort((x, y) => x.groupOrder - y.groupOrder || (x.group < y.group ? -1 : x.group > y.group ? 1 : 0));
  return {
    items,
    mode: input.base ? 'three-way' : 'two-way',
    counts: {
      incoming: items.filter((i) => i.kind === 'incoming').length,
      collisions: items.filter((i) => i.kind === 'collision').length,
      equipmentAdded: items.filter((i) => i.ref.kind === 'unit' && i.change === 'added').length,
      remarks: items.filter((i) => i.remark).length,
    },
    sides: { base, app, wb },
    flats: { base: B, app: A, wb: W },
  };
}

/** Display text of a value ("—" for blank). */
export function showVal(v: Val): string {
  if (v === null) return '—';
  return String(v);
}

export { unitKey };
