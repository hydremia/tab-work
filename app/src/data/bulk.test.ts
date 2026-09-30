import { describe, expect, it } from 'vitest';
import { buildPreview } from '../domain/scheduleImport';
import { db } from './db';
import { readAirBalance } from '../domain/airBalance';
import {
  addAirflowRow,
  addEquipment,
  applyAirBalance,
  applyScheduleImport,
  createProject,
  duplicateEquipment,
  setField,
} from './repo';

describe('applyScheduleImport', () => {
  it('creates new units in the free slots and updates existing ones, every value a field change in the outbox', async () => {
    const p = await createProject({ name: 'Job' });
    const vav1 = await addEquipment(p.id, 'vav', 'VAV-1');
    await setField('equipment', vav1.id, 'data.designMinCfm', 100);
    const preview = buildPreview({
      type: 'vav',
      rows: [
        ['VAV-1', '600', null],
        ['VAV-2', '450', '120'],
        ['VAV-3', 'x', '1'],
      ],
      mapping: ['designation', 'designMaxCfm', 'designMinCfm'],
      existing: await db.equipment.toArray(),
    });
    const { created, updated } = await applyScheduleImport(p.id, 'vav', preview.rows);
    expect(updated).toBe(1);
    expect(created.map((e) => [e.designation, e.slot])).toEqual([['VAV-2', 2]]);
    const all = (await db.equipment.where('projectId').equals(p.id).toArray()).sort((a, b) => a.slot - b.slot);
    expect(all.map((e) => [e.designation, e.data])).toEqual([
      ['VAV-1', { designMinCfm: 100, designMaxCfm: 600 }], // blank schedule cell: the app value stays
      ['VAV-2', { designMaxCfm: 450, designMinCfm: 120 }],
    ]);
    const changes = await db.fieldChanges.filter((c) => c.recordId === created[0].id).toArray();
    expect(changes.map((c) => `${c.op}:${c.field}`).sort()).toEqual([
      'create:',
      'set:data.designMaxCfm',
      'set:data.designMinCfm',
    ]);
  });
});

describe('duplicateEquipment', () => {
  it('copies design data and configuration (not readings / serial), rows without readings, next free slot', async () => {
    const p = await createProject({ name: 'Job' });
    const a = await addEquipment(p.id, 'vav', 'VAV-12');
    await addEquipment(p.id, 'vav', 'VAV-13');
    await setField('equipment', a.id, 'data.designMaxCfm', 600);
    await setField('equipment', a.id, 'data.serial', 'SN');
    await setField('equipment', a.id, 'data.minCfmActual', 140);
    await setField('equipment', a.id, 'naState.fields.ddcAddress', { notation: 'N/A' });
    await setField('equipment', a.id, 'naState.sections.unit', { notation: 'Not Acc.' });
    await addAirflowRow(a, 'outlets', { no: 'S-1', ak: 0.5, designCfm: 300, finalVel: 590 });
    await addAirflowRow(a, 'outlets', { no: 'S-2', ak: 0.5, designCfm: 300, initialVel: 610 });
    const copy = await duplicateEquipment(a.id, 'VAV-14', { rows: true });
    expect(copy).toMatchObject({ designation: 'VAV-14', slot: 3, type: 'vav', data: { designMaxCfm: 600 } });
    expect(copy.data.serial).toBeUndefined();
    expect(copy.data.minCfmActual).toBeUndefined();
    expect(copy.naState.fields.ddcAddress).toEqual({ notation: 'N/A' });
    expect(copy.naState.sections.unit).toEqual({ notation: 'Not Acc.' });
    const rows = (await db.airflowRows.where('equipmentId').equals(copy.id).toArray()).sort(
      (x, y) => x.order - y.order,
    );
    expect(rows.map((r) => r.data)).toEqual([
      { no: 'S-1', ak: 0.5, designCfm: 300 },
      { no: 'S-2', ak: 0.5, designCfm: 300 },
    ]);
    const without = await duplicateEquipment(a.id, 'VAV-15');
    expect(await db.airflowRows.where('equipmentId').equals(without.id).count()).toBe(0);
  });
});

