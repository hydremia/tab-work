import { useNavigate } from 'react-router';
import { usePhotos, useInstruments, useProjectCompletion } from '../../data/hooks';
import { addInstrument, deleteRecord, setField } from '../../data/repo';
import type { FieldValue, NaMark, Photo, Project } from '../../data/types';
import { calibrationExpired } from '../../domain/instruments';
import {
  KITCHEN_NA_REASON,
  PRESSURE_FIELDS,
  PRESSURE_KEYS,
  pressureStates,
  type ProjectCompletion,
} from '../../domain/projectCompletion';
import { getSpec, type FieldSpec } from '../../domain/specs';
import { IconPlus, IconTrash } from '../components/Icons';
import { PhotoPicker, SaverStatus, usePhotoSaver } from '../components/PhotoPicker';
import { DateInput, NaSelect, TextInput } from '../components/inputs';
import { StatusIcon } from '../components/Status';
import { PhotoThumb } from '../components/PhotoThumb';
import { SpecField } from '../components/SpecField';
import { SCOPE_OPTIONS } from './NewProjectPage';
import { INFO_FIELDS } from '../../domain/projectFields';
import { useProjectContext } from './ProjectLayout';

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

const pressureField = (key: string) => PRESSURE_FIELDS.find((f) => f.key === key)!;

function PressureField({
  project,
  fieldKey,
  hasHoods,
  label,
}: {
  project: Project;
  fieldKey: string;
  hasHoods: boolean;
  label?: string;
}) {
  const field = pressureField(fieldKey);
  const state = pressureStates(project, hasHoods)[fieldKey];
  return (
    <SpecField
      idPrefix="bb"
      field={field}
      label={label}
      value={project.info[fieldKey] ?? null}
      mark={project.naState.fields[fieldKey]}
      state={state}
      onChange={(v) => void setField('projects', project.id, `info.${fieldKey}`, v)}
      onNa={(m: NaMark | null) =>
        void (async () => {
          if (m) await setField('projects', project.id, `info.${fieldKey}`, null);
          await setField('projects', project.id, `naState.fields.${fieldKey}`, m);
        })()
      }
    />
  );
}

/** Building Balance: measured building pressures (rows 97-99) and notes. */
function BuildingPressures({ project, hasHoods }: { project: Project; hasHoods: boolean }) {
  return (
    <section className="card card-pad stack" aria-labelledby="bb-h" data-testid="building-pressures">
      <h2 id="bb-h">Building pressures (Building Balance)</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Measured ΔP in in. w.g., test space relative to the reference space.
        {!hasHoods && ` Kitchen vs Dining is automatically N/A (${KITCHEN_NA_REASON}).`}
      </p>
      <div className="pressure-row">
        <h3>Building vs Outdoors</h3>
        <div className="form-grid">
          <PressureField project={project} fieldKey={PRESSURE_KEYS.buildingDp} hasHoods={hasHoods} label="ΔP" />
          <PressureField project={project} fieldKey={PRESSURE_KEYS.buildingRemarks} hasHoods={hasHoods} />
        </div>
      </div>
      <div className="pressure-row">
        <h3>Kitchen vs Dining</h3>
        <div className="form-grid">
          <PressureField project={project} fieldKey={PRESSURE_KEYS.kitchenDp} hasHoods={hasHoods} label="ΔP" />
          <PressureField project={project} fieldKey={PRESSURE_KEYS.kitchenRemarks} hasHoods={hasHoods} />
        </div>
      </div>
      <div className="pressure-row">
        <h3>Spare pair (optional)</h3>
        <div className="form-grid">
          <PressureField project={project} fieldKey={PRESSURE_KEYS.spareTest} hasHoods={hasHoods} />
          <PressureField project={project} fieldKey={PRESSURE_KEYS.spareRef} hasHoods={hasHoods} />
          <PressureField project={project} fieldKey={PRESSURE_KEYS.spareDp} hasHoods={hasHoods} />
          <PressureField project={project} fieldKey={PRESSURE_KEYS.spareRemarks} hasHoods={hasHoods} />
        </div>
      </div>
      <div className="form-grid">
        <PressureField project={project} fieldKey={PRESSURE_KEYS.notes} hasHoods={hasHoods} />
      </div>
    </section>
  );
}

