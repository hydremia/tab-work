import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { usePhotos, usePhotoStats } from '../../data/hooks';
import type { Equipment, Photo, PhotoCategory } from '../../data/types';
import { EQUIPMENT_TYPES, equipmentType } from '../../domain/equipmentTypes';
import { getSpec } from '../../domain/specs';
import { formatBytes, persistState, requestPersistentStorage, type PersistState } from '../../photos/capture';
import {
  allPhotoLabels,
  CATEGORY_LABEL,
  groupPhotos,
  issueLabel,
  sortEquipment,
  sortIssues,
} from '../../photos/labels';
import { DropZone, PhotoPicker, SaverStatus, usePhotoSaver } from '../components/PhotoPicker';
import { PhotoThumb } from '../components/PhotoThumb';
import { PhotoViewer } from '../components/PhotoViewer';
import { useProjectContext } from './ProjectLayout';

type Filter = 'all' | PhotoCategory;
const FILTERS: Filter[] = ['all', 'unit', 'tag', 'oa_damper', 'deficiency', 'other', 'cover'];
const TYPE_ORDER = EQUIPMENT_TYPES.map((t) => t.key);

const PERSIST_TEXT: Record<PersistState, string> = {
  persisted: 'Persistent: the browser will not clear photos to free space.',
  denied:
    'Best effort: the browser may clear site data when the device runs low on space. Add the app to the home screen, or export the photos regularly.',
  unsupported: 'This browser cannot guarantee persistent storage. Export the photos regularly.',
  unknown: 'Not requested yet (asked on the first photo).',
};

function PhotoCard({ photo, label, onOpen }: { photo: Photo; label: string; onOpen: () => void }) {
  return (
    <figure className="photo-card" data-testid="photo-card" data-label={label}>
      <button type="button" className="thumb-btn" onClick={onOpen} aria-label={`Open ${label}`}>
        <PhotoThumb blob={photo.thumb ?? photo.blob} alt={label} />
      </button>
      <figcaption>
        <span className="photo-label">{label}</span>
        {photo.caption ? <span className="muted"> · {photo.caption}</span> : null}
      </figcaption>
    </figure>
  );
}