describe('applyScheduleImport: scope', () => {
  it('existing rows are Existing (airflow only: non-airflow sections N/A), removed rows are left out', async () => {
    const p = await createProject({ name: 'Job' });
    const preview = buildPreview({
      type: 'fan',
      rows: [
        ['EF-1', '1890', 'EXISTING TO REMAIN'],
        ['EF-2', '2300', null],
        ['EF-17', 'REMOVE AND CAP', null],
      ],
      mapping: ['designation', 'designTotalCfm', null],
      existing: [],
    });
    await applyScheduleImport(p.id, 'fan', preview.rows, { existingAirflowOnly: true });
    const all = (await db.equipment.where('projectId').equals(p.id).toArray()).sort((a, b) => a.slot - b.slot);
    expect(all.map((e) => [e.designation, e.isExisting])).toEqual([
      ['EF-1', true],
      ['EF-2', false],
    ]);
    expect(Object.keys(all[0].naState.sections).sort()).toEqual(['drive', 'misc', 'motor', 'rpm', 'static', 'unit']);
    expect(all[1].naState.sections).toEqual({});

    // re-import: the schedule now says EF-2 is existing (and the default for unmarked rows is Existing)
    const again = buildPreview({
      type: 'fan',
      rows: [['EF-2', 'EXISTING', null]],
      mapping: ['designation', 'scope', null],
      existing: all,
    });
    await applyScheduleImport(p.id, 'fan', again.rows, { isExisting: true });
    expect((await db.equipment.get(all[1].id))?.isExisting).toBe(true);
  });
});

describe('applyScheduleImport: shell & TI', () => {
  it('units the schedule marks existing come in as New with full data; removed ones are still left out', async () => {
    const p = await createProject({ name: 'TI' });
    const preview = buildPreview({
      type: 'rtu',
      rows: [
        ['RTU-1', 'EXISTING'],
        ['RTU-2', 'NEW'],
        ['RTU-3', 'EXISTING TO BE REMOVED'],
      ],
      mapping: ['designation', 'scope'],
      existing: [],
    });
    await applyScheduleImport(p.id, 'rtu', preview.rows, { existingAirflowOnly: true, existingAsNew: true });
    const all = (await db.equipment.where('projectId').equals(p.id).toArray()).sort((a, b) => a.slot - b.slot);
    expect(all.map((e) => [e.designation, e.isExisting, Object.keys(e.naState.sections).length])).toEqual([
      ['RTU-1', false, 0],
      ['RTU-2', false, 0],
    ]);
  });
});

describe('applyAirBalance', () => {
  it('fills blank design CFMs, adds missing units as Existing, other OA (transfer air TA-1) to a spare row, keeps the totals', async () => {
    const p = await createProject({ name: 'Job' });
    const rtu = await addEquipment(p.id, 'rtu', 'RTU-1');
    const ef8 = await addEquipment(p.id, 'fan', 'EF-8');
    await setField('equipment', ef8.id, 'data.designTotalCfm', 1200);
    const table = readAirBalance([
      ['UNIT', 'OSA (CFM)', 'UNIT', 'EXHAUST (CFM)'],
      ['RTU-1', '4,100', 'EF-8', '1,575'],
      ['RTU-9', '500', 'EF-40', '300'],
      ['TA-1', '200', null, null],
      ['TOTAL', '4,800', 'TOTAL', '1,875'],
    ])!;
    const r = await applyAirBalance(p.id, table, {
      fillBlank: true,
      addMissing: true,
      existingAirflowOnly: true,
      source: 'M3.0 VENTILATION CALCULATION',
    });
    expect([r.filled, r.added.map((u) => u.designation), r.spareRows, r.notAdded]).toEqual([
      1,
      ['RTU-9', 'EF-40'],
      1,
      [],
    ]);
    expect((await db.equipment.get(rtu.id))?.data.designOaCfm).toBe(4100);
    expect((await db.equipment.get(ef8.id))?.data.designTotalCfm).toBe(1200); // differs: left as it is
    const ef40 = await db.equipment.get(r.added[1].id);
    expect([ef40?.type, ef40?.isExisting, ef40?.data.designTotalCfm]).toEqual(['fan', true, 300]);
    expect(ef40?.naState.sections.motor).toMatchObject({ notation: 'N/A' });
    const info = (await db.projects.get(p.id))!.info;
    expect([info.bbOa1Unit, info.bbOa1Design]).toEqual(['TA-1', 200]);
    expect([info.abOaDesign, info.abExhaustDesign, info.abNet, info.abSource]).toEqual([
      4800,
      1875,
      2925,
      'M3.0 VENTILATION CALCULATION',
    ]);
  });
});
