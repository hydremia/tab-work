/**
 * PM dashboard (pure): one row per project on this device, for a project manager looking across jobs. What each row
 * says comes from the same rules the project pages use (unit completion colors, needs-attention items, open
 * issues, sync conflicts, the export reminder), so the dashboard never disagrees with a project's own tabs.
 *
 * Stage:
 *   issued       the report is issued and the project locked
 *   ready        every unit complete and reviewed, no open issue on a unit, no open conflict
 *   in-progress  anything else with units
 *   empty        no units yet
 */
import type { Rollup } from './completion';
import type { EquipmentTypeKey } from './equipmentTypes';

export type Stage = 'empty' | 'in-progress' | 'ready' | 'issued';

export const STAGE_LABEL: Record<Stage, string> = {
  empty: 'No units yet',
  'in-progress': 'In progress',
  ready: 'Ready to issue',
  issued: 'Issued',
};

export interface DashboardInput {
  project: {
    id: string;
    name: string;
    info: Record<string, unknown>;
    reportKind?: string;
    lock?: { label?: string; at?: number } | null;
  };
  total: Rollup;
  byType: ReadonlyMap<EquipmentTypeKey, Rollup>;
  openIssues: { new: number; existing: number; onUnits: number };
  attention: number;
  conflicts: number;
  lastExport: { label: string | null; at: number | null; changesSince: number };
  /** Newest history entry (any kind), null when none. */
  lastActivity: number | null;
  /** Changes of the project not on the server yet (waiting or held). */
  unsynced: number;
}

export interface DashboardRow extends DashboardInput {
  stage: Stage;
  /** Complete units / all units (0 when none). */
  pctComplete: number;
  /** Reviewed units / all units. */
  pctReviewed: number;
  address: string;
  tabDate: string;
}

export function dashboardRow(i: DashboardInput): DashboardRow {
  const t = i.total;
  const stage: Stage = i.project.lock
    ? 'issued'
    : t.total === 0
      ? 'empty'
      : t.reviewed === t.total && i.openIssues.onUnits === 0 && i.conflicts === 0
        ? 'ready'
        : 'in-progress';
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    ...i,
    stage,
    pctComplete: t.total ? t.complete / t.total : 0,
    pctReviewed: t.total ? t.reviewed / t.total : 0,
    address: str(i.project.info.address),
    tabDate: str(i.project.info.tabDate),
  };
}

export type DashboardSort = 'activity' | 'name' | 'tabDate' | 'complete' | 'attention';
export type DashboardFilter = 'all' | 'active' | Stage;

export const SORT_LABEL: Record<DashboardSort, string> = {
  activity: 'Last activity',
  name: 'Name',
  tabDate: 'TAB date',
  complete: 'Least complete',
  attention: 'Most to check',
};

export function filterRows(rows: readonly DashboardRow[], f: DashboardFilter, q = ''): DashboardRow[] {
  // every word of the search appears in the name or address, in any order
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (f !== 'all' && (f === 'active' ? r.stage === 'issued' : r.stage !== f)) return false;
    const text = `${r.project.name} ${r.address}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

export function sortRows(rows: readonly DashboardRow[], by: DashboardSort): DashboardRow[] {
  const byName = (a: DashboardRow, b: DashboardRow) => a.project.name.localeCompare(b.project.name);
  const cmp: Record<DashboardSort, (a: DashboardRow, b: DashboardRow) => number> = {
    activity: (a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0) || byName(a, b),
    name: byName,
    // newest TAB date first, undated last
    tabDate: (a, b) => (b.tabDate || '').localeCompare(a.tabDate || '') || byName(a, b),
    complete: (a, b) => a.pctComplete - b.pctComplete || b.total.total - a.total.total || byName(a, b),
    attention: (a, b) =>
      b.attention +
        b.conflicts +
        b.openIssues.new +
        b.openIssues.existing -
        (a.attention + a.conflicts + a.openIssues.new + a.openIssues.existing) || byName(a, b),
  };
  return [...rows].sort(cmp[by]);
}

/** Totals across the shown rows (the dashboard's summary strip). */
export function dashboardTotals(rows: readonly DashboardRow[]) {
  const sum = (f: (r: DashboardRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  return {
    projects: rows.length,
    units: sum((r) => r.total.total),
    complete: sum((r) => r.total.complete),
    reviewed: sum((r) => r.total.reviewed),
    openIssues: sum((r) => r.openIssues.new + r.openIssues.existing),
    attention: sum((r) => r.attention),
    conflicts: sum((r) => r.conflicts),
    ready: rows.filter((r) => r.stage === 'ready').length,
    unexported: rows.filter((r) => r.lastExport.changesSince > 0 && r.stage !== 'empty').length,
  };
}
