/**
 * A unit's scope from a schedule (pure): new, existing (to remain, relocated, reused) or removed (remove and cap,
 * demolished, abandoned). Removed units are left out of the import and the report; existing units are imported and
 * reported, with full data or airflow only (airflowOnlySections: the sections marked N/A).
 *
 *   scopeOf(text, 'column')  a scope / status column: "NEW", "EXISTING", "E", "(E)", "EXISTING TO BE REMOVED", ...
 *   scopeOf(text, 'cell')    any other cell of the row: only unmistakable phrases ("REMOVE AND CAP",
 *                            "EXISTING TO REMAIN"), so a service "EXISTING KITCHEN" or a note "REPLACES EXISTING EF-3"
 *                            does not change the row
 *   designationScope()       "(E) RTU-5" / "(N) EF-2": the scope prefix and the bare designation
 */
import type { EquipmentTypeKey } from './equipmentTypes';
import { getSpec } from './specs';

export type UnitScope = 'new' | 'existing' | 'removed';

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9()&]+/g, ' ')
    .trim();

/** Removed wins over existing ("EXISTING TO BE REMOVED"); a replacement is new ("NEW, REPLACES EXISTING"). */
export function scopeOf(
  text: string | number | null | undefined,
  where: 'column' | 'cell' = 'column',
): UnitScope | null {
  if (text === null || text === undefined || typeof text === 'number') return null;
  const t = norm(text);
  if (!t) return null;
  const strongRemoved =
    /\bremoved?\s*(and|&)\s*cap(ped)?\b/.test(t) ||
    /\b(to be|be|being)\s+(removed|demolished|abandoned|replaced)\b/.test(t) ||
    /\b(demo|demolish|demolished|abandon|abandoned)\b/.test(t) ||
    /^(removed?|removal)$/.test(t);
  const strongExisting =
    /\b(existing|exist|ex)\s+(to\s+)?remain\b/.test(t) ||
    /\bto remain\b/.test(t) ||
    /^\(e\)/.test(t) ||
    /\b(reuse|reused|relocate|relocated)\b/.test(t);
  if (where === 'cell') {
    if (strongRemoved) return 'removed';
    if (strongExisting && !/\b(replaces?|replacing|replacement)\b/.test(t)) return 'existing';
    return null;
  }
  if (strongRemoved) return 'removed';
  if (/\b(removed|replaced|remove)\b/.test(t) && !/\b(new|replaces|replacement|replacing)\b/.test(t)) return 'removed';
  if (/\b(new|replaces?|replacement|replacing)\b/.test(t) || /^(n|\(n\))$/.test(t)) return 'new';
  if (strongExisting || /\b(existing|exist|exst|ex)\b/.test(t) || /^(e|\(e\))$/.test(t)) return 'existing';
  if (/^(r|d|\(r\)|\(d\))$/.test(t)) return 'removed';
  return null;
}

/** "(E) RTU-5" -> existing RTU-5; "(N) EF-2" -> new EF-2; "(R) EF-17" / "(D) EF-17" -> removed. */
export function designationScope(designation: string): { designation: string; scope: UnitScope | null } {
  const m = /^\s*\(([ENRD])\)\s*(.+)$/i.exec(designation);
  if (!m) return { designation, scope: null };
  const k = m[1].toUpperCase();
  return { designation: m[2].trim(), scope: k === 'E' ? 'existing' : k === 'N' ? 'new' : 'removed' };
}

/**
 * The sections an airflow-only unit does not need: every section that is neither airflow nor has an airflow field
 * (unit data, motor, drive, misc., RPM, static profile). Identity, design data, photos and remarks stay.
 */
export function airflowOnlySections(type: EquipmentTypeKey): string[] {
  const keep = new Set(['identity', 'design', 'photos', 'remarks']);
  return getSpec(type)
    .sections.filter((s) => !keep.has(s.key) && !s.locked && !s.airflow && !s.fields.some((f) => f.airflow))
    .map((s) => s.key);
}
