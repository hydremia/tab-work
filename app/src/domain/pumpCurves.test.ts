import { describe, expect, it } from 'vitest';
import { flowAt, formatCurvePoints, headAt, parseCurvePoints, pumpCurveResult } from './pumpCurves';

// test data (not a real pump): three impellers at 1750 rpm
const pts = (xs: [number, number][]) => xs.map(([gpm, head]) => ({ gpm, head }));
const PUMP = {
  rpm: 1750,
  curves: [
    {
      impeller: 9,
      points: pts([
        [0, 76],
        [100, 70],
        [200, 60],
        [250, 52],
      ]),
    },
    {
      impeller: 8,
      points: pts([
        [0, 60],
        [100, 55],
        [200, 45],
        [250, 37],
      ]),
    },
    {
      impeller: 10,
      points: pts([
        [0, 94],
        [100, 87],
        [200, 76],
        [260, 65],
      ]),
    },
  ],
};

describe('pump curves', () => {
  it('head at a flow and flow at a head (linear between points, nothing outside the curve)', () => {
    const c = PUMP.curves[0].points;
    expect(headAt(c, 150)).toBe(65);
    expect(headAt(c, 300)).toBeNull();
    expect(flowAt(c, 65)).toBe(150);
    expect(flowAt(c, 80)).toBeNull();
  });

  it('impeller from the shut-off head (between two catalogue impellers), flow at the final head', () => {
    const r = pumpCurveResult(PUMP, { shutoffHead: 68, finalHead: 52.5 });
    expect(r.impeller).toBeCloseTo(8.5);
    // halfway curve: 68 / 62.5 / 52.5 at 0 / 100 / 200 GPM
    expect(r.gpm).toBeCloseTo(200);
    expect(r.note).toMatch(/shut-off head/);
  });

  it('a known impeller is used instead; the curves follow a measured speed (affinity laws)', () => {
    expect(pumpCurveResult(PUMP, { shutoffHead: null, finalHead: 70, impeller: 9 }).gpm).toBeCloseTo(100);
    const fast = pumpCurveResult(PUMP, { shutoffHead: 76 * 1.21, finalHead: 60 * 1.21, rpm: 1925 });
    expect(fast.impeller).toBeCloseTo(9);
    expect(fast.gpm).toBeCloseTo(220);
    expect(fast.note).toMatch(/1925 rpm/);
  });

  it('no answer outside the curves, with the reason', () => {
    const high = pumpCurveResult(PUMP, { shutoffHead: 100, finalHead: 60 });
    expect(high.impeller).toBeNull();
    expect(high.note).toMatch(/outside the curves \(60\.0–94\.0 ft\)/);
    expect(pumpCurveResult(PUMP, { shutoffHead: 68, finalHead: 90 }).note).toMatch(/off the curve/);
    expect(pumpCurveResult(PUMP, { shutoffHead: null, finalHead: 60 }).note).toMatch(/needs the shut-off head/);
    expect(pumpCurveResult({ rpm: null, curves: null }, { shutoffHead: 60, finalHead: 50 }).note).toMatch(/no curves/);
  });

  it('curve points typed as "gpm head" lines', () => {
    const p = parseCurvePoints('100 70\n0, 76\nbad line\n200\t60');
    expect(p).toEqual(
      pts([
        [0, 76],
        [100, 70],
        [200, 60],
      ]),
    );
    expect(formatCurvePoints(p)).toBe('0 76\n100 70\n200 60');
  });
});
