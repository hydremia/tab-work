import { useNavigate } from 'react-router';
import { usePhotos, useInstruments } from '../../data/hooks';
import { addInstrument, deleteRecord, replacePhoto, setField } from '../../data/repo';
import type { FieldValue, NaMark, Project } from '../../data/types';
import { getSpec, type FieldSpec } from '../../domain/specs';
import { IconCamera, IconPlus, IconTrash } from '../components/Icons';
import { DateInput, TextInput } from '../components/inputs';
import { PhotoThumb } from '../components/PhotoThumb';
import { SpecField } from '../components/SpecField';
import { SCOPE_OPTIONS } from './NewProjectPage';
import { useProjectContext } from './ProjectLayout';

const INFO_FIELDS: FieldSpec[] = [
  { key: 'name', label: 'Project name', input: 'text' },
  { key: 'address', label: 'Physical address', input: 'text' },
  { key: 'architect', label: 'Architect', input: 'text', required: false },
  { key: 'mechanicalEngineer', label: 'Mechanical engineer', input: 'text' },
  { key: 'electricalEngineer', label: 'Electrical engineer', input: 'text', required: false },
  { key: 'generalContractor', label: 'General contractor', input: 'text', required: false },
  { key: 'mechanicalContractor', label: 'Mechanical contractor', input: 'text' },
  { key: 'tabDate', label: 'TAB date', input: 'date' },
  { key: 'technicians', label: 'Technician(s)', input: 'text' },
  { key: 'projectManager', label: 'Project manager', input: 'text' },
  { key: 'reportDate', label: 'Report date', input: 'date' },
  { key: 'narrative', label: 'Narrative: system set-up description', input: 'textarea' },
];

const infoPath = (key: string) => (key === 'name' ? 'name' : `info.${key}`);
const infoValue = (p: Project, key: string): FieldValue => (key === 'name' ? p.name : (p.info[key] ?? null));

function InfoField({ project, field }: { project: Project; field: FieldSpec }) {
  const value = infoValue(project, field.key);
  const mark = project.naState.fields[field.key];
  const blank = value === null || value === '';
  const state = blank
    ? mark
      ? { state: 'na' as const }
      : { state: field.required === false ? ('optional' as const) : ('missing' as const) }
    : { state: 'value' as const };
  return (
    <SpecField
      idPrefix="info"
      field={field}
      value={value}
      mark={mark}
      state={state}
      onChange={(v) =>
        void setField('projects', project.id, infoPath(field.key), field.key === 'name' ? String(v ?? '') : v)
      }
      onNa={
        field.key === 'name'
          ? undefined
          : (m: NaMark | null) =>
              void (async () => {
                if (m) await setField('projects', project.id, infoPath(field.key), null);
                await setField('projects', project.id, `naState.fields.${field.key}`, m);
              })()
      }
    />
  );
}

