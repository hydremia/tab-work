/**
 * Equipment schedule bulk import: paste rows from Excel / an engineer's schedule, pick a CSV / Excel file or a drawing / submittal PDF (its schedule tables rebuilt), or read
 * the {Equipment Data Entry} section of an existing TAB workbook. Columns are mapped by header text (changeable),
 * every row is validated and previewed (create / update / skip, slot, capacity) before anything is written; the
 * import writes through the repository (setField for every value).
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useEquipmentList, useProject } from '../../data/hooks';
import { applyAirBalance, applyScheduleImport } from '../../data/repo';
import type { FieldValue } from '../../data/types';
import { EQUIPMENT_TYPES, equipmentType, type EquipmentTypeKey } from '../../domain/equipmentTypes';
import { airBalanceChecks, entryTotals, readAirBalance, tableKind, type BalanceUnitRef } from '../../domain/airBalance';
import { formatNumber } from '../../domain/calc';
import {
  autoMap,
  buildPreview,
  importTargets,
  looksLikeHeader,
  parseDelimited,
  scheduleRowsToGrid,
  scheduleTargets,
  type Grid,
  type Preview,
} from '../../domain/scheduleImport';
import type { ScheduleFile } from '../../workbook/scheduleFile';
import { LockBanner } from '../components/LockBanner';
import { Screen } from '../components/Screen';

const fileEngine = () => import('../../workbook/scheduleFile');
const colName = (i: number) =>
  i < 26
    ? String.fromCharCode(65 + i)
    : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;
const show = (v: FieldValue | undefined) => (v === undefined || v === null ? '' : String(v));

type Source = 'paste' | 'file' | 'workbook';

function PreviewTable({
  preview,
  testId,
  low,
}: {
  preview: Preview;
  testId: string;
  /** cells text recognition was unsure of: "<type>:<row index>:<field key>" */
  low?: ReadonlySet<string>;
}) {
  const targets = scheduleTargets(preview.type).filter((t) => t.key !== 'designation');
  const used = targets.filter((t) => preview.rows.some((r) => r.values[t.key] !== undefined));
  return (
    <div className="preview-wrap">
      <table className="preview-table" data-testid={testId}>
        <thead>
          <tr>
            <th>Designation</th>
            <th>Action</th>
            {used.map((t) => (
              <th key={t.key}>{t.label}</th>
            ))}
            <th>Checks</th>
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((r) => (
            <tr key={r.index} data-action={r.action} data-testid="preview-row">
              <td data-low={low?.has(`${preview.type}:${r.index}:designation`) || undefined}>
                {r.designation || '—'}
                {r.scope && r.scope !== 'new' && (
                  <span className="chip chip-existing" data-testid="scope-chip">
                    {SCOPE_LABEL[r.scope]}
                  </span>
                )}
              </td>
              <td>
                <span className="action-pill" data-action={r.action}>
                  {r.action === 'create'
                    ? `New · slot ${r.slot}`
                    : r.action === 'update'
                      ? `Update · slot ${r.slot}`
                      : 'Skip'}
                </span>
              </td>
              {used.map((t) => {
                const unsure = low?.has(`${preview.type}:${r.index}:${t.key}`);
                return (
                  <td
                    key={t.key}
                    data-low={unsure || undefined}
                    title={unsure ? 'Text recognition was unsure of this value: check it on the drawing' : undefined}
                  >
                    {show(r.values[t.key])}
                  </td>
                );
              })}
              <td className="msgs">
                {r.errors.map((m) => (
                  <div key={m} className="msg-error">
                    {m}
                  </div>
                ))}
                {r.warnings.map((m) => (
                  <div key={m} className="msg-warn">
                    {m}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Summary({ p }: { p: Preview }) {
  const info = equipmentType(p.type);
  return (
    <>
      <p className="small" style={{ margin: 0 }} data-testid={`preview-summary-${p.type}`}>
        <b>{info.plural}:</b> {p.create} new, {p.update} updated, {p.skip} skipped
        {p.removed ? ` (${p.removed} removed / capped)` : ''}
        {p.existing ? ` · ${p.existing} existing` : ''} · {p.totalAfter} / {p.capacity} after the import
      </p>
      {p.notes.map((n) => (
        <div key={n} className="callout" data-tone="amber" role="status">
          {n}
        </div>
      ))}
    </>
  );
}

interface SheetOpts {
  include?: boolean;
  type?: EquipmentTypeKey;
  header?: boolean | null;
  mapping?: Record<number, string | null>;
}

interface SheetView {
  index: number;
  name: string;
  kind: 'units' | 'airBalance' | 'spaces';
  include: boolean;
  type: EquipmentTypeKey;
  grid: Grid;
  hasHeader: boolean;
  headers: (string | number | null)[];
  width: number;
  mapping: (string | null)[];
  dataRows: Grid;
  ocr: boolean;
  /** data row index -> column -> text recognition was unsure */
  low: [number, number][];
}

const SCOPE_LABEL = { new: 'New', existing: 'Existing', removed: 'Removed' } as const;

export function ScheduleImportPage() {
  const { projectId } = useParams();
  const [params] = useSearchParams();
  const project = useProject(projectId);
  const equipment = useEquipmentList(projectId);
  const nav = useNavigate();
  const [type, setType] = useState<EquipmentTypeKey>((params.get('type') as EquipmentTypeKey) || 'rtu');
  const [source, setSource] = useState<Source>('paste');
  const [text, setText] = useState('');
  const [file, setFile] = useState<ScheduleFile | null>(null);
  const [sheet, setSheet] = useState(0);
  const [opts, setOpts] = useState<Record<number, SheetOpts>>({});
  const [workbook, setWorkbook] = useState<{ fileName: string; schedule: ScheduleFile['schedule'] } | null>(null);
  const [existingFlag, setExistingFlag] = useState(false);
  const [airflowOnly, setAirflowOnly] = useState(false);
  const [abFill, setAbFill] = useState(true);
  const [abAdd, setAbAdd] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const sourceSheets: {
    name: string;
    rows: Grid;
    type?: EquipmentTypeKey | null;
    ocr?: boolean;
    lowConfidence?: [number, number][];
  }[] = useMemo(() => {
    if (source === 'paste') return [{ name: 'Pasted rows', rows: parseDelimited(text) }];
    if (source === 'file') return file?.sheets ?? [];
    return [];
  }, [source, text, file]);
  const kinds = useMemo(
    () => sourceSheets.map((s) => (s.rows.length > 1 ? (tableKind(s.rows, s.name) ?? 'units') : 'units')),
    [sourceSheets],
  );
  const anyTyped = sourceSheets.some((s, i) => s.type || kinds[i] !== 'units');
  const firstRows = Math.max(
    0,
    sourceSheets.findIndex((s) => s.rows.length > 1),
  );
  const single = sourceSheets.length <= 1;

  const views: SheetView[] = sourceSheets.map((s, i) => {
    const o = opts[i] ?? {};
    const kind = kinds[i];
    const include =
      source === 'paste'
        ? true
        : (o.include ??
          (kind === 'airBalance' ||
            (kind === 'units' && s.rows.length > 1 && (Boolean(s.type) || (!anyTyped && i === firstRows)))));
    const t = source === 'paste' ? type : (o.type ?? s.type ?? type);
    const grid = s.rows;
    const hasHeader = o.header ?? (grid.length > 0 && looksLikeHeader(grid[0], t));
    const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
    const headers = hasHeader ? grid[0] : Array.from({ length: width }, () => null);
    const auto = autoMap(headers, t);
    const ov = o.mapping ?? {};
    const mapping = auto.map((k, c) => (c in ov ? ov[c] : k));
    // without headers and nothing mapped yet, the first column is the designation
    if (!hasHeader && mapping.length && mapping.every((m) => !m) && !(0 in ov)) mapping[0] = 'designation';
    const shift = hasHeader ? 1 : 0;
    return {
      index: i,
      name: s.name,
      kind,
      include,
      type: t,
      grid,
      hasHeader,
      headers,
      width,
      mapping,
      dataRows: hasHeader ? grid.slice(1) : grid,
      ocr: Boolean(s.ocr),
      low: (s.lowConfidence ?? []).flatMap(([r, c]) => (r - shift >= 0 ? [[r - shift, c] as [number, number]] : [])),
    };
  });
  const current = views[sheet] ?? views[0];
  const unitViews = views.filter((v) => v.include && v.kind === 'units' && v.dataRows.length);
  const setOpt = (i: number, o: SheetOpts) => setOpts((all) => ({ ...all, [i]: { ...all[i], ...o } }));

  // one preview per unit type: the included tables of that type, each remapped to the type's targets (the columns
  // it does not map are kept after them, for the scope phrases)
  const low = new Set<string>();
  const previews: Preview[] = (() => {
    if (!equipment) return [];
    if (source === 'workbook') {
      if (!workbook?.schedule) return [];
      return EQUIPMENT_TYPES.filter((t) => workbook.schedule?.[t.key]?.length).map((t) => {
        const { grid: g, mapping: m } = scheduleRowsToGrid(t.key, workbook.schedule![t.key]);
        return buildPreview({ type: t.key, rows: g, mapping: m, existing: equipment });
      });
    }
    const types = [...new Set(unitViews.map((v) => v.type))];
    return types.flatMap((t) => {
      const vs = unitViews.filter((v) => v.type === t && v.mapping.includes('designation'));
      if (!vs.length) return [];
      const keys = importTargets(t).map((x) => x.key);
      const rows: Grid = [];
      const labels: string[] = [];
      for (const v of vs) {
        const colOf = (k: string) => v.mapping.indexOf(k);
        const lowHere = new Set(v.low.map(([r, c]) => `${r}:${c}`));
        v.dataRows.forEach((r, ri) => {
          const at = rows.length;
          rows.push([
            ...keys.map((k) => (colOf(k) >= 0 ? (r[colOf(k)] ?? null) : null)),
            ...r.filter((_, c) => !v.mapping[c]),
          ]);
          labels.push(
            vs.length > 1 ? `${ri + 1 + (v.hasHeader ? 1 : 0)} of ${v.name}` : String(ri + 1 + (v.hasHeader ? 1 : 0)),
          );
          for (const k of keys) if (colOf(k) >= 0 && lowHere.has(`${ri}:${colOf(k)}`)) low.add(`${t}:${at}:${k}`);
        });
      }
      return [
        buildPreview({
          type: t,
          rows,
          mapping: [
            ...keys,
            ...Array.from({ length: Math.max(0, ...rows.map((r) => r.length)) - keys.length }, () => null),
          ],
          existing: equipment,
          rowNumber: (i) => labels[i],
        }),
      ];
    });
  })();

  // the engineer's air balance table (the first included one), checked against the units after this import
  const abView = views.find((v) => v.include && v.kind === 'airBalance');
  const airBalance = abView ? readAirBalance(abView.grid) : null;
  const abResult = (() => {
    if (!airBalance || !equipment) return null;
    const planned: BalanceUnitRef[] = equipment.map((e) => ({ ...e }));
    for (const p of previews)
      for (const r of p.rows) {
        if (r.action === 'update') {
          const i = planned.findIndex((u) => u.id === r.existingId);
          if (i >= 0) planned[i] = { ...planned[i], data: { ...planned[i].data, ...r.values } };
        } else if (r.action === 'create') planned.push({ type: p.type, designation: r.designation, data: r.values });
      }
    return airBalanceChecks(airBalance, planned);
  })();

  if (!project || !equipment) return <Screen title="Import schedule">Loading…</Screen>;
  const back = `/p/${project.id}/equipment`;
  const toWrite = previews.reduce((n, p) => n + p.create + p.update, 0);
  const existingRows = previews.reduce((n, p) => n + p.existing, 0);
  const abMissing = abResult?.checks.filter((c) => c.status === 'missing') ?? [];
  const abBlank = abResult?.checks.filter((c) => c.status === 'blank') ?? [];
  const canImport = toWrite > 0 || airBalance !== null;
  const mappedDesignation =
    source === 'workbook' || !current || current.kind !== 'units' || current.mapping.includes('designation');

  const resetGrid = () => {
    setOpts({});
    setDone(null);
    setError(null);
  };

  async function pickFile(f: File, asWorkbook: boolean) {
    setBusy(true);
    resetGrid();
    try {
      const e = await fileEngine();
      if (asWorkbook) {
        setWorkbook({ fileName: f.name, schedule: await e.readWorkbookSchedule(f) });
      } else {
        const r = await e.readScheduleFile(f, setProgress);
        setFile(r);
        // the columns shown first: the first unit table
        const typed = r.sheets.findIndex((s) => s.rows.length > 1 && s.type);
        setSheet(
          typed >= 0
            ? typed
            : Math.max(
                0,
                r.sheets.findIndex((s) => s.rows.length > 1),
              ),
        );
        if (r.schedule) setWorkbook({ fileName: f.name, schedule: r.schedule });
      }
    } catch (err) {
      setError(`Could not read ${f.name}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      let created = 0;
      let updated = 0;
      let removed = 0;
      for (const p of previews) {
        const r = await applyScheduleImport(project!.id, p.type, p.rows, {
          isExisting: existingFlag,
          existingAirflowOnly: airflowOnly,
        });
        created += r.created.length;
        updated += r.updated;
        removed += p.removed;
      }
      const parts = [`${created} unit${created === 1 ? '' : 's'} created, ${updated} updated`];
      if (removed) parts.push(`${removed} removed unit${removed === 1 ? '' : 's'} left out`);
      if (airBalance) {
        const r = await applyAirBalance(project!.id, airBalance, {
          fillBlank: abFill,
          addMissing: abAdd,
          existingAirflowOnly: airflowOnly,
          source: abView?.name,
        });
        parts.push(
          `air balance kept${r.filled ? `, ${r.filled} design CFM${r.filled === 1 ? '' : 's'} filled` : ''}${
            r.added.length ? `, ${r.added.length} existing unit${r.added.length === 1 ? '' : 's'} added` : ''
          }${r.spareRows ? `, ${r.spareRows} other OA row${r.spareRows === 1 ? '' : 's'}` : ''}${
            r.notAdded.length ? ` (not added: ${r.notAdded.join(', ')})` : ''
          }`,
        );
      }
      setText('');
      setFile(null);
      setWorkbook(null);
      resetGrid();
      setDone(`${parts.join('; ')}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const targets = current ? importTargets(current.type) : [];
  const lowCount = [...low].length;
  const ocrUsed = views.some((v) => v.include && v.ocr);
  const typeSelect = (
    value: EquipmentTypeKey,
    onChange: (t: EquipmentTypeKey) => void,
    id?: string,
    label?: string,
  ) => (
    <select
      id={id}
      aria-label={label}
      className="select"
      value={value}
      onChange={(e) => onChange(e.target.value as EquipmentTypeKey)}
    >
      {EQUIPMENT_TYPES.map((t) => (
        <option key={t.key} value={t.key}>
          {t.plural} ({equipment.filter((e) => e.type === t.key).length} / {t.capacity})
        </option>
      ))}
    </select>
  );
  if (project.lock)
    return (
      <Screen title="Import schedule" subtitle={project.name} back={back}>
        <LockBanner project={project} />
        <p className="small muted" data-testid="schedule-locked">
          The report was issued, so no schedule can be imported until the project is unlocked for follow-up.
        </p>
      </Screen>
    );
  return (
    <Screen title="Import schedule" subtitle={project.name} back={back}>
      <section className="card card-pad stack" aria-labelledby="si-src">
        <h2 id="si-src">Source</h2>
        <div className="segmented" role="group" aria-label="Schedule source">
          {(
            [
              ['paste', 'Paste rows'],
              ['file', 'File (CSV, Excel, PDF, photo)'],
              ['workbook', 'TAB workbook'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={source === k}
              onClick={() => {
                setSource(k);
                resetGrid();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {source !== 'workbook' && single && (
          <div className="field">
            <label className="field-label" htmlFor="si-type">
              Equipment type
            </label>
            {typeSelect(
              current?.type ?? type,
              (t) => {
                setType(t);
                setOpts(source === 'file' ? { 0: { type: t } } : {});
              },
              'si-type',
            )}
          </div>
        )}
        {source === 'paste' && (
          <div className="field">
            <label className="field-label" htmlFor="si-paste">
              Schedule rows
            </label>
            <textarea
              id="si-paste"
              className="input schedule-paste"
              value={text}
              placeholder={
                'Copy the schedule rows (with the header row) in Excel and paste here.\nTag\tArea served\tCFM …'
              }
              onChange={(e) => {
                setText(e.target.value);
                setDone(null);
              }}
              spellCheck={false}
            />
            <span className="field-hint">
              Tab-separated (copied from Excel) or comma-separated. A header row maps the columns.
            </span>
          </div>
        )}
        {source === 'file' && (
          <div className="field">
            <label className="field-label" htmlFor="si-file">
              Schedule file (.csv, .xlsx, .xlsm, .pdf, photo)
            </label>
            <input
              id="si-file"
              type="file"
              aria-label="Schedule file"
              accept=".csv,.tsv,.txt,.xlsx,.xlsm,.pdf,.jpg,.jpeg,.png,.webp,text/csv,application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pickFile(f, false);
              }}
            />
            {ocrUsed && (
              <div className="callout" data-tone="amber" role="status" data-testid="ocr-note">
                <span>
                  Read by <b>text recognition</b> (this drawing has no text layer, or it is a photo). Check the values
                  against the drawing before importing
                  {lowCount ? (
                    <>
                      : <b>{lowCount}</b> highlighted value{lowCount > 1 ? 's' : ''} it was unsure of
                    </>
                  ) : null}
                  .
                </span>
              </div>
            )}
            {file && workbook?.schedule && (
              <div className="callout" data-tone="info">
                <span>
                  {file.fileName} is a TAB workbook.{' '}
                  <button type="button" className="btn btn-ghost" onClick={() => setSource('workbook')}>
                    Import its Equipment Data Entry instead
                  </button>
                </span>
              </div>
            )}
          </div>
        )}
        {source === 'workbook' && (
          <div className="field">
            <label className="field-label" htmlFor="si-wb">
              TAB workbook (.xlsm)
            </label>
            <input
              id="si-wb"
              type="file"
              aria-label="TAB workbook for schedule"
              accept=".xlsm,.xlsx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pickFile(f, true);
              }}
            />
            <span className="field-hint">
              Reads only the {'{Equipment Data Entry}'} section (the design schedule of every unit type). Readings,
              remarks and project data are not imported: use Import workbook for that.
            </span>
            {workbook && (
              <p className="small muted" style={{ margin: 0 }}>
                {workbook.fileName}: {Object.values(workbook.schedule ?? {}).reduce((n, r) => n + r.length, 0)} schedule
                rows
              </p>
            )}
          </div>
        )}
        <div className="field">
          <span className="field-label" id="si-ne">
            Rows the schedule doesn&apos;t mark new or existing are
          </span>
          <div className="segmented" role="group" aria-labelledby="si-ne">
            <button type="button" aria-pressed={!existingFlag} onClick={() => setExistingFlag(false)}>
              New
            </button>
            <button type="button" aria-pressed={existingFlag} onClick={() => setExistingFlag(true)}>
              Existing
            </button>
          </div>
          <span className="field-hint">
            A scope / status column, &quot;(E)&quot; before the tag, or &quot;EXISTING TO REMAIN&quot; in the row marks
            a unit existing; &quot;REMOVE AND CAP&quot;, demolished or abandoned units are left out.
          </span>
        </div>
        <div className="field">
          <span className="field-label" id="si-ao">
            Existing units need
          </span>
          <div className="segmented" role="group" aria-labelledby="si-ao" data-testid="existing-scope">
            <button type="button" aria-pressed={!airflowOnly} onClick={() => setAirflowOnly(false)}>
              Full data
            </button>
            <button type="button" aria-pressed={airflowOnly} onClick={() => setAirflowOnly(true)}>
              Airflow only
            </button>
          </div>
          {airflowOnly && (
            <span className="field-hint">
              New existing units get their unit, motor, drive, misc., RPM and static sections marked N/A (per the
              proposal). Change any of them on the unit page.
            </span>
          )}
        </div>
        {busy && (
          <p className="small muted" role="status" data-testid="schedule-progress">
            {progress ?? 'Reading…'}
          </p>
        )}
        {error && (
          <div className="callout" data-tone="red" role="alert">
            {error}
          </div>
        )}
        {done && (
          <div className="callout" data-tone="info" role="status" data-testid="schedule-done">
            <span>
              {done} <Link to={back}>Back to equipment</Link>
            </span>
          </div>
        )}
      </section>

      {source === 'file' && !single && (
        <section className="card card-pad stack" aria-labelledby="si-tables">
          <h2 id="si-tables">Tables ({views.length})</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Every ticked table is imported in one go. Unit schedules are ticked when their title names the unit type;
            the building air balance is checked against the units; space-by-space ventilation tables are not needed.
          </p>
          <div className="stack" style={{ gap: 6 }} data-testid="table-list">
            {views.map((v) => (
              <div key={v.index} className="table-pick" data-testid="table-pick" data-kind={v.kind}>
                <label className="row small" style={{ gap: 8, minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={v.include}
                    aria-label={`Import ${v.name}`}
                    onChange={(e) => setOpt(v.index, { include: e.target.checked })}
                  />
                  <span className="table-pick-name" title={v.name}>
                    {v.name} <span className="muted">({Math.max(0, v.dataRows.length)} rows)</span>
                    {v.ocr && <span className="chip">text recognition</span>}
                  </span>
                </label>
                {v.kind === 'units' ? (
                  <>
                    {typeSelect(
                      v.type,
                      (t) => setOpt(v.index, { type: t, mapping: {}, header: null }),
                      undefined,
                      `Type of ${v.name}`,
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost"
                      aria-pressed={sheet === v.index}
                      onClick={() => setSheet(v.index)}
                    >
                      Columns
                    </button>
                  </>
                ) : (
                  <span className="chip">{v.kind === 'airBalance' ? 'Air balance' : 'Space ventilation'}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {source !== 'workbook' && current && current.kind === 'units' && current.grid.length > 0 && (
        <section className="card card-pad stack" aria-labelledby="si-map">
          <h2 id="si-map">Columns{!single ? `: ${current.name}` : ''}</h2>
          <label className="row small" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={current.hasHeader}
              onChange={(e) => setOpt(current.index, { header: e.target.checked, mapping: {} })}
            />
            First row is column headers
          </label>
          <div className="map-grid" data-testid="column-map">
            {Array.from({ length: current.width }, (_, i) => {
              const head =
                current.hasHeader && current.headers[i] !== null ? String(current.headers[i]) : `Column ${colName(i)}`;
              return (
                <div className="field" key={i}>
                  <label className="field-label" htmlFor={`si-col-${i}`} title={head}>
                    {head}
                  </label>
                  <select
                    id={`si-col-${i}`}
                    className="select"
                    data-testid={`map-col-${i}`}
                    value={current.mapping[i] ?? ''}
                    onChange={(e) =>
                      setOpt(current.index, {
                        mapping: { ...opts[current.index]?.mapping, [i]: e.target.value || null },
                      })
                    }
                  >
                    <option value="">— ignore —</option>
                    {targets.map((t) => (
                      <option
                        key={t.key}
                        value={t.key}
                        disabled={current.mapping.includes(t.key) && current.mapping[i] !== t.key}
                      >
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          {!mappedDesignation && (
            <div className="callout" data-tone="amber">
              Map one column to Designation.
            </div>
          )}
        </section>
      )}

      {airBalance && abResult && (
        <section className="card card-pad stack" aria-labelledby="si-ab" data-testid="air-balance">
          <h2 id="si-ab">Air balance{abView ? `: ${abView.name}` : ''}</h2>
          <p className="small" style={{ margin: 0 }}>
            Design OA <b>{formatNumber(airBalance.totalOa ?? entryTotals(airBalance).oa)}</b> CFM · exhaust{' '}
            <b>{formatNumber(airBalance.totalExhaust ?? entryTotals(airBalance).exhaust)}</b> CFM
            {airBalance.net !== null && (
              <>
                {' '}
                · net <b>{formatNumber(airBalance.net)}</b> CFM {airBalance.net >= 0 ? '(positive)' : '(negative)'}
              </>
            )}
            . Kept on the project for the Building Balance.
          </p>
          {airBalance.excluded.length > 0 && (
            <p className="small muted" style={{ margin: 0 }} data-testid="ab-excluded">
              Its totals leave out {airBalance.excluded.join(', ')} (the rows with a note mark: check the note). The
              Building Balance check on Project info leaves them out too.
            </p>
          )}
          {(() => {
            const sums = entryTotals(airBalance);
            const off = [
              airBalance.totalOa !== null && Math.abs(airBalance.totalOa - sums.oa) >= 1
                ? `OA: the rows add up to ${formatNumber(sums.oa)}, the table says ${formatNumber(airBalance.totalOa)}`
                : null,
              airBalance.totalExhaust !== null && Math.abs(airBalance.totalExhaust - sums.exhaust) >= 1
                ? `Exhaust: the rows add up to ${formatNumber(sums.exhaust)}, the table says ${formatNumber(airBalance.totalExhaust)}`
                : null,
            ].filter(Boolean);
            return off.length ? (
              <div className="callout" data-tone="amber" role="status">
                {off.join('. ')}. Check the table (or its reading).
              </div>
            ) : null;
          })()}
          <div className="preview-wrap">
            <table className="preview-table" data-testid="air-balance-table">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Side</th>
                  <th>Table CFM</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {abResult.checks.map((c, i) => (
                  <tr key={i} data-status={c.status} data-testid="ab-row">
                    <td>{c.entry.designation}</td>
                    <td>{c.entry.side === 'oa' ? 'OA' : 'Exhaust'}</td>
                    <td>
                      {formatNumber(c.entry.cfm)}
                      {c.entry.note ? ` (note ${c.entry.note})` : ''}
                    </td>
                    <td className="msgs">
                      {c.status === 'match' && 'Matches'}
                      {c.status === 'differs' && (
                        <div className="msg-warn">Unit: {formatNumber(c.unitCfm ?? 0)}. Confirm (not changed)</div>
                      )}
                      {c.status === 'blank' && (abFill ? 'Filled from the table' : 'Unit has no design CFM')}
                      {c.status === 'missing' &&
                        (c.suggestType
                          ? abAdd
                            ? `Added as existing (${equipmentType(c.suggestType).plural.replace(/s$/, '')})`
                            : 'Not in the schedules'
                          : c.entry.side === 'oa' && abAdd
                            ? 'Added as an Other OA row'
                            : 'Not a unit type the app has')}
                      {c.status === 'noField' &&
                        `${equipmentType(c.unit!.type).plural}: no design ${c.entry.side === 'oa' ? 'OA' : 'exhaust'} field`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {abResult.notListed.length > 0 && (
            <p className="small muted" style={{ margin: 0 }}>
              Not in the air balance:{' '}
              {abResult.notListed
                .map((u) => u.designation)
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                .join(', ')}
              .
            </p>
          )}
          {abBlank.length > 0 && (
            <label className="row small" style={{ gap: 8 }}>
              <input type="checkbox" checked={abFill} onChange={(e) => setAbFill(e.target.checked)} />
              Fill {abBlank.length} blank unit design CFM{abBlank.length === 1 ? '' : 's'} from the table
            </label>
          )}
          {abMissing.length > 0 && (
            <label className="row small" style={{ gap: 8 }}>
              <input type="checkbox" checked={abAdd} onChange={(e) => setAbAdd(e.target.checked)} />
              Add the {abMissing.length} unit{abMissing.length === 1 ? '' : 's'} the schedules don&apos;t have (as
              Existing)
            </label>
          )}
        </section>
      )}

      {(previews.length > 0 || airBalance) && mappedDesignation && (
        <section className="card card-pad stack" aria-labelledby="si-prev">
          <h2 id="si-prev">Preview</h2>
          {existingRows > 0 && (
            <p className="small muted" style={{ margin: 0 }}>
              {existingRows} existing unit{existingRows === 1 ? '' : 's'}: {airflowOnly ? 'airflow only' : 'full data'}{' '}
              (Existing units need, above).
            </p>
          )}
          {previews.map((p) => (
            <div key={p.type} className="stack" style={{ gap: 8 }}>
              <Summary p={p} />
              <PreviewTable preview={p} testId={`preview-${p.type}`} low={low} />
            </div>
          ))}
          <div className="row">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              data-testid="schedule-import"
              disabled={busy || !canImport}
              onClick={() => void runImport()}
              style={{ flex: 1 }}
            >
              {toWrite > 0 || !airBalance
                ? `Import ${toWrite} unit${toWrite === 1 ? '' : 's'}${airBalance ? ' + air balance' : ''}`
                : 'Import the air balance'}
            </button>
            <button type="button" className="btn btn-lg" onClick={() => nav(back)}>
              Cancel
            </button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Units with the same designation are updated (only the values the schedule has; blank cells keep the
            app&apos;s values). Rows marked Skip are not imported.
          </p>
        </section>
      )}
    </Screen>
  );
}
