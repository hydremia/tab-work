/**
 * Completion engine: pure functions that turn a unit's values, N/A marks, airflow rows, photos and the project's
 * scope / tolerance into a status color (docs/REQUIRED_FIELDS.md):
 *   gray  = nothing entered            amber = required field(s) still blank
 *   green = every required item filled or N/A      red = linked open issue, or a reading out of tolerance
 * N/A comes from four levels: project scope profile, section, field (explicit marks) and automatic rules.
 */
import type { FieldValue, NaMark, NaState, Notation, Project } from '../data/types';
import { num, ratio, rowActualCfm, withinTolerance } from './calc';
import { evalCond, isBlank } from './conditions';
import { TOTAL_CALCS } from './equipmentCalcs';
import {
  DEFAULT_READING_GROUPS,
  designChecks,
  seqKey,
  tableColumns,
  type AutoNa,
  type EquipmentSpec,
  type FieldSpec,
  type RowTableSpec,
  type SectionSpec,
  type SequenceSpec,
} from './specs/types';

export type StatusColor = 'gray' | 'amber' | 'green' | 'red';
/**
 * What cards and rollups show: the completion color, or blue = complete and reviewed (signed off). Blue is never
 * computed by the engine; it is a green unit with a review (`displayColor`). A reviewed unit that is not green any
 * more (e.g. an issue was opened on it) shows its real color.
 */
export type DisplayColor = StatusColor | 'blue';

export const STATUS_LABEL: Record<DisplayColor, string> = {
  gray: 'Not started',
  amber: 'In progress',
  green: 'Complete',
  red: 'Issue / tolerance',
  blue: 'Reviewed',
};

export const displayColor = (color: StatusColor, reviewed: boolean): DisplayColor =>
  color === 'green' && reviewed ? 'blue' : color;

export type ItemState =
  'value' | 'na' | 'auto-na' | 'section-na' | 'equipment-na' | 'scope-na' | 'optional' | 'missing';

export const isSatisfied = (s: ItemState) => s !== 'missing' && s !== 'optional';
export const isNaState = (s: ItemState) => s.endsWith('na');

export interface ItemResult {
  state: ItemState;
  notation?: Notation;
  reason?: string;
  /** Automatic N/A the export leaves blank (see AutoNa.exportBlank). */
  exportBlank?: boolean;
}

export interface RowResult {
  missing: string[];
  /** Columns that are automatically N/A on this row, with the reason. */
  auto: Record<string, string>;
  ratio: number | null;
  outOfTolerance: boolean;
  /** Design CFM used for the ratio (computed for the first return row). */
  design: number | null;
}

export interface TableResult extends ItemResult {
  rows: Record<string, RowResult>;
  /** Automatic N/A that overrides entered rows (they are kept but not counted or exported). */
  forced?: boolean;
}

export interface SequenceResult extends ItemResult {
  /** Readings entered (values or per-reading N/A marks). */
  entered: number;
}

export interface SectionResult {
  key: string;
  label: string;
  /** na: the whole section is N/A; complete / incomplete; empty: nothing required. */
  state: 'na' | 'complete' | 'incomplete' | 'empty';
  naSource?: 'section' | 'equipment' | 'scope';
  notation?: Notation;
  required: number;
  satisfied: number;
}

export interface MissingItem {
  section: string;
  key: string;
  label: string;
}

export interface ToleranceFlag {
  table: string;
  rowId: string;
  label: string;
  ratio: number;
}

export interface Completion {
  color: StatusColor;
  label: string;
  started: boolean;
  required: number;
  satisfied: number;
  missing: MissingItem[];
  outOfTolerance: ToleranceFlag[];
  openIssues: number;
  sections: Record<string, SectionResult>;
  fields: Record<string, ItemResult>;
  tables: Record<string, TableResult>;
  photos: Record<string, ItemResult>;
  sequences: Record<string, SequenceResult>;
  /** R8: schedule design CFM differs from the sum of the outlet design CFMs (first check). */
  designDiscrepancy?: { schedule: number; outlets: number };
  /** Every R8 discrepancy (ERVs check supply and exhaust). */
  designDiscrepancies: { label: string; field: string; table: string; schedule: number; outlets: number }[];
  /** Unit-level actual / design (MAU method total, hood total, traverse CFM). */
  total?: { label: string; design: number | null; actual: number | null; ratio: number | null };
}

export interface CompletionInput {
  spec: EquipmentSpec;
  unit: { designation: string; data: Readonly<Record<string, FieldValue>>; naState: NaState };
  rows: readonly {
    id: string;
    table: string;
    order: number;
    data: Readonly<Record<string, FieldValue>>;
    na: Readonly<Record<string, NaMark | null>>;
  }[];
  photos: readonly { category: string }[];
  project: Pick<Project, 'scopeProfile' | 'customScope' | 'tolerance'>;
  openIssues: number;
}

