import { usePhotos } from '../../data/hooks';
import { PhotoThumb } from '../components/PhotoThumb';
import { useProjectContext } from './ProjectLayout';

const LABEL: Record<string, string> = {
  cover: 'Cover',
  unit: 'Unit',
  tag: 'Tag',
  oa_damper: 'OA damper',
  deficiency: 'Deficiency',
  other: 'Other',
};

export function PhotosPage() {
  const { project, equipment } = useProjectContext();
  const photos = usePhotos(project.id);
  const name = (id: string | null) => equipment.find((e) => e.id === id)?.designation ?? 'Project';
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Photos</h1>
          <p>{photos ? `${photos.length} photo${photos.length === 1 ? '' : 's'} on this device` : 'Loading…'}</p>
        </div>
      </div>
      <div className="callout" data-tone="info">
        Photos are taken on each unit's Photos section (and the cover photo on Info). The Photo Report, Issues Report
        and background upload come in Phase 4–5.
      </div>
      {photos && photos.length > 0 && (
        <div className="photo-grid">
          {photos.map((p) => (
            <figure key={p.id} className="photo-slot" style={{ margin: 0 }}>
              <PhotoThumb blob={p.blob} alt={`${name(p.equipmentId)} ${LABEL[p.category]}`} />
              <figcaption className="small">
                <b>{name(p.equipmentId)}</b> · {LABEL[p.category]}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </>
  );
}
