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
  input: 'text' | 'number';
  unit?: string;
}

export interface RowTableSpec {
  /** Template map table key (supply, return, oa, outlets, exhaust). */
  key: string;
  label: string;
  /** Required: at least `minRows` rows, each complete. Optional tables only check rows that exist. */
  required: boolean;
  requiredWhen?: Cond;
  autoNa?: readonly AutoNa[];
  minRows?: number;
  /** Rows are checked against the project tolerance. */
  tolerance: boolean;
  /** The first row's design CFM is a formula in the workbook (return: total - OA). */
  firstRowDesignComputed?: boolean;
}

export interface PhotoSpec {
  category: Exclude<PhotoCategory, 'cover' | 'deficiency' | 'other'>;
  label: string;
  autoNa?: readonly AutoNa[];
}

export interface SectionSpec {
  key: string;
  label: string;
  /** Required in the Airflow Only scope profile (false: N/A there). */
  airflow: boolean;
  fields: readonly FieldSpec[];
  tables?: readonly RowTableSpec[];
  photos?: readonly PhotoSpec[];
  /** Identity sections can't be marked N/A. */
  locked?: boolean;
}

export interface EquipmentSpec {
  type: EquipmentTypeKey;
  sections: readonly SectionSpec[];
  /** Schedule design CFM checked against the sum of the outlet design CFMs (R8). */
  designCheck?: { field: string; table: string };
  /** False while the full form for the type is still to come: the unit can't turn green. */
  formComplete: boolean;
}

/** Columns of every outlet / inlet table (template OUTLET_COLUMNS). */
export const ROW_COLUMNS: readonly RowColumnSpec[] = [
  { key: 'no', label: 'No.', input: 'text' },
  { key: 'area', label: 'Area served', input: 'text' },
  { key: 'type', label: 'Type', input: 'text' },
  { key: 'size', label: 'Size', input: 'text' },
  { key: 'ak', label: 'Ak', input: 'number', unit: 'ft²' },
  { key: 'designCfm', label: 'Design', input: 'number', unit: 'CFM' },
  { key: 'initialVel', label: 'Initial VEL', input: 'number', unit: 'fpm' },
  { key: 'finalVel', label: 'Final VEL', input: 'number', unit: 'fpm' },
];
/** A row needs these plus a reading in Initial OR Final (prelim rule). */
export const ROW_REQUIRED = ['no', 'area', 'type', 'size', 'ak', 'designCfm'] as const;
export const ROW_READINGS = ['initialVel', 'finalVel'] as const;
