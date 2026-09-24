/**
 * The sync outbox is the fieldChanges table: every local edit lands there with synced = 0. Push sends
 * pending changes and marks them synced; pull applies other devices' changes with last-writer-wins per field.
 */
import type { Table } from 'dexie';
import { db } from '../data/db';
import { appendHistory } from '../data/history';
import { getDeviceId } from '../data/identity';
import { historyKind, unitOf } from '../data/repo';
import { getPath, setPath } from '../data/paths';
import type { FieldChange, TableName } from '../data/types';

export async function pendingChanges(limit = 500): Promise<FieldChange[]> {
  return db.fieldChanges
    .where('synced')
    .equals(0)
    .sortBy('ts')
    .then((all) => all.slice(0, limit));
}

export function countPending(): Promise<number> {
  return db.fieldChanges.where('synced').equals(0).count();
}

export async function markSynced(ids: readonly string[]): Promise<void> {
  await db.transaction('rw', db.fieldChanges, async () => {
    for (const id of ids) await db.fieldChanges.update(id, { synced: 1 });
  });
}

/** A change as it comes back from the server (another device's FieldChange). */
export type RemoteChange = Omit<FieldChange, 'synced' | 'conflict'>;

export interface ApplyResult {
  applied: number;
  /** Remote change older than a local edit of the same field: ignored (the local edit is newer and will be pushed). */
  skipped: number;
  /** Local unsynced edits that lost to a newer remote edit (flagged conflict = 1, kept in the log). */
  conflicts: number;
}

/**
 * Apply remote changes, last writer wins per (table, record, field). Remote changes are NOT added to the
 * outbox (they are already on the server). Changes from this device are ignored.
 */
export async function applyRemoteChanges(changes: readonly RemoteChange[]): Promise<ApplyResult> {
  const deviceId = await getDeviceId();
  const res: ApplyResult = { applied: 0, skipped: 0, conflicts: 0 };
  const sorted = [...changes].filter((c) => c.deviceId !== deviceId).sort((a, b) => a.ts - b.ts);
  await db.transaction(
    'rw',
    [db.projects, db.equipment, db.airflowRows, db.issues, db.photos, db.instruments, db.fieldChanges, db.history],
    async () => {
      for (const c of sorted) {
        if (await db.fieldChanges.get(c.id)) {
          res.skipped++; // already seen
          continue;
        }
        const t = db.table(c.table as TableName) as Table<Record<string, unknown> & { id: string }, string>;
        const local = await db.fieldChanges
          .where('[table+recordId+field]')
          .equals([c.table, c.recordId, c.field])
          .toArray();
        const newerLocal = local.some((l) => l.ts > c.ts);
        const who = { userId: c.userId, deviceId: c.deviceId };
        const base = {
          projectId: c.projectId,
          ts: c.ts,
          table: c.table,
          recordId: c.recordId,
          source: 'remote' as const,
        };
        if (c.op === 'set' && newerLocal) {
          res.skipped++;
        } else if (c.op === 'set') {
          const rec = await t.get(c.recordId);
          if (rec) {
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
          } else res.skipped++;
          for (const l of local) {
            if (l.synced === 0 && l.ts < c.ts) {
              await db.fieldChanges.update(l.id, { conflict: 1 });
              res.conflicts++;
            }
          }
        } else if (c.op === 'create') {
          if (!(await t.get(c.recordId)) && c.value && typeof c.value === 'object') {
            await t.put(c.value as Record<string, unknown> & { id: string });
            res.applied++;
            await appendHistory(
              { ...base, kind: 'create', equipmentId: unitOf(c.table, c.value as never), field: '' },
              who,
            );
          } else res.skipped++;
        } else {
          const rec = await t.get(c.recordId);
          await t.delete(c.recordId);
          res.applied++;
          if (rec)
            await appendHistory(
              { ...base, kind: 'delete', equipmentId: unitOf(c.table, rec as never), field: '' },
              who,
            );
        }
        // keep the remote change in the local log (audit history), already synced
        await db.fieldChanges.put({ ...c, synced: 1 });
      }
    },
  );
  return res;
}
