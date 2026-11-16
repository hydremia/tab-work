/**
 * Where the air devices are drawn (ROADMAP §7.3 step 2; pure). A plan's tag names a device; the device itself is a
 * small symbol (a square with an X or corner diagonals, a rotated tile, a register with arrows) joined to the tag by
 * a leader. From the page's vector geometry (workbook/pdfGeometry.ts):
 *
 *   glyphs    small rectangles: a closed four-sided path (a rotated ceiling tile), or two parallel short sides joined
 *             by a third (CAD draws a symbol's square as separate lines, a side sometimes split for a damper stem);
 *             its size is its signature, so the same symbol is told apart from others (the strokes inside, an X or
 *             corner diagonals, are counted but duct lines crossing a symbol would make them unreliable)
 *   leaders   a line starting just outside a tag and ending on a glyph: that glyph is the tag's device
 *   TYP n     the tag stands for n devices: the n − 1 nearest unclaimed glyphs of the same signature
 *   frames    small closed outlines with strokes inside (a hexagon tag whose text was plotted as lines): the places
 *             to read with text recognition when the page has no text layer
 *
 * A tag without a leader takes the nearest glyph of the sheet's device signatures within reach, and a tag with no
 * glyph at all keeps its own position, so every device has a place on the sheet.
 */
import type { PlanDevice } from './planDevices';
import type { PlanPath } from '../workbook/pdfGeometry';

export interface Glyph {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  /** strokes inside the outline */
  strokes: number;
  /** "18x18": rounded side lengths (longer first); identical symbols share it (what crosses them varies) */
  sig: string;
  /** the outline's corners (4), for drawing */
  corners: [number, number][];
}

export interface PlacedDevice {
  /** the tag */
  device: PlanDevice;
  /** 0-based index among the tag's devices (a TYP 5 tag places five) */
  index: number;
  /** where the device is drawn (the glyph's centre), or the tag's centre when no glyph was found */
  x: number;
  y: number;
  glyph: Glyph | null;
  /** how the place was found */
  how: 'leader' | 'nearest' | 'typ' | 'tag';
}

