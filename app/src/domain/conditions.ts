import { UNIT_TYPE_COMPONENTS } from '@a2b/workbook/map';
import type { FieldValue } from '../data/types';
import type { Cond } from './specs/types';

export const isBlank = (v: FieldValue | undefined): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * The standard packaged-unit profile has 3 taps: entering (return / first component), fan inlet (entered as the
 * leaving static of the last component before the fan) and discharge (leaving the fan). With spTaps = "3-point" the
 * other components' leaving statics are not measured.
 */
export const THREE_POINT = '3-point';
export function tapSkipped(n: number, values: Readonly<Record<string, FieldValue>>): boolean {
  if (values.spTaps !== THREE_POINT || n >= 5) return false;
  const ut = values.unitType;
  const comps = typeof ut === 'string' ? UNIT_TYPE_COMPONENTS[ut] : undefined;
  if (!comps || comps[n - 1] === null) return false;
  const lastBeforeFan = [0, 1, 2, 3].filter((i) => comps[i] !== null).pop();
  return lastBeforeFan !== undefined && n - 1 !== lastBeforeFan;
}

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
  if ('tapSkipped' in c) return tapSkipped(c.tapSkipped, values);
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
