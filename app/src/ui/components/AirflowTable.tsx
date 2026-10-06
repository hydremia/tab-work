import { Fragment, useState } from 'react';
import { addAirflowRow, airflowTableCapacity, CapacityError, deleteRecord, setField, setFields } from '../../data/repo';
import { NOTATIONS, type AirflowRow, type Equipment, type NaMark, type Notation } from '../../data/types';
import { designVel, formatNumber, formatPercent, rowCfm, tableTotals, withinTolerance } from '../../domain/calc';
import { valveTotals } from '../../domain/hydronicCalcs';
import { ValvePick } from './ValvePick';
import { LINE_OPTIONS, RowLinkChips, useLineActions, useRowLinks, type LineLinks } from './RowLinks';
import { tableNaKey, type TableResult } from '../../domain/completion';
import { filterCfm, hoodRow } from '../../domain/equipmentCalcs';
import { DEFAULT_FILL_DOWN, tableColumns, type RowColumnSpec, type RowTableSpec } from '../../domain/specs';
import { MAU_FILTER_GRID_TYPE } from '@a2b/workbook/map';
import { IconPlus } from './Icons';
import { NaSelect, NumberInput, SelectInput, TextInput } from './inputs';
import { StatusIcon } from './Status';

const NA_TEXT: Record<string, string> = {
  'auto-na': 'Auto N/A',
  'section-na': 'Section N/A',
  'equipment-na': 'Unit N/A',
  'scope-na': 'N/A for this scope',
  na: '',
};

/** Next outlet number: S-3 -> S-4, 12 -> 13. */
export function nextNo(prev: unknown): string | null {
  if (typeof prev !== 'string' && typeof prev !== 'number') return null;
  const m = /^(.*?)(\d+)$/.exec(String(prev));
  return m ? `${m[1]}${Number(m[2]) + 1}` : null;
}

export function Pct({ ratio, tolerance }: { ratio: number | null; tolerance: number }) {
  if (ratio === null) return <span className="muted">— %</span>;
  const ok = withinTolerance(ratio, tolerance);
  return (
    <span className="pct" data-ok={ok} title={ok ? 'Within tolerance' : 'Out of tolerance'}>
      <StatusIcon color={ok ? 'green' : 'red'} size={14} />
      {formatPercent(ratio)}
      <span className="visually-hidden">{ok ? 'within tolerance' : 'out of tolerance'}</span>
    </span>
  );
}

/** Outlet-style tables (Ak, design CFM and velocity readings) show the design velocity of each row. */
const hasDesignVel = (spec: RowTableSpec) => {
  const keys = new Set(tableColumns(spec).map((c) => c.key));
  return (spec.calc ?? 'outlet') === 'outlet' && keys.has('ak') && keys.has('designCfm') && keys.has('initialVel');
};

function optionsFor(col: RowColumnSpec, unitData: Equipment['data']): readonly (string | number)[] {
  if (col.optionsBy) {
    const v = unitData[col.optionsBy.field];
    const hit = typeof v === 'string' ? col.optionsBy.map[v] : undefined;
    if (hit) return hit;
  }
  return col.options ?? [];
}

/** Live CFM line of a row, by the table's calc. */
function RowCalcLine({
  spec,
  row,
  unitData,
  compact = false,
  target = null,
}: {
  spec: RowTableSpec;
  row: AirflowRow;
  unitData: Equipment['data'];
  /** Design velocity (design CFM ÷ Ak) shown before the CFM (outlet tables). */
  target?: number | null;
  /** Grid cell: just "initial / final" CFM. */
  compact?: boolean;
}) {
  const calc = spec.calc ?? 'outlet';
  if (calc === 'valve') return null; // the % is the valve row's only calculation
  if (compact && calc !== 'filterGrid') {
    const [a, b] =
      calc === 'hoodFilter'
        ? [hoodRow(unitData.filterType, row.data).initialCfm, hoodRow(unitData.filterType, row.data).finalCfm]
        : [rowCfm(row, 'initial'), rowCfm(row, 'final')];
    return (
      <span className="calc">
        {formatNumber(a)} / {formatNumber(b)}
      </span>
    );
  }
  if (calc === 'hoodFilter') {
    const h = hoodRow(unitData.filterType, row.data);
    return (
      <span className="calc">
        VEL {formatNumber(h.initialVel)} / {formatNumber(h.finalVel)} · CFM init {formatNumber(h.initialCfm)} · final{' '}
        {formatNumber(h.finalCfm)}
      </span>
    );
  }
  if (calc === 'filterGrid') {
    const cfmOf = (v: unknown) => filterCfm(MAU_FILTER_GRID_TYPE, row.data.size, typeof v === 'number' ? v : null);
    return (
      <span className="calc">
        CFM init {formatNumber(cfmOf(row.data.initialVelocity))} · final {formatNumber(cfmOf(row.data.velocity))}
      </span>
    );
  }
  return (
    <span className="calc">
      {target !== null && (
        <>
          Design VEL <b data-testid="row-design-vel">{formatNumber(target)}</b> fpm ·{' '}
        </>
      )}
      CFM init {formatNumber(rowCfm(row, 'initial'))} · final {formatNumber(rowCfm(row, 'final'))}
    </span>
  );
}

