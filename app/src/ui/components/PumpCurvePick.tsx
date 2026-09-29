/**
 * In a pump's test panel: pick the pump's curve from the shared library and see the impeller its shut-off head
 * gives and the flow at the final head (domain/pumpCurves.ts), with buttons to take them as the actual impeller /
 * actual GPM (flow method "Pump curve"). Nothing is written until the tech taps.
 */
import { useLibraryPumps } from '../../data/hooks';
import { setField, setFields } from '../../data/repo';
import type { Equipment } from '../../data/types';
import { formatNumber } from '../../domain/calc';
import { pumpTest } from '../../domain/hydronicCalcs';
import { pumpCurveResult, pumpName } from '../../domain/pumpCurves';
import { xlNum } from '../../domain/staticProfile';

export function PumpCurvePick({ equipment }: { equipment: Equipment }) {
  const pumps = useLibraryPumps();
  if (!pumps) return null;
  const d = equipment.data;
  const id = typeof d.pumpCurveId === 'string' ? d.pumpCurveId : '';
  const pump = pumps.find((p) => p.id === id);
  const t = pumpTest(d);
  const r = pump
    ? pumpCurveResult(pump, {
        shutoffHead: t.shutoffHead,
        finalHead: t.finalHead,
        rpm: xlNum(d.actualRpm),
      })
    : null;
  return (
    <div className="valve-pick" data-testid="pump-curve-pick">
      <label className="small" htmlFor={`pc-${equipment.id}`}>
        Pump curve (library)
      </label>
      <select
        id={`pc-${equipment.id}`}
        className="select"
        aria-label="Pump curve"
        value={id}
        onChange={(e) => void setField('equipment', equipment.id, 'data.pumpCurveId', e.target.value || null)}
      >
        <option value="">{pumps.length ? 'None' : 'Library is empty (Menu → Library)'}</option>
        {pumps.map((p) => (
          <option key={p.id} value={p.id}>
            {pumpName(p) || 'Unnamed pump'}
          </option>
        ))}
      </select>
      {r && (
        <div className="valve-flow">
          <span data-testid="pump-curve-result">
            {r.impeller !== null && <b>{formatNumber(r.impeller, 2)}″ impeller</b>}
            {r.gpm !== null && (
              <>
                {' · '}
                <b>{formatNumber(r.gpm, 0)} GPM</b>
              </>
            )}{' '}
            <span className="small muted">({r.note})</span>
          </span>
          {r.impeller !== null && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                void setField('equipment', equipment.id, 'data.actualImpeller', Math.round(r.impeller! * 100) / 100)
              }
            >
              Use impeller
            </button>
          )}
          {r.gpm !== null && (
            <button
              type="button"
              className="btn btn-sm"
              data-testid="pump-curve-use-gpm"
              onClick={() =>
                void setFields('equipment', equipment.id, {
                  'data.actualGpm': Math.round(r.gpm!),
                  'data.flowMethod': 'Pump curve',
                })
              }
            >
              Use as actual GPM
            </button>
          )}
        </div>
      )}
    </div>
  );
}
