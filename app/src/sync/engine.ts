/**
 * Sync engine: push the local outbox, pull other devices' changes. Two implementations:
 *  - LocalSyncEngine: local-only mode (no Supabase configured / not signed in). Push and pull do nothing and
 *    changes stay in the outbox until the device signs in.
 *  - SupabaseSyncEngine: pushes FieldChanges into the `field_changes` table and pulls newer rows written by
 *    other devices (Realtime subscription is Phase 5). The server applies changes to the record tables with a
 *    trigger (supabase/migrations/0001_init.sql). Not yet exercised against a live project.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from '../data/db';
import { applyRemoteChanges, markSynced, pendingChanges, type RemoteChange } from './outbox';

export interface PushResult {
  pushed: number;
}
export interface PullResult {
  applied: number;
  conflicts: number;
}

export interface SyncEngine {
  readonly mode: 'local' | 'supabase';
  push(): Promise<PushResult>;
  pull(): Promise<PullResult>;
}

export class LocalSyncEngine implements SyncEngine {
  readonly mode = 'local' as const;
  async push(): Promise<PushResult> {
    return { pushed: 0 };
  }
  async pull(): Promise<PullResult> {
    return { applied: 0, conflicts: 0 };
  }
}

/** Row shape of public.field_changes. */
interface FieldChangeRow {
  id: string;
  project_id: string;
  table_name: string;
  record_id: string;
  op: string;
  field: string;
  value: unknown;
  user_id: string | null;
  device_id: string;
  client_ts: number;
  server_seq?: number;
}

export class SupabaseSyncEngine implements SyncEngine {
  readonly mode = 'supabase' as const;
  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: string,
  ) {}

  async push(): Promise<PushResult> {
    let pushed = 0;
    for (;;) {
      const batch = await pendingChanges(200);
      if (!batch.length) break;
      const rows: FieldChangeRow[] = batch.map((c) => ({
        id: c.id,
        project_id: c.projectId,
        table_name: c.table,
        record_id: c.recordId,
        op: c.op,
        field: c.field,
        value: c.value ?? null,
        user_id: this.userId,
        device_id: c.deviceId,
        client_ts: c.ts,
      }));
      const { error } = await this.client
        .from('field_changes')
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw new Error(`push failed: ${error.message}`);
      await markSynced(batch.map((c) => c.id));
      pushed += batch.length;
    }
    return { pushed };
  }

  async pull(): Promise<PullResult> {
    const cursorRow = await db.meta.get('pullCursor');
    let cursor = typeof cursorRow?.value === 'number' ? cursorRow.value : 0;
    let applied = 0;
    let conflicts = 0;
    for (;;) {
      const { data, error } = await this.client
        .from('field_changes')
        .select('*')
        .gt('server_seq', cursor)
        .order('server_seq', { ascending: true })
        .limit(500);
      if (error) throw new Error(`pull failed: ${error.message}`);
      const rows = (data ?? []) as FieldChangeRow[];
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
        ts: Number(r.client_ts),
      }));
      const res = await applyRemoteChanges(changes);
      applied += res.applied;
      conflicts += res.conflicts;
      cursor = Math.max(cursor, ...rows.map((r) => Number(r.server_seq ?? 0)));
      await db.meta.put({ key: 'pullCursor', value: cursor });
      if (rows.length < 500) break;
    }
    return { applied, conflicts };
  }
}
