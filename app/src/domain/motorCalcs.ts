/**
 * Motor data of the big unit sheets (RTUs / MAUs / ERVs / Fans), replicating the revision 05 formulas (identical on
 * every block of the four sheets; P = block anchor):
 *
 *   B(P+13) rated voltage = EDE voltage,  C(P+13) phase = EDE phase,  E(P+13) FLA,
 *   E:G(P+15) measured volts L1-L3,  E:G(P+16) measured amps L1-L3
 *
 *   D(P+14) Corrected FLA =
 *     IF(OR(E19="", E17="", B17=""), "",
 *        IF(OR(ISTEXT(B17), COUNT(E19:G19)=0, ISTEXT(E17)), "", B17 / AVERAGE(E19:G19) * E17))
 *   G(P+14) Estimated BHP =
 *     IF(OR(COUNT(E19:G19)=0, COUNT(E20:G20)=0), "",
 *        IF(C17="1-phase", IF(OR(ISTEXT(E19), ISTEXT(E20)), "", 0.8*0.9*E19*E20/746),
 *           AVERAGE(E19:G19) * AVERAGE(E20:G20) * 0.8*0.9*1.732/746))
 *
 * Quirks kept on purpose (they are what the report prints):
 *  - corrected FLA needs volts L1: a blank L1 gives blank even when L2 / L3 are read (a notation in L1 is fine:
 *    AVERAGE skips it and uses the other legs);
 *  - the 1-phase BHP uses L1 only; a blank L1 counts as 0 there (BHP 0) when another leg holds the COUNT;
 *  - any phase other than "1-phase" (compared case-insensitively), including a blank phase, uses the 3-phase formula;
 *  - the service factor is not used by any formula (only by the app's amps check below).
 */
import type { FieldValue } from '../data/types';
import { xlBlank, xlNum, xlText, type XCell } from './staticProfile';

export interface MotorInputs {
  /** Rated (schedule) voltage, EDE N. */
  voltage: XCell;
  /** Phase, EDE O ("1-phase" / "3-phase"). */
  phase: XCell;
  /** Nameplate FLA. */
  fla: XCell;
  volts: readonly XCell[];
  amps: readonly XCell[];
}

export interface MotorCalc {
  onePhase: boolean;
  /** AVERAGE of the numeric legs (what the formulas use for 3-phase and corrected FLA). */
  avgVolts: number | null;
  avgAmps: number | null;
  voltsLegs: number;
  ampsLegs: number;
  /** D(P+14), null where the sheet shows blank (also where it would show #DIV/0!: volts average 0). */
  correctedFla: number | null;
  /** G(P+14) */
  bhp: number | null;
}

const average = (xs: readonly XCell[]) => {
  const n = xs.map(xlNum).filter((x): x is number => x !== null);
  return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
};
const count = (xs: readonly XCell[]) => xs.filter((x) => xlNum(x) !== null).length;

export function motorCalc(m: MotorInputs): MotorCalc {
  const volts = [0, 1, 2].map((i) => m.volts[i]);
  const amps = [0, 1, 2].map((i) => m.amps[i]);
  const avgVolts = average(volts);
  const avgAmps = average(amps);
  const voltsLegs = count(volts);
  const ampsLegs = count(amps);
  const onePhase = typeof m.phase === 'string' && m.phase.toLowerCase() === '1-phase';

  let correctedFla: number | null = null;
  if (!(xlBlank(volts[0]) || xlBlank(m.fla) || xlBlank(m.voltage))) {
    if (!(xlText(m.voltage) || voltsLegs === 0 || xlText(m.fla))) {
      const v = xlNum(m.voltage);
      const f = xlNum(m.fla);
      if (v !== null && f !== null && avgVolts) correctedFla = (v / avgVolts) * f;
    }
  }

  let bhp: number | null = null;
  if (voltsLegs > 0 && ampsLegs > 0) {
    if (onePhase) {
      if (!(xlText(volts[0]) || xlText(amps[0]))) {
        const v1 = xlNum(volts[0]) ?? 0; // a blank cell is 0 in Excel arithmetic
        const a1 = xlNum(amps[0]) ?? 0;
        bhp = (0.8 * 0.9 * v1 * a1) / 746;
      }
    } else {
      bhp = (avgVolts! * avgAmps! * 0.8 * 0.9 * 1.732) / 746;
    }
  }
  return { onePhase, avgVolts, avgAmps, voltsLegs, ampsLegs, correctedFla, bhp };
}

/** Motor inputs from a unit's cell values (keys of the template map). */
export function motorInputs(cells: Readonly<Record<string, XCell>>): MotorInputs {
  return {
    voltage: cells.voltage,
    phase: cells.phase,
    fla: cells.fla,
    volts: [cells.volts1, cells.volts2, cells.volts3],
    amps: [cells.amps1, cells.amps2, cells.amps3],
  };
}

/** "SF 1.15" -> 1.15; blank, the "SF" placeholder or a notation -> null. */
export function serviceFactor(v: FieldValue | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  const m = typeof v === 'string' ? /^\s*(?:SF\s*)?(\d+(?:\.\d+)?)\s*$/i.exec(v) : null;
  return m ? Number(m[1]) : null;
}

// ------------------------------------------------------------------------------------------ field checks (app only)
export interface MotorWarning {
  key: 'amps' | 'bhp';
  text: string;
}

/**
 * Warnings (not blocking): a measured amps leg above corrected FLA x SF (nameplate FLA when the corrected FLA can't
 * be calculated; SF 1.0 when none is given), and an estimated BHP above the nameplate HP.
 */
export function motorWarnings(
  calc: MotorCalc,
  m: MotorInputs,
  sf: FieldValue | undefined,
  hp: FieldValue | undefined,
): MotorWarning[] {
  const out: MotorWarning[] = [];
  const factor = serviceFactor(sf);
  const base = calc.correctedFla ?? xlNum(m.fla);
  if (base !== null && base > 0) {
    const limit = base * (factor ?? 1);
    const over = m.amps
      .map((a, i) => ({ leg: i + 1, a: xlNum(a) }))
      .filter((x): x is { leg: number; a: number } => x.a !== null && x.a > limit + 1e-9);
    if (over.length) {
      const what = calc.correctedFla !== null ? 'corrected FLA' : 'FLA';
      out.push({
        key: 'amps',
        text:
          `Measured amps above ${what} × SF (${fmt(base, 2)} × ${factor ?? '1.0'}${factor === null ? ' assumed' : ''}` +
          ` = ${fmt(limit, 2)} A): ${over.map((x) => `L${x.leg} ${fmt(x.a, 2)} A`).join(', ')}.`,
      });
    }
  }
  const hpN = xlNum(hp ?? null);
  if (calc.bhp !== null && hpN !== null && hpN > 0 && calc.bhp > hpN + 1e-9) {
    out.push({ key: 'bhp', text: `Estimated BHP ${fmt(calc.bhp, 2)} is above the nameplate ${fmt(hpN, 2)} HP.` });
  }
  return out;
}

const fmt = (x: number, d: number) => x.toLocaleString('en-US', { maximumFractionDigits: d });
