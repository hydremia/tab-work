/** 3-point static profiles (entering, fan inlet, discharge): the other taps are N/A in the app and blank in the workbook. */
import { describe, expect, it } from 'vitest';
import { emptyNaState, type Equipment } from '../data/types';
import { sampleBundle } from '../test/fixtures';
import { fromProjectData, toProjectData, unitCells } from '../workbook/adapter';
import { computeCompletion } from './completion';
import { tapSkipped } from './conditions';
import { getSpec } from './specs';
import { staticInputs, staticProfile } from './staticProfile';

const rtu = (data: Equipment['data']): Equipment => ({
  id: '00000000-0000-4000-9000-000000000901',
  projectId: 'p',
  type: 'rtu',
  designation: 'RTU-9',
  slot: 9,
  isExisting: false,
  data: { unitType: 'RTU', ...data },
  naState: emptyNaState(),
  createdAt: 0,
  updatedAt: 0,
});

describe('3-point static profile', () => {
  it('RTU (filter, coil, [reheat], fan, heat): entering, the fan inlet (coil, or reheat) and the discharge (heat)', () => {
    const v = { unitType: 'RTU', spTaps: '3-point' };
    const comps = ['Filter', 'Coil', 'Reheat', 'Fan', 'Heat'];
    // no reheat: the coil is the fan inlet; the fan's own leaving static is not read (the heat is the discharge)
    expect(comps.map((c) => tapSkipped(c, v))).toEqual([true, false, false, true, false]);
    expect(comps.map((c) => tapSkipped(c, { ...v, hasReheat: 'Yes' }))).toEqual([true, true, false, true, false]);
    expect(comps.map((c) => tapSkipped(c, { ...v, spTaps: 'Full profile' }))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    // MAU (filter, burner, fan): filter skipped, burner = fan inlet, fan = discharge
    expect(['Filter', 'Burner', 'Fan'].map((c) => tapSkipped(c, { unitType: 'MAU', spTaps: '3-point' }))).toEqual([
      true,
      false,
      false,
    ]);
    // DHU: the desiccant wheel is the fan inlet
    expect(
      ['Filter', 'Coil', 'Desiccant', 'Fan', 'Heat'].map((c) => tapSkipped(c, { unitType: 'DHU', spTaps: '3-point' })),
    ).toEqual([true, true, false, true, false]);
  });

  it('the skipped taps are automatically N/A (not missing) and exported blank, so TSP / ESP still calculate', () => {
    const b = sampleBundle();
    const unit = rtu({ spTaps: '3-point', spEntering: -0.3, spCoil: -1.0, spHeat: 0.7 });
    const c = computeCompletion({
      spec: getSpec('rtu'),
      unit,
      rows: [],
      photos: [],
      project: b.project,
      openIssues: 0,
    });
    expect(c.fields.spFilter.state).toBe('auto-na');
    expect(c.fields.spFan.state).toBe('auto-na');
    expect(c.missing.map((m) => m.key)).not.toContain('spFilter');
    const cells = unitCells(unit, c);
    // revision 08 positions: Filter, Coil, Reheat, Fan, Heat; the skipped ones blank (not "N/A")
    expect(cells.spLeaving2).toBe(-1.0);
    expect(cells.spLeaving5).toBe(0.7);
    expect([cells.spLeaving1, cells.spLeaving4].every((x) => x === undefined || x === null || x === '')).toBe(true);
    const p = staticProfile(staticInputs(cells));
    expect(p.tsp).toBeCloseTo(1.7, 6);
    expect(p.esp).toBeCloseTo(1.0, 6);
    expect(p.unitDp).toBeCloseTo(-0.7, 6);
  });

  it('a workbook with only those three readings comes back as 3-point', () => {
    const b = sampleBundle();
    const unit = rtu({ spTaps: '3-point', spEntering: -0.3, spCoil: -1.0, spHeat: 0.7 });
    unit.projectId = b.project.id;
    const { data } = toProjectData({ ...b, equipment: [...b.equipment, unit] });
    const back = fromProjectData(data).equipment.find((e) => e.designation === 'RTU-9')!;
    expect(back.data).toMatchObject({ spTaps: '3-point', spEntering: -0.3, spCoil: -1.0, spHeat: 0.7 });
  });
});
