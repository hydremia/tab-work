/**
 * Sync engine against the in-memory fake server, with two (or three) simulated devices: push batching and order,
 * idempotent retries, partial failure, pull pagination and the settle window, clock skew, offline -> online, report
 * lock arriving from another device, held changes, server review clearing, project deletes.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import {
  addAirflowRow,
  addEquipment,
  createProject,
  deleteRecord,
  LockedError,
  lockProject,
  setField,
  unlockProject,
} from '../data/repo';
import { makeDevice, type Device } from '../test/devices';
import { SyncError } from './backend';
import { discardHeld } from './conflicts';
import { FakeSyncServer, type FakeUser } from './fakeServer';
import { countPending, pendingChanges } from './outbox';

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

/** A project with one RTU made on A and pulled by B. */
async function shared() {
  const { p, rtu } = await A.run(async () => {
    const p = await createProject({ name: 'Riverside' });
    const rtu = await addEquipment(p.id, 'rtu', 'RTU-1');
    return { p, rtu };
  });
  await A.sync();
  await B.sync();
  return { p, rtu };
}

const serial = (d: Device, id: string) => d.run(async () => (await db.equipment.get(id))?.data.serial);

describe('push and pull between two devices', () => {
  it('a project made on A (project, instruments, unit, row) arrives on B; edits flow both ways', async () => {
    const { p, rtu } = await shared();
    await A.run(() => addAirflowRow(rtu, 'supply', { no: 'S-1' }));
    await A.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-1'));
    await A.sync();
    await B.sync();
    await B.run(async () => {
      expect((await db.projects.get(p.id))?.name).toBe('Riverside');
      expect(await db.instruments.where('projectId').equals(p.id).count()).toBe(7);
      expect((await db.airflowRows.where('equipmentId').equals(rtu.id).first())?.data.no).toBe('S-1');
      expect(await countPending(true)).toBe(0);
    });
    expect(await serial(B, rtu.id)).toBe('SN-1');
    await B.run(() => setField('equipment', rtu.id, 'data.model', '48FC'));
    await B.sync();
    await A.sync();
    expect(await A.run(async () => (await db.equipment.get(rtu.id))?.data.model)).toBe('48FC');
    // the server's record matches
    expect(server.valueOf('equipment', rtu.id, 'data.serial')).toBe('SN-1');
    expect(server.valueOf('equipment', rtu.id, 'data.model')).toBe('48FC');
  });

  it('pushes in batches, oldest first, in the order the edits were made', async () => {
    A = makeDevice(server, 'A2', alice, { batchSize: 4 });
    const p = await A.run(() => createProject({ name: 'Batch' })); // project + 7 instruments = 8 changes
    const rtu = await A.run(() => addEquipment(p.id, 'rtu', 'RTU-1'));
    for (let i = 1; i <= 5; i++) await A.run(() => setField('equipment', rtu.id, `data.f${i}`, i));
    const local = await A.run(() => pendingChanges(100));
    expect(local).toHaveLength(14);
    const res = await A.sync();
    expect(res.pushed).toBe(14);
    expect(server.requests.map((r) => r.ids.length)).toEqual([4, 4, 4, 2]);
    expect(server.log.map((r) => r.id)).toEqual(local.map((c) => c.id));
    expect(server.log[0]).toMatchObject({ table_name: 'projects', op: 'create' });
    await A.run(async () => expect(await countPending()).toBe(0));
  });
});

