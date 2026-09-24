/**
 * Several simulated devices in one test process, sharing one FakeSyncServer. Each device has its own IndexedDB
 * database (fake-indexeddb), device id, signed-in user, clock skew and sync engine; `dev.run(fn)` switches every
 * module to that device's database and identity while `fn` runs. Runs must not overlap (await each one).
 */
import { afterEach } from 'vitest';
import { DEFAULT_DB_NAME, dropDatabase, switchDatabase } from '../data/db';
import { resetIdentityCache, restoreClockForTests, saveClockForTests, setCurrentUser } from '../data/identity';
import { CloudSyncEngine, type EngineOptions } from '../sync/engine';
import { FakeBackend } from '../sync/fakeBackend';
import type { FakeSyncServer, FakeUser } from '../sync/fakeServer';

export interface Device {
  readonly name: string;
  readonly user: FakeUser;
  readonly backend: FakeBackend;
  readonly engine: CloudSyncEngine;
  /** Run `fn` as this device. */
  run<T>(fn: () => Promise<T> | T): Promise<T>;
  /** Pull + push + photos, as this device. */
  sync(): ReturnType<CloudSyncEngine['sync']>;
}

const created: string[] = [];
let active: string | null = null;
const clocks = new Map<string, { clockSkew: number; lastTs: number }>();

export function makeDevice(
  server: FakeSyncServer,
  name: string,
  user: FakeUser,
  opts: EngineOptions & { skewMs?: number } = {},
): Device {
  const dbName = `device-${name}-${Math.random().toString(36).slice(2)}`;
  created.push(dbName);
  clocks.set(dbName, { clockSkew: opts.skewMs ?? 0, lastTs: 0 });
  const backend = new FakeBackend(server, user.id);
  const engine = new CloudSyncEngine(backend, user.id, { settleMs: 0, ...opts });
  const dev: Device = {
    name,
    user,
    backend,
    engine,
    async run(fn) {
      if (active && active !== dbName) clocks.set(active, saveClockForTests());
      switchDatabase(dbName);
      if (active !== dbName) {
        resetIdentityCache();
        restoreClockForTests(clocks.get(dbName)!);
        setCurrentUser(user.id);
        active = dbName;
      }
      return fn();
    },
    sync: () => dev.run(() => engine.sync()),
  };
  return dev;
}

afterEach(async () => {
  switchDatabase(DEFAULT_DB_NAME);
  for (const name of created.splice(0)) await dropDatabase(name);
  resetIdentityCache();
  active = null;
  clocks.clear();
});
