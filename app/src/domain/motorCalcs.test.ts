import { describe, expect, it } from 'vitest';
import { motorCalc, motorWarnings, serviceFactor, type MotorInputs } from './motorCalcs';

const m = (x: Partial<MotorInputs>): MotorInputs => ({
  voltage: 460,
  phase: '3-phase',
  fla: 7.6,
  volts: [470, 465, 468],
  amps: [6, 6.1, 5.9],
  ...x,
});

describe('motor data: corrected FLA and estimated BHP (D / G at P+14)', () => {
  it('revision 04/05 functional test RTU-1 (3-phase)', () => {
    const c = motorCalc(m({}));
    expect(c.correctedFla!).toBeCloseTo((460 / ((470 + 465 + 468) / 3)) * 7.6, 12);
    expect(c.bhp!).toBeCloseTo((((470 + 465 + 468) / 3) * ((6 + 6.1 + 5.9) / 3) * 0.8 * 0.9 * 1.732) / 746, 12);
    expect(c.avgVolts!).toBeCloseTo(467.6667, 4);
    expect(c.avgAmps!).toBeCloseTo(6, 12);
  });

  it('export spike expectations: RTU-1 4.7213, RTU-2 (1-phase) 3.2311', () => {
    const r1 = motorCalc(m({ fla: 4.8, volts: [468, 465, 470], amps: [3.9, 4.1, 4.0] }));
    expect(r1.correctedFla!).toBeCloseTo(4.721311, 6);
    const r2 = motorCalc({
      voltage: 208,
      phase: '1-phase',
      fla: 3.2,
      volts: [206, 'N/A', 'N/A'],
      amps: [2.7, 'N/A', 'N/A'],
    });
    expect(r2.correctedFla!).toBeCloseTo(3.2311, 4);
    expect(r2.bhp!).toBeCloseTo((0.8 * 0.9 * 206 * 2.7) / 746, 12);
  });

  it('revision 05 notations: a Not Acc. volts leg and an N/A amps leg are skipped by the averages', () => {
    const c = motorCalc(m({ volts: [470, 'Not Acc.', 468], amps: ['N/A', 6.1, 5.9] }));
    expect(c.correctedFla!).toBeCloseTo((460 / 469) * 7.6, 12);
    expect(c.bhp!).toBeCloseTo((469 * 6.0 * 0.8 * 0.9 * 1.732) / 746, 12);
    expect([c.voltsLegs, c.ampsLegs]).toEqual([2, 2]);
  });

  it('revision 05 RTU-2 (1-phase): L1 volts Not Acc. -> corrected FLA from leg 2, BHP blank', () => {
    const c = motorCalc({
      voltage: 208,
      phase: '1-phase',
      fla: 5,
      volts: ['Not Acc.', 206, null],
      amps: [4.2, null, null],
    });
    expect(c.correctedFla!).toBeCloseTo((208 / 206) * 5, 12);
    expect(c.bhp).toBeNull();
  });

  it('blanks: FLA / rated voltage N/A or blank, L1 volts blank, no amps', () => {
    expect(motorCalc(m({ fla: 'N/A' })).correctedFla).toBeNull();
    expect(motorCalc(m({ fla: null })).correctedFla).toBeNull();
    expect(motorCalc(m({ voltage: 'Not Avail.' })).correctedFla).toBeNull();
    expect(motorCalc(m({ voltage: null })).correctedFla).toBeNull();
    // quirk: a blank L1 blanks the corrected FLA even with L2 / L3 read
    expect(motorCalc(m({ volts: [null, 465, 468] })).correctedFla).toBeNull();
    expect(motorCalc(m({ volts: ['N/A', 'N/A', 'N/A'] })).correctedFla).toBeNull(); // COUNT = 0
    expect(motorCalc(m({ amps: [null, 'N/A', null] })).bhp).toBeNull();
    expect(motorCalc(m({ volts: [null, null, null] })).bhp).toBeNull();
    expect(motorCalc(m({ volts: [0, 0, 0] })).correctedFla).toBeNull(); // the sheet shows #DIV/0!
  });

  it('phase: "1-phase" compared case-insensitively; blank or anything else uses the 3-phase formula', () => {
    expect(motorCalc(m({ phase: '1-PHASE' })).onePhase).toBe(true);
    const blank = motorCalc(m({ phase: null }));
    expect(blank.onePhase).toBe(false);
    expect(blank.bhp!).toBeCloseTo(motorCalc(m({})).bhp!, 12);
    // quirk: 1-phase with L1 blank but L2 read -> the blank L1 counts as 0 -> BHP 0
    expect(motorCalc(m({ phase: '1-phase', volts: [null, 206, null], amps: [3, null, null] })).bhp).toBe(0);
  });
});

describe('motor field checks', () => {
  it('service factor text', () => {
    expect(serviceFactor('SF 1.15')).toBe(1.15);
    expect(serviceFactor('SF')).toBeNull();
    expect(serviceFactor('N/A')).toBeNull();
    expect(serviceFactor(null)).toBeNull();
    expect(serviceFactor(1.25)).toBe(1.25);
  });

  it('amps above corrected FLA x SF, BHP above nameplate HP', () => {
    const inp = m({ fla: 4.8, volts: [468, 465, 470], amps: [3.9, 4.1, 5.8] });
    const c = motorCalc(inp);
    const w = motorWarnings(c, inp, 'SF 1.15', 5);
    expect(w.map((x) => x.key)).toEqual(['amps']);
    expect(w[0].text).toContain('L3 5.8 A');
    expect(w[0].text).toContain('corrected FLA');
    expect(motorWarnings(c, inp, 'SF 1.25', 5)).toEqual([]); // 4.72 x 1.25 = 5.9
    expect(motorWarnings(c, inp, null, 5)[0].text).toContain('1.0 assumed');
    expect(motorWarnings(c, inp, 'SF 1.25', 2).map((x) => x.key)).toEqual(['bhp']); // BHP 3.6 > 2 HP
    // no corrected FLA (rated voltage N/A): falls back to the nameplate FLA
    const nv = { ...inp, voltage: 'N/A' };
    expect(motorWarnings(motorCalc(nv), nv, 'SF 1.0', 5)[0].text).toContain('above FLA × SF');
  });
});
