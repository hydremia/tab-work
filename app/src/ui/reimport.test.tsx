import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectData, UnitData } from '@a2b/workbook/map';
import Dexie from 'dexie';
import { describe, expect, it, vi } from 'vitest';
import { db, TabDatabase } from '../data/db';
import { createRecord, writeTables } from '../data/repo';
import { sampleBundle } from '../test/fixtures';
import { toProjectData, type ProjectBundle } from '../workbook/adapter';
import { prepareReview, type ParsedImport } from '../workbook/importProject';
import { saveRevision } from '../workbook/revisions';
import { ReimportReview } from './components/ReimportReview';

const unit = (pd: ProjectData, type: string, slot: number): UnitData =>
  pd.equipment[type].find((u) => u.slot === slot)!;

async function store(b: ProjectBundle) {
  await db.transaction('rw', writeTables(), async () => {
    await createRecord('projects', b.project);
    for (const e of b.equipment) await createRecord('equipment', e);
    for (const r of b.rows) await createRecord('airflowRows', r);
    for (const i of b.issues) await createRecord('issues', i);
    for (const i of b.instruments) await createRecord('instruments', i);
  });
}

describe('re-import review screen', () => {
  it('shows the counts, group actions never resolve collisions, Apply waits for every collision', async () => {
    const user = userEvent.setup();
    const b = sampleBundle();
    await store(b);
    const baseline = structuredClone(toProjectData(b).data);
    await saveRevision({
      id: 'rev-1',
      projectId: b.project.id,
      kind: 'export',
      label: 'Prelim',
      createdAt: Date.now(),
      fileName: 'p.xlsm',
      size: 1,
      bytes: null,
      baseline,
      userId: 'local',
    });
    const rtu = b.equipment.find((e) => e.type === 'rtu')!;
    await db.equipment.update(rtu.id, { data: { ...rtu.data, amps1: 4 } }); // changed in the app
    const wb = structuredClone(baseline);
    unit(wb, 'rtu', 1).fields!.amps1 = 3.8; // ... and in Excel: collision
    unit(wb, 'rtu', 1).fields!.volts1 = 470; // incoming
    unit(wb, 'rtu', 1).lines!.remarks = ['Belt replaced; tension checked.', 'Second remark line.'];
    const parsed: ParsedImport = {
      bundle: b,
      data: wb,
      marker: { projectId: b.project.id, revisionId: 'rev-1' },
      warnings: [],
      fileName: 'Issued.xlsm',
      bytes: new Uint8Array([1]),
    };
    const review = await prepareReview(b.project.id, parsed);
    const onApply = vi.fn(async () => ({ ops: [], warnings: [], accepted: 3, declined: 0, collisions: 1 }));
    render(
      <ReimportReview review={review} parsed={parsed} projectName="Riverside" onCancel={() => {}} onApply={onApply} />,
    );
    expect(screen.getByTestId('review-incoming')).toHaveTextContent('2incoming changes');
    expect(screen.getByTestId('review-collisions')).toHaveTextContent('1collision');
    expect(screen.getByTestId('review-added')).toHaveTextContent('0equipment added');
    const apply = screen.getByTestId('review-apply');
    expect(apply).toBeDisabled();
    await user.click(screen.getByTestId('accept-all'));
    await user.click(screen.getByTestId('accept-remarks'));
    expect(apply).toBeDisabled(); // group actions never resolve a collision
    const collision = screen.getAllByTestId('diff-item').find((el) => el.dataset.kind === 'collision')!;
    expect(within(collision).getByText('3.9')).toBeInTheDocument(); // exported
    expect(within(collision).getByText('4')).toBeInTheDocument(); // app
    expect(within(collision).getByText('3.8')).toBeInTheDocument(); // workbook
    await user.click(within(collision).getByRole('button', { name: 'Use workbook' }));
    expect(apply).toBeEnabled();
    // the unit's color after the merge is previewed
    await waitFor(() => expect(screen.getByTestId('preview-RTU-1')).toHaveAttribute('data-color'));
    await user.click(apply);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ 'unit:rtu#1|amps1': 'wb' }));
  });
});

describe('database upgrade', () => {
  it('a version 1 database opens as the current version with its data, the revision tables and the photo queue', async () => {
    const name = 'a2b-tab-upgrade-test';
    const v1 = new Dexie(name);
    v1.version(1).stores({
      projects: 'id, updatedAt',
      equipment: 'id, projectId, [projectId+type]',
      airflowRows: 'id, equipmentId, projectId',
      issues: 'id, projectId, equipmentId, [projectId+kind]',
      photos: 'id, projectId, equipmentId, [projectId+category]',
      instruments: 'id, projectId',
      fieldChanges: 'id, synced, ts, projectId, [table+recordId+field]',
      meta: 'key',
    });
    await v1.open();
    await v1.table('projects').put({ id: 'p1', name: 'Old job', updatedAt: 1 });
    await v1.table('photos').put({
      id: 'ph1',
      projectId: 'p1',
      equipmentId: null,
      issueId: null,
      category: 'other',
      caption: '',
      blob: new Blob([new Uint8Array([1])]),
      mimeType: 'image/jpeg',
      fileName: 'a.jpg',
      uploaded: 0,
      createdAt: 5,
      updatedAt: 5,
    });
    v1.close();
    const v2 = new TabDatabase(name);
    await v2.open();
    expect(v2.verno).toBe(4);
    // v3: photos get a sort order and an upload-queue entry
    expect((await v2.photos.get('ph1'))?.order).toBe(5);
    expect(await v2.photoUploads.get('ph1')).toMatchObject({ status: 'pending', projectId: 'p1' });
    expect((await v2.projects.get('p1'))?.name).toBe('Old job');
    expect(await v2.revisions.count()).toBe(0);
    expect(await v2.baseWorkbooks.count()).toBe(0);
    expect((await v2.meta.get('schemaUpgradedTo2'))?.value).toEqual(expect.any(Number));
    v2.close();
    await Dexie.delete(name);
  });
});
