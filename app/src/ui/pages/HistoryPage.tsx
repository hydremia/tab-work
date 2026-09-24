import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { db } from '../../data/db';
import { useHistory } from '../../data/hooks';
import { actorKey, actorText, filterHistory, makeContext, type HistoryFilter } from '../../domain/historyView';
import { EQUIPMENT_TYPES } from '../../domain/equipmentTypes';
import { HISTORY_MAX_AGE_DAYS, HISTORY_MAX_PER_PROJECT } from '../../data/history';
import { HistoryList } from '../components/HistoryList';
import { useProjectContext } from './ProjectLayout';

/** Shown at a time; "Show more" adds this many. */
const PAGE = 200;

export function HistoryPage() {
  const { project, equipment, issues } = useProjectContext();
  const [params, setParams] = useSearchParams();
  const entries = useHistory(project.id);
  const extra = useLiveQuery(
    async () => ({
      rows: await db.airflowRows.where('projectId').equals(project.id).toArray(),
      instruments: await db.instruments.where('projectId').equals(project.id).toArray(),
    }),
    [project.id],
  );
  const [shown, setShown] = useState(PAGE);
  const filter: HistoryFilter = useMemo(
    () => ({
      unit: params.get('unit') ?? '',
      field: params.get('field') ?? '',
      from: params.get('from') ?? '',
      to: params.get('to') ?? '',
      actor: params.get('actor') ?? '',
    }),
    [params],
  );
  const set = (k: keyof HistoryFilter, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
    setShown(PAGE);
  };
  const ctx = useMemo(
    () => makeContext({ equipment, issues, rows: extra?.rows, instruments: extra?.instruments }),
    [equipment, issues, extra],
  );
  const actors = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entries ?? []) if (!m.has(actorKey(e))) m.set(actorKey(e), actorText(e));
    return [...m];
  }, [entries]);
  const list = useMemo(() => (entries ? filterHistory(entries, filter, ctx) : []), [entries, filter, ctx]);
  const units = [...equipment].sort(
    (a, b) =>
      EQUIPMENT_TYPES.findIndex((t) => t.key === a.type) - EQUIPMENT_TYPES.findIndex((t) => t.key === b.type) ||
      a.slot - b.slot,
  );
  const filtered = Object.values(filter).some(Boolean);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>History</h1>
          <p>
            Who changed what and when, old → new. Kept on this device for{' '}
            {HISTORY_MAX_AGE_DAYS / 365 === 1 ? '12 months' : `${HISTORY_MAX_AGE_DAYS} days`} (at most{' '}
            {HISTORY_MAX_PER_PROJECT.toLocaleString('en-US')} entries per project).
          </p>
        </div>
      </div>
      <details className="card card-pad hist-filter-card" open={filtered || undefined} aria-label="Filter history">
        <summary className="hist-summary" data-testid="history-filters">
          <span>Filters{filtered ? ' (on)' : ''}</span>
          <span className="small muted" data-testid="history-count">
            {entries ? `${list.length} change${list.length === 1 ? '' : 's'}${filtered ? ' shown' : ''}` : 'Loading…'}
          </span>
        </summary>
        <div className="hist-filters">
          <div className="field">
            <label className="field-label" htmlFor="h-unit">
              Unit
            </label>
            <select id="h-unit" className="select" value={filter.unit} onChange={(e) => set('unit', e.target.value)}>
              <option value="">All</option>
              <option value="project">Project-level only</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.designation}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="h-field">
              Field
            </label>
            <input
              id="h-field"
              className="input"
              value={filter.field}
              placeholder="e.g. Final VEL"
              onChange={(e) => set('field', e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="h-from">
              From
            </label>
            <input
              id="h-from"
              type="date"
              className="input"
              value={filter.from}
              onChange={(e) => set('from', e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="h-to">
              To
            </label>
            <input
              id="h-to"
              type="date"
              className="input"
              value={filter.to}
              onChange={(e) => set('to', e.target.value)}
            />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label className="field-label" htmlFor="h-actor">
              User / device
            </label>
            <select id="h-actor" className="select" value={filter.actor} onChange={(e) => set('actor', e.target.value)}>
              <option value="">Everyone</option>
              {actors.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {filtered && (
          <button
            type="button"
            className="link-btn small"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
          >
            Clear filters
          </button>
        )}
      </details>
      {entries && <HistoryList entries={list.slice(0, shown)} ctx={ctx} />}
      {list.length > shown && (
        <button type="button" className="btn" onClick={() => setShown(shown + PAGE)}>
          Show more ({list.length - shown} older)
        </button>
      )}
    </>
  );
}
