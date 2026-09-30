/**
 * Equipment schedule bulk import (pure): rows pasted from Excel / an engineer's schedule, a CSV / XLSX file, or the
 * {Equipment Data Entry} section of an existing TAB workbook -> units to create or update.
 *
 *   parseDelimited()  text -> grid (tab-separated when the text has tabs, else CSV with quotes)
 *   scheduleTargets() the fields a type's schedule can fill ({Equipment Data Entry} columns the app has a field for)
 *   autoMap()         column headers -> target field keys (by header text; the user can change every column)
 *   buildPreview()    grid + mapping -> one preview row per data row: normalized values, errors / warnings,
 *                     duplicate designations, create / update, the slot a new unit gets and capacity limits, the
 *                     row's scope (a scope / status column, "(E)" before the tag, or a "REMOVE AND CAP" /
 *                     "EXISTING TO REMAIN" anywhere in the row): removed units are skipped, existing ones flagged
 * Writing is repo.applyScheduleImport() (every value through setField).
 */
import type { Equipment, FieldValue } from '../data/types';
import { equipmentType, workbookDef, type EquipmentTypeKey } from './equipmentTypes';
import { allFields, getSpec } from './specs';
import { designationScope, scopeOf, type UnitScope } from './unitScope';

export type Grid = (string | number | null)[][];

// ------------------------------------------------------------------------------------------ parsing
/** Pasted text -> grid. Tab-separated (Excel copy) when the text has a tab, else comma-separated with quotes. */
export function parseDelimited(text: string): Grid {
  const src = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!src.trim()) return [];
  const sep = src.includes('\t') ? '\t' : src.includes(';') && !src.includes(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows
    .map((r) => Array.from({ length: width }, (_, j) => (r[j] ?? '').trim() || null))
    .filter((r) => r.some((c) => c !== null));
}

// ------------------------------------------------------------------------------------------ targets
export interface ScheduleTarget {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'phase' | 'select';
  options?: readonly (string | number)[];
  unit?: string;
}

/**
 * Types without an {Equipment Data Entry} section: the identity and design fields a schedule can fill (traverses:
 * duct; plant: design flows per water circuit; ultrasonic readings: design flow). Valve systems have none (their
 * valves are rows).
 */
const NO_EDE_KEYS: Partial<Record<EquipmentTypeKey, readonly string[]>> = {
  traverse: ['designation', 'areaServed', 'designCfm', 'shape', 'width', 'height', 'liner'],
  plant: [
    'designation',
    'plantType',
    'service',
    'manufacturer',
    'model',
    'circuit1',
    'designGpm1',
    'designDp1',
    'circuit2',
    'designGpm2',
    'designDp2',
  ],
  flowMeasurement: ['designation', 'system', 'location', 'pipeSize', 'pipeMaterial', 'designGpm'],
};

/** The fields a type's schedule import can fill, in {Equipment Data Entry} column order. */
export function scheduleTargets(type: EquipmentTypeKey): ScheduleTarget[] {
  const def = workbookDef(type);
  const fields = allFields(getSpec(type)).map((f) => f.field);
  const keys = def?.ede ? def.ede.fields.map((f) => f.key) : (NO_EDE_KEYS[type] ?? []);
  const out: ScheduleTarget[] = [];
  for (const key of keys) {
    const f = fields.find((x) => x.key === key);
    if (!f) continue; // in the workbook but not in the app (hood "KEF interlock", info only)
    const kind: ScheduleTarget['kind'] =
      key === 'phase' ? 'phase' : f.input === 'number' ? 'number' : f.input === 'select' ? 'select' : 'text';
    out.push({
      key,
      label: f.label,
      kind,
      ...(f.options ? { options: f.options } : {}),
      ...(f.unit ? { unit: f.unit } : {}),
    });
  }
  return out;
}

/** Not a field: the row's scope (new / existing / removed, domain/unitScope). */
export const SCOPE_TARGET: ScheduleTarget = { key: 'scope', label: 'Scope (new / existing / remove)', kind: 'text' };

/** What a schedule column can be mapped to: the type's fields and the scope. */
export const importTargets = (type: EquipmentTypeKey): ScheduleTarget[] => [...scheduleTargets(type), SCOPE_TARGET];

