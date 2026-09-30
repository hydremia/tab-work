/**
 * Schedules rebuilt from their ruling lines (pure). Drawing schedules are grids: every cell has a border. With the
 * lines (domain/rasterLines.ts) and the words and their boxes (OCR, or a PDF's text layer), each word lands in its
 * cell, so wide columns, wrapped cells and uneven spacing no longer matter (the whitespace method in pdfTables.ts
 * stays for PDFs whose tables have no lines).
 *
 *   tables   h / v lines that cross each other form one table (its outline and inner lines)
 *   cells    between neighbouring row / column lines; a missing line inside a row = a merged cell (group headers)
 *   title    top rows that span the whole width ("FAN SCHEDULE"), or a line of text just above the grid
 *   header   the rows above the first data row, stacked per column; a merged header cell prefixes each column under it
 *   body     one row per grid row; a full-width row after the data (notes) ends the table
 * Coordinates: any unit, y downwards, words and lines in the same space.
 */
import type { EquipmentTypeKey } from './equipmentTypes';
import { suggestType, type PdfTable } from './pdfTables';
import type { HLine, VLine } from './rasterLines';

export interface Word {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** OCR confidence 0-100 (absent: text layer) */
  conf?: number;
}

export interface GridTable extends PdfTable {
  /** body cells OCR was unsure of (confidence under LOW_CONF), as [row index in `rows`, column] */
  lowConfidence: [number, number][];
  /** the table's box, in the input units */
  box: { x0: number; y0: number; x1: number; y1: number };
  /**
   * Cells that are empty where text is expected (a header cell with its own border over a column with data, a gap in
   * a mostly filled column): text recognition drops short isolated words ("HP"), so the caller reads these again one
   * by one and rebuilds the table. In the input units.
   */
  retry: { x0: number; y0: number; x1: number; y1: number }[];
  /** body cells read with low confidence: read again on their own, the more confident reading kept */
  recheck: { x0: number; y0: number; x1: number; y1: number }[];
}

export const LOW_CONF = 60;

/** Values within `tol` -> one (their mean), sorted. */
function cluster(values: number[], tol: number): number[] {
  const s = [...values].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const v of s) {
    const last = out[out.length - 1];
    if (last && v - last[last.length - 1] <= tol) last.push(v);
    else out.push([v]);
  }
  return out.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

const isData = (texts: string[]) => {
  const filled = texts.filter(Boolean);
  const digits = filled.filter((t) => /\d/.test(t)).length;
  return filled.length >= 2 && digits >= Math.max(1, filled.length / 3);
};

/**
 * The tables formed by the lines, with each word in its cell. `tol`: how far apart two lines may be and still meet
 * (px at the raster's resolution; a few points).
 */
