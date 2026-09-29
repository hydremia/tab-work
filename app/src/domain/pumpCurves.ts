/**
 * Pump curves (the shared pump library, data/types.ts LibraryPump): head vs flow per impeller diameter at the
 * catalogue speed, from the manufacturer's published curve. What the field test gets from them:
 *
 *   impeller from the shut-off head   the gauges at no flow give the shut-off head; between the two catalogue
 *                                     impellers whose shut-off heads bracket it, the diameter is interpolated
 *                                     linearly (after correcting the curves to the measured speed)
 *   flow from the final head (TDH)    on the curve of that impeller, the flow where the curve's head equals the
 *                                     final head
 *   speed                             affinity laws: flow × (N / N₀), head × (N / N₀)²
 *
 * Nothing is extrapolated: a head above the largest impeller's shut-off, below the smallest's, or past the end of
 * a curve gives no answer (with the reason). "Pump curve" is a flow method of the pump sheet (NEBB 9.4): the result
 * is an estimate the tech takes into Actual GPM only by tapping.
 */
import type { LibraryPump, PumpCurvePoint } from '../data/types';

export type Curve = readonly PumpCurvePoint[];

/** Head at a flow (linear between points), null outside the curve. Points sorted by flow. */
export function headAt(curve: Curve, gpm: number): number | null {
  if (!curve.length || gpm < curve[0].gpm || gpm > curve[curve.length - 1].gpm) return null;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (gpm <= b.gpm) return b.gpm === a.gpm ? b.head : a.head + ((gpm - a.gpm) / (b.gpm - a.gpm)) * (b.head - a.head);
  }
  return curve[0].head;
}

/** Flow where the curve's head equals `head` (the curve falls with flow), null when it never does. */
export function flowAt(curve: Curve, head: number): number | null {
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    const lo = Math.min(a.head, b.head);
    const hi = Math.max(a.head, b.head);
    if (head < lo || head > hi) continue;
    if (a.head === b.head) return a.gpm;
    return a.gpm + ((head - a.head) / (b.head - a.head)) * (b.gpm - a.gpm);
  }
  return null;
}

/** A curve at another speed (affinity laws). */
export function atSpeed(curve: Curve, ratio: number): PumpCurvePoint[] {
  return curve.map((p) => ({ gpm: p.gpm * ratio, head: p.head * ratio * ratio }));
}

/** The curve between two catalogue curves: heads interpolated at each flow of the shorter curve's range. */
function between(a: Curve, b: Curve, t: number): PumpCurvePoint[] {
  const maxQ = Math.min(a[a.length - 1].gpm, b[b.length - 1].gpm);
  const qs = [...new Set([...a, ...b].map((p) => p.gpm).filter((q) => q <= maxQ))].sort((x, y) => x - y);
  return qs.map((q) => ({ gpm: q, head: headAt(a, q)! + t * (headAt(b, q)! - headAt(a, q)!) }));
}

const sorted = (pump: Pick<LibraryPump, 'curves'>) =>
  (pump.curves ?? [])
    .filter((c) => c.points.length >= 2)
    .map((c) => ({ impeller: c.impeller, points: [...c.points].sort((p, q) => p.gpm - q.gpm) }))
    .sort((a, b) => a.impeller - b.impeller);

export interface CurveResult {
  /** estimated impeller diameter (in.) */
  impeller: number | null;
  /** flow at the final head (GPM) */
  gpm: number | null;
  /** the curve used (at the measured speed), for the graphics */
  curve: PumpCurvePoint[] | null;
  note: string;
}

/**
 * The impeller from the shut-off head and the flow at the final head. `impeller`: a known diameter (the pump's
 * nameplate / actual impeller) is used instead of the shut-off estimate. `rpm`: the measured speed (the curves'
 * speed when not given).
 */
export function pumpCurveResult(
  pump: Pick<LibraryPump, 'curves' | 'rpm'>,
  input: { shutoffHead: number | null; finalHead: number | null; impeller?: number | null; rpm?: number | null },
): CurveResult {
  const curves = sorted(pump);
  const none = (note: string): CurveResult => ({ impeller: null, gpm: null, curve: null, note });
  if (!curves.length) return none('no curves in the library entry');
  const ratio = input.rpm && pump.rpm ? input.rpm / pump.rpm : 1;
  const cs = curves.map((c) => ({ impeller: c.impeller, points: atSpeed(c.points, ratio) }));
  let curve: PumpCurvePoint[] | null = null;
  let impeller: number | null = null;
  let how = '';
  if (input.impeller) {
    impeller = input.impeller;
    const exact = cs.find((c) => c.impeller === impeller);
    const hi = cs.findIndex((c) => c.impeller > impeller!);
    if (exact) curve = exact.points;
    else if (hi > 0) {
      const a = cs[hi - 1];
      const b = cs[hi];
      curve = between(a.points, b.points, (impeller - a.impeller) / (b.impeller - a.impeller));
    } else return none(`impeller ${impeller}″ is outside the catalogue curves`);
    how = 'impeller as entered';
  } else {
    if (input.shutoffHead === null) return none('needs the shut-off head (or the impeller) to pick the curve');
    const h = input.shutoffHead;
    const shut = cs.map((c) => c.points[0].head);
    if (cs.length === 1 || h < shut[0] || h > shut[shut.length - 1]) {
      const only = cs.length === 1 && Math.abs(h - shut[0]) <= shut[0] * 0.05;
      if (!only)
        return none(
          `shut-off head ${h.toFixed(1)} ft is outside the curves (${shut[0].toFixed(1)}–${shut[shut.length - 1].toFixed(1)} ft)`,
        );
      impeller = cs[0].impeller;
      curve = cs[0].points;
    } else {
      const hi = shut.findIndex((s) => s >= h);
      if (hi === 0) {
        impeller = cs[0].impeller;
        curve = cs[0].points;
      } else {
        const t = (h - shut[hi - 1]) / (shut[hi] - shut[hi - 1]);
        impeller = cs[hi - 1].impeller + t * (cs[hi].impeller - cs[hi - 1].impeller);
        curve = between(cs[hi - 1].points, cs[hi].points, t);
      }
    }
    how = 'impeller from the shut-off head';
  }
  const speed = ratio !== 1 ? `, curves corrected to ${input.rpm} rpm` : '';
  if (input.finalHead === null) return { impeller, gpm: null, curve, note: `${how}${speed}; needs the final head` };
  const gpm = flowAt(curve, input.finalHead);
  return {
    impeller,
    gpm,
    curve,
    note:
      gpm === null
        ? `final head ${input.finalHead.toFixed(1)} ft is off the curve`
        : `${how}, flow at the final head${speed}`,
  };
}

/** "gpm head" lines -> points (sorted by flow); anything else is skipped. */
export function parseCurvePoints(text: string): PumpCurvePoint[] {
  const out: PumpCurvePoint[] = [];
  for (const line of text.split(/[\n;]+/)) {
    const m = /^\s*(-?\d+(?:\.\d+)?)[\s,\t]+(-?\d+(?:\.\d+)?)\s*$/.exec(line);
    if (m) out.push({ gpm: Number(m[1]), head: Number(m[2]) });
  }
  return out.sort((a, b) => a.gpm - b.gpm);
}

export const formatCurvePoints = (pts: readonly PumpCurvePoint[]) => pts.map((p) => `${p.gpm} ${p.head}`).join('\n');

export const pumpName = (p: Pick<LibraryPump, 'make' | 'model' | 'size'>) =>
  [p.make, p.model, p.size].filter(Boolean).join(' ');
