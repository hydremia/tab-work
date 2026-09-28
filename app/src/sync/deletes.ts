/**
 * Deletes that meet edits they had not seen (docs/ROADMAP.md "Sync & multi-user strategy"). Field edits merge by
 * last writer wins (sync/conflicts.ts), but a delete removes the whole record, so an edit the deleting device had not
 * seen would vanish without a trace. Two cases, both flagged as a conflict of kind 'deleted' (Attention tab):
 *
 *  - another device deleted a record this device had edited (or added outlet rows / photos / issues to) since that
 *    device last pulled: the delete wins (as on the server), the conflict keeps a copy of what was deleted here, and
 *    records this device had added to a deleted unit / issue are removed (outlet rows, photos) or unlinked (issues:
 *    "General (N/A)", as when a unit is deleted on this device) so nothing points at the deleted record;
 *  - this device deleted a record another device was still editing: those edits are not applied (the record is
 *    gone); the conflict keeps the record as the log last had it.
 *
 * The conflict is resolved by keeping the delete, or by *Restore*: the record (and what went with it) is created again
 * with new ids (the server never re-creates a deleted id) from the kept copy. Photos come back only when their file
 * is on this device.
 *
 * "Had not seen" is the same test as for field conflicts (isConcurrent: log positions). Deleting a whole project is
 * not flagged (it is confirmed on the deleting device and removes everything of the project on every device).
 */
import { db } from '../data/db';
import { appendHistory } from '../data/history';
import { setPath } from '../data/paths';
import {
  CALIBRATION_SLOTS,
  CapacityError,
  createRecord,
  describeRecord,
  forgetPhotoFile,
  logSyncChange,
  unitOf,
  writeTables,
} from '../data/repo';
import {
  ORG_TABLES,
  type DeletedInfo,
  type Equipment,
  type FieldChange,
  type Photo,
  type TableName,
} from '../data/types';
import { uuid } from '../data/uuid';
import { equipmentType, nextFreeSlot } from '../domain/equipmentTypes';
import { isConcurrent, laterWins } from './conflicts';

type Rec = Record<string, unknown> & { id: string };
type Snap = DeletedInfo['records'][number];
type Change = Omit<FieldChange, 'synced'>;

/** The record an outlet row / photo belongs to: its unit, or (a deficiency photo) its issue. */
export function parentOf(table: TableName, rec: Rec): string | null {
  const r = rec as { equipmentId?: string | null; issueId?: string | null };
  if (table === 'airflowRows') return r.equipmentId ?? null;
  if (table === 'photos') return r.equipmentId ?? r.issueId ?? null;
  return null;
}

/** Every logged change of a record, oldest first. */
async function logOf(table: TableName, recordId: string): Promise<FieldChange[]> {
  const list = await db.fieldChanges
    .where('[table+recordId+field]')
    .between([table, recordId, ''], [table, recordId, '￿'], true, true)
    .toArray();
  return list.sort((a, b) => a.ts - b.ts);
}

/** The record as the local log has it (its create + every set, last writer wins); null without a create. */
export async function recordFromLog(table: TableName, recordId: string): Promise<Rec | null> {
  const log = await logOf(table, recordId);
  const create = log.find((c) => c.op === 'create');
  if (!create || !create.value || typeof create.value !== 'object') return null;
  let rec: Rec = { ...(create.value as Rec), id: recordId };
  const sets = log.filter((c) => c.op === 'set').sort((a, b) => (laterWins(a, b) ? 1 : laterWins(b, a) ? -1 : 0));
  for (const c of sets) rec = setPath(rec, c.field, c.value ?? null) as Rec;
  return rec;
}

/** Local records still linked to a unit / issue being deleted (the deleting device's own cascade came before). */
export async function linkedRecords(table: TableName, id: string): Promise<Snap[]> {
  if (table === 'equipment') {
    const [rows, photos] = await Promise.all([
      db.airflowRows.where('equipmentId').equals(id).toArray(),
      db.photos.where('equipmentId').equals(id).toArray(),
    ]);
    return [
      ...rows.map((rec) => ({ table: 'airflowRows' as const, rec: rec as unknown as Rec })),
      ...photos.map((rec) => ({ table: 'photos' as const, rec: rec as unknown as Rec })),
    ];
  }
  if (table === 'issues')
    return (await db.photos.where('issueId').equals(id).toArray()).map((rec) => ({
      table: 'photos' as const,
      rec: rec as unknown as Rec,
    }));
  return [];
}

