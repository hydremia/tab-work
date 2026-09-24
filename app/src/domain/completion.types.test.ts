/** Completion rules of the MAU, ERV, fan, small fan, hood and traverse specs (docs/REQUIRED_FIELDS.md). */
import { describe, expect, it } from 'vitest';
import { emptyNaState, type Equipment, type NaState } from '../data/types';
import { sampleBundle } from '../test/fixtures';
import { computeCompletion, seqNaKey, tableNaKey, type CompletionInput } from './completion';
import { getSpec } from './specs';

const project = { scopeProfile: 'full' as const, customScope: {}, tolerance: 0.1 };
const PHOTOS: Record<string, { category: string }[]> = {
  mau: [{ category: 'unit' }, { category: 'tag' }],
  erv: [{ category: 'unit' }, { category: 'tag' }],
  fan: [{ category: 'unit' }, { category: 'tag' }],
  smallFan: [{ category: 'unit' }],
  hood: [{ category: 'unit' }, { category: 'tag' }],
  traverse: [],
};

function unit(designation: string): CompletionInput {
  const b = sampleBundle();
  const e = b.equipment.find((x) => x.designation === designation)!;
  return {
    spec: getSpec(e.type),
    unit: { designation: e.designation, data: { ...e.data }, naState: structuredClone(e.naState) },
    rows: b.rows.filter((r) => r.equipmentId === e.id),
    photos: PHOTOS[e.type],
    project,
    openIssues: 0,
  };
}
const withData = (i: CompletionInput, data: Equipment['data']): CompletionInput => ({
  ...i,
  unit: { ...i.unit, data: { ...i.unit.data, ...data } },
});
const withNa = (i: CompletionInput, fields: NaState['fields']): CompletionInput => ({
  ...i,
  unit: { ...i.unit, naState: { ...i.unit.naState, fields: { ...i.unit.naState.fields, ...fields } } },
});
const missingKeys = (i: CompletionInput) => computeCompletion(i).missing.map((m) => m.key);

describe('every new type: the fixture units are complete (green)', () => {
  for (const d of [
    'MAU-1',
    'MAU-2',
    'MAU-3',
    'MAU-4',
    'ERV-1',
    'EF-2',
    'EF-S1',
    'EF-S21',
    'H-1',
    'H-2',
    'T-1',
    'T-2',
    'T-3',
  ]) {
    it(d, () => {
      const c = computeCompletion(unit(d));
      expect(c.missing).toEqual([]);
      expect(c.outOfTolerance).toEqual([]);
      expect(c.color).toBe('green');
    });
  }
  it('photos are required unless N/A', () => {
    expect(missingKeys({ ...unit('H-1'), photos: [] })).toEqual(['photo:unit', 'photo:tag']);
  });
});