/** naState.fields key used for a photo slot's N/A mark. */
export const photoNaKey = (category: string) => `photo:${category}`;
/** naState.fields key used for an airflow table's N/A mark. */
export const tableNaKey = (table: string) => `table:${table}`;
/** naState.fields key used for a whole reading sequence's N/A mark (per-reading marks use seqKey). */
export const seqNaKey = (key: string) => `seq:${key}`;

function firstAuto(auto: readonly AutoNa[] | undefined, values: Readonly<Record<string, FieldValue>>) {
  return auto?.find((a) => evalCond(a.when, values));
}
/** An automatic N/A that applies even over an entered value. */
function forcedAuto(auto: readonly AutoNa[] | undefined, values: Readonly<Record<string, FieldValue>>) {
  return auto?.find((a) => a.overridesValue && evalCond(a.when, values));
}

export function computeCompletion(input: CompletionInput): Completion {
  const { spec, unit, project } = input;
  const values: Record<string, FieldValue> = { ...unit.data, designation: unit.designation };
  const na = unit.naState;
  const res: Completion = {
    color: 'gray',
    label: '',
    started: false,
    required: 0,
    satisfied: 0,
    missing: [],
    outOfTolerance: [],
    openIssues: input.openIssues,
    sections: {},
    fields: {},
    tables: {},
    photos: {},
    sequences: {},
    designDiscrepancies: [],
  };

  /** N/A for a whole section, from the section, equipment or scope level. */
  const sectionNa = (
    s: SectionSpec,
    airflowRequired: boolean,
  ): { source: 'section' | 'equipment' | 'scope'; notation?: Notation } | null => {
    if (na.equipment) return { source: 'equipment', notation: na.equipment.notation };
    if (s.locked) return null;
    const mark = na.sections[s.key];
    if (mark && mark !== 'applies') return { source: 'section', notation: mark.notation };
    if (mark === 'applies') return null; // overrides the scope profile
    if (project.scopeProfile === 'airflow' && !airflowRequired) return { source: 'scope' };
    if (project.scopeProfile === 'custom' && project.customScope[spec.type]?.[s.key] === false)
      return { source: 'scope' };
    return null;
  };

  const levelState = (src: 'section' | 'equipment' | 'scope'): ItemState =>
    src === 'section' ? 'section-na' : src === 'equipment' ? 'equipment-na' : 'scope-na';

  const fieldResult = (s: SectionSpec, f: FieldSpec): ItemResult => {
    const forced = forcedAuto(f.autoNa, values);
    if (forced) return { state: 'auto-na', notation: 'N/A', reason: forced.reason };
    if (!isBlank(values[f.key])) return { state: 'value' };
    const mark = na.fields[f.key];
    if (mark) return { state: 'na', notation: mark.notation, reason: mark.reason };
    const auto = firstAuto(f.autoNa, values);
    if (auto)
      return {
        state: 'auto-na',
        notation: 'N/A',
        reason: auto.reason,
        ...(auto.exportBlank ? { exportBlank: true } : {}),
      };
    if (f.recordField !== 'designation') {
      const sn = sectionNa(s, f.airflow ?? s.airflow);
      if (sn) return { state: levelState(sn.source), notation: sn.notation ?? 'N/A' };
    }
    const required = f.requiredWhen ? evalCond(f.requiredWhen, values) : f.required !== false;
    return { state: required ? 'missing' : 'optional' };
  };

  // started: anything entered beyond the designation and template presets
  const presets = new Map(
    spec.sections.flatMap((s) => s.fields.filter((f) => f.preset !== undefined).map((f) => [f.key, f.preset])),
  );
  res.started =
    Object.entries(unit.data).some(([k, v]) => !isBlank(v) && presets.get(k) !== v) ||
    input.rows.length > 0 ||
    input.photos.length > 0 ||
    Boolean(na.equipment) ||
    Object.values(na.sections).some((m) => m && m !== 'applies') ||
    Object.values(na.fields).some(Boolean);

  const tableRowsOf = (key: string) => input.rows.filter((r) => r.table === key).sort((a, b) => a.order - b.order);
  const designSum = (key: string) => tableRowsOf(key).reduce((t, r) => t + (num(r.data.designCfm) ?? 0), 0);

  for (const s of spec.sections) {
    const sr: SectionResult = { key: s.key, label: s.label, state: 'empty', required: 0, satisfied: 0 };
    const whole = sectionNa(s, s.airflow);
    // Airflow Only can leave some fields of a section required (e.g. design CFM): then it is not N/A as a whole
    // (Custom switches a section off as a whole)
    const partialScope =
      whole?.source === 'scope' && project.scopeProfile === 'airflow' && s.fields.some((f) => f.airflow ?? s.airflow);
    if (whole && !partialScope) {
      sr.naSource = whole.source;
      sr.notation = whole.notation;
    }
    const count = (key: string, label: string, r: ItemResult) => {
      if (r.state === 'optional') return;
      sr.required++;
      if (isSatisfied(r.state)) sr.satisfied++;
      else res.missing.push({ section: s.key, key, label });
    };

    for (const f of s.fields) {
      const r = fieldResult(s, f);
      res.fields[f.key] = r;
      count(f.key, f.label, r);
    }

    for (const t of s.tables ?? []) {
      const tr = tableResult(s, t);
      res.tables[t.key] = tr;
      if (tr.state === 'optional' || isNaState(tr.state)) {
        if (isNaState(tr.state)) count(t.key, t.label, tr);
        if (tr.state === 'optional') {
          // optional tables: rows that exist must still be complete
          for (const [rowId, rr] of Object.entries(tr.rows)) {
            sr.required++;
            if (rr.missing.length)
              res.missing.push({ section: s.key, key: `${t.key}:${rowId}`, label: `${t.label}: incomplete row` });
            else sr.satisfied++;
          }
        }
        continue;
      }
      const rows = tableRowsOf(t.key);
      const minRows = t.minRows ?? 1;
      sr.required++;
      if (rows.length >= minRows) sr.satisfied++;
      else
        res.missing.push({
          section: s.key,
          key: t.key,
          label: `${t.label}: at least ${minRows} row${minRows > 1 ? 's' : ''}`,
        });
      for (const [rowId, rr] of Object.entries(tr.rows)) {
        sr.required++;
        if (rr.missing.length)
          res.missing.push({ section: s.key, key: `${t.key}:${rowId}`, label: `${t.label}: incomplete row` });
        else sr.satisfied++;
      }
    }

    for (const q of s.sequences ?? []) {
      const r = sequenceResult(s, q);
      res.sequences[q.key] = r;
      count(seqNaKey(q.key), q.label, r);
    }

    for (const p of s.photos ?? []) {
      let r: ItemResult;
      const mark = na.fields[photoNaKey(p.category)];
      const auto = firstAuto(p.autoNa, values);
      const sn = sectionNa(s, s.airflow);
      if (input.photos.some((x) => x.category === p.category)) r = { state: 'value' };
      else if (mark) r = { state: 'na', notation: mark.notation, reason: mark.reason };
      else if (auto) r = { state: 'auto-na', notation: 'N/A', reason: auto.reason };
      else if (sn) r = { state: levelState(sn.source), notation: sn.notation ?? 'N/A' };
      else r = { state: 'missing' };
      res.photos[p.category] = r;
      count(photoNaKey(p.category), `${p.label} photo`, r);
    }

    if (sr.required === 0) sr.state = sr.naSource ? 'na' : 'empty';
    else if (sr.satisfied === sr.required) sr.state = sr.naSource ? 'na' : 'complete';
    else sr.state = 'incomplete';
    res.sections[s.key] = sr;
    res.required += sr.required;
    res.satisfied += sr.satisfied;
  }

  function tableResult(s: SectionSpec, t: RowTableSpec): TableResult {
    const rows = tableRowsOf(t.key);
    const out: TableResult = { state: 'value', rows: {} };
    const mark = na.fields[tableNaKey(t.key)];
    const forced = forcedAuto(t.autoNa, values);
    const auto = firstAuto(t.autoNa, values);
    const sn = sectionNa(s, s.airflow);
    if (forced) return { state: 'auto-na', notation: 'N/A', reason: forced.reason, rows: {}, forced: true };
    if (mark) Object.assign(out, { state: 'na', notation: mark.notation, reason: mark.reason });
    else if (auto) Object.assign(out, { state: 'auto-na', notation: 'N/A', reason: auto.reason });
    else if (sn) Object.assign(out, { state: levelState(sn.source), notation: sn.notation ?? 'N/A' });
    else if (!(t.requiredWhen ? evalCond(t.requiredWhen, values) : t.required)) out.state = 'optional';
    if (isNaState(out.state)) return out;
    const cols = tableColumns(t);
    const groups = t.readingGroups ?? DEFAULT_READING_GROUPS;
    const readingCols = new Set(groups.flat());
    const outlet = (t.calc ?? 'outlet') === 'outlet';
    rows.forEach((r, i) => {
      const computedDesign = t.firstRowDesignComputed && i === 0;
      const rowValues = { ...values, ...r.data };
      const autoCols: Record<string, string> = {};
      for (const col of cols) {
        const a = isBlank(r.data[col.key]) ? firstAuto(col.autoNa, rowValues) : undefined;
        if (a) autoCols[col.key] = a.reason;
      }
      const ok = (k: string) => !isBlank(r.data[k]) || Boolean(r.na[k]) || k in autoCols;
      const missing: string[] = [];
      for (const col of cols) {
        if (readingCols.has(col.key) || col.required === false) continue;
        if (computedDesign && col.key === 'designCfm') continue;
        if (!ok(col.key)) missing.push(col.key);
      }
      if (groups.length && !groups.some((g) => g.every(ok))) missing.push('reading');
      // first return row: design = supply design total - OA design (workbook formula)
      const design = !outlet ? null : computedDesign ? designSum('supply') - designSum('oa') : num(r.data.designCfm);
      const rt = outlet ? ratio(rowActualCfm(r), design) : null;
      const out_ = t.tolerance && rt !== null && !withinTolerance(rt, project.tolerance);
      out.rows[r.id] = { missing, auto: autoCols, ratio: rt, outOfTolerance: out_, design };
      if (out_) {
        const no = isBlank(r.data.no) ? `row ${i + 1}` : String(r.data.no);
        res.outOfTolerance.push({ table: t.key, rowId: r.id, label: `${t.label} ${no}`, ratio: rt });
      }
    });
    return out;
  }

  function sequenceResult(s: SectionSpec, q: SequenceSpec): SequenceResult {
    const forced = forcedAuto(q.autoNa, values);
    if (forced) return { state: 'auto-na', notation: 'N/A', reason: forced.reason, entered: 0 };
    let entered = 0;
    for (let i = 1; i <= q.count; i++) {
      const k = seqKey(q.key, i);
      if (!isBlank(values[k]) || na.fields[k]) entered++;
    }
    if (entered >= (q.minReadings ?? 1)) return { state: 'value', entered };
    const mark = na.fields[seqNaKey(q.key)];
    if (mark) return { state: 'na', notation: mark.notation, reason: mark.reason, entered };
    const auto = firstAuto(q.autoNa, values);
    if (auto) return { state: 'auto-na', notation: 'N/A', reason: auto.reason, entered };
    const sn = sectionNa(s, s.airflow);
    if (sn) return { state: levelState(sn.source), notation: sn.notation ?? 'N/A', entered };
    const required = q.requiredWhen ? evalCond(q.requiredWhen, values) : q.required !== false;
    return { state: required ? 'missing' : 'optional', entered };
  }

  for (const dc of designChecks(spec)) {
    const schedule = num(unit.data[dc.field]);
    const outlets = designSum(dc.table);
    if (schedule !== null && schedule > 0 && outlets > 0 && Math.abs(schedule - outlets) > 0.5) {
      res.designDiscrepancies.push({
        label: dc.label ?? 'outlets',
        field: dc.field,
        table: dc.table,
        schedule,
        outlets,
      });
    }
  }
  if (res.designDiscrepancies[0]) {
    const { schedule, outlets } = res.designDiscrepancies[0];
    res.designDiscrepancy = { schedule, outlets };
  }

  // unit-level actual vs. design (types without per-outlet tolerance rows)
  if (spec.totalCheck && !na.equipment) {
    const t = TOTAL_CALCS[spec.totalCheck.calc](values, input.rows);
    const rt = ratio(t.actual, t.design);
    res.total = { label: spec.totalCheck.label, design: t.design, actual: t.actual, ratio: rt };
    if (rt !== null && !withinTolerance(rt, project.tolerance)) {
      res.outOfTolerance.push({ table: 'total', rowId: '', label: spec.totalCheck.label, ratio: rt });
    }
  }

  if (res.openIssues > 0 || res.outOfTolerance.length > 0) res.color = 'red';
  else if (!res.started) res.color = 'gray';
  else if (res.missing.length === 0) res.color = 'green';
  else res.color = 'amber';
  res.label = STATUS_LABEL[res.color];
  if (res.color === 'green' && na.equipment) res.label = `Complete (${na.equipment.notation})`;
  return res;
}

// ------------------------------------------------------------------------------------------ rollups
export interface Rollup {
  total: number;
  gray: number;
  amber: number;
  /** Complete units, reviewed ones included. */
  green: number;
  red: number;
  /** Complete and reviewed (blue); a subset of `green`. */
  reviewed: number;
}

export function rollup(colors: readonly DisplayColor[]): Rollup {
  const r: Rollup = { total: colors.length, gray: 0, amber: 0, green: 0, red: 0, reviewed: 0 };
  for (const c of colors) {
    if (c === 'blue') {
      r.green++;
      r.reviewed++;
    } else r[c]++;
  }
  return r;
}

/** "5/8 complete, 3 reviewed" (the reviewed part only when there is one). */
export const rollupText = (r: Rollup) =>
  `${r.green}/${r.total} complete${r.reviewed ? `, ${r.reviewed} reviewed` : ''}`;

/** Fraction complete for progress bars (green incl. reviewed). */
export const completeFraction = (r: Rollup) => (r.total ? r.green / r.total : 0);
