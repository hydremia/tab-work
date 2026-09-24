/**
 * Repository: the only place that writes to the local database. Every edit goes through `setField()`, which
 * updates the record AND appends a FieldChange to the sync outbox AND a HistoryEntry to the change history in one
 * Dexie transaction. Creates and deletes are logged the same way (op 'create' / 'delete').
 *
 * Phase 6 rules enforced here (not only in the UI):
 *  - report lock: while a project is locked (issued), every write to its records is refused with LockedError,
 *    except the lock field itself (unlock) and deleting the whole project;
 *  - review: any change to a reviewed unit (its fields, N/A marks, rows, photos) clears the review in the same
 *    transaction, noted in the history as an automatic review clear.
 */
import { DEFAULT_INSTRUMENTS, TEMPLATE_MAP, TEMPLATE_REVISION, tableRows } from '@a2b/workbook/map';
import type { Table } from 'dexie';
import { computeCompletion } from '../domain/completion';
import { duplicateData, duplicateRow } from '../domain/duplicate';
import { equipmentType, nextFreeSlot, type EquipmentTypeKey } from '../domain/equipmentTypes';
import type { PreviewRow } from '../domain/scheduleImport';
import { getSpec } from '../domain/specs';
import { db } from './db';
import { appendHistory, currentActor } from './history';
import { uuid } from './uuid';
import { currentBaseSeq, getCurrentUser, getDeviceId, getUserName, nextTimestamp, setUserName } from './identity';
import { deepEqual, getPath, setPath, assertEditablePath } from './paths';
import { comparePhotos, groupKeyOf, sortKey } from '../photos/labels';
import {
  emptyNaState,
  type AirflowRow,
  type Equipment,
  type FieldChange,
  type HistoryEntry,
  type HistoryKind,
  type Instrument,
  type Issue,
  type IssueKind,
  type Photo,
  type PhotoCategory,
  type Project,
  type ProjectLock,
  type ScopeProfile,
  type Signature,
  type TableName,
} from './types';

type AnyRecord = { id: string; projectId?: string; updatedAt: number };

/** Every table a repository write can touch (nested transactions must be a subset of their parent's tables). */
export const writeTables = () => [
  db.projects,
  db.equipment,
  db.airflowRows,
  db.issues,
  db.photos,
  db.instruments,
  db.fieldChanges,
  db.history,
  db.meta,
  db.photoUploads,
  db.conflicts,
];

/** Where a write comes from (recorded in the history). */
export interface WriteOptions {
  source?: HistoryEntry['source'];
  note?: string;
}

export class LockedError extends Error {
  constructor(lock: ProjectLock) {
    super(`The report was issued as ${lock.label}; unlock the project to edit.`);
    this.name = 'LockedError';
  }
}

function tableOf(name: TableName): Table<AnyRecord, string> {
  return db.table(name) as Table<AnyRecord, string>;
}

function projectIdOf(name: TableName, rec: AnyRecord): string {
  return name === 'projects' ? rec.id : (rec.projectId ?? '');
}

/** The unit a record belongs to: the unit itself, or a row / photo / issue linked to it. */
export function unitOf(name: TableName, rec: AnyRecord): string | null {
  if (name === 'equipment') return rec.id;
  if (name === 'airflowRows' || name === 'photos' || name === 'issues')
    return (rec as unknown as { equipmentId?: string | null }).equipmentId ?? null;
  return null;
}

/** Short description of a record for create / delete history entries. */
function describe(name: TableName, rec: AnyRecord): string {
  const r = rec as unknown as Record<string, unknown>;
  switch (name) {
    case 'projects':
      return String(r.name ?? '');
    case 'equipment':
      return String(r.designation ?? '');
    case 'issues':
      return `Issue ${r.kind === 'existing' ? 'E' : 'N'}-${String(r.number ?? '')}`;
    case 'airflowRows': {
      const no = (r.data as Record<string, unknown> | undefined)?.no;
      return `${String(r.table ?? '')} row${no ? ` ${String(no)}` : ''}`;
    }
    case 'photos':
      return `${String(r.category ?? '')} photo`;
    case 'instruments':
      return String(r.type || 'instrument');
  }
}

