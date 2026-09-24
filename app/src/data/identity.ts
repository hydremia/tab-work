import { db } from './db';
import { uuid } from './uuid';

/** Who is editing: the Supabase user id when signed in, "local" in local mode. */
let currentUserId = 'local';
export function setCurrentUser(id: string | null | undefined): void {
  currentUserId = id || 'local';
}
export function getCurrentUser(): string {
  return currentUserId;
}

let deviceIdPromise: Promise<string> | null = null;
/** A random id per browser install, stored in IndexedDB (meta table). */
export function getDeviceId(): Promise<string> {
  deviceIdPromise ??= (async () => {
    const row = await db.meta.get('deviceId');
    if (typeof row?.value === 'string') return row.value;
    const id = uuid();
    await db.meta.put({ key: 'deviceId', value: id });
    return id;
  })();
  return deviceIdPromise;
}

/** Test hook: forget the cached device id (after the database was cleared). */
export function resetIdentityCache(): void {
  deviceIdPromise = null;
  currentUserId = 'local';
  userName = null;
  clockSkew = 0;
}

let clockSkew = 0;
/** Test hook: this simulated device's clock runs `ms` ahead (negative: behind) of the real one. */
export function setClockSkewForTests(ms: number): void {
  clockSkew = ms;
  lastTs = 0;
}
/** Test hooks: a simulated device's clock state (skew and last timestamp), saved / restored when switching devices. */
export function saveClockForTests(): { clockSkew: number; lastTs: number } {
  return { clockSkew, lastTs };
}
export function restoreClockForTests(s: { clockSkew: number; lastTs: number }): void {
  clockSkew = s.clockSkew;
  lastTs = s.lastTs;
}
/** The device clock (ms since epoch). */
export function deviceNow(): number {
  return Date.now() + clockSkew;
}

let lastTs = 0;
/** Strictly increasing client timestamp (ms), so two edits in the same millisecond keep their order. */
export function nextTimestamp(): number {
  lastTs = Math.max(deviceNow(), lastTs + 1);
  return lastTs;
}

/**
 * What this device has pulled from the server: the pull cursor (a server_seq) of the signed-in user. Recorded on
 * every change as its baseSeq (sync/conflicts.ts). 0 in local mode / before the first pull.
 */
export interface SyncCursor {
  userId: string;
  seq: number;
}
export async function getSyncCursor(): Promise<SyncCursor | null> {
  const row = await db.meta.get('syncCursor');
  const v = row?.value as SyncCursor | undefined;
  return v && typeof v.seq === 'number' ? v : null;
}
export async function currentBaseSeq(): Promise<number> {
  const c = await getSyncCursor();
  return c && c.userId === currentUserId ? c.seq : 0;
}

let userName: string | null = null;
/** The name this device signs reviews and report locks with (meta "userName"; '' until given). */
export async function getUserName(): Promise<string> {
  if (userName === null) {
    const row = await db.meta.get('userName');
    userName = typeof row?.value === 'string' ? row.value : '';
  }
  return userName;
}
export async function setUserName(name: string): Promise<void> {
  userName = name.trim();
  await db.meta.put({ key: 'userName', value: userName });
}
