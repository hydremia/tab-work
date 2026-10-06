// @vitest-environment node
/**
 * Template revision 07: the cells the app's data moved into (bores, nameplate HP, observations, Building Balance
 * exclusions, the fan's hood line, MAU intake screens and initial PSP / filter readings, flat oval traverses), and
 * revision 05 / 06 workbooks still importing and re-issuing in their own layout.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  exportWorkbookWithReport,
  importWorkbook,
  TEMPLATE_06_FILE_NAME,
  TEMPLATE_FILE_NAME,
  TEMPLATE_MAP,
  TEMPLATE_MAP_06,
  workbookRevision,
} from '@a2b/workbook';
import { describe, expect, it } from 'vitest';
import type { AirflowRow, Equipment, Issue } from '../data/types';
import { AIR_BALANCE_KEYS } from '../domain/airBalance';
import { traverseTotals } from '../domain/equipmentCalcs';
import { sampleBundle } from '../test/fixtures';
import { fromProjectData, toProjectData, type ProjectBundle } from './adapter';
import { reimportDiff } from './reimportDiff';

const file = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../${name}`, import.meta.url))));
const template = () => file(TEMPLATE_FILE_NAME);
const template06 = () => file(TEMPLATE_06_FILE_NAME);

/** The sample project with everything revision 07 adds a place for. */
function rev07Bundle(): ProjectBundle {
  const b = sampleBundle();
  const unit = (type: string) => b.equipment.find((e) => e.type === type)!;
  const row = (e: Equipment, table: string, order: number, data: AirflowRow['data']): AirflowRow => ({
    ...b.rows[0],
    id: `${table}-${e.id}-${order}`,
    equipmentId: e.id,
    table,
    order,
    data,
    na: {},
  });
  // MAU: intake method with two screens; PSP initial readings; filter grid initial + final
  const mau = unit('mau');
  mau.data.method = 'Intake';
  for (let i = 1; i <= 20; i++) mau.data[`pspVelocitiesInitial_${i}`] = 400 + i;
  b.rows.push(
    row(mau, 'intake', 1, { no: 'S-1', size: '48x24', ak: 4, initialVel: 200, finalVel: 250 }),
    row(mau, 'intake', 2, { no: 'S-2', size: '48x24', ak: 5, initialVel: 220, finalVel: 260 }),
    row(mau, 'filterGrid', 1, { size: '12" x 24"', initialVelocity: 300, velocity: 350 }),
  );
  // observations next to the deficiencies
  const obs = (kind: Issue['kind'], number: number, remark: string, equipmentId: string | null): Issue => ({
    ...b.issues[0],
    id: `obs-${kind}-${number}`,
    kind,
    number,
    remark,
    status: 'Open',
    comments: 'for the owner',
    equipmentId,
    issueType: 'observation',
  });
  b.issues.push(
    obs('new', 1, 'filters due for replacement next quarter.', unit('rtu').id),
    obs('existing', 1, 'roof hatch sticks.', null),
  );
  // EF-1 left out of the building balance
  b.project.info[AIR_BALANCE_KEYS.excluded] = 'EF-1';
  b.project.info[AIR_BALANCE_KEYS.excludedNote] = 'isolated room with its own intake louver (Note 1)';
  return b;
}

