/**
 * Motor data of the big unit sheets (RTUs / MAUs / ERVs / Fans), replicating the revision 07 formulas (identical on
 * every block of the four sheets; P = block anchor):
 *
 *   B(P+13) rated voltage = EDE voltage,  C(P+13) phase = EDE phase,  E(P+13) FLA,  D(P+12) scheduled HP = EDE HP,
 *   E:G(P+15) measured volts L1-L3,  E:G(P+16) measured amps L1-L3,  E(P+17) nameplate motor HP (rev 07)
 *
 *   D(P+14) Corrected FLA =
 *     IF(OR(E19="", E17="", B17=""), "",
 *        IF(OR(ISTEXT(B17), COUNT(E19:G19)=0, ISTEXT(E17)), "", B17 / AVERAGE(E19:G19) * E17))
 *   G(P+14) Estimated BHP (rev 07) = HP x average measured amps / FLA:
 *     HP  = IF(N(E21)>0, E21, N(D16))         the nameplate HP when entered, else the scheduled HP
 *     FLA = IF(N(D18)>0, D18, N(E17))         the corrected FLA when it can be calculated, else the nameplate FLA
 *     IF(OR(COUNT(E20:G20)=0, HP=0, FLA=0), "", HP * AVERAGE(E20:G20) / FLA)
 *   (revisions 05 / 06: V x A x 0.8 x 0.9 (x 1.732 3-phase) / 746; the fixed PF x efficiency put a motor at its FLA
 *   above its nameplate HP, the ratio lands on the nameplate HP at FLA)
 *
 * Quirks kept on purpose (they are what the report prints):
 *  - corrected FLA needs volts L1: a blank L1 gives blank even when L2 / L3 are read (a notation in L1 is fine:
 *    AVERAGE skips it and uses the other legs);
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
  /** Nameplate motor HP (rev 07 E P+17). */
  motorHp?: XCell;
  /** Scheduled HP, EDE G. */
  hp?: XCell;
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
  /** The HP and FLA the BHP used (null when it could not be estimated). */
  bhpHp: { value: number; nameplate: boolean } | null;
  bhpFla: { value: number; corrected: boolean } | null;
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

  // HP x avg amps / FLA (N() of a blank or a notation is 0, so it falls back)
  const plate = xlNum(m.motorHp ?? null) ?? 0;
  const hpN = plate > 0 ? plate : (xlNum(m.hp ?? null) ?? 0);
  const flaN = correctedFla !== null && correctedFla > 0 ? correctedFla : (xlNum(m.fla) ?? 0);
  const ok = ampsLegs > 0 && hpN !== 0 && flaN !== 0;
  const bhp = ok ? (hpN * avgAmps!) / flaN : null;
  return {
    onePhase,
    avgVolts,
    avgAmps,
    voltsLegs,
    ampsLegs,
    correctedFla,
    bhp,
    bhpHp: ok ? { value: hpN, nameplate: plate > 0 } : null,
    bhpFla: ok ? { value: flaN, corrected: correctedFla !== null && correctedFla > 0 } : null,
  };
}

/** Motor inputs from a unit's cell values (keys of the template map). */
export function motorInputs(cells: Readonly<Record<string, XCell>>): MotorInputs {
  return {
    voltage: cells.voltage,
    phase: cells.phase,
    fla: cells.fla,
    volts: [cells.volts1, cells.volts2, cells.volts3],
    amps: [cells.amps1, cells.amps2, cells.amps3],
    motorHp: cells.motorHp,
    hp: cells.hp,
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
  key: 'amps' | 'hp';
  text: string;
}

/**
 * Warnings (not blocking): a measured amps leg above corrected FLA x SF (nameplate FLA when the corrected FLA can't
 * be calculated; SF 1.0 when none is given), and a nameplate HP that differs from the scheduled one. (An estimated BHP
 * above the HP is the same check as amps above FLA since revision 07's HP x amps / FLA, so it has no warning of its
 * own.)
 */
export function motorWarnings(
  calc: MotorCalc,
  m: MotorInputs,
  sf: FieldValue | undefined,
  hp: FieldValue | undefined,
  designHp?: FieldValue,
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
  const designN = xlNum(designHp ?? null);
  if (designHp !== undefined && hpN !== null && designN !== null && Math.abs(hpN - designN) > 1e-9) {
    out.push({ key: 'hp', text: `Motor nameplate ${fmt(hpN, 2)} HP vs. scheduled ${fmt(designN, 2)} HP.` });
  }
  return out;
}

const fmt = (x: number, d: number) => x.toLocaleString('en-US', { maximumFractionDigits: d });