describe('retries and failures', () => {
  it('a push whose response was lost is retried without applying anything twice', async () => {
    const { rtu } = await shared();
    await A.run(() => setField('equipment', rtu.id, 'designation', 'RTU-1A'));
    A.backend.failNextPush = 'after'; // the server committed, the device never heard back
    await expect(A.sync()).rejects.toBeInstanceOf(SyncError);
    await A.run(async () => expect(await countPending()).toBe(1)); // still in the outbox
    const logged = server.log.length;
    // meanwhile B renames the unit again
    await B.sync();
    await B.run(() => setField('equipment', rtu.id, 'designation', 'RTU-1B'));
    await B.sync();
    await A.sync(); // the retry
    expect(server.log.length).toBe(logged + 1); // only B's edit was added; A's retry was skipped
    expect(server.valueOf('equipment', rtu.id, 'designation')).toBe('RTU-1B');
    expect(await A.run(async () => (await db.equipment.get(rtu.id))?.designation)).toBe('RTU-1B');
    await A.run(async () => expect(await countPending()).toBe(0));
  });

  it('a re-pushed create does not reset the record or bring a deleted one back', async () => {
    const { rtu } = await shared();
    // replay A's original create (as a lost-response retry would)
    const create = server.log.find((r) => r.record_id === rtu.id && r.op === 'create')!;
    await B.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-B'));
    await B.sync();
    server.push(alice.id, [{ ...create }]);
    expect(server.valueOf('equipment', rtu.id, 'data.serial')).toBe('SN-B');
    await B.run(() => deleteRecord('equipment', rtu.id));
    await B.sync();
    server.push(alice.id, [{ ...create, id: crypto.randomUUID() }]);
    expect(server.record('equipment', rtu.id)).toBeUndefined();
    expect(server.log.at(-1)).toMatchObject({ applied: false, note: 'record was deleted' });
    await A.sync();
    await A.run(async () => expect(await db.equipment.get(rtu.id)).toBeUndefined());
  });

  it('partial failure mid-batch: sent batches stay synced, the rest is retried', async () => {
    A = makeDevice(server, 'A3', alice, { batchSize: 3 });
    const p = await A.run(() => createProject({ name: 'Partial' })); // 8 changes
    let calls = 0;
    const push = A.backend.push.bind(A.backend);
    A.backend.push = async (rows) => {
      if (++calls === 2) throw new SyncError('push: Failed to fetch', 'network');
      return push(rows);
    };
    await expect(A.sync()).rejects.toThrow(/Failed to fetch/);
    await A.run(async () => expect(await countPending()).toBe(5));
    expect(server.log).toHaveLength(3);
    await A.sync();
    await A.run(async () => expect(await countPending()).toBe(0));
    expect(server.log).toHaveLength(8);
    expect(server.record('projects', p.id)).toBeDefined();
  });

  it('a request refused by the server as a whole (another organization) leaves the outbox untouched', async () => {
    const mallory = server.addUser('m@other.test', 'other');
    const { p } = await shared();
    const M = makeDevice(server, 'M', mallory);
    await M.run(async () => {
      await db.projects.put((await A.run(() => db.projects.get(p.id)))!);
    });
    await M.run(() => setField('projects', p.id, 'info.architect', 'hack'));
    await expect(M.sync()).rejects.toMatchObject({ kind: 'forbidden' });
    await M.run(async () => expect(await countPending()).toBe(1));
    expect(server.valueOf('projects', p.id, 'info.architect')).toBeUndefined();
  });

  it('an edit made while its push is in flight is not lost (the coalesced entry gets a new id)', async () => {
    const { rtu } = await shared();
    await A.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-1'));
    // the next keystroke lands while SN-1 is on its way: setField coalesces it into the same (unsynced) outbox entry
    A.backend.duringPush = () => A.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-12'));
    await A.sync();
    // the server has both steps, under two ids (re-sending the first id would have been skipped as a duplicate)
    expect(server.log.filter((r) => r.field === 'data.serial').map((r) => r.value)).toEqual(['SN-1', 'SN-12']);
    expect(server.valueOf('equipment', rtu.id, 'data.serial')).toBe('SN-12');
    await A.run(async () => expect(await countPending()).toBe(0));
    await B.sync();
    expect(await serial(B, rtu.id)).toBe('SN-12');
  });

  it('offline -> online: edits pile up, then everything goes out in one sync', async () => {
    const { rtu } = await shared();
    A.backend.offline = true;
    await A.run(async () => {
      await setField('equipment', rtu.id, 'data.serial', 'SN-OFF');
      await setField('equipment', rtu.id, 'data.model', 'M-OFF');
    });
    await expect(A.sync()).rejects.toMatchObject({ kind: 'network' });
    await A.run(async () => expect(await countPending()).toBe(2));
    A.backend.offline = false;
    const res = await A.sync();
    expect(res.pushed).toBe(2);
    await B.sync();
    expect(await serial(B, rtu.id)).toBe('SN-OFF');
  });
});

