import { describe, expect, it } from 'vitest';
import { espDiscrepancy, staticProfile, text2, unitTypeRow } from './staticProfile';

const close = (a: number | null, b: number) => {
  expect(a).not.toBeNull();
  expect(a!).toBeCloseTo(b, 10);
};

describe('static-pressure profile strip (RTUs / MAUs / ERVs / Fans rows P+19 ... P+25)', () => {
  it('unit-type table: labels, inlet, "—" for absent components; unknown type gives "" labels (IFERROR)', () => {
    expect(unitTypeRow('RTU')).toEqual({
      known: true,
      inlet: 'RA / OA',
      labels: ['Filter', '—', 'Coil', 'Heat', 'Fan'],
    });
    expect(unitTypeRow('doas').labels).toEqual(['Filter', 'Wheel', 'Coil', 'Heat', 'Fan']); // MATCH ignores case
    expect(unitTypeRow('EF').labels).toEqual(['—', '—', '—', '—', 'Fan']);
    expect(unitTypeRow('N/A')).toEqual({ known: false, inlet: '', labels: ['', '', '', '', ''] });
    expect(unitTypeRow(null).known).toBe(false);
  });

  it('revision 04/05 functional test, RTU-1: -0.3 / -0.5 / (—) / -0.7 / (heat blank) / 0.9', () => {
    const p = staticProfile({ unitType: 'RTU', entering: -0.3, leaving: [-0.5, null, -0.7, null, 0.9] });
    expect(p.entering).toEqual([-0.3, -0.5, -0.5, -0.7, -0.7]); // D24 = E24 = -0.5, G24 = -0.7
    expect(p.dpText[0]).toBe('Δ -0.20'); // D28
    expect(p.dp[1]).toBeNull(); // wheel "—"
    close(p.dp[2], -0.2); // coil
    expect(p.dp[3]).toBeNull(); // heat: leaving blank
    close(p.tsp, 1.6); // E29
    close(p.esp, 1.2); // I29 = L12 unit ESP actual
    close(p.unitDp, -0.4); // M29
  });

  it('revision 04/05 functional test, EF: the fan inlet passes through the four absent components', () => {
    const p = staticProfile({ unitType: 'EF', entering: -0.5, leaving: [null, null, null, null, 0.3] });
    expect(p.entering[4]).toBe(-0.5);
    close(p.tsp, 0.8);
    close(p.esp, 0.8);
    close(p.unitDp, 0);
    expect(p.dp.slice(0, 4)).toEqual([null, null, null, null]);
    close(p.dp[4], 0.8);
  });

  it('revision 05 RTU-3: a notation as a leaving static is passed on as text, blanking the fan TSP and unit ΔP', () => {
    const p = staticProfile({ unitType: 'RTU', entering: -0.3, leaving: [-0.5, null, 'Not Acc.', null, 0.9] });
    expect(p.entering[3]).toBe('Not Acc.'); // F232 heat entering shows Not Acc.
    expect(p.entering[4]).toBe('Not Acc.');
    expect(p.dp[2]).toBeNull(); // H236 coil ΔP blank
    expect(p.dp[3]).toBeNull();
    expect(p.tsp).toBeNull(); // E237
    close(p.esp, 1.2); // I237
    expect(p.unitDp).toBeNull(); // M237
  });

  it('revision 05 Fans: inlet static N/A blanks TSP (fan entering is N/A) and ESP', () => {
    const p = staticProfile({ unitType: 'EF', entering: 'N/A', leaving: [null, null, null, null, 0.4] });
    expect(p.tsp).toBeNull();
    expect(p.esp).toBeNull();
    expect(p.unitDp).toBeNull();
  });

  it('an "N/A" in an absent component would blank everything downstream (why the export leaves it blank)', () => {
    const na = staticProfile({ unitType: 'MAU', entering: -0.2, leaving: [-0.35, 'N/A', -0.6, 'N/A', 0.55] });
    expect([na.tsp, na.unitDp, na.dp[2]]).toEqual([null, null, null]);
    close(na.esp, 0.75);
    const blank = staticProfile({ unitType: 'MAU', entering: -0.2, leaving: [-0.35, null, -0.6, null, 0.55] });
    close(blank.dp[2], -0.25); // burner
    close(blank.tsp, 1.15);
    close(blank.unitDp, -0.4);
  });

  it('a value typed into an absent component still feeds the next entering static (as the sheet does)', () => {
    const p = staticProfile({ unitType: 'RTU', entering: -0.3, leaving: [-0.5, -0.6, -0.7, null, 0.9] });
    expect(p.entering[2]).toBe(-0.6);
    expect(p.dp[1]).toBeNull(); // but its own ΔP stays blank ("—")
    close(p.dp[2], -0.1);
  });

  it('negative ESP / TSP and blank chains', () => {
    const p = staticProfile({ unitType: 'DOAS', entering: 0.1, leaving: [-0.2, -0.4, -0.6, -0.65, -0.3] });
    close(p.tsp, 0.35);
    close(p.esp, -0.4);
    close(p.unitDp, -0.75);
    expect(p.dpText).toEqual(['Δ -0.30', 'Δ -0.20', 'Δ -0.20', 'Δ -0.05', 'Δ 0.35']);
    const none = staticProfile({ unitType: 'RTU', entering: null, leaving: [null, null, null, null, 0.5] });
    expect([none.tsp, none.esp, none.unitDp]).toEqual([null, null, null]);
    expect(none.entering).toEqual([null, null, null, null, null]);
    // unknown unit type: no component is "—", every ΔP is calculated
    const unk = staticProfile({ unitType: 'XYZ', entering: -0.1, leaving: [-0.2, -0.3, null, null, 0.4] });
    expect(unk.dp.map((d) => (d === null ? null : Math.round(d * 100) / 100))).toEqual([-0.1, -0.1, null, null, 0.7]);
  });

  it('TEXT(x, "0.00") rounding', () => {
    expect(text2(-0.2)).toBe('-0.20');
    expect(text2(0.125)).toBe('0.13');
    expect(text2(1.005)).toBe('1.01');
    expect(text2(-0.004)).toBe('0.00');
  });

  it('ESP vs design unit ESP outside the tolerance', () => {
    expect(espDiscrepancy(0.8, 1.07, 0.1)).toMatchObject({ design: 0.8, actual: 1.07 });
    expect(espDiscrepancy(1.0, 1.1, 0.1)).toBeNull(); // 110 % is inside ±10 %
    expect(espDiscrepancy('N/A', 1.07, 0.1)).toBeNull();
    expect(espDiscrepancy(0.8, null, 0.1)).toBeNull();
    expect(espDiscrepancy(0, 0.5, 0.1)).toBeNull();
  });
});
