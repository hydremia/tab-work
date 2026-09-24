/**
 * SyncBackend on Supabase: `field_changes` (push = upsert ignoring duplicate ids, pull by server_seq), the
 * `server_time_ms()` function (supabase/migrations/0003_sync_rules.sql), the private `photos` bucket, and Realtime
 * inserts on `field_changes` (a hint to pull now; RLS applies to Realtime too).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { toSyncError, type FieldChangeRow, type PushedRow, type SyncBackend } from './backend';

const BUCKET = 'photos';

export class SupabaseBackend implements SyncBackend {
  constructor(private readonly getClient: () => Promise<SupabaseClient>) {}

  private async call<T>(what: string, run: (c: SupabaseClient) => PromiseLike<{ data: T | null; error: unknown }>) {
    let res: { data: T | null; error: unknown };
    try {
      res = await run(await this.getClient());
    } catch (e) {
      throw toSyncError(e, what);
    }
    if (res.error) throw toSyncError(res.error, what);
    return res.data;
  }

  async push(rows: readonly FieldChangeRow[]): Promise<PushedRow[]> {
    const data = await this.call<PushedRow[]>('push', (c) =>
      c
        .from('field_changes')
        .upsert(rows as FieldChangeRow[], { onConflict: 'id', ignoreDuplicates: true })
        .select('id, server_seq'),
    );
    return data ?? [];
  }

  async pull(afterSeq: number, limit: number): Promise<FieldChangeRow[]> {
    const data = await this.call<FieldChangeRow[]>('pull', (c) =>
      c
        .from('field_changes')
        .select('*')
        .gt('server_seq', afterSeq)
        .order('server_seq', { ascending: true })
        .limit(limit),
    );
    return data ?? [];
  }

  async serverTime(): Promise<number> {
    const data = await this.call<number | string>('time', (c) => c.rpc('server_time_ms'));
    return Number(data);
  }

  async uploadPhoto(path: string, blob: Blob, contentType: string): Promise<void> {
    await this.call('upload', (c) => c.storage.from(BUCKET).upload(path, blob, { contentType, upsert: true }));
  }

  async downloadPhoto(path: string): Promise<Blob | null> {
    const client = await this.getClient();
    let res: { data: Blob | null; error: unknown };
    try {
      res = await client.storage.from(BUCKET).download(path);
    } catch (e) {
      throw toSyncError(e, 'download');
    }
    if (res.error) {
      const e = res.error as { message?: string; statusCode?: string | number; status?: number };
      if (/not found/i.test(e.message ?? '') || [400, 404, '400', '404'].includes(e.statusCode ?? e.status ?? 0))
        return null;
      throw toSyncError(res.error, 'download');
    }
    return res.data;
  }

  async deletePhoto(path: string): Promise<void> {
    await this.call('delete', (c) => c.storage.from(BUCKET).remove([path]));
  }

  subscribe(onChange: () => void): () => void {
    let stop: (() => void) | undefined;
    let stopped = false;
    void this.getClient().then((client) => {
      if (stopped) return;
      const channel = client
        .channel('field_changes')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'field_changes' }, () => onChange())
        .subscribe();
      stop = () => void client.removeChannel(channel);
    });
    return () => {
      stopped = true;
      stop?.();
    };
  }
}