function OutletRow({
  row,
  index,
  spec,
  unitData,
  result,
  tolerance,
  onDuplicate,
  links,
  onLine,
}: {
  row: AirflowRow;
  index: number;
  spec: RowTableSpec;
  unitData: Equipment['data'];
  onDuplicate?: () => void;
  links?: LineLinks;
  onLine: (action: string, row: AirflowRow) => Promise<boolean>;
  result: TableResult['rows'][string] | undefined;
  tolerance: number;
}) {
  const computedDesign = spec.firstRowDesignComputed && index === 0;
  const idp = `${spec.key}-${index}`;
  const noun = spec.noun ?? 'row';
  const label = `${spec.label} ${noun} ${index + 1}`;
  const cols = tableColumns(spec);
  const auto = result?.auto ?? {};
  const autoReasons = [...new Set(Object.values(auto))];
  const naCols = cols.filter((c) => c.naMenu && !(c.key in auto));
  const target = hasDesignVel(spec) ? designVel(row, computedDesign ? (result?.design ?? null) : undefined) : null;
  return (
    <div
      className="outlet"
      data-out={result?.outOfTolerance ?? false}
      data-testid={`row-${spec.key}-${index}`}
      role="group"
      aria-label={label}
    >
      <div className="outlet-grid" data-calc={spec.calc ?? 'outlet'}>
        {cols.map((col) => {
          const id = `${idp}-${col.key}`;
          if (col.key in auto) return null; // automatically N/A on this row (listed below the row)
          if (computedDesign && col.key === 'designCfm') {
            return (
              <div className="cell" key={col.key}>
                <label htmlFor={id}>Design (calc)</label>
                <input
                  id={id}
                  className="input"
                  readOnly
                  value={formatNumber(result?.design ?? null)}
                  title="Total design − OA design (workbook formula)"
                />
              </div>
            );
          }
          const mark = row.na[col.key];
          const v = row.data[col.key];
          const commit = (x: unknown) => void setField('airflowRows', row.id, `data.${col.key}`, x);
          return (
            <div className={`cell${col.wide ? ' wide' : ''}`} key={col.key}>
              <label htmlFor={id}>
                {col.label}
                {target !== null && (col.key === 'initialVel' || col.key === 'finalVel') && (
                  <span className="target-vel"> · target {formatNumber(target)}</span>
                )}
              </label>
              {mark && (v === null || v === undefined || v === '') ? (
                <span className="na-value" id={id}>
                  {mark.notation}
                </span>
              ) : col.input === 'number' ? (
                <NumberInput
                  id={id}
                  aria-label={`${label} ${col.label}`}
                  value={typeof v === 'number' ? v : null}
                  onCommit={commit}
                />
              ) : col.input === 'select' ? (
                <SelectInput
                  id={id}
                  aria-label={`${label} ${col.label}`}
                  value={v ?? null}
                  options={optionsFor(col, unitData)}
                  onCommit={commit}
                />
              ) : (
                <TextInput
                  id={id}
                  aria-label={`${label} ${col.label}`}
                  value={v === null || v === undefined ? '' : String(v)}
                  onCommit={commit}
                />
              )}
            </div>
          );
        })}
      </div>
      {autoReasons.length > 0 && (
        <div className="small muted" data-testid={`row-auto-${spec.key}-${index}`}>
          Auto N/A:{' '}
          {cols
            .filter((c) => c.key in auto)
            .map((c) => c.label)
            .join(', ')}{' '}
          ({autoReasons.join('; ')})
        </div>
      )}
      {spec.calc === 'valve' && <ValvePick row={row} unitData={unitData} label={label} />}
      <div className="outlet-foot">
        <RowCalcLine spec={spec} row={row} unitData={unitData} target={target} />
        {spec.tolerance && <Pct ratio={result?.ratio ?? null} tolerance={tolerance} />}
        {result && result.missing.length > 0 && (
          <span className="small" style={{ color: 'var(--amber)' }}>
            {result.missing.length} missing
          </span>
        )}
        <RowLinkChips links={links} projectId={row.projectId} />
        <select
          className="row-menu"
          aria-label={`${label} actions`}
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith('line-')) void onLine(v, row);
            else if (v === 'delete') {
              if (window.confirm(`Delete ${label}?`)) void deleteRecord('airflowRows', row.id);
            } else if (v === 'duplicate') {
              onDuplicate?.();
            } else if (v === 'clear') {
              void setField('airflowRows', row.id, 'na', {});
            } else if (v.includes('|')) {
              const [col, notation] = v.split('|');
              void setFields('airflowRows', row.id, {
                [`data.${col}`]: null,
                [`na.${col}`]: { notation: notation as Notation } satisfies NaMark,
              });
            }
          }}
        >
          <option value="">Row…</option>
          {naCols.flatMap((col) =>
            NOTATIONS.map((n) => (
              <option key={`${col.key}|${n}`} value={`${col.key}|${n}`}>
                {col.label}: {n}
              </option>
            )),
          )}
          {Object.values(row.na).some(Boolean) && <option value="clear">Clear N/A marks</option>}
          {LINE_OPTIONS}
          {onDuplicate && <option value="duplicate">Duplicate row</option>}
          <option value="delete">Delete row</option>
        </select>
      </div>
    </div>
  );
}

