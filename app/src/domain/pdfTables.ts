/**
 * Schedules from a drawing / submittal PDF (ROADMAP §7.3, groundwork; pure: no PDF library). A vector PDF has its
 * text with positions but no tables: this rebuilds them.
 *
 *   phrases   text items on the same line close together -> one phrase (CAD output often writes a cell per
 *             character or a whole row per item; a run of 2+ spaces inside an item splits it)
 *   regions   phrases connected by small gaps -> one region (several schedules on one sheet stay apart)
 *   columns   from the body lines (the lines with the most phrases): overlapping x-ranges -> one column
 *   header    the lines above the first data line, stacked per column ("DESIGN" / "FLOW (GPM)" -> "DESIGN FLOW
 *             (GPM)"); a header phrase over several columns ("PUMP") prefixes each of them
 *   body      one row per line; a line with an empty first column continues the row above (wrapped text); a
 *             line spanning most of the width after the body (notes) ends the table
 *   title     one-phrase lines above the header ("PUMP SCHEDULE") name the table and suggest the unit type
 * The grid feeds the schedule import (header mapping, preview) like a pasted or Excel schedule. Scanned drawings
 * have no text: they need OCR (not here).
 */
import type { EquipmentTypeKey } from './equipmentTypes';
import type { Grid } from './scheduleImport';

/** One text item of a page, in PDF units, y upwards (pdf.js getTextContent: transform [a, b, c, d, x, y]). */
export interface PdfTextItem {
  str: string;
  transform: readonly number[];
  width: number;
  height?: number;
}

export interface PdfPageText {
  page: number;
  width: number;
  height: number;
  items: readonly PdfTextItem[];
}

export interface PdfTable {
  page: number;
  title: string | null;
  /** header row first (when one was found), then the body rows */
  rows: Grid;
  hasHeader: boolean;
  /** unit type suggested by the title / headers */
  type: EquipmentTypeKey | null;
}

interface Phrase {
  text: string;
  x0: number;
  x1: number;
  /** top and bottom, y downwards from the top of the page */
  top: number;
  bottom: number;
  size: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/** Items -> boxes (horizontal and ±90° text), y downwards; runs of 2+ spaces split an item. */
function boxes(page: PdfPageText): Phrase[] {
  const out: Phrase[] = [];
  for (const it of page.items) {
    if (!it.str.trim()) continue;
    const [a, b, , , e, f] = it.transform;
    const size = Math.hypot(a, b) || it.height || 1;
    if (Math.abs(b) > Math.abs(a)) {
      // rotated ±90°: one phrase standing up
      const up = b > 0;
      const len = it.width;
      out.push({
        text: it.str.trim(),
        x0: up ? e - size : e,
        x1: up ? e : e + size,
        top: page.height - (up ? f + len : f),
        bottom: page.height - (up ? f : f - len),
        size,
      });
      continue;
    }
    const top = page.height - f - size * 0.8;
    const bottom = page.height - f + size * 0.2;
    const per = it.str.length ? it.width / it.str.length : 0;
    // split "R1-1     200" into its pieces, placed by character count
    const re = /\S+(?: \S+)*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(it.str))) {
      out.push({
        text: m[0],
        x0: e + m.index * per,
        x1: e + (m.index + m[0].length) * per,
        top,
        bottom,
        size,
      });
    }
  }
  return out;
}