describe('pull', () => {
  it('pages through the log by cursor and resumes where it stopped', async () => {
    const { rtu } = await shared();
    for (let i = 0; i < 23; i++) await A.run(() => setField('equipment', rtu.id, `data.f${i}`, i));
    await A.sync();
    B = makeDevice(server, 'B2', bob, { pageSize: 5 });
    const pulls = B.backend.calls.pull;
    const res = await B.run(() => B.engine.pull());
    const total = server.log.length;
    expect(res.applied).toBe(total); // the whole log (fresh device)
    expect(B.backend.calls.pull - pulls).toBe(Math.ceil(total / 5) + (total % 5 === 0 ? 1 : 0));
    expect(await B.run(async () => (await db.equipment.get(rtu.id))?.data.f22)).toBe(22);
    // nothing new: one request, nothing applied
    const again = await B.run(() => B.engine.pull());
    expect(again.applied).toBe(0);
    const cursor = await B.run(
      async () => (await db.meta.get('syncCursor'))?.value as { seq: number; restart: number },
    );
    expect(cursor.seq).toBe(Math.max(...server.log.map((r) => r.server_seq!)));
  });

  it('re-reads rows younger than the settle window, so a late commit with a lower seq is not skipped', async () => {
    const { p, rtu } = await shared();
    B = makeDevice(server, 'B3', bob, { settleMs: 60_000 });
    await B.run(() => B.engine.pull());
    const cursor = await B.run(
      async () => (await db.meta.get('syncCursor'))?.value as { seq: number; restart: number },
    );
    expect(cursor.restart).toBe(0); // everything is younger than a minute: not settled yet
    // a row that got its seq earlier but became visible only now
    server.log.push({
      id: crypto.randomUUID(),
      project_id: p.id,
      table_name: 'equipment',
      record_id: rtu.id,
      op: 'set',
      field: 'data.serial',
      value: 'LATE',
      user_id: alice.id,
      device_id: 'devX',
      client_ts: Date.now(),
      base_seq: 0,
      server_seq: 1.5,
      received_at: Date.now(),
      org_id: 'a2b',
      applied: true,
    });
    await B.run(() => B.engine.pull());
    expect(await serial(B, rtu.id)).toBe('LATE');
    // once the rows are older than the window the restart point moves up
    server.now = () => Date.now() + 120_000;
    await B.run(async () => {
      await B.engine.measureClock();
      await B.engine.pull();
    });
    const after = await B.run(async () => (await db.meta.get('syncCursor'))?.value as { seq: number; restart: number });
    expect(after.restart).toBe(after.seq);
  });
});

describe('clock skew', () => {
  it('orders by server-corrected time: a phone whose clock is 10 min fast does not win a later edit', async () => {
    A = makeDevice(server, 'Afast', alice, { skewMs: 10 * 60_000 });
    const { rtu } = await shared();
    // both offline: A edits first (real time), B a second later
    await A.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-A'));
    await new Promise((r) => setTimeout(r, 20));
    await B.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-B'));
    await A.sync();
    await B.sync();
    await A.sync();
    expect(A.engine.clockOffset).toBeLessThan(-9 * 60_000);
    expect(Math.abs(B.engine.clockOffset)).toBeLessThan(1000);
    // the pushed timestamps are in server time
    const [a, b] = ['SN-A', 'SN-B'].map((v) => server.log.find((r) => r.value === v)!);
    expect(a.client_ts).toBeLessThan(b.client_ts);
    expect(server.valueOf('equipment', rtu.id, 'data.serial')).toBe('SN-B');
    expect(await serial(A, rtu.id)).toBe('SN-B');
    expect(await serial(B, rtu.id)).toBe('SN-B');
  });
});

