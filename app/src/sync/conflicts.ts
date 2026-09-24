/**
 * Sync conflicts (docs/ROADMAP.md "Sync & multi-user strategy"): when two devices edit the *same field* without
 * seeing each other's edit (typically both offline), the later edit wins everywhere (last writer wins, the same rule
 * as the server) and the losing value is kept and flagged for review. Edits of different fields merge silently.
 *
 * "Without seeing each other's edit" uses the server log positions: every change carries the device's pull cursor
 * when it was made (baseSeq) and, once on the server, its own position (serverSeq). Two edits A and B conflict when
 * A.baseSeq < B.serverSeq (A's device had not pulled B) and B.baseSeq < A.serverSeq (nor B's device A). An edit that
 * is not on the server yet cannot have been seen by anyone. So both devices record the conflict when they pull the
 * other's edit, while an ordinary later edit ("I saw your value and changed it") is not a conflict.
 *
 * A conflict is a local record (Dexie `conflicts`) + a history event; it shows as a badge on the unit / field and in
 * the Attention tab's Conflicts group, where it is resolved: keep the current value, or restore the other one (a normal
 * edit through setField, which syncs and wins everywhere).
 */
import { db } from '../data/db';
import { appendHistory } from '../data/history';
import { setPath } from '../data/paths';
import { setField } from '../data/repo';
import type { FieldChange, SyncConflict, TableName } from '../data/types';
import { uuid } from '../data/uuid';

type Stamp = Pick<FieldChange, 'ts' | 'deviceId'>;

/** Last writer wins: does `a` beat `b`? (later timestamp; the higher device id on a tie, as the server) */
export function laterWins(a: Stamp, b: Stamp): boolean {
  return a.ts > b.ts || (a.ts === b.ts && a.deviceId > b.deviceId);
}

type Seqs = Pick<FieldChange, 'synced' | 'baseSeq' | 'serverSeq'>;

/** Did neither edit see the other? `mine`: this device's edit; `remote`: the pulled one. */
export function isConcurrent(mine: Seqs, remote: Pick<FieldChange, 'baseSeq' | 'serverSeq'>): boolean {
  const remoteSawMine =
    mine.synced === 1 && mine.serverSeq !== undefined && remote.baseSeq != null && remote.baseSeq >= mine.serverSeq;
  const mineSawRemote =
    mine.baseSeq !== undefined && remote.serverSeq !== undefined && mine.baseSeq >= remote.serverSeq;
  return !remoteSawMine && !mineSawRemote;
}

const side = (c: FieldChange | Omit<FieldChange, 'synced'>, local: boolean) => ({
  value: c.value ?? null,
  ts: c.ts,
  userId: c.userId,
  deviceId: c.deviceId,
  local,
  changeId: c.id,
});

/**
 * Record a field conflict between this device's edit and a remote one (inside the pull's transaction). Returns false
 * when the same pair was already recorded.
 */
export async function recordFieldConflict(
  mine: FieldChange,
  remote: Omit<FieldChange, 'synced'>,
  remoteWins: boolean,
  equipmentId: string | null,
): Promise<boolean> {
  const existing = await db.conflicts.where('recordId').equals(mine.recordId).toArray();
  const pair = new Set([mine.id, remote.id]);
  if (
    existing.some(
      (c) =>
        c.field === mine.field && c.current && c.other && pair.has(c.current.changeId) && pair.has(c.other.changeId),
    )
  )
    return false;
  // an older open conflict of the same field is superseded by this one
  for (const c of existing)
    if (c.field === mine.field && c.status === 'open' && c.kind === 'field')
      await db.conflicts.update(c.id, { status: 'resolved', resolvedAt: Date.now(), resolution: 'kept' });
  const current = remoteWins ? side(remote, false) : side(mine, true);
  const other = remoteWins ? side(mine, true) : side(remote, false);
  const conflict: SyncConflict = {
    id: uuid(),
    projectId: mine.projectId,
    kind: 'field',
    table: mine.table,
    recordId: mine.recordId,
    equipmentId,
    field: mine.field,
    current,
    other,
    status: 'open',
    detectedAt: Date.now(),
  };
  await db.conflicts.add(conflict);
  await appendHistory({
    projectId: mine.projectId,
    ts: Date.now(),
    kind: 'conflict',
    table: mine.table,
    recordId: mine.recordId,
    equipmentId,
    field: mine.field,
    previous: other.value,
    value: current.value,
    note: remoteWins ? 'another device edited it later' : 'this device edited it later',
  });
  return true;
}

export class ConflictGoneError extends Error {
  constructor() {
    super('The record no longer exists, so the other value cannot be restored.');
    this.name = 'ConflictGoneError';
  }
}

