/**
 * Phase 6 reporting workflow at the repository level: review sign-off and its automatic clear, the report lock
 * (writes refused by the repository, not only the UI), unlock, the change history (previous values, events, remote
 * changes), the v4 upgrade and the prune policy.
 */
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { applyRemoteChanges, pendingChanges } from '../sync/outbox';
import { saveRevision, newRevisionBase } from '../workbook/revisions';
import { TabDatabase, db } from './db';
import { HISTORY_MAX_PER_PROJECT, projectHistory, pruneHistory } from './history';
import { projectStatus } from './hooks';
import { setUserName } from './identity';
import {
  addAirflowRow,
  addEquipment,
  addIssue,
  addPhoto,
  applyScheduleImport,
  clearReview,
  createProject,
  deleteRecord,
  LockedError,
  lockProject,
  markReviewed,
  NotCompleteError,
  setField,
  unlockProject,
} from './repo';
import type { HistoryEntry } from './types';

/** A project with one RTU that is complete (green) because the whole unit is marked N/A. */
async function greenUnit() {
  const p = await createProject({ name: 'Job' });
  const rtu = await addEquipment(p.id, 'rtu', 'RTU-1');
  await setField('equipment', rtu.id, 'naState.equipment', { notation: 'N/A' });
  return { p, rtu };
}

const history = async (projectId: string) => (await projectHistory(projectId)).reverse(); // oldest first

describe('review sign-off', () => {
  it('only a green unit can be reviewed; the review is a synced field with name, user, device and time', async () => {
    const p = await createProject({ name: 'Job' });
    const rtu = await addEquipment(p.id, 'rtu', 'RTU-1');
    await expect(markReviewed(rtu.id, 'Dana')).rejects.toBeInstanceOf(NotCompleteError);
    await setField('equipment', rtu.id, 'naState.equipment', { notation: 'N/A' });
    await markReviewed(rtu.id, 'Dana');
    const review = (await db.equipment.get(rtu.id))?.review;
    expect(review).toMatchObject({ name: 'Dana', userId: 'local', at: expect.any(Number) });
    expect(review?.deviceId).toMatch(/[0-9a-f-]{36}/);
    const out = (await pendingChanges()).find((c) => c.field === 'review');
    expect(out).toMatchObject({ table: 'equipment', recordId: rtu.id, op: 'set', previous: null });
    expect((await db.meta.get('userName'))?.value).toBe('Dana'); // remembered for the next review
    const h = (await history(p.id)).at(-1)!;
    expect(h).toMatchObject({ kind: 'review', equipmentId: rtu.id, userName: 'Dana' });
  });

  it('shows blue in the status and rollups: "1/2 complete, 1 reviewed"', async () => {
    const { p, rtu } = await greenUnit();
    const other = await addEquipment(p.id, 'rtu', 'RTU-2');
    await markReviewed(rtu.id, 'Dana');
    const s = projectStatus({
      project: (await db.projects.get(p.id))!,
      equipment: await db.equipment.toArray(),
      rows: [],
      photos: [],
      issues: [],
    });
    expect(s.display.get(rtu.id)).toBe('blue');
    expect(s.display.get(other.id)).toBe('gray');
    expect(s.byEquipment.get(rtu.id)?.color).toBe('green'); // the engine itself stays green
    expect(s.byType.get('rtu')).toMatchObject({ total: 2, green: 1, reviewed: 1 });
  });

  it('any later change of the unit clears the review automatically (field, row, photo), noted in the history', async () => {
    const { p, rtu } = await greenUnit();
    await markReviewed(rtu.id, 'Dana');
    await setField('equipment', rtu.id, 'data.areaServed', 'Lobby');
    expect((await db.equipment.get(rtu.id))?.review).toBeNull();
    const hs = await history(p.id);
    const cleared = hs.at(-1)!;
    expect(cleared).toMatchObject({ kind: 'review-cleared', source: 'auto', equipmentId: rtu.id });
    expect(cleared.previous).toMatchObject({ name: 'Dana' });
    expect(hs.at(-2)).toMatchObject({ kind: 'edit', field: 'data.areaServed', previous: null, value: 'Lobby' });
    // the clear syncs like any edit
    expect((await pendingChanges()).find((c) => c.field === 'review')?.value).toBeNull();

    await markReviewed(rtu.id);
    await addAirflowRow(rtu, 'supply');
    expect((await db.equipment.get(rtu.id))?.review).toBeNull();

    await markReviewed(rtu.id);
    await addPhoto(p.id, new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), 'unit', rtu.id);
    expect((await db.equipment.get(rtu.id))?.review).toBeNull();
  });

  it('an issue edit, clearing by hand and remote changes behave as expected', async () => {
    const { p, rtu } = await greenUnit();
    await markReviewed(rtu.id, 'Dana');
    const issue = await addIssue(p.id, { equipmentId: rtu.id });
    // an issue does not change the unit's data: the review stays, but the unit shows red (not blue) while it is open
    expect((await db.equipment.get(rtu.id))?.review).toBeTruthy();
    await setField('issues', issue.id, 'status', 'Closed');
    expect((await db.equipment.get(rtu.id))?.review).toBeTruthy();
    // another device's edit: its device clears the review itself and syncs that, so applying it here doesn't
    await applyRemoteChanges([
      {
        id: 'remote-1',
        projectId: p.id,
        table: 'equipment',
        recordId: rtu.id,
        op: 'set',
        field: 'data.serial',
        value: 'SN-9',
        userId: 'u2',
        deviceId: 'other-device',
        ts: Date.now() + 1000,
      },
    ]);
    expect((await db.equipment.get(rtu.id))?.review).toBeTruthy();
    const remote = (await history(p.id)).find((h) => h.source === 'remote')!;
    expect(remote).toMatchObject({ field: 'data.serial', previous: null, value: 'SN-9', deviceId: 'other-device' });
    await clearReview(rtu.id);
    const last = (await history(p.id)).filter((h) => h.field === 'review').at(-1)!; // (the remote entry is in the future)
    expect(last).toMatchObject({ kind: 'review-cleared' });
    expect(last.source).toBeUndefined();
  });
});

