/**
 * The static pressure profile's readings, by component (template revision 08): the app stores the entering static
 * (`spEntering`) and the leaving static of each component under the component's own key (`spCoil`, `spFan`, `spHeat`
 * ...). A workbook lays them out by position (the components of the unit type, left to right):
 *
 *   revision 08    spLeaving1 ... 6 = UNIT_TYPE_COMPONENTS (airflow order, the fan mid-profile on RTU / DOAS / DHU)
 *   revision 05-07 spLeaving1 ... 5 = UNIT_TYPE_COMPONENTS_07 (Filter, Wheel / Core, Coil, Heat / Burner, Fan: the fan
 *                  last, the RTU / DOAS heat drawn before it)
 *
 * Projects entered before revision 08 hold the rev 05-07 positional keys; `fromPositional(..., '07')` reads them (and a
 * rev 05-07 workbook) into components. On an RTU / DOAS the old "Heat" slot was read at the fan inlet (the heat is
 * after the fan) and the old "Fan" slot is the discharge, past the heat: they become the reheat (or coil) and the heat
 * leaving statics. Pure.
 */
import { UNIT_TYPE_COMPONENTS, UNIT_TYPE_COMPONENTS_07 } from '@a2b/workbook/map';
import type { FieldValue, NaMark } from '../data/types';

/** Every component, in an order that is the airflow order of every unit type. */
export const SP_COMPONENTS = [
  'Filter',
  'Wheel',
  'Core',
  'Coil',
  'Desiccant',
  'Reheat',
  'Burner',
  'Fan',
  'Heat',
] as const;
export type SpComponent = (typeof SP_COMPONENTS)[number];

export const spKey = (c: SpComponent | string) => `sp${c}`;
export const SP_KEYS: readonly string[] = SP_COMPONENTS.map(spKey);
/** The positional keys of the workbook layouts (and of projects entered before revision 08). */
export const POSITIONAL_KEYS: readonly string[] = [1, 2, 3, 4, 5, 6].map((k) => `spLeaving${k}`);

export type SlotLayout = '07' | '08';

/** The unit type as the template's table names it (case-insensitive), or undefined. */
export function unitTypeKey(unitType: unknown): string | undefined {
  if (typeof unitType !== 'string') return undefined;
  const t = unitType.trim().toLowerCase();
  return Object.keys(UNIT_TYPE_COMPONENTS).find((k) => k.toLowerCase() === t);
}

/** The unit type's components (revision 08), in airflow order. */
export function componentsOf(unitType: unknown): SpComponent[] {
  const t = unitTypeKey(unitType);
  return t ? (UNIT_TYPE_COMPONENTS[t].filter((c): c is SpComponent => c !== null) as SpComponent[]) : [];
}

/** Whether the unit type's revision 05-07 strip drew the heat before the fan (now known to be after it). */
const HEAT_AFTER_FAN = new Set(['RTU', 'DOAS']);

/**
 * Component key of each position of a layout for a unit type (null: "—" or nothing there). `has(pos)` tells whether
 * the old layout has a reading (or mark) at a position: the rev 05-07 "Heat" slot (read at the fan inlet) goes to the
 * reheat when the coil has one of its own, else to the coil.
 */
function positionKeys(unitType: unknown, layout: SlotLayout, has: (pos: number) => boolean): (string | null)[] {
  const t = unitTypeKey(unitType) ?? (typeof unitType === 'string' ? unitType : '');
  if (layout === '08') return (UNIT_TYPE_COMPONENTS[t] ?? []).map((c) => (c ? spKey(c) : null));
  const old = UNIT_TYPE_COMPONENTS_07[t];
  if (!old) return [];
  return old.map((c) => {
    if (!c) return null;
    if (HEAT_AFTER_FAN.has(t)) {
      if (c === 'Heat') return has(old.indexOf('Coil') + 1) ? spKey('Reheat') : spKey('Coil');
      if (c === 'Fan') return spKey('Heat');
    }
    return spKey(c);
  });
}

/**
 * The component values of a layout's positional values (`get(k)` = position k's value, 1-based). Positions that map to
 * the same component (an old RTU's coil and fan-inlet slots, when the coil slot is empty) keep the one with a value.
 */
