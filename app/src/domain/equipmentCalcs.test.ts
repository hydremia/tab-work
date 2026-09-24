/**
 * Live calculations vs. the workbook: expected values are the ones tools/functional_test_rev05.py checks after
 * LibreOffice recalculation of revision 05 (and spike/export/src/expectations.ts), restated here.
 */
import { describe, expect, it } from 'vitest';
import { sampleBundle } from '../test/fixtures';
import {
  buildingBalance,
  filterCfm,
  filterGridCfm,
  hoodTotals,
  mauTotals,
  profileCfm,
  pspCfm,
  pspK,
  roundXL,
  traverseLayout,
  traverseTotals,
} from './equipmentCalcs';

const seq = (key: string, vals: readonly (number | string)[]) =>
  Object.fromEntries(vals.map((v, i) => [`${key}_${i + 1}`, v]));
const r2 = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);
const r4 = (x: number | null) => (x === null ? null : Math.round(x * 1e4) / 1e4);

describe('Excel ROUND', () => {
  it('rounds half away from zero, decimal-exact', () => {
    expect(roundXL(2.25, 1)).toBe(2.3);
    expect(roundXL(1.005, 2)).toBe(1.01);
    expect(roundXL(-2.5, 0)).toBe(-3);
    expect(roundXL(501.5, 0)).toBe(502);
  });
});

describe('MAU PSP (Evergreen K 0.88 up to 12", 0.95 from 14")', () => {
  it('K-factor by width', () => {
    expect([6, 9, 10, 12].map(pspK)).toEqual([0.88, 0.88, 0.88, 0.88]);
    expect([14, 16, 18, 20, 24].map(pspK)).toEqual([0.95, 0.95, 0.95, 0.95, 0.95]);
    expect(pspK(13)).toBeNull();
  });
  it('20 readings of 300 fpm, 96" x 12", 1 blank -> MAUs E62 / K62', () => {
    const P = (300 * (96 - 2 - 2) * 12 * 0.88) / 144;
    const r = pspCfm({ pspLength: 96, pspWidth: 12, pspBlanks: 1, ...seq('pspVelocities', Array(20).fill(300)) });
    expect(r2(r.cfm)).toBe(r2(P)); // 1687.0
    expect(r2(r.cfmPerFt)).toBe(r2(P / 8));
    expect(r.k).toBe(0.88);
  });
  it('an N/A reading is skipped in the average (avg 310 of 19)', () => {
    const vals: (number | string)[] = Array(20).fill(300);
    vals[0] = 'N/A';
    vals[1] = 490;
    const r = pspCfm({ pspLength: 96, pspWidth: 12, pspBlanks: 1, ...seq('pspVelocities', vals) });
    expect(r2(r.cfm)).toBe(r2((310 * 92 * 12 * 0.88) / 144));
    expect(r.readings).toBe(19);
  });
  it('a wide plenum uses K 0.95', () => {
    const r = pspCfm({ pspLength: 120, pspWidth: 18, pspBlanks: 0, ...seq('pspVelocities', [400, 420]) });
    expect(r.cfm).toBeCloseTo((410 * 118 * 18 * 0.95) / 144, 9);
  });
});

describe('MAU filter grid (Supply Filter (VelGrid), K 1.35)', () => {
  it('16" x 20" at 400 + 12" x 24" at 300 -> MAUs C67 / D67 / E68', () => {
    const rows = [
      { table: 'filterGrid', order: 1, data: { size: '16" x 20"', velocity: 400 } },
      { table: 'filterGrid', order: 2, data: { size: '12" x 24"', velocity: 300 } },
      { table: 'filterGrid', order: 3, data: { size: 'N/A', velocity: 500 } },
    ];
    const g = filterGridCfm(rows);
    expect(g.perFilter.map(r2)).toEqual([r2(400 * 1.75 * 1.35), r2(300 * 1.52 * 1.35), null]);
    expect(r2(g.total)).toBe(r2(400 * 1.75 * 1.35 + 300 * 1.52 * 1.35));
  });
  it('a pair without constants gives 0 like the workbook', () => {
    expect(filterCfm('Supply Filter (VelGrid)', '24" x 24"', 400)).toBe(0); // H45 template quirk
  });
});

