/**
 * Sync engine: pull other devices' changes, push the local outbox, move photo files. Two implementations:
 *  - LocalSyncEngine: local-only mode (no cloud configured / not signed in). Nothing moves; changes stay in the outbox
 *    until the device signs in.
 *  - CloudSyncEngine: over a SyncBackend (Supabase, or the in-memory fake in tests / the two-device e2e).
 *
 * One sync = measure the clock offset -> pull -> release held changes of unlocked projects -> push -> pull again when
 * something was pushed (the server's answers: a review it cleared, a lock that refused a change) -> photos.
 *
 * Ordering and clocks. The server log order (server_seq) decides the order changes are applied in. Which of two edits
 * of the same field wins is decided by their timestamps (the ROADMAP rule "the later edit wins", also for edits made
 * offline hours before they sync), but device clocks can be wrong: each sync measures the device's offset to the
 * server clock (server_time_ms, half the round trip) and timestamps go to the server corrected by it (and come back
 * converted to the device clock). So a phone whose clock is 10 minutes fast doesn't win every conflict. (Assumes the
 * offset stays about the same between an offline edit and its push, which holds for a wrong clock; a clock corrected
 * while offline shifts those edits by the correction.)
 *
 * Pulls. The cursor is a server_seq, but a request that got its seq earlier can commit later than one with a higher
 * seq; a cursor that jumped past it would skip it for good. So the saved restart point only advances over rows that
 * are older than SETTLE_MS (server time, received_at); newer rows are read again next time and skipped (their ids
 * are known). A separate "seen" position (the highest seq applied) is what new edits record as their baseSeq.
 */
import { db } from '../data/db';
import { deviceNow, getSyncCursor, type SyncCursor } from '../data/identity';
import type { FieldChange } from '../data/types';
import { receivedMs, SyncError, toRow, type SyncBackend } from './backend';
import {
  applyRemoteChanges,
  holdChanges,
  markSynced,
  passesLock,
  pendingChanges,
  releaseHeld,
  type RemoteChange,
} from './outbox';
import { processPhotoQueue, type PhotoSyncResult } from './photoSync';
import { resolveSlotCollisions } from './slots';

export interface PushResult {
  pushed: number;
  /** Changes held back because their project is locked (on the server or already on this device). */
  held: number;
}
export interface PullResult {
  applied: number;
  conflicts: number;
  /** Units moved to a free workbook slot because another device had used their slot (sync/slots.ts). */
  slotMoves?: number;
}
export interface SyncResult extends PushResult, PullResult {
  released: number;
  photos: PhotoSyncResult | null;
}

export interface SyncEngine {
  readonly mode: 'local' | 'cloud';
  push(): Promise<PushResult>;
  pull(): Promise<PullResult>;
  sync(): Promise<SyncResult>;
  /** Live hint that another device pushed (Realtime); returns the unsubscribe function. */
  subscribe?(onChange: () => void): () => void;
}

const NOTHING: SyncResult = { pushed: 0, held: 0, applied: 0, conflicts: 0, slotMoves: 0, released: 0, photos: null };

export class LocalSyncEngine implements SyncEngine {
  readonly mode = 'local' as const;
  async push(): Promise<PushResult> {
    return { pushed: 0, held: 0 };
  }
  async pull(): Promise<PullResult> {
    return { applied: 0, conflicts: 0 };
  }
  async sync(): Promise<SyncResult> {
    return NOTHING;
  }
}

export interface EngineOptions {
  /** Changes per push request. */
  batchSize?: number;
  /** Rows per pull request. */
  pageSize?: number;
  /** Rows younger than this (server time) are read again on the next pull. */
  settleMs?: number;
}

export const SETTLE_MS = 120_000;

interface StoredCursor extends SyncCursor {
  /** Where the next pull starts (only advanced over settled rows). */
  restart: number;
}

export class CloudSyncEngine implements SyncEngine {
  readonly mode = 'cloud' as const;
  private readonly batchSize: number;
  private readonly pageSize: number;
  private readonly settleMs: number;
  /** server clock - device clock (ms) */
  clockOffset = 0;

  constructor(
    readonly backend: SyncBackend,
    readonly userId: string,
    opts: EngineOptions = {},
  ) {
    this.batchSize = opts.batchSize ?? 200;
    this.pageSize = opts.pageSize ?? 500;
    this.settleMs = opts.settleMs ?? SETTLE_MS;
  }

  subscribe(onChange: () => void): () => void {
    return this.backend.subscribe?.(onChange) ?? (() => undefined);
  }

  /** Measure the device's clock offset to the server (kept in meta for the next start). */
  async measureClock(): Promise<number> {
    const t0 = deviceNow();
    const server = await this.backend.serverTime();
    const t1 = deviceNow();
    this.clockOffset = Math.round(server - (t0 + t1) / 2);
    await db.meta.put({ key: 'clockOffset', value: this.clockOffset });
    return this.clockOffset;
  }

  private async loadClock(): Promise<void> {
    const row = await db.meta.get('clockOffset');
    if (typeof row?.value === 'number') this.clockOffset = row.value;
  }

