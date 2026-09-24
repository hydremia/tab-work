/**
 * Live calculations that mirror the workbook's formulas (the workbook stays authoritative; the export writes
 * inputs only). Outlet rows: CFM = VEL x Ak (cols J / L), % = CFM / design, using Final when present, else Initial.
 */
import type { FieldValue } from '../data/types';

export function num(v: FieldValue | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export interface RowLike {
  data: Record<string, FieldValue>;
}

export function rowCfm(row: RowLike, reading: 'initial' | 'final'): number | null {
  const vel = num(row.data[reading === 'initial' ? 'initialVel' : 'finalVel']);
  const ak = num(row.data.ak);
  return vel === null || ak === null ? null : vel * ak;
}

/** Actual CFM of a row: Final when present, otherwise Initial (as the workbook's % column). */
export function rowActualCfm(row: RowLike): number | null {
  return rowCfm(row, 'final') ?? rowCfm(row, 'initial');
}

/** Actual / design as a fraction (1 = 100 %), or null when either is missing or design is 0. */
export function ratio(actual: number | null, design: number | null): number | null {
  if (actual === null || design === null || design === 0) return null;
  return actual / design;
}

export function rowRatio(row: RowLike): number | null {
  return ratio(rowActualCfm(row), num(row.data.designCfm));
}

/** Inside ±tolerance (fraction, 0.1 = ±10 %) of design. A tiny epsilon keeps 110.0 % inside ±10 %. */
export function withinTolerance(r: number, tolerance: number): boolean {
  return Math.abs(r - 1) <= tolerance + 1e-9;
}

export interface TableTotals {
  design: number;
  actual: number;
  /** Rows with a reading. */
  readings: number;
  ratio: number | null;
}

export function tableTotals(rows: readonly RowLike[]): TableTotals {
  let design = 0;
  let actual = 0;
  let readings = 0;
  for (const r of rows) {
    design += num(r.data.designCfm) ?? 0;
    const a = rowActualCfm(r);
    if (a !== null) {
      actual += a;
      readings++;
    }
  }
  return { design, actual, readings, ratio: readings ? ratio(actual, design) : null };
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatPercent(r: number | null): string {
  return r === null ? '—' : `${(r * 100).toFixed(0)} %`;
}
