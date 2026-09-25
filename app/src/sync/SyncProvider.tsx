/**
 * Sync status for the whole app: local mode vs cloud, signed-in user, online / offline, unsynced change count.
 * When signed in and online it syncs shortly after each edit, every 30 s, when the device comes back online and when
 * the server says another device pushed (Realtime).
 *
 * First sign-in on a device that already has projects (made in local mode): syncing waits until the user chooses on
 * /cloud-setup which of them move to the cloud (the others stay on this device only). Sign-out keeps all local data
 * and stops syncing; unsynced changes stay in the outbox until someone signs in again.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db } from '../data/db';
import { setCurrentUser } from '../data/identity';
import { cloudConfigured, getCloud, type Cloud, type CloudUser } from './cloud';
import type { SyncEngine } from './engine';
import { countPending, localOnlyProjects, setLocalOnlyProjects } from './outbox';

export type SyncUser = CloudUser;

export type SyncStatus = 'local' | 'signed-out' | 'setup' | 'offline' | 'syncing' | 'synced' | 'pending' | 'error';

export interface SyncState {
  configured: boolean;
  user: SyncUser | null;
  online: boolean;
  pending: number;
  status: SyncStatus;
  error: string | null;
  lastSyncAt: number | null;
  /** First sign-in with local projects on the device: waiting for the choice on /cloud-setup. */
  onboarding: boolean;
  syncNow: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Sign out, then delete every project, photo and setting on this device (shared devices). */
  signOutAndRemove: () => Promise<void>;
  /** /auth/callback: finish the sign-in. */
  completeSignIn: (url: string) => Promise<SyncUser | null>;
  /** /cloud-setup: upload these projects; every other local project stays on this device only. */
  finishOnboarding: (upload: readonly string[]) => Promise<void>;
  /** Move a device-only project to the cloud later. */
  uploadProject: (projectId: string) => Promise<void>;
}

