/**
 * Equipment schedule bulk import: paste rows from Excel / an engineer's schedule, pick a CSV / Excel file, or read
 * the {Equipment Data Entry} section of an existing TAB workbook. Columns are mapped by header text (changeable),
 * every row is validated and previewed (create / update / skip, slot, capacity) before anything is written; the
 * import writes through the repository (setField for every value).
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useEquipmentList, useProject } from '../../data/hooks';
import { applyScheduleImport } from '../../data/repo';
import type { FieldValue } from '../../data/types';
import { EQUIPMENT_TYPES, equipmentType, type EquipmentTypeKey } from '../../domain/equipmentTypes';
import {
  autoMap,
  buildPreview,
  looksLikeHeader,
  parseDelimited,
  scheduleRowsToGrid,
  scheduleTargets,
  type Grid,
  type Preview,
} from '../../domain/scheduleImport';
import type { ScheduleFile } from '../../workbook/scheduleFile';
import { Screen } from '../components/Screen';

const fileEngine = () => import('../../workbook/scheduleFile');
const colName = (i: number) =>
  i < 26
    ? String.fromCharCode(65 + i)
    : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;
const show = (v: FieldValue | undefined) => (v === undefined || v === null ? '' : String(v));

type Source = 'paste' | 'file' | 'workbook';

function PreviewTable({ preview, testId }: { preview: Preview; testId: string }) {
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
              <td>{r.designation || '—'}</td>
              <td>
                <span className="action-pill" data-action={r.action}>
                  {r.action === 'create'
                    ? `New · slot ${r.slot}`
                    : r.action === 'update'
                      ? `Update · slot ${r.slot}`
                      : 'Skip'}
                </span>
              </td>
              {used.map((t) => (
                <td key={t.key}>{show(r.values[t.key])}</td>
              ))}
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
        <b>{info.plural}:</b> {p.create} new, {p.update} updated, {p.skip} skipped · {p.totalAfter} / {p.capacity} after
        the import
      </p>
      {p.notes.map((n) => (
        <div key={n} className="callout" data-tone="amber" role="status">
          {n}
        </div>
      ))}
    </>
  );
}

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
  const [headerOverride, setHeaderOverride] = useState<boolean | null>(null);
  const [mappingOverride, setMappingOverride] = useState<Record<number, string | null>>({});
  const [workbook, setWorkbook] = useState<{ fileName: string; schedule: ScheduleFile['schedule'] } | null>(null);
  const [existingFlag, setExistingFlag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const grid: Grid = useMemo(() => {
    if (source === 'paste') return parseDelimited(text);
    if (source === 'file') return file?.sheets[sheet]?.rows ?? [];
    return [];
  }, [source, text, file, sheet]);
  const hasHeader = headerOverride ?? (grid.length > 0 && looksLikeHeader(grid[0], type));
  const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const headers = hasHeader ? grid[0] : Array.from({ length: width }, () => null);
  const auto = autoMap(headers, type);
  const mapping: (string | null)[] = auto.map((k, i) => (i in mappingOverride ? mappingOverride[i] : k));
  // without headers and nothing mapped yet, the first column is the designation
  if (!hasHeader && mapping.length && mapping.every((m) => !m) && !(0 in mappingOverride)) mapping[0] = 'designation';
  const dataRows = hasHeader ? grid.slice(1) : grid;

  const previews: Preview[] = (() => {
    if (!equipment) return [];
    if (source === 'workbook') {
      if (!workbook?.schedule) return [];
      return EQUIPMENT_TYPES.filter((t) => workbook.schedule?.[t.key]?.length).map((t) => {
        const { grid: g, mapping: m } = scheduleRowsToGrid(t.key, workbook.schedule![t.key]);
        return buildPreview({ type: t.key, rows: g, mapping: m, existing: equipment });
      });
    }
    if (!dataRows.length) return [];
    return [
      buildPreview({
        type,
        rows: dataRows,
        mapping,
        existing: equipment,
        rowNumber: (i) => i + 1 + (hasHeader ? 1 : 0),
      }),
    ];
  })();

  if (!project || !equipment) return <Screen title="Import schedule">Loading…</Screen>;
  const back = `/p/${project.id}/equipment`;
  const toWrite = previews.reduce((n, p) => n + p.create + p.update, 0);
  const mappedDesignation = source === 'workbook' || mapping.includes('designation');

  const resetGrid = () => {
    setHeaderOverride(null);
    setMappingOverride({});
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
        const r = await e.readScheduleFile(f);
        setFile(r);
        setSheet(
          Math.max(
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
    }
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      let created = 0;
      let updated = 0;
      for (const p of previews) {
        const r = await applyScheduleImport(project!.id, p.type, p.rows, existingFlag);
        created += r.created.length;
        updated += r.updated;
      }
      setText('');
      setFile(null);
      setWorkbook(null);
      resetGrid();
      setDone(`${created} unit${created === 1 ? '' : 's'} created, ${updated} updated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const targets = scheduleTargets(type);
  return (
    <Screen title="Import schedule" subtitle={project.name} back={back}>
      <section className="card card-pad stack" aria-labelledby="si-src">
        <h2 id="si-src">Source</h2>
        <div className="segmented" role="group" aria-label="Schedule source">
          {(
            [
              ['paste', 'Paste rows'],
              ['file', 'CSV / Excel file'],
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
        {source !== 'workbook' && (
          <div className="field">
            <label className="field-label" htmlFor="si-type">
              Equipment type
            </label>
            <select
              id="si-type"
              className="select"
              value={type}
              onChange={(e) => {
                setType(e.target.value as EquipmentTypeKey);
                setMappingOverride({});
                setHeaderOverride(null);
              }}
            >
              {EQUIPMENT_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.plural} ({equipment.filter((e) => e.type === t.key).length} / {t.capacity})
                </option>
              ))}
            </select>
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
              Schedule file (.csv, .xlsx, .xlsm)
            </label>
            <input
              id="si-file"
              type="file"
              aria-label="Schedule file"
              accept=".csv,.tsv,.txt,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pickFile(f, false);
              }}
            />
            {file && file.sheets.length > 1 && (
              <select
                className="select"
                aria-label="Sheet"
                value={sheet}
                onChange={(e) => {
                  setSheet(Number(e.target.value));
                  resetGrid();
                }}
              >
                {file.sheets.map((s, i) => (
                  <option key={s.name} value={i}>
                    {s.name} ({s.rows.length} rows)
                  </option>
                ))}
              </select>
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
            New units are
          </span>
          <div className="segmented" role="group" aria-labelledby="si-ne">
            <button type="button" aria-pressed={!existingFlag} onClick={() => setExistingFlag(false)}>
              New
            </button>
            <button type="button" aria-pressed={existingFlag} onClick={() => setExistingFlag(true)}>
              Existing
            </button>
          </div>
        </div>
        {busy && <p className="small muted">Reading…</p>}
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

      {source !== 'workbook' && grid.length > 0 && (
        <section className="card card-pad stack" aria-labelledby="si-map">
          <h2 id="si-map">Columns</h2>
          <label className="row small" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => {
                setHeaderOverride(e.target.checked);
                setMappingOverride({});
              }}
            />
            First row is column headers
          </label>
          <div className="map-grid" data-testid="column-map">
            {Array.from({ length: width }, (_, i) => {
              const head = hasHeader && headers[i] !== null ? String(headers[i]) : `Column ${colName(i)}`;
              return (
                <div className="field" key={i}>
                  <label className="field-label" htmlFor={`si-col-${i}`} title={head}>
                    {head}
                  </label>
                  <select
                    id={`si-col-${i}`}
                    className="select"
                    data-testid={`map-col-${i}`}
                    value={mapping[i] ?? ''}
                    onChange={(e) => setMappingOverride({ ...mappingOverride, [i]: e.target.value || null })}
                  >
                    <option value="">— ignore —</option>
                    {targets.map((t) => (
                      <option key={t.key} value={t.key} disabled={mapping.includes(t.key) && mapping[i] !== t.key}>
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

      {previews.length > 0 && mappedDesignation && (
        <section className="card card-pad stack" aria-labelledby="si-prev">
          <h2 id="si-prev">Preview</h2>
          {previews.map((p) => (
            <div key={p.type} className="stack" style={{ gap: 8 }}>
              <Summary p={p} />
              <PreviewTable preview={p} testId={`preview-${p.type}`} />
            </div>
          ))}
          <div className="row">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              data-testid="schedule-import"
              disabled={busy || toWrite === 0}
              onClick={() => void runImport()}
              style={{ flex: 1 }}
            >
              Import {toWrite} unit{toWrite === 1 ? '' : 's'}
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