export function fromPositional<T>(
  unitType: unknown,
  layout: SlotLayout,
  get: (pos: number) => T | undefined,
): Record<string, T> {
  const has = (pos: number) => get(pos) !== undefined;
  const out: Record<string, T> = {};
  positionKeys(unitType, layout, has).forEach((key, i) => {
    const v = get(i + 1);
    if (key && v !== undefined && !(key in out)) out[key] = v;
  });
  return out;
}

/**
 * The positional values of a layout from the component values (`get(key)`). For the rev 05-07 layout an RTU / DOAS
 * fan-inlet slot ("Heat") takes the reheat's leaving static (blank when there is none: the strip passes the coil's
 * through), the fan slot the discharge (the heat's leaving static, else the fan's).
 */
export function toPositional<T>(
  unitType: unknown,
  layout: SlotLayout,
  get: (key: string) => T | undefined,
): Record<string, T> {
  const out: Record<string, T> = {};
  const t = unitTypeKey(unitType) ?? '';
  if (layout === '08') {
    positionKeys(t, '08', () => false).forEach((key, i) => {
      const v = key ? get(key) : undefined;
      if (v !== undefined) out[`spLeaving${i + 1}`] = v;
    });
    return out;
  }
  // a DHU (revision 08 only) is laid out as a DOAS: its desiccant wheel leaving static is the fan inlet
  const old = UNIT_TYPE_COMPONENTS_07[t === 'DHU' ? 'DOAS' : t];
  if (!old) return out;
  old.forEach((c, i) => {
    if (!c) return;
    let v: T | undefined;
    if (HEAT_AFTER_FAN.has(t) || t === 'DHU') {
      if (c === 'Heat') v = get(spKey('Reheat')) ?? (t === 'DHU' ? get(spKey('Desiccant')) : undefined);
      else if (c === 'Fan') v = get(spKey('Heat')) ?? get(spKey('Fan'));
      else if (c === 'Wheel' && t === 'DHU') v = undefined;
      else v = get(spKey(c));
    } else v = get(spKey(c));
    if (v !== undefined) out[`spLeaving${i + 1}`] = v;
  });
  return out;
}

const present = (v: FieldValue | undefined) => v !== undefined && v !== null && !(typeof v === 'string' && !v.trim());

/** A unit's data / N/A marks hold readings in the rev 05-07 positional keys (entered before revision 08). */
type Marks = Readonly<Record<string, NaMark | null | undefined>>;

export function hasLegacyStatic(data: Readonly<Record<string, FieldValue>>, marks: Marks): boolean {
  return [1, 2, 3, 4, 5].some((k) => present(data[`spLeaving${k}`]) || marks[`spLeaving${k}`] != null);
}

/**
 * A unit's readings and marks in component keys, from the rev 05-07 positional keys (which are dropped). A component
 * key that already has a value or mark keeps it. Returns the changes as field writes (`data.*` / `naState.fields.*`,
 * null = clear), or null when there is nothing to move.
 */
export function legacyStaticWrites(
  data: Readonly<Record<string, FieldValue>>,
  marks: Marks,
  /** The unit type (default: the unit's own; a block's preset when the data has none). */
  unitType: unknown = data.unitType,
): Record<string, unknown> | null {
  if (!hasLegacyStatic(data, marks)) return null;
  const val = (k: number) => (present(data[`spLeaving${k}`]) ? data[`spLeaving${k}`] : undefined);
  const mark = (k: number) => marks[`spLeaving${k}`] ?? undefined;
  // one mapping for values and marks: a slot "has" something when it holds either
  const either = (k: number) => (val(k) !== undefined || mark(k) !== undefined ? true : undefined);
  const keys = fromPositional(unitType, '07', (k) => (either(k) ? k : undefined));
  const out: Record<string, unknown> = {};
  const free = (key: string) => !present(data[key]) && marks[key] == null;
  for (const [key, pos] of Object.entries(keys)) {
    if (!free(key)) continue;
    const v = val(pos);
    const m = mark(pos);
    if (v !== undefined) out[`data.${key}`] = v;
    if (m !== undefined) out[`naState.fields.${key}`] = m;
  }
  // an old RTU / DOAS reading between the coil and the fan (both read) is the reheat's: the unit shows it
  if ('data.spReheat' in out || 'naState.fields.spReheat' in out) {
    if (!present(data.hasReheat)) out['data.hasReheat'] = 'Yes';
  }
  for (let k = 1; k <= 5; k++) {
    if (data[`spLeaving${k}`] !== undefined) out[`data.spLeaving${k}`] = null;
    if (marks[`spLeaving${k}`] != null) out[`naState.fields.spLeaving${k}`] = null;
  }
  return out;
}

