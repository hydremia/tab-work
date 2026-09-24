import { describe, expect, it } from 'vitest';
import { db } from './db';
import { addAirflowRow, addEquipment, addIssue, CapacityError, createProject, deleteRecord, setField } from './repo';
import { countPending, markSynced, pendingChanges } from '../sync/outbox';

describe('setField + outbox', () => {
  it('updates the record and appends a field change in one transaction', async () => {
    const p = await createProject({ name: 'Job', address: '1 Main' });
    const before = await countPending();
    await setField('projects', p.id, 'info.architect', 'Lionakis');
    expect((await db.projects.get(p.id))?.info.architect).toBe('Lionakis');
    const changes = (await pendingChanges()).filter((c) => c.field === 'info.architect');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      table: 'projects',
      recordId: p.id,
      op: 'set',
      value: 'Lionakis',
      synced: 0,
      userId: 'local',
      projectId: p.id,
    });
    expect(changes[0].deviceId).toMatch(/[0-9a-f-]{36}/);
    expect(await countPending()).toBe(before + 1);
  });

  it('coalesces consecutive unsynced edits of the same field, and ignores unchanged values', async () => {
    const p = await createProject({ name: 'Job' });
    await setField('projects', p.id, 'info.technicians', 'J');
    await setField('projects', p.id, 'info.technicians', 'J. A');
    await setField('projects', p.id, 'info.technicians', 'J. A'); // no-op
    const c = (await pendingChanges()).filter((x) => x.field === 'info.technicians');
    expect(c).toHaveLength(1);
    expect(c[0].value).toBe('J. A');
  });

  it('starts a new outbox entry once the previous one was pushed', async () => {
    const p = await createProject({ name: 'Job' });
    await setField('projects', p.id, 'name', 'Job 2');
    await markSynced((await pendingChanges()).map((c) => c.id));
    expect(await countPending()).toBe(0);
    await setField('projects', p.id, 'name', 'Job 3');
    const all = await db.fieldChanges.where('[table+recordId+field]').equals(['projects', p.id, 'name']).toArray();
    expect(all.map((c) => [c.value, c.synced])).toEqual(
      expect.arrayContaining([
        ['Job 2', 1],
        ['Job 3', 0],
      ]),
    );
  });

  it('rolls back: a missing record or a forbidden path writes nothing', async () => {
    const p = await createProject({ name: 'Job' });
    const before = await db.fieldChanges.count();
    await expect(setField('equipment', 'nope', 'data.serial', 'x')).rejects.toThrow(/not found/);
    await expect(setField('projects', p.id, 'id', 'x')).rejects.toThrow(/cannot be edited/);
    await expect(setField('projects', p.id, '__proto__.polluted', 'x')).rejects.toThrow();
    expect(await db.fieldChanges.count()).toBe(before);
  });

  it('sets nested paths (arrays, N/A marks) and clears with null', async () => {
    const p = await createProject({ name: 'Job' });
    await setField('projects', p.id, 'blueprints.1.sheet', 'M-201');
    await setField('projects', p.id, 'naState.fields.architect', { notation: 'N/A' });
    let rec = await db.projects.get(p.id);
    expect(rec?.blueprints[1]).toEqual({ sheet: 'M-201' });
    expect(rec?.naState.fields.architect).toEqual({ notation: 'N/A' });
    await setField('projects', p.id, 'naState.fields.architect', null);
    rec = await db.projects.get(p.id);
    expect(rec?.naState.fields.architect).toBeNull();
  });
});

describe('records', () => {
  it('createProject pre-loads the 7 template instruments and logs creates', async () => {
    const p = await createProject({ name: 'Job', scopeProfile: 'airflow', tabDate: '2026-09-15' });
    expect(p.scopeProfile).toBe('airflow');
    expect(await db.instruments.where('projectId').equals(p.id).count()).toBe(7);
    const creates = (await pendingChanges()).filter((c) => c.op === 'create');
    expect(creates.map((c) => c.table)).toEqual(['projects', ...Array(7).fill('instruments')]);
  });

  it('addEquipment takes the lowest free slot and enforces the template capacity', async () => {
    const p = await createProject({ name: 'Job' });
    const a = await addEquipment(p.id, 'hood', 'H-1');
    const b = await addEquipment(p.id, 'hood', 'H-2');
    expect([a.slot, b.slot]).toEqual([1, 2]);
    expect(a.data.unitType).toBeUndefined();
    const rtu = await addEquipment(p.id, 'rtu', 'RTU-1', true);
    expect(rtu).toMatchObject({ slot: 1, isExisting: true, data: { unitType: 'RTU' } });
    await deleteRecord('equipment', a.id);
    expect((await addEquipment(p.id, 'hood', 'H-3')).slot).toBe(1);
    for (let i = 0; i < 18; i++) await addEquipment(p.id, 'hood', `H-x${i}`);
    await expect(addEquipment(p.id, 'hood', 'H-21')).rejects.toBeInstanceOf(CapacityError);
  });

  it('airflow rows respect the table capacity (RTU OA table has 1 row)', async () => {
    const p = await createProject({ name: 'Job' });
    const rtu = await addEquipment(p.id, 'rtu', 'RTU-1');
    const r1 = await addAirflowRow(rtu, 'supply', { no: 'S-1' });
    const r2 = await addAirflowRow(rtu, 'supply');
    expect([r1.order, r2.order]).toEqual([1, 2]);
    await addAirflowRow(rtu, 'oa');
    await expect(addAirflowRow(rtu, 'oa')).rejects.toBeInstanceOf(CapacityError);
  });

  it('issues are numbered separately for New and Existing', async () => {
    const p = await createProject({ name: 'Job' });
    const n1 = await addIssue(p.id, { kind: 'new' });
    const n2 = await addIssue(p.id, { kind: 'new' });
    const e1 = await addIssue(p.id, { kind: 'existing' });
    expect([n1.number, n2.number, e1.number]).toEqual([1, 2, 1]);
  });

  it('deleting equipment deletes its rows and unlinks its issues (logged)', async () => {
    const p = await createProject({ name: 'Job' });
    const rtu = await addEquipment(p.id, 'rtu', 'RTU-1');
    await addAirflowRow(rtu, 'supply');
    const issue = await addIssue(p.id, { equipmentId: rtu.id });
    await deleteRecord('equipment', rtu.id);
    expect(await db.airflowRows.count()).toBe(0);
    expect((await db.issues.get(issue.id))?.equipmentId).toBeNull();
    const deletes = (await pendingChanges()).filter((c) => c.op === 'delete').map((c) => c.table);
    expect(deletes).toEqual(['airflowRows', 'equipment']);
  });

  it('deleting a project deletes everything in it', async () => {
    const p = await createProject({ name: 'Job' });
    const rtu = await addEquipment(p.id, 'rtu', 'RTU-1');
    await addAirflowRow(rtu, 'supply');
    await addIssue(p.id);
    await deleteRecord('projects', p.id);
    for (const t of [db.projects, db.equipment, db.airflowRows, db.issues, db.instruments])
      expect(await t.count()).toBe(0);
  });
});
