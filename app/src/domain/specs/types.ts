/**
 * Field definitions ("specs") that drive both the equipment forms and the completion engine.
 * They are plain data: a new equipment type is a new spec file, not new engine code.
 * Field keys are the template map's keys (packages/workbook/src/templateMap.ts), so the workbook adapter can
 * route them to the {Equipment Data Entry} row or the unit block without a separate mapping.
 */
import type { EquipmentTypeKey } from '../equipmentTypes';
import type { PhotoCategory } from '../../data/types';

/** Declarative conditions evaluated against the unit's field values. */
export type Cond =
  | { field: string; eq: string | number }
  | { field: string; in: readonly (string | number)[] }
  | { field: string; notIn: readonly (string | number)[] }
  | { field: string; blank: true }
  | { field: string; blankOrZero: true }
  | { field: string; matches: string }
  | { field: string; notMatches: string }
  /** Static profile component n (1-5) is "—" for the unit's unit type. */
  | { componentAbsent: number }
  | { not: Cond }
  | { any: readonly Cond[] }
  | { all: readonly Cond[] };

export interface AutoNa {
  when: Cond;
  /** Shown next to the field: "Auto N/A: direct drive". */
  reason: string;
  /**
   * Applies even when a value is entered (MAU: inputs of a supply method that is not the chosen one). The value is
   * kept in the app, so switching back restores it, but it does not count and is not exported (N/A is).
   */
  overridesValue?: boolean;
}

export type InputKind = 'text' | 'number' | 'select' | 'date' | 'textarea' | 'yesno';

export interface FieldSpec {
  key: string;
  label: string;
  input: InputKind;
  options?: readonly (string | number)[];
  /** Free-text suggestions (datalist) for text inputs. */
  suggestions?: readonly string[];
  unit?: string;
  /** Required for completion (default true). */
  required?: boolean;
  /** Required only when this holds (otherwise optional). */
  requiredWhen?: Cond;
  autoNa?: readonly AutoNa[];
  /** Overrides the section's `airflow` flag for the Airflow Only scope profile. */
  airflow?: boolean;
  /** Template preset (e.g. unit type "RTU"): a preset value alone does not make a unit "started". */
  preset?: string | number;
  /** App-only field, not in the workbook (e.g. "Has VFD?"). */
  appOnly?: boolean;
  /** Static profile component number (1-5): the form labels the field with the component name. */
  component?: number;
  /** Stored on the record itself (designation) instead of in `data`. */
  recordField?: 'designation';
  hint?: string;
}

export interface RowColumnSpec {
  key: string;
  label: string;
  input: 'text' | 'number' | 'select';
  unit?: string;
  options?: readonly (string | number)[];
  /** Options picked by the value of a unit field (hood filter sizes by filter type); falls back to `options`. */
  optionsBy?: { field: string; map: Readonly<Record<string, readonly (string | number)[]>> };
  /** Needed for a complete row (default true; reading columns are governed by `readingGroups`). */
  required?: boolean;
  /** Automatic N/A for this column, evaluated on the unit's values merged with the row's values. */
  autoNa?: readonly AutoNa[];
  /** The row menu offers N/A / Not Avail. / Not Acc. for this column. */
  naMenu?: boolean;
  wide?: boolean;
}

/** Live calculation shown per row / in the table totals (see domain/equipmentCalcs.ts). */
export type RowCalc = 'outlet' | 'hoodFilter' | 'filterGrid';

export interface RowTableSpec {
  /** Template map table key (supply, return, oa, outlets, exhaust, filters) or column table (filterGrid). */
  key: string;
  label: string;
  /** Required: at least `minRows` rows, each complete. Optional tables only check rows that exist. */
  required: boolean;
  requiredWhen?: Cond;
  autoNa?: readonly AutoNa[];
  minRows?: number;
  /** Rows are checked against the project tolerance (outlet rows: actual / design CFM). */
  tolerance: boolean;
  /** The first row's design CFM is a formula in the workbook (return: total - OA). */
  firstRowDesignComputed?: boolean;
  /** Row columns (default: the outlet columns, ROW_COLUMNS). */
  columns?: readonly RowColumnSpec[];
  /**
   * Reading columns: a row is complete when one group is complete (every member has a value or is N/A).
   * Default: [['initialVel'], ['finalVel']] (the prelim rule: Initial OR Final).
   */
  readingGroups?: readonly (readonly string[])[];
  /** Default 'outlet'. */
  calc?: RowCalc;
  /** Columns copied into a new row from the previous one ("fill down"). */
  fillDown?: readonly string[];
  /** "Add outlet" / "Add filter". */
  noun?: string;
}

