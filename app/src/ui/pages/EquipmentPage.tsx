import { UNIT_TYPE_COMPONENTS } from '@a2b/workbook/map';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAirflowRows, useEquipment, useIssues, usePhotos, useProject } from '../../data/hooks';
import { deleteRecord, setField, setFields } from '../../data/repo';
import { NOTATIONS, type Equipment, type FieldValue, type NaMark, type Notation, type Project } from '../../data/types';
import { formatNumber } from '../../domain/calc';
import { computeCompletion, type Completion, type SectionResult } from '../../domain/completion';
import { equipmentType } from '../../domain/equipmentTypes';
import { getSpec, type FieldSpec, type SectionSpec } from '../../domain/specs';
import { AirflowTable } from '../components/AirflowTable';
import { IconChevron, IconTrash } from '../components/Icons';
import { PhotoSlots } from '../components/PhotoSlots';
import { Screen } from '../components/Screen';
import { SpecField } from '../components/SpecField';
import { StatusBadge, StatusIcon } from '../components/Status';
import type { AirflowRow, Photo } from '../../data/types';

function fieldLabel(f: FieldSpec, data: Equipment['data']): string {
  if (!f.component) return f.label;
  const ut = typeof data.unitType === 'string' ? data.unitType : '';
  const comp = UNIT_TYPE_COMPONENTS[ut]?.[f.component - 1];
  return comp ? `Leaving ${comp}` : f.label;
}

function SectionStatus({ r }: { r: SectionResult }) {
  if (r.state === 'na') {
    return (
      <span className="count">
        <StatusIcon color="green" size={16} /> {r.notation ?? 'N/A'}
        {r.naSource === 'scope' ? ' (scope)' : ''}
      </span>
    );
  }
  if (r.state === 'complete') {
    return (
      <span className="count">
        <StatusIcon color="green" size={16} /> Complete
      </span>
    );
  }
  if (r.state === 'empty') return <span className="count">Optional</span>;
  return (
    <span className="count">
      <StatusIcon color={r.satisfied ? 'amber' : 'gray'} size={16} /> {r.required - r.satisfied} missing
    </span>
  );
}

