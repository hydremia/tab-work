import { addAirflowRow, airflowTableCapacity, CapacityError, deleteRecord, setField, setFields } from '../../data/repo';
import { NOTATIONS, type AirflowRow, type Equipment, type NaMark, type Notation } from '../../data/types';
import { formatNumber, formatPercent, rowCfm, tableTotals, withinTolerance } from '../../domain/calc';
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

function optionsFor(col: RowColumnSpec, unitData: Equipment['data']): readonly (string | number)[] {
  if (col.optionsBy) {
    const v = unitData[col.optionsBy.field];
    const hit = typeof v === 'string' ? col.optionsBy.map[v] : undefined;
    if (hit) return hit;
  }
  return col.options ?? [];
}

/** Live CFM line of a row, by the table's calc. */
function RowCalcLine({ spec, row, unitData }: { spec: RowTableSpec; row: AirflowRow; unitData: Equipment['data'] }) {
  const calc = spec.calc ?? 'outlet';
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
    const v = row.data.velocity;
    return (
      <span className="calc">
        CFM {formatNumber(filterCfm(MAU_FILTER_GRID_TYPE, row.data.size, typeof v === 'number' ? v : null))}
      </span>
    );
  }
  return (
    <span className="calc">
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
}: {
  row: AirflowRow;
  index: number;
  spec: RowTableSpec;
  unitData: Equipment['data'];
  onDuplicate?: () => void;
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
              <label htmlFor={id}>{col.label}</label>
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
      <div className="outlet-foot">
        <RowCalcLine spec={spec} row={row} unitData={unitData} />
        {spec.tolerance && <Pct ratio={result?.ratio ?? null} tolerance={tolerance} />}
        {result && result.missing.length > 0 && (
          <span className="small" style={{ color: 'var(--amber)' }}>
            {result.missing.length} missing
          </span>
        )}
        <select
          className="row-menu"
          aria-label={`${label} actions`}
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'delete') {
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
          {onDuplicate && <option value="duplicate">Duplicate row</option>}
          <option value="delete">Delete row</option>
        </select>
      </div>
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
  const noun = spec.noun ?? (spec.key === 'return' ? 'inlet' : spec.key === 'oa' ? 'OA row' : 'outlet');
  const firstCol = tableColumns(spec)[0].key;

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
      {rows.map((r, i) => (
        <OutletRow
          key={r.id}
          row={r}
          index={i}
          spec={spec}
          unitData={equipment.data}
          result={result?.rows[r.id]}
          tolerance={tolerance}
          onDuplicate={rows.length < cap ? () => void add(r) : undefined}
        />
      ))}
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
      {rows.length < cap && !(naLine && rows.length === 0) && (
        <button type="button" className="btn btn-block" onClick={() => void add()} data-testid={`add-${spec.key}`}>
          <IconPlus size={18} /> Add {noun}
        </button>
      )}
    </div>
  );
}
