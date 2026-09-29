import { describe, expect, it } from 'vitest';
import { balancingPlan } from './balancing';

const row = (
  id: string,
  design: number | null,
  initial: number | null,
  final: number | null = null,
  wideOpen = '',
) => ({
  id,
  data: { tag: id, designGpm: design, initialGpm: initial, finalGpm: final, wideOpen },
});

describe('balancing assistant (NEBB 9.4.1 proportional method)', () => {
  it('the lowest % is the reference; the others get design × its % as target, in order', () => {
    const p = balancingPlan([row('V1', 10, 13), row('V2', 20, 12), row('V3', 10, 9), row('V4', 5, null)], 0.1);
    expect(p.reference?.tag).toBe('V2'); // 60 %
    expect(p.steps.map((s) => s.tag)).toEqual(['V2', 'V3', 'V1']);
    expect(p.steps[1].target).toBeCloseTo(6, 9); // 10 × 60 %
    expect(p.steps[2].target).toBeCloseTo(6, 9);
    expect(p.waiting).toBe(1);
    expect(p.balanced).toBe(false);
  });

  it('done: final within ±5 % of target; balanced: every final within tolerance and a valve wide open', () => {
    const p = balancingPlan([row('V1', 10, 13, 6.1), row('V2', 20, 12, 19.5, '✓'), row('V3', 10, 9, 7)], 0.1);
    expect(p.steps.find((s) => s.tag === 'V1')?.done).toBe(true); // 6.1 vs 6
    expect(p.steps.find((s) => s.tag === 'V3')?.done).toBe(false); // 7 vs 6
    expect(p.finalsWithin).toBe(1); // only V2 is within ±10 % of design
    const ok = balancingPlan([row('V1', 10, 13, 10.2), row('V2', 20, 12, 19.5, '✓')], 0.1);
    expect(ok.balanced).toBe(true);
    expect(balancingPlan([row('V1', 10, 13, 10.2), row('V2', 20, 12, 19.5)], 0.1).balanced).toBe(false); // none WO
  });
});