/** Grid (spreadsheet) entry is remembered per device; by default on for wide screens (tablets, laptops). */
const GRID_KEY = 'tab.gridEntry';
function initialGrid(): boolean {
  try {
    const v = localStorage.getItem(GRID_KEY);
    if (v === '1' || v === '0') return v === '1';
  } catch {
    /* storage blocked: fall back to the screen width */
  }
  return typeof window !== 'undefined' && window.matchMedia?.('(min-width: 900px)').matches === true;
}
function rememberGrid(on: boolean) {
  try {
    localStorage.setItem(GRID_KEY, on ? '1' : '0');
  } catch {
    /* not remembered */
  }
}

/**
 * Spreadsheet-style keys in the grid: Enter / ↓ go to the same column one row down, ↑ one row up (↑ ↓ are left to
 * the list in a select); the cell ids are `g-<table>-<row>-<col>`.
 */
function gridKeys(e: React.KeyboardEvent<HTMLTableElement>) {
  const el = e.target as HTMLElement;
  const m = /^g-(.+)-(\d+)-(\d+)$/.exec(el.id);
  if (!m || e.altKey || e.ctrlKey || e.metaKey) return;
  const isSelect = el.tagName === 'SELECT';
  const dir = e.key === 'Enter' || (e.key === 'ArrowDown' && !isSelect) ? 1 : e.key === 'ArrowUp' && !isSelect ? -1 : 0;
  if (!dir) return;
  const next = document.getElementById(
    `g-${m[1]}-${Number(m[2]) + (e.shiftKey && e.key === 'Enter' ? -1 : dir)}-${m[3]}`,
  );
  if (!next) return;
  e.preventDefault();
  (el as HTMLInputElement).blur?.(); // commits the draft
  next.focus();
  if (next instanceof HTMLInputElement) next.select();
}

