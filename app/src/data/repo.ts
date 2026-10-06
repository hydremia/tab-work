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
import { DEFAULT_INSTRUMENTS, TEMPLATE_REVISION, tableRows } from '@a2b/workbook/map';
import type { Table } from 'dexie';
import { CERT_DEFAULTS, CERT_KEYS } from '../domain/certification';
import { computeCompletion } from '../domain/completion';
import { duplicateData, duplicateRow } from '../domain/duplicate';
import { acceptanceKey } from '../domain/review';
import { equipmentType, nextFreeSlot, workbookDef, type EquipmentTypeKey } from '../domain/equipmentTypes';
import type { PreviewRow } from '../domain/scheduleImport';
import { getSpec } from '../domain/specs';
import { airflowOnlySections } from '../domain/unitScope';
import {
  AIR_BALANCE_KEYS,
  airBalanceChecks,
  designFieldOf,
  entryTotals,
  type AirBalanceTable,
} from '../domain/airBalance';
import { designationKey } from '../domain/scheduleImport';
import { SPARE_OA_ROWS, spareOaKey } from '../domain/spareOa';
import { splitSheaveBore } from '../domain/sheaveBore';
import { isBlank } from '../domain/conditions';
import { isObservation, openDeficiencies } from '../domain/issues';
import { db } from './db';
import { appendHistory, currentActor } from './history';
import { uuid } from './uuid';
import { currentBaseSeq, getCurrentUser, getDeviceId, getUserName, nextTimestamp, setUserName } from './identity';
import { deepEqual, getPath, setPath, assertEditablePath } from './paths';
import { comparePhotos, groupKeyOf, sortKey } from '../photos/labels';
import {
  emptyNaState,
  INSTRUMENT_DETAIL_KEYS,
  ORG_TABLES,
  type AirflowRow,
  type CertProfile,
  type Equipment,
  type FieldChange,
  type HistoryEntry,
  type HistoryKind,
  type Instrument,
  type Issue,
  type IssueKind,
  type LibraryInstrument,
  type LibraryValve,
  type LibraryPump,
  type FieldValue,
  type Photo,
  type PhotoCategory,
  type Project,
  type ProjectLock,
  type ScopeProfile,
  type Signature,
  type StoredImage,
  type TableName,
} from './types';
import { hoodLinks } from '../domain/equipmentCalcs';

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
  db.libraryInstruments,
  db.certProfiles,
  db.libraryValves,
  db.libraryPumps,
];

