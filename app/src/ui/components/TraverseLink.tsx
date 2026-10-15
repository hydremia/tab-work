/**
 * "Traverse of" on a traverse's page: the unit it measures and, optionally, one line of that unit (a ducted return,
 * the OA intake, one outlet); with a line, "Fill the line from this traverse" writes the traverse's size, Ak and
 * velocity into the line so its CFM is the traverse CFM. The unit page lists its traverses (UnitTraverses) and a
 * linked line shows a "⇄ T-1" chip (RowLinks.tsx).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { db } from '../../data/db';
import { setFields } from '../../data/repo';
import type { Equipment } from '../../data/types';
import { formatNumber, rowActualCfm } from '../../domain/calc';
import { traverseTotals } from '../../domain/equipmentCalcs';
import { EQUIPMENT_TYPES } from '../../domain/equipmentTypes';
import { rowNames } from '../../domain/rowLabels';
import { lineFromTraverse, traverseLine, traverseLinks, traverseOf } from '../../domain/traverseLinks';

const typeOrder = (t: string) => EQUIPMENT_TYPES.findIndex((x) => x.key === t);

export function TraverseLinkPanel({ traverse }: { traverse: Equipment }) {
  const units = useLiveQuery(
    () => db.equipment.where('projectId').equals(traverse.projectId).toArray(),
    [traverse.projectId],
  );
  const unitId = traverseOf(traverse);
  const lineId = traverseLine(traverse);
  const rows = useLiveQuery(
    () => (unitId ? db.airflowRows.where('equipmentId').equals(unitId).toArray() : []),
    [unitId],
  );
  if (!units) return null;
  const choices = units
    .filter((u) => u.type !== 'traverse')
    .sort(
      (a, b) =>
        typeOrder(a.type) - typeOrder(b.type) ||
        a.designation.localeCompare(b.designation, undefined, { numeric: true }),
    );
  const unit = units.find((u) => u.id === unitId);
  const lines = unit && rows ? [...rowNames([unit], rows).values()] : [];
  const line = rows?.find((r) => r.id === lineId);
  const t = traverseTotals(traverse.data);
  const fill = lineFromTraverse(traverse);
  const lineCfm = line ? rowActualCfm(line) : null;
  const travCfm = t.finalCfm ?? t.initialCfm;
  const filled =
    line !== undefined &&
    Object.entries(fill).every(([k, v]) => line.data[k] === v || (typeof v === 'number' && line.data[k] === v));

  const doFill = async () => {
    if (!line) return;
    const changes = Object.entries(fill).filter(([k, v]) => line.data[k] !== v);
    const overwrite = changes.filter(
      ([k]) => line.data[k] !== null && line.data[k] !== undefined && line.data[k] !== '',
    );
    if (
      overwrite.length &&
      !window.confirm(
        `Replace the line's ${overwrite.map(([k]) => (k === 'initialVel' ? 'initial VEL' : k === 'finalVel' ? 'final VEL' : k === 'ak' ? 'Ak' : k)).join(', ')} with the traverse's?`,
      )
    )
      return;
    await setFields('airflowRows', line.id, Object.fromEntries(changes.map(([k, v]) => [`data.${k}`, v])));
  };

  return (
    <div className="calc-panel stack" style={{ gap: 10 }} data-testid="calc-traverseLink">
      <div className="field">
        <label className="field-label" htmlFor="tl-unit">
          Unit
        </label>
        <select
          id="tl-unit"
          className="select"
          value={unitId ?? ''}
          onChange={(e) =>
            void setFields('equipment', traverse.id, {
              'data.traverseOf': e.target.value || null,
              'data.traverseLine': null,
            })
          }
          data-testid="traverse-of"
        >
          <option value="">Not linked (a duct of its own)</option>
          {choices.map((u) => (
            <option key={u.id} value={u.id}>
              {u.designation}
            </option>
          ))}
          {unitId && !unit && <option value={unitId}>(unit deleted)</option>}
        </select>
      </div>
      {unit && (
        <div className="field">
          <label className="field-label" htmlFor="tl-line">
            Line
          </label>
          <select
            id="tl-line"
            className="select"
            value={lineId ?? ''}
            onChange={(e) => void setFields('equipment', traverse.id, { 'data.traverseLine': e.target.value || null })}
            data-testid="traverse-line"
          >
            <option value="">Whole unit ({unit.designation})</option>
            {lines.map((l) => (
              <option key={l.rowId} value={l.rowId}>
                {l.long}
              </option>
            ))}
            {lineId && !line && rows && <option value={lineId}>(line deleted)</option>}
          </select>
          <span className="small muted">
            One line read by traverse: a ducted return, the OA intake, a single outlet or grille.
          </span>
        </div>
      )}
      {unit && (
        <p className="small" style={{ margin: 0 }}>
          <Link to={`/p/${unit.projectId}/e/${unit.id}`}>Open {unit.designation}</Link>
          {line && (
            <>
              {' '}
              · line CFM <b>{formatNumber(lineCfm)}</b> · traverse CFM <b>{formatNumber(travCfm)}</b>
            </>
          )}
        </p>
      )}
      {line && Object.keys(fill).length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn"
            disabled={filled}
            onClick={() => void doFill()}
            data-testid="traverse-fill-line"
          >
            {filled ? 'Line filled from this traverse' : 'Fill the line from this traverse'}
          </button>
          <span className="small muted">Size, Ak and velocity, so the line's CFM is the traverse CFM.</span>
        </div>
      )}
    </div>
  );
}

/** The unit page's list of its traverses (nothing when none). */
export function UnitTraverses({ equipment }: { equipment: Equipment }) {
  const traverses = useLiveQuery(async () => {
    const all = await db.equipment.where('projectId').equals(equipment.projectId).toArray();
    return traverseLinks(all).byUnit.get(equipment.id) ?? [];
  }, [equipment.projectId, equipment.id]);
  const rows = useLiveQuery(() => db.airflowRows.where('equipmentId').equals(equipment.id).toArray(), [equipment.id]);
  if (!traverses?.length) return null;
  const names = rowNames([equipment], rows ?? []);
  return (
    <section className="card card-pad stack" style={{ gap: 6 }} data-testid="unit-traverses">
      <h2 style={{ fontSize: '1rem' }}>Traverses</h2>
      {traverses.map((t) => {
        const r = traverseTotals(t.data);
        const line = traverseLine(t);
        return (
          <p key={t.id} className="small" style={{ margin: 0 }}>
            <Link to={`/p/${t.projectId}/e/${t.id}`}>{t.designation}</Link>
            {' · '}
            {line ? (names.get(line)?.long ?? 'line deleted') : 'whole unit'}
            {' · '}
            <b>{formatNumber(r.finalCfm ?? r.initialCfm)}</b> CFM
            {r.design ? ` of ${formatNumber(r.design)} design` : ''}
          </p>
        );
      })}
    </section>
  );
}
