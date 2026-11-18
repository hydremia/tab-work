/**
 * A tech's markup into systems (Import markup; pure). On the a2b markups every outlet gets a text box with its label
 * and each system a filled polygon in its colour:
 *
 *   label     <unit letters><unit number><side><letter>: "3A" (unit 3, outlet A), "1RA" (unit 1, return A),
 *             "D1B" (DOAS-1, outlet B), "E1C" (EF-1, inlet C), "2OA" (unit 2, outside air A). Unit letters are
 *             optional: none means the packaged unit of that number (RTU, WSHP, AHU …).
 *   group     labels with the same prefix (letters + number + side) are one system, in the order of their letters
 *   unit      the project's unit whose designation number matches and whose kind matches the letters best
 *   table     R → return inlets, O → outside air, else the unit's first airflow table (supply outlets, or a fan's /
 *             VAV's outlets)
 *   device    the nearest plan device (the tag the plan reader found) within reach, each device at most once; a label
 *             with no device still makes a row (the tech can fill the type and CFM)
 *   polygon   the drawn shape holding most of the group's labels, else a hull round them
 */
import type { Equipment, PlanSheetDevice } from '../data/types';
import { equipmentType } from './equipmentTypes';
import { getSpec } from './specs';
import type { MarkupLabel, MarkupShape } from '../workbook/pdfAnnotations';
import { hull } from '../workbook/pdfAnnotations';
import { pointInPolygon, SYSTEM_COLORS, type Pt } from './planSystems';

export interface ParsedLabel {
  text: string;
  /** unit letters ("" / "D" / "E" / "V" / "RTU"), the unit number ("1", "12") and the side ("", "R", "O") */
  letters: string;
  number: string;
  side: '' | 'R' | 'O';
  letter: string;
  /** letters + number + side: the system key */
  prefix: string;
}

const LABEL_RE = /^([A-Z]{0,4}?)[-\s]?(\d{1,3})[-\s]?(?:([RO])(?=[A-Z]{1,2}$))?([A-Z]{1,2})$/;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** "1RA" → unit 1, return, A; null when the text is not an outlet label. */
export function parseLabel(text: string): ParsedLabel | null {
  const t = text.trim().toUpperCase().replace(/\s+/g, '');
  const m = LABEL_RE.exec(t);
  if (!m) return null;
  const [, letters, number, side, letter] = m;
  // "E1A" is exhaust fan 1's inlet A, not a side; the side letter only counts after the number
  return {
    text: text.trim(),
    letters,
    number,
    side: (side ?? '') as ParsedLabel['side'],
    letter,
    prefix: `${letters}${number}${side ?? ''}`,
  };
}

/** Order of a letter on the markup: A, B … H, J … (I and O skipped), then AA …; an unexpected letter sorts by code. */
export function letterOrder(letter: string): number {
  const l = letter.toUpperCase();
  if (l.length === 1) {
    const i = LETTERS.indexOf(l);
    return i >= 0 ? i : 100 + l.charCodeAt(0);
  }
  const a = LETTERS.indexOf(l[0]);
  const b = LETTERS.indexOf(l[1]);
  return a >= 0 && b >= 0 ? LETTERS.length * (a + 1) + b : 1000 + l.charCodeAt(0) * 26 + l.charCodeAt(1);
}

/** How well a unit's designation fits the label's letters and number (0: not at all). */
export function unitScore(
  label: Pick<ParsedLabel, 'letters' | 'number'>,
  unit: Pick<Equipment, 'designation' | 'type'>,
): number {
  const m = /^([A-Za-z]*)[-\s]*(\d+[A-Za-z]?)$/.exec(unit.designation.trim());
  if (!m) return 0;
  const [, letters, number] = m;
  if (number.toUpperCase() !== label.number.toUpperCase()) return 0;
  const L = letters.toUpperCase();
  const P = label.letters;
  const family = equipmentType(unit.type).discipline === 'air' ? unit.type : null;
  if (!family) return 0;
  if (P === L) return 5;
  if (P && L.startsWith(P)) return 4; // D → DOAS, E → EF / ERV, V → VAV, W → WSHP
  if (P === 'E' && /^(K?EF|SEF|GEF|TF|RF)$/.test(L)) return 4;
  if (!P && /^(RTU|AHU|AH|WSHP|HP|AC|ACU|PKG|DOAS|DOAU|MAU|ERV|HRV)$/.test(L))
    return /^(RTU|AHU|WSHP|HP|AC|ACU|PKG)$/.test(L) ? 3 : 2;
  if (!P && unit.type === 'rtu') return 2;
  return P ? 0 : 1;
}

export interface MarkupItem {
  label: ParsedLabel;
  /** where the label sits */
  x: number;
  y: number;
  /** the plan device matched to the label, or null */
  device: PlanSheetDevice | null;
  distance: number | null;
}

export interface MarkupSystem {
  prefix: string;
  /** the unit chosen (best score) and the other candidates, best first */
  unit: Equipment | null;
  candidates: Equipment[];
  table: string;
  items: MarkupItem[];
  polygon: Pt[];
  color: string;
  /** labels the markup repeats (e.g. two "3A"): kept in order, worth a look */
  duplicates: string[];
}

export interface MarkupImportOptions {
  /** a label's device is within this of it (points) */
  reach?: number;
}

/** The table a side letter names, else the unit's first tolerance table. */
export function tableFor(unit: Pick<Equipment, 'type'>, side: ParsedLabel['side']): string {
  const tables = getSpec(unit.type).sections.flatMap((s) => s.tables ?? []);
  if (side === 'R' && tables.some((t) => t.key === 'return')) return 'return';
  if (side === 'O' && tables.some((t) => t.key === 'oa')) return 'oa';
  return tables[0]?.key ?? 'supply';
}

