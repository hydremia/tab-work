/**
 * Static-pressure profile strip of the big unit sheets (RTUs / MAUs / ERVs / Fans, rows P+19 ... P+25), replicating
 * the revision 05 formulas cell by cell (read from the workbook, identical on every block of the four sheets):
 *
 *   C23:G23  component k   = INDEX({Dropdowns}!AI2:AN6, MATCH(unit type, AH2:AH6, 0), k+1)   ("" if no match)
 *   D24      entering k+1  = IF(lvg k="", IF(ent k="", "", ent k), lvg k)   (a blank leaving static passes the
 *                            entering static through: that is how an absent "—" component is skipped; a notation
 *                            such as N/A is passed on as text)
 *   C28      inlet static  = IF(C24="", "", C24);  E28, G28 ... leaving k = IF(OR(label k="—", lvg k=""), "", lvg k)
 *   D28 ...  ΔP k          = IF(OR(label k="—", ent k="", lvg k=""), "", IF(OR(ISTEXT(lvg k), ISTEXT(ent k)), "",
 *                            "Δ "&TEXT(lvg k - ent k, "0.00")))          (text, 2 decimals)
 *   E29      Fan TSP       = G25 - G24   (fan leaving - fan entering)
 *   I29      ESP           = G25 - C24   (fan leaving - unit entering) = "Unit ESP actual" (RTUs L12, MAUs/Fans L10)
 *   M29      Unit ΔP       = G24 - C24   (fan entering - unit entering)
 * each blank when either operand is blank, and blank when either is text (N/A, Not Avail., Not Acc.).
 *
 * Inputs are the cell values the export writes (see unitFieldCells in workbook/adapter.ts): numbers, notation text,
 * or null for a blank cell.
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

export interface StaticInputs {
  /** D(P+22) unit type (RTU, DOAS, MAU, ERV, EF). */
  unitType: XCell;
  /** C(P+20) entering static of the first component. */
  entering: XCell;
  /** C:G(P+21) leaving statics of components 1-5. */
  leaving: readonly XCell[];
}

export interface StaticProfile {
  /** Unit type found in the table (MATCH is case-insensitive); otherwise every label is "" (IFERROR). */
  known: boolean;
  /** B(P+23): inlet label, e.g. "RA / OA". */
  inlet: string;
  /** C:G(P+19): component labels, "—" when the component is absent on this unit type. */
  labels: string[];
  absent: boolean[];
  /** C:G(P+20): entering statics (C is the input, D:G the pass-through formulas). */
  entering: XCell[];
  leaving: XCell[];
  /**
   * Row P+24 statics: C = inlet (entering static of component 1), E / G / I / K / M = leaving static of components
   * 1-5 (blank for a "—" component). Text notations show as they are.
   */
  strip: XCell[];
  /** Numeric ΔP of each component (leaving - entering), null where the sheet shows blank. */
  dp: (number | null)[];
  /** The text the sheet prints, e.g. "Δ -0.20". */
  dpText: (string | null)[];
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
  if (!key) return { known: false, inlet: '', labels: ['', '', '', '', ''] };
  return {
    known: true,
    inlet: UNIT_TYPE_INLETS[key] ?? '',
    labels: UNIT_TYPE_COMPONENTS[key].map((c) => c ?? ABSENT),
  };
}

export function staticProfile(input: StaticInputs): StaticProfile {
  const { known, inlet, labels } = unitTypeRow(input.unitType);
  const leaving = Array.from({ length: 5 }, (_, i) => (xlBlank(input.leaving[i]) ? null : input.leaving[i]!));
  const entering: XCell[] = [xlBlank(input.entering) ? null : input.entering!];
  for (let k = 1; k < 5; k++) {
    const prevLvg = leaving[k - 1];
    const prevEnt = entering[k - 1];
    entering.push(xlBlank(prevLvg) ? (xlBlank(prevEnt) ? null : prevEnt) : prevLvg);
  }
  const dp = labels.map((label, k) => (label === ABSENT ? null : diff(leaving[k], entering[k])));
  return {
    known,
    inlet,
    labels,
    absent: labels.map((l) => l === ABSENT),
    entering,
    strip: [entering[0], ...labels.map((l, k) => (l === ABSENT ? null : leaving[k]))],
    leaving,
    dp,
    dpText: dp.map((d) => (d === null ? null : `Δ ${text2(d)}`)),
    tsp: diff(leaving[4], entering[4]),
    esp: diff(leaving[4], entering[0]),
    unitDp: diff(entering[4], entering[0]),
  };
}

/** Static-profile inputs from a unit's cell values (keys of the template map). */
export function staticInputs(cells: Readonly<Record<string, XCell>>): StaticInputs {
  return {
    unitType: cells.unitType,
    entering: cells.spEntering,
    leaving: [1, 2, 3, 4, 5].map((k) => cells[`spLeaving${k}`]),
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
