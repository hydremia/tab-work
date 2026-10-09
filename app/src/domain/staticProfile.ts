/**
 * Static-pressure profile of the big unit sheets (RTUs / MAUs / ERVs / Fans, rows P+19 ... P+25), replicating the
 * revision 08 formulas cell by cell (tools/build_rev08.py; the same on every block of the four sheets):
 *
 *   C19:H19   component k   = INDEX({Dropdowns}!AI2:AO7, MATCH(unit type, AH2:AH7, 0), k+1)   ("" if no match)
 *   B20       entering static (typed); C20:H20 leaving static of components 1-6 (typed), in airflow order
 *   Q20:V20   before k      = the reading just before component k: entering for k = 1, else IF(label k-1 = "—",
 *                             before k-1, reading k-1) (an absent component is skipped, an unread one leaves "")
 *   C21:H21   ΔP k          = IF(OR(label k="—", reading k="", before k=""), "", IF(OR(ISTEXT(..)), "",
 *                             "Δ "&TEXT(reading k - before k, "0.00")))
 *   P22:V22   the last reading at / before k (P: the entering static); Q21:V21 the first NUMBER at / after k
 *   W20       fan column    = IFERROR(MATCH("Fan", C19:H19, 0), "")
 *   X20       fan inlet     = INDEX(P22:U22, fan)          (the last reading before the fan; may be a notation)
 *   Y20       fan leaving   = INDEX(Q21:V21, fan)          (the fan's own number, else the next one: past a
 *                                                            blow-through heat section, the discharge)
 *   D23 / I23 fan inlet / discharge (V22, the last reading)
 *   E25       Fan TSP       = Y - X;  I25 ESP = discharge - entering ("Unit ESP actual");  M25 Unit ΔP = X - entering
 * each blank when an operand is blank, and blank when one is text (N/A, Not Avail., Not Acc.).
 *
 * Inputs are the cell values the export writes (see unitFieldCells in workbook/adapter.ts): numbers, notation text,
 * or null for a blank cell; the leaving statics by position (spLeaving1-6 of the revision 08 layout).
 */
import { UNIT_TYPE_COMPONENTS, UNIT_TYPE_INLETS } from '@a2b/workbook/map';
import type { FieldValue } from '../data/types';
import { roundXL } from './equipmentCalcs';

/** A worksheet cell as a formula sees it: number, text, or blank (null or ""). */
export type XCell = FieldValue | undefined;

/** Excel `cell=""`: TRUE for an empty cell and for a formula that returned "". */
export const xlBlank = (v: XCell): v is null | undefined | '' => v === null || v === undefined || v === '';
/** Excel ISTEXT on a non-blank cell. */
export const xlText = (v: XCell): v is string => typeof v === 'string' && v !== '';
/** A number the formula can do arithmetic on (not blank, not text). */
export const xlNum = (v: XCell): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The formula cell's absent-component marker ({Dropdowns} unit-type table). */
export const ABSENT = '—';
/** Components per unit type in the revision 08 table. */
export const SLOTS = 6;

export interface StaticInputs {
  /** D(P+22) unit type (RTU, DOAS, DHU, MAU, ERV, EF). */
  unitType: XCell;
  /** B(P+20) entering static. */
  entering: XCell;
  /** C:H(P+20) leaving statics of components 1-6. */
  leaving: readonly XCell[];
}

export interface StaticProfile {
  /** Unit type found in the table (MATCH is case-insensitive); otherwise every label is "" (IFERROR). */
  known: boolean;
  /** B(P+19): inlet label, e.g. "RA / OA". */
  inlet: string;
  /** C:H(P+19): component labels, "—" when the unit type has fewer components. */
  labels: string[];
  absent: boolean[];
  /** Q:V(P+20): the reading just before each component (its entering static when that was read). */
  entering: XCell[];
  /** C:H(P+20): the leaving statics. */
  leaving: XCell[];
  /** The entering static and the leaving static of each component (blank for a "—" component), as read. */
  strip: XCell[];
  /** Numeric ΔP of each component (reading - the reading just before it), null where the sheet shows blank. */
  dp: (number | null)[];
  /** The text the sheet prints, e.g. "Δ -0.20". */
  dpText: (string | null)[];
  /** D(P+23): the last reading before the fan (a notation shows as it is). */
  fanInlet: XCell;
  /** I(P+23): the last reading. */
  discharge: XCell;
  /** E(P+25) */
  tsp: number | null;
  /** I(P+25), also "Unit ESP actual" */
  esp: number | null;
  /** M(P+25) */
  unitDp: number | null;
}