const SyncContext = createContext<SyncState | null>(null);

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/** Projects on this device that are not on the server yet (their create is not synced) and not kept device-only. */
export async function localProjects(): Promise<{ id: string; name: string; changes: number }[]> {
  const localOnly = await localOnlyProjects();
  const out: { id: string; name: string; changes: number }[] = [];
  for (const p of await db.projects.toArray()) {
    if (localOnly.has(p.id)) continue;
    const create = await db.fieldChanges
      .where('[table+recordId+field]')
      .equals(['projects', p.id, ''])
      .filter((c) => c.op === 'create')
      .first();
    if (create && create.synced === 1) continue;
    out.push({ id: p.id, name: p.name, changes: await db.fieldChanges.where('projectId').equals(p.id).count() });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function needsOnboarding(userId: string): Promise<boolean> {
  const row = await db.meta.get('cloudUser');
  if (row?.value === userId) return false;
  if ((await localProjects()).length) return true;
  await db.meta.put({ key: 'cloudUser', value: userId });
  return false;
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const online = useOnline();
  const [user, setUser] = useState<SyncUser | null>(null);
  const [cloud, setCloud] = useState<Cloud | null>(null);
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const running = useRef(false);
  const again = useRef(false);
  const pending = useLiveQuery(() => countPending(Boolean(user)), [user], 0);

  // auth state
  useEffect(() => {
    const p = getCloud();
    if (!p) return;
    let unsub: (() => void) | undefined;
    let stopped = false;
    let lastId: string | null | undefined;
    void p.then(async (c) => {
      if (stopped) return;
      setCloud(c);
      const apply = async (u: CloudUser | null) => {
        if (stopped || (u?.id ?? null) === lastId) {
          if (u) setUser(u);
          return;
        }
        lastId = u?.id ?? null;
        setCurrentUser(u?.id);
        setUser(u);
        setError(null);
        if (!u) {
          setEngine(null);
          setOnboarding(false);
          return;
        }
        const [{ CloudSyncEngine }, setup] = await Promise.all([import('./engine'), needsOnboarding(u.id)]);
        if (stopped || lastId !== u.id) return;
        setOnboarding(setup);
        setEngine(new CloudSyncEngine(c.backend(u), u.id));
      };
      unsub = c.auth.onChange((u) => void apply(u));
      await apply(await c.auth.getUser());
    });
    return () => {
      stopped = true;
      unsub?.();
    };
  }, []);

  const syncNow = useCallback(async () => {
    if (!engine || onboarding || !online) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    setSyncing(true);
    try {
      do {
        again.current = false;
        await engine.sync();
      } while (again.current);
      setError(null);
      setLastSyncAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      running.current = false;
      setSyncing(false);
    }
  }, [engine, onboarding, online]);

  // soon after local edits (and when coming back online), periodically, and on Realtime hints
  useEffect(() => {
    if (!engine || !online) return;
    const t = setTimeout(() => void syncNow(), pending ? 1500 : 0);
    return () => clearTimeout(t);
  }, [pending, engine, online, syncNow]);
  useEffect(() => {
    if (!engine || !online) return;
    const t = setInterval(() => void syncNow(), 30_000);
    return () => clearInterval(t);
  }, [engine, online, syncNow]);
  useEffect(() => {
    if (!engine?.subscribe || !online) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const stop = engine.subscribe(() => {
      clearTimeout(t);
      t = setTimeout(() => void syncNow(), 500);
    });
    return () => {
      clearTimeout(t);
      stop();
    };
  }, [engine, online, syncNow]);

  const signIn = useCallback(async () => {
    if (!cloud) throw new Error('Sign-in is not configured (local mode)');
    await cloud.auth.signIn();
  }, [cloud]);
  const signOut = useCallback(async () => {
    await cloud?.auth.signOut();
  }, [cloud]);
  const signOutAndRemove = useCallback(async () => {
    try {
      await cloud?.auth.signOut();
    } catch {
      /* offline: the local session is removed with the data below */
    }
    setEngine(null);
    setUser(null);
    const { removeLocalData } = await import('../data/wipe');
    await removeLocalData();
    reloadApp();
  }, [cloud]);
  const completeSignIn = useCallback(
    async (url: string) => {
      const c = cloud ?? (await getCloud());
      if (!c) throw new Error('Sign-in is not configured (local mode)');
      return c.auth.completeSignIn(url);
    },
    [cloud],
  );
  const finishOnboarding = useCallback(
    async (upload: readonly string[]) => {
      if (!user) return;
      const keep = new Set(upload);
      const stay = (await localProjects()).filter((p) => !keep.has(p.id)).map((p) => p.id);
      const localOnly = await localOnlyProjects();
      await setLocalOnlyProjects([...[...localOnly].filter((id) => !keep.has(id)), ...stay]);
      await db.meta.put({ key: 'cloudUser', value: user.id });
      setOnboarding(false);
    },
    [user],
  );
  const uploadProject = useCallback(async (projectId: string) => {
    const localOnly = await localOnlyProjects();
    localOnly.delete(projectId);
    await setLocalOnlyProjects(localOnly);
  }, []);

  const configured = cloudConfigured();
  const status: SyncStatus = !configured
    ? 'local'
    : !user
      ? 'signed-out'
      : onboarding
        ? 'setup'
        : !online
          ? 'offline'
          : error
            ? 'error'
            : syncing || !engine || !lastSyncAt
              ? 'syncing'
              : pending > 0
                ? 'pending'
                : 'synced';

  const value = useMemo<SyncState>(
    () => ({
      configured,
      user,
      online,
      pending,
      status,
      error,
      lastSyncAt,
      onboarding,
      syncNow,
      signIn,
      signOut,
      signOutAndRemove,
      completeSignIn,
      finishOnboarding,
      uploadProject,
    }),
    [
      configured,
      user,
      online,
      pending,
      status,
      error,
      lastSyncAt,
      onboarding,
      syncNow,
      signIn,
      signOut,
      signOutAndRemove,
      completeSignIn,
      finishOnboarding,
      uploadProject,
    ],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/** Start the app fresh after its data was removed (a test replaces it). */
export let reloadApp = (): void => {
  window.location.replace('/');
};
export function setReloadAppForTests(fn: () => void): void {
  reloadApp = fn;
}

export function useSync(): SyncState {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync outside SyncProvider');
  return ctx;
}