describe('revision 07 export', () => {
  const { data, warnings } = toProjectData(rev07Bundle());

  it('writes into the revision 07 cells, no rev 07 warnings', () => {
    expect(data.templateRevision).toBe('07');
    expect(warnings.join('\n')).not.toMatch(/revision 07/);
    const rtu = data.equipment.rtu[0];
    expect(rtu.fields).toMatchObject({ motorBore: '7/8', fanBore: '1', motorHp: 3 });
    expect(rtu.fields).not.toHaveProperty('sheaveBore');
    const mau = data.equipment.mau[0];
    expect(mau.fields).toMatchObject({ method: 'Intake' });
    expect(mau.tables?.intake).toEqual([
      { no: 'S-1', size: '48x24', ak: 4, initialVel: 200, finalVel: 250 },
      { no: 'S-2', size: '48x24', ak: 5, initialVel: 220, finalVel: 260 },
    ]);
    expect(mau.sequences?.pspVelocitiesInitial).toHaveLength(1); // PSP not the method: one "N/A" for the run
    expect(mau.columnTables?.filterGrid).toBeDefined();
    expect(data.sections.issuesNew.tables?.observations).toEqual([
      { no: 1, remark: 'RTU-1: filters due for replacement next quarter.', comments: 'for the owner' },
    ]);
    expect(data.sections.issuesExisting.tables?.observations).toEqual([
      { no: 1, remark: 'roof hatch sticks.', comments: 'for the owner' },
    ]);
    // EF-1 is fan slot 3: exhaust row 3 of the Building Balance
    expect(data.sections.buildingBalance.tables?.excluded).toEqual([{}, {}, { exhaust: 'Excl.' }]);
    expect(data.sections.buildingBalance.fields?.excludedNote).toBe(
      'Excluded from the totals: EF-1. isolated room with its own intake louver (Note 1)',
    );
  });

  it('round-trips through the revision 07 template (the importer picks rev 07 by itself)', async () => {
    const b = rev07Bundle();
    const { bytes } = await exportWorkbookWithReport(template(), toProjectData(b).data);
    expect(await workbookRevision(bytes)).toBe('07');
    const pd = await importWorkbook(bytes);
    expect(pd.templateRevision).toBe('07');
    const back = fromProjectData(pd);
    const rtu = back.equipment.find((e) => e.type === 'rtu')!;
    expect(rtu.data).toMatchObject({ motorBore: '7/8', fanBore: '1', motorHp: 3 });
    const mau = back.equipment.find((e) => e.type === 'mau')!;
    expect(mau.data.method).toBe('Intake');
    expect(
      back.rows.filter((r) => r.equipmentId === mau.id && r.table === 'intake').map((r) => r.data.finalVel),
    ).toEqual([250, 260]);
    const obs = back.issues.filter((i) => i.issueType === 'observation');
    expect(obs.map((i) => [i.kind, i.number, i.remark])).toEqual([
      ['new', 1, 'filters due for replacement next quarter.'],
      ['existing', 1, 'roof hatch sticks.'],
    ]);
    expect(obs[0].equipmentId).toBe(rtu.id);
    expect(back.issues.filter((i) => i.issueType !== 'observation')).toHaveLength(3);
    expect(back.project.info[AIR_BALANCE_KEYS.excluded]).toBe('EF-1');
    expect(back.project.info[AIR_BALANCE_KEYS.excludedNote]).toBe('isolated room with its own intake louver (Note 1)');
  });

  it('an Excl. flag typed in Excel is read back as an exclusion (the flags are the list)', async () => {
    const b = rev07Bundle();
    const pd = toProjectData(b).data;
    pd.sections.buildingBalance.tables!.excluded = [{ oa: 'Excl.' }, {}, {}];
    delete pd.appInfo;
    const { bytes } = await exportWorkbookWithReport(template(), pd);
    const back = fromProjectData(await importWorkbook(bytes));
    expect(back.project.info[AIR_BALANCE_KEYS.excluded]).toBe('RTU-1');
  });

  it('an excluded designation that is not a unit yet (from the air balance table) survives the round trip', async () => {
    const b = rev07Bundle();
    b.project.info[AIR_BALANCE_KEYS.excluded] = 'EF-1, EF-22';
    const { bytes } = await exportWorkbookWithReport(template(), toProjectData(b).data);
    const back = fromProjectData(await importWorkbook(bytes));
    expect(back.project.info[AIR_BALANCE_KEYS.excluded]).toBe('EF-1, EF-22');
  });

  it('a flat oval traverse: shape in the list, Ak and Final VEL as the workbook computes them', () => {
    const v = {
      shape: 'Flat Oval',
      width: 30,
      height: 12,
      ...Object.fromEntries([...Array(17)].map((_, i) => [`readings_${i + 1}`, i < 9 ? 1000 : 800])),
    };
    const t = traverseTotals(v);
    const ar = (18 * 12) / 144;
    const ac = (Math.PI * 36) / 144;
    expect(t.layoutText).toBe('3x3+8 ends'); // Traverses!M+4
    expect(t.ak).toBe(2.285);
    expect(t.finalVel).toBe(Math.round((1000 * ar + 800 * ac) / (ar + ac)));
    expect(t.finalCfm).toBe(Math.round(t.finalVel! * 2.285));
    expect(t.ends?.positions).toHaveLength(8);
  });
});

describe('revision 05 / 06 workbooks still import and re-issue', () => {
  it("a rev 06 export of today's data reads back the same (bores joined and split, rev 07 extras warned)", async () => {
    const b = rev07Bundle();
    const { data, warnings } = toProjectData(b, 'air', TEMPLATE_MAP_06);
    expect(data.templateRevision).toBe('06');
    expect(data.equipment.rtu[0].fields).toMatchObject({ sheaveBore: '7/8 / 1' });
    expect(data.equipment.rtu[0].fields).not.toHaveProperty('motorHp');
    const w = warnings.join('\n');
    expect(w).toMatch(/Intake method needs template revision 07/);
    expect(w).toMatch(/observation not in this revision 06 workbook/);
    const { bytes } = await exportWorkbookWithReport(template06(), data, { map: TEMPLATE_MAP_06 });
    expect(await workbookRevision(bytes)).toBe('06');
    const pd = await importWorkbook(bytes);
    expect(pd.templateRevision).toBe('06');
    const back = fromProjectData(pd);
    expect(back.equipment.find((e) => e.type === 'rtu')!.data).toMatchObject({ motorBore: '7/8', fanBore: '1' });
  });

  it('re-importing an issued rev 06 workbook: no changes where the workbook has no place (observations, nameplate HP ...)', async () => {
    const b = rev07Bundle();
    const { data } = toProjectData(b, 'air', TEMPLATE_MAP_06);
    const { bytes } = await exportWorkbookWithReport(template06(), data, { map: TEMPLATE_MAP_06 });
    const wb = await importWorkbook(bytes);
    const baseline = wb;
    const d = reimportDiff({ base: baseline, app: b, wb });
    expect(d.items).toEqual([]);
  });

  it('re-importing a rev 07 workbook against a rev 07 baseline: no changes; an edit in Excel is incoming', async () => {
    const b = rev07Bundle();
    const { bytes } = await exportWorkbookWithReport(template(), toProjectData(b).data);
    const baseline = await importWorkbook(bytes);
    expect(reimportDiff({ base: baseline, app: b, wb: baseline }).items).toEqual([]);
    const edited = structuredClone(baseline);
    edited.sections.issuesNew.tables!.observations![0].remark = 'RTU-1: filters replaced.';
    edited.equipment.rtu[0].fields!.motorHp = 5;
    const items = reimportDiff({ base: baseline, app: b, wb: edited }).items;
    expect(items.map((i) => [i.recKey, i.cell, i.kind])).toEqual(
      expect.arrayContaining([
        ['obs:new#1', 'remark', 'incoming'],
        ['unit:rtu#1', 'motorHp', 'incoming'],
      ]),
    );
  });

  it('the export picks the layout of a base workbook by its revision name', async () => {
    expect(await workbookRevision(template06())).toBe('06');
    expect(await workbookRevision(template())).toBe(TEMPLATE_MAP.revision);
  });
});