describe('MAU burner profile pressure (restored curve, linear interpolation)', () => {
  it('housing 1 at 0.175 -> (697.15 + 805.62) / 2 (MAUs K71)', () => {
    expect(r4(profileCfm(1, 0.175).cfm)).toBe(r4((697.15 + 805.62) / 2));
  });
  it('housing 2 at 0.65 -> 6589.5 (MAUs K1007)', () => {
    expect(profileCfm(2, 0.65).cfm).toBe(6589.5);
  });
  it('curve points for all housing sizes (functional test section D)', () => {
    const exp: Record<number, [number, number]> = {
      1: [697.15, 805.62],
      2: [2035.5, 2400],
      3: [1740.9, 1908.9],
      4: [3037.188, 3537.504],
      5: [4212.45, 9500],
    };
    for (const [h, [a, b]] of Object.entries(exp)) {
      expect(r4(profileCfm(Number(h), 0.15).cfm)).toBe(a);
      expect(r4(profileCfm(Number(h), 0.2).cfm)).toBe(b);
    }
    expect(r4(profileCfm(3, 0.3).cfm)).toBe(4036.2);
    expect(r4(profileCfm(5, 0.35).cfm)).toBe(17008.5);
  });
  it('range warnings outside 0.15-0.65 in. w.g.', () => {
    expect(profileCfm(1, 0.1)).toEqual({ cfm: null, warning: 'too low' });
    expect(profileCfm(1, 0.7)).toEqual({ cfm: null, warning: 'too high' });
    expect(profileCfm('N/A', 0.3).cfm).toBeNull();
  });
});

describe('MAU totals', () => {
  it('design = override, actual = the chosen method total (MAUs K9 / L9 / E75)', () => {
    const P = (300 * 92 * 12 * 0.88) / 144;
    const v = {
      method: 'PSP',
      designCfmOverride: 2100,
      pspLength: 96,
      pspWidth: 12,
      pspBlanks: 1,
      ...seq('pspVelocities', Array(20).fill(300)),
    };
    const rows = [{ table: 'supply', order: 1, data: { ak: 1.5, designCfm: 280, finalVel: 200 } }];
    const t = mauTotals(v, rows);
    expect(t.design).toBe(2100);
    expect(r2(t.methodTotal)).toBe(r2(P));
    expect(r2(t.actual)).toBe(r2(P));
    const outlets = mauTotals({ ...v, method: 'Outlets', designCfmOverride: null }, rows);
    expect(outlets).toMatchObject({ design: 280, actual: 300, methodTotal: null });
    expect(mauTotals({ method: 'Profile Pressure', profileHousing: 2, profilePressure: 0.65 }, []).actual).toBe(6589.5);
  });
});

describe('hoods', () => {
  const h1 = (filterType = 'Captrate (VelGrid)') => {
    const rows = [177, 187, 183, 175, 162].map((v, i) => ({
      table: 'filters',
      order: i + 1,
      data: { size: '16" x 20"', final1: v } as Record<string, number | string>,
    }));
    rows[0].data = { ...rows[0].data, init1: 170, init2: 180, init3: 175 };
    rows[2].data = { ...rows[2].data, final1: 180, final2: 183, final3: 186 };
    return hoodTotals({ filterType, designCfm: 2000, lengthFt: 8 }, rows);
  };
  it('5 x 16" x 20" Captrate -> 2049.2888 CFM (Hoods F22), % and CFM/ft', () => {
    const t = h1();
    expect(r4(t.final)).toBe(2049.2888);
    expect(r4(t.ratio)).toBe(r4(2049.2888 / 2000));
    expect(r2(t.finalPerFt)).toBe(r2(2049.2888 / 8));
    expect(t.rows[0]).toMatchObject({ initialVel: 175, finalVel: 177 });
    expect(r2(t.rows[0].finalCfm)).toBe(r2(177 * 1.73 * 1.34));
    expect(r2(t.initial)).toBe(r2(175 * 1.73 * 1.34)); // Hoods D22
  });
  it('Airfoil filters: 3 readings averaged, K 1; No Filter rows give 0; unknown pair gives 0', () => {
    const t = hoodTotals({ filterType: 'Condensate Baffle (Airfoil)', designCfm: 500 }, [
      { table: 'filters', order: 1, data: { size: '16" x 20"', final1: 900, final2: 910, final3: 920 } },
      { table: 'filters', order: 2, data: { size: 'No Filter', final1: 100 } },
      { table: 'filters', order: 3, data: { size: '24" x 24"', final1: 800 } },
    ]);
    expect(t.rows.map((r) => r2(r.finalCfm))).toEqual([r2(910 * 0.196), 0, 0]);
    expect(r2(t.final)).toBe(r2(910 * 0.196));
  });
});

