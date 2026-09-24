import { describe, expect, it } from 'vitest';
import type { ProjectData, UnitData } from '@a2b/workbook/map';
import { db } from '../data/db';
import { addPhoto, createRecord, setField, writeTables } from '../data/repo';
import { sampleBundle } from '../test/fixtures';
import { pendingChanges } from '../sync/outbox';
import { toProjectData, type ProjectBundle } from './adapter';
import { applyReimport, prepareReview, type ParsedImport } from './importProject';
import { planApply, previewBundle } from './reimportApply';
import { reimportDiff } from './reimportDiff';
import { listRevisions, saveRevision } from './revisions';

const exported = (b: ProjectBundle): ProjectData => structuredClone(toProjectData(b).data);
const unit = (pd: ProjectData, type: string, slot: number): UnitData =>
  pd.equipment[type].find((u) => u.slot === slot)!;

async function store(b: ProjectBundle): Promise<void> {
  await db.transaction('rw', writeTables(), async () => {
    await createRecord('projects', b.project);
    for (const e of b.equipment) await createRecord('equipment', e);
    for (const r of b.rows) await createRecord('airflowRows', r);
    for (const i of b.issues) await createRecord('issues', i);
    for (const i of b.instruments) await createRecord('instruments', i);
  });
}

const parsedOf = (data: ProjectData, marker: ParsedImport['marker']): ParsedImport => ({
  bundle: null as unknown as ProjectBundle, // not used by the review / apply path
  data,
  marker,
  warnings: [],
  fileName: 'Riverside - TAB Report Prelim.xlsm',
  bytes: new Uint8Array([80, 75, 3, 4]),
});

async function setup() {
  const b = sampleBundle();
  await store(b);
  const rtu = b.equipment.find((e) => e.type === 'rtu')!;
  await addPhoto(b.project.id, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'unit', rtu.id);
  const baseline = exported(b);
  await saveRevision({
    id: 'rev-prelim',
    projectId: b.project.id,
    kind: 'export',
    label: 'Prelim',
    createdAt: 1,
    fileName: 'x.xlsm',
    size: 4,
    bytes: null,
    baseline,
    userId: 'local',
  });
  return { b, rtu, baseline };
}

