/**
 * Plan sheets across devices: the record syncs through the change log (devices and systems as fields), the drawing
 * file through the plans bucket after the record is pushed; the other device gets the record first and the file on a
 * later sync; a delete removes the file; a project delete takes the sheets with it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { addPlanSystem, deletePlanSheet, savePlanSheet } from '../data/planRepo';
import { addEquipment, createProject, deleteRecord } from '../data/repo';
import type { PlanSheetDevice } from '../data/types';
import { makeDevice, type Device } from '../test/devices';
import { planPath } from './backend';
import { FakeSyncServer } from './fakeServer';
import { processPlanQueue } from './planSync';

let server: FakeSyncServer;
let A: Device;
let B: Device;

beforeEach(() => {
  server = new FakeSyncServer();
  A = makeDevice(server, 'A', server.addUser('alice@a2b.test'));
  B = makeDevice(server, 'B', server.addUser('bob@a2b.test'));
});

const dev = (key: string, x: number, y: number): PlanSheetDevice => ({
  key,
  tag: { x, y, box: { x0: x - 5, y0: y - 5, x1: x + 5, y1: y + 5 }, lines: ['12"x8"', 'SR1', '290 CFM'] },
  type: 'SR1',
  size: '12"x8"',
  cfm: 290,
  x,
  y,
  how: 'leader',
  count: 1,
  index: 0,
});
const pdf = () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

async function withSheet() {
  return A.run(async () => {
    const p = await createProject({ name: 'Plans' });
    const rtu = await addEquipment(p.id, 'rtu', 'WSHP-3');
    const sheet = await savePlanSheet({
      projectId: p.id,
      fileName: 'M101.pdf',
      pdf: pdf(),
      page: 1,
      pageCount: 1,
      width: 2592,
      height: 1728,
      ocr: false,
      devices: [dev('d0-0', 100, 100), dev('d1-0', 200, 100)],
    });
    return { p, rtu, sheet };
  });
}

describe('plan sheets across devices', () => {
  it('the record syncs, the file follows after the push, the other device downloads it', async () => {
    const { p, sheet } = await withSheet();
    expect(await A.run(() => processPlanQueue(A.backend))).toMatchObject({ uploaded: 0 }); // project not pushed yet
    await A.sync();
    expect(server.files.get(planPath(p.id, sheet.id))).toMatchObject({ contentType: 'application/pdf' });
    await A.run(async () => {
      expect((await db.planUploads.get(sheet.id))?.status).toBe('done');
      expect((await db.planSheets.get(sheet.id))?.storagePath).toBe(planPath(p.id, sheet.id));
    });
    // the storagePath set was logged after the push: another sync carries it
    await A.sync();
    await B.sync();
    await B.run(async () => {
      const got = await db.planSheets.get(sheet.id);
      expect(got?.fileName).toBe('M101.pdf');
      expect(got?.devices).toHaveLength(2);
      expect(got?.pdf).toBeTruthy();
      expect(got?.storagePath).toBe(planPath(p.id, sheet.id));
      expect(await db.planUploads.count()).toBe(0);
    });
  });

  it('a system lassoed on one device shows on the other; a deleted sheet takes its file away', async () => {
    const { p, rtu, sheet } = await withSheet();
    await A.sync();
    await A.sync();
    await B.sync();
    await B.run(() =>
      addPlanSystem(sheet.id, {
        equipmentId: rtu.id,
        table: 'supply',
        polygon: [
          [0, 0],
          [300, 0],
          [300, 300],
          [0, 300],
        ],
        deviceKeys: ['d0-0', 'd1-0'],
        color: '#ff809d',
        prefix: '3',
      }),
    );
    await B.sync();
    await A.sync();
    await A.run(async () => expect((await db.planSheets.get(sheet.id))?.systems.map((s) => s.prefix)).toEqual(['3']));
    await A.run(() => deletePlanSheet(sheet.id));
    await A.sync();
    expect(server.files.has(planPath(p.id, sheet.id))).toBe(false);
    await B.sync();
    await B.run(async () => expect(await db.planSheets.get(sheet.id)).toBeUndefined());
  });

  it('a project delete on one device removes the sheets on the other', async () => {
    const { p, sheet } = await withSheet();
    await A.sync();
    await B.sync();
    await B.run(async () => expect(await db.planSheets.get(sheet.id)).toBeTruthy());
    await A.run(() => deleteRecord('projects', p.id));
    await A.sync();
    await B.sync();
    await B.run(async () => {
      expect(await db.planSheets.get(sheet.id)).toBeUndefined();
      expect(await db.planUploads.count()).toBe(0);
    });
  });
});