/** Outbox copy of a record: photos are logged without their Blob (the file uploads separately). */
function loggable(name: TableName, rec: AnyRecord): unknown {
  if (name === 'photos') {
    const { blob: _blob, thumb: _thumb, ...rest } = rec as unknown as Photo;
    return rest;
  }
  return rec;
}

export function historyKind(table: TableName, field: string, value: unknown): HistoryKind {
  if (table === 'equipment' && field === 'review') return value ? 'review' : 'review-cleared';
  if (table === 'projects' && field === 'lock') return value ? 'lock' : 'unlock';
  return 'edit';
}

async function change(
  partial: Pick<FieldChange, 'projectId' | 'table' | 'recordId' | 'op' | 'field' | 'value'> &
    Partial<Pick<FieldChange, 'previous'>>,
  ts: number,
): Promise<FieldChange> {
  return {
    id: uuid(),
    ...partial,
    userId: getCurrentUser(),
    deviceId: await getDeviceId(),
    ts,
    synced: 0,
    baseSeq: await currentBaseSeq(),
  };
}

/**
 * A photo's file leaves with it: never uploaded -> drop the queue entry; uploaded -> the entry becomes 'delete' and
 * sync/photoSync.ts removes the file from storage. `remote`: another device deleted it (and removes the file).
 */
export async function forgetPhotoFile(photoId: string, remote = false): Promise<void> {
  const u = await db.photoUploads.get(photoId);
  if (!u) return;
  if (u.status === 'done' && !remote)
    await db.photoUploads.put({
      ...u,
      status: 'delete',
      attempts: 0,
      lastError: null,
      nextAttemptAt: 0,
      updatedAt: Date.now(),
    });
  else await db.photoUploads.delete(photoId);
}

/**
 * Delete a project and everything in it on this device only (no outbox entries): its records, photo queue entries,
 * pending changes, conflicts, revisions, base workbook and history. Used by deleteRecord('projects') (which logs the
 * one project delete) and when another device's project delete is pulled (the server cascades the same way).
 */
export async function deleteProjectLocally(projectId: string, remote = false): Promise<void> {
  for (const name of ['airflowRows', 'photos', 'issues', 'instruments', 'equipment'] as const) {
    const t = tableOf(name);
    if (name === 'photos')
      for (const id of (await t.where('projectId').equals(projectId).primaryKeys()) as string[])
        await forgetPhotoFile(id, remote);
    await t.where('projectId').equals(projectId).delete();
  }
  await db.projects.delete(projectId);
  // changes of the project not on the server yet are moot now (the delete is what the server needs)
  await db.fieldChanges
    .where('projectId')
    .equals(projectId)
    .filter((c) => c.synced !== 1)
    .delete();
  await db.conflicts.where('projectId').equals(projectId).delete();
  await db.revisions.where('projectId').equals(projectId).delete();
  await db.baseWorkbooks.delete(projectId);
  await db.history.where('projectId').equals(projectId).delete();
}

/** Refuse writes to a locked project (the lock field itself stays writable, so it can be unlocked). */
async function assertUnlocked(projectId: string, table: TableName, field: string, rec?: AnyRecord): Promise<void> {
  if (!projectId) return;
  if (table === 'projects' && field === 'lock') return;
  const project = table === 'projects' && rec ? (rec as unknown as Project) : await db.projects.get(projectId);
  if (project?.lock) throw new LockedError(project.lock);
}

