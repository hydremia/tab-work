/**
 * Template revision 08 moves the static profile readings from the rev 05-07 positional keys (spLeaving1-5) to their
 * components (spCoil, spHeat ...). The move is an ordinary attributed write, so it syncs: entered on one device before
 * the update, moved on the other after it, both end with the component keys and no conflict; a second device running
 * the move too writes the same values (no conflict either).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { addEquipment, createProject, migrateLegacyStatic, migrateProjectStatic, setFields } from '../data/repo';
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

describe('static profile readings moved to their components (revision 08)', () => {
  it('moved on one device, synced to the other; the old keys are gone everywhere', async () => {
    const { p, rtu } = await A.run(async () => {
      const p = await createProject({ name: 'Pilot' });
      const rtu = await addEquipment(p.id, 'rtu', 'RTU-1');
      // a 3-point profile as revision 07 stored it: entering, "heat" (the fan inlet), "fan" (the discharge)
      await setFields('equipment', rtu.id, {
        'data.spTaps': '3-point',
        'data.spEntering': -0.317,
        'data.spLeaving4': -0.806,
        'data.spLeaving5': 0.514,
        'naState.fields.spLeaving1': { notation: 'Not Acc.' },
      });
      return { p, rtu };
    });
    await A.sync();
    await B.sync();
    expect(await B.run(() => migrateProjectStatic(p.id))).toBe(1);
    await B.sync();
    await A.sync();
    for (const d of [A, B]) {
      const u = (await d.run(() => db.equipment.get(rtu.id)))!;
      expect(u.data).toMatchObject({ spEntering: -0.317, spCoil: -0.806, spHeat: 0.514, spTaps: '3-point' });
      expect(u.naState.fields.spFilter).toEqual({ notation: 'Not Acc.' });
      for (let k = 1; k <= 5; k++) {
        expect(u.data[`spLeaving${k}`] ?? null).toBeNull();
        expect(u.naState.fields[`spLeaving${k}`] ?? null).toBeNull();
      }
    }
    // nothing left to move; both devices running the move write the same values: no conflict
    expect(await A.run(async () => migrateLegacyStatic((await db.equipment.get(rtu.id))!))).toBe(false);
    expect(await A.run(() => db.conflicts.where('status').equals('open').count())).toBe(0);
    expect(await B.run(() => db.conflicts.where('status').equals('open').count())).toBe(0);
  });
});
