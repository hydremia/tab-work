/**
 * Local data model (IndexedDB via Dexie). Mirrors docs/ROADMAP.md "Data model" and supabase/migrations/0001_init.sql.
 * Every record has a uuid id so it can be created offline and synced later.
 */
import type { EquipmentTypeKey } from '../domain/equipmentTypes';

export const NOTATIONS = ['N/A', 'Not Avail.', 'Not Acc.'] as const;
export type Notation = (typeof NOTATIONS)[number];

/** An N/A mark: which notation, with an optional reason ("nameplate missing"). */
export interface NaMark {
  notation: Notation;
  reason?: string;
}

/** A field value as stored: numbers are numbers, dates ISO "YYYY-MM-DD", everything else text. */
export type FieldValue = string | number | null;

/**
 * N/A marks at the three explicit levels (the fourth level, automatic, is computed; the project scope profile
 * is on the project). A section mark of 'applies' overrides the project scope profile for that section.
 */
export interface NaState {
  equipment?: NaMark | null;
  sections: Record<string, NaMark | 'applies' | null>;
  fields: Record<string, NaMark | null>;
}

export type ScopeProfile = 'full' | 'airflow' | 'custom';
export type ReportKind = 'prelim' | 'final';

export interface Blueprint {
  sheet: string;
  revisionDate: string;
}

export interface Project {
  id: string;
  name: string;
  scopeProfile: ScopeProfile;
  /** Custom profile: sections switched off, by equipment type -> section key -> false. */
  customScope: Partial<Record<EquipmentTypeKey, Record<string, boolean>>>;
  /** Airflow tolerance as a fraction (0.1 = ±10 %). Written to Equipment Summary E5. */
  tolerance: number;
  reportKind: ReportKind;
  /** {Project Information} fields other than the name, plus `narrative`. */
  info: Record<string, FieldValue>;
  blueprints: Blueprint[];
  naState: NaState;
  templateRevision: string;
  createdAt: number;
  updatedAt: number;
}

export interface Equipment {
  id: string;
  projectId: string;
  type: EquipmentTypeKey;
  designation: string;
  /** 1-based block number on the unit sheet (= row n of its {Equipment Data Entry} section). */
  slot: number;
  isExisting: boolean;
  /** Field values keyed by the template map's field keys (schedule and block fields share one namespace). */
  data: Record<string, FieldValue>;
  naState: NaState;
  createdAt: number;
  updatedAt: number;
}

/**
 * One outlet / inlet row of an airflow table. Rows are their own records (not an array inside equipment.data)
 * so that two people adding or editing different rows of the same unit never touch the same field: every row
 * edit is a field-level change of that row, which is what the sync strategy merges on.
 */
export interface AirflowRow {
  id: string;
  projectId: string;
  equipmentId: string;
  /** Table key from the template map: supply | return | oa | outlets | exhaust. */
  table: string;
  /** Sort key (gaps allowed so rows can be inserted between others). */
  order: number;
  data: Record<string, FieldValue>;
  na: Record<string, NaMark | null>;
  createdAt: number;
  updatedAt: number;
}

export type IssueKind = 'new' | 'existing';
export interface Issue {
  id: string;
  projectId: string;
  kind: IssueKind;
  /** Numbered separately for New and Existing (Summary - New / Summary - (E)). */
  number: number;
  remark: string;
  status: 'Open' | 'Closed';
  comments: string;
  /** Linked equipment, or null for "General (N/A)". */
  equipmentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type PhotoCategory = 'cover' | 'unit' | 'tag' | 'oa_damper' | 'deficiency' | 'other';
export interface Photo {
  id: string;
  projectId: string;
  equipmentId: string | null;
  issueId: string | null;
  category: PhotoCategory;
  caption: string;
  blob: Blob;
  mimeType: string;
  fileName: string;
  /** 0 = waiting for upload (Phase 5), 1 = uploaded. */
  uploaded: 0 | 1;
  createdAt: number;
  updatedAt: number;
}

export interface Instrument {
  id: string;
  projectId: string;
  order: number;
  type: string;
  manufacturer: string;
  model: string;
  serial: string;
  calibrationDate: string;
  createdAt: number;
  updatedAt: number;
}

export type TableName = 'projects' | 'equipment' | 'airflowRows' | 'issues' | 'photos' | 'instruments';

/** The sync outbox and audit log: one row per field edit (or record create / delete). */
export interface FieldChange {
  id: string;
  projectId: string;
  table: TableName;
  recordId: string;
  op: 'set' | 'create' | 'delete';
  /** Dotted path inside the record for op 'set' (e.g. "data.serial", "naState.fields.serial"); '' otherwise. */
  field: string;
  value: unknown;
  userId: string;
  deviceId: string;
  /** Client timestamp (ms since epoch). Later edit wins on conflict. */
  ts: number;
  /** 0 = in the outbox, 1 = pushed to the server. (IndexedDB cannot index booleans.) */
  synced: 0 | 1;
  /** Set when this edit lost a last-writer-wins conflict against a newer remote edit (kept for review). */
  conflict?: 0 | 1;
}

/**
 * Revision history (local to this device; not synced through the outbox). An 'export' revision is a frozen copy of
 * an issued workbook: label (Prelim, Rev 1 ...), the .xlsm bytes (kept for the last KEEP_REVISION_FILES exports of a
 * project; older ones keep only their values) and the baseline: the values the workbook holds, read back from the
 * exported file, which is the "base" of the three-way diff when that workbook is re-imported. An 'import' revision
 * records a re-import that was applied.
 */
export interface Revision {
  id: string;
  projectId: string;
  kind: 'export' | 'import';
  label: string;
  createdAt: number;
  fileName: string;
  /** Size of the workbook in bytes (also when the bytes are no longer kept). */
  size: number;
  /** The .xlsm; null once pruned (only the newest exports keep their file). */
  bytes: Blob | null;
  /** Export: the values written (ProjectData read back from the file). Import: null. */
  baseline: unknown;
  /** Export: written onto a previously issued workbook instead of the blank template. */
  onBase?: boolean;
  /** Import: the export revision the workbook came from (its marker), when known. */
  fromRevisionId?: string | null;
  /** Import: what was applied. */
  applied?: { accepted: number; declined: number; collisions: number };
  userId: string;
}

/**
 * The workbook the next export of a project is written into (decision F1): the last re-imported issued workbook.
 * Missing: the blank template is used (first export).
 */
export interface BaseWorkbook {
  projectId: string;
  blob: Blob;
  fileName: string;
  size: number;
  importedAt: number;
  /** Export revision the workbook came from (its marker), when known. */
  fromRevisionId: string | null;
}

export interface Meta {
  key: string;
  value: unknown;
}

export const emptyNaState = (): NaState => ({ sections: {}, fields: {} });