/**
 * A unit with its rev 05-07 positional readings read into component keys (for code that reads a unit not yet moved:
 * a locked project, a unit not opened since revision 08). The unit itself is unchanged when there is nothing to move.
 */
export function withComponentStatic<
  U extends { data: Readonly<Record<string, FieldValue>>; naState: { fields: Marks } },
>(unit: U, unitType: unknown = unit.data.unitType): U {
  const w = legacyStaticWrites(unit.data, unit.naState.fields, unitType);
  if (!w) return unit;
  const data: Record<string, FieldValue> = { ...unit.data };
  const fields: Record<string, NaMark | null | undefined> = { ...unit.naState.fields };
  for (const [path, v] of Object.entries(w)) {
    if (path.startsWith('data.')) {
      const k = path.slice(5);
      if (v === null) delete data[k];
      else data[k] = v as FieldValue;
    } else {
      const k = path.slice('naState.fields.'.length);
      if (v === null) delete fields[k];
      else fields[k] = v as NaMark;
    }
  }
  return { ...unit, data, naState: { ...unit.naState, fields } };
}

/**
 * The components a unit's profile measures: the unit type's, less the filter on a unit without filters ("Unit has
 * filters?" No) and the reheat unless the unit has one ("Has reheat?" Yes).
 */
export function measuredComponents(values: Readonly<Record<string, FieldValue>>): SpComponent[] {
  return componentsOf(values.unitType).filter(
    (c) => !(c === 'Filter' && values.hasFilters === 'No') && !(c === 'Reheat' && values.hasReheat !== 'Yes'),
  );
}

export const THREE_POINT = '3-point';

/**
 * The taps of a 3-point profile: the entering static, the fan inlet (the leaving static of the last component before
 * the fan; the entering static when the fan is first) and the discharge (the last component's leaving static).
 * Null when the profile is not 3-point.
 */
export function threePointTaps(
  values: Readonly<Record<string, FieldValue>>,
): { fanInlet: SpComponent | null; discharge: SpComponent | null } | null {
  if (values.spTaps !== THREE_POINT) return null;
  const comps = measuredComponents(values);
  const fan = comps.indexOf('Fan');
  return { fanInlet: fan > 0 ? comps[fan - 1] : null, discharge: comps.length ? comps[comps.length - 1] : null };
}

/** A 3-point profile does not measure this component's leaving static. */
export function tapSkipped(component: string, values: Readonly<Record<string, FieldValue>>): boolean {
  const t = threePointTaps(values);
  if (!t) return false;
  return (
    measuredComponents(values).includes(component as SpComponent) &&
    component !== t.fanInlet &&
    component !== t.discharge
  );
}

/**
 * A workbook unit's positional leaving statics (and their marks) moved to component keys, in place: `layout` is the
 * workbook's (rev 05-07 or rev 08). Used by the import.
 */
export function readPositionalStatic(
  data: Record<string, FieldValue>,
  marks: Record<string, NaMark | null | undefined>,
  layout: SlotLayout,
  unitType: unknown,
): void {
  if (layout === '07') {
    const moved = withComponentStatic({ data, naState: { fields: marks } }, unitType);
    for (const k of Object.keys(data)) delete data[k];
    Object.assign(data, moved.data);
    for (const k of Object.keys(marks)) delete marks[k];
    Object.assign(marks, moved.naState.fields);
    return;
  }
  const val = (k: number) => (present(data[`spLeaving${k}`]) ? data[`spLeaving${k}`] : undefined);
  const mark = (k: number) => marks[`spLeaving${k}`] ?? undefined;
  const values = fromPositional(unitType, '08', val);
  const marked = fromPositional(unitType, '08', mark);
  for (let k = 1; k <= 6; k++) {
    delete data[`spLeaving${k}`];
    delete marks[`spLeaving${k}`];
  }
  Object.assign(data, values);
  Object.assign(marks, marked);
  if ((spKey('Reheat') in values || spKey('Reheat') in marked) && !present(data.hasReheat)) data.hasReheat = 'Yes';
}