async function addConflict(
  c: Pick<Change, 'projectId' | 'ts'>,
  table: TableName,
  rec: Rec,
  info: Omit<DeletedInfo, 'records' | 'label'>,
  records: Snap[],
): Promise<void> {
  const label = describeRecord(table, rec as never);
  const equipmentId = unitOf(table, rec as never);
  await db.conflicts.add({
    id: uuid(),
    projectId: c.projectId,
    kind: 'deleted',
    table,
    recordId: rec.id,
    equipmentId,
    field: '',
    deleted: { ...info, label, records },
    status: 'open',
    detectedAt: Date.now(),
  });
  await appendHistory({
    projectId: c.projectId,
    ts: Date.now(),
    kind: 'conflict',
    table,
    recordId: rec.id,
    equipmentId,
    field: '',
    note:
      info.by === 'other'
        ? `${label} was deleted on another device; ${info.edits} edit${info.edits === 1 ? '' : 's'} made here had not reached it`
        : `${label} was deleted here while another device was editing it`,
  });
}

/**
 * Another device's delete of `rec` arrives (inside the pull's transaction, before the record is deleted). `children`:
 * what goes with it (rows / photos deleted with it in the same pull, and records this device linked to it). Records a
 * conflict when this device had edits the deleting device had not seen. Returns 1 when one was recorded.
 */
export async function flagRemoteDelete(
  c: Change,
  table: TableName,
  rec: Rec,
  children: Snap[],
  deviceId: string,
): Promise<number> {
  let edits = 0;
  for (const { table: t, rec: r } of [{ table, rec }, ...children])
    for (const m of await logOf(t, r.id))
      if (m.deviceId === deviceId && m.op !== 'delete' && isConcurrent(m, c)) edits++;
  if (!edits) return 0;
  await addConflict(c, table, rec, { by: 'other', edits, ts: c.ts }, [{ table, rec }, ...children]);
  return 1;
}

/**
 * After another device deleted a unit / issue: what this device had linked to it and the deleting device could not
 * know about. Outlet rows and photos go (as they would have with the delete); issues are unlinked (General). Their
 * waiting changes leave the outbox; a record the server already has gets a delete / unlink of its own.
 */
export async function dropLinked(table: TableName, id: string, linked: Snap[]): Promise<void> {
  for (const { table: t, rec } of linked) {
    await db.table(t).delete(rec.id);
    if (t === 'photos') await forgetPhotoFile(rec.id);
    const log = await logOf(t, rec.id);
    const waiting = log.filter((x) => x.synced !== 1);
    await db.fieldChanges.bulkDelete(waiting.map((x) => x.id));
    if (log.some((x) => x.synced === 1))
      await logSyncChange({
        projectId: String(rec.projectId ?? ''),
        table: t,
        recordId: rec.id,
        op: 'delete',
        field: '',
        value: null,
      });
  }
  if (table !== 'equipment') return;
  for (const issue of await db.issues.where('equipmentId').equals(id).toArray()) {
    await db.issues.put({ ...issue, equipmentId: null });
    let createFixed = false;
    for (const x of await logOf('issues', issue.id)) {
      if (x.synced === 1) continue;
      if (x.op === 'create' && x.value && typeof x.value === 'object') {
        await db.fieldChanges.update(x.id, { value: { ...(x.value as Rec), equipmentId: null } });
        createFixed = true;
      } else if (x.op === 'set' && x.field === 'equipmentId') await db.fieldChanges.delete(x.id);
    }
    if (!createFixed)
      await logSyncChange({
        projectId: issue.projectId,
        table: 'issues',
        recordId: issue.id,
        op: 'set',
        field: 'equipmentId',
        value: null,
      });
  }
}

/** This device's delete of a record, when the log has one. */
async function ownDelete(table: TableName, id: string, deviceId: string): Promise<FieldChange | undefined> {
  return (await logOf(table, id)).find((x) => x.op === 'delete' && x.deviceId === deviceId);
}

/**
 * The link of a created record (outlet row / photo: its unit or issue; issue: its unit) whose target is gone on this
 * device because this device deleted it. null: none.
 */
export async function goneParent(
  table: TableName,
  value: unknown,
  deviceId: string,
): Promise<{ key: 'equipmentId' | 'issueId'; table: TableName; id: string } | null> {
  if (!value || typeof value !== 'object') return null;
  const v = value as { equipmentId?: unknown; issueId?: unknown };
  const links: [key: 'equipmentId' | 'issueId', t: TableName, id: unknown][] = [];
  if (table === 'airflowRows' || table === 'photos' || table === 'issues')
    links.push(['equipmentId', 'equipment', v.equipmentId]);
  if (table === 'photos') links.push(['issueId', 'issues', v.issueId]);
  for (const [key, t, id] of links) {
    if (typeof id !== 'string' || !id || (await db.table(t).get(id))) continue;
    if (await ownDelete(t, id, deviceId)) return { key, table: t, id };
  }
  return null;
}

