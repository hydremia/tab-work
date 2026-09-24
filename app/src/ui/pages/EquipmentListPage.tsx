import { useState } from 'react';
import { Link } from 'react-router';
import { STATUS_LABEL, type Completion, type DisplayColor } from '../../domain/completion';
import { EQUIPMENT_TYPES } from '../../domain/equipmentTypes';
import type { Equipment } from '../../data/types';
import { IconPlus } from '../components/Icons';
import { ProgressBar, StatusBadge, StatusIcon } from '../components/Status';
import { useProjectContext } from './ProjectLayout';

type Filter = 'all' | 'needs' | 'attention' | 'complete' | 'unreviewed' | 'reviewed';
const FILTERS: { key: Filter; label: string; test: (c: Completion, d: DisplayColor) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'needs', label: 'Needs data', test: (c) => c.missing.length > 0 || c.color === 'gray' || c.formIncomplete },
  { key: 'attention', label: 'Needs attention', test: (c) => c.color === 'red' },
  { key: 'complete', label: 'Complete', test: (c) => c.color === 'green' },
  { key: 'unreviewed', label: 'To review', test: (_c, d) => d === 'green' },
  { key: 'reviewed', label: 'Reviewed', test: (_c, d) => d === 'blue' },
];

function EquipmentCard({ e, c, d, projectId }: { e: Equipment; c: Completion; d: DisplayColor; projectId: string }) {
  const area = typeof e.data.areaServed === 'string' ? e.data.areaServed : '';
  const detail =
    c.color === 'gray'
      ? 'Not started'
      : c.color === 'red'
        ? [
            c.openIssues ? `${c.openIssues} open issue${c.openIssues > 1 ? 's' : ''}` : '',
            c.outOfTolerance.length ? `${c.outOfTolerance.length} out of tolerance` : '',
          ]
            .filter(Boolean)
            .join(' · ')
        : c.formIncomplete
          ? 'Full form coming soon'
          : c.missing.length
            ? `${c.missing.length} required item${c.missing.length > 1 ? 's' : ''} missing`
            : `${c.satisfied}/${c.required} done`;
  return (
    <Link
      to={`/p/${projectId}/e/${e.id}`}
      className="card card-link equip-card"
      data-color={d}
      data-testid={`equip-${e.designation}`}
      aria-label={`${e.designation}: ${STATUS_LABEL[d]}`}
    >
      <div className="body">
        <div className="row" style={{ gap: 8 }}>
          <span className="name">{e.designation}</span>
          {e.isExisting && <span className="chip chip-existing">Existing</span>}
        </div>
        <div className="sub">{[area, detail].filter(Boolean).join(' · ')}</div>
      </div>
      <StatusBadge color={d} label={d === 'blue' ? STATUS_LABEL.blue : c.label} />
    </Link>
  );
}

export function EquipmentListPage() {
  const { project, equipment, status, attention, locked } = useProjectContext();
  const [filter, setFilter] = useState<Filter>('all');
  const f = FILTERS.find((x) => x.key === filter)!;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Equipment</h1>
          <p>
            {status && status.total.total
              ? `${status.total.green} of ${status.total.total} complete${status.total.reviewed ? ` · ${status.total.reviewed} reviewed` : ''}`
              : 'Add the units you will test and balance.'}
          </p>
        </div>
        {!locked && (
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <Link to={`/p/${project.id}/schedule`} className="btn" data-testid="import-schedule">
              Import schedule
            </Link>
            <Link to={`/p/${project.id}/add`} className="btn btn-primary" data-testid="add-equipment">
              <IconPlus size={18} /> Add equipment
            </Link>
          </div>
        )}
      </div>
      {attention && attention.length > 0 && (
        <Link to={`/p/${project.id}/attention`} className="card card-link attention-link" data-testid="attention-card">
          <StatusIcon color="amber" size={20} />
          <span className="grow">
            <b>Needs attention</b>
            <span className="small muted" style={{ display: 'block' }}>
              {attention.length} item{attention.length > 1 ? 's' : ''}: tolerance, discrepancies, motor checks, photos,
              issues, calibration
            </span>
          </span>
          <span className="tab-count" data-tone="attention" data-testid="attention-count">
            {attention.length}
          </span>
        </Link>
      )}
      {status && status.total.total > 0 && <ProgressBar rollup={status.total} />}
      {equipment.length > 0 && (
        <div className="filters" role="group" aria-label="Filter equipment">
          {FILTERS.map((x) => (
            <button
              key={x.key}
              type="button"
              className="filter-chip"
              aria-pressed={filter === x.key}
              onClick={() => setFilter(x.key)}
            >
              {x.label}
            </button>
          ))}
        </div>
      )}
      {equipment.length === 0 && (
        <div className="card empty">
          <h2>No equipment yet</h2>
          <p>RTUs, MAUs, ERVs, fans, VAVs, hoods and traverses go here.</p>
        </div>
      )}
      {status &&
        EQUIPMENT_TYPES.map((t) => {
          const list = equipment
            .filter((e) => e.type === t.key)
            .sort((a, b) => a.slot - b.slot)
            .filter((e) => f.test(status.byEquipment.get(e.id)!, status.display.get(e.id)!));
          const r = status.byType.get(t.key);
          if (!r || !list.length) return null;
          return (
            <section key={t.key} className="type-group" aria-labelledby={`grp-${t.key}`}>
              <div className="type-head">
                <h2 id={`grp-${t.key}`}>{t.plural}</h2>
                <span className="rollup" data-testid={`rollup-${t.key}`}>
                  {t.plural} {r.green}/{r.total} complete
                  {r.reviewed > 0 && (
                    <>
                      , <span style={{ whiteSpace: 'nowrap' }}>{r.reviewed} reviewed</span>
                    </>
                  )}
                </span>
                {!locked && (
                  <Link
                    to={`/p/${project.id}/schedule?type=${t.key}`}
                    className="small"
                    aria-label={`Import ${t.plural} schedule`}
                  >
                    Import
                  </Link>
                )}
              </div>
              <div className="equip-grid">
                {list.map((e) => (
                  <EquipmentCard
                    key={e.id}
                    e={e}
                    c={status.byEquipment.get(e.id)!}
                    d={status.display.get(e.id)!}
                    projectId={project.id}
                  />
                ))}
              </div>
            </section>
          );
        })}
    </>
  );
}
