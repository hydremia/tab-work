import { deleteRecord, replacePhoto, setField } from '../../data/repo';
import type { Equipment, Photo } from '../../data/types';
import { photoNaKey, type ItemResult } from '../../domain/completion';
import type { PhotoSpec } from '../../domain/specs';
import { IconCamera, IconTrash } from './Icons';
import { NaSelect } from './inputs';
import { PhotoThumb } from './PhotoThumb';

const NA_TEXT: Record<string, string> = {
  'auto-na': 'Auto N/A',
  'section-na': 'Section N/A',
  'equipment-na': 'Unit N/A',
  'scope-na': 'N/A for this scope',
};

export function PhotoSlots({
  equipment,
  specs,
  photos,
  results,
}: {
  equipment: Equipment;
  specs: readonly PhotoSpec[];
  photos: Photo[];
  results: Record<string, ItemResult>;
}) {
  return (
    <div className="photo-grid">
      {specs.map((p) => {
        const photo = photos.find((x) => x.category === p.category);
        const r = results[p.category];
        const mark = equipment.naState.fields[photoNaKey(p.category)];
        return (
          <div key={p.category} className="photo-slot" data-testid={`photo-${p.category}`}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <b className="small">{p.label}</b>
              {!photo && (
                <NaSelect
                  label={`${p.label} photo`}
                  mark={mark}
                  onChange={(m) =>
                    void setField('equipment', equipment.id, `naState.fields.${photoNaKey(p.category)}`, m)
                  }
                />
              )}
            </div>
            {photo ? (
              <PhotoThumb blob={photo.blob} alt={`${equipment.designation} ${p.label}`} />
            ) : (
              <div className="photo-empty">
                {mark ? (
                  mark.notation
                ) : r && NA_TEXT[r.state] ? (
                  `${NA_TEXT[r.state]}${r.reason ? ` · ${r.reason}` : ''}`
                ) : (
                  <IconCamera size={28} />
                )}
              </div>
            )}
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <label className="btn file-btn" style={{ flex: 1 }}>
                <IconCamera size={18} /> {photo ? 'Retake' : 'Add'}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  aria-label={`${p.label} photo`}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void replacePhoto(equipment.projectId, f, p.category, equipment.id);
                    e.target.value = '';
                  }}
                />
              </label>
              {photo && (
                <button
                  type="button"
                  className="btn btn-danger"
                  aria-label={`Remove ${p.label} photo`}
                  onClick={() => void deleteRecord('photos', photo.id)}
                >
                  <IconTrash size={16} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
