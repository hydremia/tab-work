import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { db } from '../../data/db';
import { usePhotos } from '../../data/hooks';
import { addIssue, deleteRecord, moveIssue, setField, setFields } from '../../data/repo';
import { rowNames } from '../../domain/rowLabels';
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
  const unit = equipment.find((e) => e.id === issue.equipmentId);
  // the unit's airflow lines (outlets, grilles, valves …) the issue can be about
  const lines = useLiveQuery(
    async () =>
      unit ? [...rowNames([unit], await db.airflowRows.where('equipmentId').equals(unit.id).toArray()).values()] : [],
    [unit?.id, unit?.type],
  );
  const lineGone = Boolean(issue.airflowRowId && lines && !lines.some((l) => l.rowId === issue.airflowRowId));
  return (
    <article
      className="card issue-card"
      id={`issue-${issue.id}`}
      tabIndex={-1}
      data-testid={`issue-${issue.kind}-${issue.number}`}
    >
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <span className="issue-num" title={`Issue ${label}`}>
          {label}
        </span>
        <select
          className="select"
          aria-label={`Issue ${label} equipment`}
          value={issue.equipmentId ?? ''}
          onChange={(e) =>
            void setFields('issues', issue.id, {
              equipmentId: e.target.value || null,
              ...(issue.airflowRowId ? { airflowRowId: null } : {}),
            })
          }
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
      {unit && lines && lines.length > 0 && (
        <div className="field">
          <label className="field-label" htmlFor={`${id}-line`}>
            Airflow line
          </label>
          <select
            id={`${id}-line`}
            className="select"
            aria-label={`Issue ${label} airflow line`}
            value={lineGone ? '' : (issue.airflowRowId ?? '')}
            onChange={(e) => void setField('issues', issue.id, 'airflowRowId', e.target.value || null)}
          >
            <option value="">Whole unit ({unit.designation})</option>
            {lines.map((l) => (
              <option key={l.rowId} value={l.rowId}>
                {l.long}
              </option>
            ))}
          </select>
        </div>
      )}
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
  const { project, equipment, issues, locked } = useProjectContext();
  const photos = usePhotos(project.id);
  const [viewing, setViewing] = useState<string | null>(null);
  // "#issue-<id>" (an issue just added from an airflow line): scroll to it once it is listed
  const { hash } = useLocation();
  const target = hash.startsWith('#issue-') ? hash.slice(1) : null;
  const listed = Boolean(target && issues.some((i) => `issue-${i.id}` === target));
  useEffect(() => {
    if (!target || !listed) return;
    const el = document.getElementById(target);
    el?.scrollIntoView?.({ block: 'center' });
    el?.focus({ preventScroll: true });
  }, [target, listed]);
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
      <fieldset className="lockable" disabled={locked}>
        <legend className="visually-hidden">Issues</legend>
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
      </fieldset>
      {viewing && <PhotoViewer photoId={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