  async sync(): Promise<SyncResult> {
    try {
      await this.measureClock();
    } catch (e) {
      if (e instanceof SyncError && e.kind === 'network') throw e;
      await this.loadClock(); // an older server without server_time_ms: keep the last offset (or none)
    }
    const pulled = await this.pull();
    const released = await releaseHeld();
    // collisions the pull could not resolve yet (e.g. in a project that was locked then): cheap when there are none
    const slotMoves = (await resolveSlotCollisions()).moved;
    const pushed = await this.push();
    let late: PullResult = { applied: 0, conflicts: 0 };
    // after a push: the server's own changes in answer to it (a review it cleared) and, when a change was refused by
    // a lock this device didn't know about yet, the lock
    if (pushed.pushed || pushed.held) late = await this.pull();
    const photos = await processPhotoQueue(this.backend);
    return {
      ...pushed,
      applied: pulled.applied + late.applied,
      conflicts: pulled.conflicts + late.conflicts,
      slotMoves: (pulled.slotMoves ?? 0) + slotMoves + (late.slotMoves ?? 0),
      released,
      photos,
    };
  }

  /** Hold the waiting changes of projects this device already knows are locked. */
  private async holdLocked(batch: FieldChange[]): Promise<number> {
    let held = 0;
    const seen = new Set<string>();
    for (const c of batch) {
      if (seen.has(c.projectId) || passesLock(c)) continue;
      seen.add(c.projectId);
      const project = await db.projects.get(c.projectId);
      if (!project?.lock) continue;
      // locked by this device and the lock not pushed yet: the server isn't locked, the edits before it go first
      const ownLockWaiting = await db.fieldChanges
        .where('[table+recordId+field]')
        .equals(['projects', c.projectId, 'lock'])
        .filter((x) => x.synced === 0)
        .count();
      if (!ownLockWaiting) held += await holdChanges(c.projectId, project.lock);
    }
    return held;
  }

  async push(): Promise<PushResult> {
    const res: PushResult = { pushed: 0, held: 0 };
    for (let guard = 0; guard < 10_000; guard++) {
      let batch = await pendingChanges(this.batchSize);
      if (!batch.length) break;
      const heldNow = await this.holdLocked(batch);
      if (heldNow) {
        res.held += heldNow;
        batch = await pendingChanges(this.batchSize);
        if (!batch.length) break;
      }
      try {
        const out = await this.backend.push(batch.map((c) => toRow(c, this.userId, this.clockOffset)));
        await markSynced(batch, new Map(out.map((r) => [r.id, Number(r.server_seq)])));
        res.pushed += batch.length;
      } catch (e) {
        if (!(e instanceof SyncError) || e.kind !== 'locked') throw e;
        // the whole request was refused (atomic): hold that project's changes, push the rest
        const projectId = e.info.projectId ?? batch.find((c) => c.id === e.info.changeId)?.projectId;
        if (!projectId) throw e;
        const n = await holdChanges(projectId, (e.info.lock as never) ?? null);
        if (!n) throw e; // nothing left to hold: don't loop
        res.held += n;
      }
    }
    return res;
  }

  async pull(): Promise<PullResult> {
    const stored = (await getSyncCursor()) as StoredCursor | null;
    // another account on this device (or a first sign-in): read the organization's log from the start
    const cur: StoredCursor =
      stored && stored.userId === this.userId ? stored : { userId: this.userId, seq: 0, restart: 0 };
    let restart = cur.restart ?? cur.seq;
    let seen = cur.seq;
    let after = restart;
    let settled = true;
    const res: PullResult = { applied: 0, conflicts: 0 };
    const unitProjects = new Set<string>();
    const settleBefore = deviceNow() + this.clockOffset - this.settleMs;
    for (;;) {
      const rows = await this.backend.pull(after, this.pageSize);
      if (!rows.length) break;
      const changes: RemoteChange[] = rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        table: r.table_name as RemoteChange['table'],
        recordId: r.record_id,
        op: r.op as RemoteChange['op'],
        field: r.field,
        value: r.value,
        userId: r.user_id ?? '',
        deviceId: r.device_id,
        ts: Number(r.client_ts) - this.clockOffset,
        serverSeq: Number(r.server_seq),
        ...(r.base_seq != null ? { baseSeq: Number(r.base_seq) } : {}),
        ...(r.applied === false ? { applied: false, note: r.note ?? null } : {}),
      }));
      const out = await applyRemoteChanges(changes);
      for (const c of changes)
        if (c.table === 'equipment' && (c.op === 'create' || c.field === 'slot')) unitProjects.add(c.projectId);
      res.applied += out.applied;
      res.conflicts += out.conflicts;
      for (const r of rows) {
        const seq = Number(r.server_seq);
        seen = Math.max(seen, seq);
        if (settled && receivedMs(r) <= settleBefore) restart = Math.max(restart, seq);
        else settled = false;
      }
      after = Number(rows[rows.length - 1].server_seq);
      await db.meta.put({
        key: 'syncCursor',
        value: { userId: this.userId, seq: seen, restart } satisfies StoredCursor,
      });
      if (rows.length < this.pageSize) break;
    }
    if (!stored || stored.userId !== this.userId)
      await db.meta.put({
        key: 'syncCursor',
        value: { userId: this.userId, seq: seen, restart } satisfies StoredCursor,
      });
    // two devices may have given the same workbook slot to new units: move the later one (pushed with this sync)
    if (unitProjects.size) res.slotMoves = (await resolveSlotCollisions(unitProjects)).moved;
    return res;
  }
}
