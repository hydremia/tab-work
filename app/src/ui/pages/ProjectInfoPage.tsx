import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router';
import { db } from '../../data/db';
import { useCertProfile, usePhotos, useInstruments, useProjectCompletion } from '../../data/hooks';
import {
  addInstrument,
  addInstrumentFromLibrary,
  CALIBRATION_SLOTS,
  deleteRecord,
  differsFromLibrary,
  saveInstrumentToLibrary,
  setField,
  setFields,
  updateInstrumentFromLibrary,
} from '../../data/repo';
import type { Equipment, FieldValue, Instrument, LibraryInstrument, NaMark, Photo, Project } from '../../data/types';
import { formatNumber, formatPercent } from '../../domain/calc';
import {
  CERT_FIELDS,
  CERT_KEYS,
  certificationExpired,
  certificationStates,
  certValue,
} from '../../domain/certification';
import { calibrationExempt, calibrationExpired } from '../../domain/instruments';
import { AIR_BALANCE_KEYS, designFieldOf, excludedIds, excludedUnits } from '../../domain/airBalance';
import { balanceLines, buildingBalance } from '../../domain/equipmentCalcs';
import {
  SPARE_OA_ROWS,
  spareOaCell,
  spareOaKey,
  spareOaTotals,
  spareOaUsedCount,
  SPARE_OA_COLUMNS,
  type SpareOaColumn,
} from '../../domain/spareOa';
import {
  KITCHEN_NA_REASON,
  PRESSURE_FIELDS,
  PRESSURE_KEYS,
  pressureStates,
  type ProjectCompletion,
} from '../../domain/projectCompletion';
import { EQUIPMENT_TYPES, equipmentType } from '../../domain/equipmentTypes';
import { HYDRONIC_INFO_KEYS } from '../../workbook/adapter';
import { getSpec, type FieldSpec } from '../../domain/specs';
import { IconPlus, IconTrash } from '../components/Icons';
import { PhotoPicker, SaverStatus, usePhotoSaver } from '../components/PhotoPicker';
import { DateInput, NaSelect, TextInput } from '../components/inputs';
import { StatusIcon } from '../components/Status';
import { PhotoThumb } from '../components/PhotoThumb';
import { SpecField } from '../components/SpecField';
import { ConflictKeysContext, conflictKeys } from '../components/ConflictFlag';
import { DeleteProjectButton } from '../components/DeleteProject';
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

/** Headers of the hydronic workbook's Plant Equipment and Flow Measurements pages (shown when the project has
 *  hydronic units). */
const HYDRONIC_HEADER_FIELDS: FieldSpec[] = [
  {
    key: HYDRONIC_INFO_KEYS.plantDpUnits,
    label: 'Plant ΔP measured in',
    input: 'select',
    options: ['psi', 'ft w.g.'],
    required: false,
  },
  { key: HYDRONIC_INFO_KEYS.plantInstrument, label: 'Plant instrument', input: 'text', required: false },
  { key: HYDRONIC_INFO_KEYS.flowInstrument, label: 'Ultrasonic flow meter', input: 'text', required: false },
];