function GridTable({
  spec,
  rows,
  unitData,
  result,
  tolerance,
  onDuplicate,
  links,
  onLine,
}: {
  spec: RowTableSpec;
  rows: AirflowRow[];
  unitData: Equipment['data'];
  result: TableResult | undefined;
  tolerance: number;
  onDuplicate?: (r: AirflowRow) => void;
  links?: Map<string, LineLinks>;
  onLine: (action: string, row: AirflowRow) => Promise<boolean>;
}) {
  const cols = tableColumns(spec);
  const noun = spec.noun ?? 'row';
  const showVel = hasDesignVel(spec);
  return (
    <div className="grid-wrap">
      <table className="entry-grid" onKeyDown={gridKeys} data-testid={`grid-${spec.key}`}>
        <thead>
          <tr>
            <th scope="col">#</th>
            {cols.map((c) => (
              <Fragment key={c.key}>
                {showVel && c.key === 'initialVel' && (
                  <th scope="col" title="Design CFM ÷ Ak: the velocity to look for">
                    Design VEL
                  </th>
                )}
                <th scope="col">{c.label}</th>
              </Fragment>
            ))}
            {spec.calc !== 'valve' && <th scope="col">{spec.calc === 'filterGrid' ? 'CFM' : 'CFM init / final'}</th>}
            {spec.tolerance && <th scope="col">%</th>}
            <th scope="col">
              <span className="visually-hidden">Row actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const res = result?.rows[row.id];
            const auto = res?.auto ?? {};
            const label = `${spec.label} ${noun} ${i + 1}`;
            const computedDesign = spec.firstRowDesignComputed && i === 0;
            const naCols = cols.filter((c) => c.naMenu && !(c.key in auto));
            const gridCell = (col: RowColumnSpec, ci: number) => {
              const id = `g-${spec.key}-${i}-${ci}`;
              const aria = `${label} ${col.label}`;
              if (col.key in auto)
                return (
                  <td key={col.key} className="grid-na" title={`Auto N/A: ${auto[col.key]}`}>
                    N/A
                  </td>
                );
              if (computedDesign && col.key === 'designCfm')
                return (
                  <td key={col.key} className="grid-calc" title="Total design − OA design (workbook formula)">
                    {formatNumber(res?.design ?? null)}
                  </td>
                );
              const mark = row.na[col.key];
              const v = row.data[col.key];
              const commit = (x: unknown) => void setField('airflowRows', row.id, `data.${col.key}`, x);
              if (mark && (v === null || v === undefined || v === ''))
                return (
                  <td key={col.key} className="grid-na">
                    {mark.notation}
                  </td>
                );
              return (
                <td key={col.key} className={col.wide ? 'grid-wide' : undefined}>
                  {col.input === 'number' ? (
                    <NumberInput id={id} aria-label={aria} value={typeof v === 'number' ? v : null} onCommit={commit} />
                  ) : col.input === 'select' ? (
                    <SelectInput
                      id={id}
                      aria-label={aria}
                      value={v ?? null}
                      options={optionsFor(col, unitData)}
                      onCommit={commit}
                    />
                  ) : (
                    <TextInput
                      id={id}
                      aria-label={aria}
                      value={v === null || v === undefined ? '' : String(v)}
                      onCommit={commit}
                    />
                  )}
                </td>
              );
            };
            return (
              <tr key={row.id} data-out={res?.outOfTolerance ?? false} data-testid={`grid-row-${spec.key}-${i}`}>
                <th scope="row" className="grid-n">
                  {i + 1}
                  {res && res.missing.length > 0 && (
                    <span className="grid-missing" title={`${res.missing.length} missing`}>
                      •
                    </span>
                  )}
                  <RowLinkChips links={links?.get(row.id)} projectId={row.projectId} />
                </th>
                {cols.map((col, ci) => {
                  const cell = gridCell(col, ci);
                  if (!(showVel && col.key === 'initialVel')) return cell;
                  const t = designVel(row, computedDesign ? (res?.design ?? null) : undefined);
                  return (
                    <Fragment key={col.key}>
                      <td className="grid-calc" data-testid={`grid-design-vel-${spec.key}-${i}`}>
                        {formatNumber(t)}
                      </td>
                      {cell}
                    </Fragment>
                  );
                })}
                {spec.calc !== 'valve' && (
                  <td className="grid-calc">
                    <RowCalcLine spec={spec} row={row} unitData={unitData} compact />
                  </td>
                )}
                {spec.tolerance && (
                  <td>
                    <Pct ratio={res?.ratio ?? null} tolerance={tolerance} />
                  </td>
                )}
                <td>
                  <select
                    className="row-menu"
                    aria-label={`${label} actions`}
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.startsWith('line-')) void onLine(v, row);
                      else if (v === 'delete') {
                        if (window.confirm(`Delete ${label}?`)) void deleteRecord('airflowRows', row.id);
                      } else if (v === 'duplicate') onDuplicate?.(row);
                      else if (v === 'clear') void setField('airflowRows', row.id, 'na', {});
                      else if (v.includes('|')) {
                        const [c, notation] = v.split('|');
                        void setFields('airflowRows', row.id, {
                          [`data.${c}`]: null,
                          [`na.${c}`]: { notation: notation as Notation } satisfies NaMark,
                        });
                      }
                    }}
                  >
                    <option value="">⋯</option>
                    {naCols.flatMap((c) =>
                      NOTATIONS.map((n) => (
                        <option key={`${c.key}|${n}`} value={`${c.key}|${n}`}>
                          {c.label}: {n}
                        </option>
                      )),
                    )}
                    {Object.values(row.na).some(Boolean) && <option value="clear">Clear N/A marks</option>}
                    {LINE_OPTIONS}
                    {onDuplicate && <option value="duplicate">Duplicate row</option>}
                    <option value="delete">Delete row</option>
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function AirflowTable({
  equipment,
  spec,
  rows,
  result,
  tolerance,
}: {
  equipment: Equipment;
  spec: RowTableSpec;
  rows: AirflowRow[];
  result: TableResult | undefined;
  tolerance: number;
}) {
  const cap = airflowTableCapacity(equipment.type, spec.key);
  const mark = equipment.naState.fields[tableNaKey(spec.key)];
  const st = result?.state;
  const outlet = (spec.calc ?? 'outlet') === 'outlet';
  const totals = tableTotals(rows);
  const valves = spec.calc === 'valve' ? valveTotals(rows) : null;
  const noun = spec.noun ?? (spec.key === 'return' ? 'inlet' : spec.key === 'oa' ? 'OA row' : 'outlet');
  const firstCol = tableColumns(spec)[0].key;
  const [grid, setGrid] = useState(initialGrid);
  const links = useRowLinks(equipment.id);
  const line = useLineActions(equipment);

  async function add(copyOf?: AirflowRow) {
    const last = copyOf ?? rows[rows.length - 1];
    let data: AirflowRow['data'] = {};
    if (copyOf) data = { ...copyOf.data };
    else if (last) for (const k of spec.fillDown ?? DEFAULT_FILL_DOWN) data[k] = last.data[k] ?? null;
    if (last && firstCol === 'no') data.no = nextNo(rows[rows.length - 1].data.no);
    try {
      await addAirflowRow(equipment, spec.key, data);
    } catch (e) {
      if (e instanceof CapacityError) window.alert(e.message);
      else throw e;
    }
  }

  const naLine = st && st !== 'value' && st !== 'optional' && NA_TEXT[st] !== undefined;
  return (
    <div className="airflow-table" data-testid={`table-${spec.key}`}>
      <div className="airflow-head">
        <h3>{spec.label}</h3>
        <span className="chip">
          {rows.length} / {cap}
        </span>
        {st === 'optional' && <span className="chip">Optional</span>}
        <span className="spacer" />
        {rows.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-pressed={grid}
            data-testid={`grid-toggle-${spec.key}`}
            title={grid ? 'Show one card per row' : 'Show a spreadsheet grid (tablets, keyboards)'}
            onClick={() => {
              setGrid(!grid);
              rememberGrid(!grid);
            }}
          >
            {grid ? 'Cards' : 'Grid'}
          </button>
        )}
        <NaSelect
          label={spec.label}
          mark={mark}
          onChange={(m) => void setField('equipment', equipment.id, `naState.fields.${tableNaKey(spec.key)}`, m)}
        />
      </div>
      {naLine && (
        <div className="na-auto">
          <strong>{spec.label}</strong>
          <span>
            {st === 'na' ? mark?.notation : NA_TEXT[st!]}
            {result?.reason ? ` · ${result.reason}` : ''}
          </span>
        </div>
      )}
      {grid && rows.length > 0 ? (
        <GridTable
          spec={spec}
          rows={rows}
          unitData={equipment.data}
          result={result}
          tolerance={tolerance}
          onDuplicate={rows.length < cap ? (r) => void add(r) : undefined}
          links={links}
          onLine={line.run}
        />
      ) : null}
      {!grid &&
        rows.map((r, i) => (
          <OutletRow
            key={r.id}
            row={r}
            index={i}
            spec={spec}
            unitData={equipment.data}
            result={result?.rows[r.id]}
            tolerance={tolerance}
            onDuplicate={rows.length < cap ? () => void add(r) : undefined}
            links={links?.get(r.id)}
            onLine={line.run}
          />
        ))}
      {line.input}
      {outlet && rows.length > 1 && (
        <div className="totals" aria-label={`${spec.label} totals`}>
          <span>
            Design <b>{formatNumber(totals.design)}</b>
          </span>
          <span>
            Actual <b>{formatNumber(totals.actual)}</b>
          </span>
          <Pct ratio={totals.ratio} tolerance={tolerance} />
        </div>
      )}
      {valves && rows.length > 1 && (
        <div className="totals" aria-label={`${spec.label} totals`}>
          <span>
            Design <b>{formatNumber(valves.design)}</b> GPM
          </span>
          <span>
            Final <b>{formatNumber(valves.final ?? valves.initial)}</b> GPM
          </span>
          <Pct ratio={valves.ratio} tolerance={tolerance} />
        </div>
      )}
      {rows.length < cap && !(naLine && rows.length === 0) && (
        <button type="button" className="btn btn-block" onClick={() => void add()} data-testid={`add-${spec.key}`}>
          <IconPlus size={18} /> Add {noun}
        </button>
      )}
    </div>
  );
}