describe('report lock across devices', () => {
  it('a lock from another device: new edits are refused locally; offline edits made before it are held, then released on unlock', async () => {
    const { p, rtu } = await shared();
    // A edits offline while B issues the report
    await A.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-A'));
    await B.run(() => lockProject(p.id, 'Prelim', null));
    await B.sync();
    const res = await A.sync();
    expect(res.held).toBe(1);
    expect(server.valueOf('equipment', rtu.id, 'data.serial')).toBeUndefined();
    await A.run(async () => {
      expect((await db.projects.get(p.id))?.lock?.label).toBe('Prelim');
      // the form's next edit is refused with the lock message (the UI shows it)
      await expect(setField('equipment', rtu.id, 'data.model', 'X')).rejects.toBeInstanceOf(LockedError);
      const [held] = await db.conflicts.where('projectId').equals(p.id).toArray();
      expect(held).toMatchObject({ kind: 'held', status: 'open', held: { count: 1, label: 'Prelim' } });
      expect(await countPending(true)).toBe(1); // still counted as not synced
      expect((await db.equipment.get(rtu.id))?.data.serial).toBe('SN-A'); // kept on the device
    });
    // B unlocks: A's held edit goes out
    await B.run(() => unlockProject(p.id));
    await B.sync();
    const after = await A.sync();
    expect(after.released).toBe(1);
    expect(server.valueOf('equipment', rtu.id, 'data.serial')).toBe('SN-A');
    await A.run(async () => {
      expect((await db.conflicts.toArray())[0]).toMatchObject({ status: 'resolved', resolution: 'released' });
      expect(await countPending(true)).toBe(0);
    });
  });

  it('the server refuses a push into a project locked meanwhile (race): the change is held, not lost', async () => {
    const { p, rtu } = await shared();
    await A.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-A'));
    await B.run(() => lockProject(p.id, 'Rev 1', null));
    await B.sync();
    // push without pulling first: the server answers TAB_LOCKED for A's change
    const res = await A.run(() => A.engine.push());
    expect(res).toEqual({ pushed: 0, held: 1 });
    await A.run(async () => expect(await db.fieldChanges.where('synced').equals(2).count()).toBe(1));
  });

  it('held changes can be discarded: the record goes back to what the server has', async () => {
    const { p, rtu } = await shared();
    await A.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-1'));
    await A.sync();
    await A.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-2'));
    const unit = await A.run(() => addAirflowRow(rtu, 'supply', { no: 'S-9' }));
    await B.sync();
    await B.run(() => lockProject(p.id, 'Prelim', null));
    await B.sync();
    await A.sync();
    const conflict = await A.run(async () => (await db.conflicts.toArray())[0]);
    expect(conflict.held?.count).toBe(2);
    expect(await A.run(() => discardHeld(conflict.id))).toBe(2);
    await A.run(async () => {
      expect((await db.equipment.get(rtu.id))?.data.serial).toBe('SN-1');
      expect(await db.airflowRows.get(unit.id)).toBeUndefined();
      expect(await countPending(true)).toBe(0);
    });
  });

  it("this device's own lock with edits before it: the edits go first, nothing is held", async () => {
    const { p, rtu } = await shared();
    await A.run(async () => {
      await setField('equipment', rtu.id, 'data.serial', 'SN-A');
      await lockProject(p.id, 'Prelim', null);
    });
    const res = await A.sync();
    expect(res.held).toBe(0);
    expect(server.valueOf('equipment', rtu.id, 'data.serial')).toBe('SN-A');
    expect((server.valueOf('projects', p.id, 'lock') as { label: string }).label).toBe('Prelim');
  });

  it('deleting a locked project reaches the other device (one change; everything cascades)', async () => {
    const { p } = await shared();
    await A.run(() => lockProject(p.id, 'Final', null));
    await A.sync();
    await A.run(() => deleteRecord('projects', p.id));
    expect(await A.run(() => pendingChanges())).toHaveLength(1);
    await A.sync();
    expect(server.record('projects', p.id)).toBeUndefined();
    await B.sync();
    await B.run(async () => {
      expect(await db.projects.count()).toBe(0);
      expect(await db.equipment.count()).toBe(0);
      expect(await db.instruments.count()).toBe(0);
    });
  });

  it('a project never synced leaves nothing to push when deleted', async () => {
    const p = await A.run(() => createProject({ name: 'Scratch' }));
    await A.run(() => deleteRecord('projects', p.id));
    await A.run(async () => expect(await countPending()).toBe(0));
  });
});

describe('review clearing (server rule)', () => {
  it('an edit made without knowing the review clears it for everyone; one made after seeing it is cleared by the device', async () => {
    const { rtu } = await shared();
    // B edits offline; A reviews and syncs (review is just a synced field here)
    await B.run(() => setField('equipment', rtu.id, 'data.model', '48FC'));
    await A.run(() => setField('equipment', rtu.id, 'review', { name: 'Kim', userId: alice.id, deviceId: 'A', at: 1 }));
    await A.sync();
    await B.sync(); // pulls the review, then pushes its older-knowledge edit: the server clears the review
    expect(server.valueOf('equipment', rtu.id, 'review')).toBeNull();
    expect(server.log.at(-1)).toMatchObject({ device_id: 'server', field: 'review' });
    await A.sync();
    await A.run(async () => expect((await db.equipment.get(rtu.id))?.review).toBeNull());
    await B.run(async () => expect((await db.equipment.get(rtu.id))?.review).toBeFalsy());
  });
});
