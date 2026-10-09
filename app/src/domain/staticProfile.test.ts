import { describe, expect, it } from 'vitest';
import { espDiscrepancy, staticProfile, text2, unitTypeRow } from './staticProfile';

const close = (a: number | null, b: number) => {
  expect(a).not.toBeNull();
  expect(a!).toBeCloseTo(b, 10);
};

/** The cases of tools/functional_test_rev08.py (LibreOffice-recalculated revision 08 workbook), cell by cell. */
describe('static-pressure profile (revision 08: RTUs / MAUs / ERVs / Fans rows P+19 ... P+25)', () => {
  it('unit-type table: labels, inlet, "—" for absent components; unknown type gives "" labels (IFERROR)', () => {
    expect(unitTypeRow('RTU')).toEqual({
      known: true,
      inlet: 'RA / OA',
      labels: ['Filter', 'Coil', 'Reheat', 'Fan', 'Heat', '—'],
    });
    expect(unitTypeRow('doas').labels).toEqual(['Filter', 'Wheel', 'Coil', 'Reheat', 'Fan', 'Heat']); // MATCH ignores case
    expect(unitTypeRow('DHU').labels).toEqual(['Filter', 'Coil', 'Desiccant', 'Fan', 'Heat', '—']);
    expect(unitTypeRow('EF').labels).toEqual(['Fan', '—', '—', '—', '—', '—']);
    expect(unitTypeRow('N/A')).toEqual({ known: false, inlet: '', labels: ['', '', '', '', '', ''] });
    expect(unitTypeRow(null).known).toBe(false);
  });

  it('RTU full profile: Δ per component, TSP across the blow-through heat section, ESP, Unit ΔP', () => {
    const p = staticProfile({ unitType: 'RTU', entering: -0.5, leaving: [-0.6, -0.9, -1.0, null, 0.5, null] });
    expect(p.dpText).toEqual(['Δ -0.10', 'Δ -0.30', 'Δ -0.10', null, null, null]);
    expect(p.fanInlet).toBe(-1.0);
    expect(p.discharge).toBe(0.5);
    close(p.tsp, 1.5);
    close(p.esp, 1.0); // I25 = L P+8 "Unit ESP actual"
    close(p.unitDp, -0.5);
    expect(p.strip).toEqual([-0.5, -0.6, -0.9, -1.0, null, 0.5, null]);
  });

  it('RTU 3-point (Capitola RTU-3): entering, coil leaving = fan inlet, heat leaving = discharge', () => {
    const p = staticProfile({ unitType: 'RTU', entering: -0.317, leaving: [null, -0.806, null, null, 0.514, null] });
    expect(p.dp).toEqual([null, null, null, null, null, null]); // no adjacent readings
    expect(p.fanInlet).toBe(-0.806);
    close(p.tsp, 1.32);
    close(p.esp, 0.831);
    close(p.unitDp, -0.489);
  });

  it('MAU (Capitola MAU-9), EF (the fan first), DOAS (6 components), DHU (desiccant after the coil)', () => {
    const mau = staticProfile({ unitType: 'MAU', entering: -0.355, leaving: [null, -0.921, 0.339, null, null, null] });
    expect(mau.dpText).toEqual([null, null, 'Δ 1.26', null, null, null]);
    close(mau.tsp, 1.26);
    close(mau.esp, 0.694);
    close(mau.unitDp, -0.566);
    const ef = staticProfile({ unitType: 'EF', entering: -0.2, leaving: [0.6, null, null, null, null, null] });
    close(ef.tsp, 0.8);
    close(ef.esp, 0.8);
    close(ef.unitDp, 0);
    const doas = staticProfile({ unitType: 'DOAS', entering: -0.3, leaving: [-0.4, -0.7, -1.1, -1.2, 0.9, 1.0] });
    expect(doas.dpText).toEqual(['Δ -0.10', 'Δ -0.30', 'Δ -0.40', 'Δ -0.10', 'Δ 2.10', 'Δ 0.10']);
    close(doas.tsp, 2.1); // the fan's own reading
    close(doas.esp, 1.3);
    close(doas.unitDp, -0.9);
    const dhu = staticProfile({ unitType: 'DHU', entering: -1.26, leaving: [-1.53, -2.35, -2.6, null, 0.572, null] });
    expect(dhu.fanInlet).toBe(-2.6);
    close(dhu.tsp, 0.572 + 2.6);
    close(dhu.esp, 0.572 + 1.26);
  });

  it('a notation at the fan inlet blanks TSP and Unit ΔP, not the ESP', () => {
    const p = staticProfile({ unitType: 'RTU', entering: -0.5, leaving: [null, 'Not Acc.', null, null, 0.5, null] });
    expect(p.fanInlet).toBe('Not Acc.');
    expect(p.tsp).toBeNull();
    expect(p.unitDp).toBeNull();
    close(p.esp, 1.0);
  });

  it('a fan leaving static marked Not Acc. (blow-through): TSP from the discharge, the heat Δ blank', () => {
    const p = staticProfile({ unitType: 'RTU', entering: -0.5, leaving: [-0.6, -0.9, null, 'Not Acc.', 0.5, null] });
    close(p.tsp, 1.4);
    expect(p.dp[4]).toBeNull();
  });

  it('an absent ("—") component is skipped for the Δ of the next one; an unread one leaves it blank', () => {
    // RTU without reheat: the fan's Δ is measured from the coil
    const p = staticProfile({ unitType: 'RTU', entering: -0.3, leaving: [-0.4, -0.8, null, 0.9, 1.0, null] });
    expect(p.dp[3]).toBeNull(); // reheat (not "—" on an RTU) is unread: the fan's Δ is blank
    close(p.tsp, 1.7); // fan inlet passes the unread reheat
    const ef = staticProfile({ unitType: 'EF', entering: -0.2, leaving: [0.6, 5, null, null, null, null] });
    expect(ef.dp[1]).toBeNull(); // a value typed into a "—" component shows no Δ
    close(ef.esp, 5.2); // ... but the sheet's last reading is still the discharge, as the formulas do
  });

  it('inlet static N/A blanks the ESP and Unit ΔP', () => {
    const p = staticProfile({ unitType: 'EF', entering: 'N/A', leaving: [0.3, null, null, null, null, null] });
    expect(p.esp).toBeNull();
    expect(p.tsp).toBeNull(); // the fan is first: its inlet is the entering static
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
