import { describe, expect, it } from 'vitest';
import { rollup } from './completion';
import { dashboardRow, dashboardTotals, filterRows, sortRows, type DashboardInput } from './dashboard';

const input = (over: Partial<DashboardInput> & { name: string }): DashboardInput => ({
  project: { id: over.name, name: over.name, info: { address: `${over.name} St`, tabDate: '2026-09-01' } },
  total: rollup([]),
  byType: new Map(),
  openIssues: { new: 0, existing: 0, onUnits: 0 },
  attention: 0,
  conflicts: 0,
  lastExport: { label: null, at: null, changesSince: 0 },
  lastActivity: null,
  unsynced: 0,
  ...over,
});

describe('PM dashboard rows', () => {
  it('stage: empty, in progress, ready (all reviewed, no open unit issue, no conflict), issued', () => {
    expect(dashboardRow(input({ name: 'A' })).stage).toBe('empty');
    expect(dashboardRow(input({ name: 'B', total: rollup(['green', 'amber']) })).stage).toBe('in-progress');
    expect(dashboardRow(input({ name: 'C', total: rollup(['blue', 'blue']) })).stage).toBe('ready');
    expect(
      dashboardRow(input({ name: 'D', total: rollup(['blue']), openIssues: { new: 1, existing: 0, onUnits: 1 } }))
        .stage,
    ).toBe('in-progress');
    // a general (N/A) issue does not hold the project back
    expect(
      dashboardRow(input({ name: 'E', total: rollup(['blue']), openIssues: { new: 1, existing: 0, onUnits: 0 } }))
        .stage,
    ).toBe('ready');
    expect(dashboardRow(input({ name: 'F', total: rollup(['blue']), conflicts: 1 })).stage).toBe('in-progress');
    const issued = dashboardRow(input({ name: 'G', total: rollup(['amber']) }));
    issued.project.lock = { label: 'Final' };
    expect(dashboardRow({ ...issued }).stage).toBe('issued');
  });

  it('percentages, filters, search, sorts and totals', () => {
    const rows = [
      dashboardRow(
        input({ name: 'Riverside', total: rollup(['green', 'gray', 'gray', 'blue']), lastActivity: 5, attention: 1 }),
      ),
      dashboardRow(
        input({
          name: 'Airport',
          total: rollup(['blue']),
          lastActivity: 9,
          lastExport: { label: 'Prelim', at: 1, changesSince: 3 },
        }),
      ),
      dashboardRow(input({ name: 'Mall', lastActivity: 1, openIssues: { new: 2, existing: 1, onUnits: 0 } })),
    ];
    expect(rows[0].pctComplete).toBe(0.5);
    expect(rows[0].pctReviewed).toBe(0.25);
    expect(filterRows(rows, 'ready').map((r) => r.project.name)).toEqual(['Airport']);
    expect(filterRows(rows, 'active')).toHaveLength(3);
    expect(filterRows(rows, 'all', 'river st').map((r) => r.project.name)).toEqual(['Riverside']);
    expect(sortRows(rows, 'activity').map((r) => r.project.name)).toEqual(['Airport', 'Riverside', 'Mall']);
    expect(sortRows(rows, 'name').map((r) => r.project.name)).toEqual(['Airport', 'Mall', 'Riverside']);
    expect(sortRows(rows, 'complete').map((r) => r.project.name)).toEqual(['Mall', 'Riverside', 'Airport']);
    expect(sortRows(rows, 'attention').map((r) => r.project.name)).toEqual(['Mall', 'Riverside', 'Airport']);
    expect(dashboardTotals(rows)).toMatchObject({
      projects: 3,
      units: 5,
      complete: 3,
      reviewed: 2,
      openIssues: 3,
      ready: 1,
      unexported: 1,
    });
  });
});