export interface Frame {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type Pt = [number, number];
type Box = { x0: number; y0: number; x1: number; y1: number };

const ends = (p: PlanPath): [Pt, Pt] => [p.pts[0], p.pts[p.pts.length - 1]];
const dist = (a: readonly [number, number], b: readonly [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const size = (p: Box) => Math.max(p.x1 - p.x0, p.y1 - p.y0);
const inside = (a: Box, b: Box, m = 0) => a.x0 >= b.x0 - m && a.x1 <= b.x1 + m && a.y0 >= b.y0 - m && a.y1 <= b.y1 + m;

export interface GlyphOptions {
  /** a symbol's side is between these lengths (points) */
  minSide?: number;
  maxSide?: number;
  /** end points this close meet */
  tol?: number;
}

interface Seg {
  a: Pt;
  b: Pt;
  len: number;
}

/** A 2-point path as a segment, longer end first by x then y. */
function segOf(p: PlanPath): Seg | null {
  if (p.pts.length !== 2 || p.closed) return null;
  const [a, b] = p.pts;
  const len = dist(a, b);
  return len > 0 ? { a, b, len } : null;
}

/** Symbols: small rectangles of the sheet, with the strokes drawn inside them. */
export function glyphs(paths: readonly PlanPath[], opts: GlyphOptions = {}): Glyph[] {
  const minSide = opts.minSide ?? 5;
  const maxSide = opts.maxSide ?? 45;
  const tol = opts.tol ?? 1;
  const found: { box: Box; corners: Pt[]; w: number; h: number }[] = [];
  const add = (corners: Pt[], w: number, h: number) => {
    const box = {
      x0: Math.min(...corners.map((c) => c[0])),
      y0: Math.min(...corners.map((c) => c[1])),
      x1: Math.max(...corners.map((c) => c[0])),
      y1: Math.max(...corners.map((c) => c[1])),
    };
    if (
      found.some(
        (f) =>
          Math.abs(f.box.x0 - box.x0) < tol &&
          Math.abs(f.box.y0 - box.y0) < tol &&
          Math.abs(f.box.x1 - box.x1) < tol &&
          Math.abs(f.box.y1 - box.y1) < tol,
      )
    )
      return;
    found.push({ box, corners, w, h });
  };

  // 1. closed four-sided paths, any rotation (a rotated tile): opposite sides equal, corners square-ish
  for (const p of paths) {
    const pts = p.pts.length === 5 && dist(p.pts[0], p.pts[4]) <= tol ? p.pts.slice(0, 4) : p.pts;
    if (pts.length !== 4 || (!p.closed && p.pts.length !== 5)) continue;
    const s = [dist(pts[0], pts[1]), dist(pts[1], pts[2]), dist(pts[2], pts[3]), dist(pts[3], pts[0])];
    if (s.some((x) => x < minSide || x > maxSide)) continue;
    if (Math.abs(s[0] - s[2]) > 0.15 * s[0] || Math.abs(s[1] - s[3]) > 0.15 * s[1]) continue;
    // a right angle at the first corner
    const ux = pts[1][0] - pts[0][0];
    const uy = pts[1][1] - pts[0][1];
    const vx = pts[3][0] - pts[0][0];
    const vy = pts[3][1] - pts[0][1];
    if (Math.abs(ux * vx + uy * vy) > 0.2 * s[0] * s[3]) continue;
    add(pts as Pt[], Math.max(s[0], s[1]), Math.min(s[0], s[1]));
  }

  // 2. axis-aligned rectangles from separate lines: two parallel sides with matching extents and a side joining them
  const segs = paths.map(segOf).filter((s): s is Seg => s !== null && s.len >= minSide && s.len <= maxSide);
  const hs = segs.filter((s) => Math.abs(s.a[1] - s.b[1]) <= 0.3);
  const vs = segs.filter((s) => Math.abs(s.a[0] - s.b[0]) <= 0.3);
  const key = (lo: number, hi: number) => `${Math.round(lo)}:${Math.round(hi)}`;
  const byKey = <T>(xs: T[], k: (x: T) => string[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) for (const kk of k(x)) (m.get(kk) ?? m.set(kk, []).get(kk)!).push(x);
    return m;
  };
  // neighbouring keys too, so rounding never splits a match
  const keysOf = (lo: number, hi: number) => {
    const out: string[] = [];
    for (const dl of [-1, 0, 1]) for (const dh of [-1, 0, 1]) out.push(key(lo + dl, hi + dh));
    return out;
  };
  const hAtSpan = byKey(hs, (s) => [key(Math.min(s.a[0], s.b[0]), Math.max(s.a[0], s.b[0]))]);
  const vAtSpan = byKey(vs, (s) => [key(Math.min(s.a[1], s.b[1]), Math.max(s.a[1], s.b[1]))]);
  const spanOf = (s: Seg, axis: 0 | 1): [number, number] => [
    Math.min(s.a[axis], s.b[axis]),
    Math.max(s.a[axis], s.b[axis]),
  ];
  const joined = (lo: number, hi: number, at: number, perpendicular: Map<string, Seg[]>, axis: 0 | 1) => {
    // a perpendicular side at coordinate `at` spanning lo..hi (within tol)
    for (const k of keysOf(lo, hi))
      for (const s of perpendicular.get(k) ?? []) {
        const [a, b] = spanOf(s, axis);
        if (Math.abs(a - lo) <= tol && Math.abs(b - hi) <= tol && Math.abs(s.a[axis === 0 ? 1 : 0] - at) <= tol)
          return true;
      }
    return false;
  };
  // pairs of verticals
  for (const [, group] of vAtSpan) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const p = group[i];
        const q = group[j];
        const [py0, py1] = spanOf(p, 1);
        const [qy0, qy1] = spanOf(q, 1);
        if (Math.abs(py0 - qy0) > tol || Math.abs(py1 - qy1) > tol) continue;
        const x0 = Math.min(p.a[0], q.a[0]);
        const x1 = Math.max(p.a[0], q.a[0]);
        const w = x1 - x0;
        if (w < minSide || w > maxSide) continue;
        if (!joined(x0, x1, py0, hAtSpan, 0) && !joined(x0, x1, py1, hAtSpan, 0)) continue;
        add(
          [
            [x0, py0],
            [x1, py0],
            [x1, py1],
            [x0, py1],
          ],
          Math.max(w, py1 - py0),
          Math.min(w, py1 - py0),
        );
      }
  }
  // pairs of horizontals (a rectangle whose verticals are split)
  for (const [, group] of hAtSpan) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const p = group[i];
        const q = group[j];
        const [px0, px1] = spanOf(p, 0);
        const [qx0, qx1] = spanOf(q, 0);
        if (Math.abs(px0 - qx0) > tol || Math.abs(px1 - qx1) > tol) continue;
        const y0 = Math.min(p.a[1], q.a[1]);
        const y1 = Math.max(p.a[1], q.a[1]);
        const h = y1 - y0;
        if (h < minSide || h > maxSide) continue;
        if (!joined(y0, y1, px0, vAtSpan, 1) && !joined(y0, y1, px1, vAtSpan, 1)) continue;
        add(
          [
            [px0, y0],
            [px1, y0],
            [px1, y1],
            [px0, y1],
          ],
          Math.max(px1 - px0, h),
          Math.min(px1 - px0, h),
        );
      }
  }

  // inner strokes: small paths inside the outline that are not its own sides
  const small = paths.filter((p) => size(p) <= maxSide);
  return found.map((f) => {
    let strokes = 0;
    for (const p of small) {
      if (!inside(p, f.box, 0.6)) continue;
      // a side lies on the box edge: skip paths that are flat against an edge
      const onEdge =
        (p.y1 - p.y0 <= 0.6 && (Math.abs(p.y0 - f.box.y0) <= 0.6 || Math.abs(p.y0 - f.box.y1) <= 0.6)) ||
        (p.x1 - p.x0 <= 0.6 && (Math.abs(p.x0 - f.box.x0) <= 0.6 || Math.abs(p.x0 - f.box.x1) <= 0.6)) ||
        (p.pts.length >= 4 && inside(f.box, p, 0.6));
      if (!onEdge) strokes++;
    }
    return {
      ...f.box,
      cx: (f.box.x0 + f.box.x1) / 2,
      cy: (f.box.y0 + f.box.y1) / 2,
      strokes,
      sig: `${Math.round(f.w)}x${Math.round(f.h)}`,
      corners: f.corners,
    };
  });
}

