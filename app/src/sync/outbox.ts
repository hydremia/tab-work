/**
 * The sync outbox is the fieldChanges table: every local edit lands there with synced = 0. Push sends pending changes
 * and marks them synced; pull applies other devices' changes with last-writer-wins per field and records conflicts
 * (sync/conflicts.ts). Changes the server refused because the project's report was issued (locked) meanwhile are held
 * (synced = 2) until the project is unlocked.
 */
import type { Table } from 'dexie';
import { db } from '../data/db';
import { appendHistory } from '../data/history';
import { getDeviceId } from '../data/identity';
import { deleteProjectLocally, forgetPhotoFile, historyKind, unitOf, writeTables } from '../data/repo';
import { assertEditablePath, deepEqual, getPath, setPath } from '../data/paths';
import type { FieldChange, ProjectLock, TableName } from '../data/types';
import { uuid } from '../data/uuid';
import { isConcurrent, laterWins, recordFieldConflict } from './conflicts';

/** A field path this app edits (not id / projectId / timestamps, no prototype keys). */
function isEditablePath(field: string): boolean {
  try {
    assertEditablePath(field);
    return true;
  } catch {
    return false;
  }
}

/** Projects kept on this device only (not uploaded to the cloud; chosen at the first sign-in). */
export async function localOnlyProjects(): Promise<Set<string>> {
  const row = await db.meta.get('localOnlyProjects');
  return new Set(Array.isArray(row?.value) ? (row.value as string[]) : []);
}

export async function setLocalOnlyProjects(ids: Iterable<string>): Promise<void> {
  await db.meta.put({ key: 'localOnlyProjects', value: [...new Set(ids)] });
}

/** Changes waiting to be pushed, oldest first (not those of local-only projects). */
export async function pendingChanges(limit = 500): Promise<FieldChange[]> {
  const localOnly = await localOnlyProjects();
  const all = await db.fieldChanges.where('synced').equals(0).sortBy('ts');
  return all.filter((c) => !localOnly.has(c.projectId)).slice(0, limit);
}

/** Changes not on the server: waiting (0) and held by a report lock (2). `cloud`: without local-only projects. */
export async function countPending(cloud = false): Promise<number> {
  const all = await db.fieldChanges.where('synced').anyOf(0, 2).toArray();
  if (!cloud) return all.length;
  const localOnly = await localOnlyProjects();
  return all.filter((c) => !localOnly.has(c.projectId)).length;
}

/**
 * Mark pushed changes as synced (with their server_seq). A change that was edited again while the push was in flight
 * (setField coalesces repeated edits into the unsynced entry) keeps the pushed value under its id, and the newer value
 * becomes a new change: the server skips ids it already has, so re-pushing the same id would lose the edit.
 * `sent`: the entries as they were pushed (or just their ids).
 */
export async function markSynced(
  sent: readonly (string | FieldChange)[],
  seqs: ReadonlyMap<string, number> = new Map(),
): Promise<void> {
  await db.transaction('rw', db.fieldChanges, async () => {
    for (const s of sent) {
      const id = typeof s === 'string' ? s : s.id;
      const cur = await db.fieldChanges.get(id);
      if (!cur) continue;
      const serverSeq = seqs.get(id) ?? cur.serverSeq;
      if (typeof s !== 'string' && (cur.ts !== s.ts || !deepEqual(cur.value, s.value))) {
        await db.fieldChanges.put({ ...s, synced: 1, ...(serverSeq !== undefined ? { serverSeq } : {}) });
        const { serverSeq: _drop, ...rest } = cur;
        await db.fieldChanges.add({ ...rest, id: uuid(), synced: 0 });
      } else {
        await db.fieldChanges.update(id, { synced: 1, ...(serverSeq !== undefined ? { serverSeq } : {}) });
      }
    }
  });
}

/** May this change reach a locked project? (the lock itself and deleting the whole project) */
export const passesLock = (c: Pick<FieldChange, 'table' | 'op' | 'field'>) =>
  c.table === 'projects' && ((c.op === 'set' && c.field === 'lock') || c.op === 'delete');

/**
 * Hold the waiting changes of a locked project (they would be refused by the server) and record / update the
 * project's 'held' conflict. Returns how many were held.
 */
