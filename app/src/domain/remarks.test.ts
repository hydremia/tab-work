import { describe, expect, it } from 'vitest';
import { appendNotes, isScratchLine, scratchLines } from './remarks';

describe('working notes in the remarks', () => {
  it('finds the working math (the Capitola MAU remarks) and leaves real remarks alone', () => {
    expect(scratchLines('23x18 x2 = 2.875 (2)\n516 = 1484\n644 = 1852\n\n3336')).toEqual([
      '23x18 x2 = 2.875 (2)',
      '516 = 1484',
      '644 = 1852',
      '3336',
    ]);
    expect(scratchLines('25 x 12 = 2.08 intake')).toHaveLength(1);
    expect(scratchLines('initial readings \n253, 227,1\n57, 304')).toEqual(['253, 227,1', '57, 304']);
    for (const ok of [
      'EF-12 serving the Seafood Service had no dampers and was balanced for total flow.',
      'VFD set to 60 Hz.',
      'Belt replaced; sheave set to 3 turns open.',
      'Final settings: 61% fan speed',
      'Outlets 1-4 balanced to within 10%.',
    ])
      expect(isScratchLine(ok)).toBe(false);
    expect(scratchLines(null)).toEqual([]);
  });

  it('moving the remarks appends them to the field notes', () => {
    expect(appendNotes(undefined, ' 516 = 1484 ')).toBe('516 = 1484');
    expect(appendNotes('earlier\n', '516 = 1484')).toBe('earlier\n\n516 = 1484');
  });
});
