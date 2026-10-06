import { describe, expect, it } from 'vitest';
import { designVel } from './calc';
import { motorCalc, motorWarnings, serviceFactor, type MotorInputs } from './motorCalcs';

const m = (x: Partial<MotorInputs>): MotorInputs => ({
  voltage: 460,
  phase: '3-phase',
  fla: 7.6,
  volts: [470, 465, 468],
  amps: [6, 6.1, 5.9],
  hp: 5,
  ...x,
});

describe('motor data: corrected FLA and estimated BHP (D / G at P+14)', () => {
  it('corrected FLA (unchanged since revision 04); BHP = HP x avg amps / corrected FLA (revision 07)', () => {
    const c = motorCalc(m({}));
    const cfla = (460 / ((470 + 465 + 468) / 3)) * 7.6;
    expect(c.correctedFla!).toBeCloseTo(cfla, 12);
    expect(c.bhp!).toBeCloseTo((5 * 6) / cfla, 12);
    expect(c.bhpHp).toEqual({ value: 5, nameplate: false });
    expect(c.bhpFla!.corrected).toBe(true);
    expect(c.avgVolts!).toBeCloseTo(467.6667, 4);
    expect(c.avgAmps!).toBeCloseTo(6, 12);
  });

  it('a motor at its FLA estimates its HP (the old 0.8 x 0.9 put it above)', () => {
    const c = motorCalc(m({ voltage: 460, volts: [460, 460, 460], fla: 7.6, amps: [7.6, 7.6, 7.6], motorHp: 5 }));
    expect(c.bhp!).toBeCloseTo(5, 12);
  });

  it('the nameplate HP when entered (a notation or 0 falls back to the scheduled HP)', () => {
    expect(motorCalc(m({ motorHp: 7.5 })).bhpHp).toEqual({ value: 7.5, nameplate: true });
    expect(motorCalc(m({ motorHp: 'N/A' })).bhpHp).toEqual({ value: 5, nameplate: false });
    expect(motorCalc(m({ motorHp: 0 })).bhpHp).toEqual({ value: 5, nameplate: false });
    expect(motorCalc(m({ motorHp: null, hp: 'N/A' })).bhp).toBeNull();
  });

  it('the nameplate FLA when the corrected FLA cannot be calculated', () => {
    const c = motorCalc(m({ voltage: 'N/A' }));
    expect(c.correctedFla).toBeNull();
    expect(c.bhp!).toBeCloseTo((5 * 6) / 7.6, 12);
    expect(c.bhpFla).toEqual({ value: 7.6, corrected: false });
    expect(motorCalc(m({ voltage: 'N/A', fla: 'Not Avail.' })).bhp).toBeNull();
  });

  it('export spike: RTU-1 corrected FLA 4.7213; 1-phase RTU-2 3.2311 (BHP from amps L1)', () => {
    const r1 = motorCalc(m({ fla: 4.8, volts: [468, 465, 470], amps: [3.9, 4.1, 4.0] }));
    expect(r1.correctedFla!).toBeCloseTo(4.721311, 6);
    const r2 = motorCalc({
      voltage: 208,
      phase: '1-phase',
      fla: 3.2,
      volts: [206, 'N/A', 'N/A'],
      amps: [2.7, 'N/A', 'N/A'],
      hp: 0.5,
    });
    expect(r2.correctedFla!).toBeCloseTo(3.2311, 4);
    expect(r2.bhp!).toBeCloseTo((0.5 * 2.7) / r2.correctedFla!, 12);
  });

  it('notations: a Not Acc. volts leg and an N/A amps leg are skipped by the averages', () => {
    const c = motorCalc(m({ volts: [470, 'Not Acc.', 468], amps: ['N/A', 6.1, 5.9] }));
    expect(c.correctedFla!).toBeCloseTo((460 / 469) * 7.6, 12);
    expect(c.bhp!).toBeCloseTo((5 * 6.0) / ((460 / 469) * 7.6), 12);
    expect([c.voltsLegs, c.ampsLegs]).toEqual([2, 2]);
  });

  it('blanks: FLA / rated voltage N/A or blank, L1 volts blank, no amps', () => {
    expect(motorCalc(m({ fla: 'N/A' })).correctedFla).toBeNull();
    expect(motorCalc(m({ fla: null })).correctedFla).toBeNull();
    expect(motorCalc(m({ voltage: 'Not Avail.' })).correctedFla).toBeNull();
    expect(motorCalc(m({ voltage: null })).correctedFla).toBeNull();
    // quirk: a blank L1 blanks the corrected FLA even with L2 / L3 read (the BHP then uses the nameplate FLA)
    expect(motorCalc(m({ volts: [null, 465, 468] })).correctedFla).toBeNull();
    expect(motorCalc(m({ volts: [null, 465, 468] })).bhp!).toBeCloseTo((5 * 6) / 7.6, 12);
    expect(motorCalc(m({ volts: ['N/A', 'N/A', 'N/A'] })).correctedFla).toBeNull(); // COUNT = 0
    expect(motorCalc(m({ amps: [null, 'N/A', null] })).bhp).toBeNull();
    expect(motorCalc(m({ volts: [0, 0, 0] })).correctedFla).toBeNull(); // the sheet shows #DIV/0!
  });

  it('phase: "1-phase" compared case-insensitively (the BHP no longer depends on it)', () => {
    expect(motorCalc(m({ phase: '1-PHASE' })).onePhase).toBe(true);
    expect(motorCalc(m({ phase: null })).onePhase).toBe(false);
    expect(motorCalc(m({ phase: '1-phase' })).bhp!).toBeCloseTo(motorCalc(m({})).bhp!, 12);
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

  it('amps above corrected FLA x SF', () => {
    const inp = m({ fla: 4.8, volts: [468, 465, 470], amps: [3.9, 4.1, 5.8] });
    const c = motorCalc(inp);
    const w = motorWarnings(c, inp, 'SF 1.15', 5);
    expect(w.map((x) => x.key)).toEqual(['amps']);
    expect(w[0].text).toContain('L3 5.8 A');
    expect(w[0].text).toContain('corrected FLA');
    expect(motorWarnings(c, inp, 'SF 1.25', 5)).toEqual([]); // 4.72 x 1.25 = 5.9
    expect(motorWarnings(c, inp, null, 5)[0].text).toContain('1.0 assumed');
    // no corrected FLA (rated voltage N/A): falls back to the nameplate FLA
    const nv = { ...inp, voltage: 'N/A' };
    expect(motorWarnings(motorCalc(nv), nv, 'SF 1.0', 5)[0].text).toContain('above FLA × SF');
  });

  it('a nameplate HP that differs from the schedule is flagged', () => {
    const inp = m({ fla: 'Not Avail.' });
    const c = motorCalc(inp);
    expect(motorWarnings(c, inp, 'SF 1.25', 5, 5)).toEqual([]);
    const w = motorWarnings(c, inp, 'SF 1.25', 3, 5);
    expect(w.map((x) => x.key)).toEqual(['hp']);
    expect(w[0].text).toBe('Motor nameplate 3 HP vs. scheduled 5 HP.');
  });
});

describe('design velocity of a line', () => {
  it('design CFM ÷ Ak, before any reading', () => {
    expect(designVel({ data: { designCfm: 500, ak: 1.25 } })).toBe(400);
    expect(designVel({ data: { designCfm: 500, ak: null } })).toBeNull();
    expect(designVel({ data: { designCfm: null, ak: 1 } })).toBeNull();
    expect(designVel({ data: { ak: 0.5 } }, 300)).toBe(600); // first return row: the computed design
  });
});