export function PhotosPage() {
  const { project, equipment, issues, status } = useProjectContext();
  const photos = usePhotos(project.id);
  const stats = usePhotoStats(project.id);
  const saver = usePhotoSaver(project.id);
  const [filter, setFilter] = useState<Filter>('all');
  const [viewing, setViewing] = useState<string | null>(null);
  const [attachTo, setAttachTo] = useState('');
  const [persist, setPersist] = useState<PersistState>('unknown');
  useEffect(() => {
    void persistState().then(setPersist);
  }, [stats?.count]);

  const labels = useMemo(() => allPhotoLabels(photos ?? [], equipment, issues), [photos, equipment, issues]);
  const groups = useMemo(() => groupPhotos(photos ?? []), [photos]);

  // units with required photos still missing (completion engine: photo item state 'missing')
  const missing = useMemo(() => {
    const out: { e: Equipment; items: string[] }[] = [];
    for (const e of sortEquipment(equipment, TYPE_ORDER)) {
      const c = status?.byEquipment.get(e.id);
      if (!c) continue;
      const specPhotos = getSpec(e.type).sections.flatMap((s) => s.photos ?? []);
      const items = specPhotos.filter((p) => c.photos[p.category]?.state === 'missing').map((p) => p.label);
      if (items.length) out.push({ e, items });
    }
    return out;
  }, [equipment, status]);

  if (!photos) return <p>Loading…</p>;
  const show = (p: Photo) => filter === 'all' || p.category === filter;
  const eqById = new Map(equipment.map((e) => [e.id, e]));

  const sections: { key: string; title: string; sub?: string; link?: string; list: Photo[] }[] = [];
  const cover = groups.get('cover');
  if (cover) sections.push({ key: 'cover', title: 'Cover', sub: 'Placed in the workbook', list: cover });
  for (const e of sortEquipment(equipment, TYPE_ORDER)) {
    const list = groups.get(`eq:${e.id}`);
    if (list)
      sections.push({ key: e.id, title: e.designation, sub: equipmentType(e.type).label, link: `../e/${e.id}`, list });
  }
  for (const i of sortIssues(issues)) {
    const list = groups.get(`issue:${i.id}`);
    const eq = i.equipmentId ? eqById.get(i.equipmentId) : undefined;
    if (list)
      sections.push({
        key: i.id,
        title: `Issue ${issueLabel(i)}`,
        sub: `${i.kind === 'new' ? 'New' : 'Existing'} · ${eq?.designation ?? 'General'} · ${i.status}`,
        link: '../issues',
        list,
      });
  }
  const orphan = groups.get('issue:none');
  if (orphan) sections.push({ key: 'orphan', title: 'Deficiency (no issue)', list: orphan });
  const general = groups.get('general');
  if (general) sections.push({ key: 'general', title: 'General', sub: 'Not attached to a unit', list: general });

  const visible = sections.map((s) => ({ ...s, list: s.list.filter(show) })).filter((s) => s.list.length);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Photos</h1>
          <p data-testid="photo-count">
            {photos.length} photo{photos.length === 1 ? '' : 's'}
            {stats ? ` · ${formatBytes(stats.bytes)} on this device` : ''}
          </p>
        </div>
      </div>

      {missing.length > 0 && (
        <section className="callout" data-tone="amber" data-testid="missing-photos">
          <div>
            <b>Required photos missing</b> (take them or mark them N/A on the unit):
            <ul className="missing-list">
              {missing.map(({ e, items }) => (
                <li key={e.id}>
                  <Link to={`../e/${e.id}`}>{e.designation}</Link>: {items.join(', ')}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="card card-pad stack" aria-labelledby="add-h">
        <h2 id="add-h">Add photos</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Unit, tag and OA damper photos are taken on each unit's form; deficiency photos on the issue. Add other photos
          here.
        </p>
        <div className="field">
          <label className="field-label" htmlFor="ph-attach">
            Attach to
          </label>
          <select id="ph-attach" className="select" value={attachTo} onChange={(e) => setAttachTo(e.target.value)}>
            <option value="">General (no unit)</option>
            {sortEquipment(equipment, TYPE_ORDER).map((e) => (
              <option key={e.id} value={e.id}>
                {e.designation}
              </option>
            ))}
          </select>
        </div>
        <DropZone onFiles={(files) => void saver.save(files, { category: 'other', equipmentId: attachTo || null })}>
          <PhotoPicker
            label="Add photos"
            multiple
            disabled={Boolean(saver.busy)}
            chooseText="Choose photos"
            onFiles={(files) => void saver.save(files, { category: 'other', equipmentId: attachTo || null })}
          />
        </DropZone>
        <SaverStatus busy={saver.busy} error={saver.error} onDismiss={saver.clearError} />
      </section>

      <div className="filters" role="group" aria-label="Filter by category">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className="filter-chip"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : CATEGORY_LABEL[f]}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="empty">{photos.length ? 'No photos in this category.' : 'No photos yet.'}</p>
      ) : (
        visible.map((s) => (
          <section key={s.key} className="photo-group" data-testid={`photo-group-${s.title}`}>
            <div className="photo-group-head">
              <h3>{s.link ? <Link to={s.link}>{s.title}</Link> : s.title}</h3>
              {s.sub && <span className="small muted">{s.sub}</span>}
            </div>
            <div className="photo-grid-sm">
              {s.list.map((p) => (
                <PhotoCard
                  key={p.id}
                  photo={p}
                  label={labels.get(p.id) ?? CATEGORY_LABEL[p.category]}
                  onOpen={() => setViewing(p.id)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <section className="card card-pad stack" aria-labelledby="st-h" data-testid="photo-storage">
        <h2 id="st-h">Storage on this device</h2>
        <dl className="kv">
          <dt>This project</dt>
          <dd>{stats ? `${stats.count} photos · ${formatBytes(stats.bytes)}` : '…'}</dd>
          <dt>Storage</dt>
          <dd data-testid="persist-state">
            {persist === 'persisted' ? 'Persistent' : persist === 'unknown' ? 'Not requested' : 'Best effort'}
          </dd>
          <dt>Cloud upload</dt>
          <dd>
            {stats
              ? stats.pendingUploads
                ? `${stats.pendingUploads} waiting (cloud sync is not set up yet)`
                : 'Nothing waiting'
              : '…'}
          </dd>
        </dl>
        <p className="small muted" style={{ margin: 0 }}>
          {PERSIST_TEXT[persist]} Photos are stored resized (long edge 2000 px, JPEG) with a small thumbnail.
        </p>
        {persist !== 'persisted' && persist !== 'unsupported' && (
          <button type="button" className="btn" onClick={() => void requestPersistentStorage().then(setPersist)}>
            Ask to keep photos on this device
          </button>
        )}
      </section>

      {viewing && <PhotoViewer photoId={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
