/**
 * Project-level completion (docs/REQUIRED_FIELDS.md "Project level"): Project Information, narrative, cover photo,
 * calibration and the Building Balance pressure table. Pure.
 *
 * Building pressures (Building Balance rows 97–99 and the notes B102–B104) are stored on the project as
 * `info.bb*` values (field N/A marks in `naState.fields`), so they sync, diff and re-import like the other
 * project fields:
 *   row 97  Building vs Outdoors  ΔP required, remarks optional         (test / reference labels fixed)
 *   row 98  Kitchen vs Dining     ΔP required when the project has hoods, else automatically N/A
 *   row 99  spare pair            test space, reference space, ΔP, remarks: all optional
 *   notes   up to 3 lines, optional
 */
import type { FieldValue, Instrument, NaMark, Notation, Project } from '../data/types';
import type { ItemResult } from './completion';
import { isBlank } from './conditions';
import type { FieldSpec } from './specs';

export const PRESSURE_KEYS = {
  buildingDp: 'bbBuildingDp',
  buildingRemarks: 'bbBuildingRemarks',
  kitchenDp: 'bbKitchenDp',
  kitchenRemarks: 'bbKitchenRemarks',
  spareTest: 'bbSpareTest',
  spareRef: 'bbSpareRef',
  spareDp: 'bbSpareDp',
  spareRemarks: 'bbSpareRemarks',
  notes: 'bbNotes',
} as const;

/** Every pressure-table key stored in project.info (compared on re-import like the other project fields). */
export const PRESSURE_INFO_KEYS: readonly string[] = Object.values(PRESSURE_KEYS);

/** The template's labels of the two fixed rows (typed text in B97:E98; the export always writes them). */
export const PRESSURE_ROWS = [
  { test: 'Building', ref: 'Outdoors', dp: PRESSURE_KEYS.buildingDp, remarks: PRESSURE_KEYS.buildingRemarks },
  { test: 'Kitchen', ref: 'Dining', dp: PRESSURE_KEYS.kitchenDp, remarks: PRESSURE_KEYS.kitchenRemarks },
] as const;

export const PRESSURE_LABELS: Record<string, string> = {
  [PRESSURE_KEYS.buildingDp]: 'Building vs Outdoors ΔP',
  [PRESSURE_KEYS.buildingRemarks]: 'Building vs Outdoors remarks',
  [PRESSURE_KEYS.kitchenDp]: 'Kitchen vs Dining ΔP',
  [PRESSURE_KEYS.kitchenRemarks]: 'Kitchen vs Dining remarks',
  [PRESSURE_KEYS.spareTest]: 'Spare pair: test space',
  [PRESSURE_KEYS.spareRef]: 'Spare pair: reference space',
  [PRESSURE_KEYS.spareDp]: 'Spare pair ΔP',
  [PRESSURE_KEYS.spareRemarks]: 'Spare pair remarks',
  [PRESSURE_KEYS.notes]: 'Building pressure notes',
};

const dp = (key: string, label: string, required = true): FieldSpec => ({
  key,
  label,
  input: 'number',
  unit: 'in. w.g.',
  required,
});
const txt = (key: string, label: string): FieldSpec => ({ key, label, input: 'text', required: false });

/** Form fields of the pressure table (labels as on the Building Balance sheet). */
export const PRESSURE_FIELDS: readonly FieldSpec[] = [
  dp(PRESSURE_KEYS.buildingDp, 'Building vs Outdoors ΔP'),
  txt(PRESSURE_KEYS.buildingRemarks, 'Remarks'),
  dp(PRESSURE_KEYS.kitchenDp, 'Kitchen vs Dining ΔP'),
  txt(PRESSURE_KEYS.kitchenRemarks, 'Remarks'),
  txt(PRESSURE_KEYS.spareTest, 'Test space'),
  txt(PRESSURE_KEYS.spareRef, 'Reference space'),
  dp(PRESSURE_KEYS.spareDp, 'ΔP', false),
  txt(PRESSURE_KEYS.spareRemarks, 'Remarks'),
  { key: PRESSURE_KEYS.notes, label: 'Notes', input: 'textarea', required: false, hint: 'Up to 3 lines' },
];

/** Kitchen vs Dining is automatically N/A without kitchen hoods. */
export const KITCHEN_NA_REASON = 'no kitchen hoods in the project';

