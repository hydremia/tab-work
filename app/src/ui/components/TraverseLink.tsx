/**
 * "Traverse of" on a traverse's page: the unit it measures and, optionally, one line of that unit (a ducted return,
 * the OA intake, one outlet). A linked line follows the traverse: useTraverseLineSync (mounted for the open project)
 * keeps its size, Ak and velocities equal to the traverse's, so its CFM is the traverse CFM; the line shows them
 * read-only. The unit page lists its traverses (UnitTraverses) and a linked line shows a "⇄ T-1" chip (RowLinks.tsx).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { db } from '../../data/db';
import { setFields } from '../../data/repo';
import type { Equipment } from '../../data/types';
import { formatNumber, rowActualCfm } from '../../domain/calc';
import { traverseTotals } from '../../domain/equipmentCalcs';
import { EQUIPMENT_TYPES } from '../../domain/equipmentTypes';
import { rowNames } from '../../domain/rowLabels';
import { lineSync, traverseLine, traverseLinks, traverseOf } from '../../domain/traverseLinks';

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
  const lineCfm = line ? rowActualCfm(line) : null;
  const travCfm = t.finalCfm ?? t.initialCfm;

  /** Link a line: its own size / Ak / readings are replaced by the traverse's (asked when it has some). */
  const pickLine = async (rowId: string) => {
    const row = rows?.find((r) => r.id === rowId);
    const changes = row ? lineSync(traverse, row) : {};
    const replaced = Object.keys(changes).filter((k) => {
      const v = row?.data[k.slice(5)];
      return v !== null && v !== undefined && v !== '';
    });
    if (
      replaced.length &&
      !window.confirm(
        `${lines.find((l) => l.rowId === rowId)?.long ?? 'This line'} has its own size / Ak / readings. Linked, it follows ${traverse.designation}: replace them with the traverse's?`,
      )
    )
      return;
    await setFields('equipment', traverse.id, { 'data.traverseLine': rowId || null });
    if (row && Object.keys(changes).length) await setFields('airflowRows', row.id, changes);
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
            onChange={(e) => void pickLine(e.target.value)}
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
      {line && (
        <p className="small muted" style={{ margin: 0 }} data-testid="traverse-line-follows">
          The line's size, Ak and velocities follow this traverse
          {t.finalVel === null && typeof traverse.data.initialVel !== 'number'
            ? ' once it has a reading.'
            : ', so its CFM is the traverse CFM.'}
        </p>
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

/**
 * Keeps every linked line of the project in step with its traverse (lineSync), whichever device changed the traverse:
 * runs while the project is open. A locked (issued) project is left as it is.
 */
export function useTraverseLineSync(projectId: string | undefined, locked: boolean): void {
  const pending = useLiveQuery(async () => {
    if (!projectId || locked) return [];
    const traverses = (await db.equipment.where('projectId').equals(projectId).toArray()).filter(
      (e) => e.type === 'traverse' && traverseOf(e) && traverseLine(e),
    );
    const out: { rowId: string; changes: Record<string, number | string | null> }[] = [];
    for (const t of traverses) {
      const row = await db.airflowRows.get(traverseLine(t)!);
      if (!row || row.equipmentId !== traverseOf(t)) continue;
      const changes = lineSync(t, row);
      if (Object.keys(changes).length) out.push({ rowId: row.id, changes });
    }
    return out;
  }, [projectId, locked]);
  useEffect(() => {
    for (const p of pending ?? [])
      void setFields('airflowRows', p.rowId, p.changes).catch((e) => console.warn('traverse line sync:', e));
  }, [pending]);
}
