/**
 * Sync status for the whole app: local mode vs Supabase, signed-in user, online / offline, unsynced change count.
 * When signed in and online it pushes the outbox shortly after each edit and pulls every 30 s.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getSupabase, signInWithMicrosoft, signOut } from '../auth/supabase';
import { isSupabaseConfigured } from '../config';
import { setCurrentUser } from '../data/identity';
import { LocalSyncEngine, SupabaseSyncEngine, type SyncEngine } from './engine';
import { countPending } from './outbox';

export interface SyncUser {
  id: string;
  email: string | null;
}

export type SyncStatus = 'local' | 'signed-out' | 'offline' | 'syncing' | 'synced' | 'pending' | 'error';

export interface SyncState {
  configured: boolean;
  user: SyncUser | null;
  online: boolean;
  pending: number;
  status: SyncStatus;
  error: string | null;
  lastSyncAt: number | null;
  syncNow: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
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

export function SyncProvider({ children }: { children: ReactNode }) {
  const online = useOnline();
  const pending = useLiveQuery(() => countPending(), [], 0);
  const [user, setUser] = useState<SyncUser | null>(null);
  const [engine, setEngine] = useState<SyncEngine>(() => new LocalSyncEngine());
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const running = useRef(false);

  // auth state (Supabase only)
  useEffect(() => {
    const p = getSupabase();
    if (!p) return;
    let unsub: (() => void) | undefined;
    void p.then(async (client) => {
      const apply = (u: { id: string; email?: string | null } | null | undefined) => {
        setUser(u ? { id: u.id, email: u.email ?? null } : null);
        setCurrentUser(u?.id);
        setEngine(u ? new SupabaseSyncEngine(client, u.id) : new LocalSyncEngine());
      };
      const { data } = await client.auth.getSession();
      apply(data.session?.user);
      const { data: sub } = client.auth.onAuthStateChange((_e, session) => apply(session?.user));
      unsub = () => sub.subscription.unsubscribe();
    });
    return () => unsub?.();
  }, []);

  const syncNow = useCallback(async () => {
    if (engine.mode === 'local' || !online || running.current) return;
    running.current = true;
    setSyncing(true);
    try {
      await engine.push();
      await engine.pull();
      setError(null);
      setLastSyncAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      running.current = false;
      setSyncing(false);
    }
  }, [engine, online]);

  // push soon after local edits, pull periodically
  useEffect(() => {
    if (engine.mode === 'local' || !online) return;
    const t = setTimeout(() => void syncNow(), 1500);
    return () => clearTimeout(t);
  }, [pending, engine, online, syncNow]);
  useEffect(() => {
    if (engine.mode === 'local' || !online) return;
    const t = setInterval(() => void syncNow(), 30_000);
    return () => clearInterval(t);
  }, [engine, online, syncNow]);

  const status: SyncStatus = !isSupabaseConfigured
    ? 'local'
    : !user
      ? 'signed-out'
      : !online
        ? 'offline'
        : error
          ? 'error'
          : syncing
            ? 'syncing'
            : pending > 0
              ? 'pending'
              : 'synced';

  const value = useMemo<SyncState>(
    () => ({
      configured: isSupabaseConfigured,
      user,
      online,
      pending,
      status,
      error,
      lastSyncAt,
      syncNow,
      signIn: signInWithMicrosoft,
      signOut,
    }),
    [user, online, pending, status, error, lastSyncAt, syncNow],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncState {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync outside SyncProvider');
  return ctx;
}
