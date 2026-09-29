/**
 * The pump-curve library syncs like the valve library (an organization record filed under its own id, 0010): created
 * on one device it reaches the other with its curves; an edit and a delete travel too.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { addLibraryPump, deleteLibraryPump, setField } from '../data/repo';
import { pumpCurveResult } from '../domain/pumpCurves';
import { makeDevice, type Device } from '../test/devices';
import { FakeSyncServer } from './fakeServer';

let server: FakeSyncServer;
let A: Device;
let B: Device;

beforeEach(() => {
  server = new FakeSyncServer();
  A = makeDevice(server, 'A', server.addUser('alice@a2b.test'));
  B = makeDevice(server, 'B', server.addUser('bob@a2b.test'));
});

describe('pump library sync', () => {
  it('a pump added on one device reaches the other with its curves; edits and deletes follow', async () => {
    // test data (not a real pump)
    const p = await A.run(() =>
      addLibraryPump({
        make: 'Test',
        model: 'TP',
        size: '2x2x9',
        rpm: 1750,
        curves: [
          {
            impeller: 8,
            points: [
              { gpm: 0, head: 60 },
              { gpm: 200, head: 45 },
            ],
          },
          {
            impeller: 9,
            points: [
              { gpm: 0, head: 76 },
              { gpm: 200, head: 60 },
            ],
          },
        ],
        source: 'test data',
      }),
    );
    await A.sync();
    await B.sync();
    const onB = await B.run(() => db.libraryPumps.get(p.id));
    expect(onB).toMatchObject({ make: 'Test', rpm: 1750, source: 'test data' });
    expect(pumpCurveResult(onB!, { shutoffHead: 68, finalHead: 52.5 }).impeller).toBeCloseTo(8.5);
    await B.run(() => setField('libraryPumps', p.id, 'rpm', 3500));
    await B.sync();
    await A.sync();
    expect((await A.run(() => db.libraryPumps.get(p.id)))?.rpm).toBe(3500);
    await A.run(() => deleteLibraryPump(p.id));
    await A.sync();
    await B.sync();
    expect(await B.run(() => db.libraryPumps.get(p.id))).toBeUndefined();
  });
});