describe('traverses (NEBB equal-area layout from the Traverses sheet)', () => {
  const t1 = { shape: 'Rectangular', width: 24, height: 12, liner: 0, designCfm: 1000 };
  const readings12 = Array.from({ length: 12 }, (_, i) => 480 + i * 4);
  it('24" x 12" rectangular: size, Ak 2.0, 4 x 3, positions 3/9/15/21, depths 2/6/10', () => {
    const l = traverseLayout(t1);
    expect(l).toMatchObject({ sizeText: '24" x 12"', ak: 2, nW: 4, nH: 3, points: 12, layoutText: '4 x 3' });
    expect(l.positions).toEqual([3, 9, 15, 21]);
    expect(l.depths).toEqual([2, 6, 10]);
  });
  it('12 quick-entry readings -> Final VEL 502, CFM 1004 (Traverses L7 / M7)', () => {
    const t = traverseTotals({ ...t1, ...seq('readings', readings12) });
    expect(t).toMatchObject({ finalVel: 502, finalCfm: 1004, used: 12 });
    expect(t.ratio).toBeCloseTo(1.004);
  });
  it('an N/A reading is skipped; readings past the point count are not averaged', () => {
    const vals: (number | string)[] = [...readings12, 999];
    vals[1] = 'N/A';
    const t = traverseTotals({ ...t1, ...seq('readings', vals) });
    const avg = Math.round((readings12.reduce((a, b) => a + b, 0) - 484) / 11);
    expect(t.finalVel).toBe(avg);
    expect(t.finalCfm).toBe(Math.round(avg * 2));
    expect(t.entered).toBe(12);
  });
  it('10" round: Ak, 8 x 2 axes, positions 0.3 ... 9.7, average 610 (Traverses H22 / M24 / D25 / K25 / L22)', () => {
    const readings = [...Array(8).fill(600), ...Array(8).fill(620)];
    const t = traverseTotals({ shape: 'Round', width: 10, ...seq('readings', readings) });
    expect(t.ak).toBe(roundXL((Math.PI * 25) / 144, 3));
    expect(t.layoutText).toBe('8 x 2 axes');
    expect(t.positions[0]).toBe(roundXL(5 * (1 - Math.sqrt(7 / 8)), 1));
    expect(t.positions[7]).toBe(roundXL(10 - 5 * (1 - Math.sqrt(7 / 8)), 1));
    expect(t.positions).toHaveLength(8);
    expect(t.finalVel).toBe(610);
    expect(t.finalCfm).toBe(roundXL(610 * t.ak!, 0));
  });
  it('point counts: < 12" = 2 per axis, else ceil(L / 6) (3-10 across, 3-8 down); round 6 / 8 / 10', () => {
    expect(traverseLayout({ shape: 'Rectangular', width: 10, height: 8 }).layoutText).toBe('2 x 2');
    expect(traverseLayout({ shape: 'Rectangular', width: 80, height: 60 }).layoutText).toBe('10 x 8');
    expect(traverseLayout({ shape: 'Round', width: 8 }).nW).toBe(6);
    expect(traverseLayout({ shape: 'Round', width: 16 }).nW).toBe(10);
    expect(traverseLayout({ shape: 'Rectangular', width: 24, height: 12, liner: 1 }).ak).toBe(
      roundXL((22 * 10) / 144, 3),
    );
  });
  it('initial CFM = ROUND(VEL x Ak)', () => {
    expect(traverseTotals({ ...t1, initialVel: 490 }).initialCfm).toBe(980);
  });
});

describe('Building Balance', () => {
  it('OA side: RTU OA rows, MAU totals, ERV supply; exhaust: fans, ERV exhaust, small fans 1-30', () => {
    const b = sampleBundle();
    const bb = buildingBalance(b.equipment, b.rows);
    // RTU-1 OA design 200 (final Not Acc.) + MAU-1..4 designs 2100 + 1500 + 6500 + 800 (override / outlets)
    // + ERV supply 1000
    expect(bb.oaDesign).toBe(200 + 2100 + 1500 + 6500 + 800 + 1000);
    // EF-2 600 + ERV exhaust 950 + EF-S1 110 + EF-S21 90 (EF-1 has no rows)
    expect(bb.exhaustDesign).toBe(600 + 950 + 110 + 90);
    expect(bb.designBalance).toBe(bb.oaDesign! - bb.exhaustDesign!);
  });
});