/** A change to a reviewed unit (or its rows / photos) clears the review. */
async function clearReviewAfter(table: TableName, rec: AnyRecord, field: string, opts: WriteOptions): Promise<void> {
  if (opts.source === 'remote') return;
  if (table === 'issues' || (table === 'equipment' && field === 'review')) return;
  const unitId = unitOf(table, rec);
  if (!unitId) return;
  const unit = await db.equipment.get(unitId);
  if (!unit?.review) return;
  await setField('equipment', unitId, 'review', null, { source: 'auto', note: 'automatic' });
}

/**
 * Set one field of one record. `field` is a dotted path inside the record ("data.serial",
 * "naState.fields.serial", "blueprints.0.sheet"). No-op when the value is unchanged.
 * Consecutive unsynced edits of the same field from this device are coalesced into one outbox entry (the history
 * keeps every step, with the value before).
 */
export async function setField(
  table: TableName,
  recordId: string,
  field: string,
  value: unknown,
  opts: WriteOptions = {},
): Promise<void> {
  assertEditablePath(field);
  const actor = await currentActor();
  const deviceId = actor.deviceId;
  await db.transaction('rw', writeTables(), async () => {
    const t = tableOf(table);
    const rec = await t.get(recordId);
    if (!rec) throw new Error(`${table}/${recordId} not found`);
    const before = getPath(rec, field);
    if (deepEqual(before, value)) return;
    const projectId = projectIdOf(table, rec);
    await assertUnlocked(projectId, table, field, rec);
    const ts = nextTimestamp();
    const next = setPath(rec, field, value);
    next.updatedAt = ts;
    await t.put(next);
    const pending = await db.fieldChanges
      .where('[table+recordId+field]')
      .equals([table, recordId, field])
      .filter((c) => c.synced === 0 && c.op === 'set' && c.deviceId === deviceId)
      .toArray();
    const prev = pending.sort((a, b) => b.ts - a.ts)[0];
    if (prev) {
      // coalesced: the entry keeps the value before its first edit
      await db.fieldChanges.update(prev.id, {
        value: value ?? null,
        ts,
        userId: getCurrentUser(),
        baseSeq: await currentBaseSeq(),
      });
    } else {
      await db.fieldChanges.add(
        await change(
          { projectId, table, recordId, op: 'set', field, value: value ?? null, previous: before ?? null },
          ts,
        ),
      );
    }
    await appendHistory(
      {
        projectId,
        ts,
        kind: historyKind(table, field, value),
        table,
        recordId,
        equipmentId: unitOf(table, next),
        field,
        previous: before ?? null,
        value: value ?? null,
        ...(opts.note ? { note: opts.note } : {}),
        ...(opts.source ? { source: opts.source } : {}),
      },
      actor,
    );
    await clearReviewAfter(table, next, field, opts);
  });
}

/** Set several fields of one record (each is its own field change, one transaction). */
export async function setFields(
  table: TableName,
  recordId: string,
  values: Record<string, unknown>,
  opts: WriteOptions = {},
): Promise<void> {
  await db.transaction('rw', writeTables(), async () => {
    for (const [k, v] of Object.entries(values)) await setField(table, recordId, k, v, opts);
  });
}

export async function createRecord<T extends AnyRecord>(table: TableName, rec: T, opts: WriteOptions = {}): Promise<T> {
  const actor = await currentActor();
  await db.transaction('rw', writeTables(), async () => {
    const projectId = projectIdOf(table, rec);
    if (table !== 'projects') await assertUnlocked(projectId, table, '');
    const ts = nextTimestamp();
    await tableOf(table).add(rec);
    await db.fieldChanges.add(
      await change({ projectId, table, recordId: rec.id, op: 'create', field: '', value: loggable(table, rec) }, ts),
    );
    await appendHistory(
      {
        projectId,
        ts,
        kind: 'create',
        table,
        recordId: rec.id,
        equipmentId: unitOf(table, rec),
        field: '',
        note: describe(table, rec),
        ...(opts.source ? { source: opts.source } : {}),
      },
      actor,
    );
    if (table === 'airflowRows' || table === 'photos') await clearReviewAfter(table, rec, '', opts);
  });
  return rec;
}