/** Required Project Information fields (REQUIRED_FIELDS.md): the rest are optional. */
export const INFO_REQUIRED = [
  'address',
  'mechanicalEngineer',
  'mechanicalContractor',
  'tabDate',
  'technicians',
  'projectManager',
  'reportDate',
  'narrative',
] as const;

export interface ProjectCompletionInput {
  project: Pick<Project, 'name' | 'info' | 'naState'>;
  hasHoods: boolean;
  hasCover: boolean;
  instruments: readonly Pick<Instrument, 'type' | 'manufacturer' | 'model' | 'serial' | 'calibrationDate'>[];
}

export interface ProjectCompletion {
  required: number;
  satisfied: number;
  missing: { key: string; label: string; section: 'info' | 'cover' | 'calibration' | 'pressures' }[];
  fields: Record<string, ItemResult>;
}

/** Completion state of one project field: value, explicit N/A, automatic N/A, or missing / optional. */
export function projectFieldState(
  project: Pick<Project, 'info' | 'naState'>,
  key: string,
  required: boolean,
  auto?: string,
): ItemResult {
  const v: FieldValue | undefined = project.info[key];
  if (!isBlank(v)) return { state: 'value' };
  const mark: NaMark | null | undefined = project.naState.fields[key];
  if (mark) return { state: 'na', notation: mark.notation as Notation, reason: mark.reason };
  if (auto) return { state: 'auto-na', notation: 'N/A', reason: auto };
  return { state: required ? 'missing' : 'optional' };
}

/** Pressure-table field states (the kitchen row automatically N/A without hoods). */
export function pressureStates(
  project: Pick<Project, 'info' | 'naState'>,
  hasHoods: boolean,
): Record<string, ItemResult> {
  const out: Record<string, ItemResult> = {};
  for (const f of PRESSURE_FIELDS) {
    const auto = f.key === PRESSURE_KEYS.kitchenDp && !hasHoods ? KITCHEN_NA_REASON : undefined;
    out[f.key] = projectFieldState(project, f.key, f.required !== false, auto);
  }
  return out;
}

const INFO_LABELS: Record<string, string> = {
  address: 'Physical address',
  mechanicalEngineer: 'Mechanical engineer',
  mechanicalContractor: 'Mechanical contractor',
  tabDate: 'TAB date',
  technicians: 'Technician(s)',
  projectManager: 'Project manager',
  reportDate: 'Report date',
  narrative: 'Narrative',
};

export function computeProjectCompletion(input: ProjectCompletionInput): ProjectCompletion {
  const { project } = input;
  const res: ProjectCompletion = { required: 0, satisfied: 0, missing: [], fields: {} };
  const count = (
    key: string,
    label: string,
    section: ProjectCompletion['missing'][number]['section'],
    r: ItemResult,
  ) => {
    res.fields[key] = r;
    if (r.state === 'optional') return;
    res.required++;
    if (r.state === 'missing') res.missing.push({ key, label, section });
    else res.satisfied++;
  };
  count('name', 'Project name', 'info', project.name.trim() ? { state: 'value' } : { state: 'missing' });
  for (const k of INFO_REQUIRED) count(k, INFO_LABELS[k], 'info', projectFieldState(project, k, true));
  const coverMark = project.naState.fields['photo:cover'];
  count(
    'photo:cover',
    'Cover photo',
    'cover',
    input.hasCover
      ? { state: 'value' }
      : coverMark
        ? { state: 'na', notation: coverMark.notation }
        : { state: 'missing' },
  );
  const complete = input.instruments.filter((i) =>
    [i.type, i.manufacturer, i.model, i.serial, i.calibrationDate].every((x) => !isBlank(x)),
  );
  const partial = input.instruments.filter(
    (i) =>
      [i.type, i.manufacturer, i.model, i.serial, i.calibrationDate].some((x) => !isBlank(x)) && !complete.includes(i),
  );
  count(
    'calibration',
    partial.length ? `Calibration: ${partial.length} instrument(s) incomplete` : 'Calibration: at least one instrument',
    'calibration',
    complete.length && !partial.length ? { state: 'value' } : { state: 'missing' },
  );
  const ps = pressureStates(project, input.hasHoods);
  for (const f of PRESSURE_FIELDS) count(f.key, PRESSURE_LABELS[f.key], 'pressures', ps[f.key]);
  return res;
}
