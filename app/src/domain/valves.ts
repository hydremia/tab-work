/**
 * Flow through a balancing valve from the shared library (data/types.ts LibraryValve, NEBB 9.3.3):
 *  - fixed orifice (F): GPM = Cv × √ΔP;
 *  - adjustable orifice (A): Cv at the setting (linear between the manufacturer's table rows; outside the table: no
 *    value, never extrapolated), then GPM = Cv × √ΔP;
 *  - self-adjusting (S): the tag flow while the ΔP is inside the valve's control range; outside it no flow value.
 * ΔP in psi; a reading in ft w.g. is converted (÷ 2.31, water; NEBB 9.3.2 warns about mixing units).
 */
import type { FieldValue, LibraryValve } from '../data/types';
import { FT_PER_PSI } from './hydronicCalcs';

export type DpUnits = 'psi' | 'ft w.g.';

export const toPsi = (dp: number, units: FieldValue | undefined): number =>
  units === 'ft w.g.' ? dp / FT_PER_PSI : dp;

/** Cv at a setting (adjustable) or the single Cv (fixed); null when the table does not cover it. */
export function cvAt(valve: Pick<LibraryValve, 'valveType' | 'cvTable'>, setting: number | null): number | null {
  const table = (valve.cvTable ?? []).filter((r) => Number.isFinite(r.cv));
  if (!table.length) return null;
  if (valve.valveType === 'F' || table.length === 1) return table[0].cv;
  if (setting === null) return null;
  const rows = table.filter((r) => r.setting !== null).sort((a, b) => a.setting! - b.setting!);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (setting === r.setting) return r.cv;
    const next = rows[i + 1];
    if (next && setting > r.setting! && setting < next.setting!)
      return r.cv + ((next.cv - r.cv) * (setting - r.setting!)) / (next.setting! - r.setting!);
  }
  return null;
}

export interface ValveFlow {
  gpm: number | null;
  /** Why there is no flow, or what it is based on (shown under the row). */
  note: string;
}

export function valveFlow(
  valve: LibraryValve,
  setting: FieldValue | undefined,
  dp: FieldValue | undefined,
  units: FieldValue | undefined,
): ValveFlow {
  const d = typeof dp === 'number' ? dp : null;
  const s = typeof setting === 'number' ? setting : null;
  if (valve.valveType === 'S') {
    if (valve.ratedGpm === null) return { gpm: null, note: 'no tag flow in the library entry' };
    if (d === null) return { gpm: valve.ratedGpm, note: 'tag flow (ΔP not read)' };
    const psi = toPsi(d, units);
    const inRange =
      (valve.dpMin === null || psi >= valve.dpMin - 1e-9) && (valve.dpMax === null || psi <= valve.dpMax + 1e-9);
    return inRange
      ? { gpm: valve.ratedGpm, note: `tag flow, ΔP ${psi.toFixed(1)} psi within range` }
      : {
          gpm: null,
          note: `ΔP ${psi.toFixed(1)} psi outside the control range ${valve.dpMin ?? '…'}–${valve.dpMax ?? '…'} psi`,
        };
  }
  if (d === null) return { gpm: null, note: 'enter the ΔP' };
  if (d < 0) return { gpm: null, note: 'negative ΔP' };
  const cv = cvAt(valve, s);
  if (cv === null)
    return {
      gpm: null,
      note: valve.valveType === 'A' && s === null ? 'enter the setting' : 'setting outside the Cv table',
    };
  const gpm = cv * Math.sqrt(toPsi(d, units));
  return { gpm, note: `Cv ${cv.toFixed(2)} × √${toPsi(d, units).toFixed(2)} psi` };
}

/** "B&G CB-1 1"" */
export const valveName = (v: Pick<LibraryValve, 'make' | 'model' | 'size'>): string =>
  [v.make, v.model, v.size].filter(Boolean).join(' ');

/** Parse "setting cv" lines ("0.5 1.2", "1, 1.9"; a single number = fixed-orifice Cv). */
export function parseCvTable(text: string): { setting: number | null; cv: number }[] {
  const out: { setting: number | null; cv: number }[] = [];
  for (const line of text.split(/\n/)) {
    const nums = line
      .split(/[\s,;:=]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map(Number);
    if (!nums.length || nums.some((n) => !Number.isFinite(n))) continue;
    if (nums.length === 1) out.push({ setting: null, cv: nums[0] });
    else out.push({ setting: nums[0], cv: nums[1] });
  }
  return out;
}

export const formatCvTable = (t: LibraryValve['cvTable']): string =>
  (t ?? []).map((r) => (r.setting === null ? `${r.cv}` : `${r.setting} ${r.cv}`)).join('\n');