export async function deleteRecord(table: TableName, recordId: string, opts: WriteOptions = {}): Promise<void> {
  const actor = await currentActor();
  await db.transaction(
    'rw',
    [
      ...writeTables(),
      // only a project delete touches the local revision tables (keeps nested transactions of other deletes valid)
      ...(table === 'projects' ? [db.revisions, db.baseWorkbooks] : []),
    ],
    async () => {
      const rec = await tableOf(table).get(recordId);
      if (!rec) return;
      if (table === 'projects') {
        // Deleting a whole project (also while locked) is ONE change: the server and every other device cascade it
        // (supabase/migrations/0003_sync_rules.sql, sync/outbox.ts). A project that never reached the server leaves
        // nothing to sync.
        const neverSynced = await db.fieldChanges
          .where('[table+recordId+field]')
          .equals(['projects', recordId, ''])
          .filter((c) => c.op === 'create' && c.synced !== 1)
          .count();
        await deleteProjectLocally(recordId);
        if (!neverSynced)
          await db.fieldChanges.add(
            await change(
              { projectId: recordId, table, recordId, op: 'delete', field: '', value: null },
              nextTimestamp(),
            ),
          );
        return;
      }
      // anything inside a locked project is refused
      await assertUnlocked(projectIdOf(table, rec), table, '');
      const log = async (name: TableName, r: AnyRecord) => {
        await tableOf(name).delete(r.id);
        if (name === 'photos') await forgetPhotoFile(r.id);
        const ts = nextTimestamp();
        const projectId = projectIdOf(name, r);
        await db.fieldChanges.add(
          await change({ projectId, table: name, recordId: r.id, op: 'delete', field: '', value: null }, ts),
        );
        await appendHistory(
          {
            projectId,
            ts,
            kind: 'delete',
            table: name,
            recordId: r.id,
            equipmentId: unitOf(name, r),
            field: '',
            note: describe(name, r),
            ...(opts.source ? { source: opts.source } : {}),
          },
          actor,
        );
      };
      if (table === 'equipment') {
        for (const r of await db.airflowRows.where('equipmentId').equals(recordId).toArray())
          await log('airflowRows', r);
        for (const p of await db.photos.where('equipmentId').equals(recordId).toArray()) await log('photos', p);
        for (const i of await db.issues.where('equipmentId').equals(recordId).toArray()) {
          await setField('issues', i.id, 'equipmentId', null, opts); // the issue becomes "General (N/A)"
        }
      } else if (table === 'issues') {
        // an issue's deficiency photos go with it
        for (const p of await db.photos.where('issueId').equals(recordId).toArray()) await log('photos', p);
      }
      await log(table, rec);
      if (table === 'airflowRows' || table === 'photos') await clearReviewAfter(table, rec, '', opts);
    },
  );
}

// ------------------------------------------------------------------------------------------ review, report lock
async function signature(): Promise<Signature> {
  const [deviceId, name] = await Promise.all([getDeviceId(), getUserName()]);
  return { name, userId: getCurrentUser(), deviceId, at: Date.now() };
}

export class NotCompleteError extends Error {
  constructor(designation: string) {
    super(`${designation} is not complete (green) yet, so it can't be marked reviewed.`);
    this.name = 'NotCompleteError';
  }
}

/** Is the unit complete (green) right now? (The same completion the UI shows.) */
export async function isUnitGreen(equipmentId: string): Promise<boolean> {
  const unit = await db.equipment.get(equipmentId);
  if (!unit) return false;
  const [project, rows, photos, issues] = await Promise.all([
    db.projects.get(unit.projectId),
    db.airflowRows.where('equipmentId').equals(equipmentId).toArray(),
    db.photos.where('equipmentId').equals(equipmentId).toArray(),
    db.issues.where('equipmentId').equals(equipmentId).toArray(),
  ]);
  if (!project) return false;
  return (
    computeCompletion({
      spec: getSpec(unit.type),
      unit,
      rows,
      photos,
      project,
      openIssues: issues.filter((i) => i.status === 'Open').length,
    }).color === 'green'
  );
}

