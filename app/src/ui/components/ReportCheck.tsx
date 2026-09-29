/**
 * Export tab: the report check (domain/review.ts): what a reviewer checks before a report is issued, as a checklist.
 * Failures on a final report are listed first; every finding links to the unit or page to fix.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { db } from '../../data/db';
import { useCertProfile, useInstruments } from '../../data/hooks';
import type { Equipment, Issue, Project } from '../../data/types';
import type { AttentionItem } from '../../domain/attention';
import type { Completion } from '../../domain/completion';
import { reviewProject, type CheckStatus, type ReviewResult } from '../../domain/review';
import { StatusIcon } from './Status';

const ICON: Record<CheckStatus, 'green' | 'amber' | 'red' | 'gray'> = {
  pass: 'green',
  warn: 'amber',
  fail: 'red',
  na: 'gray',
};
const WORD: Record<CheckStatus, string> = { pass: 'OK', warn: 'Check', fail: 'Must fix', na: 'n/a' };

export function useReportCheck(
  project: Project,
  equipment: Equipment[],
  issues: Issue[],
  completions: ReadonlyMap<string, Completion> | undefined,
  attention: AttentionItem[] | undefined,
): ReviewResult | undefined {
  const rows = useLiveQuery(() => db.airflowRows.where('projectId').equals(project.id).toArray(), [project.id]);
  const instruments = useInstruments(project.id);
  const certProfile = useCertProfile();
  return useMemo(() => {
    if (!rows || !instruments || !completions || certProfile === undefined) return undefined;
    return reviewProject({ project, equipment, rows, issues, instruments, completions, attention, certProfile });
  }, [project, equipment, rows, issues, instruments, completions, attention, certProfile]);
}

/** `base`: the project's path; without it (a checked file) findings are plain text. */
export function ReportCheck({ result, base }: { result: ReviewResult | undefined; base?: string }) {
  if (!result) return null;
  const order: CheckStatus[] = ['fail', 'warn', 'pass', 'na'];
  const checks = [...result.checks].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  const link = (to: string) => (to.startsWith('/') ? to : `${base}/${to}`);
  return (
    <section className="card card-pad stack" aria-labelledby="rc-h" data-testid="report-check">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h2 id="rc-h" style={{ margin: 0 }}>
          Report check
        </h2>
        <span className="small" data-testid="report-check-summary">
          {result.fail > 0 && <b style={{ color: 'var(--red)' }}>{result.fail} must fix · </b>}
          {result.warn} to check · {result.pass} OK
        </span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        What a reviewer looks at before a report goes out (NEBB 5.2 report content, tolerance remarks, electrical,
        plausible values, hydronic balancing). The same rules every time; tap a line to fix it.
      </p>
      <ul className="report-checks">
        {checks.map((c) => (
          <li key={c.key} data-status={c.status} data-testid={`check-${c.key}`}>
            <details open={c.status === 'fail' || undefined}>
              <summary>
                <StatusIcon color={ICON[c.status]} size={16} />
                <span className="rc-title">
                  <b>{c.title}</b>
                  <span className="small muted">
                    {WORD[c.status]}
                    {c.findings.length > 0 ? ` · ${c.findings.length}` : ''}
                    {c.ref ? ` · ${c.ref}` : ''}
                  </span>
                </span>
              </summary>
              {c.findings.length > 0 ? (
                <ul className="small">
                  {c.findings.map((f, i) => (
                    <li key={i}>{f.to && base ? <Link to={link(f.to)}>{f.text}</Link> : f.text}</li>
                  ))}
                </ul>
              ) : (
                <p className="small muted" style={{ margin: '4px 0 0' }}>
                  {c.note ?? (c.status === 'na' ? 'Not applicable.' : 'Nothing found.')}
                </p>
              )}
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
