import { describe, expect, it } from 'vitest';
import type { ProjectData } from '@a2b/workbook/map';
import { computeProjectCompletion, PRESSURE_KEYS } from '../domain/projectCompletion';
import { sampleBundle } from '../test/fixtures';
import { fromProjectData, toProjectData, type ProjectBundle } from './adapter';
import { reimportDiff } from './reimportDiff';

const exported = (b: ProjectBundle): ProjectData => structuredClone(toProjectData(b).data);
const withoutHoods = (): ProjectBundle => {
  const b = sampleBundle();
  const hoods = new Set(b.equipment.filter((e) => e.type === 'hood').map((e) => e.id));
  b.equipment = b.equipment.filter((e) => !hoods.has(e.id));
  b.rows = b.rows.filter((r) => !hoods.has(r.equipmentId));
  b.issues = b.issues.map((i) => (i.equipmentId && hoods.has(i.equipmentId) ? { ...i, equipmentId: null } : i));
  delete b.project.info[PRESSURE_KEYS.kitchenDp];
  return b;
};

describe('Building Balance pressures', () => {
  it('export: fixed row labels always written, kitchen row automatically N/A without hoods, explicit marks as notation', () => {
    const b = withoutHoods();
    b.project.info[PRESSURE_KEYS.buildingDp] = null;
    b.project.naState.fields[PRESSURE_KEYS.buildingDp] = { notation: 'Not Acc.' };
    const bb = toProjectData(b).data.sections.buildingBalance!;
    expect(bb.tables?.pressures?.slice(0, 2)).toEqual([
      {
        testSpace: 'Building',
        referenceSpace: 'Outdoors',
        dp: 'Not Acc.',
        remarks: 'Doors closed, all units running',
      },
      { testSpace: 'Kitchen', referenceSpace: 'Dining', dp: 'N/A' },
    ]);
  });

  it('import: the automatic kitchen N/A comes back automatic, an explicit mark as a mark, values as values', () => {
    const b = withoutHoods();
    b.project.naState.fields[PRESSURE_KEYS.spareRemarks] = { notation: 'N/A' };
    const back = fromProjectData(exported(b));
    expect(back.project.naState.fields[PRESSURE_KEYS.kitchenDp]).toBeUndefined();
    expect(back.project.naState.fields[PRESSURE_KEYS.spareRemarks]).toEqual({ notation: 'N/A' });
    expect(back.project.info).toMatchObject({
      bbBuildingDp: 0.03,
      bbSpareTest: 'Suite 101',
      bbSpareDp: 0.01,
      bbNotes: 'Measured at 2 pm.\nWind calm.',
    });
    // with hoods, an N/A in the kitchen row is the user's
    const withHoods = sampleBundle();
    withHoods.project.info[PRESSURE_KEYS.kitchenDp] = null;
    withHoods.project.naState.fields[PRESSURE_KEYS.kitchenDp] = { notation: 'N/A' };
    expect(fromProjectData(exported(withHoods)).project.naState.fields[PRESSURE_KEYS.kitchenDp]).toEqual({
      notation: 'N/A',
    });
  });

  it('re-import diff: a pressure changed in Excel is an incoming change in the "Building pressures" group', () => {
    const app = sampleBundle();
    const base = exported(app);
    const wb = exported(app);
    wb.sections.buildingBalance!.tables!.pressures![0].dp = 0.05;
    wb.sections.buildingBalance!.lines!.notes = ['Measured at 3 pm.', 'Wind calm.'];
    const d = reimportDiff({ base, app, wb });
    expect(d.items.map((i) => [i.kind, i.cell, i.group, i.wb, i.remark])).toEqual([
      ['incoming', 'info.bbBuildingDp', 'pressures', 0.05, false],
      ['incoming', 'info.bbNotes', 'pressures', 'Measured at 3 pm.\nWind calm.', true],
    ]);
    // untouched: nothing (the automatic kitchen N/A of a project without hoods never shows)
    const nh = withoutHoods();
    expect(reimportDiff({ base: exported(nh), app: nh, wb: exported(nh) }).items).toEqual([]);
    expect(reimportDiff({ base: null, app: nh, wb: exported(nh) }).items).toEqual([]);
  });

  it('project-level completion: building ΔP required, kitchen required only with hoods', () => {
    const b = sampleBundle();
    const input = (bundle: ProjectBundle, hasHoods: boolean) => ({
      project: bundle.project,
      hasHoods,
      hasCover: true,
      instruments: bundle.instruments,
    });
    b.project.info[PRESSURE_KEYS.kitchenDp] = null;
    b.project.info[PRESSURE_KEYS.buildingDp] = null;
    const c = computeProjectCompletion(input(b, true));
    expect(c.missing.filter((m) => m.section === 'pressures').map((m) => m.key)).toEqual([
      PRESSURE_KEYS.buildingDp,
      PRESSURE_KEYS.kitchenDp,
    ]);
    const c2 = computeProjectCompletion(input(b, false));
    expect(c2.fields[PRESSURE_KEYS.kitchenDp]).toMatchObject({ state: 'auto-na' });
    expect(c2.missing.map((m) => m.key)).toEqual([PRESSURE_KEYS.buildingDp]);
    b.project.naState.fields[PRESSURE_KEYS.buildingDp] = { notation: 'Not Acc.' };
    expect(computeProjectCompletion(input(b, false)).missing).toEqual([]);
  });
});
