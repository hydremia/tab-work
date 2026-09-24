import { UNIT_TYPE_COMPONENTS } from '@a2b/workbook/map';
import type { FieldValue } from '../data/types';
import type { Cond } from './specs/types';

export const isBlank = (v: FieldValue | undefined): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Evaluate a spec condition against a unit's field values. */
export function evalCond(c: Cond, values: Readonly<Record<string, FieldValue>>): boolean {
  if ('any' in c) return c.any.some((x) => evalCond(x, values));
  if ('all' in c) return c.all.every((x) => evalCond(x, values));
  if ('not' in c) return !evalCond(c.not, values);
  if ('componentAbsent' in c) {
    const ut = values.unitType;
    const comps = typeof ut === 'string' ? UNIT_TYPE_COMPONENTS[ut] : undefined;
    return comps ? comps[c.componentAbsent - 1] === null : false;
  }
  const v = values[c.field];
  if ('eq' in c) return v === c.eq;
  if ('in' in c) return v !== null && v !== undefined && c.in.includes(v);
  if ('notIn' in c) return v === null || v === undefined || !c.notIn.includes(v);
  if ('blank' in c) return isBlank(v);
  if ('blankOrZero' in c) return isBlank(v) || v === 0 || v === '0';
  if ('matches' in c) return !isBlank(v) && new RegExp(c.matches, 'i').test(String(v));
  if ('notMatches' in c) return isBlank(v) || !new RegExp(c.notMatches, 'i').test(String(v));
  return false;
}