// ------------------------------------------------------------------------------------------ header mapping
/** Header words for each target field (normalized: lower case, punctuation -> spaces). Longest match wins. */
const SYNONYMS: Record<string, readonly string[]> = {
  designation: [
    'designation',
    'tag',
    'unit tag',
    'mark',
    'unit',
    'unit no',
    'unit id',
    'equipment',
    'equip',
    'id',
    'symbol',
    'name',
    'fan',
    'hood',
    'vav',
    'box',
    'box no',
    'terminal',
    'traverse',
    'point',
    'rtu',
    'mau',
    'erv',
    'ef',
  ],
  areaServed: ['area served', 'serves', 'serving', 'service', 'area', 'zone', 'room', 'rooms served', 'space'],
  location: ['location', 'loc', 'located'],
  manufacturer: ['manufacturer', 'mfr', 'mfg', 'manuf', 'make', 'brand', 'hood manufacturer'],
  model: ['model', 'model no', 'model number', 'model #'],
  hp: ['hp', 'motor hp', 'horsepower', 'motor horsepower', 'motor size', 'fan hp'],
  unitEsp: [
    'esp',
    'e s p',
    'ext sp',
    'external static',
    'external static pressure',
    'ext static',
    'static pressure',
    'unit esp',
    'sp',
    'static',
  ],
  fanRpm: ['rpm', 'fan rpm', 'fan speed'],
  motorSheave: ['motor sheave', 'sheave', 'drive sheave'],
  fanPulley: ['fan pulley', 'pulley', 'fan sheave', 'driven sheave'],
  belts: ['belt', 'belts', 'belt size', 'belt s'],
  cToC: ['c to c', 'c c', 'center to center', 'centers', 'ctc'],
  // ("v p": V-PH with its H misread by text recognition)
  voltage: [
    'voltage',
    'volts',
    'volt',
    'v',
    'electrical',
    'v ph hz',
    'v ph',
    'v p',
    'motor v ph',
    'volts ph hz',
    'elec',
    'power',
  ],
  phase: ['phase', 'ph', 'phases'],
  designTotalCfm: [
    'cfm',
    'total cfm',
    'supply cfm',
    'design cfm',
    'airflow',
    'sa cfm',
    'supply air',
    'supply airflow',
    'total airflow',
    'exhaust cfm',
    'design total cfm',
  ],
  designOaCfm: [
    'min outside air',
    'minimum outside air',
    'min outdoor air',
    'min osa',
    'design outside air',
    'oa cfm',
    'outside air',
    'outside air cfm',
    'oa',
    'min oa',
    'min oa cfm',
    'outdoor air',
    'ventilation',
    'oa airflow',
    'design oa cfm',
  ],
  designSupplyCfm: ['supply cfm', 'sa cfm', 'supply airflow', 'supply', 'cfm supply', 'design supply cfm'],
  designExhaustCfm: [
    'exhaust cfm',
    'ea cfm',
    'exhaust airflow',
    'exhaust',
    'cfm exhaust',
    'ra cfm',
    'design exhaust cfm',
  ],
  designSupplyDp: [
    'supply dp',
    'supply pd',
    'supply pressure drop',
    'sa dp',
    'supply esp',
    'supply sp',
    'design supply dp',
  ],
  designExhaustDp: [
    'exhaust dp',
    'exhaust pd',
    'exhaust pressure drop',
    'ea dp',
    'exhaust esp',
    'exhaust sp',
    'design exhaust dp',
  ],
  designCfm: ['cfm', 'design cfm', 'airflow', 'exhaust cfm', 'total cfm'],
  inletSize: ['inlet', 'inlet size', 'inlet dia', 'size', 'inlet diameter'],
  terminalType: ['type', 'terminal type', 'box type', 'unit type'],
  designMaxCfm: [
    'max cfm',
    'max',
    'maximum',
    'cooling max',
    'clg max',
    'max clg',
    'max cooling',
    'max cfm cooling',
    'primary max',
    'design max cfm',
  ],
  designMinCfm: ['min cfm', 'min', 'minimum', 'cooling min', 'clg min', 'min clg', 'primary min', 'design min cfm'],
  heatingCfm: ['heating cfm', 'htg cfm', 'heat cfm', 'htg', 'heating', 'heating max', 'htg max', 'design heating cfm'],
  fanCfm: ['fan cfm', 'fan airflow', 'fan', 'design fan cfm'],
  ddcAddress: ['ddc', 'ddc address', 'address', 'bacnet', 'bacnet address', 'controller', 'device id', 'ddc id'],
  lengthFt: ['length', 'len', 'hood length', 'length ft', 'size ft', 'lf'],
  shape: ['shape', 'duct shape'],
  width: ['width', 'w', 'diameter', 'dia', 'width or diameter'],
  height: ['height', 'h', 'depth'],
  liner: ['liner', 'liner thickness', 'lining'],
  // hydronic
  service: ['service', 'serves', 'serving'],
  system: ['system', 'sys', 'loop', 'piping system'],
  designGpm: ['gpm', 'flow', 'flow gpm', 'design gpm', 'design flow', 'capacity', 'capacity gpm', 'water flow'],
  designHead: ['head', 'tdh', 'total head', 'head ft', 'ft hd', 'total dynamic head', 'design head', 'pump head'],
  connectedLoadGpm: ['connected load', 'connected load gpm', 'connected gpm'],
  rpm: ['rpm', 'speed', 'pump rpm', 'motor rpm'],
  impeller: ['impeller', 'impeller dia', 'impeller size', 'imp dia', 'impeller diameter'],
  pumpType: ['pump type', 'type', 'drive', 'control'],
  scope: [
    'scope',
    'project scope',
    'status',
    'new existing',
    'new or existing',
    'new exist',
    'n e',
    'e n',
    'new',
    'existing',
    'disposition',
  ],
};