/**
 * Sign a green unit off as reviewed (any user, decision F4). `name` (optional) is remembered on this device as the
 * reviewer name. The review is a synced field (`review`: name, user, device, time).
 */
export async function markReviewed(equipmentId: string, name?: string): Promise<void> {
  if (name !== undefined && name.trim()) await setUserName(name);
  const unit = await db.equipment.get(equipmentId);
  if (!unit) throw new Error('unit not found');
  if (!(await isUnitGreen(equipmentId))) throw new NotCompleteError(unit.designation);
  await setField('equipment', equipmentId, 'review', await signature());
}

export async function clearReview(equipmentId: string): Promise<void> {
  await setField('equipment', equipmentId, 'review', null);
}

/** Lock the project at an issued revision (Export tab → Issue report). */
export async function lockProject(projectId: string, label: string, revisionId: string | null): Promise<void> {
  const lock: ProjectLock = { ...(await signature()), label, revisionId };
  await setField('projects', projectId, 'lock', lock);
}

/** Unlock for follow-up (the history keeps who / when; the next export label is suggested from the revisions). */
export async function unlockProject(projectId: string): Promise<void> {
  await setField('projects', projectId, 'lock', null);
}

// ------------------------------------------------------------------------------------------ projects
export interface NewProjectInput {
  name: string;
  address?: string;
  scopeProfile?: ScopeProfile;
  tabDate?: string;
}

