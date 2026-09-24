import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import { useEquipmentList, useIssues, usePhoto } from '../../data/hooks';
import { deleteRecord, movePhoto, reassignPhoto, setField } from '../../data/repo';
import type { PhotoCategory } from '../../data/types';
import { allPhotoLabels, CATEGORY_LABEL, groupKeyOf, groupPhotos, issueLabel, sortIssues } from '../../photos/labels';
import { TextArea } from './inputs';
import { PhotoThumb } from './PhotoThumb';

const CATEGORIES: PhotoCategory[] = ['unit', 'tag', 'oa_damper', 'other', 'deficiency', 'cover'];

const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Full-size view of one photo: caption, what it is attached to (category / equipment / issue), order within its
 * group and delete.
 */
export function PhotoViewer({ photoId, onClose }: { photoId: string; onClose: () => void }) {
  const photo = usePhoto(photoId);
  const equipment = useEquipmentList(photo?.projectId);
  const issues = useIssues(photo?.projectId);
  const metas = useLiveQuery(
    async () =>
      photo
        ? (await db.photos.where('projectId').equals(photo.projectId).toArray()).map(
            ({ blob: _b, thumb: _t, ...m }) => m,
          )
        : [],
    [photo?.projectId],
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const ready = Boolean(photo && equipment && issues && metas);
  useEffect(() => {
    if (ready) closeRef.current?.focus();
  }, [ready]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (photo === null) onCloseRef.current();
  }, [photo]);

  if (!photo || !equipment || !issues || !metas) return null;
  const labels = allPhotoLabels(metas, equipment, issues);
  const group = groupPhotos(metas).get(groupKeyOf(photo)) ?? [];
  const pos = group.findIndex((p) => p.id === photo.id);
  const eqSorted = [...equipment].sort((a, b) =>
    a.designation.localeCompare(b.designation, undefined, { numeric: true }),
  );
  const label = labels.get(photo.id) ?? CATEGORY_LABEL[photo.category];
  const needsEquipment = photo.category === 'unit' || photo.category === 'tag' || photo.category === 'oa_damper';

  return (
    <div className="viewer-backdrop" onClick={onClose}>
      <div
        className="viewer"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-testid="photo-viewer"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="viewer-head">
          <b data-testid="viewer-label">{label}</b>
          <button ref={closeRef} type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="viewer-img">
          <PhotoThumb blob={photo.blob} alt={label} />
        </div>
        <div className="small muted">
          {photo.width && photo.height ? `${photo.width} × ${photo.height} px · ` : ''}
          {photo.capturedAt ? `taken ${when(photo.capturedAt)}` : `added ${when(photo.createdAt)}`}
          {photo.gps ? ` · GPS ${photo.gps.lat.toFixed(5)}, ${photo.gps.lon.toFixed(5)}` : ''}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="pv-caption">
            Caption
          </label>
          <TextArea
            id="pv-caption"
            value={photo.caption}
            placeholder="What the photo shows"
            onCommit={(v) => void setField('photos', photo.id, 'caption', v)}
          />
        </div>
        <div className="viewer-grid">
          <div className="field">
            <label className="field-label" htmlFor="pv-cat">
              Category
            </label>
            <select
              id="pv-cat"
              className="select"
              value={photo.category}
              onChange={(e) => {
                const category = e.target.value as PhotoCategory;
                const firstOpen = issues.find((i) => i.status === 'Open') ?? issues[0];
                const fromIssue = issues.find((i) => i.id === photo.issueId)?.equipmentId ?? null;
                const eq = photo.equipmentId ?? fromIssue;
                void reassignPhoto(photo.id, {
                  category,
                  equipmentId: eq ?? (category === 'other' ? null : (eqSorted[0]?.id ?? null)),
                  issueId: category === 'deficiency' ? (photo.issueId ?? firstOpen?.id ?? null) : null,
                });
              }}
            >
              {CATEGORIES.map((c) => (
                <option
                  key={c}
                  value={c}
                  disabled={
                    (c === 'deficiency' && !issues.length) ||
                    ((c === 'unit' || c === 'tag' || c === 'oa_damper') && !equipment.length)
                  }
                >
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          {photo.category === 'deficiency' ? (
            <div className="field">
              <label className="field-label" htmlFor="pv-issue">
                Issue
              </label>
              <select
                id="pv-issue"
                className="select"
                value={photo.issueId ?? ''}
                onChange={(e) =>
                  void reassignPhoto(photo.id, { category: 'deficiency', issueId: e.target.value || null })
                }
              >
                {!photo.issueId && <option value="">(none)</option>}
                {sortIssues(issues).map((i) => (
                  <option key={i.id} value={i.id}>
                    Issue {issueLabel(i)} {i.remark ? `· ${i.remark.slice(0, 40)}` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : photo.category !== 'cover' ? (
            <div className="field">
              <label className="field-label" htmlFor="pv-eq">
                Equipment
              </label>
              <select
                id="pv-eq"
                className="select"
                value={photo.equipmentId ?? ''}
                onChange={(e) =>
                  void reassignPhoto(photo.id, {
                    category: !e.target.value && needsEquipment ? 'other' : photo.category,
                    equipmentId: e.target.value || null,
                  })
                }
              >
                <option value="">General (no unit)</option>
                {eqSorted.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.designation}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        <div className="row viewer-actions">
          <button
            type="button"
            className="btn"
            disabled={pos <= 0}
            onClick={() => void movePhoto(photo.id, -1)}
            data-testid="photo-move-up"
          >
            ← Earlier
          </button>
          <button
            type="button"
            className="btn"
            disabled={pos < 0 || pos >= group.length - 1}
            onClick={() => void movePhoto(photo.id, 1)}
            data-testid="photo-move-down"
          >
            Later →
          </button>
          <span className="small muted">
            {pos + 1} of {group.length}
          </span>
          <button
            type="button"
            className="btn btn-danger"
            style={{ marginLeft: 'auto' }}
            data-testid="photo-delete"
            onClick={() => {
              if (window.confirm(`Delete ${label}? This cannot be undone.`)) void deleteRecord('photos', photo.id);
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
