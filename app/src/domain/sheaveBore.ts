/**
 * Motor and fan shaft bores. Template revisions 05 / 06 have one "Shv Bore M/F" cell (sheaveBore) holding
 * "motor / fan"; the app keeps the motor bore (next to the motor sheave) and the fan bore (next to the fan pulley)
 * apart. An old single value is split on " / " (spaces around the slash, so a fraction such as 1-1/8 stays whole);
 * without that separator the whole value is taken as the motor bore.
 */
import type { FieldValue } from '../data/types';

export function splitSheaveBore(value: FieldValue | undefined): { motorBore: string; fanBore: string | null } | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).trim();
  if (!s) return null;
  const parts = s.split(/\s+\/\s+/);
  if (parts.length === 2) return { motorBore: parts[0].trim(), fanBore: parts[1].trim() || null };
  return { motorBore: s, fanBore: null };
}

/** The rev 05 / 06 cell: "motor / fan" ("—" for a missing side). */
export function joinSheaveBore(motor: string | null, fan: string | null): string | null {
  if (motor === null && fan === null) return null;
  if (motor !== null && motor === fan && /^(N\/A|Not )/i.test(motor)) return motor;
  return `${motor ?? '—'} / ${fan ?? '—'}`;
}
