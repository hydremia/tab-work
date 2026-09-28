/**
 * /dashboard: the PM view across every project on this device (all the team's projects when signed in): stage,
 * unit completion and reviews, open issues, what needs checking, conflicts, the last export and unsynced changes.
 * Search, filter by stage, sort. A table on wide screens; each row stacks into a card on a phone.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { useDashboard } from '../../data/hooks';
import {
  dashboardTotals,
  filterRows,
  SORT_LABEL,
  sortRows,
  STAGE_LABEL,
  type DashboardFilter,
  type DashboardRow,
  type DashboardSort,
} from '../../domain/dashboard';
import { EQUIPMENT_TYPES } from '../../domain/equipmentTypes';
import { useSync } from '../../sync/SyncProvider';
import { Screen } from '../components/Screen';
import { ProgressBar } from '../components/Status';

const FILTERS: { key: DashboardFilter; label: string }[] = [
  { key: 'active', label: 'Not issued' },
  { key: 'all', label: 'All' },
  { key: 'in-progress', label: 'In progress' },
  { key: 'ready', label: 'Ready to issue' },
  { key: 'issued', label: 'Issued' },
  { key: 'empty', label: 'No units yet' },
];

const PREFS_KEY = 'tab.dashboard';
function loadPrefs(): { filter: DashboardFilter; sort: DashboardSort } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<{ filter: string; sort: string }>;
    return {
      filter: FILTERS.some((f) => f.key === p.filter) ? (p.filter as DashboardFilter) : 'active',
      sort: p.sort && p.sort in SORT_LABEL ? (p.sort as DashboardSort) : 'activity',
    };
  } catch {
    return { filter: 'active', sort: 'activity' };
  }
}
function savePrefs(p: { filter: DashboardFilter; sort: DashboardSort }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode: not remembered */
  }
}

const day = (t: number | null) =>
  t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const usDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? day(new Date(`${iso}T12:00:00`).getTime()) : '—');

function typeSummary(r: DashboardRow): string {
  return EQUIPMENT_TYPES.filter((t) => r.byType.get(t.key))
    .map((t) => {
      const x = r.byType.get(t.key)!;
      return `${t.plural} ${x.green}/${x.total}`;
    })
    .join(' · ');
}

function Row({ r, cloud }: { r: DashboardRow; cloud: boolean }) {
  const issues = r.openIssues.new + r.openIssues.existing;
  return (
    <tr data-testid="dash-row" data-stage={r.stage}>
      <td data-label="Project">
        <Link to={`/p/${r.project.id}/equipment`} className="dash-name">
          {r.project.name}
        </Link>
        {r.address && <span className="small muted dash-sub">{r.address}</span>}
        <span className="small muted dash-sub">TAB {usDate(r.tabDate)}</span>
      </td>
      <td data-label="Stage">
        <span className="chip dash-stage" data-stage={r.stage}>
          {r.stage === 'issued' ? `Issued · ${r.project.lock?.label ?? ''}` : STAGE_LABEL[r.stage]}
        </span>
        {r.project.reportKind === 'final' && r.stage !== 'issued' && (
          <span className="small muted dash-sub">Final report</span>
        )}
      </td>
      <td data-label="Units">
        {r.total.total ? (
          <>
            <ProgressBar rollup={r.total} />
            <span className="small dash-sub" data-testid="dash-units">
              {r.total.green}/{r.total.total} complete · {r.total.reviewed} reviewed
            </span>
            <span className="small muted dash-sub">{typeSummary(r)}</span>
          </>
        ) : (
          <span className="small muted">—</span>
        )}
      </td>
      <td data-label="To check">
        <Link to={`/p/${r.project.id}/attention`} className="dash-count" data-testid="dash-attention">
          {r.attention + r.conflicts}
        </Link>
        <span className="small muted dash-sub">
          {issues ? `${issues} open issue${issues > 1 ? 's' : ''}` : 'no open issues'}
          {r.conflicts ? ` · ${r.conflicts} conflict${r.conflicts > 1 ? 's' : ''}` : ''}
        </span>
      </td>
      <td data-label="Last export">
        {r.lastExport.at ? (
          <>
            <span className="small">
              {r.lastExport.label} · {day(r.lastExport.at)}
            </span>
            <span
              className="small dash-sub"
              data-tone={r.lastExport.changesSince ? 'amber' : undefined}
              data-testid="dash-export"
            >
              {r.lastExport.changesSince ? `${r.lastExport.changesSince} changes since` : 'up to date'}
            </span>
          </>
        ) : (
          <span className="small muted" data-testid="dash-export">
            Never exported
          </span>
        )}
      </td>
      <td data-label="Activity">
        <span className="small">{day(r.lastActivity)}</span>
        {cloud && r.unsynced > 0 && (
          <span className="small dash-sub" data-tone="amber">
            {r.unsynced} unsynced
          </span>
        )}
      </td>
    </tr>
  );
}

export function DashboardPage() {
  const rows = useDashboard();
  // unsynced counts mean something only when signed in (in local mode nothing syncs)
  const cloud = useSync().status !== 'local';
  const [prefs, setPrefs] = useState(loadPrefs);
  const [q, setQ] = useState('');
  const update = (p: Partial<typeof prefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    savePrefs(next);
  };
  const shown = rows ? sortRows(filterRows(rows, prefs.filter, q), prefs.sort) : [];
  const t = dashboardTotals(shown);
  return (
    <Screen title="Dashboard" back="/">
      <section className="card card-pad stack" aria-label="Filters">
        <div className="dash-controls">
          <input
            className="input"
            type="search"
            placeholder="Search name or address"
            aria-label="Search projects"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="select"
            aria-label="Show"
            value={prefs.filter}
            onChange={(e) => update({ filter: e.target.value as DashboardFilter })}
          >
            {FILTERS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Sort by"
            value={prefs.sort}
            onChange={(e) => update({ sort: e.target.value as DashboardSort })}
          >
            {(Object.keys(SORT_LABEL) as DashboardSort[]).map((k) => (
              <option key={k} value={k}>
                Sort: {SORT_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <p className="small dash-totals" data-testid="dash-totals" style={{ margin: 0 }}>
          <b>{t.projects}</b> project{t.projects === 1 ? '' : 's'} · <b>{t.complete}</b>/{t.units} units complete ·{' '}
          <b>{t.reviewed}</b> reviewed · <b>{t.openIssues}</b> open issues · <b>{t.ready}</b> ready to issue
          {t.unexported ? (
            <>
              {' '}
              · <b>{t.unexported}</b> with changes since the last export
            </>
          ) : null}
        </p>
      </section>
      {rows && !shown.length && (
        <div className="card empty">
          <p>{rows.length ? 'No project matches.' : 'No projects on this device yet.'}</p>
        </div>
      )}
      {shown.length > 0 && (
        <div className="card dash-table-wrap">
          <table className="dash-table" data-testid="dashboard">
            <thead>
              <tr>
                <th>Project</th>
                <th>Stage</th>
                <th>Units</th>
                <th>To check</th>
                <th>Last export</th>
                <th>Activity</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Row key={r.project.id} r={r} cloud={cloud} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Screen>
  );
}
