/**
 * Import from plan (ROADMAP §7.3 step 2): read a mechanical plan sheet, see its air devices on the drawing, lasso a
 * system's devices, letter them in walk order and write them into the unit's airflow table. The systems double as the
 * markup (reports/planMarkup.ts): the plan with each system's devices labelled in its colour.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useEquipmentList, useProject } from '../../data/hooks';
import {
  addPlanSystem,
  applyPlanSystem,
  deletePlanSheet,
  removePlanSystem,
  savePlanSheet,
  updatePlanDevice,
  usePlanSheets,
} from '../../data/planRepo';
import type { Equipment, PlanSheet, PlanSheetDevice, PlanSystem } from '../../data/types';
import { EQUIPMENT_TYPES } from '../../domain/equipmentTypes';
import {
  designCheck,
  deviceLabel,
  devicesInLasso,
  nextSystemColor,
  systemPrefix,
  walkOrder,
  type Pt,
} from '../../domain/planSystems';
import { getSpec } from '../../domain/specs';
import { LockBanner } from '../components/LockBanner';
import { Screen } from '../components/Screen';

const fmt = (n: number | null) => (n === null ? '—' : n.toLocaleString());

export function PlanImportPage() {
  const { projectId } = useParams();
  const project = useProject(projectId);
  const equipment = useEquipmentList(projectId);
  const sheets = usePlanSheets(projectId);
  const [params, setParams] = useSearchParams();
  const sheetId = params.get('sheet');
  const sheet = sheets?.find((s) => s.id === sheetId) ?? null;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    file: File;
    bytes: Uint8Array;
    pageCount: number;
    sizes: { width: number; height: number }[];
  } | null>(null);

  if (!project || !equipment || !sheets) return <Screen title="Import from plan">Loading…</Screen>;
  const back = `/p/${project.id}/equipment`;

  async function pickFile(f: File) {
    setError(null);
    setBusy(true);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const { planPdfInfo } = await import('../../workbook/planSheet');
      const info = await planPdfInfo(bytes);
      if (info.pageCount === 1) await readPage({ file: f, bytes, ...info }, 1);
      else setPending({ file: f, bytes, ...info });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function readPage(p: NonNullable<typeof pending>, pageNo: number) {
    setError(null);
    setBusy(true);
    try {
      const { readPlanSheet } = await import('../../workbook/planSheet');
      const r = await readPlanSheet(p.bytes, pageNo, { progress: setProgress });
      const saved = await savePlanSheet({
        projectId: project!.id,
        fileName: p.file.name,
        pdf: p.bytes,
        page: pageNo,
        pageCount: p.pageCount,
        width: r.width,
        height: r.height,
        ocr: r.ocr,
        devices: r.devices,
      });
      setPending(null);
      setParams({ sheet: saved.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  if (sheet)
    return (
      <Screen
        title={`Plan: ${sheet.fileName}`}
        subtitle={`${project.name} · page ${sheet.page} of ${sheet.pageCount}`}
        back={`/p/${project.id}/plan`}
      >
        {project.lock && <LockBanner project={project} />}
        <SheetView sheet={sheet} equipment={equipment} locked={Boolean(project.lock)} />
      </Screen>
    );

  return (
    <Screen title="Import from plan" subtitle={project.name} back={back}>
      {project.lock && <LockBanner project={project} />}
      <div className="stack">
        <section className="card card-pad stack">
          <h2 className="section-head" style={{ margin: 0 }}>
            Read a plan sheet
          </h2>
          <p className="small muted" style={{ margin: 0 }}>
            A mechanical plan PDF from the engineer. The app finds the air device tags (type, neck size, design CFM) on
            the sheet, places them on their symbols, and you lasso each system’s outlets to fill the unit’s airflow
            table. The sheet stays on this device.
          </p>
          {!pending && (
            <label className="file-btn btn btn-primary" style={{ alignSelf: 'flex-start' }}>
              {busy ? 'Reading…' : 'Choose a drawing (PDF)'}
              <input
                type="file"
                accept="application/pdf,.pdf"
                disabled={busy || Boolean(project.lock)}
                data-testid="plan-file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void pickFile(f);
                }}
                style={{ display: 'none' }}
              />
            </label>
          )}
          {pending && (
            <div className="stack" data-testid="plan-pages">
              <p className="small" style={{ margin: 0 }}>
                <strong>{pending.file.name}</strong> has {pending.pageCount} pages. Which one is the plan?
              </p>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                {pending.sizes.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void readPage(pending, i + 1)}
                  >
                    Page {i + 1}
                    <span className="small muted" style={{ marginLeft: 6 }}>
                      {Math.round(s.width / 72)}×{Math.round(s.height / 72)} in
                    </span>
                  </button>
                ))}
                {pending.pageCount > pending.sizes.length && (
                  <span className="small muted">
                    … and {pending.pageCount - pending.sizes.length} more (the first 40 are offered)
                  </span>
                )}
                <button type="button" className="btn btn-ghost" onClick={() => setPending(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {progress && (
            <p className="small muted" style={{ margin: 0 }} aria-live="polite">
              {progress}
            </p>
          )}
          {error && (
            <div className="callout" data-tone="red" role="alert">
              {error}
            </div>
          )}
        </section>
        {sheets.length > 0 && (
          <section className="card card-pad stack">
            <h2 className="section-head" style={{ margin: 0 }}>
              Sheets on this device
            </h2>
            <ul className="plain-list" data-testid="plan-sheets">
              {sheets.map((s) => (
                <li
                  key={s.id}
                  className="row"
                  style={{ justifyContent: 'space-between', gap: 8, alignItems: 'center' }}
                >
                  <Link to={`/p/${project.id}/plan?sheet=${s.id}`}>
                    {s.fileName} · page {s.page}
                  </Link>
                  <span className="small muted">
                    {s.devices.length} devices · {s.systems.length} systems{s.ocr ? ' · text recognition' : ''}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger-text"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${s.fileName} page ${s.page} from this device? Rows already written to units stay.`,
                        )
                      )
                        void deletePlanSheet(s.id);
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Screen>
  );
}

// ------------------------------------------------------------------------------------------ the sheet view

type Zoom = 1 | 2 | 4;

/** Unit types with airflow tables, and the tables of a unit. */
const tablesOf = (unit: Equipment) => getSpec(unit.type).sections.flatMap((s) => s.tables ?? []);