function SectionCard({
  section,
  equipment,
  project,
  completion,
  rows,
  photos,
}: {
  section: SectionSpec;
  equipment: Equipment;
  project: Project;
  completion: Completion;
  rows: AirflowRow[];
  photos: Photo[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const r = completion.sections[section.key];
  const mark = equipment.naState.sections[section.key];
  const bodyId = `sec-${section.key}-body`;

  const onField = (f: FieldSpec) => (v: FieldValue) => {
    if (f.recordField)
      void setField('equipment', equipment.id, f.recordField, String(v ?? '').trim() || equipment.designation);
    else void setField('equipment', equipment.id, `data.${f.key}`, v);
  };
  const onNa = (f: FieldSpec) => (m: NaMark | null) =>
    void setFields(
      'equipment',
      equipment.id,
      m ? { [`data.${f.key}`]: null, [`naState.fields.${f.key}`]: m } : { [`naState.fields.${f.key}`]: null },
    );

  return (
    <section
      className="card section"
      id={`sec-${section.key}`}
      data-collapsed={collapsed}
      aria-labelledby={`sec-${section.key}-h`}
    >
      <div className="section-head">
        <button
          type="button"
          className="toggle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed(!collapsed)}
        >
          <h2 id={`sec-${section.key}-h`}>{section.label}</h2>
          <SectionStatus r={r} />
          <IconChevron open={!collapsed} />
        </button>
        {!section.locked && (
          <select
            className="section-menu"
            aria-label={`${section.label} options`}
            value=""
            onChange={(e) => {
              const v = e.target.value;
              const path = `naState.sections.${section.key}`;
              if (v === 'clear') void setField('equipment', equipment.id, path, null);
              else if (v === 'applies') void setField('equipment', equipment.id, path, 'applies');
              else if ((NOTATIONS as readonly string[]).includes(v))
                void setField('equipment', equipment.id, path, { notation: v as Notation });
            }}
          >
            <option value="">Section options</option>
            {NOTATIONS.map((n) => (
              <option key={n} value={n}>
                Mark section {n}
              </option>
            ))}
            {r.naSource === 'scope' && <option value="applies">Include (override scope)</option>}
            {mark && (
              <option value="clear">{mark === 'applies' ? 'Follow the scope profile' : 'Clear section N/A'}</option>
            )}
          </select>
        )}
      </div>
      {!collapsed && (
        <div className="section-body" id={bodyId}>
          {section.fields.length > 0 && (
            <div className="form-grid">
              {section.fields.map((f) => (
                <SpecField
                  key={f.key}
                  idPrefix={equipment.id.slice(0, 8)}
                  field={f}
                  label={fieldLabel(f, equipment.data)}
                  value={f.recordField ? equipment.designation : equipment.data[f.key]}
                  state={completion.fields[f.key]}
                  mark={equipment.naState.fields[f.key]}
                  onChange={onField(f)}
                  onNa={f.recordField ? undefined : onNa(f)}
                />
              ))}
            </div>
          )}
          {section.tables?.map((t) => (
            <AirflowTable
              key={t.key}
              equipment={equipment}
              spec={t}
              rows={rows.filter((x) => x.table === t.key)}
              result={completion.tables[t.key]}
              tolerance={project.tolerance}
            />
          ))}
          {section.photos && (
            <PhotoSlots equipment={equipment} specs={section.photos} photos={photos} results={completion.photos} />
          )}
        </div>
      )}
    </section>
  );
}

export function EquipmentPage() {
  const { projectId, equipmentId } = useParams();
  const project = useProject(projectId);
  const equipment = useEquipment(equipmentId);
  const rows = useAirflowRows(equipmentId);
  const photos = usePhotos(projectId, equipmentId ?? null);
  const issues = useIssues(projectId);
  const nav = useNavigate();
  const back = `/p/${projectId}/equipment`;

  if (project === null || equipment === null) {
    return (
      <Screen title="Not found" back={back}>
        <p>This unit is not on this device.</p>
      </Screen>
    );
  }
  if (!project || !equipment || !rows || !photos || !issues)
    return (
      <Screen title="Loading…" back={back}>
        {null}
      </Screen>
    );

  const spec = getSpec(equipment.type);
  const info = equipmentType(equipment.type);
  const unitIssues = issues.filter((i) => i.equipmentId === equipment.id && i.status === 'Open');
  const c = computeCompletion({ spec, unit: equipment, rows, photos, project, openIssues: unitIssues.length });
  const pct = c.required ? Math.round((c.satisfied / c.required) * 100) : 0;

  return (
    <Screen title={equipment.designation} subtitle={`${info.label} · ${project.name}`} back={back}>
      <section className="card unit-summary" aria-label="Status">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <StatusBadge color={c.color} label={c.label} />
          <div className="segmented" role="group" aria-label="New or existing" style={{ flex: '0 0 auto' }}>
            <button
              type="button"
              aria-pressed={!equipment.isExisting}
              onClick={() => void setField('equipment', equipment.id, 'isExisting', false)}
            >
              New
            </button>
            <button
              type="button"
              aria-pressed={equipment.isExisting}
              onClick={() => void setField('equipment', equipment.id, 'isExisting', true)}
            >
              Existing
            </button>
          </div>
        </div>
        <div>
          <div className="row small muted" style={{ justifyContent: 'space-between' }}>
            <span data-testid="unit-progress">
              {c.satisfied} of {c.required} required items
            </span>
            <span>{pct} %</span>
          </div>
          <div className="progress" style={{ marginTop: 4 }}>
            <span
              className={c.color === 'green' ? 'seg-green' : c.color === 'red' ? 'seg-red' : 'seg-amber'}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        {c.formIncomplete && (
          <div className="callout" data-tone="info">
            The full {info.plural} form is coming soon (Phase 2). Identity can be edited now; the unit stays amber until
            the form is built.
          </div>
        )}
        {c.outOfTolerance.length > 0 && (
          <div className="callout" data-tone="red" role="status">
            <StatusIcon color="red" size={18} />
            <span>
              Out of ±{Math.round(project.tolerance * 100)} % tolerance:{' '}
              {c.outOfTolerance.map((t) => `${t.label} (${Math.round(t.ratio * 100)} %)`).join(', ')}
            </span>
          </div>
        )}
        {unitIssues.length > 0 && (
          <div className="callout" data-tone="red">
            <StatusIcon color="red" size={18} />
            <span>
              {unitIssues.length} open issue{unitIssues.length > 1 ? 's' : ''}:{' '}
              <Link to={`/p/${project.id}/issues`}>view issues</Link>
            </span>
          </div>
        )}
        {c.designDiscrepancy && (
          <div className="callout" data-tone="amber">
            Design discrepancy: schedule {formatNumber(c.designDiscrepancy.schedule)} CFM vs. outlets{' '}
            {formatNumber(c.designDiscrepancy.outlets)} CFM.
          </div>
        )}
        {c.missing.length > 0 && (
          <details>
            <summary className="small" style={{ cursor: 'pointer', minHeight: 32 }}>
              Show missing ({c.missing.length})
            </summary>
            <ul className="missing-list">
              {c.missing.map((m) => (
                <li key={`${m.section}-${m.key}`}>
                  <a href={`#sec-${m.section}`}>{m.label}</a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {spec.sections.length > 2 && (
        <nav className="section-nav" aria-label="Jump to section">
          {spec.sections.map((s) => {
            const r = c.sections[s.key];
            const color =
              r.state === 'incomplete' ? (r.satisfied ? 'amber' : 'gray') : r.state === 'empty' ? 'gray' : 'green';
            return (
              <a key={s.key} href={`#sec-${s.key}`}>
                <StatusIcon color={color} size={14} />
                {s.label.replace(/ \(.*\)$/, '')}
              </a>
            );
          })}
        </nav>
      )}

      {spec.sections.map((s) => (
        <SectionCard
          key={s.key}
          section={s}
          equipment={equipment}
          project={project}
          completion={c}
          rows={rows}
          photos={photos}
        />
      ))}

      <section className="card card-pad stack" aria-label="Unit actions">
        <div className="field">
          <label className="field-label" htmlFor="unit-na">
            Whole unit N/A
          </label>
          <select
            id="unit-na"
            className="select"
            value={equipment.naState.equipment?.notation ?? ''}
            onChange={(e) =>
              void setField(
                'equipment',
                equipment.id,
                'naState.equipment',
                e.target.value ? { notation: e.target.value as Notation } : null,
              )
            }
          >
            <option value="">Applies (not N/A)</option>
            {NOTATIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            if (window.confirm(`Delete ${equipment.designation} and its readings?`))
              void deleteRecord('equipment', equipment.id).then(() => nav(back, { replace: true }));
          }}
        >
          <IconTrash size={16} /> Delete {equipment.designation}
        </button>
      </section>
    </Screen>
  );
}