describe('report lock', () => {
  it('refuses every write to a locked project at the repository level, and writes nothing', async () => {
    const { p, rtu } = await greenUnit();
    const row = await addAirflowRow(rtu, 'supply');
    const issue = await addIssue(p.id);
    await setUserName('Sam');
    await lockProject(p.id, 'Prelim', 'rev-1');
    expect((await db.projects.get(p.id))?.lock).toMatchObject({ label: 'Prelim', revisionId: 'rev-1', name: 'Sam' });
    const changes = await db.fieldChanges.count();
    const hist = await db.history.count();
    const refused = [
      setField('equipment', rtu.id, 'data.serial', 'X'),
      setField('projects', p.id, 'info.architect', 'X'),
      setField('projects', p.id, 'name', 'Other'),
      setField('airflowRows', row.id, 'data.finalVel', 400),
      setField('issues', issue.id, 'remark', 'X'),
      addEquipment(p.id, 'rtu', 'RTU-2'),
      addAirflowRow(rtu, 'supply'),
      addIssue(p.id),
      addPhoto(p.id, new Blob([new Uint8Array([1])]), 'other'),
      deleteRecord('equipment', rtu.id),
      deleteRecord('issues', issue.id),
      markReviewed(rtu.id),
      applyScheduleImport(p.id, 'rtu', [
        { action: 'update', designation: 'RTU-1', values: { model: 'X' }, existingId: rtu.id },
      ]),
    ];
    for (const r of await Promise.allSettled(refused)) {
      expect(r.status).toBe('rejected');
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(LockedError);
    }
    expect(await db.fieldChanges.count()).toBe(changes);
    expect(await db.history.count()).toBe(hist);
    expect((await db.equipment.get(rtu.id))?.data.serial).toBeUndefined();
    expect(await db.equipment.count()).toBe(1);
  });

  it('unlock for follow-up: edits work again; lock and unlock are recorded (who / when / label)', async () => {
    const { p, rtu } = await greenUnit();
    await lockProject(p.id, 'Prelim', null);
    await expect(setField('equipment', rtu.id, 'data.serial', 'X')).rejects.toThrow(/issued as Prelim; unlock/);
    await unlockProject(p.id);
    expect((await db.projects.get(p.id))?.lock).toBeNull();
    await setField('equipment', rtu.id, 'data.serial', 'X');
    expect((await db.equipment.get(rtu.id))?.data.serial).toBe('X');
    const events = (await history(p.id)).filter((h) => h.kind === 'lock' || h.kind === 'unlock');
    expect(events.map((h) => h.kind)).toEqual(['lock', 'unlock']);
    expect(events[1].previous).toMatchObject({ label: 'Prelim' });
    // the lock syncs as a project field
    expect((await pendingChanges()).filter((c) => c.field === 'lock').map((c) => c.table)).toEqual(['projects']);
  });

  it('a lock from another device is applied (and recorded); a locked project can still be deleted', async () => {
    const p = await createProject({ name: 'Job' });
    await applyRemoteChanges([
      {
        id: 'remote-lock',
        projectId: p.id,
        table: 'projects',
        recordId: p.id,
        op: 'set',
        field: 'lock',
        value: { label: 'Rev 1', revisionId: null, name: 'Kim', userId: 'u2', deviceId: 'd2', at: 1 },
        userId: 'u2',
        deviceId: 'd2',
        ts: Date.now() + 1000,
      },
    ]);
    await expect(addIssue(p.id)).rejects.toBeInstanceOf(LockedError);
    expect((await history(p.id)).at(-1)).toMatchObject({ kind: 'lock', source: 'remote' });
    await deleteRecord('projects', p.id);
    expect(await db.projects.count()).toBe(0);
    expect(await db.history.where('projectId').equals(p.id).count()).toBe(0);
  });
});

