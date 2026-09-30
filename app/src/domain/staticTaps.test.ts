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
  it('RTU (filter, coil, heat, fan): filter and coil are not measured; the fan inlet goes on heat', () => {
    const v = { unitType: 'RTU', spTaps: '3-point' };
    expect([1, 2, 3, 4, 5].map((n) => tapSkipped(n, v))).toEqual([true, false, true, false, false]);
    expect([1, 2, 3, 4, 5].map((n) => tapSkipped(n, { ...v, spTaps: 'Full profile' }))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    // MAU (filter, burner, fan): filter skipped, burner = fan inlet
    expect([1, 2, 3, 4].map((n) => tapSkipped(n, { unitType: 'MAU', spTaps: '3-point' }))).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it('the skipped taps are automatically N/A (not missing) and exported blank, so TSP / ESP still calculate', () => {
    const b = sampleBundle();
    const unit = rtu({ spTaps: '3-point', spEntering: -0.3, spLeaving4: -1.0, spLeaving5: 0.7 });
    const c = computeCompletion({
      spec: getSpec('rtu'),
      unit,
      rows: [],
      photos: [],
      project: b.project,
      openIssues: 0,
    });
    expect(c.fields.spLeaving1.state).toBe('auto-na');
    expect(c.fields.spLeaving3.state).toBe('auto-na');
    expect(c.missing.map((m) => m.key)).not.toContain('spLeaving1');
    const cells = unitCells(unit, c);
    // blank (not "N/A"): the workbook's strip passes the entering static on
    expect([cells.spLeaving1, cells.spLeaving3].every((x) => x === undefined || x === null || x === '')).toBe(true);
    const p = staticProfile(staticInputs(cells));
    expect(p.tsp).toBeCloseTo(1.7, 6);
    expect(p.esp).toBeCloseTo(1.0, 6);
    expect(p.unitDp).toBeCloseTo(-0.7, 6);
  });

  it('a workbook with only those three readings comes back as 3-point', () => {
    const b = sampleBundle();
    const unit = rtu({ spTaps: '3-point', spEntering: -0.3, spLeaving4: -1.0, spLeaving5: 0.7 });
    unit.projectId = b.project.id;
    const { data } = toProjectData({ ...b, equipment: [...b.equipment, unit] });
    const back = fromProjectData(data);
    expect(back.equipment.find((e) => e.designation === 'RTU-9')?.data.spTaps).toBe('3-point');
  });
});