export function gridTables(
  lines: { h: readonly HLine[]; v: readonly VLine[] },
  words: readonly Word[],
  known: readonly string[],
  page = 1,
  tol = 4,
): GridTable[] {
  const out: GridTable[] = [];
  for (const g of lineGroups(lines, tol)) {
    if (!isScheduleGrid(g, tol)) continue;
    const box = {
      x0: Math.min(...g.h.map((l) => l.x0), ...g.v.map((l) => l.x)),
      x1: Math.max(...g.h.map((l) => l.x1), ...g.v.map((l) => l.x)),
      y0: Math.min(...g.v.map((l) => l.y0), ...g.h.map((l) => l.y)),
      y1: Math.max(...g.v.map((l) => l.y1), ...g.h.map((l) => l.y)),
    };
    const ys = cluster(
      g.h.map((l) => l.y),
      tol,
    );
    const xs = cluster(
      g.v.map((l) => l.x),
      tol,
    );
    if (ys.length < 3 || xs.length < 3) continue;
    const R = ys.length - 1;
    const C = xs.length - 1;
    const mid = (a: number, b: number) => (a + b) / 2;
    // a vertical line at column boundary k (1..C-1) inside row r
    const vAt = (k: number, r: number) => {
      const y = mid(ys[r], ys[r + 1]);
      return g.v.some((l) => Math.abs(l.x - xs[k]) <= tol && l.y0 - tol <= y && l.y1 + tol >= y);
    };
    // ---- words into cells (by their centre)
    const cellWords: Word[][][] = Array.from({ length: R }, () => Array.from({ length: C }, () => []));
    const above: Word[] = [];
    for (const w of words) {
      const cx = mid(w.x0, w.x1);
      const cy = mid(w.y0, w.y1);
      if (cx < xs[0] || cx > xs[C]) continue;
      if (cy < ys[0]) {
        // a title just above the grid
        if (ys[0] - cy < 3 * (w.y1 - w.y0)) above.push(w);
        continue;
      }
      if (cy > ys[R]) continue;
      const r = ys.findIndex((y, i) => i < R && cy >= y && cy < ys[i + 1]);
      const c = xs.findIndex((x, i) => i < C && cx >= x && cx < xs[i + 1]);
      if (r >= 0 && c >= 0) cellWords[r][c].push(w);
    }
    const text = (ws: Word[]) => {
      if (!ws.length) return '';
      const hgt = Math.max(1, ...ws.map((w) => w.y1 - w.y0));
      return [...ws]
        .sort((a, b) => (Math.abs(a.y0 - b.y0) > hgt * 0.5 ? a.y0 - b.y0 : a.x0 - b.x0))
        .map((w) => w.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    };
    // merged spans per row: [start, end] column ranges without a line between them
    const spans = (r: number): [number, number][] => {
      const out2: [number, number][] = [];
      let s = 0;
      for (let k = 1; k <= C; k++)
        if (k === C || vAt(k, r)) {
          out2.push([s, k - 1]);
          s = k;
        }
      return out2;
    };
    const rowText: string[][] = [];
    const rowSpans: [number, number][][] = [];
    const rowLow: boolean[][] = [];
    for (let r = 0; r < R; r++) {
      const sp = spans(r);
      const texts = Array.from({ length: C }, () => '');
      const low = Array.from({ length: C }, () => false);
      for (const [a, b] of sp) {
        const ws = cellWords[r].slice(a, b + 1).flat();
        const t = text(ws);
        for (let c = a; c <= b; c++) {
          texts[c] = t;
          low[c] = ws.some((w) => w.conf !== undefined && w.conf < LOW_CONF);
        }
      }
      rowText.push(texts);
      rowSpans.push(sp);
      rowLow.push(low);
    }
    const fullWidth = (r: number) => rowSpans[r].length === 1;
    const firstData = rowText.findIndex((t, r) => !fullWidth(r) && isData(uniqueSpans(t, rowSpans[r])));
    if (firstData < 0) continue;
    // title: full-width rows at the top, else the text just above the grid
    const titles: string[] = [];
    let start = 0;
    while (start < firstData && fullWidth(start)) {
      if (rowText[start][0]) titles.push(rowText[start][0]);
      start++;
    }
    if (!titles.length && above.length) titles.push(text(above));
    const header = Array.from({ length: C }, (_, c) =>
      rowText
        .slice(start, firstData)
        .map((t) => t[c])
        .filter((t, i, arr) => t && t !== arr[i - 1])
        .join(' ')
        .trim(),
    );
    const body: string[][] = [];
    const low: [number, number][] = [];
    for (let r = firstData; r < R; r++) {
      if (fullWidth(r)) break; // notes under the table
      const t = rowText[r];
      if (!t.some(Boolean)) continue;
      // a merged cell in the body (e.g. "REMOVE AND CAP" across several columns) keeps its text in its first column
      const row = t.map((x, c) => (rowSpans[r].some(([a]) => a === c) || !spanOf(rowSpans[r], c) ? x : ''));
      body.push(row);
      rowLow[r].forEach((l, c) => l && row[c] && low.push([body.length, c]));
    }
    if (!body.length) continue;
    // ---- cells worth reading again
    const hAt = (r: number, c: number) => {
      const x = mid(xs[c], xs[c + 1]);
      return g.h.some((l) => Math.abs(l.y - ys[r]) <= tol && l.x0 - tol <= x && l.x1 + tol >= x);
    };
    const bodyRows = Array.from({ length: R - firstData }, (_, i) => firstData + i).filter((r) => !fullWidth(r));
    const filled = (c: number) => bodyRows.filter((r) => rowText[r][c]).length;
    const retry: GridTable['retry'] = [];
    const cellBox = (r: number, a: number, b: number) => ({ x0: xs[a], y0: ys[r], x1: xs[b + 1], y1: ys[r + 1] });
    for (let r = start; r < R; r++) {
      if (fullWidth(r)) {
        if (r > firstData) break;
        continue;
      }
      for (const [a, b] of rowSpans[r]) {
        if (rowText[r][a]) continue;
        const header = r < firstData;
        // a header cell of its own (rules above and below), not half of one spanning two rows: reading half of a
        // merged cell cuts its letters in two
        const wanted = header
          ? hAt(r, a) && hAt(r + 1, a) && filled(a) > 0
          : bodyRows.length >= 3 && filled(a) >= bodyRows.length * 0.6;
        if (wanted && retry.length < 80) retry.push(cellBox(r, a, b));
      }
    }
    const recheck: GridTable['recheck'] = [];
    for (const r of bodyRows)
      for (const [a, b] of rowSpans[r])
        if (rowText[r][a] && rowLow[r][a] && recheck.length < 80) recheck.push(cellBox(r, a, b));
    // columns empty everywhere (border gaps, merged leftovers)
    const keep = header.map((hd, c) => Boolean(hd) || body.some((r) => r[c]));
    const cols = keep.map((k, c) => (k ? c : -1)).filter((c) => c >= 0);
    const pick = (r: string[]) => cols.map((c) => r[c] || null);
    const hasHeader = header.some(Boolean);
    const title = titles.join(' ') || null;
    const shift = hasHeader ? 0 : -1;
    out.push({
      page,
      title,
      rows: hasHeader ? [pick(header), ...body.map(pick)] : body.map(pick),
      hasHeader,
      type:
        (title ? suggestType(title, known) : null) ?? (suggestType(header.join(' '), known) as EquipmentTypeKey | null),
      lowConfidence: low.map(([r, c]) => [r + shift, cols.indexOf(c)] as [number, number]).filter(([, c]) => c >= 0),
      box,
      retry,
      recheck,
    });
  }
  return out.sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
}

/** Lines that cross each other, grouped: one group per table (its outline and inner lines). */
export function lineGroups(lines: { h: readonly HLine[]; v: readonly VLine[] }, tol = 4): { h: HLine[]; v: VLine[] }[] {
  const { h, v } = lines;
  const n = h.length + v.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < h.length; i++)
    for (let j = 0; j < v.length; j++) {
      const a = h[i];
      const b = v[j];
      if (b.x >= a.x0 - tol && b.x <= a.x1 + tol && a.y >= b.y0 - tol && a.y <= b.y1 + tol)
        parent[find(i)] = find(h.length + j);
    }
  const groups = new Map<number, { h: HLine[]; v: VLine[] }>();
  const at = (r: number) => groups.get(r) ?? (groups.set(r, { h: [], v: [] }).get(r) as { h: HLine[]; v: VLine[] });
  h.forEach((l, i) => at(find(i)).h.push(l));
  v.forEach((l, j) => at(find(h.length + j)).v.push(l));
  return [...groups.values()];
}

