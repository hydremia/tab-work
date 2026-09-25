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
  /**
   * Report lock (Phase 6): set when a report is issued from the Export tab. While set, the repository refuses every
   * write to the project's records (except this field) and the UI is read-only. Synced like any project field.
   */
  lock?: ProjectLock | null;
  createdAt: number;
  updatedAt: number;
}

/** Who did something and on which device (review sign-off, report lock). */
export interface Signature {
  /** Name typed by the user on this device (meta "userName"); '' when not given. */
  name: string;
  userId: string;
  deviceId: string;
  /** ms since epoch */
  at: number;
}

/** A unit's review sign-off. Cleared automatically by the repository when anything of the unit changes. */
export type Review = Signature;

export interface ProjectLock extends Signature {
  /** The revision label the report was issued as (Prelim, Rev 1, Final …). */
  label: string;
  /** The export revision (local to the issuing device). */
  revisionId: string | null;
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
  /** Review sign-off ("Reviewed", shown blue while the unit is green). */
  review?: Review | null;
  /**
   * Set when sync moved the unit to another workbook slot because another device had given the same slot to a unit
   * (sync/slots.ts). Shown on the unit page until dismissed. Deterministic (no time / device), so two devices that
   * resolve the same collision write the same value.
   */
  slotMove?: SlotMove | null;
  createdAt: number;
  updatedAt: number;
}

export interface SlotMove {
  from: number;
  to: number;
  /** The unit that kept the slot. */
  otherId: string;
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
  /** Linked equipment (unit / tag / OA damper / other photos of a unit); null for general and deficiency photos. */
  equipmentId: string | null;
  /** Deficiency photos: the issue they document (numbered to it, e.g. Photo N-3.1). */
  issueId: string | null;
  category: PhotoCategory;
  caption: string;
  /**
   * The stored image: JPEG, EXIF orientation applied, long edge at most 2000 px, EXIF stripped. null on a device that
   * pulled the photo from another device and has not downloaded the file yet (sync/photoSync.ts).
   */
  blob: Blob | null;
  /** Small JPEG (long edge 320 px) for lists; null for photos stored before v3 (the UI falls back to `blob`). */
  thumb?: Blob | null;
  mimeType: string;
  fileName: string;
  width?: number;
  height?: number;
  /** Capture time from the photo's EXIF (ms since epoch, device local time), null when unknown. */
  capturedAt?: number | null;
  /** GPS position from EXIF when present (metadata only). */
  gps?: { lat: number; lon: number } | null;
  /** Sort key within its group (equipment / issue / general). */
  order?: number;
  /** 0 = waiting for upload to Supabase Storage (Phase 5), 1 = uploaded. See PhotoUpload. */
  uploaded: 0 | 1;
  createdAt: number;
  updatedAt: number;
}

/**
 * Upload queue for photo files (Supabase Storage, bucket "photos", path <projectId>/<photoId>.jpg). One entry per
 * photo, created with the photo; the metadata record itself syncs through the field-change outbox. In local mode
 * the queue just waits.
 */
