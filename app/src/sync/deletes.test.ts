/**
 * Deletes meeting unseen edits (sync/deletes.ts), with two simulated devices on the fake server: a unit deleted on one
 * device while the other edits it or adds rows / photos / issues to it, the reverse (deleted here, edited there), no
 * flag when the delete had seen the edits, restore with new ids, and the push never failing on a link to a deleted
 * record.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { addAirflowRow, addEquipment, addIssue, addPhoto, createProject, deleteRecord, setField } from '../data/repo';
import { makeDevice, type Device } from '../test/devices';
import { resolveConflict } from './conflicts';
import { restoreDeleted, RestoreError } from './deletes';
import { FakeSyncServer, type FakeUser } from './fakeServer';
import { countPending } from './outbox';

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

const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

/** A project with one RTU (and one supply row) made on A and pulled by B. */
async function shared() {
  const { p, rtu, row } = await A.run(async () => {
    const p = await createProject({ name: 'Riverside' });
    const rtu = await addEquipment(p.id, 'rtu', 'RTU-1');
    const row = await addAirflowRow(rtu, 'supply', { no: 'S-1' });
    return { p, rtu, row };
  });
  await A.sync();
  await B.sync();
  return { p, rtu, row };
}

const openConflicts = (d: Device) =>
  d.run(async () => (await db.conflicts.toArray()).filter((c) => c.status === 'open' && c.kind === 'deleted'));

describe('deleted on another device while edited here', () => {
  it('is flagged with the edits it removed; restore brings the unit and its rows back with new ids', async () => {
    const { rtu } = await shared();
    await A.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-A')); // offline on A
    await A.run(async () => {
      const row = await db.airflowRows.where('equipmentId').equals(rtu.id).first();
      await setField('airflowRows', row!.id, 'data.final', 410);
    });
    await B.run(() => deleteRecord('equipment', rtu.id));
    await B.sync();
    const res = await A.sync();
    expect(res.conflicts).toBe(1);
    const [c] = await openConflicts(A);
    expect(c).toMatchObject({ table: 'equipment', recordId: rtu.id, equipmentId: rtu.id });
    expect(c.deleted).toMatchObject({ by: 'other', label: 'RTU-1', edits: 2 });
    expect(c.deleted!.records.map((r) => r.table)).toEqual(['equipment', 'airflowRows']);
    expect(await A.run(() => db.equipment.get(rtu.id))).toBeUndefined();
    // B: no conflict (nothing of B's was lost)
    await B.sync();
    expect(await openConflicts(B)).toHaveLength(0);

    const out = await A.run(() => restoreDeleted(c.id));
    expect(out).toMatchObject({ restored: 2, photosSkipped: 0 });
    await A.run(async () => {
      const unit = await db.equipment.get(out.id);
      expect(unit).toMatchObject({ designation: 'RTU-1', slot: 1, review: null });
      expect(unit!.data.serial).toBe('SN-A');
      const rows = await db.airflowRows.where('equipmentId').equals(out.id).toArray();
      expect(rows.map((r) => [r.data.no, r.data.final])).toEqual([['S-1', 410]]);
      expect((await db.conflicts.get(c.id))?.resolution).toBe('restored');
    });
    await A.sync();
    await B.sync();
    expect(await B.run(async () => (await db.equipment.get(out.id))?.data.serial)).toBe('SN-A');
    expect(server.valueOf('equipment', out.id, 'data.serial')).toBe('SN-A');
  });

  it('rows, photos and issues added here to the deleted unit: removed / unlinked, the push goes through', async () => {
    const { p, rtu } = await shared();
    const added = await A.run(async () => {
      const row = await addAirflowRow(rtu, 'supply', { no: 'S-2' });
      const photo = await addPhoto(p.id, jpeg(), 'unit', rtu.id);
      const issue = await addIssue(p.id, { remark: 'Belt worn', equipmentId: rtu.id });
      return { row, photo, issue };
    });
    await B.run(() => deleteRecord('equipment', rtu.id));
    await B.sync();
    await A.sync(); // must not throw: nothing it pushes points at the deleted unit
    await A.run(async () => {
      expect(await db.airflowRows.get(added.row.id)).toBeUndefined();
      expect(await db.photos.get(added.photo.id)).toBeUndefined();
      expect((await db.issues.get(added.issue.id))?.equipmentId).toBeNull();
      expect(await countPending(true)).toBe(0);
    });
    const [c] = await openConflicts(A);
    // the unit, its row the deleting device knew (S-1), and what A added (S-2, the photo)
    expect(c.deleted!.records.map((r) => r.table)).toEqual(['equipment', 'airflowRows', 'airflowRows', 'photos']);
    expect(server.record('airflowRows', added.row.id)).toBeUndefined();
    expect(server.record('issues', added.issue.id)?.equipmentId ?? null).toBeNull();
    expect(server.log.filter((r) => r.applied === false && /deleted/.test(r.note ?? ''))).toHaveLength(0);
    await B.sync();
    await B.run(async () => {
      expect((await db.issues.get(added.issue.id))?.equipmentId ?? null).toBeNull();
      expect(await db.photos.get(added.photo.id)).toBeUndefined();
    });
    // restore: the photo comes back too (its file is on A), linked to the new unit
    const out = await A.run(() => restoreDeleted(c.id));
    expect(out.restored).toBe(4);
    await A.run(async () => {
      const photos = await db.photos.where('equipmentId').equals(out.id).toArray();
      expect(photos).toHaveLength(1);
      expect(photos[0].blob).toBeTruthy();
      expect(await db.photoUploads.get(photos[0].id)).toMatchObject({ status: 'pending' });
    });
  });

  it('an edit the deleting device had seen is not flagged', async () => {
    const { rtu } = await shared();
    await A.run(() => setField('equipment', rtu.id, 'data.serial', 'SN-A'));
    await A.sync();
    await B.sync(); // B saw the edit, then deletes
    await B.run(() => deleteRecord('equipment', rtu.id));
    await B.sync();
    const res = await A.sync();
    expect(res.conflicts).toBe(0);
    expect(await openConflicts(A)).toHaveLength(0);
  });

  it('a row deleted on its own while edited here; keeping the delete resolves it', async () => {
    const { row } = await shared();
    await A.run(() => setField('airflowRows', row.id, 'data.final', 390));
    await B.run(() => deleteRecord('airflowRows', row.id));
    await B.sync();
    await A.sync();
    const [c] = await openConflicts(A);
    expect(c).toMatchObject({ table: 'airflowRows', recordId: row.id });
    expect(c.deleted!.label).toMatch(/supply row/);
    await A.run(() => resolveConflict(c.id, 'keep'));
    expect(await openConflicts(A)).toHaveLength(0);
  });

  it('a deficiency photo added here to an issue deleted there goes with the issue', async () => {
    const { p } = await shared();
    const issue = await A.run(() => addIssue(p.id, { remark: 'Damper stuck' }));
    await A.sync();
    await B.sync();
    const photo = await A.run(() => addPhoto(p.id, jpeg(), { category: 'deficiency', issueId: issue.id }));
    await B.run(() => deleteRecord('issues', issue.id));
    await B.sync();
    await A.sync();
    expect(await A.run(() => db.photos.get(photo.id))).toBeUndefined();
    const [c] = await openConflicts(A);
    expect(c).toMatchObject({ table: 'issues', recordId: issue.id });
    expect(c.deleted!.records.map((r) => r.table)).toEqual(['issues', 'photos']);
  });
});