describe('change history', () => {
  it('keeps every step with its previous value, while the outbox coalesces them', async () => {
    const p = await createProject({ name: 'Job' });
    await setField('projects', p.id, 'info.technicians', 'J');
    await setField('projects', p.id, 'info.technicians', 'J. A');
    await setField('projects', p.id, 'info.technicians', 'J. Alvarez');
    const out = (await pendingChanges()).filter((c) => c.field === 'info.technicians');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ previous: null, value: 'J. Alvarez' });
    const steps = (await history(p.id)).filter((h) => h.field === 'info.technicians');
    expect(steps.map((h) => [h.previous, h.value])).toEqual([
      [null, 'J'],
      ['J', 'J. A'],
      ['J. A', 'J. Alvarez'],
    ]);
  });

  it('records creates / deletes with a note, the unit of rows / photos, and export / import events', async () => {
    const p = await createProject({ name: 'Job' });
    const rtu = await addEquipment(p.id, 'rtu', 'RTU-7');
    const row = await addAirflowRow(rtu, 'supply', { no: 'S-1' });
    await deleteRecord('airflowRows', row.id);
    await saveRevision({
      ...newRevisionBase(p.id),
      id: 'r1',
      kind: 'export',
      label: 'Prelim',
      fileName: 'Job - TAB Report Prelim.xlsm',
      size: 1,
      bytes: null,
      baseline: null,
      issued: true,
    });
    const hs = await history(p.id);
    expect(hs.find((h) => h.kind === 'create' && h.table === 'equipment')).toMatchObject({
      note: 'RTU-7',
      equipmentId: rtu.id,
    });
    expect(hs.filter((h) => h.table === 'airflowRows').map((h) => [h.kind, h.equipmentId, h.note])).toEqual([
      ['create', rtu.id, 'supply row S-1'],
      ['delete', rtu.id, 'supply row S-1'],
    ]);
    expect(hs.at(-1)).toMatchObject({ kind: 'revision', note: 'Issued Prelim (Job - TAB Report Prelim.xlsm)' });
  });

  it('schedule imports are marked as such', async () => {
    const p = await createProject({ name: 'Job' });
    await applyScheduleImport(p.id, 'rtu', [{ action: 'create', designation: 'RTU-1', values: { model: 'X' } }]);
    expect((await history(p.id)).find((h) => h.field === 'data.model')).toMatchObject({ source: 'schedule' });
  });

  it('prune: drops entries older than 12 months and keeps the newest N per project', async () => {
    const p = await createProject({ name: 'Job' });
    const now = Date.UTC(2026, 8, 24);
    const entry = (i: number, ts: number): HistoryEntry => ({
      id: `h${i}`,
      projectId: 'px',
      ts,
      kind: 'edit',
      table: 'projects',
      recordId: 'px',
      equipmentId: null,
      field: 'name',
      value: i,
      userId: 'local',
      deviceId: 'd',
    });
    await db.history.bulkAdd([
      entry(0, now - 400 * 86400_000),
      ...Array.from({ length: HISTORY_MAX_PER_PROJECT + 10 }, (_, i) => entry(i + 1, now - 1000 + i / 100)),
    ]);
    const before = await db.history.where('projectId').equals(p.id).count();
    const removed = await pruneHistory(now);
    expect(removed).toBe(11);
    expect(await db.history.where('projectId').equals('px').count()).toBe(HISTORY_MAX_PER_PROJECT);
    expect(await db.history.get('h0')).toBeUndefined();
    expect(await db.history.get('h10')).toBeUndefined();
    expect(await db.history.get('h11')).toBeDefined();
    expect(await db.history.where('projectId').equals(p.id).count()).toBe(before); // other projects untouched
  });
});