export async function createProject(input: NewProjectInput): Promise<Project> {
  const now = Date.now();
  const project: Project = {
    id: uuid(),
    name: input.name.trim(),
    scopeProfile: input.scopeProfile ?? 'full',
    customScope: {},
    tolerance: 0.1,
    reportKind: 'prelim',
    info: { address: input.address?.trim() || null, tabDate: input.tabDate || null },
    blueprints: [],
    naState: emptyNaState(),
    templateRevision: TEMPLATE_REVISION,
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction('rw', writeTables(), async () => {
    await createRecord('projects', project);
    // the template's 7 pre-loaded a2b instruments (the export replaces the Calibration list)
    let order = 0;
    for (const ins of DEFAULT_INSTRUMENTS) {
      await createRecord<Instrument>('instruments', {
        id: uuid(),
        projectId: project.id,
        order: order++,
        ...ins,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
  return project;
}

// ------------------------------------------------------------------------------------------ equipment
export class CapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapacityError';
  }
}

/** Initial field values of a new unit (the template's presets). */
const PRESETS: Partial<Record<EquipmentTypeKey, Record<string, string>>> = {
  rtu: { unitType: 'RTU' },
  mau: { unitType: 'MAU' },
  erv: { unitType: 'ERV' },
  fan: { unitType: 'EF' },
};

export async function addEquipment(
  projectId: string,
  type: EquipmentTypeKey,
  designation: string,
  isExisting = false,
): Promise<Equipment> {
  const info = equipmentType(type);
  return db.transaction('rw', writeTables(), async () => {
    const existing = await db.equipment.where('[projectId+type]').equals([projectId, type]).toArray();
    const slot = nextFreeSlot(
      existing.map((e) => e.slot),
      info.capacity,
    );
    if (slot === null) throw new CapacityError(`The workbook has room for ${info.capacity} ${info.plural}.`);
    const now = Date.now();
    return createRecord<Equipment>('equipment', {
      id: uuid(),
      projectId,
      type,
      designation: designation.trim(),
      slot,
      isExisting,
      data: { ...(PRESETS[type] ?? {}) },
      naState: emptyNaState(),
      createdAt: now,
      updatedAt: now,
    });
  });
}

/** Rows available in an airflow table of an equipment type (from the template map). */
export function airflowTableCapacity(type: EquipmentTypeKey, table: string): number {
  const block = TEMPLATE_MAP.equipment.find((e) => e.key === type)?.block;
  const def = block?.tables?.find((t) => t.key === table);
  if (def) return tableRows(def).length;
  // column tables (MAU filter grid: one filter per column)
  return block?.columnTables?.find((t) => t.key === table)?.cols.length ?? 0;
}

export async function addAirflowRow(
  equipment: Pick<Equipment, 'id' | 'projectId' | 'type'>,
  table: string,
  data: AirflowRow['data'] = {},
): Promise<AirflowRow> {
  return db.transaction('rw', writeTables(), async () => {
    const rows = (await db.airflowRows.where('equipmentId').equals(equipment.id).toArray()).filter(
      (r) => r.table === table,
    );
    const cap = airflowTableCapacity(equipment.type, table);
    if (rows.length >= cap) throw new CapacityError(`This table has room for ${cap} rows in the workbook.`);
    const now = Date.now();
    return createRecord<AirflowRow>('airflowRows', {
      id: uuid(),
      projectId: equipment.projectId,
      equipmentId: equipment.id,
      table,
      order: rows.reduce((m, r) => Math.max(m, r.order), 0) + 1,
      data,
      na: {},
      createdAt: now,
      updatedAt: now,
    });
  });
}

// ------------------------------------------------------------------------------------------ schedule import
/**
 * Create / update units from a schedule import preview (domain/scheduleImport.ts) in one transaction: a new unit is
 * created (next free slot, like "Add equipment"), then every value goes through setField; an existing unit (same
 * designation) gets only the values the schedule has (blank schedule cells never clear app values). Rows with
 * action 'skip' are ignored.
 */
export async function applyScheduleImport(
  projectId: string,
  type: EquipmentTypeKey,
  rows: readonly Pick<PreviewRow, 'action' | 'designation' | 'values' | 'existingId'>[],
  isExisting = false,
): Promise<{ created: Equipment[]; updated: number }> {
  return db.transaction('rw', writeTables(), async () => {
    const created: Equipment[] = [];
    let updated = 0;
    for (const r of rows) {
      if (r.action === 'skip') continue;
      let id = r.existingId;
      if (r.action === 'create') {
        const unit = await addEquipment(projectId, type, r.designation, isExisting);
        created.push(unit);
        id = unit.id;
      } else updated++;
      if (!id) continue;
      for (const [k, v] of Object.entries(r.values)) {
        if (v === null || v === '') continue;
        await setField('equipment', id, `data.${k}`, v, { source: 'schedule' });
      }
    }
    return { created, updated };
  });
}

/**
 * Duplicate a unit: same type, next free slot, the design / schedule data and configuration (domain/duplicate.ts),
 * optionally its outlet / filter rows without readings. Photos, readings, serial and remarks are not copied.
 */
export async function duplicateEquipment(
  sourceId: string,
  designation: string,
  opts: { rows?: boolean } = {},
): Promise<Equipment> {
  return db.transaction('rw', writeTables(), async () => {
    const src = await db.equipment.get(sourceId);
    if (!src) throw new Error('unit not found');
    const unit = await addEquipment(src.projectId, src.type, designation, src.isExisting);
    const { data, fieldMarks } = duplicateData(src);
    for (const [k, v] of Object.entries(data)) await setField('equipment', unit.id, `data.${k}`, v);
    for (const [k, m] of Object.entries(fieldMarks)) await setField('equipment', unit.id, `naState.fields.${k}`, m);
    for (const [k, m] of Object.entries(src.naState.sections))
      if (m) await setField('equipment', unit.id, `naState.sections.${k}`, m);
    if (opts.rows) {
      const rows = (await db.airflowRows.where('equipmentId').equals(src.id).toArray()).sort(
        (a, b) => a.order - b.order,
      );
      for (const r of rows) {
        const copy = duplicateRow(src.type, r);
        const now = Date.now();
        await createRecord<AirflowRow>('airflowRows', {
          id: uuid(),
          projectId: src.projectId,
          equipmentId: unit.id,
          table: r.table,
          order: r.order,
          data: copy.data,
          na: copy.na,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return (await db.equipment.get(unit.id))!;
  });
}

// ------------------------------------------------------------------------------------------ issues
export async function addIssue(
  projectId: string,
  input: Partial<Pick<Issue, 'kind' | 'remark' | 'status' | 'comments' | 'equipmentId'>> = {},
): Promise<Issue> {
  return db.transaction('rw', writeTables(), async () => {
    const kind: IssueKind = input.kind ?? 'new';
    const same = await db.issues.where('[projectId+kind]').equals([projectId, kind]).toArray();
    const now = Date.now();
    return createRecord<Issue>('issues', {
      id: uuid(),
      projectId,
      kind,
      number: same.reduce((m, i) => Math.max(m, i.number), 0) + 1,
      remark: input.remark ?? '',
      status: input.status ?? 'Open',
      comments: input.comments ?? '',
      equipmentId: input.equipmentId ?? null,
      createdAt: now,
      updatedAt: now,
    });
  });
}

// ------------------------------------------------------------------------------------------ photos
/** What a new photo is attached to. */
export interface PhotoTarget {
  category: PhotoCategory;
  equipmentId?: string | null;
  issueId?: string | null;
  caption?: string;
}

/** A processed image (see photos/process.ts); a raw Blob is stored as is (tests, legacy callers). */
export interface PhotoImage {
  blob: Blob;
  thumb?: Blob | null;
  width?: number;
  height?: number;
  capturedAt?: number | null;
  gps?: { lat: number; lon: number } | null;
  fileName?: string;
}

/** Next sort key at the end of the photo's group. */
async function nextPhotoOrder(
  projectId: string,
  target: Pick<Photo, 'category' | 'equipmentId' | 'issueId'>,
  exceptId?: string,
) {
  const key = groupKeyOf(target);
  const all = await db.photos.where('projectId').equals(projectId).toArray();
  return all.filter((p) => p.id !== exceptId && groupKeyOf(p) === key).reduce((m, p) => Math.max(m, sortKey(p)), 0) + 1;
}

export async function addPhoto(
  projectId: string,
  file: (Blob & { name?: string }) | PhotoImage,
  categoryOrTarget: PhotoCategory | PhotoTarget,
  equipmentId: string | null = null,
): Promise<Photo> {
  const target: PhotoTarget =
    typeof categoryOrTarget === 'string' ? { category: categoryOrTarget, equipmentId } : categoryOrTarget;
  const img: PhotoImage = file instanceof Blob ? { blob: file, fileName: (file as { name?: string }).name } : file;
  const now = Date.now();
  return db.transaction('rw', writeTables(), async () => {
    const base = {
      category: target.category,
      equipmentId:
        target.category === 'deficiency' || target.category === 'cover' ? null : (target.equipmentId ?? null),
      issueId: target.category === 'deficiency' ? (target.issueId ?? null) : null,
    };
    const photo = await createRecord<Photo>('photos', {
      id: uuid(),
      projectId,
      ...base,
      caption: target.caption ?? '',
      blob: img.blob,
      thumb: img.thumb ?? null,
      mimeType: img.blob.type || 'image/jpeg',
      fileName: img.fileName ?? `${target.category}.jpg`,
      width: img.width,
      height: img.height,
      capturedAt: img.capturedAt ?? null,
      gps: img.gps ?? null,
      order: await nextPhotoOrder(projectId, base),
      uploaded: 0,
      createdAt: now,
      updatedAt: now,
    });
    await db.photoUploads.put({
      photoId: photo.id,
      projectId,
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });
    return photo;
  });
}

/** Replace the photo of a single-photo slot (cover, unit, tag, OA damper); the new photo keeps the old one's place. */
export async function replacePhoto(
  projectId: string,
  file: (Blob & { name?: string }) | PhotoImage,
  category: PhotoCategory,
  equipmentId: string | null = null,
): Promise<Photo> {
  return db.transaction('rw', writeTables(), async () => {
    const old = (await db.photos.where('[projectId+category]').equals([projectId, category]).toArray()).filter(
      (p) => p.equipmentId === equipmentId,
    );
    for (const p of old) await deleteRecord('photos', p.id);
    const photo = await addPhoto(projectId, file, { category, equipmentId });
    if (old[0]) await setField('photos', photo.id, 'order', sortKey(old[0]));
    return (await db.photos.get(photo.id))!;
  });
}

/** Move a photo one place earlier (-1) or later (+1) within its group (swaps sort keys with the neighbour). */
export async function movePhoto(photoId: string, dir: -1 | 1): Promise<void> {
  await db.transaction('rw', writeTables(), async () => {
    const photo = await db.photos.get(photoId);
    if (!photo) return;
    const key = groupKeyOf(photo);
    const group = (await db.photos.where('projectId').equals(photo.projectId).toArray())
      .filter((p) => groupKeyOf(p) === key)
      .sort(comparePhotos);
    const i = group.findIndex((p) => p.id === photoId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= group.length) return;
    // renumber the whole group 1..n in the new order (sort keys may tie for legacy photos)
    [group[i], group[j]] = [group[j], group[i]];
    for (let k = 0; k < group.length; k++) await setField('photos', group[k].id, 'order', k + 1);
  });
}

/** Re-attach a photo (category, equipment, issue); it moves to the end of its new group. */
export async function reassignPhoto(photoId: string, target: PhotoTarget): Promise<void> {
  await db.transaction('rw', writeTables(), async () => {
    const photo = await db.photos.get(photoId);
    if (!photo) return;
    const next = {
      category: target.category,
      equipmentId:
        target.category === 'deficiency' || target.category === 'cover' ? null : (target.equipmentId ?? null),
      issueId: target.category === 'deficiency' ? (target.issueId ?? null) : null,
    };
    const moved = groupKeyOf(next) !== groupKeyOf(photo);
    await setFields('photos', photoId, next);
    if (moved) await setField('photos', photoId, 'order', await nextPhotoOrder(photo.projectId, next, photoId));
  });
}

/** Swap an issue with its neighbour of the same kind (their numbers swap; deficiency photo labels follow). */
export async function moveIssue(issueId: string, dir: -1 | 1): Promise<void> {
  await db.transaction('rw', writeTables(), async () => {
    const issue = await db.issues.get(issueId);
    if (!issue) return;
    const same = (await db.issues.where('[projectId+kind]').equals([issue.projectId, issue.kind]).toArray()).sort(
      (a, b) => a.number - b.number,
    );
    const i = same.findIndex((x) => x.id === issueId);
    const other = same[i + dir];
    if (!other) return;
    await setField('issues', issue.id, 'number', other.number);
    await setField('issues', other.id, 'number', issue.number);
  });
}

// ------------------------------------------------------------------------------------------ instruments
export async function addInstrument(projectId: string): Promise<Instrument> {
  return db.transaction('rw', writeTables(), async () => {
    const all = await db.instruments.where('projectId').equals(projectId).toArray();
    const now = Date.now();
    return createRecord<Instrument>('instruments', {
      id: uuid(),
      projectId,
      order: all.reduce((m, i) => Math.max(m, i.order), -1) + 1,
      type: '',
      manufacturer: '',
      model: '',
      serial: '',
      calibrationDate: '',
      createdAt: now,
      updatedAt: now,
    });
  });
}
