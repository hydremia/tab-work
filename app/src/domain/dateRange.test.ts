import { describe, expect, it } from 'vitest';
import { formatDateRange, isDateRange, parseDateRange } from './dateRange';

describe('TAB date range', () => {
  it('formats the days on site short, as the field sheets show them', () => {
    expect(formatDateRange('2026-10-02', '2026-10-05')).toBe('10/2-5/26');
    expect(formatDateRange('2026-09-30', '2026-10-03')).toBe('9/30-10/3/26');
    expect(formatDateRange('2026-12-30', '2027-01-02')).toBe('12/30/26-1/2/27');
    expect(formatDateRange('2026-10-02', '2026-10-02')).toBeNull();
    expect(formatDateRange('2026-10-02', null)).toBeNull();
    expect(formatDateRange('2026-10-05', '2026-10-02')).toBeNull();
  });

  it('reads them back (also as typed in Excel)', () => {
    for (const [s, e] of [
      ['2026-10-02', '2026-10-05'],
      ['2026-09-30', '2026-10-03'],
      ['2026-12-30', '2027-01-02'],
    ])
      expect(parseDateRange(formatDateRange(s, e))).toEqual({ start: s, end: e });
    expect(parseDateRange('10/2 – 10/5/2026')).toEqual({ start: '2026-10-02', end: '2026-10-05' });
    expect(parseDateRange('12/30-1/2/27')).toEqual({ start: '2026-12-30', end: '2027-01-02' });
    expect(parseDateRange('10/2/2026')).toBeNull();
    expect(parseDateRange('2/30-31/26')).toBeNull();
    expect(isDateRange('10/2-5/26')).toBe(true);
    expect(isDateRange('10/2/26')).toBe(false);
  });
});