/**
 * A schedule's grid: at least 3 columns and 2 rows, and at least half of its horizontal lines cross the whole table
 * (row rules). Detail drawings (curbs, sections), title blocks and dimension strings have lines too, but few that span
 * their whole width.
 */
export function isScheduleGrid(g: { h: readonly HLine[]; v: readonly VLine[] }, tol = 4): boolean {
  if (g.h.length < 3 || g.v.length < 4) return false;
  const x0 = Math.min(...g.h.map((l) => l.x0));
  const x1 = Math.max(...g.h.map((l) => l.x1));
  if (x1 - x0 < 72) return false; // under an inch wide
  const full = g.h.filter((l) => l.x1 - l.x0 >= 0.9 * (x1 - x0) - tol).length;
  return full >= Math.max(2, g.h.length / 2);
}

/** The boxes of the schedule grids the lines form: where to read text. */
export function tableBoxes(
  lines: { h: readonly HLine[]; v: readonly VLine[] },
  tol = 4,
): { x0: number; y0: number; x1: number; y1: number }[] {
  return lineGroups(lines, tol)
    .filter((g) => isScheduleGrid(g, tol))
    .map((g) => ({
      x0: Math.min(...g.h.map((l) => l.x0), ...g.v.map((l) => l.x)),
      x1: Math.max(...g.h.map((l) => l.x1), ...g.v.map((l) => l.x)),
      y0: Math.min(...g.v.map((l) => l.y0), ...g.h.map((l) => l.y)),
      y1: Math.max(...g.v.map((l) => l.y1), ...g.h.map((l) => l.y)),
    }));
}

/** The span a column belongs to. */
function spanOf(sp: [number, number][], c: number): [number, number] | undefined {
  return sp.find(([a, b]) => c >= a && c <= b);
}

/** One text per merged span (for the data test: a merged cell counts once). */
function uniqueSpans(t: string[], sp: [number, number][]): string[] {
  return sp.map(([a]) => t[a]);
}