const SECTION_LINK: Record<ProjectCompletion['missing'][number]['section'], string> = {
  info: '#pi-h',
  cover: '#cover-h',
  calibration: '#cal-h',
  pressures: '#bb-h',
};

function ProjectStatusCard({ c }: { c: ProjectCompletion }) {
  const done = c.missing.length === 0;
  return (
    <section className="card card-pad stack" aria-label="Project information status" data-testid="project-completion">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="row" style={{ gap: 6 }}>
          <StatusIcon color={done ? 'green' : 'amber'} size={18} />
          <b>
            {done
              ? 'Project information complete'
              : `${c.missing.length} required item${c.missing.length > 1 ? 's' : ''} missing`}
          </b>
        </span>
        <span className="small muted">
          {c.satisfied} of {c.required}
        </span>
      </div>
      {!done && (
        <ul className="missing-list">
          {c.missing.map((m) => (
            <li key={m.key}>
              <a href={SECTION_LINK[m.section]}>{m.label}</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CoverPhoto({ projectId, cover }: { projectId: string; cover: Photo | undefined }) {
  const saver = usePhotoSaver(projectId);
  return (
    <div className="photo-grid">
      <div className="photo-slot" data-testid="cover-slot">
        {cover ? (
          <PhotoThumb blob={cover.thumb ?? cover.blob} alt="Cover photo" />
        ) : (
          <div className="photo-empty">No cover photo</div>
        )}
        <PhotoPicker
          label="Cover photo"
          compact
          takeText="Take photo"
          chooseText="Choose from library"
          disabled={Boolean(saver.busy)}
          onFiles={(files) => void saver.save(files.slice(0, 1), { category: 'cover' }, { replace: true })}
        />
        <SaverStatus busy={saver.busy} error={saver.error} onDismiss={saver.clearError} />
      </div>
    </div>
  );
}

export function ProjectInfoPage() {
  const { project, equipment, locked } = useProjectContext();
  const instruments = useInstruments(project.id);
  const completion = useProjectCompletion(project);
  const hasHoods = equipment.some((e) => e.type === 'hood');
  const coverMark = project.naState.fields['photo:cover'];
  const cover = usePhotos(project.id, null)?.find((p) => p.category === 'cover');
  const nav = useNavigate();
  const blueprints = project.blueprints.length ? project.blueprints : [{ sheet: '', revisionDate: '' }];
  const fullSpecs = (['rtu', 'vav'] as const).map((t) => ({ type: t, spec: getSpec(t) }));

  return (
    <>
      {completion && <ProjectStatusCard c={completion} />}
      <fieldset className="lockable" disabled={locked} data-testid="info-form">
        <legend className="visually-hidden">Project data</legend>
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
          <CoverPhoto projectId={project.id} cover={cover} />
          {!cover && (
            <div className="row small">
              <span className="muted">
                {coverMark ? `Cover photo: ${coverMark.notation}` : 'No cover photo for this report?'}
              </span>
              <NaSelect
                label="Cover photo"
                mark={coverMark}
                onChange={(m) => void setField('projects', project.id, 'naState.fields.photo:cover', m)}
              />
            </div>
          )}
        </section>

        <BuildingPressures project={project} hasHoods={hasHoods} />

        <section className="card card-pad stack" aria-labelledby="cal-h">
          <h2 id="cal-h">Instruments (Calibration sheet)</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Up to 8 instruments. New projects start with the 7 a2b instruments of the template; edit, remove or add your
            own.
          </p>
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
                  {calibrationExpired(ins.calibrationDate, project.info.tabDate) && (
                    <span className="field-warning" data-testid="calibration-expired">
                      More than 12 months before the TAB date
                    </span>
                  )}
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
      </fieldset>

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
