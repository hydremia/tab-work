/**
 * SyncBackend over an in-process FakeSyncServer, as one signed-in user on one device, with switches to simulate the
 * network: offline, a request that fails before reaching the server, or one whose response is lost after the server
 * committed it (the device cannot tell the two apart and retries).
 */
import { SyncError, toSyncError, type FieldChangeRow, type PushedRow, type SyncBackend } from './backend';
import type { FakeSyncServer } from './fakeServer';

export class FakeBackend implements SyncBackend {
  offline = false;
  /** The next push fails: 'before' the server sees it, or 'after' it committed (response lost). */
  failNextPush: 'before' | 'after' | null = null;
  /** Fail this many photo uploads (network error). */
  failUploads = 0;
  readonly calls = { push: 0, pull: 0, upload: 0, download: 0, remove: 0 };
  /** Runs while a push is "in flight" (after the server committed, before the response): tests of edits meanwhile. */
  duringPush: (() => Promise<void>) | null = null;
  private listeners = new Set<() => void>();

  constructor(
    readonly server: FakeSyncServer,
    readonly userId: string,
  ) {}

  private net(what: string): void {
    if (this.offline) throw new SyncError(`${what}: Failed to fetch (offline)`, 'network');
  }

  async push(rows: readonly FieldChangeRow[]): Promise<PushedRow[]> {
    await Promise.resolve();
    this.calls.push++;
    this.net('push');
    if (this.failNextPush === 'before') {
      this.failNextPush = null;
      throw new SyncError('push: Failed to fetch', 'network');
    }
    let res: PushedRow[];
    try {
      res = this.server.push(this.userId, rows);
    } catch (e) {
      throw toSyncError(e, 'push');
    }
    if (this.duringPush) {
      const f = this.duringPush;
      this.duringPush = null;
      await f();
    }
    if (this.failNextPush === 'after') {
      this.failNextPush = null;
      throw new SyncError('push: network connection lost', 'network');
    }
    return res;
  }

  async pull(afterSeq: number, limit: number): Promise<FieldChangeRow[]> {
    await Promise.resolve();
    this.calls.pull++;
    this.net('pull');
    return this.server.pull(this.userId, afterSeq, limit);
  }

  async serverTime(): Promise<number> {
    this.net('time');
    return this.server.serverTime();
  }

  async uploadPhoto(path: string, blob: Blob, contentType: string): Promise<void> {
    await Promise.resolve();
    this.calls.upload++;
    this.net('upload');
    if (this.failUploads > 0) {
      this.failUploads--;
      throw new SyncError('upload: Failed to fetch', 'network');
    }
    try {
      this.server.upload(this.userId, path, blob, contentType);
    } catch (e) {
      throw toSyncError(e, 'upload');
    }
  }

  async downloadPhoto(path: string): Promise<Blob | null> {
    this.calls.download++;
    this.net('download');
    return this.server.download(this.userId, path);
  }

  async deletePhoto(path: string): Promise<void> {
    this.calls.remove++;
    this.net('delete');
    this.server.remove(this.userId, path);
  }

  subscribe(onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }

  /** Tests: tell subscribers another device pushed. */
  notify(): void {
    for (const l of this.listeners) l();
  }
}
