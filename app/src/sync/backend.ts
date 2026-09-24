/**
 * What the sync engine needs from a server. Two implementations: the Supabase one (sync/supabaseBackend.ts: the
 * `field_changes` table, the `server_time_ms` function, the `photos` storage bucket) and an in-memory fake with the
 * same rules (sync/fakeServer.ts), used by the unit tests and, over HTTP, by the two-device e2e run.
 */
import type { FieldChange } from '../data/types';

/** Row shape of public.field_changes (supabase/migrations/0001, 0003). */
export interface FieldChangeRow {
  id: string;
  project_id: string;
  table_name: string;
  record_id: string;
  op: string;
  field: string;
  value: unknown;
  user_id: string | null;
  device_id: string;
  /** Server-corrected client timestamp (ms): the device clock + its measured offset to the server clock. */
  client_ts: number;
  /** The device's pull cursor when the change was made. */
  base_seq?: number | null;
  // set by the server
  server_seq?: number;
  received_at?: string | number;
  applied?: boolean;
  note?: string | null;
  org_id?: string | null;
}

export interface PushedRow {
  id: string;
  server_seq: number;
}

export interface SyncBackend {
  /**
   * Append changes (in this order, one atomic request). Returns the log position of the rows that were new; rows the
   * server already had (a retry) are skipped by the server and not returned. Throws SyncError.
   */
  push(rows: readonly FieldChangeRow[]): Promise<PushedRow[]>;
  /** Changes with server_seq > afterSeq, oldest first, at most `limit` (the organization's whole log). */
  pull(afterSeq: number, limit: number): Promise<FieldChangeRow[]>;
  /** The server clock (ms since epoch). */
  serverTime(): Promise<number>;
  uploadPhoto(path: string, blob: Blob, contentType: string): Promise<void>;
  /** null: no such file (yet). */
  downloadPhoto(path: string): Promise<Blob | null>;
  deletePhoto(path: string): Promise<void>;
  /** Live updates: called when another device pushed (Supabase Realtime). Returns the unsubscribe function. */
  subscribe?(onChange: () => void): () => void;
}

export type SyncErrorKind = 'locked' | 'forbidden' | 'network' | 'server';

/** A failed server call, classified. `locked`: the server refused a change of a locked project (TAB_LOCKED). */
export class SyncError extends Error {
  constructor(
    message: string,
    readonly kind: SyncErrorKind,
    readonly info: { changeId?: string; projectId?: string; lock?: unknown } = {},
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

/** PostgREST / Postgres error shape ({ message, code, details, hint }) or a fetch failure -> SyncError. */
export function toSyncError(e: unknown, what: string): SyncError {
  if (e instanceof SyncError) return e;
  const err = (e ?? {}) as { message?: string; code?: string; details?: string | null; hint?: string | null };
  const message = err.message ?? String(e);
  if (err.hint === 'TAB_LOCKED' || /^TAB_LOCKED/.test(message)) {
    let info: { change_id?: string; project_id?: string; lock?: unknown } = {};
    try {
      info = JSON.parse(err.details ?? '{}') as typeof info;
    } catch {
      /* no detail */
    }
    return new SyncError(message.replace(/^TAB_LOCKED:\s*/, ''), 'locked', {
      changeId: info.change_id,
      projectId: info.project_id,
      lock: info.lock,
    });
  }
  if (/^TAB_FORBIDDEN|row-level security|JWT|permission denied/i.test(message) || err.code === '42501')
    return new SyncError(`${what}: ${message}`, 'forbidden');
  if (e instanceof TypeError || /fetch|network|timeout|offline/i.test(message))
    return new SyncError(`${what}: ${message}`, 'network');
  return new SyncError(`${what}: ${message}`, 'server');
}

/** Storage path of a photo's file in the `photos` bucket (deterministic, so no field has to sync it). */
export const photoPath = (projectId: string, photoId: string) => `${projectId}/${photoId}.jpg`;

/** Local FieldChange -> row (client_ts corrected by the clock offset). */
export function toRow(c: FieldChange, userId: string, clockOffset: number): FieldChangeRow {
  return {
    id: c.id,
    project_id: c.projectId,
    table_name: c.table,
    record_id: c.recordId,
    op: c.op,
    field: c.field,
    value: c.value ?? null,
    user_id: userId,
    device_id: c.deviceId,
    client_ts: Math.round(c.ts + clockOffset),
    base_seq: c.baseSeq ?? null,
  };
}

export const receivedMs = (r: FieldChangeRow): number =>
  typeof r.received_at === 'number' ? r.received_at : r.received_at ? Date.parse(r.received_at) : 0;