export async function holdChanges(projectId: string, lock?: ProjectLock | null): Promise<number> {
  return db.transaction('rw', [db.fieldChanges, db.conflicts, db.projects, db.history, db.meta], async () => {
    const waiting = await db.fieldChanges
      .where('projectId')
      .equals(projectId)
      .filter((c) => c.synced === 0 && !passesLock(c))
      .toArray();
    for (const c of waiting) await db.fieldChanges.update(c.id, { synced: 2 });
    const total = await db.fieldChanges
      .where('projectId')
      .equals(projectId)
      .filter((c) => c.synced === 2)
      .count();
    if (!total) return 0;
    const l = lock ?? (await db.projects.get(projectId))?.lock ?? null;
    const held = { count: total, label: l?.label ?? '?', by: l?.name ?? '' };
    const open = (await db.conflicts.where('[projectId+status]').equals([projectId, 'open']).toArray()).find(
      (c) => c.kind === 'held',
    );
    if (open) await db.conflicts.update(open.id, { held });
    else {
      await db.conflicts.add({
        id: uuid(),
        projectId,
        kind: 'held',
        table: null,
        recordId: null,
        equipmentId: null,
        field: '',
        held,
        status: 'open',
        detectedAt: Date.now(),
      });
      await appendHistory({
        projectId,
        ts: Date.now(),
        kind: 'conflict',
        table: null,
        recordId: null,
        equipmentId: null,
        field: '',
        note: `${total} change${total > 1 ? 's' : ''} not synced: the report was issued as ${held.label} on another device`,
      });
    }
    return waiting.length;
  });
}

/** Held changes of projects that are no longer locked go back into the outbox. Returns how many. */
export async function releaseHeld(): Promise<number> {
  return db.transaction('rw', [db.fieldChanges, db.conflicts, db.projects, db.history, db.meta], async () => {
    const held = await db.fieldChanges.where('synced').equals(2).toArray();
    const byProject = new Map<string, FieldChange[]>();
    for (const c of held) byProject.set(c.projectId, [...(byProject.get(c.projectId) ?? []), c]);
    let released = 0;
    for (const [projectId, list] of byProject) {
      const project = await db.projects.get(projectId);
      if (project?.lock) continue;
      for (const c of list) {
        if (project) await db.fieldChanges.update(c.id, { synced: 0 });
        else await db.fieldChanges.delete(c.id); // the project was deleted meanwhile
      }
      released += project ? list.length : 0;
      for (const cf of await db.conflicts.where('[projectId+status]').equals([projectId, 'open']).toArray()) {
        if (cf.kind !== 'held') continue;
        await db.conflicts.update(cf.id, { status: 'resolved', resolvedAt: Date.now(), resolution: 'released' });
        if (project)
          await appendHistory({
            projectId,
            ts: Date.now(),
            kind: 'conflict-resolved',
            table: null,
            recordId: null,
            equipmentId: null,
            field: '',
            note: `The project was unlocked: ${list.length} held change${list.length > 1 ? 's' : ''} synced`,
          });
      }
    }
    return released;
  });
}

/** A change as it comes back from the server (another device's FieldChange, `ts` in this device's clock). */
export type RemoteChange = Omit<FieldChange, 'synced' | 'conflict'> & {
  /** false: the server did not apply it (superseded, a create of an existing / deleted record, unknown field). */
  applied?: boolean;
  note?: string | null;
};

export interface ApplyResult {
  applied: number;
  /** Already seen, older than a known edit of the same field, or not applied by the server. */
  skipped: number;
  /** Conflicts recorded (two devices edited the same field without seeing each other's edit). */
  conflicts: number;
}

/**
 * Apply remote changes in server order (server_seq; by timestamp when unknown), last writer wins per
 * (table, record, field), mirroring the server. Remote changes are NOT added to the outbox (they are already on the
 * server) but kept in the local log as synced (audit, conflict detection). This device's own changes coming back only
 * record their server_seq.
 */
