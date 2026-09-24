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
import {
  ROW_READINGS,
  ROW_REQUIRED,
  type AutoNa,
  type EquipmentSpec,
  type FieldSpec,
  type RowTableSpec,
  type SectionSpec,
} from './specs/types';

export type StatusColor = 'gray' | 'amber' | 'green' | 'red';

export const STATUS_LABEL: Record<StatusColor, string> = {
  gray: 'Not started',
  amber: 'In progress',
  green: 'Complete',
  red: 'Needs attention',
};

export type ItemState =
  'value' | 'na' | 'auto-na' | 'section-na' | 'equipment-na' | 'scope-na' | 'optional' | 'missing';

export const isSatisfied = (s: ItemState) => s !== 'missing' && s !== 'optional';
export const isNaState = (s: ItemState) => s.endsWith('na');

export interface ItemResult {
  state: ItemState;
  notation?: Notation;
  reason?: string;
}

export interface RowResult {
  missing: string[];
  ratio: number | null;
  outOfTolerance: boolean;
  /** Design CFM used for the ratio (computed for the first return row). */
  design: number | null;
}

export interface TableResult extends ItemResult {
  rows: Record<string, RowResult>;
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
  /** R8: schedule design CFM differs from the sum of the outlet design CFMs. */
  designDiscrepancy?: { schedule: number; outlets: number };
  /** The type's full form is not built yet, so the unit can't turn green. */
  formIncomplete: boolean;
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

function firstAuto(auto: readonly AutoNa[] | undefined, values: Readonly<Record<string, FieldValue>>) {
  return auto?.find((a) => evalCond(a.when, values));
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
    formIncomplete: !spec.formComplete,
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
    if (!isBlank(values[f.key])) return { state: 'value' };
    const mark = na.fields[f.key];
    if (mark) return { state: 'na', notation: mark.notation, reason: mark.reason };
    const auto = firstAuto(f.autoNa, values);
    if (auto) return { state: 'auto-na', notation: 'N/A', reason: auto.reason };
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
    const partialScope = whole?.source === 'scope' && s.fields.some((f) => f.airflow ?? s.airflow);
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
    const auto = firstAuto(t.autoNa, values);
    const sn = sectionNa(s, s.airflow);
    if (mark) Object.assign(out, { state: 'na', notation: mark.notation, reason: mark.reason });
    else if (auto) Object.assign(out, { state: 'auto-na', notation: 'N/A', reason: auto.reason });
    else if (sn) Object.assign(out, { state: levelState(sn.source), notation: sn.notation ?? 'N/A' });
    else if (!(t.requiredWhen ? evalCond(t.requiredWhen, values) : t.required)) out.state = 'optional';
    if (isNaState(out.state)) return out;
    rows.forEach((r, i) => {
      const computedDesign = t.firstRowDesignComputed && i === 0;
      const missing: string[] = [];
      for (const col of ROW_REQUIRED) {
        if (computedDesign && col === 'designCfm') continue;
        if (isBlank(r.data[col]) && !r.na[col]) missing.push(col);
      }
      if (ROW_READINGS.every((c) => isBlank(r.data[c]) && !r.na[c])) missing.push('reading');
      // first return row: design = supply design total - OA design (workbook formula)
      const design = computedDesign ? designSum('supply') - designSum('oa') : num(r.data.designCfm);
      const rt = ratio(rowActualCfm(r), design);
      const out_ = t.tolerance && rt !== null && !withinTolerance(rt, project.tolerance);
      out.rows[r.id] = { missing, ratio: rt, outOfTolerance: out_, design };
      if (out_) {
        const no = isBlank(r.data.no) ? `row ${i + 1}` : String(r.data.no);
        res.outOfTolerance.push({ table: t.key, rowId: r.id, label: `${t.label} ${no}`, ratio: rt });
      }
    });
    return out;
  }

  if (spec.designCheck) {
    const schedule = num(unit.data[spec.designCheck.field]);
    const outlets = designSum(spec.designCheck.table);
    if (schedule !== null && schedule > 0 && outlets > 0 && Math.abs(schedule - outlets) > 0.5) {
      res.designDiscrepancy = { schedule, outlets };
    }
  }

  if (res.openIssues > 0 || res.outOfTolerance.length > 0) res.color = 'red';
  else if (!res.started) res.color = 'gray';
  else if (res.missing.length === 0 && spec.formComplete) res.color = 'green';
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
  green: number;
  red: number;
}

export function rollup(colors: readonly StatusColor[]): Rollup {
  const r: Rollup = { total: colors.length, gray: 0, amber: 0, green: 0, red: 0 };
  for (const c of colors) r[c]++;
  return r;
}

/** Fraction complete for progress bars (green only). */
export const completeFraction = (r: Rollup) => (r.total ? r.green / r.total : 0);