/**
 * Systems from a page's annotations. Unknown text boxes (notes, dimensions) are left out; labels are grouped by
 * prefix, matched to units and devices, and ordered by letter.
 */
export function markupSystems(
  labels: readonly MarkupLabel[],
  shapes: readonly MarkupShape[],
  equipment: readonly Equipment[],
  devices: readonly PlanSheetDevice[],
  opts: MarkupImportOptions = {},
): MarkupSystem[] {
  const reach = opts.reach ?? 70;
  const parsed = labels.flatMap((l) => {
    const p = parseLabel(l.text);
    return p ? [{ p, l }] : [];
  });
  const groups = new Map<string, { p: ParsedLabel; l: MarkupLabel }[]>();
  for (const x of parsed) (groups.get(x.p.prefix) ?? groups.set(x.p.prefix, []).get(x.p.prefix)!).push(x);
  const units = equipment.filter((e) => equipmentType(e.type).discipline === 'air');
  // labels to devices: the assignment with the least total distance (a greedy nearest-first match would hand a
  // device to the neighbouring label when labels sit beside their devices in a row)
  const match = assignLabels(
    parsed.map((x) => x.l),
    devices,
    reach,
  );
  const out: MarkupSystem[] = [];
  let k = 0;
  for (const [prefix, members] of groups) {
    members.sort((a, b) => letterOrder(a.p.letter) - letterOrder(b.p.letter) || a.l.y - b.l.y || a.l.x - b.l.x);
    const sample = members[0].p;
    const candidates = units
      .map((u) => ({ u, s: unitScore(sample, u) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.u.designation.localeCompare(b.u.designation, undefined, { numeric: true }))
      .map((x) => x.u);
    const unit = candidates[0] ?? null;
    const items: MarkupItem[] = members.map(({ p, l }) => {
      const m = match.get(l);
      return { label: p, x: l.x, y: l.y, device: m?.d ?? null, distance: m?.dist ?? null };
    });
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const it of items) {
      const key = it.label.letter;
      if (seen.has(key)) duplicates.push(it.label.text);
      seen.add(key);
    }
    // the shape holding most of the labels (at least half), else a hull round them
    const pts = items.map((it) => [it.x, it.y] as Pt);
    let best: MarkupShape | null = null;
    let bestN = 0;
    for (const sh of shapes) {
      const n = pts.filter((q) => pointInPolygon(q, sh.points)).length;
      if (n > bestN) {
        bestN = n;
        best = sh;
      }
    }
    const polygon = best && bestN >= Math.ceil(items.length / 2) ? best.points : padHull(pts);
    const color = members.find((m) => m.l.color)?.l.color ?? best?.color ?? SYSTEM_COLORS[k % SYSTEM_COLORS.length];
    out.push({
      prefix,
      unit,
      candidates,
      table: unit ? tableFor(unit, sample.side) : 'supply',
      items,
      polygon,
      color,
      duplicates,
    });
    k++;
  }
  return out.sort((a, b) => a.prefix.localeCompare(b.prefix, undefined, { numeric: true }));
}

/** A hull round points, pushed out by 14 points (a lasso the labels sit inside). */
export function padHull(points: readonly Pt[]): Pt[] {
  if (!points.length) return [];
  if (points.length < 3) {
    const [x, y] = points[0];
    const [x1, y1] = points[points.length - 1];
    const x0 = Math.min(x, x1) - 14;
    const y0 = Math.min(y, y1) - 14;
    const x2 = Math.max(x, x1) + 14;
    const y2 = Math.max(y, y1) + 14;
    return [
      [x0, y0],
      [x2, y0],
      [x2, y2],
      [x0, y2],
    ];
  }
  const h = hull(points);
  const cx = h.reduce((a, p) => a + p[0], 0) / h.length;
  const cy = h.reduce((a, p) => a + p[1], 0) / h.length;
  return h.map(([x, y]) => {
    const d = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / d) * 14, y + ((y - cy) / d) * 14] as Pt;
  });
}

/**
 * Each label's device, by the assignment with the least total distance among pairs within `reach` (Hungarian
 * method on the dense cost matrix; a few hundred labels at most on a sheet).
 */
export function assignLabels(
  labels: readonly MarkupLabel[],
  devices: readonly PlanSheetDevice[],
  reach: number,
): Map<MarkupLabel, { d: PlanSheetDevice; dist: number }> {
  const out = new Map<MarkupLabel, { d: PlanSheetDevice; dist: number }>();
  if (!labels.length || !devices.length) return out;
  const BIG = 1e6;
  const n = Math.max(labels.length, devices.length);
  const cost: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i >= labels.length || j >= devices.length) return BIG;
      const dist = Math.hypot(devices[j].x - labels[i].x, devices[j].y - labels[i].y);
      return dist <= reach ? dist : BIG;
    }),
  );
  const assignment = hungarian(cost);
  assignment.forEach((j, i) => {
    if (i < labels.length && j < devices.length && cost[i][j] < BIG)
      out.set(labels[i], { d: devices[j], dist: cost[i][j] });
  });
  return out;
}

/** Kuhn–Munkres on a square cost matrix: the column assigned to each row. */
export function hungarian(cost: readonly (readonly number[])[]): number[] {
  const n = cost.length;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const result = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] > 0) result[p[j] - 1] = j - 1;
  return result;
}