describe('MAU supply airflow method', () => {
  it('PSP: the PSP inputs are required; the other methods are automatically N/A', () => {
    const c = computeCompletion(withData(unit('MAU-1'), { pspLength: null }));
    expect(c.missing.map((m) => m.key)).toEqual(['pspLength']);
    expect(c.tables.filterGrid).toMatchObject({ state: 'auto-na', reason: 'method is not Filter Grid' });
    expect(c.fields.profilePressure).toMatchObject({ state: 'auto-na' });
    expect(c.tables.supply.state).toBe('optional'); // outlets optional with another method
    expect(c.fields.instrument.state).toBe('optional');
    expect(c.sequences.pspVelocities).toMatchObject({ state: 'value', entered: 20 }); // 19 values + 1 Not Acc.
  });

  it('switching the method: the old method drops out even though its values are kept', () => {
    const c = computeCompletion(withData(unit('MAU-1'), { method: 'Filter Grid' }));
    expect(c.fields.pspLength).toMatchObject({ state: 'auto-na', reason: 'method is not PSP' });
    expect(c.sequences.pspVelocities.state).toBe('auto-na');
    expect(c.missing.map((m) => m.key)).toEqual(['filterGrid']);
    const back = computeCompletion(withData(unit('MAU-1'), { method: 'Filter Grid' }));
    expect(back.fields.pspWidth.state).toBe('auto-na');
    // and back to PSP: complete again
    expect(computeCompletion(unit('MAU-1')).color).toBe('green');
  });

  it('Outlets: instrument and outlet rows are required', () => {
    const i = { ...withData(unit('MAU-1'), { method: 'Outlets' }), rows: [] };
    expect(missingKeys(i)).toEqual(['instrument', 'supply']);
    expect(computeCompletion(unit('MAU-4')).color).toBe('green');
  });

  it('Profile Pressure: housing and pressure; filter grid rows of another method are not counted', () => {
    const i = withData(unit('MAU-2'), { method: 'Profile Pressure' });
    expect(missingKeys(i)).toEqual(['profileHousing', 'profilePressure']);
    const c = computeCompletion(i);
    expect(c.tables.filterGrid).toMatchObject({ state: 'auto-na', forced: true });
  });

  it('no method chosen: the method is missing, the method inputs are neither required nor N/A', () => {
    const c = computeCompletion(withData(unit('MAU-1'), { method: null }));
    expect(c.missing.map((m) => m.key)).toEqual(['method']);
    expect(c.fields.pspLength.state).toBe('value');
    expect(c.fields.profileHousing.state).toBe('optional');
  });

  it('the method total is checked against design (override) with the project tolerance', () => {
    const c = computeCompletion(withData(unit('MAU-3'), { profilePressure: 0.5 })); // 5600 of 6500
    expect(c.total).toMatchObject({ design: 6500, actual: 5600 });
    expect(c.color).toBe('red');
    expect(c.outOfTolerance[0]).toMatchObject({ table: 'total', label: 'Method total' });
  });

  it('the velocity readings can be N/A as a whole', () => {
    const i = withNa(
      withData(
        unit('MAU-1'),
        Object.fromEntries(Array.from({ length: 20 }, (_, k) => [`pspVelocities_${k + 1}`, null])),
      ),
      { pspVelocities_7: null, [seqNaKey('pspVelocities')]: { notation: 'Not Acc.' } },
    );
    const c = computeCompletion(i);
    expect(c.sequences.pspVelocities).toMatchObject({ state: 'na', notation: 'Not Acc.' });
    expect(c.missing).toEqual([]);
  });
});

describe('ERV', () => {
  it('supply and exhaust tables are both required; design is checked for both (R8)', () => {
    const i = unit('ERV-1');
    expect(missingKeys({ ...i, rows: i.rows.filter((r) => r.table !== 'exhaust') })).toEqual(['exhaust']);
    const c = computeCompletion(withData(i, { designSupplyCfm: 1200, designExhaustCfm: 900 }));
    expect(c.designDiscrepancies.map((d) => [d.label, d.schedule, d.outlets])).toEqual([
      ['supply outlets', 1200, 1000],
      ['exhaust inlets', 900, 950],
    ]);
  });
  it('no OA damper, no unit ESP; ΔP actuals required', () => {
    const c = computeCompletion(withData(unit('ERV-1'), { exhaustDpActual: null }));
    expect(c.fields.oaDamper).toBeUndefined();
    expect(c.fields.unitEsp).toBeUndefined();
    expect(c.missing.map((m) => m.key)).toEqual(['exhaustDpActual']);
  });
});

describe('Fans (EF)', () => {
  it('only the fan is on the static profile: components 1-4 automatically N/A', () => {
    const c = computeCompletion(unit('EF-2'));
    for (const k of ['spLeaving1', 'spLeaving2', 'spLeaving3', 'spLeaving4']) expect(c.fields[k].state).toBe('auto-na');
    expect(c.fields.spLeaving5.state).toBe('value');
    expect(c.fields.volts2.state).toBe('auto-na'); // 1-phase
    expect(c.fields.designOaCfm).toBeUndefined();
  });
});

describe('Small fans (R6)', () => {
  it('manufacturer, model, serial, measured amps, design CFM and airflow required; the rest optional', () => {
    const c = computeCompletion(unit('EF-S21')); // no HP / voltage / phase / ESP / RPM / speed
    expect(c.color).toBe('green');
    expect(c.fields.hp.state).toBe('optional');
    expect(
      missingKeys(
        withData(unit('EF-S21'), { serial: null, amps: null, designCfm: null, model: null, manufacturer: null }),
      ),
    ).toEqual(['manufacturer', 'model', 'serial', 'amps', 'designCfm']);
    const i = unit('EF-S1');
    expect(missingKeys({ ...i, rows: [] })).toEqual(['outlets']);
  });
});

