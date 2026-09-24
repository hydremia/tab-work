import { useMemo, useState } from 'react';
import { usePhotos } from '../../data/hooks';
import { addIssue, deleteRecord, moveIssue, setField } from '../../data/repo';
import type { Equipment, Issue, IssueKind, Photo } from '../../data/types';
import { deficiencyLabels, issueLabel, issuePhotos } from '../../photos/labels';
import { IconPlus, IconTrash } from '../components/Icons';
import { TextArea } from '../components/inputs';
import { DropZone, PhotoPicker, SaverStatus, usePhotoSaver } from '../components/PhotoPicker';
import { PhotoThumb } from '../components/PhotoThumb';
import { PhotoViewer } from '../components/PhotoViewer';
import { useProjectContext } from './ProjectLayout';

function IssueCard({
  issue,
  equipment,
  photos,
  labels,
  first,
  last,
  onOpenPhoto,
}: {
  issue: Issue;
  equipment: Equipment[];
  photos: Photo[];
  labels: Map<string, string>;
  first: boolean;
  last: boolean;
  onOpenPhoto: (id: string) => void;
}) {
  const id = `iss-${issue.id.slice(0, 8)}`;
  const label = issueLabel(issue);
  const saver = usePhotoSaver(issue.projectId);
  const save = (files: File[]) => void saver.save(files, { category: 'deficiency', issueId: issue.id });
  return (
    <article className="card issue-card" data-testid={`issue-${issue.kind}-${issue.number}`}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <span className="issue-num" title={`Issue ${label}`}>
          {label}
        </span>
        <select
          className="select"
          aria-label={`Issue ${label} equipment`}
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
        <div className="segmented" role="group" aria-label={`Issue ${label} status`} style={{ flex: '0 0 auto' }}>
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
      <div className="field" data-testid={`issue-photos-${label}`}>
        <span className="field-label">Deficiency photos {photos.length ? `(${photos.length})` : ''}</span>
        {photos.length > 0 && (
          <div className="photo-grid-sm">
            {photos.map((p) => {
              const l = labels.get(p.id) ?? 'Photo';
              return (
                <figure key={p.id} className="photo-card" data-testid="deficiency-photo" data-label={l}>
                  <button
                    type="button"
                    className="thumb-btn"
                    onClick={() => onOpenPhoto(p.id)}
                    aria-label={`Open ${l}`}
                  >
                    <PhotoThumb blob={p.thumb ?? p.blob} alt={l} />
                  </button>
                  <figcaption>
                    <span className="photo-label">{l}</span>
                    {p.caption ? <span className="muted"> · {p.caption}</span> : null}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
        <DropZone onFiles={save}>
          <PhotoPicker
            label={`Issue ${label} photo`}
            multiple
            disabled={Boolean(saver.busy)}
            takeText="Take photo"
            chooseText="Choose"
            onFiles={save}
          />
        </DropZone>
        <SaverStatus busy={saver.busy} error={saver.error} onDismiss={saver.clearError} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn"
          disabled={first}
          aria-label={`Move issue ${label} up`}
          onClick={() => void moveIssue(issue.id, -1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="btn"
          disabled={last}
          aria-label={`Move issue ${label} down`}
          onClick={() => void moveIssue(issue.id, 1)}
        >
          ↓
        </button>
        <button
          type="button"
          className="btn btn-danger"
          style={{ marginLeft: 'auto' }}
          onClick={() =>
            window.confirm(
              `Delete issue ${label}${photos.length ? ` and its ${photos.length} photo${photos.length === 1 ? '' : 's'}` : ''}?`,
            ) && void deleteRecord('issues', issue.id)
          }
        >
          <IconTrash size={16} /> Delete
        </button>
      </div>
    </article>
  );
}

export function IssuesPage() {
  const { project, equipment, issues } = useProjectContext();
  const photos = usePhotos(project.id);
  const [viewing, setViewing] = useState<string | null>(null);
  const sorted = [...equipment].sort((a, b) =>
    a.designation.localeCompare(b.designation, undefined, { numeric: true }),
  );
  const deficiency = useMemo(() => (photos ?? []).filter((p) => p.category === 'deficiency'), [photos]);
  const labels = useMemo(() => deficiencyLabels(deficiency, issues), [deficiency, issues]);
  const groups: { kind: IssueKind; title: string; sheet: string }[] = [
    { kind: 'new', title: 'New equipment', sheet: 'Summary - New' },
    { kind: 'existing', title: 'Existing equipment', sheet: 'Summary - (E)' },
  ];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Issues</h1>
          <p>
            Numbered separately: N-1, N-2 … (New) and E-1, E-2 … (Existing). Deficiency photos are numbered to their
            issue (Photo N-3.1). An open issue turns its unit red.
          </p>
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
            {list.map((i, k) => (
              <IssueCard
                key={i.id}
                issue={i}
                equipment={sorted}
                photos={issuePhotos(deficiency, i.id)}
                labels={labels}
                first={k === 0}
                last={k === list.length - 1}
                onOpenPhoto={setViewing}
              />
            ))}
            <button type="button" className="btn" onClick={() => void addIssue(project.id, { kind: g.kind })}>
              <IconPlus size={18} /> Add {g.kind} issue
            </button>
          </section>
        );
      })}
      {viewing && <PhotoViewer photoId={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
