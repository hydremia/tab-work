import { describe, expect, it } from 'vitest';
import { buildPreview } from '../domain/scheduleImport';
import { db } from './db';
import { addAirflowRow, addEquipment, applyScheduleImport, createProject, duplicateEquipment, setField } from './repo';

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