describe('Hoods', () => {
  it('VelGrid: readings 2 and 3 are automatically N/A; one reading per filter', () => {
    const i = unit('H-1');
    const c = computeCompletion(i);
    const r = Object.values(c.tables.filters.rows)[0];
    expect(r.auto).toMatchObject({ init2: 'VelGrid: one reading', final3: 'VelGrid: one reading' });
    expect(r.missing).toEqual([]);
  });
  it('Airfoil: all 3 readings of Initial or Final are needed (or N/A); No Filter rows need none', () => {
    const i = unit('H-2');
    const rows = i.rows.map((r) => (r.order === 2 ? { ...r, na: {} } : r)); // un-mark "Not Acc." on reading 3
    const c = computeCompletion({ ...i, rows });
    const row2 = rows.find((r) => r.order === 2)!;
    expect(c.tables.filters.rows[row2.id].missing).toEqual(['reading']);
    const noFilter = i.rows.find((r) => r.data.size === 'No Filter')!;
    expect(computeCompletion(i).tables.filters.rows[noFilter.id]).toMatchObject({ missing: [] });
  });
  it('filter size is required per row; the hood total is checked against design', () => {
    const i = unit('H-1');
    const rows = i.rows.map((r, k) => (k === 0 ? { ...r, data: { ...r.data, size: null } } : r));
    expect(computeCompletion({ ...i, rows }).tables.filters.rows[rows[0].id].missing).toEqual(['size']);
    const low = computeCompletion(withData(i, { designCfm: 2500 }));
    expect(low.color).toBe('red');
    expect(low.total?.ratio).toBeCloseTo(2049.2888 / 2500);
  });
});

describe('Traverses (R7)', () => {
  it('instrument, duct static pressure and temperature are all required', () => {
    expect(missingKeys(withData(unit('T-1'), { instrument: null, ductStatic: null, temperature: null }))).toEqual([
      'instrument',
      'ductStatic',
      'temperature',
    ]);
  });
  it('round duct: height automatically N/A; liner optional', () => {
    const c = computeCompletion(unit('T-2'));
    expect(c.fields.height).toMatchObject({ state: 'auto-na', reason: 'round duct' });
    expect(c.fields.liner.state).toBe('optional');
  });
  it('prelim rule: complete with an initial average OR the final grid', () => {
    expect(computeCompletion(unit('T-3')).color).toBe('green'); // initial only
    expect(computeCompletion(unit('T-1')).fields.initialVel.state).toBe('optional'); // final only
    expect(missingKeys(withData(unit('T-3'), { initialVel: null }))).toEqual(['seq:readings']);
  });
  it('gray when only the point label exists', () => {
    const c = computeCompletion({ ...unit('T-3'), unit: { designation: 'T-9', data: {}, naState: emptyNaState() } });
    expect(c.color).toBe('gray');
  });
  it('an explicit table / sequence N/A satisfies the requirement', () => {
    const i = withNa(withData(unit('T-3'), { initialVel: null }), { [seqNaKey('readings')]: { notation: 'N/A' } });
    expect(computeCompletion(i).color).toBe('green');
    const h = withNa({ ...unit('H-1'), rows: [] }, { [tableNaKey('filters')]: { notation: 'Not Acc.' } });
    expect(computeCompletion(h).missing).toEqual([]);
  });
});

describe('Custom scope profile covers every equipment type', () => {
  for (const d of ['MAU-1', 'ERV-1', 'EF-2', 'EF-S1', 'H-1', 'T-1']) {
    it(`${d}: every section that can be switched off becomes N/A for this scope`, () => {
      const base = unit(d);
      const sections = base.spec.sections.filter((s) => !s.locked);
      expect(sections.length).toBeGreaterThan(0);
      const off = Object.fromEntries(sections.map((s) => [s.key, false]));
      // nothing entered yet (entered values are still exported, so they count as values, not N/A)
      const c = computeCompletion({
        ...base,
        unit: { ...base.unit, data: { designation: base.unit.designation }, naState: emptyNaState() },
        rows: [],
        photos: [],
        project: { scopeProfile: 'custom', customScope: { [base.spec.type]: off }, tolerance: 0.1 },
      });
      for (const s of sections) {
        expect(c.sections[s.key].state, s.key).toBe('na');
        expect(c.sections[s.key].naSource, s.key).toBe('scope');
      }
      // a section switched off only for another type is untouched
      const other = computeCompletion({
        ...base,
        project: { scopeProfile: 'custom', customScope: { rtu: off }, tolerance: 0.1 },
      });
      expect(other.color).toBe('green');
    });
  }
});
