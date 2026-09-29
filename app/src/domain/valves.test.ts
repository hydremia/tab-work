import { describe, expect, it } from 'vitest';
import type { LibraryValve } from '../data/types';
import { cvAt, formatCvTable, parseCvTable, valveFlow } from './valves';

const base: LibraryValve = {
  id: 'v',
  make: 'Test',
  model: 'CBV',
  size: '1"',
  valveType: 'A',
  cvTable: [
    { setting: 0, cv: 0.5 },
    { setting: 2, cv: 1.5 },
    { setting: 4, cv: 3.5 },
  ],
  ratedGpm: null,
  dpMin: null,
  dpMax: null,
  source: 'test data (not a real valve)',
  notes: '',
  createdAt: 0,
  updatedAt: 0,
};

describe('balancing valve flow (library)', () => {
  it('Cv by setting: exact rows, linear between rows, nothing outside the table', () => {
    expect(cvAt(base, 2)).toBe(1.5);
    expect(cvAt(base, 3)).toBeCloseTo(2.5, 9);
    expect(cvAt(base, 5)).toBeNull();
    expect(cvAt(base, null)).toBeNull();
    expect(cvAt({ valveType: 'F', cvTable: [{ setting: null, cv: 2 }] }, null)).toBe(2);
  });

  it('GPM = Cv × √ΔP psi; ft w.g. converted', () => {
    expect(valveFlow(base, 2, 4, 'psi').gpm).toBeCloseTo(3, 9); // 1.5 × 2
    expect(valveFlow(base, 2, 9.24, 'ft w.g.').gpm).toBeCloseTo(3, 9); // 9.24 ft = 4 psi
    expect(valveFlow(base, null, 4, 'psi')).toMatchObject({ gpm: null, note: 'enter the setting' });
    expect(valveFlow(base, 2, null, 'psi')).toMatchObject({ gpm: null, note: 'enter the ΔP' });
    expect(valveFlow(base, 9, 4, 'psi')).toMatchObject({ gpm: null, note: 'setting outside the Cv table' });
  });

  it('self-adjusting: the tag flow inside the ΔP range, none outside', () => {
    const s: LibraryValve = { ...base, valveType: 'S', cvTable: null, ratedGpm: 7.5, dpMin: 2, dpMax: 32 };
    expect(valveFlow(s, null, 5, 'psi').gpm).toBe(7.5);
    expect(valveFlow(s, null, 1, 'psi').gpm).toBeNull();
    expect(valveFlow(s, null, null, 'psi').gpm).toBe(7.5);
  });

  it('Cv table text round-trips', () => {
    expect(parseCvTable('0 0.5\n2, 1.5\n\nx y\n4=3.5')).toEqual(base.cvTable);
    expect(parseCvTable('2.4')).toEqual([{ setting: null, cv: 2.4 }]);
    expect(formatCvTable(base.cvTable)).toBe('0 0.5\n2 1.5\n4 3.5');
  });
});
