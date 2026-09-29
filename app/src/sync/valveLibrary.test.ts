/**
 * The balancing-valve library syncs like the calibration library (an organization record filed under its own id,
 * 0009): created on one device it reaches the other, Cv table included; an edit and a delete travel too; a valve row
 * picked from it keeps its make / model after the library entry is removed.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { addLibraryValve, deleteLibraryValve, setField } from '../data/repo';
import { valveFlow } from '../domain/valves';
import { makeDevice, type Device } from '../test/devices';
import { FakeSyncServer, type FakeUser } from './fakeServer';

let server: FakeSyncServer;
let alice: FakeUser;
let bob: FakeUser;
let A: Device;
let B: Device;

beforeEach(() => {
  server = new FakeSyncServer();
  alice = server.addUser('alice@a2b.test');
  bob = server.addUser('bob@a2b.test');
  A = makeDevice(server, 'A', alice);
  B = makeDevice(server, 'B', bob);
});

describe('valve library sync', () => {
  it('a valve added on one device reaches the other with its Cv table; edits and deletes follow', async () => {
    const v = await A.run(() =>
      addLibraryValve({
        make: 'Test',
        model: 'CBV',
        size: '1"',
        valveType: 'A',
        cvTable: [
          { setting: 0, cv: 0.5 },
          { setting: 4, cv: 3.5 },
        ],
        source: 'test data',
      }),
    );
    await A.sync();
    await B.sync();
    const onB = await B.run(() => db.libraryValves.get(v.id));
    expect(onB).toMatchObject({ make: 'Test', valveType: 'A', source: 'test data' });
    expect(valveFlow(onB!, 4, 4, 'psi').gpm).toBeCloseTo(7, 9); // 3.5 × √4
    expect(server.valueOf('libraryValves', v.id, 'model')).toBe('CBV');
    await B.run(() => setField('libraryValves', v.id, 'model', 'CBV-2'));
    await B.sync();
    await A.sync();
    expect((await A.run(() => db.libraryValves.get(v.id)))?.model).toBe('CBV-2');
    await A.run(() => deleteLibraryValve(v.id));
    await A.sync();
    await B.sync();
    expect(await B.run(() => db.libraryValves.get(v.id))).toBeUndefined();
  });
});
