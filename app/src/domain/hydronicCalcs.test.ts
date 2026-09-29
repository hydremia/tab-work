import { describe, expect, it } from 'vitest';
import { plantCircuits, pumpHead, pumpTest, valveRatio, valveTotals } from './hydronicCalcs';

describe('hydronic calcs (the H01 workbook formulas)', () => {
  it('pump head from the gauges: (discharge - suction) x 2.31 / SG + elevation; text reads as blank', () => {
    // the same numbers as tools/functional_test_hydronic.py (LibreOffice)
    expect(pumpHead(10, 40, null, null)).toBeCloseTo(69.3, 6);
    expect(pumpHead(9, 35, null, null)).toBeCloseTo(60.06, 6);
    expect(pumpHead(15, 30, 1.1, 1.5)).toBeCloseTo((15 * 2.31) / 1.1 + 1.5, 9);
    expect(pumpHead(15, 30, 0, null)).toBeCloseTo(34.65, 6); // SG 0 or text: water
    expect(pumpHead('N/A', 30, null, null)).toBeNull();
    expect(pumpHead(null, 30, null, null)).toBeNull();
  });

  it('pump test: final head vs design, flow vs design, head above design warning', () => {
    const t = pumpTest({ finalSuction: 9, finalDischarge: 35, designHead: 60, designGpm: 200, actualGpm: 190 });
    expect(t.finalHead).toBeCloseTo(60.06, 6);
    expect(t.headRatio).toBeCloseTo(1.001, 3);
    expect(t.flowRatio).toBeCloseTo(0.95, 9);
    expect(t.headAboveDesign).toBe(false); // 0.1 % above: rounding, no warning
    expect(pumpTest({ finalSuction: 9, finalDischarge: 40, designHead: 60 }).headAboveDesign).toBe(true);
    expect(pumpTest({ designHead: 60 }).finalHead).toBeNull();
  });

  it('valve %: final / design, else initial / design; a final notation gives blank (as the sheet)', () => {
    expect(valveRatio({ designGpm: 10, initialGpm: 9, finalGpm: 11 })).toBeCloseTo(1.1, 9);
    expect(valveRatio({ designGpm: 10, initialGpm: 9 })).toBeCloseTo(0.9, 9);
    expect(valveRatio({ designGpm: 10, initialGpm: 9, finalGpm: 'N/A' })).toBeNull();
    expect(valveRatio({ designGpm: 0, finalGpm: 5 })).toBeNull();
    const t = valveTotals([
      { data: { designGpm: 10, initialGpm: 9, finalGpm: 11 } },
      { data: { designGpm: 20, initialGpm: 17, finalGpm: 19.5 } },
      { data: { designGpm: 30, initialGpm: 36, finalGpm: 'N/A' } },
    ]);
    expect(t).toMatchObject({ design: 60, initial: 62, final: 30.5 });
    expect(t.ratio).toBeCloseTo(30.5 / 60, 9);
  });

  it('plant: one check per circuit with a design flow, labelled by the circuit', () => {
    expect(
      plantCircuits({
        circuit1: 'Evaporator',
        designGpm1: 240,
        actualGpm1: 228,
        circuit2: 'Condenser',
        designGpm2: 300,
      }),
    ).toEqual([
      { label: 'Evaporator flow', design: 240, actual: 228 },
      { label: 'Condenser flow', design: 300, actual: null },
    ]);
    expect(plantCircuits({ designGpm1: 90 })).toEqual([{ label: 'Circuit 1 flow', design: 90, actual: null }]);
  });
});
