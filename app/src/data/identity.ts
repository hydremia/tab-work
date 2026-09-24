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
}

let lastTs = 0;
/** Strictly increasing client timestamp (ms), so two edits in the same millisecond keep their order. */
export function nextTimestamp(): number {
  lastTs = Math.max(Date.now(), lastTs + 1);
  return lastTs;
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
