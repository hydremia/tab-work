import { useState } from 'react';
import { deleteRecord, setField } from '../../data/repo';
import type { Equipment, Photo } from '../../data/types';
import { photoNaKey, type ItemResult } from '../../domain/completion';
import type { PhotoSpec } from '../../domain/specs';
import { IconCamera, IconTrash } from './Icons';
import { NaSelect } from './inputs';
import { PhotoPicker, SaverStatus, usePhotoSaver } from './PhotoPicker';
import { PhotoThumb } from './PhotoThumb';
import { PhotoViewer } from './PhotoViewer';

const NA_TEXT: Record<string, string> = {
  'auto-na': 'Auto N/A',
  'section-na': 'Section N/A',
  'equipment-na': 'Unit N/A',
  'scope-na': 'N/A for this scope',
};

/** The unit form's required photo slots (unit, tag, OA damper ...): one photo each, or an N/A mark. */
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
  const saver = usePhotoSaver(equipment.projectId);
  const [viewing, setViewing] = useState<string | null>(null);
  return (
    <>
      <SaverStatus busy={saver.busy} error={saver.error} onDismiss={saver.clearError} />
      <div className="photo-grid">
        {specs.map((p) => {
          const photo = photos
            .filter((x) => x.category === p.category)
            .sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt))[0];
          const r = results[p.category];
          const mark = equipment.naState.fields[photoNaKey(p.category)];
          return (
            <div
              key={p.category}
              className="photo-slot"
              data-testid={`photo-${p.category}`}
              data-has-photo={Boolean(photo)}
            >
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
                <button
                  type="button"
                  className="thumb-btn"
                  onClick={() => setViewing(photo.id)}
                  aria-label={`View ${p.label} photo`}
                >
                  <PhotoThumb blob={photo.thumb ?? photo.blob} alt={`${equipment.designation} ${p.label}`} />
                </button>
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
              <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                <PhotoPicker
                  label={`${p.label} photo`}
                  compact
                  takeText={photo ? 'Retake photo' : 'Take photo'}
                  chooseText="Choose from library"
                  disabled={Boolean(saver.busy)}
                  onFiles={(files) =>
                    void saver.save(
                      files.slice(0, 1),
                      { category: p.category, equipmentId: equipment.id },
                      { replace: true },
                    )
                  }
                />
                {photo && (
                  <button
                    type="button"
                    className="btn btn-danger icon-only"
                    aria-label={`Remove ${p.label} photo`}
                    onClick={() =>
                      window.confirm(`Remove the ${p.label.toLowerCase()} photo of ${equipment.designation}?`) &&
                      void deleteRecord('photos', photo.id)
                    }
                  >
                    <IconTrash size={16} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {viewing && <PhotoViewer photoId={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
