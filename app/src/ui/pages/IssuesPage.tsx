import { addIssue, deleteRecord, setField } from '../../data/repo';
import type { Equipment, Issue, IssueKind } from '../../data/types';
import { IconPlus, IconTrash } from '../components/Icons';
import { TextArea } from '../components/inputs';
import { useProjectContext } from './ProjectLayout';

function IssueCard({ issue, equipment }: { issue: Issue; equipment: Equipment[] }) {
  const id = `iss-${issue.id.slice(0, 8)}`;
  return (
    <article className="card issue-card" data-testid={`issue-${issue.kind}-${issue.number}`}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <span className="issue-num">#{issue.number}</span>
        <select
          className="select"
          aria-label={`Issue ${issue.number} equipment`}
          value={issue.equipmentId ?? ''}
          onChange={(e) => void setField('issues', issue.id, 'equipmentId', e.target.value || null)}
        >
          <option value="">General (N/A)</option>
          {equipment.map((e) => (
            <option key={e.id} value={e.id}>
              {e.designation}
            </option>
          ))}
        </select>
        <div
          className="segmented"
          role="group"
          aria-label={`Issue ${issue.number} status`}
          style={{ flex: '0 0 auto' }}
        >
          {(['Open', 'Closed'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={issue.status === s}
              onClick={() => void setField('issues', issue.id, 'status', s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-remark`}>
          Remark
        </label>
        <TextArea
          id={`${id}-remark`}
          value={issue.remark}
          onCommit={(v) => void setField('issues', issue.id, 'remark', v)}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-comments`}>
          Comments
        </label>
        <TextArea
          id={`${id}-comments`}
          value={issue.comments}
          onCommit={(v) => void setField('issues', issue.id, 'comments', v)}
        />
      </div>
      <button
        type="button"
        className="btn btn-danger"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => window.confirm(`Delete issue #${issue.number}?`) && void deleteRecord('issues', issue.id)}
      >
        <IconTrash size={16} /> Delete
      </button>
    </article>
  );
}

export function IssuesPage() {
  const { project, equipment, issues } = useProjectContext();
  const sorted = [...equipment].sort((a, b) =>
    a.designation.localeCompare(b.designation, undefined, { numeric: true }),
  );
  const groups: { kind: IssueKind; title: string; sheet: string }[] = [
    { kind: 'new', title: 'New equipment', sheet: 'Summary - New' },
    { kind: 'existing', title: 'Existing equipment', sheet: 'Summary - (E)' },
  ];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Issues</h1>
          <p>Numbered separately for New and Existing; an open issue turns its unit red.</p>
        </div>
      </div>
      {groups.map((g) => {
        const list = issues.filter((i) => i.kind === g.kind);
        return (
          <section key={g.kind} className="stack" aria-labelledby={`ig-${g.kind}`}>
            <div className="type-head">
              <h2 id={`ig-${g.kind}`}>{g.title}</h2>
              <span className="rollup small muted">
                {list.filter((i) => i.status === 'Open').length} open · {g.sheet}
              </span>
            </div>
            {list.map((i) => (
              <IssueCard key={i.id} issue={i} equipment={sorted} />
            ))}
            <button type="button" className="btn" onClick={() => void addIssue(project.id, { kind: g.kind })}>
              <IconPlus size={18} /> Add {g.kind} issue
            </button>
          </section>
        );
      })}
    </>
  );
}