describe('deleted here while another device edited it', () => {
  it("the other device's synced edit is flagged here and there; restore uses the latest values", async () => {
    const { rtu } = await shared();
    await B.run(() => setField('equipment', rtu.id, 'data.model', '48FC'));
    await B.sync(); // the edit reaches the server
    await A.run(() => deleteRecord('equipment', rtu.id)); // A had not pulled it
    await A.sync(); // pulls B's edit of the unit deleted here
    const [c] = await openConflicts(A);
    expect(c.deleted).toMatchObject({ by: 'this', label: 'RTU-1', edits: 1 });
    expect(c.deleted!.records.map((r) => r.table)).toEqual(['equipment', 'airflowRows']);
    await B.sync();
    expect((await openConflicts(B))[0]?.deleted?.by).toBe('other');
    const out = await A.run(() => restoreDeleted(c.id));
    expect(await A.run(async () => (await db.equipment.get(out.id))?.data.model)).toBe('48FC');
  });

  it('edits still waiting on the other device leave its outbox when it pulls the delete (flagged there only)', async () => {
    const { rtu } = await shared();
    await B.run(() => setField('equipment', rtu.id, 'data.model', '48FC')); // offline on B
    await A.run(() => deleteRecord('equipment', rtu.id));
    await A.sync();
    await B.sync();
    expect((await openConflicts(B))[0]?.deleted?.by).toBe('other');
    await B.run(async () => expect(await countPending(true)).toBe(0));
    await A.sync();
    expect(await openConflicts(A)).toHaveLength(0);
  });

  it('an outlet row synced there into the unit deleted here: flagged on both; a restore on one settles the other', async () => {
    const { rtu } = await shared();
    await B.run(() => addAirflowRow(rtu, 'supply', { no: 'S-9' }));
    await B.sync(); // the row reaches the server
    await A.run(() => deleteRecord('equipment', rtu.id)); // A had not pulled it
    await A.sync(); // pulls the row: not created here (its unit is gone), flagged with the delete
    await A.run(async () => expect(await db.airflowRows.where('equipmentId').equals(rtu.id).count()).toBe(0));
    const [c] = await openConflicts(A);
    expect(c.deleted?.by).toBe('this');
    await B.sync(); // B's row went with the delete: flagged there too
    const [cb] = await openConflicts(B);
    expect(cb.deleted?.by).toBe('other');
    const out = await A.run(() => restoreDeleted(c.id));
    const nos = await A.run(async () =>
      (await db.airflowRows.where('equipmentId').equals(out.id).toArray()).map((r) => r.data.no).sort(),
    );
    expect(nos).toEqual(['S-1', 'S-9']);
    expect(
      await A.run(async () => (await db.equipment.get(out.id)) as unknown as Record<string, unknown>),
    ).not.toHaveProperty('restoredFrom');
    await A.sync();
    await B.sync();
    expect(await openConflicts(B)).toHaveLength(0);
    expect((await B.run(() => db.conflicts.get(cb.id)))?.resolution).toBe('superseded');
    expect(await B.run(() => db.equipment.count())).toBe(1);
  });
});

describe('restore limits', () => {
  it("an outlet row can't come back on its own when its unit is gone", async () => {
    const { rtu, row } = await shared();
    await A.run(() => setField('airflowRows', row.id, 'data.final', 390));
    await B.run(() => deleteRecord('airflowRows', row.id));
    await B.sync();
    await A.sync();
    const [c] = await openConflicts(A);
    await A.run(() => deleteRecord('equipment', rtu.id));
    await expect(A.run(() => restoreDeleted(c.id))).rejects.toBeInstanceOf(RestoreError);
  });
});
