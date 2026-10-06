/**
 * Unit remarks print on the report; field notes (`data.fieldNotes`) are the technician's working notes and never leave
 * the app. Working math typed into the remarks ("23x18 x2 = 2.875", "516 = 1484", a column of readings) is found here
 * so the Report check can point at it and the unit page can move it to the field notes.
 */

/** A remark line that reads as working math: a "number = number" step, or numbers and operators only. */
export function isScratchLine(line: string): boolean {
  const l = line.trim();
  if (!/\d/.test(l)) return false;
  if (/\d\s*["']?\s*=\s*-?\.?\d/.test(l)) return true;
  return /^[\d\s.,x×*/+\-()"'#%]+$/i.test(l);
}

/** The remark lines that read as working math. */
export function scratchLines(remarks: unknown): string[] {
  if (typeof remarks !== 'string') return [];
  return remarks.split(/\r?\n/).filter(isScratchLine);
}

/** Field notes with the remarks appended (a blank line between), for "Move to field notes". */
export function appendNotes(notes: unknown, remarks: string): string {
  const before = typeof notes === 'string' ? notes.trimEnd() : '';
  return before ? `${before}\n\n${remarks.trim()}` : remarks.trim();
}
