import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useEquipmentList, useProject } from '../../data/hooks';
import { addEquipment } from '../../data/repo';
import { EQUIPMENT_TYPES, suggestDesignation, type EquipmentTypeKey } from '../../domain/equipmentTypes';
import { Screen } from '../components/Screen';

export function AddEquipmentPage() {
  const { projectId } = useParams();
  const project = useProject(projectId);
  const equipment = useEquipmentList(projectId);
  const nav = useNavigate();
  const [type, setType] = useState<EquipmentTypeKey>('rtu');
  const [designation, setDesignation] = useState<string | null>(null);
  const [existing, setExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!project || !equipment) return <Screen title="Add equipment">Loading…</Screen>;
  const info = EQUIPMENT_TYPES.find((t) => t.key === type)!;
  const used = equipment.filter((e) => e.type === type);
  const suggestion = suggestDesignation(
    info.prefix,
    used.map((e) => e.designation),
  );
  const full = used.length >= info.capacity;
  const shown = designation ?? suggestion;

  async function submit(e: FormEvent, again = false) {
    e.preventDefault();
    setError(null);
    try {
      const unit = await addEquipment(project!.id, type, shown || suggestion, existing);
      if (again) setDesignation(null);
      else nav(`/p/${project!.id}/e/${unit.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Screen title="Add equipment" subtitle={project.name} back={`/p/${project.id}/equipment`}>
      <form className="card card-pad stack" onSubmit={(e) => void submit(e)}>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label" style={{ marginBottom: 8 }}>
            Type
          </legend>
          <div className="type-picker">
            {EQUIPMENT_TYPES.map((t) => {
              const n = equipment.filter((e) => e.type === t.key).length;
              return (
                <button
                  key={t.key}
                  type="button"
                  className="type-option"
                  aria-pressed={type === t.key}
                  onClick={() => {
                    setType(t.key);
                    setDesignation(null);
                  }}
                >
                  <b>{t.plural}</b>
                  <small>
                    {n} / {t.capacity} used
                  </small>
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="field">
          <label className="field-label" htmlFor="eq-designation">
            Designation
          </label>
          <input
            id="eq-designation"
            className="input"
            value={shown}
            onChange={(e) => setDesignation(e.target.value)}
            autoComplete="off"
          />
          <span className="field-hint">{info.label}</span>
        </div>
        <div className="field">
          <span className="field-label" id="eq-ne">
            New or existing equipment
          </span>
          <div className="segmented" role="group" aria-labelledby="eq-ne">
            <button type="button" aria-pressed={!existing} onClick={() => setExisting(false)}>
              New
            </button>
            <button type="button" aria-pressed={existing} onClick={() => setExisting(true)}>
              Existing
            </button>
          </div>
          <span className="field-hint">Issues on existing equipment go to Summary - (E).</span>
        </div>
        {full && (
          <div className="callout" data-tone="amber">
            The workbook has room for {info.capacity} {info.plural}. Remove one to add another.
          </div>
        )}
        {info.warnAbove && used.length >= info.warnAbove && !full && (
          <div className="callout" data-tone="amber">
            Building Balance lists {info.plural.toLowerCase()} 1–{info.warnAbove} only; units past {info.warnAbove} are
            left out of the building exhaust total.
          </div>
        )}
        {error && (
          <div className="callout" data-tone="red" role="alert">
            {error}
          </div>
        )}
        <div className="row">
          <button className="btn btn-primary btn-lg" type="submit" disabled={full || !shown.trim()} style={{ flex: 1 }}>
            Add {shown || info.prefix}
          </button>
          <button
            className="btn btn-lg"
            type="button"
            disabled={full || !shown.trim()}
            onClick={(e) => void submit(e, true)}
          >
            Add & add another
          </button>
        </div>
      </form>
    </Screen>
  );
}
