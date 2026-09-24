import { addAirflowRow, airflowTableCapacity, CapacityError, deleteRecord, setField, setFields } from '../../data/repo';
import { NOTATIONS, type AirflowRow, type Equipment, type NaMark, type Notation } from '../../data/types';
import { formatNumber, formatPercent, rowCfm, tableTotals, withinTolerance } from '../../domain/calc';
import { tableNaKey, type TableResult } from '../../domain/completion';
import { ROW_COLUMNS, type RowTableSpec } from '../../domain/specs';
import { IconPlus } from './Icons';
import { NaSelect, NumberInput, TextInput } from './inputs';
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

function Pct({ ratio, tolerance }: { ratio: number | null; tolerance: number }) {
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

function OutletRow({
  row,
  index,
  spec,
  result,
  tolerance,
}: {
  row: AirflowRow;
  index: number;
  spec: RowTableSpec;
  result: TableResult['rows'][string] | undefined;
  tolerance: number;
}) {
  const computedDesign = spec.firstRowDesignComputed && index === 0;
  const idp = `${spec.key}-${index}`;
  const label = `${spec.label} row ${index + 1}`;
  const init = rowCfm(row, 'initial');
  const fin = rowCfm(row, 'final');
  return (
    <div
      className="outlet"
      data-out={result?.outOfTolerance ?? false}
      data-testid={`row-${spec.key}-${index}`}
      role="group"
      aria-label={label}
    >
      <div className="outlet-grid">
        {ROW_COLUMNS.map((col) => {
          const id = `${idp}-${col.key}`;
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
          return (
            <div className={`cell${col.key === 'area' ? ' wide' : ''}`} key={col.key}>
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
                  onCommit={(n) => void setField('airflowRows', row.id, `data.${col.key}`, n)}
                />
              ) : (
                <TextInput
                  id={id}
                  aria-label={`${label} ${col.label}`}
                  value={v === null || v === undefined ? '' : String(v)}
                  onCommit={(s) => void setField('airflowRows', row.id, `data.${col.key}`, s)}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="outlet-foot">
        <span className="calc">
          CFM init {formatNumber(init)} · final {formatNumber(fin)}
        </span>
        <Pct ratio={result?.ratio ?? null} tolerance={tolerance} />
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
          {(['initialVel', 'finalVel'] as const).flatMap((col) =>
            NOTATIONS.map((n) => (
              <option key={`${col}|${n}`} value={`${col}|${n}`}>
                {col === 'initialVel' ? 'Initial' : 'Final'} VEL: {n}
              </option>
            )),
          )}
          {Object.values(row.na).some(Boolean) && <option value="clear">Clear N/A marks</option>}
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
  const totals = tableTotals(rows);
  const noun = spec.key === 'return' ? 'inlet' : spec.key === 'oa' ? 'OA row' : 'outlet';

  async function add() {
    const last = rows[rows.length - 1];
    const data: AirflowRow['data'] = last
      ? {
          no: nextNo(last.data.no),
          area: last.data.area ?? null,
          type: last.data.type ?? null,
          size: last.data.size ?? null,
          ak: last.data.ak ?? null,
        }
      : {};
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
        {!spec.required && <span className="chip">Optional</span>}
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
        <OutletRow key={r.id} row={r} index={i} spec={spec} result={result?.rows[r.id]} tolerance={tolerance} />
      ))}
      {rows.length > 1 && (
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