function SheetView({ sheet, equipment, locked }: { sheet: PlanSheet; equipment: Equipment[]; locked: boolean }) {
  const [zoom, setZoom] = useState<Zoom>(1);
  const [fit, setFit] = useState(1);
  const [lasso, setLasso] = useState<Pt[] | null>(null);
  const [closed, setClosed] = useState(false);
  const [unitId, setUnitId] = useState<string>('');
  const [tableChoice, setTable] = useState<string>('');
  const [startKey, setStartKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);

  const units = useMemo(
    () =>
      equipment
        .filter((e) => tablesOf(e).length > 0)
        .sort((a, b) => a.designation.localeCompare(b.designation, undefined, { numeric: true })),
    [equipment],
  );
  const unit = units.find((u) => u.id === unitId) ?? null;
  const tables = unit ? tablesOf(unit) : [];
  // the chosen table when the unit has it, else the unit's first
  const table = tables.some((t) => t.key === tableChoice) ? tableChoice : (tables[0]?.key ?? '');

  // the page rendered to a canvas at the zoom (fit = the holder's width)
  useEffect(() => {
    let gone = false;
    const width = holder.current?.clientWidth ?? 800;
    const f = width / sheet.width;
    setFit(f);
    void (async () => {
      const { renderPlanPage } = await import('../../workbook/planSheet');
      const canvas = await renderPlanPage(sheet.pdf, sheet.page, f * zoom * (window.devicePixelRatio || 1));
      if (gone || !canvasHost.current) return;
      canvas.style.width = `${sheet.width * f * zoom}px`;
      canvas.style.height = `${sheet.height * f * zoom}px`;
      canvasHost.current.replaceChildren(canvas);
    })();
    return () => {
      gone = true;
    };
  }, [sheet.pdf, sheet.page, sheet.width, sheet.height, zoom]);

  const inSystem = useMemo(() => {
    const m = new Map<string, { system: PlanSystem; label: string }>();
    for (const s of sheet.systems)
      s.deviceKeys.forEach((k, i) => m.set(k, { system: s, label: deviceLabel(s.prefix, i) }));
    return m;
  }, [sheet.systems]);

  const insideLasso = closed && lasso ? devicesInLasso(sheet.devices, lasso) : [];
  const start = insideLasso.find((d) => d.key === startKey);
  const ordered = walkOrder(insideLasso, start);
  const unitDesign = unit && typeof unit.data.designTotalCfm === 'number' ? unit.data.designTotalCfm : null;
  const check = designCheck(ordered, unitDesign);
  const pickedDevice = sheet.devices.find((d) => d.key === picked) ?? null;

  function pagePoint(e: ReactPointerEvent<SVGSVGElement>): Pt {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * sheet.width, ((e.clientY - r.top) / r.height) * sheet.height];
  }

  function onSvgClick(e: ReactPointerEvent<SVGSVGElement>) {
    if (!lasso || closed) return;
    setLasso([...lasso, pagePoint(e)]);
  }

  async function saveSystem() {
    if (!unit || !table || ordered.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const sys = await addPlanSystem(sheet.id, {
        equipmentId: unit.id,
        table,
        polygon: lasso!,
        deviceKeys: ordered.map((d) => d.key),
        color: nextSystemColor(sheet.systems),
        prefix: systemPrefix(unit.designation, table),
      });
      const r = await applyPlanSystem(sheet.id, sys.id);
      const tableLabel = tables.find((t) => t.key === table)?.label ?? table;
      setMessage(`${r.created} row${r.created === 1 ? '' : 's'} added to ${unit.designation} · ${tableLabel}.`);
      setLasso(null);
      setClosed(false);
      setStartKey(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reapply(sys: PlanSystem) {
    setBusy(true);
    setError(null);
    try {
      const r = await applyPlanSystem(sheet.id, sys.id);
      setMessage(`${r.updated} row${r.updated === 1 ? '' : 's'} updated, ${r.created} added.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function markup() {
    setBusy(true);
    setError(null);
    try {
      const [{ planMarkupPdf }, { downloadFile }] = await Promise.all([
        import('../../reports/planMarkup'),
        import('../../reports/generate'),
      ]);
      const bytes = await planMarkupPdf(sheet, equipment);
      downloadFile(bytes, sheet.fileName.replace(/\.pdf$/i, '') + ' - markup.pdf', 'application/pdf');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const unitName = (id: string) => equipment.find((e) => e.id === id)?.designation ?? '?';
  const r = 7; // marker radius, page points

  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <div className="segmented" role="group" aria-label="Zoom" style={{ flexShrink: 0 }}>
          {([1, 2, 4] as Zoom[]).map((z) => (
            <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)}>
              {z === 1 ? 'Fit' : `${z}×`}
            </button>
          ))}
        </div>
        {!locked && !lasso && (
          <button type="button" className="btn btn-primary" data-testid="plan-lasso" onClick={() => setLasso([])}>
            Lasso a system
          </button>
        )}
        {lasso && !closed && (
          <>
            <span className="small">Tap around the system’s outlets ({lasso.length} points)</span>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!lasso.length}
              onClick={() => setLasso(lasso.slice(0, -1))}
            >
              Undo point
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={lasso.length < 3}
              onClick={() => setClosed(true)}
              data-testid="plan-lasso-done"
            >
              Done
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLasso(null)}>
              Cancel
            </button>
          </>
        )}
        <span className="grow" />
        <button
          type="button"
          className="btn"
          disabled={busy || !sheet.systems.length}
          onClick={() => void markup()}
          data-testid="plan-markup"
        >
          Markup PDF
        </button>
      </div>
      {sheet.ocr && (
        <div className="callout" data-tone="note">
          This sheet’s text was read by text recognition (its tags are plotted as lines). Check types and CFMs: tap a
          device to correct it.
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        {sheet.devices.length} devices found
        {sheet.devices.some((d) => d.how === 'tag')
          ? ' (a dashed marker sits on its tag: no symbol was found for it)'
          : ''}
        . Tap a device for its tag.
      </p>
      <div className="plan-view" ref={holder} data-testid="plan-view">
        <div ref={canvasHost} className="plan-layer" />
        <svg
          className="plan-layer plan-overlay"
          viewBox={`0 0 ${sheet.width} ${sheet.height}`}
          width={sheet.width * fit * zoom}
          height={sheet.height * fit * zoom}
          onPointerUp={onSvgClick}
          style={{ cursor: lasso && !closed ? 'crosshair' : 'default' }}
          data-testid="plan-overlay"
        >
          {sheet.systems.map((s) => (
            <polygon
              key={s.id}
              points={s.polygon.map((p) => p.join(',')).join(' ')}
              fill={s.color}
              fillOpacity={0.18}
              stroke={s.color}
              strokeWidth={1.5}
            />
          ))}
          {lasso && lasso.length > 0 && (
            <polygon
              points={lasso.map((p) => p.join(',')).join(' ')}
              fill={closed ? '#1976d2' : 'none'}
              fillOpacity={0.15}
              stroke="#1976d2"
              strokeWidth={2}
              strokeDasharray={closed ? undefined : '6 4'}
            />
          )}
          {sheet.devices.map((d) => {
            const sys = inSystem.get(d.key);
            const inside = insideLasso.includes(d);
            const idx = ordered.indexOf(d);
            const color = sys?.system.color ?? (inside ? '#1976d2' : '#555');
            const label = sys?.label ?? (inside && idx >= 0 ? deviceLabel('', idx) : null);
            return (
              <g
                key={d.key}
                className="plan-device"
                onPointerUp={(e) => {
                  if (lasso && !closed) return;
                  e.stopPropagation();
                  if (closed && inside) setStartKey(d.key);
                  else setPicked(picked === d.key ? null : d.key);
                }}
                data-testid={`plan-device-${d.key}`}
              >
                <circle
                  cx={d.x}
                  cy={d.y}
                  r={r}
                  fill={color}
                  fillOpacity={0.25}
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray={d.how === 'tag' ? '3 2' : undefined}
                />
                {d.how !== 'tag' && (
                  <line x1={d.tag.x} y1={d.tag.y} x2={d.x} y2={d.y} stroke={color} strokeWidth={0.6} opacity={0.6} />
                )}
                {label && (
                  <text
                    x={d.x + r + 2}
                    y={d.y + 4}
                    fontSize={12}
                    fontWeight={700}
                    fill={color}
                    stroke="#fff"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {label}
                  </text>
                )}
                {picked === d.key && <circle cx={d.x} cy={d.y} r={r + 5} fill="none" stroke="#000" strokeWidth={1.5} />}
              </g>
            );
          })}
        </svg>
      </div>

      {pickedDevice && !closed && (
        <DeviceCard
          key={pickedDevice.key}
          sheet={sheet}
          device={pickedDevice}
          system={inSystem.get(pickedDevice.key) ?? null}
          unitName={unitName}
          locked={locked}
          onClose={() => setPicked(null)}
        />
      )}

      {closed && lasso && (
        <section className="card card-pad stack" data-testid="plan-system-form">
          <h2 className="section-head" style={{ margin: 0 }}>
            New system: {insideLasso.length} device{insideLasso.length === 1 ? '' : 's'} in the lasso
          </h2>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Unit</span>
              <select
                className="select"
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                data-testid="plan-unit"
              >
                <option value="">Choose…</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.designation} ({EQUIPMENT_TYPES.find((t) => t.key === u.type)?.label ?? u.type})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Table</span>
              <select
                className="select"
                value={table}
                onChange={(e) => setTable(e.target.value)}
                disabled={!unit}
                data-testid="plan-table"
              >
                {tables.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Lettered in walk order from the top-left device: tap another device in the lasso to start there.
          </p>
          {ordered.length > 0 && (
            <div className="preview-wrap">
              <table className="preview-table" data-testid="plan-order">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Type</th>
                    <th>Size</th>
                    <th>Design CFM</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((d, i) => (
                    <tr key={d.key}>
                      <td>{deviceLabel(unit ? systemPrefix(unit.designation, table) : '', i)}</td>
                      <td>{d.type}</td>
                      <td>{d.size ?? '—'}</td>
                      <td>{fmt(d.cfm)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Total</td>
                    <td>{fmt(check.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {check.ratio !== null && (
            <div className="callout" data-tone={check.ok ? 'note' : 'amber'} data-testid="plan-design-check">
              Devices total {fmt(check.total)} CFM against the unit’s design {fmt(check.unit)} CFM (
              {Math.round(check.ratio * 100)} %).
              {check.ok ? '' : ' Check for a missed or extra device, or a schedule that differs from the plan.'}
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !unit || !table || !ordered.length}
              onClick={() => void saveSystem()}
              data-testid="plan-save-system"
            >
              Add {ordered.length} row{ordered.length === 1 ? '' : 's'}
              {unit ? ` to ${unit.designation}` : ''}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setLasso(null);
                setClosed(false);
                setStartKey(null);
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {message && (
        <div className="callout" data-tone="note" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="callout" data-tone="red" role="alert">
          {error}
        </div>
      )}

      {sheet.systems.length > 0 && (
        <section className="card card-pad stack">
          <h2 className="section-head" style={{ margin: 0 }}>
            Systems
          </h2>
          <ul className="plain-list" data-testid="plan-systems">
            {sheet.systems.map((s) => {
              const u = equipment.find((e) => e.id === s.equipmentId);
              const label = u ? (tablesOf(u).find((t) => t.key === s.table)?.label ?? s.table) : s.table;
              const written = Object.keys(s.rowIds).length;
              return (
                <li key={s.id} className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="plan-swatch" style={{ background: s.color }} aria-hidden="true" />
                  <strong>{u?.designation ?? 'removed unit'}</strong>
                  <span className="small muted">
                    {label} · {s.deviceKeys.length} devices · labels {s.prefix}A–
                    {deviceLabel(s.prefix, Math.max(0, s.deviceKeys.length - 1))}
                    {written ? ` · ${written} rows written` : ' · no rows yet'}
                  </span>
                  <span className="grow" />
                  {!locked && u && (
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void reapply(s)}>
                      {written ? 'Update rows' : 'Write rows'}
                    </button>
                  )}
                  {u && (
                    <Link className="btn btn-sm" to={`/p/${sheet.projectId}/e/${u.id}`}>
                      Open {u.designation}
                    </Link>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-danger-text"
                    onClick={() => {
                      if (window.confirm('Remove this system from the sheet? Rows already written stay with the unit.'))
                        void removePlanSystem(sheet.id, s.id);
                    }}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function DeviceCard({
  sheet,
  device,
  system,
  unitName,
  locked,
  onClose,
}: {
  sheet: PlanSheet;
  device: PlanSheetDevice;
  system: { system: PlanSystem; label: string } | null;
  unitName: (id: string) => string;
  locked: boolean;
  onClose: () => void;
}) {
  const [type, setType] = useState(device.type);
  const [size, setSize] = useState(device.size ?? '');
  const [cfm, setCfm] = useState(device.cfm === null ? '' : String(device.cfm));
  const dirty =
    type !== device.type || size !== (device.size ?? '') || cfm !== (device.cfm === null ? '' : String(device.cfm));
  const how = {
    leader: 'placed by its leader',
    nearest: 'placed on the nearest symbol',
    typ: 'one of a TYP group',
    tag: 'no symbol found: shown at its tag',
  }[device.how];
  return (
    <section className="card card-pad stack" data-testid="plan-device-card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 className="section-head" style={{ margin: 0 }}>
          {system ? `${system.label} · ${unitName(system.system.equipmentId)}` : 'Device'}
        </h2>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Tag: {device.tag.lines.join(' / ')}
        {device.count > 1 ? ` · ${device.index + 1} of ${device.count} (TYP)` : ''} · {how}
      </p>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Type</span>
          <input
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value.toUpperCase())}
            disabled={locked}
          />
        </label>
        <label className="field">
          <span className="field-label">Size</span>
          <input
            className="input"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            disabled={locked}
            placeholder='12x8, 8"R'
          />
        </label>
        <label className="field">
          <span className="field-label">Design CFM</span>
          <input
            className="input"
            inputMode="numeric"
            value={cfm}
            onChange={(e) => setCfm(e.target.value)}
            disabled={locked}
          />
        </label>
      </div>
      {!locked && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || !type.trim()}
          onClick={() =>
            void updatePlanDevice(sheet.id, device.key, {
              type: type.trim(),
              size: size.trim() || null,
              cfm: cfm.trim() === '' ? null : Number(cfm) || null,
            })
          }
        >
          Save
        </button>
      )}
    </section>
  );
}