/** Where a write comes from (recorded in the history). */
export interface WriteOptions {
  source?: HistoryEntry['source'];
  note?: string;
  /** Don't clear a review (bookkeeping such as an automatic slot move, which changes nothing the reviewer saw). */
  keepReview?: boolean;
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

/** The project a record's changes are filed under (a library instrument, which has none: its own id). */
function projectIdOf(name: TableName, rec: AnyRecord): string {
  return name === 'projects' || ORG_TABLES.includes(name) ? rec.id : (rec.projectId ?? '');
}

/** The unit a record belongs to: the unit itself, or a row / photo / issue linked to it. */
export function unitOf(name: TableName, rec: AnyRecord): string | null {
  if (name === 'equipment') return rec.id;
  if (name === 'airflowRows' || name === 'photos' || name === 'issues')
    return (rec as unknown as { equipmentId?: string | null }).equipmentId ?? null;
  return null;
}

/** Short description of a record for create / delete history entries. */
export function describeRecord(name: TableName, rec: AnyRecord): string {
  const r = rec as unknown as Record<string, unknown>;
  switch (name) {
    case 'projects':
      return String(r.name ?? '');
    case 'equipment':
      return String(r.designation ?? '');
    case 'issues':
      return `${r.issueType === 'observation' ? 'Observation' : 'Issue'} ${r.kind === 'existing' ? 'E' : 'N'}-${String(r.number ?? '')}`;
    case 'airflowRows': {
      const no = (r.data as Record<string, unknown> | undefined)?.no;
      return `${String(r.table ?? '')} row${no ? ` ${String(no)}` : ''}`;
    }
    case 'photos':
      return `${String(r.category ?? '')} photo`;
    case 'instruments':
      return String(r.type || 'instrument');
    case 'libraryInstruments':
      return `Library: ${String(r.type || 'instrument')}`;
    case 'certProfiles':
      return 'Certification profile';
    case 'libraryValves':
      return `Library valve: ${[r.make, r.model, r.size].filter(Boolean).join(' ') || 'valve'}`;
    case 'libraryPumps':
      return `Library pump: ${[r.make, r.model, r.size].filter(Boolean).join(' ') || 'pump'}`;
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

/** Log a change made by the sync itself on this device (e.g. unlinking a record from a unit another device deleted). */
export async function logSyncChange(
  partial: Pick<FieldChange, 'projectId' | 'table' | 'recordId' | 'op' | 'field' | 'value'>,
): Promise<void> {
  await db.fieldChanges.add(await change(partial, nextTimestamp()));
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
  if (opts.source === 'remote' || opts.keepReview) return;
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
        note: describeRecord(table, rec),
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
            note: describeRecord(name, r),
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
          // the issue becomes "General (N/A)"
          await setFields(
            'issues',
            i.id,
            { equipmentId: null, ...(i.airflowRowId ? { airflowRowId: null } : {}) },
            opts,
          );
        }
      } else if (table === 'airflowRows') {
        // issues and photos of the line stay on its unit
        const unit = (rec as unknown as AirflowRow).equipmentId;
        for (const i of await db.issues.where('equipmentId').equals(unit).toArray())
          if (i.airflowRowId === recordId) await setField('issues', i.id, 'airflowRowId', null, opts);
        for (const p of await db.photos.where('equipmentId').equals(unit).toArray())
          if (p.airflowRowId === recordId) await setField('photos', p.id, 'airflowRowId', null, opts);
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
    super(`${designation} is not complete yet (required items missing), so it can't be marked reviewed.`);
    this.name = 'NotCompleteError';
  }
}

/** Has the unit every required item entered right now (green, or red with callouts)? The same completion the UI shows. */
export async function isUnitComplete(equipmentId: string): Promise<boolean> {
  const unit = await db.equipment.get(equipmentId);
  if (!unit) return false;
  const [project, rows, photos, issues, units] = await Promise.all([
    db.projects.get(unit.projectId),
    db.airflowRows.where('equipmentId').equals(equipmentId).toArray(),
    db.photos.where('equipmentId').equals(equipmentId).toArray(),
    db.issues.where('equipmentId').equals(equipmentId).toArray(),
    unit.type === 'fan' ? db.equipment.where('projectId').equals(unit.projectId).toArray() : Promise.resolve([]),
  ]);
  if (!project) return false;
  return computeCompletion({
    spec: getSpec(unit.type),
    unit,
    rows,
    photos,
    project,
    openIssues: openDeficiencies(issues).length,
    hoodLinked: hoodLinks(units).has(unit.id),
  }).complete;
}

/**
 * Sign a complete unit off as reviewed and accepted (any user, decision F4; a red unit's callouts stay on the report). `name` (optional) is remembered on this device as the
 * reviewer name. The review is a synced field (`review`: name, user, device, time).
 */
export async function markReviewed(equipmentId: string, name?: string): Promise<void> {
  if (name !== undefined && name.trim()) await setUserName(name);
  const unit = await db.equipment.get(equipmentId);
  if (!unit) throw new Error('unit not found');
  if (!(await isUnitComplete(equipmentId))) throw new NotCompleteError(unit.designation);
  await setField('equipment', equipmentId, 'review', await signature());
}

export async function clearReview(equipmentId: string): Promise<void> {
  await setField('equipment', equipmentId, 'review', null);
}

/**
 * Accept a report check's findings (a "Check" line): project info `accept_<key>` holds who, when and the findings'
 * fingerprint (domain/review.ts checkAcceptance), synced like any project field.
 */
export async function acceptCheck(projectId: string, checkKey: string, fp: string, name?: string): Promise<void> {
  if (name !== undefined && name.trim()) await setUserName(name);
  const { name: who, at } = await signature();
  await setField('projects', projectId, `info.${acceptanceKey(checkKey)}`, JSON.stringify({ name: who, at, fp }));
}

export async function clearCheckAcceptance(projectId: string, checkKey: string): Promise<void> {
  await setField('projects', projectId, `info.${acceptanceKey(checkKey)}`, null);
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
  const profile = await getCertProfile();
  const project: Project = {
    id: uuid(),
    name: input.name.trim(),
    scopeProfile: input.scopeProfile ?? 'full',
    customScope: {},
    tolerance: 0.1,
    reportKind: 'prelim',
    // the template's certified professional (Certification sheet); signature and date are filled on the final report
    // (the organization's certification profile when there is one)
    info: { address: input.address?.trim() || null, tabDate: input.tabDate || null, ...certDefaults(profile) },
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
  const block = workbookDef(type)?.block;
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
 * An RTU's design OA goes on its outside-air row too (the Building Balance design OA reads that row): a new row when
 * it has none, else the design of its only row when blank. Inside a write transaction.
 */
async function ensureOaRow(unitId: string, cfm: number): Promise<void> {
  if (!(cfm > 0)) return;
  const oaRows = (await db.airflowRows.where('equipmentId').equals(unitId).toArray()).filter((x) => x.table === 'oa');
  if (!oaRows.length) {
    const unit = await db.equipment.get(unitId);
    if (unit?.type === 'rtu') await addAirflowRow(unit, 'oa', { no: 'OA', area: 'Outside air', designCfm: cfm });
  } else if (oaRows.length === 1 && oaRows[0].data.designCfm == null)
    await setField('airflowRows', oaRows[0].id, 'data.designCfm', cfm, { source: 'schedule' });
}

/**
 * Create / update units from a schedule import preview (domain/scheduleImport.ts) in one transaction: a new unit is
 * created (next free slot, like "Add equipment"), then every value goes through setField; an existing unit (same
 * designation) gets only the values the schedule has (blank schedule cells never clear app values). Rows with
 * action 'skip' are ignored.
 */
export async function applyScheduleImport(
  projectId: string,
  type: EquipmentTypeKey,
  rows: readonly (Pick<PreviewRow, 'action' | 'designation' | 'values' | 'existingId'> & {
    scope?: PreviewRow['scope'];
  })[],
  opts: {
    /** New / Existing for rows the schedule gives no scope (default New). */
    isExisting?: boolean;
    /** Existing units are airflow only: their non-airflow sections (unit, motor, drive, ...) are marked N/A. */
    existingAirflowOnly?: boolean;
    /**
     * Units the schedule marks existing are New for this project (a TI set of a new building: the shell's rooftop
     * units show as existing, but this project tests them in full).
     */
    existingAsNew?: boolean;
  } = {},
): Promise<{ created: Equipment[]; updated: number }> {
  const naSections = opts.existingAirflowOnly ? airflowOnlySections(type) : [];
  return db.transaction('rw', writeTables(), async () => {
    const created: Equipment[] = [];
    let updated = 0;
    for (const r of rows) {
      if (r.action === 'skip' || r.scope === 'removed') continue;
      const isExisting = r.scope ? r.scope === 'existing' && !opts.existingAsNew : (opts.isExisting ?? false);
      let id = r.existingId;
      if (r.action === 'create') {
        const unit = await addEquipment(projectId, type, r.designation, isExisting);
        created.push(unit);
        id = unit.id;
      } else {
        updated++;
        // the schedule says new or existing: the unit follows it
        if (id && r.scope) {
          const cur = await db.equipment.get(id);
          if (cur && cur.isExisting !== isExisting) await setField('equipment', id, 'isExisting', isExisting);
        }
      }
      if (!id) continue;
      for (const [k, v] of Object.entries(r.values)) {
        if (v === null || v === '') continue;
        await setField('equipment', id, `data.${k}`, v, { source: 'schedule' });
      }
      if (type === 'rtu' && typeof r.values.designOaCfm === 'number') await ensureOaRow(id, r.values.designOaCfm);
      if (isExisting && r.action === 'create')
        for (const key of naSections)
          await setField('equipment', id, `naState.sections.${key}`, {
            notation: 'N/A',
            reason: 'existing unit, airflow only',
          });
    }
    return { created, updated };
  });
}

/**
 * The engineer's air balance table (domain/airBalance) into the project: blank design CFMs filled from it, the units
 * it lists that the project does not have added as Existing (with its design CFM; airflow only on request; an OA
 * source that is no unit type goes to a spare "Other outside air" row), and its totals kept on the project. A unit
 * whose design CFM differs is left as it is (the check shows it).
 */
export async function applyAirBalance(
  projectId: string,
  table: AirBalanceTable,
  opts: {
    fillBlank?: boolean;
    addMissing?: boolean;
    existingAirflowOnly?: boolean;
    /** Units only in the air balance are New (shell & TI: installed under the shell), not Existing. */
    missingAsNew?: boolean;
    source?: string;
  } = {},
): Promise<{ filled: number; added: Equipment[]; spareRows: number; notAdded: string[] }> {
  return db.transaction('rw', writeTables(), async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('project not found');
    const units = await db.equipment.where('projectId').equals(projectId).toArray();
    const { checks } = airBalanceChecks(table, units);
    let filled = 0;
    const added: Equipment[] = [];
    const notAdded: string[] = [];
    let spareRows = 0;
    const addedByKey = new Map<string, Equipment>();
    const info = { ...project.info };
    const setInfo = async (k: string, v: FieldValue) => {
      info[k] = v;
      await setField('projects', projectId, `info.${k}`, v);
    };
    for (const c of checks) {
      if (c.status === 'blank' && opts.fillBlank && c.unit && c.field) {
        await setField('equipment', (c.unit as Equipment).id, `data.${c.field}`, c.entry.cfm, { source: 'schedule' });
        if (c.field === 'designOaCfm') await ensureOaRow((c.unit as Equipment).id, c.entry.cfm);
        filled++;
      }
      if (c.status !== 'missing' || !opts.addMissing) continue;
      const key = designationKey(c.entry.designation);
      const type = c.suggestType;
      if (!type) {
        if (c.entry.side === 'oa') {
          let n = 1;
          while (n <= SPARE_OA_ROWS && !isBlank(info[spareOaKey(n, 'Unit')] ?? null)) n++;
          if (n <= SPARE_OA_ROWS) {
            await setInfo(spareOaKey(n, 'Unit'), c.entry.designation);
            await setInfo(spareOaKey(n, 'Design'), c.entry.cfm);
            spareRows++;
            continue;
          }
        }
        notAdded.push(c.entry.designation);
        continue;
      }
      let unit = addedByKey.get(key);
      if (!unit) {
        try {
          unit = await addEquipment(projectId, type, c.entry.designation, !opts.missingAsNew);
        } catch (err) {
          if (err instanceof CapacityError) {
            notAdded.push(c.entry.designation);
            continue;
          }
          throw err;
        }
        addedByKey.set(key, unit);
        added.push(unit);
        if (opts.existingAirflowOnly && !opts.missingAsNew)
          for (const k of airflowOnlySections(type))
            await setField('equipment', unit.id, `naState.sections.${k}`, {
              notation: 'N/A',
              reason: 'existing unit, airflow only',
            });
      }
      const field = designFieldOf(unit.type, c.entry.side);
      if (field) await setField('equipment', unit.id, `data.${field}`, c.entry.cfm, { source: 'schedule' });
      if (field === 'designOaCfm') await ensureOaRow(unit.id, c.entry.cfm);
    }
    const sums = entryTotals(table);
    await setInfo(AIR_BALANCE_KEYS.oa, table.totalOa ?? sums.oa);
    await setInfo(AIR_BALANCE_KEYS.exhaust, table.totalExhaust ?? sums.exhaust);
    await setInfo(AIR_BALANCE_KEYS.net, table.net ?? (table.totalOa ?? sums.oa) - (table.totalExhaust ?? sums.exhaust));
    await setInfo(AIR_BALANCE_KEYS.source, opts.source ?? 'Air balance table');
    await setInfo(AIR_BALANCE_KEYS.excluded, table.excluded.length ? table.excluded.join(', ') : null);
    return { filled, added, spareRows, notAdded };
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
  input: Partial<
    Pick<Issue, 'kind' | 'remark' | 'status' | 'comments' | 'equipmentId' | 'airflowRowId' | 'issueType'>
  > = {},
): Promise<Issue> {
  return db.transaction('rw', writeTables(), async () => {
    const kind: IssueKind = input.kind ?? 'new';
    const observation = input.issueType === 'observation';
    // deficiencies and observations are numbered separately within New / Existing
    const same = (await db.issues.where('[projectId+kind]').equals([projectId, kind]).toArray()).filter(
      (i) => isObservation(i) === observation,
    );
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
      // only for observations: a deficiency keeps the record shape every server knows
      ...(observation ? { issueType: 'observation' as const } : {}),
      // only when set: a project whose server has no 0011 yet keeps syncing issues without lines
      ...(input.airflowRowId && input.equipmentId ? { airflowRowId: input.airflowRowId } : {}),
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
  /** an airflow line of that unit (not for cover / deficiency photos) */
  airflowRowId?: string | null;
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

/** The airflow line a photo target names: only a unit photo (not cover / deficiency / general) has one. */
const lineOf = (t: PhotoTarget): string | null =>
  t.category !== 'deficiency' && t.category !== 'cover' && t.equipmentId && t.airflowRowId ? t.airflowRowId : null;

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
    const line = lineOf(target);
    const photo = await createRecord<Photo>('photos', {
      id: uuid(),
      projectId,
      ...base,
      ...(line ? { airflowRowId: line } : {}),
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
    const line = lineOf(target);
    const moved = groupKeyOf(next) !== groupKeyOf(photo);
    await setFields('photos', photoId, {
      ...next,
      ...(line || photo.airflowRowId ? { airflowRowId: line } : {}),
    });
    if (moved) await setField('photos', photoId, 'order', await nextPhotoOrder(photo.projectId, next, photoId));
  });
}

/**
 * Deficiency <-> observation: the issue takes the next number of its new list (Obs. N-4 -> N-7); the old list keeps
 * its numbers (a gap, as after a delete).
 */
export async function setIssueType(issueId: string, type: 'deficiency' | 'observation'): Promise<void> {
  await db.transaction('rw', writeTables(), async () => {
    const issue = await db.issues.get(issueId);
    if (!issue || (type === 'observation') === isObservation(issue)) return;
    const same = (await db.issues.where('[projectId+kind]').equals([issue.projectId, issue.kind]).toArray()).filter(
      (x) => x.id !== issueId && isObservation(x) === (type === 'observation'),
    );
    await setFields('issues', issueId, {
      issueType: type,
      number: same.reduce((m, x) => Math.max(m, x.number), 0) + 1,
    });
  });
}

/** Swap an issue with its neighbour of the same kind (their numbers swap; deficiency photo labels follow). */
export async function moveIssue(issueId: string, dir: -1 | 1): Promise<void> {
  await db.transaction('rw', writeTables(), async () => {
    const issue = await db.issues.get(issueId);
    if (!issue) return;
    const same = (await db.issues.where('[projectId+kind]').equals([issue.projectId, issue.kind]).toArray())
      .filter((x) => isObservation(x) === isObservation(issue))
      .sort((a, b) => a.number - b.number);
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

// ------------------------------------------------------------------------------------------ calibration library
/** Room on the Calibration sheet. */
export const CALIBRATION_SLOTS = 8;

type InstrumentDetails = Pick<LibraryInstrument, (typeof INSTRUMENT_DETAIL_KEYS)[number]>;

const detailsOf = (x: InstrumentDetails): InstrumentDetails =>
  Object.fromEntries(INSTRUMENT_DETAIL_KEYS.map((k) => [k, x[k] ?? ''])) as InstrumentDetails;

/** The project row's details differ from its library instrument's (the library was edited since, or the row). */
export function differsFromLibrary(ins: Instrument, lib: LibraryInstrument | undefined): boolean {
  return Boolean(lib) && INSTRUMENT_DETAIL_KEYS.some((k) => (ins[k] ?? '') !== (lib![k] ?? ''));
}

/** A new library instrument (synced like any record; its changes are filed under its own id). */
export async function addLibraryInstrument(details: Partial<InstrumentDetails & { notes: string }> = {}) {
  const now = Date.now();
  return createRecord<LibraryInstrument>('libraryInstruments', {
    id: uuid(),
    type: details.type ?? '',
    manufacturer: details.manufacturer ?? '',
    model: details.model ?? '',
    serial: details.serial ?? '',
    calibrationDate: details.calibrationDate ?? '',
    notes: details.notes ?? '',
    createdAt: now,
    updatedAt: now,
  });
}

/** Deleting a library instrument unlinks the project rows copied from it (their own details stay as they are). */
export async function deleteLibraryInstrument(libId: string): Promise<void> {
  await db.transaction('rw', writeTables(), async () => {
    for (const ins of await db.instruments.toArray()) {
      if (ins.libraryId !== libId) continue;
      const project = await db.projects.get(ins.projectId);
      if (project?.lock) continue; // an issued report is frozen; the dangling link is harmless
      await setField('instruments', ins.id, 'libraryId', null);
    }
    await deleteRecord('libraryInstruments', libId);
  });
}

/** A new library valve (synced like the calibration library; its changes are filed under its own id). */
export async function addLibraryValve(v: Partial<Omit<LibraryValve, 'id' | 'createdAt' | 'updatedAt'>> = {}) {
  const now = Date.now();
  return createRecord<LibraryValve>('libraryValves', {
    id: uuid(),
    make: v.make ?? '',
    model: v.model ?? '',
    size: v.size ?? '',
    valveType: v.valveType ?? '',
    cvTable: v.cvTable ?? null,
    ratedGpm: v.ratedGpm ?? null,
    dpMin: v.dpMin ?? null,
    dpMax: v.dpMax ?? null,
    source: v.source ?? '',
    notes: v.notes ?? '',
    createdAt: now,
    updatedAt: now,
  });
}

/** Deleting a library valve leaves the valve rows picked from it as they are (their make / model / size stay). */
export async function deleteLibraryValve(id: string): Promise<void> {
  await deleteRecord('libraryValves', id);
}

/** Copy a library instrument into one of the project's calibration slots (the project keeps its own copy). */
export async function addInstrumentFromLibrary(projectId: string, libId: string): Promise<Instrument> {
  return db.transaction('rw', writeTables(), async () => {
    const lib = await db.libraryInstruments.get(libId);
    if (!lib) throw new Error('library instrument not found');
    const all = await db.instruments.where('projectId').equals(projectId).toArray();
    if (all.length >= CALIBRATION_SLOTS)
      throw new CapacityError(`The Calibration sheet has room for ${CALIBRATION_SLOTS} instruments.`);
    const now = Date.now();
    return createRecord<Instrument>('instruments', {
      id: uuid(),
      projectId,
      order: all.reduce((m, i) => Math.max(m, i.order), -1) + 1,
      ...detailsOf(lib),
      libraryId: lib.id,
      createdAt: now,
      updatedAt: now,
    });
  });
}

/** Save a project instrument to the library (a new library instrument, linked to the row). */
export async function saveInstrumentToLibrary(instrumentId: string): Promise<LibraryInstrument> {
  return db.transaction('rw', writeTables(), async () => {
    const ins = await db.instruments.get(instrumentId);
    if (!ins) throw new Error('instrument not found');
    const lib = await addLibraryInstrument(detailsOf(ins));
    await setField('instruments', ins.id, 'libraryId', lib.id);
    return lib;
  });
}

/** Take the library's current details into the project row ("Update from library"; each detail is a field change). */
export async function updateInstrumentFromLibrary(instrumentId: string): Promise<void> {
  await db.transaction('rw', writeTables(), async () => {
    const ins = await db.instruments.get(instrumentId);
    const lib = ins?.libraryId ? await db.libraryInstruments.get(ins.libraryId) : undefined;
    if (!ins || !lib) throw new Error('library instrument not found');
    for (const k of INSTRUMENT_DETAIL_KEYS) await setField('instruments', ins.id, k, lib[k] ?? '');
  });
}

// ------------------------------------------------------------------------------------------ certification profile
/** The organization's certification profile: the oldest one (two devices may each have created one before syncing). */
export async function getCertProfile(): Promise<CertProfile | undefined> {
  return (await certProfilesOldestFirst())[0];
}

/** Oldest first (ties by id, the same on every device). */
async function certProfilesOldestFirst(): Promise<CertProfile[]> {
  return (await db.certProfiles.toArray()).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

const CERT_PROFILE_FIELDS = ['cpName', 'certNumber', 'expiration', 'stamp', 'signature'] as const;
const emptyValue = (v: unknown) => v === null || v === undefined || v === '';

/**
 * Two devices each created a profile before syncing (the oldest one is used): what the newer ones have and the oldest
 * lacks moves into the oldest; a different value becomes a sync conflict on the oldest (Keep current / Use the other,
 * on the certification page); then the newer ones are deleted. Run after each pull. Returns how many were merged.
 */
export async function mergeCertProfiles(): Promise<number> {
  const [keep, ...rest] = await certProfilesOldestFirst();
  if (!keep || !rest.length) return 0;
  await db.transaction('rw', writeTables(), async () => {
    for (const dup of rest) {
      for (const k of CERT_PROFILE_FIELDS) {
        const mine = (await db.certProfiles.get(keep.id))?.[k];
        const theirs = dup[k];
        if (emptyValue(theirs) || deepEqual(mine, theirs)) continue;
        if (emptyValue(mine)) {
          await setField('certProfiles', keep.id, k, theirs);
          continue;
        }
        const side = (value: unknown, ts: number) => ({
          value,
          ts,
          userId: '',
          deviceId: '',
          local: false,
          changeId: '',
        });
        await db.conflicts.add({
          id: uuid(),
          projectId: keep.id,
          kind: 'field',
          table: 'certProfiles',
          recordId: keep.id,
          equipmentId: null,
          field: k,
          current: side(mine, keep.updatedAt),
          other: side(theirs, dup.updatedAt),
          status: 'open',
          detectedAt: Date.now(),
        });
      }
      await deleteRecord('certProfiles', dup.id);
    }
  });
  return rest.length;
}

/** The certification profile, created from the template's CP when there is none yet. */
export async function ensureCertProfile(): Promise<CertProfile> {
  return db.transaction('rw', writeTables(), async () => {
    const existing = await getCertProfile();
    if (existing) return existing;
    const now = Date.now();
    return createRecord<CertProfile>('certProfiles', {
      id: uuid(),
      cpName: CERT_DEFAULTS[CERT_KEYS.cpName],
      certNumber: CERT_DEFAULTS[CERT_KEYS.number],
      expiration: CERT_DEFAULTS[CERT_KEYS.expiration],
      stamp: null,
      signature: null,
      createdAt: now,
      updatedAt: now,
    });
  });
}

/** The CP lines a new project starts with: the profile's (blank profile values fall back to the template's). */
export function certDefaults(profile: CertProfile | undefined): Record<string, string> {
  if (!profile) return { ...CERT_DEFAULTS };
  return {
    [CERT_KEYS.cpName]: profile.cpName || CERT_DEFAULTS[CERT_KEYS.cpName],
    [CERT_KEYS.number]: profile.certNumber || CERT_DEFAULTS[CERT_KEYS.number],
    [CERT_KEYS.expiration]: profile.expiration || CERT_DEFAULTS[CERT_KEYS.expiration],
  };
}

/** Set / remove the stamp or signature image of the profile (a normal synced field). */
export async function setCertImage(kind: 'stamp' | 'signature', image: StoredImage | null): Promise<void> {
  const profile = await ensureCertProfile();
  await setField('certProfiles', profile.id, kind, image);
}

export async function addLibraryPump(p: Partial<Omit<LibraryPump, 'id' | 'createdAt' | 'updatedAt'>> = {}) {
  const now = Date.now();
  return createRecord<LibraryPump>('libraryPumps', {
    id: uuid(),
    make: p.make ?? '',
    model: p.model ?? '',
    size: p.size ?? '',
    rpm: p.rpm ?? null,
    curves: p.curves ?? null,
    source: p.source ?? '',
    notes: p.notes ?? '',
    createdAt: now,
    updatedAt: now,
  });
}

export async function deleteLibraryPump(id: string): Promise<void> {
  await deleteRecord('libraryPumps', id);
}

/**
 * A unit entered before the motor and fan bores were separate fields: its "Sheave bore M/F" (motor / fan) is split
 * once into the two (domain/sheaveBore.ts), as ordinary synced edits. A bore already entered in the new fields wins;
 * the old value is cleared either way. Not on an issued (locked) project.
 */
export async function splitLegacySheaveBore(unit: Equipment): Promise<boolean> {
  const legacy = unit.data.sheaveBore;
  const mark = unit.naState.fields.sheaveBore;
  if ((legacy === undefined || legacy === null) && !mark) return false;
  const opts: WriteOptions = {
    source: 'auto',
    note: 'Sheave bore M/F split into the motor and fan bores',
    keepReview: true,
  };
  const values: Record<string, unknown> = {};
  const free = (k: string) => isBlank(unit.data[k]) && !unit.naState.fields[k];
  if (mark) {
    if (free('motorBore')) values['naState.fields.motorBore'] = mark;
    if (free('fanBore')) values['naState.fields.fanBore'] = mark;
  } else {
    const split = splitSheaveBore(legacy);
    if (split && free('motorBore')) values['data.motorBore'] = split.motorBore;
    if (split?.fanBore && free('fanBore')) values['data.fanBore'] = split.fanBore;
  }
  values['data.sheaveBore'] = null;
  if (mark) values['naState.fields.sheaveBore'] = null;
  try {
    await setFields('equipment', unit.id, values, opts);
    return true;
  } catch (e) {
    if (e instanceof LockedError) return false;
    throw e;
  }
}