/** A pending restore copy: apply another device's later edit to it too. */
function withChange(records: Snap[], c: Change): Snap[] {
  if (c.op !== 'set') return records;
  return records.map((r) =>
    r.table === c.table && r.rec.id === c.recordId ? { ...r, rec: setPath(r.rec, c.field, c.value ?? null) as Rec } : r,
  );
}

/**
 * Another device's change of a record this device deleted (not applied: the record is gone), or another device's new
 * outlet row / photo in a unit (issue) deleted here. It counts for the unit when the record went with it. The
 * conflict's copy takes the change, so a restore brings the latest values back. Returns 1 when a new conflict was
 * recorded (a later change only adds to its count).
 */
export async function flagLocalDelete(c: Change, deviceId: string): Promise<number> {
  let table = c.table;
  let id = c.recordId;
  let extra: Snap | null = null;
  if (c.op === 'create') {
    const gone = await goneParent(c.table, c.value, deviceId);
    if (!gone || c.table === 'issues') return 0;
    table = gone.table;
    id = gone.id;
    extra = { table: c.table, rec: { ...(c.value as Rec), id: c.recordId } };
  } else {
    const own = await recordFromLog(c.table, c.recordId);
    const unitId =
      own && (c.table === 'airflowRows' || c.table === 'photos') ? (own.equipmentId as string | null) : null;
    if (unitId && (await ownDelete('equipment', unitId, deviceId))) {
      table = 'equipment';
      id = unitId;
    } else if (c.table === 'photos') return 0; // a photo deleted here on its own: its file is gone, nothing to restore
  }
  const mine = await ownDelete(table, id, deviceId);
  if (!mine || !isConcurrent(mine, c)) return 0;
  const open = (await db.conflicts.where('recordId').equals(id).toArray()).find(
    (x) => x.status === 'open' && x.kind === 'deleted' && x.deleted?.by === 'this',
  );
  if (open?.deleted) {
    const records = withChange(open.deleted.records, c);
    await db.conflicts.update(open.id, {
      deleted: { ...open.deleted, edits: open.deleted.edits + 1, records: extra ? [...records, extra] : records },
    });
    return 0;
  }
  const rec = await recordFromLog(table, id);
  if (!rec) return 0;
  let records: Snap[] = [{ table, rec }];
  if (table === 'equipment') {
    // its outlet rows as the log had them (photos: their files are gone with the delete)
    const rowIds = new Set(
      (await db.fieldChanges.where('projectId').equals(c.projectId).toArray())
        .filter(
          (x) =>
            x.table === 'airflowRows' &&
            x.op === 'create' &&
            (x.value as { equipmentId?: string } | null)?.equipmentId === id,
        )
        .map((x) => x.recordId),
    );
    for (const rowId of rowIds) {
      if (!(await ownDelete('airflowRows', rowId, deviceId))) continue;
      const row = await recordFromLog('airflowRows', rowId);
      if (row) records.push({ table: 'airflowRows', rec: row });
    }
  }
  records = withChange(records, c);
  if (extra) records.push(extra);
  await addConflict(c, table, records[0].rec, { by: 'this', edits: 1, ts: mine.ts }, records);
  return 1;
}

/** This device's changes of a record deleted by another device that had not reached the server: moot now. */
export async function dropWaiting(table: TableName, recordId: string): Promise<void> {
  const waiting = (await logOf(table, recordId)).filter((x) => x.synced !== 1 && x.op !== 'delete');
  await db.fieldChanges.bulkDelete(waiting.map((x) => x.id));
}

/**
 * A record created by a restore names what it replaces (`restoredFrom`, kept in the log only): a device with an open
 * 'deleted' conflict for that record resolves it when the restored record arrives, so it is not restored twice.
 */
export async function settleRestored(restoredFrom: string): Promise<void> {
  for (const x of await db.conflicts.where('recordId').equals(restoredFrom).toArray())
    if (x.status === 'open' && x.kind === 'deleted')
      await db.conflicts.update(x.id, { status: 'resolved', resolvedAt: Date.now(), resolution: 'superseded' });
}

export class RestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreError';
  }
}

export interface RestoreResult {
  /** The restored record's new id. */
  id: string;
  restored: number;
  /** Photos whose file is not on this device (not restored). */
  photosSkipped: number;
}

/**
 * Restore a deleted record (conflict of kind 'deleted') with new ids: a unit gets the next free workbook slot, an
 * issue the next number when its own is taken, a calibration instrument the next free slot. Normal creates: they
 * sync, and are refused while the project is locked.
 */