describe('database upgrade to v4', () => {
  it('backfills the history from the outbox (no previous values: shown as —)', async () => {
    const name = `v3-${Math.random()}`;
    const v3 = new Dexie(name);
    v3.version(3).stores({
      projects: 'id, updatedAt',
      equipment: 'id, projectId, [projectId+type]',
      airflowRows: 'id, equipmentId, projectId',
      issues: 'id, projectId, equipmentId, [projectId+kind]',
      photos: 'id, projectId, equipmentId, issueId, [projectId+category]',
      instruments: 'id, projectId',
      fieldChanges: 'id, synced, ts, projectId, [table+recordId+field]',
      meta: 'key',
      revisions: 'id, projectId, [projectId+createdAt]',
      baseWorkbooks: 'projectId',
      photoUploads: 'photoId, projectId, status',
    });
    await v3.open();
    await v3.table('airflowRows').put({ id: 'row1', projectId: 'p1', equipmentId: 'e1', table: 'supply', data: {} });
    const base = { projectId: 'p1', userId: 'local', deviceId: 'dev', synced: 1 };
    await v3.table('fieldChanges').bulkPut([
      {
        ...base,
        id: 'c1',
        table: 'equipment',
        recordId: 'e1',
        op: 'create',
        field: '',
        value: { id: 'e1', designation: 'RTU-1' },
        ts: 1,
      },
      { ...base, id: 'c2', table: 'equipment', recordId: 'e1', op: 'set', field: 'data.serial', value: 'SN', ts: 2 },
      {
        ...base,
        id: 'c3',
        table: 'airflowRows',
        recordId: 'row1',
        op: 'set',
        field: 'data.finalVel',
        value: 400,
        ts: 3,
      },
    ]);
    v3.close();
    const v4 = new TabDatabase(name);
    await v4.open();
    expect(v4.verno).toBe(4);
    const hs = (await v4.history.toArray()).sort((a, b) => a.ts - b.ts);
    expect(hs.map((h) => [h.kind, h.equipmentId, h.note ?? null])).toEqual([
      ['create', 'e1', 'RTU-1'],
      ['edit', 'e1', null],
      ['edit', 'e1', null],
    ]);
    expect(hs[1]).toMatchObject({ field: 'data.serial', value: 'SN' });
    expect('previous' in hs[1]).toBe(false);
    expect(await v4.fieldChanges.count()).toBe(3); // the outbox itself is unchanged
    v4.close();
    await Dexie.delete(name);
  });
});