function HydronicHeaders({ project }: { project: Project }) {
  return (
    <section className="card card-pad stack" aria-labelledby="hyd-h" data-testid="hydronic-headers">
      <h2 id="hyd-h">Hydronic report</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Page headers of the hydronic workbook (Plant Equipment, Flow Measurements). Pumps and valve systems carry their
        own instrument and ΔP unit.
      </p>
      <div className="form-grid">
        {HYDRONIC_HEADER_FIELDS.map((f) => (
          <InfoField key={f.key} project={project} field={f} />
        ))}
      </div>
    </section>
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

/** A project field with an N/A menu (building balance extras, certification). */
function ProjectField({
  project,
  field,
  value,
  state,
  label,
  idPrefix,
  warning,
  wide,
}: {
  project: Project;
  field: FieldSpec;
  value: FieldValue;
  state?: ReturnType<typeof certificationStates>[string];
  label?: string;
  idPrefix: string;
  warning?: string | null;
  wide?: boolean;
}) {
  return (
    <SpecField
      idPrefix={idPrefix}
      field={field}
      label={label}
      value={value}
      mark={project.naState.fields[field.key]}
      state={state}
      wide={wide}
      warning={warning}
      onChange={(v) => void setField('projects', project.id, `info.${field.key}`, v)}
      onNa={(m: NaMark | null) =>
        void (async () => {
          if (m) await setField('projects', project.id, `info.${field.key}`, null);
          await setField('projects', project.id, `naState.fields.${field.key}`, m);
        })()
      }
    />
  );
}

const OA_FIELD: Record<SpareOaColumn, (n: number) => FieldSpec> = {
  Unit: (n) => ({ key: spareOaKey(n, 'Unit'), label: 'Unit / source', input: 'text', required: false }),
  Design: (n) => ({ key: spareOaKey(n, 'Design'), label: 'Design', input: 'number', unit: 'CFM', required: false }),
  Actual: (n) => ({ key: spareOaKey(n, 'Actual'), label: 'Actual', input: 'number', unit: 'CFM', required: false }),
};

/**
 * Building Balance: every unit that feeds it (RTU OA rows, MAUs, ERVs, fans, small fans 1-30) with its design and
 * actual CFM and an "In balance" switch. A switched-off unit (an isolated room with its own intake louver that the
 * ventilation calculation leaves out) is greyed, marked Excl. and left out of the totals; it is still tested and
 * reported on its own sheet. The excluded designations are info.abExcluded (also filled by the schedule import from
 * the air balance table's noted rows), the reason info.abExcludedNote. The totals stand next to the engineer's air
 * balance when it was imported.
 */
function BuildingBalanceCard({ project, equipment }: { project: Project; equipment: readonly Equipment[] }) {
  const rows = useLiveQuery(() => db.airflowRows.where('projectId').equals(project.id).toArray(), [project.id]);
  const excluded = excludedUnits(project.info);
  const ids = excludedIds(project.info, equipment);
  const spare = spareOaTotals(project);
  const units = equipment.map((e) => ({
    id: e.id,
    type: e.type,
    slot: e.slot,
    data: e.data,
    designation: e.designation,
  }));
  const order = (t: string) => EQUIPMENT_TYPES.findIndex((x) => x.key === t);
  const lines = (rows ? balanceLines(units, rows) : []).sort(
    (a, b) => order(a.type) - order(b.type) || a.designation.localeCompare(b.designation, undefined, { numeric: true }),
  );
  const actual = rows ? buildingBalance(units, rows, spare, ids) : null;
  const ab = {
    oa: project.info[AIR_BALANCE_KEYS.oa],
    exhaust: project.info[AIR_BALANCE_KEYS.exhaust],
    net: project.info[AIR_BALANCE_KEYS.net],
  };
  const has = typeof ab.oa === 'number' || typeof ab.exhaust === 'number';
  const byId = new Map(equipment.map((e) => [e.id, e]));
  // the schedule's design when there are no readings rows yet (the prep-time design)
  const scheduled = (e: Equipment | undefined, side: 'oa' | 'exhaust') => {
    if (!e) return null;
    const f = designFieldOf(e.type, side, e.data);
    return f && typeof e.data[f] === 'number' ? e.data[f] : null;
  };
  // design totals: each included unit's readings design, else its scheduled design (as the rows show it)
  const design = { oa: spare.design, exhaust: 0, net: 0 };
  for (const l of lines) {
    if (ids.has(l.id)) continue;
    const e = byId.get(l.id);
    design.oa += l.oaDesign ?? scheduled(e, 'oa') ?? 0;
    design.exhaust += l.exhaustDesign ?? scheduled(e, 'exhaust') ?? 0;
  }
  design.net = design.oa - design.exhaust;
  if (!lines.length && !has && !design.oa) return null;
  const setExcluded = (designation: string, out: boolean) => {
    const key = designation.trim().toUpperCase();
    const next = out ? [...excluded, designation] : excluded.filter((d) => d.trim().toUpperCase() !== key);
    void setField('projects', project.id, `info.${AIR_BALANCE_KEYS.excluded}`, next.length ? next.join(', ') : null);
  };
  const totals: [string, number, FieldValue, number | null][] = [
    ['Outside air', design.oa, ab.oa, actual?.oaActual ?? null],
    ['Exhaust', design.exhaust, ab.exhaust, actual?.exhaustActual ?? null],
    ['Net (OA − exhaust)', design.net, ab.net, actual?.actualBalance ?? null],
  ];
  const off = (u: number, e: FieldValue) => typeof e === 'number' && Math.abs(u - e) >= 1;
  const cfm = (x: number | null) => (x === null ? '—' : formatNumber(x));
  return (
    <section className="card card-pad stack" aria-labelledby="bb-h" data-testid="building-balance">
      <h2 id="bb-h">Building balance</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Outside air (RTU OA, MAU, ERV supply, other OA rows) against exhaust (fans, small fans 1–30, ERV exhaust).
        Switch a unit off when the ventilation calculation leaves it out (an isolated room with its own intake): it
        stays tested and reported on its own page, greyed and marked <b>Excl.</b>, and is not counted here.
      </p>
      <table className="preview-table bb-table">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Side</th>
            <th>Design</th>
            <th>Actual</th>
            <th title="In the building balance">Incl.</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const e = byId.get(l.id);
            const out = ids.has(l.id);
            const sides: ['oa' | 'exhaust', string][] = [];
            if (l.type !== 'fan' && l.type !== 'smallFan') sides.push(['oa', 'OA']);
            if (l.type === 'erv' || l.type === 'fan' || l.type === 'smallFan') sides.push(['exhaust', 'Exh.']);
            return sides.map(([side, label], k) => {
              const d = side === 'oa' ? l.oaDesign : l.exhaustDesign;
              const a = side === 'oa' ? l.oaActual : l.exhaustActual;
              const sched = d === null ? scheduled(e, side) : null;
              return (
                <tr
                  key={`${l.id}-${side}`}
                  data-excluded={out || undefined}
                  data-testid={`bb-${l.designation}-${side}`}
                >
                  <td>
                    {k === 0 ? l.designation : ''}
                    {k === 0 && out && <span className="bb-excl"> Excl.</span>}
                  </td>
                  <td>{label}</td>
                  <td>
                    {d !== null ? (
                      formatNumber(d)
                    ) : sched !== null ? (
                      <span className="muted">{formatNumber(sched)} sched.</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{cfm(a)}</td>
                  <td>
                    {k === 0 && (
                      <input
                        type="checkbox"
                        checked={!out}
                        aria-label={`${l.designation} in the building balance`}
                        data-testid={`bb-include-${l.designation}`}
                        onChange={(ev) => setExcluded(l.designation, !ev.target.checked)}
                      />
                    )}
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
      {excluded.length > 0 && (
        <div className="field">
          <label className="field-label" htmlFor="bb-excl-note">
            Why {excluded.join(', ')} {excluded.length === 1 ? 'is' : 'are'} left out
          </label>
          <TextInput
            id="bb-excl-note"
            value={(project.info[AIR_BALANCE_KEYS.excludedNote] as string | null) ?? ''}
            placeholder="e.g. isolated rooms with dedicated intake louvers (ventilation calc Note 1)"
            onCommit={(v) =>
              void setField('projects', project.id, `info.${AIR_BALANCE_KEYS.excludedNote}`, v.trim() ? v : null)
            }
          />
        </div>
      )}
      <table className="preview-table" data-testid="bb-totals">
        <thead>
          <tr>
            <th>CFM</th>
            <th>Design</th>
            {has && <th>Air balance</th>}
            <th>Actual</th>
          </tr>
        </thead>
        <tbody>
          {totals.map(([label, u, e, a]) => (
            <tr key={label} data-off={(has && off(u, e)) || undefined}>
              <td>{label}</td>
              <td>{formatNumber(u)}</td>
              {has && (
                <td>
                  {typeof e === 'number' ? formatNumber(e) : '—'}
                  {off(u, e) && (
                    <div className="msg-warn">
                      {u - (e as number) > 0 ? '+' : ''}
                      {formatNumber(u - (e as number))} on the units
                    </div>
                  )}
                </td>
              )}
              <td>{cfm(a)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted" style={{ margin: 0 }}>
        Design: the units&apos; design (from the readings, or the schedule before there are readings)
        {has && project.info[AIR_BALANCE_KEYS.source]
          ? `; air balance: ${String(project.info[AIR_BALANCE_KEYS.source])}`
          : ''}
        . Actual: the measured readings.
        {excluded.length > 0 &&
          ' The workbook greys and skips excluded units from template revision 07; on revision 06 its Building Balance sheet still counts them.'}
      </p>
    </section>
  );
}

/** Building Balance: the 20 spare manual outside-air rows (rows 67-86, part of the OA totals). */
function OtherOutsideAir({ project }: { project: Project }) {
  const used = spareOaUsedCount(project);
  const [added, setAdded] = useState(0);
  const count = Math.min(SPARE_OA_ROWS, Math.max(used, added));
  const totals = spareOaTotals(project);
  async function remove(n: number) {
    // shift the rows below up by one, in one transaction (each value / mark is its own synced field)
    const values: Record<string, unknown> = {};
    for (let i = n; i <= count; i++)
      for (const c of SPARE_OA_COLUMNS) {
        const k = spareOaKey(i, c);
        const next = i < SPARE_OA_ROWS ? spareOaKey(i + 1, c) : null;
        const v = next ? (project.info[next] ?? null) : null;
        const m = next ? (project.naState.fields[next] ?? null) : null;
        if ((project.info[k] ?? null) !== v) values[`info.${k}`] = v;
        if (JSON.stringify(project.naState.fields[k] ?? null) !== JSON.stringify(m)) values[`naState.fields.${k}`] = m;
      }
    await setFields('projects', project.id, values);
    setAdded(Math.max(0, count - 1));
  }
  return (
    <section className="card card-pad stack" aria-labelledby="oa-h" data-testid="other-oa">
      <h2 id="oa-h">Other outside air (Building Balance)</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Outside air not measured on a unit page (e.g. a transfer or relief opening). Up to {SPARE_OA_ROWS} rows, written
        to the spare rows under the units and included in the building&apos;s OA totals.
      </p>
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => {
        const d = project.info[spareOaKey(n, 'Design')];
        const a = project.info[spareOaKey(n, 'Actual')];
        const pct = typeof d === 'number' && typeof a === 'number' && d ? a / d : null;
        return (
          <div key={n} className="oa-row" data-testid={`oa-row-${n}`}>
            <div className="oa-row-head">
              <h3>Row {n}</h3>
              {pct !== null && <span className="small muted">{formatPercent(pct)} of design</span>}
              <button
                type="button"
                className="btn btn-ghost"
                aria-label={`Remove row ${n}`}
                onClick={() => void remove(n)}
              >
                <IconTrash size={16} />
              </button>
            </div>
            <div className="oa-grid">
              {SPARE_OA_COLUMNS.map((c) => (
                <ProjectField
                  key={c}
                  idPrefix="oa"
                  project={project}
                  field={OA_FIELD[c](n)}
                  value={project.info[spareOaKey(n, c)] ?? null}
                  state={{ state: spareOaCell(project, n, c) === null ? 'optional' : 'value' }}
                  wide={c === 'Unit'}
                />
              ))}
            </div>
          </div>
        );
      })}
      {count < SPARE_OA_ROWS && (
        <button className="btn btn-ghost" type="button" onClick={() => setAdded(count + 1)} data-testid="add-oa-row">
          <IconPlus size={18} /> Add OA row
        </button>
      )}
      {count > 0 && (
        <p className="small" style={{ margin: 0 }} data-testid="oa-total">
          These rows: design {formatNumber(totals.design)} CFM · actual {formatNumber(totals.actual)} CFM
        </p>
      )}
    </section>
  );
}

/** Certification sheet: the certified professional, signature and date (required on the final report). */
function CertificationCard({ project }: { project: Project }) {
  const profile = useCertProfile();
  const states = certificationStates(project);
  const expired = certificationExpired(project);
  const final = project.reportKind === 'final';
  return (
    <section className="card card-pad stack" aria-labelledby="cert-h" data-testid="certification">
      <h2 id="cert-h">Certification</h2>
      <p className="small muted" style={{ margin: 0 }}>
        The Certification sheet of the workbook.{' '}
        {final
          ? 'Signature and date are required on this final report.'
          : 'Signature and date are required on the final report; on this preliminary report they are automatically N/A (change the report under Scope and tolerance).'}
      </p>
      <div className="form-grid">
        {CERT_FIELDS.map((f) => (
          <ProjectField
            key={f.key}
            idPrefix="cert"
            project={project}
            field={f}
            value={certValue(project, f.key)}
            state={states[f.key]}
            warning={
              f.key === CERT_KEYS.expiration && expired ? 'The certification expires before the report date' : null
            }
          />
        ))}
      </div>
      {profile !== undefined && (
        <p className="small muted" style={{ margin: 0 }} data-testid="cert-images-line">
          Stamp: {profile?.stamp ? 'yes' : 'none'} · Signature image: {profile?.signature ? 'yes' : 'none'}. Every
          export places them from the <Link to="/certification">certification profile</Link>.
        </p>
      )}
    </section>
  );
}

/** Instruments: pick from the shared library, save a row to it, update a row from it. */
function LibraryActions({ projectId, count }: { projectId: string; count: number }) {
  const library = useLiveQuery(() => db.libraryInstruments.toArray(), []);
  const [pick, setPick] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const sorted = [...(library ?? [])].sort((a, b) => a.type.localeCompare(b.type) || a.serial.localeCompare(b.serial));
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="library-pick">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="visually-hidden" htmlFor="lib-pick">
          Instrument from the library
        </label>
        <select
          id="lib-pick"
          className="select"
          style={{ flex: '1 1 14rem', minWidth: 0 }}
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          disabled={!sorted.length || count >= CALIBRATION_SLOTS}
        >
          <option value="">{sorted.length ? 'Choose from the library…' : 'The library is empty'}</option>
          {sorted.map((l) => (
            <option key={l.id} value={l.id}>
              {[l.type, l.manufacturer, l.model].filter(Boolean).join(' ')}
              {l.serial ? ` · SN ${l.serial}` : ''}
              {l.calibrationDate ? ` · cal. ${l.calibrationDate}` : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={!pick || count >= CALIBRATION_SLOTS}
          onClick={() =>
            void addInstrumentFromLibrary(projectId, pick).then(
              () => {
                setPick('');
                setErr(null);
              },
              (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
            )
          }
        >
          Add from library
        </button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        The project keeps its own copy, so editing the library never changes an issued report.{' '}
        <Link to="/library">Manage the instrument library</Link>
      </p>
      {err && (
        <div className="callout" data-tone="red" role="alert">
          {err}
        </div>
      )}
    </div>
  );
}

function LibraryLink({ ins, lib }: { ins: Instrument; lib: LibraryInstrument | undefined }) {
  if (!ins.libraryId)
    return (
      <button type="button" className="btn btn-ghost" onClick={() => void saveInstrumentToLibrary(ins.id)}>
        Save to library
      </button>
    );
  if (!lib) return <span className="small muted">Library instrument deleted (this copy stays)</span>;
  if (!differsFromLibrary(ins, lib))
    return (
      <span className="chip" data-testid="lib-linked">
        In the library
      </span>
    );
  const what = (['calibrationDate', 'serial', 'model', 'manufacturer', 'type'] as const).filter(
    (k) => (ins[k] ?? '') !== (lib[k] ?? ''),
  );
  return (
    <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <span className="small" data-testid="lib-differs">
        The library has{' '}
        {what.includes('calibrationDate') ? `calibration ${lib.calibrationDate || '(none)'}` : 'other details'}
      </span>
      <button
        type="button"
        className="btn"
        data-testid="lib-update"
        onClick={() => void updateInstrumentFromLibrary(ins.id)}
      >
        Update from library
      </button>
    </span>
  );
}

const SECTION_LINK: Record<ProjectCompletion['missing'][number]['section'], string> = {
  info: '#pi-h',
  cover: '#cover-h',
  calibration: '#cal-h',
  pressures: '#bb-h',
  certification: '#cert-h',
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
  const { project, equipment, locked, conflicts } = useProjectContext();
  const instruments = useInstruments(project.id);
  const library = useLiveQuery(() => db.libraryInstruments.toArray(), []);
  const libById = new Map((library ?? []).map((l) => [l.id, l]));
  const completion = useProjectCompletion(project);
  const hasHoods = equipment.some((e) => e.type === 'hood');
  const coverMark = project.naState.fields['photo:cover'];
  const cover = usePhotos(project.id, null)?.find((p) => p.category === 'cover');
  const blueprints = project.blueprints.length ? project.blueprints : [{ sheet: '', revisionDate: '' }];
  const scopeSpecs = EQUIPMENT_TYPES.map((t) => ({ type: t.key, plural: t.plural, spec: getSpec(t.key) }));

  return (
    <ConflictKeysContext.Provider value={conflictKeys(conflicts, project.id)}>
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
              {project.blueprints.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label={`Remove sheet ${i + 1}`}
                  onClick={() =>
                    void setField(
                      'projects',
                      project.id,
                      'blueprints',
                      blueprints.filter((_, j) => j !== i),
                    )
                  }
                >
                  <IconTrash size={16} />
                </button>
              )}
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
          {project.scopeProfile === 'custom' && (
            <div className="stack" data-testid="custom-scope">
              <p className="small muted" style={{ margin: 0 }}>
                Sections switched off here are N/A for this scope on every unit of that type (a unit can still include
                one with <b>⋮ → Include (override scope)</b>).
              </p>
              {scopeSpecs.map(({ type, plural, spec }) => {
                const sections = spec.sections.filter((s) => !s.locked);
                const off = sections.filter((s) => project.customScope[type]?.[s.key] === false).length;
                return (
                  <details key={type} className="scope-type" data-testid={`scope-${type}`}>
                    <summary className="hist-summary">
                      <span>{plural}</span>
                      <span className="small muted" style={{ fontWeight: 400 }}>
                        {off ? `${off} of ${sections.length} sections off` : 'All sections in scope'}
                      </span>
                    </summary>
                    <div className="row" role="group" aria-label={`${plural} sections in scope`}>
                      {sections.map((s) => {
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
                  </details>
                );
              })}
            </div>
          )}
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

        {equipment.some((e) => equipmentType(e.type).discipline === 'hydronic') && (
          <HydronicHeaders project={project} />
        )}

        <BuildingBalanceCard project={project} equipment={equipment} />

        <OtherOutsideAir project={project} />

        <section className="card card-pad stack" aria-labelledby="cal-h">
          <h2 id="cal-h">Instruments (Calibration sheet)</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Up to 8 instruments. New projects start with the 7 a2b instruments of the template; edit, remove or add your
            own, or pick them from the shared instrument library.
          </p>
          <LibraryActions projectId={project.id} count={instruments?.length ?? 0} />
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
                  {calibrationExempt(ins) ? (
                    <span className="field-hint" data-testid="calibration-exempt">
                      Balometer: no 12-month lab calibration needed
                    </span>
                  ) : (
                    calibrationExpired(ins.calibrationDate, project.info.tabDate) && (
                      <span className="field-warning" data-testid="calibration-expired">
                        More than 12 months before the TAB date
                      </span>
                    )
                  )}
                </div>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <LibraryLink ins={ins} lib={ins.libraryId ? libById.get(ins.libraryId) : undefined} />
                <button
                  className="btn btn-danger"
                  type="button"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => void deleteRecord('instruments', ins.id)}
                >
                  <IconTrash size={16} /> Remove
                </button>
              </div>
            </div>
          ))}
          {(instruments?.length ?? 0) < CALIBRATION_SLOTS && (
            <button className="btn btn-ghost" type="button" onClick={() => void addInstrument(project.id)}>
              <IconPlus size={18} /> Add instrument
            </button>
          )}
        </section>

        <CertificationCard project={project} />
      </fieldset>

      <section className="card card-pad stack">
        <h2>Danger zone</h2>
        <DeleteProjectButton project={project} />
      </section>
    </ConflictKeysContext.Provider>
  );
}
