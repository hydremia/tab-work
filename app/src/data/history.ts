/**
 * Change history (audit trail), Dexie schema v4 table `history`.
 *
 * Why a separate table and not the outbox: `fieldChanges` is the sync outbox. It coalesces consecutive unsynced edits
 * of the same field into one entry (so a tech typing a value in five pauses pushes one change, not five) and holds
 * what the server needs. An audit history must keep every step with its value before, so every repository write
 * appends one HistoryEntry here in the same transaction (setField / createRecord / deleteRecord in repo.ts), plus
 * review, lock / unlock, re-import and export (revision) events. Changes from other devices are appended when the
 * sync applies them (source "remote"). The table is local to the device; it is not synced.
 *
 * Storage (phones): an entry is ~0.2–0.5 kB. `pruneHistory()` runs at start-up and keeps, per project, entries of the
 * last HISTORY_MAX_AGE_DAYS days and at most HISTORY_MAX_PER_PROJECT of them (the newest). Worst case ~2.5 MB per
 * project. Deleting a project deletes its history.
 */
import { db } from './db';
import { getCurrentUser, getDeviceId, getUserName } from './identity';
import type { HistoryEntry } from './types';
import { uuid } from './uuid';

export const HISTORY_MAX_AGE_DAYS = 365;
export const HISTORY_MAX_PER_PROJECT = 5000;

export type NewHistoryEntry = Omit<HistoryEntry, 'id' | 'userId' | 'deviceId' | 'userName'> &
  Partial<Pick<HistoryEntry, 'userId' | 'deviceId' | 'userName'>>;

/** Who is writing (read before a transaction: the device id / name may need a database read). */
export async function currentActor(): Promise<Pick<HistoryEntry, 'userId' | 'deviceId' | 'userName'>> {
  const [deviceId, userName] = await Promise.all([getDeviceId(), getUserName()]);
  return { userId: getCurrentUser(), deviceId, ...(userName ? { userName } : {}) };
}

/** Append one entry. Call inside a transaction that includes db.history (or on its own). */
export async function appendHistory(
  entry: NewHistoryEntry,
  actor?: Pick<HistoryEntry, 'userId' | 'deviceId' | 'userName'>,
): Promise<void> {
  const who = actor ?? (await currentActor());
  await db.history.add({ id: uuid(), ...who, ...entry });
}

/** Drop entries older than HISTORY_MAX_AGE_DAYS and all but the newest HISTORY_MAX_PER_PROJECT of each project. */
export async function pruneHistory(now = Date.now()): Promise<number> {
  const cutoff = now - HISTORY_MAX_AGE_DAYS * 24 * 3600 * 1000;
  let removed = 0;
  await db.transaction('rw', db.history, async () => {
    removed += await db.history.where('ts').below(cutoff).delete();
    const projectIds = (await db.history.orderBy('projectId').uniqueKeys()) as string[];
    for (const pid of projectIds) {
      const n = await db.history.where('projectId').equals(pid).count();
      if (n <= HISTORY_MAX_PER_PROJECT) continue;
      const old = await db.history
        .where('[projectId+ts]')
        .between([pid, -Infinity], [pid, Infinity])
        .limit(n - HISTORY_MAX_PER_PROJECT)
        .primaryKeys();
      await db.history.bulkDelete(old);
      removed += old.length;
    }
  });
  return removed;
}

/** A project's history, newest first. */
export async function projectHistory(projectId: string): Promise<HistoryEntry[]> {
  const all = await db.history.where('[projectId+ts]').between([projectId, -Infinity], [projectId, Infinity]).toArray();
  return all.reverse();
}
