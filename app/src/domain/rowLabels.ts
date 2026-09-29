/**
 * Names of airflow lines (outlets, grilles, valve rows …) for issues and photos linked to one (0011):
 *   short  a valve's tag ("CBV-1"), else the row's No. ("S-12"; a bare number with its table: "Supply outlets #12"),
 *          else the table and its position ("Supply outlets #3")
 *   long   the short name with the area served: "Supply outlets #12 (Conf. Rm 101)"
 * The short name is what the workbook's Summary remark carries after the unit ("RTU-1 · Supply outlets #12: …") and a
 * re-import matches back to the line.
 */
import type { AirflowRow, Equipment } from '../data/types';
import { getSpec } from './specs';

export interface RowName {
  rowId: string;
  equipmentId: string;
  short: string;
  long: string;
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** Every line of the given units, in table then row order. */
export function rowNames(
  equipment: readonly Pick<Equipment, 'id' | 'type'>[],
  rows: readonly AirflowRow[],
): Map<string, RowName> {
  const out = new Map<string, RowName>();
  for (const e of equipment) {
    const unitRows = rows.filter((r) => r.equipmentId === e.id);
    if (!unitRows.length) continue;
    for (const t of getSpec(e.type).sections.flatMap((s) => s.tables ?? [])) {
      unitRows
        .filter((r) => r.table === t.key)
        .sort((a, b) => a.order - b.order)
        .forEach((r, i) => {
          const tag = text(r.data.tag);
          const no = text(r.data.no);
          // "S-12" names the line itself; a bare number needs its table: "Supply outlets #12"
          const short = tag || (no && !/^\d+$/.test(no) ? no : `${t.label} #${no || i + 1}`);
          const area = text(r.data.area);
          out.set(r.id, { rowId: r.id, equipmentId: e.id, short, long: area ? `${short} (${area})` : short });
        });
    }
  }
  return out;
}

/** The line a short name names within one unit (case-insensitive), for re-import. */
export function findRow(names: ReadonlyMap<string, RowName>, equipmentId: string, short: string): string | null {
  const want = short.trim().toLowerCase();
  for (const n of names.values()) if (n.equipmentId === equipmentId && n.short.toLowerCase() === want) return n.rowId;
  return null;
}
