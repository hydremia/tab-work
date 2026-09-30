/**
 * Clean-up of words read by text recognition from drawings (pure). Only fixes that are safe on schedule text:
 *   - a cell of dashes ("--", "-—", "—") is the schedule's "none": blank (cleanOcrCell; a dash inside a cell stays);
 *   - stray "|" at a word's ends (a grid line read as a character) goes;
 *   - model numbers (letters and digits) in serif CAD fonts: "I1" is one "1" ("DUI180HFA" -> "DU180HFA",
 *     "CASREI13DD" -> "CASRE13DD"); an "I" between letters and digits is a "1" ("DRI0HFA" -> "DR10HFA"); an "O" next
 *     to a zero is the zero read twice ("DU180OHFA" -> "DU180HFA", "48GEHNO06" -> "48GEHN06");
 *   - "O" between digits is "0" ("1O0" -> "100"), in numbers only.
 * Everything OCR is unsure of stays as read and is flagged for checking (tableGrid LOW_CONF).
 */

export function cleanOcrWord(text: string): string {
  let t = text.replace(/^\|+|\|+$/g, '').trim();
  // a dash on its own is kept ("460 - 3"); a cell of dashes only is blanked by cleanOcrCell
  if (/^[-—–]+$/.test(t)) return '-';
  // model numbers: letters and digits, no spaces (serif CAD fonts)
  if (/[A-Z]/.test(t) && /\d/.test(t) && !/\s/.test(t)) {
    // "I1" / "l1" is one "1": DUI180HFA -> DU180HFA
    t = t.replace(/(?<=[A-Z])[Il](?=1\d)/g, '');
    // "I" / "l" between letters and digits is a "1": DUI80HFA -> DU180HFA, DRI0HFA -> DR10HFA
    t = t.replace(/(?<=[A-Z])[Il](?=\d)/g, '1');
    // an "O" next to a zero is the zero read twice: DU180OHFA -> DU180HFA, 48GEHNO06 -> 48GEHN06
    t = t.replace(/(?<=0)O(?=[A-Z])|(?<=[A-Z])O(?=0)/g, '');
  }
  // numbers: "1O0" -> "100"
  if (/^[\dO.,]+$/.test(t) && /\d/.test(t)) t = t.replace(/O/g, '0');
  return t;
}

/** A cell made of placeholders ("--", "—") is blank. */
export function cleanOcrCell(text: string | null): string | null {
  if (text === null) return null;
  const t = text.trim();
  return !t || /^[-—–_=~.\s]+$/.test(t) ? null : t;
}