export interface PhotoUpload {
  photoId: string;
  projectId: string;
  /** 'delete': the photo was deleted after its file was uploaded; the file is removed from storage, then the entry. */
  status: 'pending' | 'uploading' | 'done' | 'failed' | 'delete';
  attempts: number;
  lastError: string | null;
  /** Retry with backoff: not before this time (ms). */
  nextAttemptAt?: number;
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
  /**
   * The library instrument this row was copied from (or saved to). The project keeps its OWN copy of the details, so
   * editing the library never changes an issued report; the Info tab offers "Update from library" when they differ.
   */
  libraryId?: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * The shared calibration library (Dexie v6 `libraryInstruments`): instruments stored once for the organization (synced
 * when signed in; per device in local mode) and picked into a project's 8 calibration slots. Its sync changes carry
 * the instrument's own id as their projectId (it belongs to no project), like a project's own changes.
 */
export interface LibraryInstrument {
  id: string;
  type: string;
  manufacturer: string;
  model: string;
  serial: string;
  calibrationDate: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export const INSTRUMENT_DETAIL_KEYS = ['type', 'manufacturer', 'model', 'serial', 'calibrationDate'] as const;

export type TableName =
  'projects' | 'equipment' | 'airflowRows' | 'issues' | 'photos' | 'instruments' | 'libraryInstruments';

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
  /**
   * op 'set': the value before the edit (schema v4+; undefined on older entries). When consecutive unsynced edits are
   * coalesced, this stays the value before the first of them. The full step-by-step history is the `history` table.
   */
  previous?: unknown;
  userId: string;
  deviceId: string;
  /** Client timestamp (ms since epoch). Later edit wins on conflict. */
  ts: number;
  /**
   * 0 = in the outbox, 1 = pushed to the server (or pulled from it), 2 = held: refused by the server because the
   * project's report was issued (locked) on another device; pushed again when the project is unlocked, or discarded.
   * (IndexedDB cannot index booleans.)
   */
  synced: 0 | 1 | 2;
  /** Set when this edit lost a last-writer-wins conflict against a newer remote edit (kept for review). */
  conflict?: 0 | 1;
  /**
   * What the device had pulled when the edit was made (its pull cursor, a server_seq). Two edits of the same field
   * conflict when neither device had seen the other's edit (sync/conflicts.ts).
   */
  baseSeq?: number;
  /** The change's position in the server log (known after push / pull). */
  serverSeq?: number;
}

/**
 * A sync conflict (Dexie v5 `conflicts`, local to the device). kind 'field': two devices edited the same field
 * without seeing each other's edit; the later edit won everywhere (last writer wins) and the other value is kept here
 * until someone resolves it (keep the current value, or restore the other one through setField). kind 'held': changes
 * of this device were refused by the server because the report was issued (locked) on another device meanwhile; they
 * wait on the device (FieldChange.synced = 2) until the project is unlocked, or are discarded.
 */
export interface SyncConflict {
  id: string;
  projectId: string;
  kind: 'field' | 'held';
  table: TableName | null;
  recordId: string | null;
  /** The unit the record belongs to (for the unit badge / page). */
  equipmentId: string | null;
  field: string;
  /** The value now in the record (the later edit), and the one that lost. */
  current?: ConflictSide;
  other?: ConflictSide;
  /** kind 'held': how many changes wait, and the lock that refused them. */
  held?: { count: number; label: string; by: string };
  status: 'open' | 'resolved';
  detectedAt: number;
  resolvedAt?: number;
  /** superseded: someone edited the field again later (having seen both values). */
  resolution?: 'kept' | 'restored' | 'released' | 'discarded' | 'superseded';
}

export interface ConflictSide {
  value: unknown;
  ts: number;
  userId: string;
  deviceId: string;
  /** This device's edit. */
  local: boolean;
  changeId: string;
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
  /** Export: issued with "Issue report" (the project was locked at this revision). */
  issued?: boolean;
  userId: string;
}

export type HistoryKind =
  | 'edit'
  | 'create'
  | 'delete'
  | 'review'
  | 'review-cleared'
  | 'lock'
  | 'unlock'
  | 'import'
  | 'revision'
  | 'conflict'
  | 'conflict-resolved';

/**
 * Change history (audit), schema v4: an append-only local table. The outbox (fieldChanges) coalesces repeated
 * unsynced edits of a field into one entry and is shaped for sync, so it can't serve as the history; every write
 * through the repository also appends one entry here (in the same transaction), incl. the previous value. Remote
 * changes from other devices are appended when they are applied (source "remote"). Pruned by data/history.ts.
 */
export interface HistoryEntry {
  id: string;
  projectId: string;
  ts: number;
  kind: HistoryKind;
  table: TableName | null;
  recordId: string | null;
  /** The unit the record belongs to (the unit itself, its rows, photos, linked issues), for the per-unit history. */
  equipmentId: string | null;
  /** Dotted path for edits ('' for creates / deletes / events). */
  field: string;
  /** Value before (undefined: not known, e.g. entries backfilled from the outbox by the v4 upgrade). */
  previous?: unknown;
  value?: unknown;
  /** Short text for creates / deletes / events ("RTU-1", "Exported Prelim", "automatic: RTU-1 changed"). */
  note?: string;
  /** Where the write came from, when not a plain edit. */
  source?: 'import' | 'schedule' | 'remote' | 'auto';
  userId: string;
  userName?: string;
  deviceId: string;
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
