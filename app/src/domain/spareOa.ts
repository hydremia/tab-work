/**
 * Building Balance: the 20 spare manual outside-air rows (rows 67-86 under the units: B unit / source, C:D design
 * CFM, E:F actual CFM; included in the OA totals of row 87). Stored as project fields `info.bbOa<n>Unit`,
 * `info.bbOa<n>Design`, `info.bbOa<n>Actual` (n = 1..20, the workbook row n - 1 of the block), so they sync, diff and
 * re-import like the other project fields (each value can carry an N/A mark). All optional.
 */
import type { FieldValue, Project } from '../data/types';
import { isBlank } from './conditions';

export const SPARE_OA_ROWS = 20;
export const SPARE_OA_FIRST_ROW = 67;

export type SpareOaColumn = 'Unit' | 'Design' | 'Actual';
export const SPARE_OA_COLUMNS: readonly SpareOaColumn[] = ['Unit', 'Design', 'Actual'];

export const spareOaKey = (n: number, col: SpareOaColumn) => `bbOa${n}${col}`;

export const SPARE_OA_INFO_KEYS: readonly string[] = Array.from({ length: SPARE_OA_ROWS }, (_, i) =>
  SPARE_OA_COLUMNS.map((c) => spareOaKey(i + 1, c)),
).flat();

const COL_LABEL: Record<SpareOaColumn, string> = { Unit: 'unit / source', Design: 'design CFM', Actual: 'actual CFM' };

export const SPARE_OA_LABELS: Record<string, string> = Object.fromEntries(
  Array.from({ length: SPARE_OA_ROWS }, (_, i) =>
    SPARE_OA_COLUMNS.map((c) => [spareOaKey(i + 1, c), `Other OA row ${i + 1}: ${COL_LABEL[c]}`]),
  ).flat(),
);

/** A spare row's cell: its value, else its N/A notation, else null. */
export function spareOaCell(project: Pick<Project, 'info' | 'naState'>, n: number, col: SpareOaColumn): FieldValue {
  const k = spareOaKey(n, col);
  const v = project.info[k];
  if (!isBlank(v)) return v ?? null;
  return project.naState.fields[k]?.notation ?? null;
}

/** Row n has anything (value or N/A mark). */
export function spareOaRowUsed(project: Pick<Project, 'info' | 'naState'>, n: number): boolean {
  return SPARE_OA_COLUMNS.some((c) => spareOaCell(project, n, c) !== null);
}

/** How many rows to show: through the last used row. */
export function spareOaUsedCount(project: Pick<Project, 'info' | 'naState'>): number {
  for (let n = SPARE_OA_ROWS; n >= 1; n--) if (spareOaRowUsed(project, n)) return n;
  return 0;
}

/** Numeric sums of the spare rows (text / N/A skipped, as the workbook's SUM does). */
export function spareOaTotals(project: Pick<Project, 'info'>): { design: number; actual: number } {
  let design = 0;
  let actual = 0;
  for (let n = 1; n <= SPARE_OA_ROWS; n++) {
    const d = project.info[spareOaKey(n, 'Design')];
    const a = project.info[spareOaKey(n, 'Actual')];
    if (typeof d === 'number') design += d;
    if (typeof a === 'number') actual += a;
  }
  return { design, actual };
}
