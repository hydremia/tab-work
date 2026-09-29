/**
 * Issues and photos of one airflow line (0011): line names, the workbook's Summary remark ("RTU-1 · S-1: …") and its
 * re-import, the reports, deleting a line (they stay on the unit) and sync between devices.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { addAirflowRow, addEquipment, addIssue, addPhoto, createProject, deleteRecord } from '../data/repo';
import { FakeSyncServer } from '../sync/fakeServer';
import { makeDevice, type Device } from '../test/devices';
import { sampleBundle } from '../test/fixtures';
import { buildReportModel } from '../reports/model';
import { fromProjectData, toProjectData } from '../workbook/adapter';
import { findRow, rowNames } from './rowLabels';

describe('airflow line names', () => {
  it('the No. names the line ("S-1"); a bare number or none gets its table; valves go by tag', () => {
    const b = sampleBundle();
    const rtu = b.equipment.find((e) => e.type === 'rtu')!;
    const names = rowNames(b.equipment, b.rows);
    const supply = b.rows
      .filter((r) => r.equipmentId === rtu.id && r.table === 'supply')
      .sort((a, c) => a.order - c.order);
    expect(names.get(supply[0].id)).toMatchObject({ short: 'S-1', long: 'S-1 (Lobby)' });
    supply[0].data.no = '12';
    expect(rowNames(b.equipment, b.rows).get(supply[0].id)?.short).toBe('Supply outlets #12');
    supply[0].data.no = null;
    expect(rowNames(b.equipment, b.rows).get(supply[0].id)?.short).toBe('Supply outlets #1');
    expect(findRow(rowNames(b.equipment, b.rows), rtu.id, 'supply outlets #1')).toBe(supply[0].id);
  });
});

describe('workbook and reports', () => {
  it('the Summary remark names the line; importing it links the issue to the line again', () => {
    const b = sampleBundle();
    const rtu = b.equipment.find((e) => e.type === 'rtu')!;
    const s1 = b.rows.find((r) => r.equipmentId === rtu.id && r.data.no === 'S-1')!;
    const issue = b.issues.find((i) => i.equipmentId === rtu.id)!;
    issue.airflowRowId = s1.id;
    const { data } = toProjectData(b);
    expect(data.sections.issuesNew.tables?.issues?.[0].remark).toBe('RTU-1 · S-1: belt worn; replaced during TAB.');
    let n = 0;
    const back = fromProjectData(data, { newId: () => `id-${++n}`, now: 1 });
    const bi = back.issues.find((i) => i.number === issue.number && i.kind === issue.kind)!;
    const brtu = back.equipment.find((e) => e.designation === 'RTU-1')!;
    expect(bi).toMatchObject({ equipmentId: brtu.id, remark: 'belt worn; replaced during TAB.' });
    expect(back.rows.find((r) => r.id === bi.airflowRowId)?.data.no).toBe('S-1');
    // a line the workbook names that is not there: the text stays in the remark
    data.sections.issuesNew.tables!.issues![0].remark = 'RTU-1 · S-99: damper stuck';
    const back2 = fromProjectData(data, { newId: () => `x-${++n}`, now: 1 });
    expect(back2.issues.find((i) => i.number === issue.number)).toMatchObject({ remark: 'S-99: damper stuck' });
  });

  it('reports show the line with the unit (issues) and after the photo label', () => {
    const b = sampleBundle();
    const rtu = b.equipment.find((e) => e.type === 'rtu')!;
    const s1 = b.rows.find((r) => r.equipmentId === rtu.id && r.data.no === 'S-1')!;
    const issue = b.issues.find((i) => i.equipmentId === rtu.id)!;
    issue.airflowRowId = s1.id;
    const photo = {
      id: 'ph1',
      projectId: b.project.id,
      equipmentId: rtu.id,
      airflowRowId: s1.id,
      issueId: null,
      category: 'other' as const,
      caption: 'duct elbow at the diffuser',
      createdAt: 1,
      mimeType: 'image/jpeg',
    };
    const m = buildReportModel(
      {
        project: b.project,
        equipment: b.equipment,
        issues: b.issues,
        photos: [photo],
        typeOrder: ['rtu', 'vav'],
        typeLabel: (t) => t.toUpperCase(),
        lineNames: rowNames(b.equipment, b.rows),
      },
      { kind: 'combined', label: 'Prelim' },
    );
    const entry = m.issueSections.flatMap((s) => s.issues).find((i) => i.id === issue.id)!;
    expect(entry.equipment).toBe('RTU-1 – RTU · S-1');
    expect(m.photoGroups[0].photos[0].label).toBe('RTU-1 · Other · S-1');
  });
});

describe('deleting a line, and sync', () => {
  let server: FakeSyncServer;
  let A: Device;
  let B: Device;
  beforeEach(() => {
    server = new FakeSyncServer();
    A = makeDevice(server, 'A', server.addUser('alice@a2b.test'));
    B = makeDevice(server, 'B', server.addUser('bob@a2b.test'));
  });

  it('an issue and a photo of a line reach the other device; deleting the line leaves them on the unit', async () => {
    const { p, row, issue, photo } = await A.run(async () => {
      const p = await createProject({ name: 'Lines' });
      const e = await addEquipment(p.id, 'rtu', 'RTU-1');
      const row = await addAirflowRow(e, 'supply', { no: 'S-1' });
      const issue = await addIssue(p.id, { equipmentId: e.id, airflowRowId: row.id, remark: 'damper stuck' });
      const photo = await addPhoto(p.id, new Blob(['x'], { type: 'image/jpeg' }), {
        category: 'other',
        equipmentId: e.id,
        airflowRowId: row.id,
      });
      return { p, e, row, issue, photo };
    });
    await A.sync();
    await B.sync();
    expect((await B.run(() => db.issues.get(issue.id)))?.airflowRowId).toBe(row.id);
    expect((await B.run(() => db.photos.get(photo.id)))?.airflowRowId).toBe(row.id);
    expect(server.valueOf('issues', issue.id, 'airflowRowId')).toBe(row.id);

    await B.run(() => deleteRecord('airflowRows', row.id));
    expect((await B.run(() => db.issues.get(issue.id)))?.airflowRowId).toBeNull();
    await B.sync();
    await A.sync();
    const onA = await A.run(() => db.issues.get(issue.id));
    expect(onA).toMatchObject({ airflowRowId: null, remark: 'damper stuck' });
    expect(onA?.equipmentId).toBeTruthy();
    expect((await A.run(() => db.photos.get(photo.id)))?.airflowRowId).toBeNull();
    expect(server.valueOf('photos', photo.id, 'airflowRowId')).toBeNull();
    expect(p.id).toBeTruthy();
  });
});
