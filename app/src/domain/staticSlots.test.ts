import { describe, expect, it } from 'vitest';
import {
  fromPositional,
  legacyStaticWrites,
  measuredComponents,
  threePointTaps,
  toPositional,
  withComponentStatic,
} from './staticSlots';

describe('static profile readings by component (template revision 08)', () => {
  it('revision 08 positions are the unit type components in airflow order', () => {
    const at = (t: string) => toPositional(t, '08', (k) => k);
    expect(at('RTU')).toEqual({
      spLeaving1: 'spFilter',
      spLeaving2: 'spCoil',
      spLeaving3: 'spReheat',
      spLeaving4: 'spFan',
      spLeaving5: 'spHeat',
    });
    expect(at('DHU')).toMatchObject({ spLeaving3: 'spDesiccant', spLeaving4: 'spFan', spLeaving5: 'spHeat' });
    expect(at('EF')).toEqual({ spLeaving1: 'spFan' });
    expect(fromPositional('MAU', '08', (k) => [null, -0.3, -0.6, 0.4][k] ?? undefined)).toEqual({
      spFilter: -0.3,
      spBurner: -0.6,
      spFan: 0.4,
    });
  });

  it('rev 05-07 RTU positions: the old heat slot was the fan inlet (coil, or reheat when the coil was read), the old fan slot the discharge', () => {
    const old = (vals: (number | null)[]) => fromPositional('RTU', '07', (k) => vals[k - 1] ?? undefined);
    // 3-point (Capitola RTU-3): entering, "heat" = fan inlet, "fan" = discharge
    expect(old([null, null, null, -0.806, 0.514])).toEqual({ spCoil: -0.806, spHeat: 0.514 });
    // the coil read too: the reading between it and the fan is the reheat's
    expect(old([-0.5, null, -0.9, -1.0, 0.7])).toEqual({ spFilter: -0.5, spCoil: -0.9, spReheat: -1.0, spHeat: 0.7 });
    // MAU / EF keep their components (the fan last)
    expect(fromPositional('MAU', '07', (k) => [-0.2, null, -0.6, null, 0.4][k - 1] ?? undefined)).toEqual({
      spFilter: -0.2,
      spBurner: -0.6,
      spFan: 0.4,
    });
    expect(fromPositional('EF', '07', (k) => (k === 5 ? 0.3 : undefined))).toEqual({ spFan: 0.3 });
  });

  it('and back to rev 05-07 positions (re-issuing a rev 05 / 06 workbook)', () => {
    const data: Record<string, number> = { spFilter: -0.5, spCoil: -0.9, spReheat: -1.0, spFan: 0.4, spHeat: 0.7 };
    expect(toPositional('RTU', '07', (k) => data[k])).toEqual({
      spLeaving1: -0.5,
      spLeaving3: -0.9,
      spLeaving4: -1.0,
      spLeaving5: 0.7,
    });
    // a DHU is laid out as a DOAS: the desiccant wheel leaving static in the fan-inlet slot
    const dhu: Record<string, number> = { spFilter: -1.5, spCoil: -2.3, spDesiccant: -2.6, spHeat: 0.6 };
    expect(toPositional('DHU', '07', (k) => dhu[k])).toEqual({
      spLeaving1: -1.5,
      spLeaving3: -2.3,
      spLeaving4: -2.6,
      spLeaving5: 0.6,
    });
  });

  it('a unit entered before revision 08: values and marks move to their components, the old keys are cleared', () => {
    const w = legacyStaticWrites(
      { unitType: 'RTU', spLeaving1: -0.5, spLeaving3: -0.9, spLeaving4: -1.0, spLeaving5: 0.7 },
      { spLeaving2: { notation: 'N/A' } },
    )!;
    expect(w).toEqual({
      'data.spFilter': -0.5,
      'data.spCoil': -0.9,
      'data.spReheat': -1.0,
      'data.spHeat': 0.7,
      'data.hasReheat': 'Yes',
      'data.spLeaving1': null,
      'data.spLeaving3': null,
      'data.spLeaving4': null,
      'data.spLeaving5': null,
      'naState.fields.spLeaving2': null, // an RTU's "—" slot: nothing to keep
    });
    // a mark moves like a value; a component already entered keeps its value
    const m = legacyStaticWrites(
      { unitType: 'MAU', spBurner: -0.7, spLeaving3: -0.6 },
      { spLeaving5: { notation: 'Not Acc.' } },
    )!;
    expect(m).toEqual({
      'naState.fields.spFan': { notation: 'Not Acc.' },
      'data.spLeaving3': null,
      'naState.fields.spLeaving5': null,
    });
    expect(legacyStaticWrites({ unitType: 'RTU', spCoil: -1 }, {})).toBeNull();
    const u = withComponentStatic({ data: { unitType: 'EF', spLeaving5: 0.3 }, naState: { fields: {} } });
    expect(u.data).toEqual({ unitType: 'EF', spFan: 0.3 });
  });

  it('3-point taps: the fan inlet is the last measured component before the fan, the discharge the last one', () => {
    expect(threePointTaps({ unitType: 'RTU', spTaps: '3-point' })).toEqual({ fanInlet: 'Coil', discharge: 'Heat' });
    expect(threePointTaps({ unitType: 'RTU', spTaps: '3-point', hasReheat: 'Yes' })).toEqual({
      fanInlet: 'Reheat',
      discharge: 'Heat',
    });
    expect(threePointTaps({ unitType: 'EF', spTaps: '3-point' })).toEqual({ fanInlet: null, discharge: 'Fan' });
    expect(threePointTaps({ unitType: 'RTU' })).toBeNull();
    expect(measuredComponents({ unitType: 'DOAS', hasFilters: 'No' })).toEqual(['Wheel', 'Coil', 'Fan', 'Heat']);
  });
});
