import type { HistoryEntry } from '../../data/types';
import { describeEntry, groupHistory, sourceText, type HistoryContext } from '../../domain/historyView';

const time = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** Change history grouped by day, then by runs of edits (same person and subject, ≤ 10 min apart). */
export function HistoryList({
  entries,
  ctx,
  showSubject = true,
}: {
  entries: readonly HistoryEntry[];
  ctx: HistoryContext;
  showSubject?: boolean;
}) {
  const days = groupHistory(entries, ctx);
  if (!days.length) return <p className="small muted">No changes recorded.</p>;
  return (
    <div className="stack" data-testid="history-list">
      {days.map((d) => (
        <section key={d.day} className="stack" style={{ gap: 8 }} aria-label={d.label}>
          <h3 className="hist-day">{d.label}</h3>
          {d.groups.map((g) => (
            <article key={g.key} className="card hist-group" data-kind={g.kind} data-testid="history-group">
              <div className="hist-head">
                <span>
                  {showSubject && <b>{g.subject}</b>} {showSubject ? '· ' : ''}
                  {g.actor}
                </span>
                <span style={{ whiteSpace: 'nowrap' }}>
                  {g.first === g.last ? time(g.last) : `${time(g.first)}–${time(g.last)}`}
                </span>
              </div>
              <ul className="hist-list">
                {g.entries.map((e) => {
                  const line = describeEntry(e, ctx);
                  const src = sourceText(e);
                  return (
                    <li key={e.id} data-testid="history-line" data-kind={e.kind}>
                      {line.type === 'event' ? (
                        <span className="hist-event">{line.text}</span>
                      ) : (
                        <>
                          <span className="hist-field">{line.label}:</span>{' '}
                          <span className="hist-old">{line.from}</span>{' '}
                          <span className="hist-arrow" aria-label="changed to">
                            →
                          </span>{' '}
                          <span className="hist-new">{line.to}</span>
                        </>
                      )}
                      {src && src !== 'automatic' && (
                        <>
                          {' '}
                          <span className="chip">{src}</span>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
