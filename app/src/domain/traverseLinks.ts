/**
 * A traverse linked to what it measures: a unit (`traverseOf`, the unit's id) and optionally one airflow line of it
 * (`traverseLine`, the line's id: a ducted return, the OA intake, one outlet). App-only (the workbook's Traverses
 * sheet has the area served only, which the export fills from the link when it is blank).
 *
 * A linked line follows the traverse: its size, Ak and velocities (initial and final) are the traverse's, so the line's
 * CFM (VEL x Ak) is the traverse CFM. The app keeps them in step (lineSync) and shows them read-only on the line.
 */
import type { Equipment, FieldValue } from '../data/types';
import { traverseTotals } from './equipmentCalcs';
import type { RowName } from './rowLabels';

type Unit = Pick<Equipment, 'id' | 'type' | 'designation' | 'data'>;

const id = (v: FieldValue | undefined) => (typeof v === 'string' && v ? v : null);
export const traverseOf = (t: Pick<Equipment, 'data'>) => id(t.data.traverseOf);
export const traverseLine = (t: Pick<Equipment, 'data'>) => id(t.data.traverseLine);

/** The traverses of each unit and of each line (ids), in designation order. */
export function traverseLinks<T extends Unit>(
  units: readonly T[],
): { byUnit: Map<string, T[]>; byLine: Map<string, T[]> } {
  const byUnit = new Map<string, T[]>();
  const byLine = new Map<string, T[]>();
  const traverses = units
    .filter((u) => u.type === 'traverse')
    .sort((a, b) => a.designation.localeCompare(b.designation, undefined, { numeric: true }));
  for (const t of traverses) {
    const u = traverseOf(t);
    if (!u) continue;
    byUnit.set(u, [...(byUnit.get(u) ?? []), t]);
    const l = traverseLine(t);
    if (l) byLine.set(l, [...(byLine.get(l) ?? []), t]);
  }
  return { byUnit, byLine };
}

/** "RTU-3 · OA (Outside air)", "RTU-3", or null when not linked (or the unit is gone). */
export function traverseLinkLabel(
  t: Pick<Equipment, 'data'>,
  units: readonly Unit[],
  names: ReadonlyMap<string, RowName>,
): string | null {
  const u = units.find((x) => x.id === traverseOf(t));
  if (!u) return null;
  const line = traverseLine(t);
  const n = line ? names.get(line) : undefined;
  return n ? `${u.designation} · ${n.long}` : u.designation;
}

/** The values a linked line takes from the traverse (only what the traverse has). */
export function lineFromTraverse(t: Pick<Equipment, 'data'>): Record<string, number | string> {
  const r = traverseTotals(t.data);
  const out: Record<string, number | string> = {};
  if (r.sizeText) out.size = r.sizeText;
  if (r.ak) out.ak = r.ak;
  if (typeof t.data.initialVel === 'number') out.initialVel = t.data.initialVel;
  if (r.finalVel !== null) out.finalVel = r.finalVel;
  return out;
}

/** The line fields a traverse sets. */
export const LINKED_KEYS = ['size', 'ak', 'initialVel', 'finalVel'] as const;

/**
 * The changes (record paths) that bring a linked line in step with its traverse; empty when it already is, or while the
 * traverse has no velocity yet (the line keeps what it has until the traverse is read). A velocity the traverse no
 * longer has is cleared on the line.
 */
export function lineSync(
  t: Pick<Equipment, 'data'>,
  row: { data: Readonly<Record<string, FieldValue>> },
): Record<string, number | string | null> {
  const v = lineFromTraverse(t);
  if (v.initialVel === undefined && v.finalVel === undefined) return {};
  const out: Record<string, number | string | null> = {};
  for (const k of LINKED_KEYS) {
    const want = v[k] ?? (k === 'initialVel' || k === 'finalVel' ? null : undefined);
    if (want === undefined) continue;
    const have = row.data[k] ?? null;
    if (have !== want) out[`data.${k}`] = want;
  }
  return out;
}
