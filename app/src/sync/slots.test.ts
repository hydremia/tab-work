/**
 * Workbook slot collisions between two (or three) simulated devices over the fake server: resolved on pull, the later
 * create moves, the move syncs, both devices agree, history + note, capacity, locked projects, and the pure planner.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { addEquipment, createProject, lockProject, unlockProject } from '../data/repo';
import { needsAttention } from '../domain/attention';
import { makeDevice, type Device } from '../test/devices';
import { toProjectData } from '../workbook/adapter';
import { loadBundle } from '../workbook/bundle';
import { FakeSyncServer } from './fakeServer';
import { planSlotMoves } from './slots';

let server: FakeSyncServer;
let A: Device;
let B: Device;

beforeEach(() => {
  server = new FakeSyncServer();
  A = makeDevice(server, 'A', server.addUser('alice@a2b.test'));
  B = makeDevice(server, 'B', server.addUser('bob@a2b.test'));
});

async function sharedProject() {
  const p = await A.run(async () => {
    const p = await createProject({ name: 'Riverside' });
    await addEquipment(p.id, 'rtu', 'RTU-1');
    return p;
  });
  await A.sync();
  await B.sync();
  return p;
}

const units = (d: Device, projectId: string) =>
  d.run(async () =>
    (await db.equipment.where('projectId').equals(projectId).toArray())
      .map((e) => ({ d: e.designation, slot: e.slot, move: e.slotMove ?? null }))
      .sort((a, b) => a.d.localeCompare(b.d)),
  );

describe('slot collisions on sync (two devices)', () => {
  it('both devices add a unit offline in the same slot: the later push moves, synced to both', async () => {
    const p = await sharedProject();
    // offline on both: each picks slot 2
    const a2 = await A.run(() => addEquipment(p.id, 'rtu', 'RTU-2'));
    const b3 = await B.run(() => addEquipment(p.id, 'rtu', 'RTU-3'));
    expect(a2.slot).toBe(2);
    expect(b3.slot).toBe(2);
    await A.sync(); // A's create reaches the server first
    const r = await B.sync(); // B pulls A's unit: its own (not yet on the server) moves, then pushes
    expect(r.slotMoves).toBe(1);
    await A.sync();
    for (const d of [A, B])
      expect(await units(d, p.id)).toEqual([
        { d: 'RTU-1', slot: 1, move: null },
        { d: 'RTU-2', slot: 2, move: null },
        { d: 'RTU-3', slot: 3, move: { from: 2, to: 3, otherId: a2.id } },
      ]);
    expect(server.valueOf('equipment', b3.id, 'slot')).toBe(3);
    // history on the moving device says why; the other device gets the synced change
    const hist = await B.run(() => db.history.filter((h) => h.recordId === b3.id).toArray());
    expect(hist.find((h) => h.field === 'slot')).toMatchObject({
      previous: 2,
      value: 3,
      source: 'auto',
      note: 'Moved from slot 2 to slot 3: another device used slot 2 (RTU-2)',
    });
    expect(
      await A.run(async () =>
        (await db.history.filter((h) => h.recordId === b3.id).toArray()).some(
          (h) => h.field === 'slot' && h.value === 3,
        ),
      ),
    ).toBe(true);
    // no conflicts and nothing left to push; the export has no duplicate slot
    for (const d of [A, B]) {
      expect(await d.run(() => db.conflicts.count())).toBe(0);
      const { warnings } = await d.run(async () => toProjectData(await loadBundle(p.id)));
      expect(warnings.join('\n')).not.toMatch(/slot/);
    }
  });

  it('both devices pushed before seeing each other: each resolves the same way, equal values, no conflict', async () => {
    const p = await sharedProject();
    const a2 = await A.run(() => addEquipment(p.id, 'rtu', 'RTU-2'));
    const b3 = await B.run(() => addEquipment(p.id, 'rtu', 'RTU-3'));
    // both push without pulling the other's create first
    await A.run(() => A.engine.push());
    await B.run(() => B.engine.push());
    await A.sync(); // A pulls B's create (later seq): moves B's unit
    await B.sync(); // B pulls: A's move arrives; B would have moved it the same way
    await A.sync();
    for (const d of [A, B]) {
      expect((await units(d, p.id)).map((u) => u.slot)).toEqual([1, 2, 3]);
      expect(await d.run(() => db.conflicts.count())).toBe(0);
    }
    expect(server.valueOf('equipment', a2.id, 'slot')).toBe(2);
    expect(server.valueOf('equipment', b3.id, 'slot')).toBe(3);
  });

  it('three devices, three units in one slot: moved to the next free slots in create order', async () => {
    const C = makeDevice(server, 'C', server.addUser('carol@a2b.test'));
    const p = await sharedProject();
    await C.sync();
    const xs = [];
    for (const [d, name] of [
      [A, 'RTU-A'],
      [B, 'RTU-B'],
      [C, 'RTU-C'],
    ] as const)
      xs.push(await d.run(() => addEquipment(p.id, 'rtu', name)));
    await A.sync();
    await B.sync();
    await C.sync();
    await A.sync();
    await B.sync();
    for (const d of [A, B, C])
      expect((await units(d, p.id)).map((u) => `${u.d}:${u.slot}`)).toEqual([
        'RTU-1:1',
        'RTU-A:2',
        'RTU-B:3',
        'RTU-C:4',
      ]);
  });

  it('no free slot (type at capacity): nothing moves, Attention lists it, the export leaves the later unit out', async () => {
    const p = await A.run(async () => {
      const p = await createProject({ name: 'Full' });
      for (let i = 1; i <= 9; i++) await addEquipment(p.id, 'mau', `MAU-${i}`);
      return p;
    });
    await A.sync();
    await B.sync();
    await A.run(() => addEquipment(p.id, 'mau', 'MAU-10A'));
    const b = await B.run(() => addEquipment(p.id, 'mau', 'MAU-10B'));
    await A.sync();
    const r = await B.sync();
    expect(r.slotMoves ?? 0).toBe(0);
    const bundle = await B.run(() => loadBundle(p.id));
    expect(bundle.equipment.filter((e) => e.slot === 10)).toHaveLength(2);
    const items = needsAttention({ ...bundle, photos: [] });
    expect(items.find((i) => i.id.startsWith('capacity:slot:'))?.text).toMatch(
      /MAU-10A and MAU-10B both use slot 10: the workbook has no free MAU slot/,
    );
    const { data, warnings } = toProjectData(bundle);
    expect(data.equipment.mau.filter((u) => u.slot === 10)).toHaveLength(1);
    expect(warnings.join('\n')).toMatch(/MAU-10B is not exported: slot 10 is also used by MAU-10A/);
    expect(bundle.equipment.find((e) => e.id === b.id)?.slot).toBe(10);
  });

  it('a locked project waits until it is unlocked', async () => {
    const p = await sharedProject();
    await A.run(() => addEquipment(p.id, 'rtu', 'RTU-2'));
    await B.run(() => addEquipment(p.id, 'rtu', 'RTU-3'));
    await B.run(() => lockProject(p.id, 'Prelim', null));
    await A.sync();
    await B.sync(); // B's project is locked on B: its pending changes are held, nothing moves
    expect((await units(B, p.id)).map((u) => u.slot)).toEqual([1, 2, 2]);
    await B.run(() => unlockProject(p.id));
    await B.sync(); // unlocked: the collision is resolved in this sync
    await A.sync();
    for (const d of [A, B]) expect((await units(d, p.id)).map((u) => u.slot)).toEqual([1, 2, 3]);
  });
});

describe('planSlotMoves (pure)', () => {
  it('keeps the earliest create, moves the others to the lowest free slots, reports what cannot move', () => {
    const plan = planSlotMoves([
      { id: 'a', type: 'rtu', slot: 1, createSeq: 5 },
      { id: 'b', type: 'rtu', slot: 1, createSeq: 3 },
      { id: 'c', type: 'rtu', slot: 1 },
      { id: 'd', type: 'rtu', slot: 2, createSeq: 1 },
      { id: 'e', type: 'vav', slot: 4, createSeq: 9 },
    ]);
    expect(plan.moves).toEqual([
      { id: 'a', from: 1, to: 3, otherId: 'b' },
      { id: 'c', from: 1, to: 4, otherId: 'b' },
    ]);
    expect(plan.blocked).toEqual([]);
    const full = planSlotMoves(
      Array.from({ length: 11 }, (_, i) => ({
        id: `m${i}`,
        type: 'mau' as const,
        slot: Math.min(i + 1, 10),
        createSeq: i,
      })),
    );
    expect(full.moves).toEqual([]);
    expect(full.blocked).toEqual([{ type: 'mau', slot: 10, ids: ['m9', 'm10'] }]);
  });
});
