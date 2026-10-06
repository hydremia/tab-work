/**
 * Export tab: the report check (domain/review.ts): what a reviewer checks before a report is issued, as a checklist.
 * Failures on a final report are listed first; every finding links to the unit or page to fix.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { db } from '../../data/db';
import { useCertProfile, useInstruments, useUserName } from '../../data/hooks';
import { acceptCheck, clearCheckAcceptance } from '../../data/repo';
import type { Equipment, Issue, Project } from '../../data/types';
import type { AttentionItem } from '../../domain/attention';
import type { Completion } from '../../domain/completion';
import {
  findingsFingerprint,
  reviewProject,
  type CheckStatus,
  type ReviewCheck,
  type ReviewResult,
} from '../../domain/review';
import { StatusIcon } from './Status';

const ICON: Record<CheckStatus, 'green' | 'amber' | 'red' | 'gray' | 'blue'> = {
  pass: 'green',
  warn: 'amber',
  accepted: 'blue',
  fail: 'red',
  na: 'gray',
};
const WORD: Record<CheckStatus, string> = {
  pass: 'OK',
  warn: 'Check',
  accepted: 'Accepted',
  fail: 'Must fix',
  na: 'n/a',
};

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

const day = (t: number) => new Date(t).toLocaleDateString('en-US', { dateStyle: 'medium' });

/** Accept a "Check" line (who and when; it shows "Check" again when its findings change), or clear an acceptance. */
function AcceptRow({ projectId, check, locked }: { projectId: string; check: ReviewCheck; locked: boolean }) {
  const saved = useUserName();
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = typed ?? saved ?? '';
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  if (check.accepted)
    return (
      <div className="review-row" data-testid={`accepted-${check.key}`}>
        <span className="grow review-done">
          <StatusIcon color="blue" size={16} /> Accepted{check.accepted.name ? ` by ${check.accepted.name}` : ''}
          {check.accepted.at ? ` · ${day(check.accepted.at)}` : ''}
        </span>
        <button
          type="button"
          className="btn"
          disabled={locked}
          onClick={() => void clearCheckAcceptance(projectId, check.key).catch(fail)}
        >
          Clear
        </button>
        {error && (
          <span className="small" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  return (
    <div className="review-row">
      <label className="visually-hidden" htmlFor={`accept-name-${check.key}`}>
        Reviewer name
      </label>
      <input
        id={`accept-name-${check.key}`}
        className="input"
        placeholder="Reviewer name"
        value={name}
        disabled={locked}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="name"
      />
      <button
        type="button"
        className="btn"
        disabled={locked || !name.trim()}
        data-testid={`accept-${check.key}`}
        onClick={() =>
          void acceptCheck(projectId, check.key, findingsFingerprint(check), name).then(() => setTyped(null), fail)
        }
      >
        <StatusIcon color="blue" size={16} /> Accept
      </button>
      <span className="small muted" style={{ flexBasis: '100%' }}>
        Accepting records that these were reviewed; the line shows Check again if its findings change.
      </span>
      {error && (
        <span className="small" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * `base`: the project's path; without it (a checked file) findings are plain text. `projectId`: "Check" lines can
 * be accepted (not while `locked`).
 */
export function ReportCheck({
  result,
  base,
  projectId,
  locked = false,
}: {
  result: ReviewResult | undefined;
  base?: string;
  projectId?: string;
  locked?: boolean;
}) {
  if (!result) return null;
  const order: CheckStatus[] = ['fail', 'warn', 'accepted', 'pass', 'na'];
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
          {result.warn} to check · {result.accepted > 0 && <>{result.accepted} accepted · </>}
          {result.pass} OK
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
              {projectId && (c.status === 'warn' || c.status === 'accepted') && (
                <AcceptRow projectId={projectId} check={c} locked={locked} />
              )}
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
