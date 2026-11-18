/**
 * From a plan's devices to a unit's airflow table (ROADMAP §7.3 step 2, the user's part; pure). The user lassos the
 * devices of one system on the sheet; the app orders them the way the a2b markups letter outlets and builds the rows.
 *
 *   lasso     devices whose place is inside the polygon (even-odd rule)
 *   order     a walk: start at the top-left device (least x + y) or the one the user tapped, then always the nearest
 *             device not yet visited. This reproduces the Trader Joe's 876 Orlando markup letter for letter: down one
 *             branch, along the far end and back up the other side, rather than left to right across the sheet.
 *   letters   A, B, C … without I and O (the report's rows: … H, J, K … N, P, Q), then AA, AB …
 *   rows      No. = letter, type and size as tagged (Ø → R, the report's round mark), design CFM; Ak comes from the
 *             air device schedule, not the plan
 *   check     the devices' design total against the unit's design CFM (the schedule), when both are known
 */
import type { PlanSheetDevice, PlanSystem } from '../data/types';

export type Pt = [number, number];

/** Even-odd point in polygon. */
export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The devices inside a lasso. */
export function devicesInLasso<T extends { x: number; y: number }>(devices: readonly T[], poly: readonly Pt[]): T[] {
  if (poly.length < 3) return [];
  return devices.filter((d) => pointInPolygon([d.x, d.y], poly));
}

/** Letters A… without I and O; past Z: AA, AB … */
export function rowLetter(i: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const n = alphabet.length;
  if (i < n) return alphabet[i];
  return `${alphabet[Math.floor(i / n) - 1]}${alphabet[i % n]}`;
}

/**
 * Walk order: from the start (the top-left device unless given), always to the nearest device not yet visited.
 */
export function walkOrder<T extends { x: number; y: number }>(devices: readonly T[], start?: T): T[] {
  if (!devices.length) return [];
  const left = new Set(devices);
  let cur = start && left.has(start) ? start : devices.reduce((m, d) => (d.x + d.y < m.x + m.y ? d : m));
  const out: T[] = [];
  for (;;) {
    out.push(cur);
    left.delete(cur);
    if (!left.size) break;
    let best: T | null = null;
    let bd = Infinity;
    for (const d of left) {
      const dd = Math.hypot(d.x - cur.x, d.y - cur.y);
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    cur = best!;
  }
  return out;
}

/** The size as the report writes it: 8"Ø → 8"R; 12"x8" kept; stray spaces dropped. */
export function reportSize(size: string | null): string | null {
  if (!size) return null;
  return size
    .replace(/\s+/g, '')
    .replace(/[”]/g, '"')
    .replace(/(\d)(?:"?)(?:Ø|∅|ø|DIA\.?|RD\.?|D)$/i, '$1"R')
    .replace(/×/g, 'x');
}

export interface PlanRowData {
  no: string;
  area: string | null;
  type: string;
  size: string | null;
  designCfm: number | null;
}

/** The rows a system's devices make, in order: letter, area served (the unit's), type, size, design CFM. */
export function rowsForDevices(
  devices: readonly PlanSheetDevice[],
  area: string | null,
  nos?: readonly string[],
): PlanRowData[] {
  return devices.map((d, i) => ({
    no: nos?.[i] ?? rowLetter(i),
    area: area ?? null,
    type: d.type,
    size: reportSize(d.size),
    designCfm: d.cfm,
  }));
}

/** Design total of devices with a CFM; null when none has one. */
export function designTotal(devices: readonly Pick<PlanSheetDevice, 'cfm'>[]): number | null {
  let any = false;
  let t = 0;
  for (const d of devices)
    if (d.cfm !== null) {
      any = true;
      t += d.cfm;
    }
  return any ? t : null;
}

/** How the devices' design total compares with the unit's design CFM: the difference as a share of the unit's. */
export function designCheck(
  devices: readonly Pick<PlanSheetDevice, 'cfm'>[],
  unitDesign: number | null,
): { total: number | null; unit: number | null; ratio: number | null; ok: boolean | null } {
  const total = designTotal(devices);
  if (total === null || unitDesign === null || !(unitDesign > 0))
    return { total, unit: unitDesign, ratio: null, ok: null };
  const ratio = total / unitDesign;
  return { total, unit: unitDesign, ratio, ok: Math.abs(ratio - 1) <= 0.05 };
}

/** The markup colours, one per system in the order they are made (the a2b markups' pink, blue, orange, green…). */
export const SYSTEM_COLORS = ['#ff809d', '#38e5ff', '#ff7002', '#6ad928', '#ffd100', '#b388ff', '#ff5252', '#26c6da'];

export function nextSystemColor(systems: readonly Pick<PlanSystem, 'color'>[]): string {
  const used = new Set(systems.map((s) => s.color));
  return SYSTEM_COLORS.find((c) => !used.has(c)) ?? SYSTEM_COLORS[systems.length % SYSTEM_COLORS.length];
}

/**
 * The label prefix of a system on the markup, from the unit's designation and the table: RTU-1 supply → "1",
 * RTU-1 return → "1R", DOAS-1 → "D1", EF-1 (exhaust inlets) → "E1", a VAV box's outlets → "V3".
 */
export function systemPrefix(designation: string, table: string): string {
  const m = /^([A-Za-z]*)[-\s]*(\d+[A-Za-z]?)$/.exec(designation.trim());
  const letters = (m?.[1] ?? designation.replace(/[^A-Za-z]/g, '')).toUpperCase();
  const number = m?.[2] ?? '';
  const typeLetter = /^RTU|^AHU|^AC$|^HP|^WSHP/.test(letters)
    ? ''
    : letters.startsWith('EF') || letters.startsWith('KEF')
      ? 'E'
      : letters.charAt(0);
  const tableLetter = table === 'return' ? 'R' : table === 'oa' ? 'O' : table === 'exhaust' && !typeLetter ? 'E' : '';
  return `${typeLetter}${number}${tableLetter}`;
}

/** The label of a device on the markup: prefix + letter ("1A", "1RB", "D1C"). */
export const deviceLabel = (prefix: string, i: number) => `${prefix}${rowLetter(i)}`;

/**
 * Whether the system came from the tech's own markup (Import markup) rather than a lasso in the app: the drawing is
 * the markup, so the app adds no polygon or labels of its own for it. Systems imported before `source` was recorded
 * are told by their kept labels.
 */
export const fromMarkup = (system: Pick<PlanSystem, 'source' | 'labels'>) =>
  system.source === 'markup' || Boolean(system.labels);

/** A system's label for its i-th device: as the tech wrote it when the system came from a markup, else prefix + letter. */
export const systemLabel = (system: Pick<PlanSystem, 'prefix' | 'labels'>, i: number) =>
  system.labels?.[i] ?? deviceLabel(system.prefix, i);

/** The row No. of a system's i-th device: the tech's letter (the label without the prefix) or A, B, C … */
export const systemRowNo = (system: Pick<PlanSystem, 'prefix' | 'labels'>, i: number) => {
  const l = system.labels?.[i];
  if (!l) return rowLetter(i);
  return l.toUpperCase().startsWith(system.prefix.toUpperCase()) && l.length > system.prefix.length
    ? l.slice(system.prefix.length)
    : l;
};