export const normalizeHeader = (h: string) =>
  h
    .toLowerCase()
    .replace(/[φΦø]/g, ' ph ')
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim();

/**
 * Words that name a field only when they are the whole header: inside a longer header they are a group heading
 * ("ELECTRICAL BHP", "ELECTRICAL V-PH") or too short to mean anything ("V").
 */
const WHOLE_HEADER_ONLY = new Set(['electrical', 'elec', 'power', 'v', 'unit', 'fan', 'service', 'supply', 'exhaust']);

/** Best target for one header: exact synonym match first, else the longest synonym contained as whole words. */
function headerScore(header: string, key: string): number {
  const h = ` ${normalizeHeader(header)} `;
  if (h.trim() === '') return 0;
  let best = 0;
  // a stacked header ("MOTOR HP", "ELECTRICAL (UNIT) ELEC."): its last part is the column's own label
  const words = h.trim().split(' ');
  for (let k = 1; k < words.length; k++) {
    const tail = words.slice(k).join(' ');
    if ((SYNONYMS[key] ?? []).includes(tail)) best = Math.max(best, 900 + tail.length);
  }
  for (const s of SYNONYMS[key] ?? []) {
    if (h.trim() === s) best = Math.max(best, 1000 + s.length);
    else if (s.length > 1 && !WHOLE_HEADER_ONLY.has(s) && h.includes(` ${s} `)) best = Math.max(best, s.length);
  }
  // the field's own label ("Design max CFM") is an exact match too
  return best;
}

/** Column -> target key (null: ignored), each target used at most once (the best-scoring column wins). */
export function autoMap(headers: readonly (string | number | null)[], type: EquipmentTypeKey): (string | null)[] {
  const targets = importTargets(type);
  const cands: { col: number; key: string; score: number }[] = [];
  headers.forEach((h, col) => {
    const text = h === null ? '' : String(h);
    for (const t of targets) {
      const score = Math.max(headerScore(text, t.key), normalizeHeader(text) === normalizeHeader(t.label) ? 2000 : 0);
      if (score > 0) cands.push({ col, key: t.key, score });
    }
  });
  cands.sort((a, b) => b.score - a.score || a.col - b.col);
  const out: (string | null)[] = headers.map(() => null);
  const used = new Set<string>();
  for (const c of cands) {
    if (out[c.col] !== null || used.has(c.key)) continue;
    out[c.col] = c.key;
    used.add(c.key);
  }
  return out;
}

/**
 * Whether the first row looks like headers: it maps at least 2 columns (1 for a single-column paste). A cell with a
 * digit ("RTU-1", "460/3/60") only counts when it is exactly a known header, so a data row is not taken for headers.
 */
export function looksLikeHeader(first: readonly (string | number | null)[], type: EquipmentTypeKey): boolean {
  if (first.some((c) => typeof c === 'number')) return false;
  const targets = importTargets(type);
  const exact = (text: string) =>
    targets.some(
      (t) =>
        normalizeHeader(text) === normalizeHeader(t.label) || (SYNONYMS[t.key] ?? []).includes(normalizeHeader(text)),
    );
  const candidates = first.map((c) => (typeof c === 'string' && (!/\d/.test(c) || exact(c)) ? c : null));
  const mapped = autoMap(candidates, type).filter(Boolean).length;
  return mapped >= Math.min(2, first.filter((c) => c !== null).length);
}

