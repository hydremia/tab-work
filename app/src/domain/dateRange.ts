/**
 * A TAB date range for the field sheets' Date header: the days on site, short form ("10/2-5/26", "9/30-10/3/26",
 * "12/30/26-1/2/27"). The workbook's Date cell ({Project Information} E11) is only displayed, so the range is written
 * there as text; the app keeps the first day (`tabDate`, which the calibration checks use) and the last
 * (`tabDateEnd`).
 */
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const parts = (iso: string) => {
  const m = ISO.exec(iso);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
};

/** The range text, or null when there is no range (no last day, not dates, or the last day is not after the first). */
export function formatDateRange(start: unknown, end: unknown): string | null {
  if (typeof start !== 'string' || typeof end !== 'string' || !(end > start)) return null;
  const a = parts(start);
  const b = parts(end);
  if (!a || !b) return null;
  const yy = (y: number) => String(y % 100).padStart(2, '0');
  if (a.y !== b.y) return `${a.m}/${a.d}/${yy(a.y)}-${b.m}/${b.d}/${yy(b.y)}`;
  if (a.m !== b.m) return `${a.m}/${a.d}-${b.m}/${b.d}/${yy(b.y)}`;
  return `${a.m}/${a.d}-${b.d}/${yy(b.y)}`;
}

const RANGE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\s*[-–]\s*(?:(\d{1,2})\/)?(\d{1,2})\/(\d{2}|\d{4})$/;

/** Whether a text is a date range as formatDateRange writes it (or typed in Excel the same way). */
export const isDateRange = (s: unknown): s is string => typeof s === 'string' && RANGE.test(s.trim());

/** First and last day (ISO) of a range text, or null. */
export function parseDateRange(s: unknown): { start: string; end: string } | null {
  if (typeof s !== 'string') return null;
  const m = RANGE.exec(s.trim());
  if (!m) return null;
  const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  const endY = year(m[6]);
  const startM = Number(m[1]);
  const endM = m[4] ? Number(m[4]) : startM;
  // no year on the first day: the last day's year, or the one before when the range crosses New Year
  const startY = m[3] ? year(m[3]) : startM > endM ? endY - 1 : endY;
  const iso = (y: number, mo: number, d: number) => {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  const start = iso(startY, startM, Number(m[2]));
  const end = iso(endY, endM, Number(m[5]));
  return start && end && end > start ? { start, end } : null;
}
