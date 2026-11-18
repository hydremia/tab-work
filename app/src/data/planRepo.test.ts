import { describe, expect, it } from 'vitest';
import { db } from './db';
import {
  addPlanSystem,
  applyPlanSystem,
  importMarkupSystems,
  removePlanSystem,
  savePlanSheet,
  updatePlanDevice,
} from './planRepo';
import type { ParsedLabel } from '../domain/markupImport';
import { fromMarkup } from '../domain/planSystems';
import { addEquipment, createProject, setField } from './repo';
import type { PlanSheetDevice } from './types';
import { pendingChanges } from '../sync/outbox';

const dev = (
  key: string,
  x: number,
  y: number,
  type: string,
  size: string | null,
  cfm: number | null,
): PlanSheetDevice => ({
  key,
  tag: { x, y, box: { x0: x - 5, y0: y - 5, x1: x + 5, y1: y + 5 }, lines: [size ?? '', type, `${cfm} CFM`] },
  type,
  size,
  cfm,
  x,
  y,
  how: 'leader',
  count: 1,
  index: 0,
});

describe('plan sheets → airflow rows', () => {
  it('writes a system’s devices as rows in letter order (source plan), updates them on a second apply, and never syncs the sheet', async () => {
    const p = await createProject({ name: 'Plan job' });
    const rtu = await addEquipment(p.id, 'rtu', 'RTU-1');
    await setField('equipment', rtu.id, 'data.areaServed', 'Sales');
    const sheet = await savePlanSheet({
      projectId: p.id,
      fileName: 'M-100.pdf',
      pdf: new Uint8Array([37, 80, 68, 70]),
      page: 1,
      pageCount: 1,
      width: 2592,
      height: 1728,
      ocr: false,
      devices: [
        dev('d0-0', 100, 100, 'S1', '12"Ø', 565),
        dev('d1-0', 300, 120, 'S4', '14"Ø', 525),
        dev('d2-0', 200, 300, 'S1', '10"Ø', 400),
      ],
    });
    const before = (await pendingChanges()).length;
    const sys = await addPlanSystem(sheet.id, {
      equipmentId: rtu.id,
      table: 'supply',
      polygon: [
        [0, 0],
        [400, 0],
        [400, 400],
        [0, 400],
      ],
      deviceKeys: ['d0-0', 'd1-0', 'd2-0'],
      color: '#ff809d',
      prefix: '1',
    });
    const r = await applyPlanSystem(sheet.id, sys.id);
    expect(r).toMatchObject({ created: 3, updated: 0 });
    expect(r.rows.map((x) => [x.no, x.area, x.type, x.size, x.designCfm])).toEqual([
      ['A', 'Sales', 'S1', '12"R', 565],
      ['B', 'Sales', 'S4', '14"R', 525],
      ['C', 'Sales', 'S1', '10"R', 400],
    ]);
    const rows = (await db.airflowRows.where('equipmentId').equals(rtu.id).toArray())
      .filter((x) => x.table === 'supply')
      .sort((a, b) => a.order - b.order);
    expect(rows.map((x) => x.data)).toEqual([
      { no: 'A', area: 'Sales', type: 'S1', size: '12"R', designCfm: 565 },
      { no: 'B', area: 'Sales', type: 'S4', size: '14"R', designCfm: 525 },
      { no: 'C', area: 'Sales', type: 'S1', size: '10"R', designCfm: 400 },
    ]);
    // the rows sync (one change per row creation); the sheet syncs too, its create without the drawing file
    const changes = (await pendingChanges()).slice(before);
    expect(changes.filter((c) => c.table === 'airflowRows')).toHaveLength(3);
    const sheetChanges = (await pendingChanges()).filter((c) => c.table === 'planSheets');
    expect(sheetChanges.map((c) => [c.op, c.field])).toEqual([
      ['create', ''],
      ['set', 'systems'],
    ]);
    expect((sheetChanges[0].value as Record<string, unknown>).pdf).toBeUndefined();
    expect((sheetChanges[0].value as Record<string, unknown>).fileName).toBe('M-100.pdf');
    expect((await db.planUploads.get(sheet.id))?.status).toBe('pending');
    const saved = (await db.planSheets.get(sheet.id))!;
    expect(Object.keys(saved.systems[0].rowIds)).toEqual(['d0-0', 'd1-0', 'd2-0']);

    // a corrected device (text recognition slip) and a second apply: the rows follow, no duplicates
    await updatePlanDevice(sheet.id, 'd1-0', { cfm: 560 });
    const again = await applyPlanSystem(sheet.id, sys.id);
    expect(again).toMatchObject({ created: 0, updated: 3 });
    const after = (await db.airflowRows.where('equipmentId').equals(rtu.id).toArray()).filter(
      (x) => x.table === 'supply',
    );
    expect(after).toHaveLength(3);
    expect(after.find((x) => x.data.no === 'B')?.data.designCfm).toBe(560);
    const h = await db.history.where('equipmentId').equals(rtu.id).toArray();
    expect(h.some((e) => e.source === 'plan')).toBe(true);

    // removing the system keeps the rows
    await removePlanSystem(sheet.id, sys.id);
    expect((await db.planSheets.get(sheet.id))!.systems).toEqual([]);
    expect(
      (await db.airflowRows.where('equipmentId').equals(rtu.id).toArray()).filter((x) => x.table === 'supply'),
    ).toHaveLength(3);
  });

  it('a system from Import markup keeps the tech’s labels, is marked as from the markup, and writes its rows', async () => {
    const p = await createProject({ name: 'Markup job' });
    const wshp = await addEquipment(p.id, 'rtu', 'WSHP-3');
    const sheet = await savePlanSheet({
      projectId: p.id,
      fileName: 'M101 marked.pdf',
      pdf: new Uint8Array([1]),
      page: 1,
      pageCount: 1,
      width: 1000,
      height: 800,
      ocr: false,
      devices: [dev('d0-0', 100, 100, 'SR1', '12x8', 285)],
    });
    const parsed = (text: string, letter: string): ParsedLabel => ({
      text,
      letters: '',
      number: '3',
      side: '',
      letter,
      prefix: '3',
    });
    const r = await importMarkupSystems(sheet.id, [
      {
        prefix: '3',
        unit: wshp,
        candidates: [wshp],
        table: 'supply',
        polygon: [
          [0, 0],
          [200, 0],
          [200, 200],
          [0, 200],
        ],
        color: '#ff0000',
        duplicates: [],
        items: [
          { label: parsed('3A', 'A'), x: 110, y: 100, device: sheet.devices[0], distance: 10 },
          { label: parsed('3B', 'B'), x: 300, y: 100, device: null, distance: null },
        ],
      },
    ]);
    expect(r).toEqual({ systems: 1, rows: 2, placeholders: 1 });
    const saved = (await db.planSheets.get(sheet.id))!;
    expect(saved.systems[0]).toMatchObject({ source: 'markup', labels: ['3A', '3B'], prefix: '3' });
    expect(fromMarkup(saved.systems[0])).toBe(true);
    expect(saved.devices).toHaveLength(2); // the placeholder for 3B
    const rows = (await db.airflowRows.where('equipmentId').equals(wshp.id).toArray()).sort(
      (a, b) => a.order - b.order,
    );
    expect(rows.map((x) => [x.data.no, x.data.type, x.data.designCfm ?? null])).toEqual([
      ['A', 'SR1', 285],
      ['B', '', null],
    ]);
  });

  it('refuses a table the unit does not have', async () => {
    const p = await createProject({ name: 'Plan job 2' });
    const fan = await addEquipment(p.id, 'fan', 'EF-1');
    const sheet = await savePlanSheet({
      projectId: p.id,
      fileName: 'M-100.pdf',
      pdf: new Uint8Array([1]),
      page: 1,
      pageCount: 1,
      width: 100,
      height: 100,
      ocr: false,
      devices: [dev('d0-0', 10, 10, 'E1', null, 75)],
    });
    const sys = await addPlanSystem(sheet.id, {
      equipmentId: fan.id,
      table: 'supply',
      polygon: [],
      deviceKeys: ['d0-0'],
      color: '#000',
      prefix: 'E1',
    });
    await expect(applyPlanSystem(sheet.id, sys.id)).rejects.toThrow(/has no supply table/);
  });
});