export async function restoreDeleted(conflictId: string): Promise<RestoreResult> {
  const c = await db.conflicts.get(conflictId);
  if (!c || c.kind !== 'deleted' || !c.deleted || c.status !== 'open') throw new RestoreError('Nothing to restore.');
  const d = c.deleted;
  const now = Date.now();
  const [main, ...children] = d.records;
  return db.transaction('rw', writeTables(), async () => {
    const isLib = ORG_TABLES.includes(main.table);
    if (!isLib && !(await db.projects.get(c.projectId))) throw new RestoreError('The project was deleted.');
    const ids = new Map<string, string>();
    const fresh = (rec: Rec): Rec => {
      const id = uuid();
      ids.set(rec.id, id);
      return { ...rec, id, createdAt: now, updatedAt: now };
    };
    const exists = async (t: TableName, id: unknown) => typeof id === 'string' && Boolean(await db.table(t).get(id));
    let rec = fresh(main.rec);
    switch (main.table) {
      case 'equipment': {
        const unit = rec as unknown as Equipment;
        const info = equipmentType(unit.type);
        const taken = (await db.equipment.where('[projectId+type]').equals([c.projectId, unit.type]).toArray()).map(
          (e) => e.slot,
        );
        const slot = taken.includes(unit.slot) ? nextFreeSlot(taken, info.capacity) : unit.slot;
        if (slot === null) throw new CapacityError(`The workbook has room for ${info.capacity} ${info.plural}.`);
        rec = { ...rec, slot, review: null, slotMove: null };
        break;
      }
      case 'issues': {
        const kind = rec.kind as string;
        const same = await db.issues.where('[projectId+kind]').equals([c.projectId, kind]).toArray();
        if (same.some((i) => i.number === rec.number))
          rec = { ...rec, number: same.reduce((m, i) => Math.max(m, i.number), 0) + 1 };
        if (!(await exists('equipment', rec.equipmentId))) rec = { ...rec, equipmentId: null };
        break;
      }
      case 'airflowRows':
        if (!(await exists('equipment', rec.equipmentId)))
          throw new RestoreError('Its unit was deleted too, so the row cannot be restored on its own.');
        break;
      case 'photos':
        if (!(rec as unknown as Photo).blob) throw new RestoreError('The photo file is not on this device.');
        if (!(await exists('equipment', rec.equipmentId))) rec = { ...rec, equipmentId: null };
        if (!(await exists('issues', rec.issueId))) rec = { ...rec, issueId: null };
        break;
      case 'instruments': {
        const used = new Set(
          (await db.instruments.where('projectId').equals(c.projectId).toArray()).map((i) => i.order),
        );
        if (used.has(rec.order as number)) {
          let free = 0;
          while (used.has(free)) free++;
          if (free >= CALIBRATION_SLOTS)
            throw new RestoreError(`The Calibration sheet has room for ${CALIBRATION_SLOTS} instruments.`);
          rec = { ...rec, order: free };
        }
        break;
      }
      default:
        break;
    }
    const created: Rec[] = [];
    const put = async (t: TableName, r: Rec) => {
      if (t === 'photos') r = { ...r, uploaded: 0 };
      await createRecord(t, r as never);
      if (t === 'photos')
        await db.photoUploads.put({
          photoId: r.id,
          projectId: c.projectId,
          status: 'pending',
          attempts: 0,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        });
      created.push(r);
    };
    await put(main.table, { ...rec, restoredFrom: main.rec.id });
    await db.table(main.table).update(rec.id, { restoredFrom: undefined });
    let photosSkipped = 0;
    for (const child of children) {
      let r = fresh(child.rec);
      for (const k of ['equipmentId', 'issueId'] as const)
        if (typeof r[k] === 'string' && ids.has(r[k] as string)) r = { ...r, [k]: ids.get(r[k] as string) };
      if (child.table === 'photos' && !(r as unknown as Photo).blob) {
        photosSkipped++;
        continue;
      }
      if (child.table === 'airflowRows' && !(await exists('equipment', r.equipmentId))) continue;
      await put(child.table, r);
    }
    await db.conflicts.update(c.id, { status: 'resolved', resolvedAt: Date.now(), resolution: 'restored' });
    await appendHistory({
      projectId: c.projectId,
      ts: Date.now(),
      kind: 'conflict-resolved',
      table: main.table,
      recordId: rec.id,
      equipmentId: unitOf(main.table, rec as never),
      field: '',
      note: `restored ${d.label}${created.length > 1 ? ` with ${created.length - 1} related record${created.length > 2 ? 's' : ''}` : ''}`,
    });
    return { id: rec.id, restored: created.length, photosSkipped };
  });
}
