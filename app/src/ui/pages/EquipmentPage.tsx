import { blockLayout, TEMPLATE_MAP, UNIT_TYPE_COMPONENTS } from '@a2b/workbook/map';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  useAirflowRows,
  useConflicts,
  useEquipment,
  useEquipmentList,
  useHistory,
  useInstruments,
  useIssues,
  usePhotos,
  useProject,
  useUserName,
} from '../../data/hooks';
import { clearReview, deleteRecord, duplicateEquipment, markReviewed, setField, setFields } from '../../data/repo';
import { makeContext } from '../../domain/historyView';
import { HistoryList } from '../components/HistoryList';
import { ConflictKeysContext, conflictKeys } from '../components/ConflictFlag';
import { ConflictList } from '../components/Conflicts';
import { LockBanner } from '../components/LockBanner';
import { INSTRUMENT_FIELDS, pickerWarning } from '../../domain/instruments';
import { NOTATIONS, type Equipment, type FieldValue, type NaMark, type Notation, type Project } from '../../data/types';
import { formatNumber } from '../../domain/calc';
import {
  computeCompletion,
  displayColor,
  STATUS_LABEL,
  type Completion,
  type SectionResult,
} from '../../domain/completion';
import { evalCond } from '../../domain/conditions';
import { traverseLayout } from '../../domain/equipmentCalcs';
import { equipmentType, nextDesignation } from '../../domain/equipmentTypes';
import { getSpec, type FieldSpec, type SectionSpec, type SequenceSpec } from '../../domain/specs';
import { AirflowTable } from '../components/AirflowTable';
import { CalcPanel, espText, unitEspCheck } from '../components/CalcPanels';
import { SequenceGrid, type GridShape } from '../components/SequenceGrid';
import { IconChevron, IconHistory, IconTrash } from '../components/Icons';
import { PhotoSlots } from '../components/PhotoSlots';
import { Screen } from '../components/Screen';
import { SpecField } from '../components/SpecField';
import { StatusBadge, StatusIcon } from '../components/Status';
import type { AirflowRow, Instrument, Issue, Photo } from '../../data/types';

function fieldLabel(f: FieldSpec, data: Equipment['data']): string {
  if (!f.component) return f.label;
  const ut = typeof data.unitType === 'string' ? data.unitType : '';
  const comp = UNIT_TYPE_COMPONENTS[ut]?.[f.component - 1];
  return comp ? `Leaving ${comp}` : f.label;
}

/** Remark lines the workbook has for this unit (hoods / traverses share a page box). */
function remarkRoom(e: Equipment): string {
  const def = TEMPLATE_MAP.equipment.find((d) => d.key === e.type);
  const n = def ? (blockLayout(def, e.slot).lines?.find((l) => l.key === 'remarks')?.cells.length ?? 0) : 0;
  const shared =
    e.type === 'hood' || e.type === 'traverse' ? ' (a remark box shared with the other units on the page)' : '';
  return `One line per workbook remark line: ${n} line${n === 1 ? '' : 's'} for this unit${shared}.`;
}

