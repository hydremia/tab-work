import { describe, expect, it } from 'vitest';
import { suggestedDeficiencies } from './issues';

const unit = (id: string, designation: string, extra: Record<string, unknown> = {}) => ({
  id,
  designation,
  isExisting: false,
  data: {},
  ...extra,
});
const flag = (rowId: string, label: string, ratio: number) => ({ table: 'outlets', rowId, label, ratio });

describe('suggested deficiencies', () => {
  const units = [unit('a', 'EF-12', { data: { remarks: 'No dampers.' } }), unit('b', 'RTU-2', { isExisting: true })];
  const completions = new Map([
    ['a', { outOfTolerance: [flag('r1', 'Registers / grilles 1', 0.63), flag('r2', 'Registers / grilles 2', 1.28)] }],
    ['b', { outOfTolerance: [flag('r3', 'Supply outlets S-4', 0.8)] }],
  ]);

  it('one per unit out of tolerance, pre-filled; one line: linked to the line', () => {
    const s = suggestedDeficiencies(units, completions, [], 0.1);
    expect(s.map((x) => [x.designation, x.kind, x.airflowRowId, x.hasRemark])).toEqual([
      ['EF-12', 'new', null, true],
      ['RTU-2', 'existing', 'r3', false],
    ]);
    expect(s[0].remark).toBe(
      'Registers / grilles 1 at 63 % and Registers / grilles 2 at 128 % of design, outside the ±10 % tolerance.',
    );
  });

  it('an issue on the unit, on every flagged line, or a dismissal takes the unit off', () => {
    expect(suggestedDeficiencies(units, completions, [{ equipmentId: 'a', airflowRowId: null }], 0.1)).toHaveLength(1);
    const oneLine = suggestedDeficiencies(units, completions, [{ equipmentId: 'a', airflowRowId: 'r1' }], 0.1);
    expect(oneLine[0].remark).toMatch(/^Registers \/ grilles 2 at 128 %/);
    expect(oneLine[0].airflowRowId).toBe('r2');
    expect(suggestedDeficiencies(units, completions, [], 0.1, new Set(['a', 'b']))).toEqual([]);
  });
});
