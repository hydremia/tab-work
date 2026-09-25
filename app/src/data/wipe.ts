/**
 * "Sign out and remove data from this device" (shared devices): deletes the app's IndexedDB database (projects,
 * photos, outbox, history, revisions, library, device id) and the origin's localStorage / sessionStorage (the
 * Supabase session, install / reminder choices). The service worker's app-shell cache holds no user data and stays,
 * so the app still opens offline afterwards (empty, signed out).
 */
import { db } from './db';
import { resetIdentityCache } from './identity';

export async function removeLocalData(): Promise<void> {
  db.close();
  await db.delete();
  resetIdentityCache();
  for (const s of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      s?.clear();
    } catch {
      /* storage blocked: nothing stored there either */
    }
  }
}