describe('re-import: review and apply', () => {
  it('applies accepted values through setField (outbox), keeps photos, stores the base workbook and an import revision', async () => {
    const { b, rtu, baseline } = await setup();
    // meanwhile in the app: the same reading (collision) and another field
    await setField('equipment', rtu.id, 'data.amps1', 4.0);
    await setField('equipment', rtu.id, 'data.fanRpmFinal', 1110);
    // the issued workbook, edited in Excel
    const wb = structuredClone(baseline);
    const u = unit(wb, 'rtu', 1);
    u.fields!.volts1 = 470; // incoming reading
    u.fields!.amps1 = 3.8; // collision
    u.fields!.fla = 'Not Acc.'; // N/A notation changed
    u.lines!.remarks = ['Belt replaced; tension checked.', 'Second remark line.'];
    u.tables!.supply[1].finalVel = 480;
    u.tables!.supply.push({
      no: 'S-3',
      area: 'Suite',
      type: 'CD',
      size: '12x12',
      ak: 0.5,
      designCfm: 100,
      finalVel: 190,
    });
    u.tables!.oa = [];
    wb.sections.issuesNew.tables!.issues[1].remark = 'Ceiling access blocked at the corridor (east end).';
    wb.equipment.vav.push({
      slot: 2,
      schedule: { designation: 'VAV-102', designMaxCfm: 300 },
      tables: { outlets: [{ no: '1', finalVel: 100 }] },
    });
    wb.sections.issuesNew.tables!.issues.push({ no: 3, remark: 'VAV-102: damper stuck', status: 'Open' });

    const before = (await pendingChanges(5000)).length;
    const parsed = parsedOf(wb, { projectId: b.project.id, revisionId: 'rev-prelim', label: 'Prelim' });
    const review = await prepareReview(b.project.id, parsed);
    expect(review.baseline.how).toBe('marker');
    expect((await pendingChanges(5000)).length).toBe(before); // reviewing writes nothing (Cancel = leave)
    const { counts, items } = review.diff;
    expect(counts).toMatchObject({ collisions: 1, equipmentAdded: 1, remarks: 2 });
    const collision = items.find((i) => i.kind === 'collision')!;
    expect(collision).toMatchObject({ cell: 'amps1', base: 3.9, app: 4, wb: 3.8 });

    // unresolved collision: refused, nothing written
    await expect(applyReimport(review, parsed, {})).rejects.toThrow(/collision/);
    expect((await pendingChanges(5000)).length).toBe(before);

    const oaRemoval = items.find((i) => i.recKey.includes(':oa:') && i.change === 'removed')!;
    const summary = await applyReimport(review, parsed, { [collision.id]: 'wb', [oaRemoval.id]: 'app' });
    expect(summary.declined).toBe(1);

    const r = (await db.equipment.get(rtu.id))!;
    expect(r.data).toMatchObject({
      volts1: 470,
      amps1: 3.8,
      fanRpmFinal: 1110,
      remarks: 'Belt replaced; tension checked.\nSecond remark line.',
    });
    expect(r.naState.fields.fla).toEqual({ notation: 'Not Acc.' });
    const rows = (await db.airflowRows.where('equipmentId').equals(rtu.id).toArray()).sort((a, c) => a.order - c.order);
    expect(rows.filter((x) => x.table === 'supply').map((x) => [x.data.no, x.data.finalVel])).toEqual([
      ['S-1', 505],
      ['S-2', 480],
      ['S-3', 190],
    ]);
    expect(rows.filter((x) => x.table === 'oa')).toHaveLength(1); // removal declined
    const vav2 = (await db.equipment.where('projectId').equals(b.project.id).toArray()).find(
      (e) => e.designation === 'VAV-102',
    )!;
    expect(vav2).toMatchObject({ type: 'vav', slot: 2 });
    expect(await db.airflowRows.where('equipmentId').equals(vav2.id).count()).toBe(1);
    const issues = await db.issues.where('projectId').equals(b.project.id).toArray();
    expect(issues.find((i) => i.kind === 'new' && i.number === 2)?.remark).toBe(
      'Ceiling access blocked at the corridor (east end).',
    );
    expect(issues.find((i) => i.kind === 'new' && i.number === 3)).toMatchObject({
      remark: 'damper stuck',
      equipmentId: vav2.id,
    });
    // photos stay (they are not in the workbook)
    expect(await db.photos.where('equipmentId').equals(rtu.id).count()).toBe(1);

    // every accepted value is a field change in the outbox
    const pending = await pendingChanges(5000);
    const fieldsOf = (id: string) => pending.filter((c) => c.recordId === id && c.op === 'set').map((c) => c.field);
    expect(fieldsOf(rtu.id)).toEqual(
      expect.arrayContaining(['data.volts1', 'data.amps1', 'data.remarks', 'naState.fields.fla']),
    );
    expect(pending.some((c) => c.op === 'create' && c.table === 'equipment' && c.recordId === vav2.id)).toBe(true);
    expect(pending.find((c) => c.recordId === rtu.id && c.field === 'data.volts1')).toMatchObject({
      value: 470,
      synced: 0,
    });

    // the file is the base of the next export; an "imported" revision is recorded
    expect(await db.baseWorkbooks.get(b.project.id)).toMatchObject({
      fileName: parsed.fileName,
      fromRevisionId: 'rev-prelim',
    });
    const revs = await listRevisions(b.project.id);
    expect(revs[0]).toMatchObject({
      kind: 'import',
      label: 'Imported Prelim',
      applied: { declined: 1, collisions: 1 },
    });

    // a re-import of the same workbook now: everything already applied, only the declined removal is left
    const again = await prepareReview(b.project.id, parsed);
    expect(again.diff.items.map((i) => i.change)).toEqual(['removed']);
  });

  it('falls back to the latest export without a marker, and to a two-way diff without any revision', async () => {
    const { b, baseline } = await setup();
    const review = await prepareReview(b.project.id, parsedOf(baseline, null));
    expect(review.baseline).toMatchObject({ how: 'latest', revision: { id: 'rev-prelim' } });
    expect(review.diff.items).toEqual([]);
    const other = await prepareReview(
      b.project.id,
      parsedOf(baseline, { projectId: 'someone-else', revisionId: 'x' }),
      true,
    );
    expect(other.baseline.how).toBe('none');
    expect(other.diff.mode).toBe('two-way');
  });
});

describe('planApply / previewBundle (pure)', () => {
  it('preview shows the merged values (unit colors are computed on it); declined items produce no operations', () => {
    const app = sampleBundle();
    const base = exported(app);
    const wb = exported(app);
    unit(wb, 'rtu', 1).fields!.serial = 'NEW';
    unit(wb, 'rtu', 1).fields!.volts2 = 'Not Acc.';
    const d = reimportDiff({ base, app, wb });
    const plan = planApply(app, d, {});
    expect(plan.ops).toEqual([
      expect.objectContaining({ op: 'set', field: 'data.serial', value: 'NEW' }),
      expect.objectContaining({ op: 'set', field: 'data.volts2', value: null }),
      expect.objectContaining({ op: 'set', field: 'naState.fields.volts2', value: { notation: 'Not Acc.' } }),
    ]);
    const merged = previewBundle(app, plan.ops);
    const rtu = merged.equipment.find((e) => e.type === 'rtu')!;
    expect(rtu.data.serial).toBe('NEW');
    expect(app.equipment.find((e) => e.type === 'rtu')!.data.serial).toBe('4719G'); // the input is not mutated
    const serial = d.items.find((i) => i.cell === 'serial')!;
    const volts = d.items.find((i) => i.cell === 'volts2')!;
    expect(planApply(app, d, { [serial.id]: 'app', [volts.id]: 'app' }).ops).toEqual([]);
  });

  it('a VFD reading accepted from the workbook also answers "VFD on the unit?"', () => {
    const app = sampleBundle();
    const base = exported(app);
    const wb = exported(app);
    unit(wb, 'rtu', 1).fields!.vsdFinal = 45;
    const d = reimportDiff({ base, app, wb });
    const ops = planApply(app, d, {}).ops;
    expect(ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'data.vsdFinal', value: 45 }),
        expect.objectContaining({ field: 'data.hasVfd', value: 'Yes' }),
      ]),
    );
  });
});
