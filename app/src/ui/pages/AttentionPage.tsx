import { Link } from 'react-router';
import { groupAttention } from '../../domain/attention';
import { ConflictList } from '../components/Conflicts';
import { StatusIcon } from '../components/Status';
import { useProjectContext } from './ProjectLayout';

/** Project-wide "needs attention" list: grouped, every item linked to its unit / section or page. */
export function AttentionPage() {
  const { project, attention, conflicts, equipment, issues } = useProjectContext();
  if (!attention) return <p className="muted">Loading…</p>;
  const groups = groupAttention(attention);
  const nConflicts = conflicts?.length ?? 0;
  const total = attention.length + nConflicts;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Needs attention</h1>
          <p data-testid="attention-total">
            {total
              ? `${total} item${total > 1 ? 's' : ''} to check before issuing the report`
              : 'Nothing to check right now.'}
          </p>
        </div>
      </div>
      {nConflicts > 0 && (
        <section className="card attention-group" aria-labelledby="att-conflicts" data-testid="attention-conflicts">
          <h2 id="att-conflicts">
            Conflicts <span className="tab-count">{nConflicts}</span>
          </h2>
          <ConflictList conflicts={conflicts!} project={project} equipment={equipment} issues={issues} />
        </section>
      )}
      {!total && (
        <div className="card empty">
          <h2>All clear</h2>
          <p>
            Out-of-tolerance readings, design discrepancies, motor checks, missing photos, open issues, capacity and
            calibration problems show up here.
          </p>
        </div>
      )}
      {groups.map((g) => (
        <section
          key={g.key}
          className="card attention-group"
          aria-labelledby={`att-${g.key}`}
          data-testid={`attention-${g.key}`}
        >
          <h2 id={`att-${g.key}`}>
            {g.title} <span className="tab-count">{g.items.length}</span>
          </h2>
          <ul>
            {g.items.map((i) => (
              <li key={i.id}>
                <Link
                  to={`/p/${project.id}/${i.to}`}
                  className="attention-item"
                  data-testid="attention-item"
                  data-group={i.group}
                >
                  <StatusIcon color={g.key === 'tolerance' || g.key === 'issues' ? 'red' : 'amber'} size={16} />
                  <span>
                    <b>{i.subject}</b>
                    <span className="small muted">{i.text}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