/**
 * Resolve a field conflict: 'keep' the current value, or 'restore' the other one (written through setField: a normal
 * edit, so it syncs, wins everywhere and is refused while the project is locked).
 */
export async function resolveConflict(id: string, action: 'keep' | 'restore'): Promise<void> {
  const c = await db.conflicts.get(id);
  if (!c || c.status !== 'open') return;
  if (action === 'restore') {
    if (!c.table || !c.recordId || !c.other) throw new ConflictGoneError();
    const rec = await db.table(c.table).get(c.recordId);
    if (!rec) throw new ConflictGoneError();
    await setField(c.table, c.recordId, c.field, c.other.value);
  }
  await db.transaction('rw', [db.conflicts, db.history, db.meta], async () => {
    await db.conflicts.update(id, {
      status: 'resolved',
      resolvedAt: Date.now(),
      resolution: action === 'keep' ? 'kept' : 'restored',
    });
    await appendHistory({
      projectId: c.projectId,
      ts: Date.now(),
      kind: 'conflict-resolved',
      table: c.table,
      recordId: c.recordId,
      equipmentId: c.equipmentId,
      field: c.field,
      ...(action === 'restore' ? { value: c.other?.value ?? null, previous: c.current?.value ?? null } : {}),
      note: action === 'keep' ? 'kept the current value' : 'restored the other value',
    });
  });
}

type AnyRec = Record<string, unknown> & { id: string };

/**
 * Rebuild a record from the local change log (creates, sets in last-writer-wins order, deletes). Used to undo held
 * changes. Returns false when the log has no create for it (nothing to rebuild from).
 */
async function rebuildRecord(table: TableName, recordId: string): Promise<boolean> {
  const log = await db.fieldChanges
    .filter((c) => c.table === table && c.recordId === recordId && c.synced !== 2)
    .toArray();
  const create = log.find((c) => c.op === 'create');
  const t = db.table(table);
  const cur = (await t.get(recordId)) as AnyRec | undefined;
  if (log.some((c) => c.op === 'delete')) {
    await t.delete(recordId);
    return true;
  }
  if (!create || !create.value || typeof create.value !== 'object') {
    if (!log.length && cur) {
      await t.delete(recordId); // only held changes knew it: a record created while the project was locked
      return true;
    }
    return false;
  }
  let rec = { ...(create.value as AnyRec) };
  if (table === 'photos') rec = { ...rec, blob: cur?.blob ?? null, thumb: cur?.thumb ?? null };
  for (const c of log.filter((x) => x.op === 'set').sort((a, b) => (laterWins(a, b) ? 1 : laterWins(b, a) ? -1 : 0)))
    rec = setPath(rec, c.field, c.value);
  await t.put(rec);
  return true;
}

/**
 * Discard the changes held back by a report lock (project conflict of kind 'held'): they leave the outbox and the
 * records go back to what the log without them says.
 */
export async function discardHeld(conflictId: string): Promise<number> {
  const c = await db.conflicts.get(conflictId);
  if (!c || c.kind !== 'held') return 0;
  return db.transaction(
    'rw',
    [
      db.fieldChanges,
      db.conflicts,
      db.history,
      db.meta,
      db.projects,
      db.equipment,
      db.airflowRows,
      db.issues,
      db.photos,
      db.instruments,
    ],
    async () => {
      const held = await db.fieldChanges
        .where('projectId')
        .equals(c.projectId)
        .filter((x) => x.synced === 2)
        .toArray();
      await db.fieldChanges.bulkDelete(held.map((h) => h.id));
      const records = new Map<string, TableName>();
      for (const h of held) records.set(h.recordId, h.table);
      for (const [recordId, table] of records) {
        if (await rebuildRecord(table, recordId)) continue;
        // no create in the log: put the values from before the held edits back
        const rec = (await db.table(table).get(recordId)) as AnyRec | undefined;
        if (!rec) continue;
        let next = rec;
        for (const h of held.filter((x) => x.recordId === recordId && x.op === 'set').sort((a, b) => b.ts - a.ts))
          next = setPath(next, h.field, h.previous ?? null);
        await db.table(table).put(next);
      }
      await db.conflicts.update(conflictId, { status: 'resolved', resolvedAt: Date.now(), resolution: 'discarded' });
      await appendHistory({
        projectId: c.projectId,
        ts: Date.now(),
        kind: 'conflict-resolved',
        table: null,
        recordId: null,
        equipmentId: null,
        field: '',
        note: `Discarded ${held.length} change${held.length === 1 ? '' : 's'} held back by the report lock`,
      });
      return held.length;
    },
  );
}
