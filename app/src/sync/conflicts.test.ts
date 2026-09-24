/**
 * Conflict detection with two simulated devices over the fake server: the same field edited on both without seeing
 * each other's edit -> the later edit wins everywhere, both devices flag the other value; a deliberate later edit is
 * not a conflict; different fields merge; resolving (keep / restore through setField) and its sync.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { addEquipment, createProject, lockProject, LockedError, setField } from '../data/repo';
import { makeDevice, type Device } from '../test/devices';
import { resolveConflict } from './conflicts';
import { FakeSyncServer } from './fakeServer';

let server: FakeSyncServer;
let A: Device;
let B: Device;

beforeEach(() => {
  server = new FakeSyncServer();
  A = makeDevice(server, 'A', server.addUser('alice@a2b.test'));
  B = makeDevice(server, 'B', server.addUser('bob@a2b.test'));
});

async function shared() {
  const { p, rtu } = await A.run(async () => {
    const p = await createProject({ name: 'Riverside' });
    return { p, rtu: await addEquipment(p.id, 'rtu', 'RTU-1') };
  });
  await A.sync();
  await B.sync();
  return { p, rtu };
}

const open = (d: Device) => d.run(() => db.conflicts.where('status').equals('open').toArray());
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('conflict detection', () => {
  it('same field on both devices while offline: later edit wins, both devices flag the lost value', async () => {
    const { p, rtu } = await shared();
    await A.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-A'));
    await tick();
    await B.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-B'));
    // A comes online first, then B, then A pulls again
    await A.sync();
    const rb = await B.sync();
    await A.sync();
    expect(rb.conflicts).toBe(1);
    for (const d of [A, B]) {
      expect(await d.run(async () => (await db.equipment.get(rtu.id))?.data.serial)).toBe('SN-B');
      const [c] = await open(d);
      expect(c).toMatchObject({
        kind: 'field',
        projectId: p.id,
        table: 'equipment',
        recordId: rtu.id,
        equipmentId: rtu.id,
        field: 'data.serial',
        current: { value: 'SN-B', local: d === B },
        other: { value: 'SN-A', local: d === A },
      });
      const h = await d.run(() =>
        db.history
          .where('projectId')
          .equals(p.id)
          .filter((e) => e.kind === 'conflict')
          .toArray(),
      );
      expect(h).toHaveLength(1);
      expect(h[0]).toMatchObject({ value: 'SN-B', previous: 'SN-A', field: 'data.serial' });
    }
    // the loser's outbox entry is flagged (kept for review)
    await A.run(async () => {
      const mine = await db.fieldChanges.filter((c) => c.value === 'SN-A').first();
      expect(mine?.conflict).toBe(1);
    });
    expect(server.valueOf('equipment', rtu.id, 'data.serial')).toBe('SN-B');
  });

  it('also when the later edit reaches the server first (the earlier one is superseded there)', async () => {
    const { rtu } = await shared();
    await A.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-A'));
    await tick();
    await B.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-B'));
    await B.sync();
    await A.sync(); // A pushes its older edit: the server keeps SN-B, A applies SN-B
    await B.sync();
    expect(server.log.find((r) => r.value === 'SN-A')).toMatchObject({ applied: false });
    for (const d of [A, B]) {
      expect(await d.run(async () => (await db.equipment.get(rtu.id))?.data.serial)).toBe('SN-B');
      expect((await open(d)).map((c) => [c.current?.value, c.other?.value])).toEqual([['SN-B', 'SN-A']]);
    }
  });

  it('a later edit made after seeing the other value is not a conflict; different fields merge silently', async () => {
    const { rtu } = await shared();
    await A.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-A'));
    await A.sync();
    await B.sync(); // B sees SN-A ...
    await B.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-B')); // ... and corrects it
    await B.sync();
    await A.sync();
    // different fields, both offline
    await A.run(() => setField('equipment', rtu.id, 'data.model', '48FC'));
    await B.run(() => setField('equipment', rtu.id, 'data.manufacturer', 'Carrier'));
    await A.sync();
    await B.sync();
    await A.sync();
    for (const d of [A, B]) {
      expect(await open(d)).toEqual([]);
      const u = await d.run(() => db.equipment.get(rtu.id));
      expect(u?.data).toMatchObject({ serial: 'SN-B', model: '48FC', manufacturer: 'Carrier' });
    }
  });

  it('equal values are not a conflict', async () => {
    const { rtu } = await shared();
    await A.run(() => setField('equipment', rtu.id, 'data.serial', 'SAME'));
    await B.run(() => setField('equipment', rtu.id, 'data.serial', 'SAME'));
    await A.sync();
    await B.sync();
    await A.sync();
    expect(await open(A)).toEqual([]);
    expect(await open(B)).toEqual([]);
  });

  it('project fields (info) and rows conflict the same way', async () => {
    const { p } = await shared();
    await A.run(() => setField('projects', p.id, 'info.architect', 'Lionakis'));
    await tick();
    await B.run(() => setField('projects', p.id, 'info.architect', 'Lionakis Beck'));
    await A.sync();
    await B.sync();
    await A.sync();
    const [c] = await open(A);
    expect(c).toMatchObject({ table: 'projects', field: 'info.architect', equipmentId: null });
  });
});

describe('resolving', () => {
  async function conflicted() {
    const s = await shared();
    await A.run(() => setField('equipment', s.rtu.id, 'data.serial', 'SN-A'));
    await tick();
    await B.run(() => setField('equipment', s.rtu.id, 'data.serial', 'SN-B'));
    await A.sync();
    await B.sync();
    await A.sync();
    return s;
  }

  it('restore the other value: a normal edit that syncs and wins everywhere; settles the other device too', async () => {
    const { rtu } = await conflicted();
    const [c] = await open(A);
    await A.run(() => resolveConflict(c.id, 'restore'));
    await A.run(async () => {
      expect((await db.equipment.get(rtu.id))?.data.serial).toBe('SN-A');
      expect(await db.conflicts.get(c.id)).toMatchObject({ status: 'resolved', resolution: 'restored' });
      const last = (await db.history.toArray()).sort((a, b) => a.ts - b.ts).at(-1);
      expect(last).toMatchObject({ kind: 'conflict-resolved', value: 'SN-A' });
    });
    await A.sync();
    await B.sync();
    expect(server.valueOf('equipment', rtu.id, 'data.serial')).toBe('SN-A');
    expect(await B.run(async () => (await db.equipment.get(rtu.id))?.data.serial)).toBe('SN-A');
    // A's restore saw both values: B's open conflict is settled, and no new one is raised
    expect(await open(B)).toEqual([]);
    const bAll = await B.run(() => db.conflicts.toArray());
    expect(bAll.map((x) => x.resolution)).toEqual(['superseded']);
  });

  it('keep the current value: nothing is written, the conflict closes', async () => {
    const { rtu } = await conflicted();
    const [c] = await open(A);
    const before = await A.run(() => db.fieldChanges.count());
    await A.run(() => resolveConflict(c.id, 'keep'));
    expect(await open(A)).toEqual([]);
    expect(await A.run(() => db.fieldChanges.count())).toBe(before);
    expect(await A.run(async () => (await db.equipment.get(rtu.id))?.data.serial)).toBe('SN-B');
  });

  it('restoring into a locked project is refused with the lock message', async () => {
    const { p } = await conflicted();
    await B.run(() => lockProject(p.id, 'Prelim', null));
    await B.sync();
    await A.sync();
    const [c] = (await open(A)).filter((x) => x.kind === 'field');
    await expect(A.run(() => resolveConflict(c.id, 'restore'))).rejects.toBeInstanceOf(LockedError);
    expect((await open(A)).some((x) => x.id === c.id)).toBe(true);
  });
});