/** Boxes on the same line with a gap under ~0.6 × the text size -> one phrase. */
function mergePhrases(bs: Phrase[]): Phrase[] {
  const lines = groupLines(bs);
  const out: Phrase[] = [];
  for (const line of lines) {
    let cur: Phrase | null = null;
    for (const b of line) {
      if (cur && b.x0 - cur.x1 < Math.max(cur.size, b.size) * 0.6 && Math.abs(b.size - cur.size) < 0.3 * cur.size) {
        const gap: number = b.x0 - cur.x1;
        cur = {
          text: gap > Math.min(cur.size, b.size) * 0.12 ? `${cur.text} ${b.text}` : cur.text + b.text,
          x0: cur.x0,
          x1: Math.max(cur.x1, b.x1),
          top: Math.min(cur.top, b.top),
          bottom: Math.max(cur.bottom, b.bottom),
          size: cur.size,
        };
      } else {
        if (cur) out.push(cur);
        cur = { ...b };
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Phrases -> lines (vertical centres within ~0.45 × size), top to bottom, each sorted left to right. */
function groupLines(ps: Phrase[]): Phrase[][] {
  const sorted = [...ps].sort((p, q) => p.top + p.bottom - (q.top + q.bottom) || p.x0 - q.x0);
  const lines: { mid: number; size: number; items: Phrase[] }[] = [];
  for (const p of sorted) {
    const mid = (p.top + p.bottom) / 2;
    const line = lines.find((l) => Math.abs(l.mid - mid) < Math.max(l.size, p.size) * 0.45);
    if (line) line.items.push(p);
    else lines.push({ mid, size: p.size, items: [p] });
  }
  return lines.sort((l, m) => l.mid - m.mid).map((l) => l.items.sort((p, q) => p.x0 - q.x0));
}

/** Connected groups of phrases: vertical gap < 2.2 × size with x-overlap (or near), or same line and gap < 10 × size. */
function regions(ps: Phrase[]): Phrase[][] {
  const parent = ps.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      const p = ps[i];
      const q = ps[j];
      const size = Math.max(p.size, q.size);
      const vGap = Math.max(p.top, q.top) - Math.min(p.bottom, q.bottom);
      const hGap = Math.max(p.x0, q.x0) - Math.min(p.x1, q.x1);
      const sameLine = vGap < -0.5 * Math.min(p.bottom - p.top, q.bottom - q.top);
      if ((sameLine && hGap < 10 * size) || (!sameLine && vGap < 2.2 * size && hGap < 1.5 * size))
        parent[find(i)] = find(j);
    }
  const groups = new Map<number, Phrase[]>();
  ps.forEach((p, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(p);
  });
  return [...groups.values()];
}

const isData = (texts: string[]) => {
  const filled = texts.filter((t) => t);
  const digits = filled.filter((t) => /\d/.test(t)).length;
  return filled.length > 0 && digits >= Math.max(1, filled.length / 3);
};

/** Words in a title / header that name a unit type (the first match wins; longer phrases are listed first). */
const TYPE_WORDS: [RegExp, EquipmentTypeKey][] = [
  [/\b(pump)s?\b/i, 'pump'],
  [/\b(chiller|boiler|heat exchanger|cooling tower)s?\b/i, 'plant'],
  [/\b(balancing valve|circuit setter|flow control valve|cbv)s?\b/i, 'valveSystem'],
  [/\b(vav|terminal unit|air terminal|fan powered|fpb|vav box)(es|s)?\b/i, 'vav'],
  [/\b(rooftop|rtu|air handl|ahu)/i, 'rtu'],
  [/\b(make[- ]?up air|mau)\b/i, 'mau'],
  [/\b(energy recovery|erv|hrv)\b/i, 'erv'],
  [/\bhoods?\b/i, 'hood'],
  [/\b(exhaust fan|fan|ef)s?\b/i, 'fan'],
];

export function suggestType(text: string, known: readonly string[]): EquipmentTypeKey | null {
  for (const [re, key] of TYPE_WORDS) if (re.test(text) && known.includes(key)) return key;
  return null;
}

/** Rebuild one region's table, or null when it is not a table (fewer than 2 columns or no data line). */
function regionTable(region: Phrase[], page: number, known: readonly string[]): PdfTable | null {
  const lines = groupLines(region);
  const counts = lines.map((l) => l.length);
  const maxCount = Math.max(...counts);
  if (maxCount < 2) return null;
  // columns from the lines with (nearly) the most phrases
  const bodyish = lines.filter((l) => l.length >= Math.max(2, Math.ceil(maxCount * 0.6)));
  const spans: { x0: number; x1: number }[] = [];
  for (const p of bodyish.flat().sort((a, b) => a.x0 - b.x0)) {
    const last = spans[spans.length - 1];
    if (last && p.x0 <= last.x1 + p.size * 0.3) last.x1 = Math.max(last.x1, p.x1);
    else spans.push({ x0: p.x0, x1: p.x1 });
  }
  if (spans.length < 2) return null;
  const n = spans.length;
  const firstData = lines.findIndex((l) => l.length >= 2 && isData(l.map((p) => p.text)));
  if (firstData < 0) return null;
  const boundsOf = () =>
    spans.map((s, i) => ({
      lo: i === 0 ? -Infinity : (spans[i - 1].x1 + s.x0) / 2,
      hi: i === n - 1 ? Infinity : (s.x1 + spans[i + 1].x0) / 2,
    }));
  const centreCol = (p: Phrase, bounds: { lo: number; hi: number }[]) => {
    const mid = (p.x0 + p.x1) / 2;
    return bounds.findIndex((b) => mid >= b.lo && mid < b.hi);
  };
  const overlap = (p: Phrase, s: { x0: number; x1: number }) => Math.min(p.x1, s.x1) - Math.max(p.x0, s.x0);
  // the column labels (the header line just above the data) widen their columns: data under a label is often
  // narrower than the label, and a group header over several labels is matched against the labels' width
  if (firstData > 0 && lines[firstData - 1].length >= 2) {
    const bounds = boundsOf();
    for (const p of lines[firstData - 1]) {
      const c = centreCol(p, bounds);
      if (spans.some((s, i) => i !== c && overlap(p, s) > 0)) continue;
      spans[c] = { x0: Math.min(spans[c].x0, p.x0), x1: Math.max(spans[c].x1, p.x1) };
    }
  }
  const bounds = boundsOf();
  /** The columns a phrase belongs to: a header phrase over several columns (a group header) goes to each of them. */
  const colsOf = (p: Phrase, header: boolean): number[] => {
    if (!header) return [centreCol(p, bounds)];
    const covered = spans
      .map((s, i) => ({ i, o: overlap(p, s), w: s.x1 - s.x0 }))
      .filter((c) => c.w > 0 && c.o > Math.min(c.w, p.x1 - p.x0) * 0.15)
      .map((c) => c.i);
    return covered.length > 1 ? covered : [centreCol(p, bounds)];
  };
  const cells = lines.map((l, k) => {
    const row: string[] = Array.from({ length: n }, () => '');
    for (const p of l) for (const c of colsOf(p, k < firstData)) row[c] = row[c] ? `${row[c]} ${p.text}` : p.text;
    return { row, line: l };
  });
  // title: leading one-phrase lines that are larger than the table text or say "schedule"
  const bodySize = median(
    lines
      .slice(firstData)
      .flat()
      .map((p) => p.size),
  );
  let start = 0;
  const titles: string[] = [];
  while (
    start < firstData &&
    lines[start].length === 1 &&
    (lines[start][0].size > bodySize * 1.15 || /schedule|table/i.test(lines[start][0].text))
  ) {
    titles.push(lines[start][0].text);
    start++;
  }
  const headerCells = cells.slice(start, firstData);
  const header: string[] = Array.from({ length: n }, (_, c) =>
    headerCells
      .map((h) => h.row[c])
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  const body: string[][] = [];
  const width = spans[n - 1].x1 - spans[0].x0;
  for (const c of cells.slice(firstData)) {
    const lineWidth = c.line[c.line.length - 1].x1 - c.line[0].x0;
    // notes under the table: one phrase across most of the width
    if (c.line.length === 1 && lineWidth > width * 0.6) break;
    const prev = body[body.length - 1];
    const filled = c.row.filter(Boolean).length;
    if (prev && !c.row[0] && filled <= Math.max(1, Math.floor(n / 3))) {
      c.row.forEach((t, i) => {
        if (t) prev[i] = prev[i] ? `${prev[i]} ${t}` : t;
      });
      continue;
    }
    body.push([...c.row]);
  }
  if (!body.length) return null;
  const hasHeader = header.some(Boolean);
  const title = titles.join(' ') || null;
  const toGrid = (r: string[]) => r.map((t) => t || null);
  return {
    page,
    title,
    rows: hasHeader ? [toGrid(header), ...body.map(toGrid)] : body.map(toGrid),
    hasHeader,
    type: (title ? suggestType(title, known) : null) ?? suggestType(header.join(' '), known),
  };
}

/**
 * The tables of a PDF's pages, top to bottom and left to right per page. `known`: the unit types the app has (a
 * suggested type is one of them).
 */
export function pdfTables(pages: readonly PdfPageText[], known: readonly string[]): PdfTable[] {
  const out: PdfTable[] = [];
  for (const page of pages) {
    const phrases = mergePhrases(boxes(page));
    const rs = regions(phrases)
      .map((r) => ({ r, top: Math.min(...r.map((p) => p.top)), left: Math.min(...r.map((p) => p.x0)) }))
      .sort((a, b) => a.top - b.top || a.left - b.left);
    for (const { r } of rs) {
      const t = regionTable(r, page.page, known);
      if (t) out.push(t);
    }
  }
  return out;
}

/** The words of a page's text layer with their boxes (points, y downwards), for the grid method (tableGrid.ts). */
export function pageWords(page: PdfPageText): { text: string; x0: number; y0: number; x1: number; y1: number }[] {
  return boxes(page).map((b) => ({ text: b.text, x0: b.x0, y0: b.top, x1: b.x1, y1: b.bottom }));
}

/** OCR / text words (y downwards) -> text items for the whitespace method (tables without lines). */
export function wordsToPage(
  words: readonly { text: string; x0: number; y0: number; x1: number; y1: number }[],
  page: number,
  width: number,
  height: number,
): PdfPageText {
  return {
    page,
    width,
    height,
    items: words.map((w) => {
      const h = Math.max(1, w.y1 - w.y0);
      return { str: w.text, width: w.x1 - w.x0, height: h, transform: [h, 0, 0, h, w.x0, height - w.y1 + h * 0.2] };
    }),
  };
}