/** Quick-entry grid shape: traverse points follow the calculated layout, PSP readings 10 per row as on the sheet. */
function gridShape(q: SequenceSpec, e: Equipment): GridShape {
  if (e.type === 'traverse') {
    const l = traverseLayout(e.data);
    if (l.nW && l.points) {
      const round = e.data.shape === 'Round';
      return {
        across: l.nW,
        shown: l.points,
        rowLabel: (r) => (round ? `Axis ${r + 1} (${r === 0 ? '0°' : '90°'})` : `Depth ${l.depths[r] ?? '—'}"`),
        colLabel: (c) => `${l.positions[c] ?? '—'}"`,
      };
    }
    return { across: 4, shown: 12 };
  }
  return { across: 5, shown: q.count };
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
  instruments,
}: {
  section: SectionSpec;
  equipment: Equipment;
  project: Project;
  completion: Completion;
  rows: AirflowRow[];
  photos: Photo[];
  instruments: Instrument[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  const r = completion.sections[section.key];
  const values = { ...equipment.data, designation: equipment.designation };
  const folded = !unfolded && section.foldWhen !== undefined && evalCond(section.foldWhen, values);
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
      {!collapsed && folded && (
        <div className="section-body" id={bodyId}>
          <div className="na-auto">
            <span>
              {section.foldNote} {rows.filter((x) => section.tables?.some((t) => t.key === x.table)).length} row(s)
              kept.
            </span>
          </div>
          <button type="button" className="btn" onClick={() => setUnfolded(true)}>
            Show {section.label.toLowerCase()}
          </button>
        </div>
      )}
      {!collapsed && !folded && (
        <div className="section-body" id={bodyId}>
          {section.hint && <p className="small muted section-hint">{section.hint}</p>}
          {section.fields.length > 0 && (
            <div className="form-grid">
              {section.fields.map((f) => (
                <SpecField
                  key={f.key}
                  idPrefix={equipment.id.slice(0, 8)}
                  field={f.key === 'remarks' ? { ...f, hint: remarkRoom(equipment) } : f}
                  label={fieldLabel(f, equipment.data)}
                  value={f.recordField ? equipment.designation : equipment.data[f.key]}
                  state={completion.fields[f.key]}
                  mark={equipment.naState.fields[f.key]}
                  onChange={onField(f)}
                  onNa={f.recordField ? undefined : onNa(f)}
                  warning={
                    (INSTRUMENT_FIELDS as readonly string[]).includes(f.key)
                      ? pickerWarning(equipment.data[f.key], instruments)
                      : null
                  }
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
          {section.sequences?.map((q) => (
            <SequenceGrid
              key={q.key}
              equipment={equipment}
              spec={q}
              result={completion.sequences[q.key]}
              shape={gridShape(q, equipment)}
            />
          ))}
          {section.calc && (
            <CalcPanel
              panel={section.calc}
              equipment={equipment}
              rows={rows}
              tolerance={project.tolerance}
              completion={completion}
            />
          )}
          {section.photos && (
            <PhotoSlots equipment={equipment} specs={section.photos} photos={photos} results={completion.photos} />
          )}
        </div>
      )}
    </section>
  );
}

/** Duplicate the unit: next free designation and slot suggested; design data, optionally outlet rows w/o readings. */
function DuplicateCard({ equipment, all }: { equipment: Equipment; all: Equipment[] }) {
  const nav = useNavigate();
  const info = equipmentType(equipment.type);
  const same = all.filter((e) => e.type === equipment.type);
  const suggestion = nextDesignation(
    equipment.designation,
    same.map((e) => e.designation),
  );
  const [open, setOpen] = useState(false);
  const [designation, setDesignation] = useState<string | null>(null);
  const [withRows, setWithRows] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const full = same.length >= info.capacity;
  const slot = (() => {
    const used = new Set(same.map((e) => e.slot));
    for (let s = 1; s <= info.capacity; s++) if (!used.has(s)) return s;
    return null;
  })();
  const name = (designation ?? suggestion).trim();
  const taken = same.some((e) => e.designation.trim().toLowerCase() === name.toLowerCase());
  const tables = getSpec(equipment.type).sections.some((s) => s.tables?.length);
  return (
    <section className="card card-pad stack" aria-labelledby="dup-h">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="dup-h" style={{ margin: 0 }}>
          Duplicate
        </h2>
        {!open && (
          <button
            type="button"
            className="btn"
            data-testid="duplicate-open"
            disabled={full}
            onClick={() => setOpen(true)}
          >
            Duplicate {equipment.designation}
          </button>
        )}
      </div>
      {full && (
        <p className="small muted" style={{ margin: 0 }}>
          The workbook has room for {info.capacity} {info.plural}.
        </p>
      )}
      {open && !full && (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            Copies the design (schedule) data and set-up: unit type, drive, motor nameplate, filters, instrument,
            method. Not copied: serial number, readings, remarks and photos.
          </p>
          <div className="field">
            <label className="field-label" htmlFor="dup-designation">
              New designation
            </label>
            <input
              id="dup-designation"
              className="input"
              value={designation ?? suggestion}
              onChange={(e) => setDesignation(e.target.value)}
              autoComplete="off"
            />
            <span className="field-hint">
              {info.plural} slot {slot} in the workbook{taken ? ' · this designation is already used' : ''}
            </span>
          </div>
          {tables && (
            <label className="row small" style={{ gap: 8 }}>
              <input type="checkbox" checked={withRows} onChange={(e) => setWithRows(e.target.checked)} />
              Copy outlet / filter rows (without readings)
            </label>
          )}
          {error && (
            <div className="callout" data-tone="red" role="alert">
              {error}
            </div>
          )}
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              data-testid="duplicate-create"
              disabled={!name || taken}
              onClick={() =>
                void duplicateEquipment(equipment.id, name, { rows: withRows && tables })
                  .then((copy) => {
                    setOpen(false);
                    setDesignation(null);
                    nav(`/p/${equipment.projectId}/e/${copy.id}`);
                    window.scrollTo(0, 0);
                  })
                  .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
              }
            >
              Create {name || '…'}
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}

const stamp = (t: number) => new Date(t).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

/** Review sign-off: any user can mark a green unit reviewed (blue); any later change of the unit clears it. */
function ReviewRow({
  equipment,
  completion,
  locked,
}: {
  equipment: Equipment;
  completion: Completion;
  locked: boolean;
}) {
  const saved = useUserName();
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = typed ?? saved ?? '';
  const review = equipment.review;
  const green = completion.color === 'green';
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  if (review) {
    return (
      <div className="review-row" data-testid="review-row">
        <span className="grow">
          {green ? (
            <span className="review-done" data-testid="review-status">
              <StatusIcon color="blue" size={16} /> Reviewed{review.name ? ` by ${review.name}` : ''} ·{' '}
              {stamp(review.at)}
            </span>
          ) : (
            <span className="small" data-testid="review-status">
              Reviewed{review.name ? ` by ${review.name}` : ''} on {stamp(review.at)}, but the unit is no longer
              complete.
            </span>
          )}
        </span>
        <button
          type="button"
          className="btn"
          disabled={locked}
          data-testid="clear-review"
          onClick={() => void clearReview(equipment.id).catch(fail)}
        >
          Clear review
        </button>
        {error && (
          <span className="small" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }
  if (!green)
    return (
      <p className="small muted" style={{ margin: 0 }} data-testid="review-status">
        Can be marked reviewed once complete (green).
      </p>
    );
  return (
    <div className="review-row" data-testid="review-row">
      <label className="visually-hidden" htmlFor="reviewer">
        Reviewer name
      </label>
      <input
        id="reviewer"
        className="input"
        placeholder="Reviewer name"
        value={name}
        disabled={locked}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="name"
      />
      <button
        type="button"
        className="btn btn-primary"
        disabled={locked || !name.trim()}
        data-testid="mark-reviewed"
        onClick={() => void markReviewed(equipment.id, name).then(() => setTyped(null), fail)}
      >
        <StatusIcon color="blue" size={16} /> Mark reviewed
      </button>
      {error && (
        <span className="small" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** The unit's change history (its fields, N/A marks, rows, photos, linked issues, review). */
function UnitHistory({
  equipment,
  all,
  rows,
  issues,
  instruments,
}: {
  equipment: Equipment;
  all: Equipment[];
  rows: AirflowRow[];
  issues: Issue[];
  instruments: Instrument[];
}) {
  const [open, setOpen] = useState(false);
  const entries = useHistory(equipment.projectId, equipment.id);
  const ctx = makeContext({ equipment: all, rows, issues, instruments });
  const shown = 40;
  return (
    <section className="card card-pad stack" aria-labelledby="uh-h" data-testid="unit-history">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="uh-h" style={{ margin: 0 }}>
          History
        </h2>
        <button
          type="button"
          className="btn"
          aria-expanded={open}
          data-testid="unit-history-toggle"
          onClick={() => setOpen(!open)}
        >
          <IconHistory size={18} /> {open ? 'Hide' : `Show${entries ? ` (${entries.length})` : ''}`}
        </button>
      </div>
      {open && entries && (
        <>
          <HistoryList entries={entries.slice(0, shown)} ctx={ctx} showSubject={false} />
          <Link to={`/p/${equipment.projectId}/history?unit=${equipment.id}`} className="small">
            {entries.length > shown ? `All ${entries.length} changes` : 'Open'} in the project History (filters)
          </Link>
        </>
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
  const instruments = useInstruments(projectId);
  const all = useEquipmentList(projectId);
  const conflicts = useConflicts(projectId);
  const nav = useNavigate();
  const { hash } = useLocation();
  const back = `/p/${projectId}/equipment`;
  const ready = Boolean(project && equipment && rows && photos && issues && instruments && all);
  // a link to a section (needs-attention list, "Show missing"): scroll there once the form is rendered
  useEffect(() => {
    if (!ready || !hash) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (el) el.scrollIntoView({ block: 'start' });
  }, [ready, hash, equipmentId]);

  if (project === null || equipment === null) {
    return (
      <Screen title="Not found" back={back}>
        <p>This unit is not on this device.</p>
      </Screen>
    );
  }
  if (!project || !equipment || !rows || !photos || !issues || !instruments || !all)
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
  const values = { ...equipment.data, designation: equipment.designation };
  const sections = spec.sections.filter((s) => !s.showWhen || evalCond(s.showWhen, values));
  const esp = unitEspCheck(equipment, c, project.tolerance);
  const locked = Boolean(project.lock);
  const shown = displayColor(c.color, Boolean(equipment.review));
  const unitConflicts = (conflicts ?? []).filter((x) => x.equipmentId === equipment.id);

  return (
    <Screen title={equipment.designation} subtitle={`${info.label} · ${project.name}`} back={back}>
      <ConflictKeysContext.Provider value={conflictKeys(unitConflicts, equipment.id)}>
        <LockBanner project={project} />
        {unitConflicts.length > 0 && (
          <section className="card card-pad stack" data-testid="unit-conflicts" aria-labelledby="unit-conflicts-h">
            <h2 id="unit-conflicts-h">Sync conflicts</h2>
            <ConflictList
              conflicts={unitConflicts}
              project={project}
              equipment={all}
              issues={issues}
              linkUnit={false}
            />
          </section>
        )}
        <section className="card unit-summary" aria-label="Status">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <StatusBadge color={shown} label={shown === 'blue' ? STATUS_LABEL.blue : c.label} />
            <div className="segmented" role="group" aria-label="New or existing" style={{ flex: '0 0 auto' }}>
              <button
                type="button"
                aria-pressed={!equipment.isExisting}
                disabled={locked}
                onClick={() => void setField('equipment', equipment.id, 'isExisting', false)}
              >
                New
              </button>
              <button
                type="button"
                aria-pressed={equipment.isExisting}
                disabled={locked}
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
          {c.designDiscrepancies.map((d) => (
            <div className="callout" data-tone="amber" key={d.field}>
              Design discrepancy: schedule {formatNumber(d.schedule)} CFM vs. {d.label} {formatNumber(d.outlets)} CFM.
            </div>
          ))}
          {esp && (
            <div className="callout" data-tone="amber" data-testid="summary-esp-warning">
              {espText(esp)} Outside ±{Math.round(project.tolerance * 100)} % (static pressure profile).
            </div>
          )}
          {info.warnAbove && equipment.slot > info.warnAbove && (
            <div className="callout" data-tone="amber" role="status">
              {equipment.designation} is {info.plural.toLowerCase()} slot {equipment.slot}: Building Balance lists{' '}
              {info.plural.toLowerCase()} 1–{info.warnAbove} only, so it is left out of the building exhaust total.
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
          <ReviewRow equipment={equipment} completion={c} locked={locked} />
        </section>

        {sections.length > 2 && (
          <nav className="section-nav" aria-label="Jump to section">
            {sections.map((s) => {
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

        <fieldset className="lockable" disabled={locked} data-testid="unit-form">
          <legend className="visually-hidden">{equipment.designation} data</legend>
          {sections.map((s) => (
            <SectionCard
              key={s.key}
              section={s}
              equipment={equipment}
              project={project}
              completion={c}
              rows={rows}
              photos={photos}
              instruments={instruments}
            />
          ))}

          <DuplicateCard equipment={equipment} all={all} />

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
        </fieldset>

        <UnitHistory equipment={equipment} all={all} rows={rows} issues={issues} instruments={instruments} />
      </ConflictKeysContext.Provider>
    </Screen>
  );
}