/**
 * A run of single readings entered in order (PSP velocities, traverse quick entry). Reading i (1-based) is
 * stored in `data[seqKey(key, i)]`; a reading can be marked N/A on its own (naState.fields[seqKey(key, i)]) and
 * the whole run through naState.fields[seqNaKey(key)].
 */
export interface SequenceSpec {
  /** Template map sequence key. */
  key: string;
  label: string;
  count: number;
  unit?: string;
  /** Readings needed (default 1). */
  minReadings?: number;
  required?: boolean;
  requiredWhen?: Cond;
  autoNa?: readonly AutoNa[];
}
export const seqKey = (key: string, i: number) => `${key}_${i}`;

export interface PhotoSpec {
  category: Exclude<PhotoCategory, 'cover' | 'deficiency' | 'other'>;
  label: string;
  autoNa?: readonly AutoNa[];
}

/** Live-calculation panel shown at the end of a section (rendered by ui/components/CalcPanels.tsx). */
export type CalcPanel = 'psp' | 'filterGrid' | 'profile' | 'mauTotal' | 'ervTotals' | 'hoodTotals' | 'traverse';

export interface SectionSpec {
  key: string;
  label: string;
  /** Required in the Airflow Only scope profile (false: N/A there). */
  airflow: boolean;
  fields: readonly FieldSpec[];
  tables?: readonly RowTableSpec[];
  sequences?: readonly SequenceSpec[];
  photos?: readonly PhotoSpec[];
  /** Identity sections can't be marked N/A. */
  locked?: boolean;
  /** The form shows the section only while this holds (MAU: the chosen supply airflow method). */
  showWhen?: Cond;
  /** The form folds the section to a one-line note (with a "show" button) while this holds. */
  foldWhen?: Cond;
  /** Text of that note. */
  foldNote?: string;
  calc?: CalcPanel;
  hint?: string;
}

/** R8: a schedule design CFM checked against the sum of a table's outlet design CFMs. */
export interface DesignCheck {
  field: string;
  table: string;
  label?: string;
}

/** Unit-level actual / design checked against the project tolerance (see TOTAL_CALCS in equipmentCalcs.ts). */
export type TotalCalc = 'mau' | 'hood' | 'traverse';

export interface EquipmentSpec {
  type: EquipmentTypeKey;
  sections: readonly SectionSpec[];
  /** Schedule design CFM checked against the sum of the outlet design CFMs (R8). */
  designCheck?: DesignCheck | readonly DesignCheck[];
  totalCheck?: { calc: TotalCalc; label: string };
  /** False while the full form for the type is still to come: the unit can't turn green. */
  formComplete: boolean;
}

/** Columns of every outlet / inlet table (template OUTLET_COLUMNS). */
export const ROW_COLUMNS: readonly RowColumnSpec[] = [
  { key: 'no', label: 'No.', input: 'text' },
  { key: 'area', label: 'Area served', input: 'text', wide: true },
  { key: 'type', label: 'Type', input: 'text' },
  { key: 'size', label: 'Size', input: 'text' },
  { key: 'ak', label: 'Ak', input: 'number', unit: 'ft²' },
  { key: 'designCfm', label: 'Design', input: 'number', unit: 'CFM' },
  { key: 'initialVel', label: 'Initial VEL', input: 'number', unit: 'fpm', naMenu: true },
  { key: 'finalVel', label: 'Final VEL', input: 'number', unit: 'fpm', naMenu: true },
];
/** A row needs these plus a reading in Initial OR Final (prelim rule). */
export const ROW_REQUIRED = ['no', 'area', 'type', 'size', 'ak', 'designCfm'] as const;
export const ROW_READINGS = ['initialVel', 'finalVel'] as const;
export const DEFAULT_READING_GROUPS: readonly (readonly string[])[] = [['initialVel'], ['finalVel']];
export const DEFAULT_FILL_DOWN = ['area', 'type', 'size', 'ak'] as const;

export const tableColumns = (t: RowTableSpec): readonly RowColumnSpec[] => t.columns ?? ROW_COLUMNS;
export const designChecks = (s: EquipmentSpec): readonly DesignCheck[] =>
  s.designCheck === undefined
    ? []
    : 'field' in s.designCheck
      ? [s.designCheck]
      : (s.designCheck as readonly DesignCheck[]);