export async function applyRemoteChanges(changes: readonly RemoteChange[]): Promise<ApplyResult> {
  const deviceId = await getDeviceId();
  const res: ApplyResult = { applied: 0, skipped: 0, conflicts: 0 };
  const order = (c: RemoteChange) => c.serverSeq ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...changes].sort((a, b) => order(a) - order(b) || a.ts - b.ts);
  await db.transaction('rw', [...writeTables(), db.revisions, db.baseWorkbooks], async () => {
    for (const c of sorted) {
      if (c.deviceId === deviceId) {
        // own change coming back: remember its position in the server log
        const own = await db.fieldChanges.get(c.id);
        if (own && own.serverSeq === undefined && c.serverSeq !== undefined)
          await db.fieldChanges.update(c.id, { serverSeq: c.serverSeq });
        continue;
      }
      if (await db.fieldChanges.get(c.id)) {
        res.skipped++; // already seen
        continue;
      }
      // pulled rows are other devices' data: a field no device may edit is skipped (throwing here would stop every
      // later pull on this device)
      if (c.op === 'set' && !isEditablePath(c.field)) {
        res.skipped++;
        continue;
      }
      const serverApplied = c.applied !== false || c.note === 'unknown field';
      const t = db.table(c.table as TableName) as Table<Record<string, unknown> & { id: string }, string>;
      const who = { userId: c.userId, deviceId: c.deviceId };
      const base = {
        projectId: c.projectId,
        ts: c.ts,
        table: c.table,
        recordId: c.recordId,
        source: 'remote' as const,
      };
      if (c.op === 'set') {
        const log = await db.fieldChanges
          .where('[table+recordId+field]')
          .equals([c.table, c.recordId, c.field])
          .filter((l) => l.op === 'set')
          .toArray();
        const newerKnown = log.some((l) => laterWins(l, c));
        const rec = await t.get(c.recordId);
        // conflict: this device's last edit of the field and the remote one did not see each other
        const mine = log.filter((l) => l.deviceId === deviceId).sort((a, b) => b.ts - a.ts)[0];
        if (mine && isConcurrent(mine, c) && !deepEqual(mine.value ?? null, c.value ?? null)) {
          const remoteWins = laterWins(c, mine);
          if (await recordFieldConflict(mine, c, remoteWins, rec ? unitOf(c.table, rec as never) : null))
            res.conflicts++;
          if (remoteWins) await db.fieldChanges.update(mine.id, { conflict: 1 });
        } else if (!newerKnown && serverApplied) {
          // a deliberate later edit of a field with an open conflict (e.g. the other device resolved it): settled
          for (const cf of await db.conflicts.where('recordId').equals(c.recordId).toArray())
            if (cf.status === 'open' && cf.kind === 'field' && cf.field === c.field)
              await db.conflicts.update(cf.id, {
                status: 'resolved',
                resolvedAt: Date.now(),
                resolution: 'superseded',
              });
        }
        if (newerKnown || !serverApplied || !rec) res.skipped++;
        else {
          const next = setPath(rec, c.field, c.value);
          if (getPath(rec, 'updatedAt') !== undefined) next.updatedAt = Math.max(Number(rec.updatedAt) || 0, c.ts);
          await t.put(next);
          res.applied++;
          await appendHistory(
            {
              ...base,
              kind: historyKind(c.table, c.field, c.value),
              equipmentId: unitOf(c.table, next as never),
              field: c.field,
              previous: getPath(rec, c.field) ?? null,
              value: c.value ?? null,
            },
            who,
          );
        }
      } else if (c.op === 'create') {
        if (serverApplied && !(await t.get(c.recordId)) && c.value && typeof c.value === 'object') {
          // the record is the change's record in the change's project (as on the server), whatever the value says
          const value = {
            ...(c.value as Record<string, unknown>),
            id: c.recordId,
            ...(c.table === 'projects' || c.table === 'libraryInstruments' ? {} : { projectId: c.projectId }),
          };
          // a photo arrives without its file (downloaded by sync/photoSync.ts)
          await t.put(c.table === 'photos' ? { blob: null, thumb: null, ...value, uploaded: 1 } : value);
          res.applied++;
          await appendHistory(
            { ...base, kind: 'create', equipmentId: unitOf(c.table, c.value as never), field: '' },
            who,
          );
        } else res.skipped++;
      } else if (c.table === 'projects') {
        // another device deleted the whole project: cascade like the server
        if (await db.projects.get(c.recordId)) {
          await deleteProjectLocally(c.recordId, true);
          res.applied++;
        } else res.skipped++;
      } else {
        const rec = await t.get(c.recordId);
        await t.delete(c.recordId);
        if (c.table === 'photos') await forgetPhotoFile(c.recordId, true);
        if (rec) {
          res.applied++;
          await appendHistory({ ...base, kind: 'delete', equipmentId: unitOf(c.table, rec as never), field: '' }, who);
        } else res.skipped++;
      }
      // keep the remote change in the local log (audit, conflict detection), already synced
      if (!(c.table === 'projects' && c.op === 'delete')) {
        const { applied: _a, note: _n, ...entry } = c;
        await db.fieldChanges.put({ ...entry, synced: 1 });
      }
    }
  });
  return res;
}