/** The glyph a point lands on (within `m` points of its box), the nearest when several. */
function glyphAt(gs: readonly Glyph[], p: Pt, m: number): Glyph | null {
  let best: Glyph | null = null;
  let bd = Infinity;
  for (const g of gs) {
    if (p[0] < g.x0 - m || p[0] > g.x1 + m || p[1] < g.y0 - m || p[1] > g.y1 + m) continue;
    const d = dist(p, [g.cx, g.cy]);
    if (d < bd) {
      bd = d;
      best = g;
    }
  }
  return best;
}

export interface PlaceOptions {
  /** a leader starts within this of the tag's box (points) and ends within half of it of the glyph */
  reach?: number;
  /** a tag without a leader takes a glyph within this (points) */
  nearest?: number;
  /** the n − 1 other devices of a TYP n tag lie within this of the first (points) */
  typRadius?: number;
}

/** distance from a point to a box's edge: 0 inside */
const boxDist = (p: Pt, b: Box) =>
  Math.hypot(Math.max(b.x0 - p[0], 0, p[0] - b.x1), Math.max(b.y0 - p[1], 0, p[1] - b.y1));
/** how far inside a box a point is (0 outside) */
const depth = (p: Pt, b: Box) => Math.max(0, Math.min(p[0] - b.x0, b.x1 - p[0], p[1] - b.y0, b.y1 - p[1]));

/**
 * Each tag's devices placed on the sheet. A leader is a path of 2 to 4 points, 8 to 400 points long, that starts
 * just outside the tag (not through it) and ends on a glyph.
 */
