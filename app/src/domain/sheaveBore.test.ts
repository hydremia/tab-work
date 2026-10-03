import { describe, expect, it } from 'vitest';
import { joinSheaveBore, splitSheaveBore } from './sheaveBore';

describe('motor / fan bores', () => {
  it('splits the old "Sheave bore M/F" on " / " and keeps fractions whole', () => {
    expect(splitSheaveBore('1-1/8 / 1-7/16')).toEqual({ motorBore: '1-1/8', fanBore: '1-7/16' });
    expect(splitSheaveBore('7/8 / 1')).toEqual({ motorBore: '7/8', fanBore: '1' });
    expect(splitSheaveBore('1-3/8')).toEqual({ motorBore: '1-3/8', fanBore: null });
    expect(splitSheaveBore('')).toBeNull();
    expect(splitSheaveBore(null)).toBeNull();
  });

  it('joins them for the rev 05 / 06 cell', () => {
    expect(joinSheaveBore('7/8', '1')).toBe('7/8 / 1');
    expect(joinSheaveBore('7/8', null)).toBe('7/8 / —');
    expect(joinSheaveBore('N/A', 'N/A')).toBe('N/A');
    expect(joinSheaveBore(null, null)).toBeNull();
  });
});