export function ProjectInfoPage() {
  const { project } = useProjectContext();
  const instruments = useInstruments(project.id);
  const cover = usePhotos(project.id, null)?.find((p) => p.category === 'cover');
  const nav = useNavigate();
  const blueprints = project.blueprints.length ? project.blueprints : [{ sheet: '', revisionDate: '' }];
  const fullSpecs = (['rtu', 'vav'] as const).map((t) => ({ type: t, spec: getSpec(t) }));

  return (
    <>
      <section className="card card-pad stack" aria-labelledby="pi-h">
        <h2 id="pi-h">Project information</h2>
        <div className="form-grid">
          {INFO_FIELDS.map((f) => (
            <InfoField key={f.key} project={project} field={f} />
          ))}
        </div>
      </section>

      <section className="card card-pad stack" aria-labelledby="bp-h">
        <h2 id="bp-h">Blueprints used</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Up to 9 sheets, each with its revision date.
        </p>
        {blueprints.map((bp, i) => (
          <div key={i} className="bp-row">
            <div className="field">
              <label className="field-label" htmlFor={`bp-sheet-${i}`}>
                Sheet {i + 1}
              </label>
              <TextInput
                id={`bp-sheet-${i}`}
                value={bp.sheet ?? ''}
                onCommit={(v) => void setField('projects', project.id, `blueprints.${i}.sheet`, v)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`bp-date-${i}`}>
                Revision date
              </label>
              <DateInput
                id={`bp-date-${i}`}
                value={bp.revisionDate ?? ''}
                onCommit={(v) => void setField('projects', project.id, `blueprints.${i}.revisionDate`, v ?? '')}
              />
            </div>
          </div>
        ))}
        {project.blueprints.length < 9 && (
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() =>
              void setField('projects', project.id, 'blueprints', [...blueprints, { sheet: '', revisionDate: '' }])
            }
          >
            <IconPlus size={18} /> Add sheet
          </button>
        )}
      </section>

      <section className="card card-pad stack" aria-labelledby="scope-h">
        <h2 id="scope-h">Scope and tolerance</h2>
        <div className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor="scope">
              Scope profile
            </label>
            <select
              id="scope"
              className="select"
              value={project.scopeProfile}
              onChange={(e) => void setField('projects', project.id, 'scopeProfile', e.target.value)}
            >
              {SCOPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label} — {o.hint}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="tol">
              Airflow tolerance (± % of design)
            </label>
            <select
              id="tol"
              className="select"
              value={Math.round(project.tolerance * 100)}
              onChange={(e) => void setField('projects', project.id, 'tolerance', Number(e.target.value) / 100)}
            >
              {[5, 10, 15, 20].map((v) => (
                <option key={v} value={v}>
                  ±{v} %
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="kind">
              Report
            </label>
            <select
              id="kind"
              className="select"
              value={project.reportKind}
              onChange={(e) => void setField('projects', project.id, 'reportKind', e.target.value)}
            >
              <option value="prelim">Preliminary</option>
              <option value="final">Final</option>
            </select>
          </div>
        </div>
        {project.scopeProfile === 'custom' &&
          fullSpecs.map(({ type, spec }) => (
            <fieldset
              key={type}
              className="stack"
              style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}
            >
              <legend className="field-label">{type.toUpperCase()} sections in scope</legend>
              <div className="row">
                {spec.sections
                  .filter((s) => !s.locked)
                  .map((s) => {
                    const on = project.customScope[type]?.[s.key] !== false;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        className="filter-chip"
                        aria-pressed={on}
                        onClick={() => void setField('projects', project.id, `customScope.${type}.${s.key}`, !on)}
                      >
                        {s.label}
                      </button>
                    );
                  })}
              </div>
            </fieldset>
          ))}
      </section>

      <section className="card card-pad stack" aria-labelledby="cover-h">
        <h2 id="cover-h">Cover photo</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Placed on the workbook's Cover Page at export, cropped to the photo box (about 1.685 : 1).
        </p>
        <div className="photo-grid">
          <div className="photo-slot">
            {cover ? (
              <PhotoThumb blob={cover.blob} alt="Cover photo" />
            ) : (
              <div className="photo-empty">No cover photo</div>
            )}
            <label className="btn file-btn">
              <IconCamera size={18} /> {cover ? 'Replace' : 'Add photo'}
              <input
                type="file"
                accept="image/*"
                aria-label="Cover photo"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void replacePhoto(project.id, f, 'cover', null);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>
      </section>

      <section className="card card-pad stack" aria-labelledby="cal-h">
        <h2 id="cal-h">Instruments (Calibration sheet)</h2>
        {instruments?.map((ins) => (
          <div
            key={ins.id}
            className="stack"
            style={{ gap: 8, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}
          >
            <div className="form-grid">
              {(['type', 'manufacturer', 'model', 'serial'] as const).map((k) => (
                <div className="field" key={k}>
                  <label className="field-label" htmlFor={`ins-${ins.id}-${k}`}>
                    {k === 'type' ? 'Instrument' : k[0].toUpperCase() + k.slice(1)}
                  </label>
                  <TextInput
                    id={`ins-${ins.id}-${k}`}
                    value={ins[k]}
                    onCommit={(v) => void setField('instruments', ins.id, k, v)}
                  />
                </div>
              ))}
              <div className="field">
                <label className="field-label" htmlFor={`ins-${ins.id}-cal`}>
                  Calibration date
                </label>
                <DateInput
                  id={`ins-${ins.id}-cal`}
                  value={ins.calibrationDate}
                  onCommit={(v) => void setField('instruments', ins.id, 'calibrationDate', v ?? '')}
                />
              </div>
            </div>
            <button
              className="btn btn-danger"
              type="button"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => void deleteRecord('instruments', ins.id)}
            >
              <IconTrash size={16} /> Remove
            </button>
          </div>
        ))}
        {(instruments?.length ?? 0) < 8 && (
          <button className="btn btn-ghost" type="button" onClick={() => void addInstrument(project.id)}>
            <IconPlus size={18} /> Add instrument
          </button>
        )}
      </section>

      <section className="card card-pad stack">
        <h2>Danger zone</h2>
        <button
          className="btn btn-danger"
          type="button"
          onClick={() => {
            if (window.confirm(`Delete "${project.name}" and all its data from this device?`)) {
              void deleteRecord('projects', project.id).then(() => nav('/', { replace: true }));
            }
          }}
        >
          <IconTrash size={16} /> Delete project
        </button>
      </section>
    </>
  );
}