export function placeDevices(
  devices: readonly PlanDevice[],
  paths: readonly PlanPath[],
  gs: readonly Glyph[],
  opts: PlaceOptions = {},
): PlacedDevice[] {
  const reach = opts.reach ?? 10;
  const nearest = opts.nearest ?? 70;
  const typRadius = opts.typRadius ?? 600;
  const leaders = paths.filter((p) => {
    if (p.pts.length < 2 || p.pts.length > 4 || p.closed || p.paint === 'fill') return false;
    const len = dist(p.pts[0], p.pts[p.pts.length - 1]);
    return len >= 8 && len <= 400;
  });
  const claimed = new Set<Glyph>();
  const first = new Map<PlanDevice, { glyph: Glyph | null; how: PlacedDevice['how'] }>();
  for (const d of devices) {
    const box = d.box;
    // candidate leaders: one end at the tag (outside it, within reach; a hexagon's leader starts on its outline),
    // the other end away from it; nearest start first
    const cands: { far: Pt; near: number }[] = [];
    for (const l of leaders) {
      const [a, b] = ends(l);
      const da = boxDist(a, box);
      const db = boxDist(b, box);
      const pick = (n: Pt, f: Pt, dn: number, df: number) => {
        if (dn <= reach && depth(n, box) <= 1.5 && df > reach && df > dn + 6) cands.push({ far: f, near: dn });
      };
      pick(a, b, da, db);
      pick(b, a, db, da);
    }
    cands.sort((x, y) => x.near - y.near);
    let found: Glyph | null = null;
    for (const c of cands) {
      const g = glyphAt(
        gs.filter((x) => !claimed.has(x)),
        c.far,
        reach / 2,
      );
      if (g) {
        found = g;
        break;
      }
    }
    if (found) claimed.add(found);
    first.set(d, { glyph: found, how: found ? 'leader' : 'tag' });
  }
  // the sheet's device symbols: the signatures leaders led to
  const deviceSigs = new Set([...first.values()].flatMap((f) => (f.glyph ? [f.glyph.sig] : [])));
  const out: PlacedDevice[] = [];
  for (const d of devices) {
    const f = first.get(d)!;
    if (!f.glyph && deviceSigs.size) {
      let best: Glyph | null = null;
      let bd = nearest;
      for (const g of gs) {
        if (claimed.has(g) || !deviceSigs.has(g.sig)) continue;
        const dd = dist([d.x, d.y], [g.cx, g.cy]);
        if (dd < bd) {
          bd = dd;
          best = g;
        }
      }
      if (best) {
        claimed.add(best);
        f.glyph = best;
        f.how = 'nearest';
      }
    }
    const anchor: Pt = f.glyph ? [f.glyph.cx, f.glyph.cy] : [d.x, d.y];
    out.push({ device: d, index: 0, x: anchor[0], y: anchor[1], glyph: f.glyph, how: f.how });
    // the other devices of a TYP n tag: same symbol, nearest first
    const sig = f.glyph?.sig;
    for (let k = 1; k < d.count; k++) {
      let best: Glyph | null = null;
      let bd = typRadius;
      if (sig)
        for (const g of gs) {
          if (claimed.has(g) || g.sig !== sig) continue;
          const dd = dist(anchor, [g.cx, g.cy]);
          if (dd < bd) {
            bd = dd;
            best = g;
          }
        }
      if (best) {
        claimed.add(best);
        out.push({ device: d, index: k, x: best.cx, y: best.cy, glyph: best, how: 'typ' });
      } else out.push({ device: d, index: k, x: d.x, y: d.y, glyph: null, how: 'tag' });
    }
  }
  return out;
}

/**
 * Tag frames: small closed outlines (hexagons, boxes; 5+ points, all on the outline's box) with strokes inside, the
 * plotted text of a tag. For a page without a text layer these are what to read with text recognition.
 */
export function tagFrames(paths: readonly PlanPath[], opts: { minInside?: number } = {}): Frame[] {
  const minInside = opts.minInside ?? 10;
  const frameLike = (p: PlanPath) => {
    const w = p.x1 - p.x0;
    const h = p.y1 - p.y0;
    if (p.pts.length < 5 || w < 16 || w > 80 || h < 8 || h > 45 || w / h < 1.1 || w / h > 4) return false;
    const tol = 0.15 * Math.min(w, h);
    return p.pts.every(([x, y]) => Math.min(x - p.x0, p.x1 - x, y - p.y0, p.y1 - y) <= tol);
  };
  const small = paths.filter((p) => size(p) < 30);
  const out: Frame[] = [];
  for (const c of paths) {
    if (!frameLike(c)) continue;
    if (out.some((u) => Math.abs(u.x0 - c.x0) < 3 && Math.abs(u.y0 - c.y0) < 3)) continue;
    let n = 0;
    for (const p of small) {
      if (p === c) continue;
      if (inside(p, c, 0.5)) n += p.pts.length;
      if (n >= minInside) break;
    }
    if (n >= minInside) out.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 });
  }
  return out;
}
