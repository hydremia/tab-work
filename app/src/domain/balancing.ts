/**
 * Balancing assistant for one valve system: NEBB's proportional (ratio) method (Procedural Standard 9.4.1).
 *
 * From the first pass of readings (each valve's initial flow against its design):
 *  1. the valve at the lowest % of design is the reference: it is not adjusted (it stays wide open);
 *  2. every other valve is throttled, in order from the next-lowest %, until it reads the same % as the reference
 *     (target = design × the reference's %); as later valves are throttled the reference's % rises, so re-read it;
 *  3. then the pump is adjusted until every valve is at design ±10 % (tolerance), with at least one valve wide open.
 * With final readings entered the plan shows which valves are done (final within ±5 % of target) and whether the
 * system is balanced (every final within tolerance, a wide-open valve recorded).
 */
import type { FieldValue } from '../data/types';
import { withinTolerance } from './calc';

type Row = { id: string; data: Readonly<Record<string, FieldValue | undefined>> };
const num = (v: FieldValue | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export interface BalanceStep {
  id: string;
  tag: string;
  design: number;
  initial: number;
  /** initial / design */
  ratio: number;
  /** The flow to set it to (design × the reference's %). null for the reference. */
  target: number | null;
  final: number | null;
  /** final within ±5 % of target (reference: always). */
  done: boolean;
}

export interface BalancePlan {
  /** Rows with a design and an initial flow, lowest % first (the first is the reference). */
  steps: BalanceStep[];
  reference: BalanceStep | null;
  /** Rows left out: no design or no initial reading yet. */
  waiting: number;
  /** Final readings within the project tolerance of design (among rows with a final). */
  finalsWithin: number;
  finals: number;
  wideOpen: number;
  /** Every valve has a final within tolerance and at least one is recorded wide open. */
  balanced: boolean;
}

export function balancingPlan(rows: readonly Row[], tolerance: number): BalancePlan {
  const usable: BalanceStep[] = [];
  let waiting = 0;
  for (const r of rows) {
    const design = num(r.data.designGpm);
    const initial = num(r.data.initialGpm);
    if (design === null || design <= 0 || initial === null) {
      waiting++;
      continue;
    }
    usable.push({
      id: r.id,
      tag: typeof r.data.tag === 'string' && r.data.tag ? r.data.tag : `row ${usable.length + waiting}`,
      design,
      initial,
      ratio: initial / design,
      target: null,
      final: num(r.data.finalGpm),
      done: false,
    });
  }
  usable.sort((a, b) => a.ratio - b.ratio);
  const reference = usable[0] ?? null;
  for (const s of usable) {
    if (s === reference) {
      s.done = true;
      continue;
    }
    s.target = s.design * reference!.ratio;
    s.done = s.final !== null && Math.abs(s.final / s.target - 1) <= 0.05;
  }
  const withFinal = rows
    .map((r) => ({ d: num(r.data.designGpm), f: num(r.data.finalGpm) }))
    .filter((x) => x.f !== null);
  const finalsWithin = withFinal.filter(
    (x) => x.d !== null && x.d > 0 && withinTolerance(x.f! / x.d, tolerance),
  ).length;
  const wideOpen = rows.filter((r) => typeof r.data.wideOpen === 'string' && r.data.wideOpen !== '').length;
  return {
    steps: usable,
    reference,
    waiting,
    finalsWithin,
    finals: withFinal.length,
    wideOpen,
    balanced: rows.length > 0 && withFinal.length === rows.length && finalsWithin === rows.length && wideOpen > 0,
  };
}
