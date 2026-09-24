import { describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { getDeviceId } from '../data/identity';
import { createProject, setField } from '../data/repo';
import { LocalSyncEngine } from './engine';
import { applyRemoteChanges, countPending, pendingChanges, type RemoteChange } from './outbox';

const remote = (over: Partial<RemoteChange>): RemoteChange => ({
  id: crypto.randomUUID(),
  projectId: 'p',
  table: 'projects',
  recordId: 'p',
  op: 'set',
  field: 'info.architect',
  value: 'Remote Arch',
  userId: 'u2',
  deviceId: 'other-device',
  ts: Date.now(),
  ...over,
});

describe('LocalSyncEngine', () => {
  it('is a no-op and leaves the outbox untouched', async () => {
    await createProject({ name: 'Job' });
    const n = await countPending();
    const e = new LocalSyncEngine();
    expect(e.mode).toBe('local');
    expect(await e.push()).toEqual({ pushed: 0 });
    expect(await e.pull()).toEqual({ applied: 0, conflicts: 0 });
    expect(await countPending()).toBe(n);
  });
});

describe('applyRemoteChanges (last writer wins per field)', () => {
  it('applies a newer remote edit and flags the older local edit as a conflict', async () => {
    const p = await createProject({ name: 'Job' });
    await setField('projects', p.id, 'info.architect', 'Local Arch');
    const local = (await pendingChanges()).find((c) => c.field === 'info.architect')!;
    const res = await applyRemoteChanges([remote({ projectId: p.id, recordId: p.id, ts: local.ts + 1000 })]);
    expect(res).toEqual({ applied: 1, skipped: 0, conflicts: 1 });
    expect((await db.projects.get(p.id))?.info.architect).toBe('Remote Arch');
    expect((await db.fieldChanges.get(local.id))?.conflict).toBe(1);
    // remote changes are logged as already synced, never re-pushed
    expect((await pendingChanges()).some((c) => c.deviceId === 'other-device')).toBe(false);
  });

  it('ignores an older remote edit when a newer local edit of the same field exists', async () => {
    const p = await createProject({ name: 'Job' });
    await setField('projects', p.id, 'info.architect', 'Local Arch');
    const local = (await pendingChanges()).find((c) => c.field === 'info.architect')!;
    const res = await applyRemoteChanges([remote({ projectId: p.id, recordId: p.id, ts: local.ts - 1000 })]);
    expect(res.applied).toBe(0);
    expect(res.skipped).toBe(1);
    expect((await db.projects.get(p.id))?.info.architect).toBe('Local Arch');
  });

  it('merges edits to different fields without conflict, is idempotent, and skips own-device changes', async () => {
    const p = await createProject({ name: 'Job' });
    await setField('projects', p.id, 'info.architect', 'Local Arch');
    const c = remote({ projectId: p.id, recordId: p.id, field: 'info.projectManager', value: 'R. Singh' });
    expect((await applyRemoteChanges([c])).applied).toBe(1);
    expect((await applyRemoteChanges([c])).applied).toBe(0); // already seen
    const own = remote({ projectId: p.id, recordId: p.id, deviceId: await getDeviceId(), field: 'name', value: 'X' });
    await applyRemoteChanges([own]);
    const rec = await db.projects.get(p.id);
    expect(rec?.info).toMatchObject({ architect: 'Local Arch', projectManager: 'R. Singh' });
    expect(rec?.name).toBe('Job');
  });

  it('applies remote creates and deletes', async () => {
    const p = await createProject({ name: 'Job' });
    const eq = {
      id: 'e1',
      projectId: p.id,
      type: 'rtu',
      designation: 'RTU-9',
      slot: 9,
      isExisting: false,
      data: {},
      naState: { sections: {}, fields: {} },
      createdAt: 1,
      updatedAt: 1,
    };
    await applyRemoteChanges([
      remote({ table: 'equipment', recordId: 'e1', op: 'create', field: '', value: eq, ts: 1 }),
    ]);
    expect((await db.equipment.get('e1'))?.designation).toBe('RTU-9');
    await applyRemoteChanges([
      remote({ table: 'equipment', recordId: 'e1', op: 'delete', field: '', value: null, ts: 2 }),
    ]);
    expect(await db.equipment.get('e1')).toBeUndefined();
  });
});