// ------------------------------------------------------------------------------------------ value normalization
const STANDARD_VOLTS = [115, 120, 200, 208, 220, 230, 240, 277, 380, 460, 480, 575, 600];

/** "1,200", "1200 CFM", "0.75 in. w.g.", "1/2", "1-1/2", "½" -> number; null when not a number. */
export function parseNumber(v: string | number | null): number | null {
  if (v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = v.trim().replace(/,/g, '').replace(/½/g, '1/2').replace(/¼/g, '1/4').replace(/¾/g, '3/4');
  s = s.replace(/\s*(cfm|hp|rpm|v|volts?|in\.?\s*w\.?\s*g\.?|in\.?|"|ft\.?|'|fpm|hz)\s*$/i, '').trim();
  let m = /^(\d+)\s*[- ]\s*(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2]);
  if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return Number(s);
  return null;
}

/** "3", "3ph", "three", "3Φ", "3-phase" -> "3-phase" (and the same for 1); null when not a phase. */
export function normalizePhase(v: string | number | null): '1-phase' | '3-phase' | null {
  if (v === null) return null;
  const s = String(v).toLowerCase().replace(/[φΦø]/g, 'ph').replace(/\s+/g, '');
  if (/^(1|1ph|1-?phase|single|singlephase|1p|one|onephase|sp)$/.test(s)) return '1-phase';
  if (/^(3|3ph|3-?phase|three|threephase|3p|poly|polyphase)$/.test(s)) return '3-phase';
  return null;
}

/** "460/3/60", "208-3-60", "115/1" -> volts and phase. */
export function splitElectrical(
  v: string | number | null,
): { volts: number; phase: '1-phase' | '3-phase' | null } | null {
  if (v === null || typeof v === 'number') return null;
  const m =
    /^\s*(\d{3})\s*(?:v|volts?)?\.?\s*[/\-x]\s*(\d)\s*(?:ph|phase)?\.?\s*(?:[/\-x]\s*(\d{2})\s*(?:hz)?\.?)?\s*$/i.exec(
      v,
    );
  if (!m) return null;
  return { volts: Number(m[1]), phase: normalizePhase(m[2]) };
}

// ------------------------------------------------------------------------------------------ preview
export interface PreviewRow {
  /** Row index in the source grid (0-based). */
  index: number;
  designation: string;
  values: Record<string, FieldValue>;
  errors: string[];
  warnings: string[];
  /** create a new unit, update the existing unit with this designation, or skip (errors). */
  action: 'create' | 'update' | 'skip';
  /** Slot the new unit gets (create) or has (update). */
  slot: number | null;
  existingId?: string;
  /** The schedule's scope for the row (null: not given, the import's default applies). Removed rows are skipped. */
  scope: UnitScope | null;
}

export interface Preview {
  type: EquipmentTypeKey;
  rows: PreviewRow[];
  create: number;
  update: number;
  skip: number;
  /** Rows skipped as removed / capped / demolished (out of scope). */
  removed: number;
  /** Rows the schedule marks existing. */
  existing: number;
  capacity: number;
  /** Units of this type after the import. */
  totalAfter: number;
  /** Warnings for the whole import (capacity, small fans past 30). */
  notes: string[];
}

export interface PreviewInput {
  type: EquipmentTypeKey;
  /** Data rows (without the header row). */
  rows: Grid;
  /** Column -> target key. */
  mapping: readonly (string | null)[];
  existing: readonly Pick<Equipment, 'id' | 'designation' | 'slot' | 'type'>[];
  /** Source row numbers for messages (default: index + 1). */
  rowNumber?: (i: number) => number | string;
  /** The scope of rows that give none themselves (the table's: "EXISTING FAN SCHEDULE"; unitScope tableScope). */
  rowScope?: (i: number) => UnitScope | null;
}

function convert(
  t: ScheduleTarget,
  raw: string | number,
  put: (k: string, v: FieldValue) => void,
  errors: string[],
  warnings: string[],
): void {
  const text = typeof raw === 'string' ? raw.trim() : raw;
  if (t.kind === 'number') {
    if (t.key === 'voltage') {
      const el = splitElectrical(text);
      if (el) {
        put('voltage', el.volts);
        if (el.phase) put('phase:fromVoltage', el.phase);
        return;
      }
    }
    let n = parseNumber(text);
    if (n === null && typeof text === 'string') {
      // two values in one cell ("1,380 & 2,000": two speeds, "1200/800"): the first, with a warning
      const parts = text.split(/\s*(?:&|\band\b|\/|;)\s*/i).map((x) => parseNumber(x));
      if (parts.length > 1 && parts.every((x) => x !== null)) {
        n = parts[0];
        warnings.push(`${t.label}: "${text}" has ${parts.length} values; the first (${n}) is used`);
      }
    }
    if (n === null) {
      errors.push(`${t.label}: "${text}" is not a number`);
      return;
    }
    if (n < 0 && t.key !== 'unitEsp') warnings.push(`${t.label}: negative value ${n}`);
    if (t.key === 'voltage' && !STANDARD_VOLTS.includes(n))
      warnings.push(`Voltage ${n} V is not a standard voltage (${STANDARD_VOLTS.join(', ')})`);
    put(t.key, n);
    return;
  }
  if (t.kind === 'phase') {
    const p = normalizePhase(text);
    if (!p) errors.push(`Phase: "${text}" is not 1-phase or 3-phase`);
    else put('phase', p);
    return;
  }
  if (t.kind === 'select') {
    const opts = t.options ?? [];
    const hit = opts.find((o) => String(o).toLowerCase() === String(text).toLowerCase());
    const prefix = hit ?? opts.find((o) => String(o).toLowerCase().startsWith(String(text).toLowerCase().slice(0, 3)));
    if (prefix === undefined) errors.push(`${t.label}: "${text}" is not one of ${opts.join(', ')}`);
    else put(t.key, prefix);
    return;
  }
  put(t.key, String(text));
}

/** A cell with nothing in it: empty, or the schedule's "none" ("-", "--", "—"). */
export const isBlankCell = (v: string | number | null | undefined): boolean =>
  v === null || v === undefined || (typeof v === 'string' && /^[\s\-—–_.]*$/.test(v));

/** Designation key for duplicate checks: case-insensitive, spaces ignored ("vav 12" == "VAV-12" is NOT assumed). */
export const designationKey = (d: string) => d.trim().toLowerCase().replace(/\s+/g, '');

export function buildPreview(input: PreviewInput): Preview {
  const { type } = input;
  const info = equipmentType(type);
  const targets = new Map(scheduleTargets(type).map((t) => [t.key, t]));
  const scopeCol = input.mapping.indexOf('scope');
  const existingByKey = new Map(
    input.existing.filter((e) => e.type === type).map((e) => [designationKey(e.designation), e]),
  );
  const usedSlots = new Set(input.existing.filter((e) => e.type === type).map((e) => e.slot));
  const seen = new Map<string, number>();
  const rowNo = input.rowNumber ?? ((i: number): number | string => i + 1);
  const out: PreviewRow[] = [];
  const notes: string[] = [];
  let nextSlotFrom = 1;
  const nextSlot = (): number | null => {
    for (let s = nextSlotFrom; s <= info.capacity; s++) {
      if (!usedSlots.has(s)) {
        nextSlotFrom = s + 1;
        usedSlots.add(s);
        return s;
      }
    }
    return null;
  };
  let overCapacity = 0;

  input.rows.forEach((cells, index) => {
    const values: Record<string, FieldValue> = {};
    const errors: string[] = [];
    const warnings: string[] = [];
    let phaseFromVoltage: FieldValue = null;
    const put = (k: string, v: FieldValue) => {
      if (k === 'phase:fromVoltage') phaseFromVoltage = v;
      else values[k] = v;
    };
    // the row's scope: its scope column, "(E)" before the tag, else a plain phrase in any cell
    const tagCol = input.mapping.indexOf('designation');
    const tagCell = tagCol >= 0 ? cells[tagCol] : null;
    const tag = typeof tagCell === 'string' ? designationScope(tagCell) : null;
    let scope: UnitScope | null = scopeCol >= 0 ? scopeOf(cells[scopeCol], 'column') : null;
    if (scopeCol >= 0 && scope === null && cells[scopeCol] !== null && String(cells[scopeCol]).trim())
      warnings.push(`Scope: "${String(cells[scopeCol])}" is not new, existing or remove`);
    scope ??= tag?.scope ?? null;
    let removedBy = '';
    for (const c of cells) {
      const s = scopeOf(c, 'cell');
      if (s === 'removed' && scope !== 'new') {
        scope = 'removed';
        removedBy = String(c);
      } else if (s === 'existing' && scope === null) scope = 'existing';
    }
    scope ??= input.rowScope?.(index) ?? null;
    if (scope === 'removed') {
      const d = (tag?.designation ?? String(tagCell ?? '')).trim();
      const why = removedBy || (scopeCol >= 0 ? String(cells[scopeCol] ?? '') : '') || 'removed';
      out.push({
        index,
        designation: d,
        values: {},
        errors: [],
        warnings: [`Removed (${why.trim()}): not in the scope, not imported`],
        action: 'skip',
        slot: null,
        scope,
      });
      return;
    }
    input.mapping.forEach((key, col) => {
      if (!key || key === 'scope') return;
      const t = targets.get(key);
      const raw = key === 'designation' && tag ? tag.designation : cells[col];
      if (!t || raw === null || raw === undefined || isBlankCell(raw)) return;
      convert(t, raw, put, errors, warnings);
    });
    if (phaseFromVoltage && targets.has('phase')) {
      if (values.phase === undefined) values.phase = phaseFromVoltage;
      else if (values.phase !== phaseFromVoltage)
        warnings.push(`Phase ${String(values.phase)} differs from the electrical data (${String(phaseFromVoltage)})`);
    }
    const designation = typeof values.designation === 'string' ? values.designation.trim() : '';
    delete values.designation;
    const row: PreviewRow = { index, designation, values, errors, warnings, action: 'skip', slot: null, scope };
    out.push(row);
    if (!designation) {
      errors.unshift('No designation');
      return;
    }
    // a note row inside the table ("NOTES SHOWN FOR REFERENCE ONLY. ALL EQUIPMENT IS EXISTING TO REMAIN.")
    if (designation.split(/\s+/).length >= 4 && !Object.keys(values).length) {
      row.errors = [];
      row.warnings = ['A note, not a unit'];
      return;
    }
    const key = designationKey(designation);
    if (seen.has(key)) {
      errors.unshift(`Duplicate: ${designation} is also in row ${rowNo(seen.get(key)!)}`);
      return;
    }
    seen.set(key, index);
    if (errors.length) return;
    if (!Object.keys(values).length) warnings.push('Only a designation: nothing else to fill');
    const hit = existingByKey.get(key);
    if (hit) {
      row.action = 'update';
      row.slot = hit.slot;
      row.existingId = hit.id;
      return;
    }
    const slot = nextSlot();
    if (slot === null) {
      overCapacity++;
      errors.push(`Over capacity: the workbook has room for ${info.capacity} ${info.plural}`);
      return;
    }
    row.action = 'create';
    row.slot = slot;
    if (info.warnAbove && slot > info.warnAbove)
      warnings.push(
        `Slot ${slot}: Building Balance lists ${info.plural.toLowerCase()} 1–${info.warnAbove} only (left out of the exhaust total)`,
      );
  });

  const create = out.filter((r) => r.action === 'create').length;
  const update = out.filter((r) => r.action === 'update').length;
  const totalAfter = input.existing.filter((e) => e.type === type).length + create;
  if (overCapacity)
    notes.push(
      `${overCapacity} row${overCapacity > 1 ? 's' : ''} over capacity: the workbook has room for ${info.capacity} ${info.plural}.`,
    );
  if (info.warnAbove && totalAfter > info.warnAbove)
    notes.push(
      `${totalAfter} ${info.plural.toLowerCase()} after the import: Building Balance lists 1–${info.warnAbove} only.`,
    );
  return {
    type,
    rows: out,
    create,
    update,
    skip: out.length - create - update,
    removed: out.filter((r) => r.scope === 'removed').length,
    existing: out.filter((r) => r.scope === 'existing' && r.action !== 'skip').length,
    capacity: info.capacity,
    totalAfter,
    notes,
  };
}

/** A workbook's EDE rows (readScheduleSection) as a grid + mapping for buildPreview (keys are the columns). */
export function scheduleRowsToGrid(
  type: EquipmentTypeKey,
  rows: readonly { values: Record<string, string | number> }[],
): { grid: Grid; mapping: (string | null)[] } {
  const keys = scheduleTargets(type).map((t) => t.key);
  return {
    grid: rows.map((r) => keys.map((k) => r.values[k] ?? null)),
    mapping: keys,
  };
}
