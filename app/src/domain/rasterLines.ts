/**
 * Ruling lines of a rendered drawing (pure): the horizontal and vertical lines of the schedule grids, found in a
 * grayscale raster. Used with text from OCR (scanned / outlined-text PDFs, photos) or from the PDF's text layer to
 * rebuild tables cell by cell (domain/tableGrid.ts).
 *
 * A line is a run of dark pixels at least `minLength` long (short gaps bridged: anti-aliasing, crossings), merged
 * across neighbouring rows / columns into one line of some thickness. Text strokes are short and hatching / solid
 * fills are too thick, so neither counts.
 */

export interface HLine {
  y: number;
  x0: number;
  x1: number;
}
export interface VLine {
  x: number;
  y0: number;
  y1: number;
}

export interface Gray {
  width: number;
  height: number;
  /** one byte per pixel, 0 = black */
  data: Uint8Array | Uint8ClampedArray;
}

export interface LineOptions {
  /** darker than this is ink (default 160) */
  threshold?: number;
  /** shortest line, px (default 40) */
  minLength?: number;
  /** gaps up to this are bridged, px (default 2) */
  maxGap?: number;
  /** thicker than this is a fill, not a line, px (default 6) */
  maxThickness?: number;
}

/** RGBA pixels (canvas ImageData) -> gray. */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Gray {
  const data = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < data.length; i += 4, j++) {
    // transparent (unpainted canvas) counts as white
    const a = rgba[i + 3] / 255;
    const l = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    data[j] = Math.round(l * a + 255 * (1 - a));
  }
  return { width, height, data };
}

interface Run {
  pos: number; // row (horizontal) or column (vertical)
  a: number;
  b: number;
}

function runs(g: Gray, horizontal: boolean, o: Required<LineOptions>): Run[] {
  const out: Run[] = [];
  const outer = horizontal ? g.height : g.width;
  const inner = horizontal ? g.width : g.height;
  for (let p = 0; p < outer; p++) {
    let start = -1;
    let lastInk = -1;
    for (let q = 0; q <= inner; q++) {
      const ink = q < inner && g.data[horizontal ? p * g.width + q : q * g.width + p] < o.threshold;
      if (ink) {
        if (start < 0) start = q;
        lastInk = q;
      } else if (start >= 0 && (q - lastInk > o.maxGap || q === inner)) {
        // (the end of the row closes a run that reaches the edge)
        if (lastInk - start + 1 >= o.minLength) out.push({ pos: p, a: start, b: lastInk });
        start = -1;
      }
    }
  }
  return out;
}

/** Runs on neighbouring rows that overlap -> one line; too thick -> dropped (a fill). */
function merge(rs: Run[], o: Required<LineOptions>): { pos: number; a: number; b: number }[] {
  const lines: { p0: number; p1: number; a: number; b: number }[] = [];
  const open: typeof lines = [];
  rs.sort((x, y) => x.pos - y.pos || x.a - y.a);
  for (const r of rs) {
    const hit = open.find((l) => r.pos - l.p1 <= 1 && r.a <= l.b + o.maxGap && r.b >= l.a - o.maxGap);
    if (hit) {
      hit.p1 = r.pos;
      hit.a = Math.min(hit.a, r.a);
      hit.b = Math.max(hit.b, r.b);
    } else {
      const l = { p0: r.pos, p1: r.pos, a: r.a, b: r.b };
      lines.push(l);
      open.push(l);
    }
    // lines that ended more than a row ago can't grow
    for (let i = open.length - 1; i >= 0; i--) if (r.pos - open[i].p1 > 1) open.splice(i, 1);
  }
  return lines
    .filter((l) => l.p1 - l.p0 + 1 <= o.maxThickness)
    .map((l) => ({ pos: (l.p0 + l.p1) / 2, a: l.a, b: l.b }));
}

export function findLines(g: Gray, opts: LineOptions = {}): { h: HLine[]; v: VLine[] } {
  const o: Required<LineOptions> = {
    threshold: opts.threshold ?? 160,
    minLength: opts.minLength ?? 40,
    maxGap: opts.maxGap ?? 2,
    maxThickness: opts.maxThickness ?? 6,
  };
  const h = merge(runs(g, true, o), o).map((l) => ({ y: l.pos, x0: l.a, x1: l.b }));
  const v = merge(runs(g, false, o), o).map((l) => ({ x: l.pos, y0: l.a, y1: l.b }));
  return { h, v };
}