const diff = (a: XCell, b: XCell): number | null => {
  // IF(OR(a="", b=""), "", IF(OR(ISTEXT(a), ISTEXT(b)), "", a - b))
  if (xlBlank(a) || xlBlank(b)) return null;
  const x = xlNum(a);
  const y = xlNum(b);
  return x === null || y === null ? null : x - y;
};

/** Excel TEXT(x, "0.00"): Excel rounds half away from zero on the 15-digit value. */
export function text2(x: number): string {
  const r = roundXL(x, 2);
  return (r === 0 ? 0 : r).toFixed(2);
}

export function unitTypeRow(unitType: XCell): { known: boolean; inlet: string; labels: string[] } {
  const key =
    typeof unitType === 'string'
      ? Object.keys(UNIT_TYPE_COMPONENTS).find((k) => k.toLowerCase() === unitType.trim().toLowerCase())
      : undefined;
  if (!key) return { known: false, inlet: '', labels: Array(SLOTS).fill('') };
  return {
    known: true,
    inlet: UNIT_TYPE_INLETS[key] ?? '',
    labels: UNIT_TYPE_COMPONENTS[key].map((c) => c ?? ABSENT),
  };
}

const cell = (v: XCell): XCell => (xlBlank(v) ? null : v);

export function staticProfile(input: StaticInputs): StaticProfile {
  const { known, inlet, labels } = unitTypeRow(input.unitType);
  const ent = cell(input.entering);
  const leaving = Array.from({ length: SLOTS }, (_, i) => cell(input.leaving[i]));
  // the reading just before component k ("—" skipped)
  const before: XCell[] = [];
  for (let k = 0; k < SLOTS; k++)
    before.push(k === 0 ? ent : labels[k - 1] === ABSENT ? before[k - 1] : leaving[k - 1]);
  const dp = labels.map((label, k) => (label === ABSENT ? null : diff(leaving[k], before[k])));
  // the last reading at / before k (index 0 = the entering static), the first number at / after k
  const lastAt: XCell[] = [ent];
  for (let k = 0; k < SLOTS; k++) lastAt.push(xlBlank(leaving[k]) ? lastAt[k] : leaving[k]);
  const firstNum: XCell[] = Array(SLOTS + 1).fill(null);
  for (let k = SLOTS - 1; k >= 0; k--)
    firstNum[k] = xlBlank(leaving[k]) || xlText(leaving[k]) ? firstNum[k + 1] : leaving[k];
  const fan = labels.findIndex((l) => l.toLowerCase() === 'fan');
  const fanInlet = fan < 0 ? null : lastAt[fan];
  const fanOut = fan < 0 ? null : firstNum[fan];
  const discharge = lastAt[SLOTS];
  return {
    known,
    inlet,
    labels,
    absent: labels.map((l) => l === ABSENT),
    entering: before,
    leaving,
    strip: [ent, ...labels.map((l, k) => (l === ABSENT ? null : leaving[k]))],
    dp,
    dpText: dp.map((d) => (d === null ? null : `Δ ${text2(d)}`)),
    fanInlet,
    discharge,
    tsp: diff(fanOut, fanInlet),
    esp: diff(discharge, ent),
    unitDp: diff(fanInlet, ent),
  };
}

/** Static-profile inputs from a unit's cell values (keys of the template map: positional, revision 08 layout). */
export function staticInputs(cells: Readonly<Record<string, XCell>>): StaticInputs {
  return {
    unitType: cells.unitType,
    entering: cells.spEntering,
    leaving: Array.from({ length: SLOTS }, (_, i) => cells[`spLeaving${i + 1}`]),
  };
}

// ------------------------------------------------------------------------------------------ ESP check (app only)
export interface EspCheck {
  design: number;
  actual: number;
  ratio: number;
}

/**
 * "Unit ESP actual" (the strip's ESP) vs. the schedule's design unit ESP, outside ±tolerance (a warning, not
 * blocking). Null when either is missing, the design is not positive, or the actual is within tolerance.
 */
export function espDiscrepancy(design: XCell, actual: number | null, tolerance: number): EspCheck | null {
  const d = xlNum(design);
  if (d === null || d <= 0 || actual === null) return null;
  const ratio = actual / d;
  return Math.abs(ratio - 1) > tolerance + 1e-9 ? { design: d, actual, ratio } : null;
}
