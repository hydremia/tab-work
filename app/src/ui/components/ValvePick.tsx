/**
 * On a valve row: pick the valve model from the shared library (fills make / model, size and type) and see the flow
 * its setting and ΔP give (domain/valves.ts), with buttons to take it as the initial or final flow. The flow is only
 * written when the tech taps a button: the reading on the row is what the report prints.
 */
import { useLibraryValves } from '../../data/hooks';
import { setFields } from '../../data/repo';
import type { AirflowRow, Equipment } from '../../data/types';
import { formatNumber } from '../../domain/calc';
import { valveFlow, valveName } from '../../domain/valves';

export function ValvePick({ row, unitData, label }: { row: AirflowRow; unitData: Equipment['data']; label: string }) {
  const valves = useLibraryValves();
  if (!valves) return null;
  const id = typeof row.data.valveId === 'string' ? row.data.valveId : '';
  const valve = valves.find((v) => v.id === id);
  const flow = valve ? valveFlow(valve, row.data.setting, row.data.dp, unitData.dpUnits) : null;
  const units = unitData.dpUnits === 'ft w.g.' ? 'ft w.g.' : 'psi';
  const take = (key: 'initialGpm' | 'finalGpm') => {
    if (flow?.gpm != null) void setFields('airflowRows', row.id, { [`data.${key}`]: Math.round(flow.gpm * 10) / 10 });
  };
  return (
    <div className="valve-pick" data-testid="valve-pick">
      <label className="small" htmlFor={`vp-${row.id}`}>
        Library valve
      </label>
      <select
        id={`vp-${row.id}`}
        className="select"
        aria-label={`${label} library valve`}
        value={id}
        onChange={(e) => {
          const v = valves.find((x) => x.id === e.target.value);
          void setFields(
            'airflowRows',
            row.id,
            v
              ? {
                  'data.valveId': v.id,
                  'data.makeModel': [v.make, v.model].filter(Boolean).join(' '),
                  'data.size': v.size || row.data.size || null,
                  'data.type': v.valveType || row.data.type || null,
                }
              : { 'data.valveId': null },
          );
        }}
      >
        <option value="">{valves.length ? 'None (flow entered by hand)' : 'Library is empty (Menu → Library)'}</option>
        {valves.map((v) => (
          <option key={v.id} value={v.id}>
            {valveName(v)} ({v.valveType || '?'})
          </option>
        ))}
      </select>
      {flow && (
        <div className="valve-flow">
          {flow.gpm !== null ? (
            <>
              <span data-testid="valve-flow">
                <b>{formatNumber(flow.gpm, 1)} GPM</b>{' '}
                <span className="small muted">
                  ({flow.note}, ΔP in {units})
                </span>
              </span>
              <button type="button" className="btn btn-sm" onClick={() => take('initialGpm')}>
                Use as initial
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => take('finalGpm')}
                data-testid="valve-use-final"
              >
                Use as final
              </button>
            </>
          ) : (
            <span className="small muted">{flow.note}</span>
          )}
        </div>
      )}
    </div>
  );
}
