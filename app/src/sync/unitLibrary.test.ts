/**
 * The unit configuration library syncs like the pump library (an organization record filed under its own id, 0014):
 * created on one device it reaches the other with its component order and documents; an edit and a delete travel too.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { addLibraryUnit, deleteLibraryUnit, setField } from '../data/repo';
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

describe('unit library sync', () => {
  it('an entry added on one device reaches the other with its order and documents; edits and deletes follow', async () => {
    const u = await A.run(() =>
      addLibraryUnit({
        make: 'Carrier',
        line: 'WeatherMaster 48GE',
        modelPatterns: '48GE*',
        unitType: 'RTU',
        components: [
          { kind: 'filter' },
          { kind: 'coil' },
          { kind: 'reheat', optional: true },
          { kind: 'fan' },
          { kind: 'heat' },
        ],
        confidence: 'inferred',
        documents: [{ title: '48/50GE 17-28 product data', kind: 'productData', ref: '48-50GE-17-28-01PD' }],
      }),
    );
    await A.sync();
    await B.sync();
    const onB = await B.run(() => db.libraryUnits.get(u.id));
    expect(onB).toMatchObject({ make: 'Carrier', modelPatterns: '48GE*', confidence: 'inferred' });
    expect(onB?.components?.map((c) => c.kind)).toEqual(['filter', 'coil', 'reheat', 'fan', 'heat']);
    expect(onB?.documents?.[0].ref).toBe('48-50GE-17-28-01PD');
    await B.run(() => setField('libraryUnits', u.id, 'confidence', 'stated'));
    await B.sync();
    await A.sync();
    expect((await A.run(() => db.libraryUnits.get(u.id)))?.confidence).toBe('stated');
    await A.run(() => deleteLibraryUnit(u.id));
    await A.sync();
    await B.sync();
    expect(await B.run(() => db.libraryUnits.get(u.id))).toBeUndefined();
  });
});
