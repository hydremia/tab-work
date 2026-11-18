/**
 * Plan sheets (Dexie v11 `planSheets`, server `plan_sheets`, 0016): the drawings read for a project and the systems
 * lassoed on them. Project records like photos: created, edited (devices / systems as whole fields) and deleted
 * through the repository, so the changes sync; the drawing file goes through the plans bucket (sync/planSync.ts)
 * and arrives on other devices after the record. The airflow rows a system writes are ordinary records
 * (addAirflowRow, source 'plan').
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { getSpec } from '../domain/specs';
import { rowsForDevices, systemRowNo, type PlanRowData } from '../domain/planSystems';
import type { MarkupSystem } from '../domain/markupImport';
import { queuePlanDelete, queuePlanUpload } from '../sync/planSync';
import { db } from './db';
import { addAirflowRow, createRecord, deleteRecord, setField } from './repo';
import type { Equipment, PlanSheet, PlanSheetDevice, PlanSystem } from './types';
import { uuid } from './uuid';

export function usePlanSheets(projectId: string | undefined): PlanSheet[] | undefined {
  return useLiveQuery(
    async (): Promise<PlanSheet[]> =>
      projectId ? db.planSheets.where('projectId').equals(projectId).sortBy('createdAt') : [],
    [projectId],
  );
}

export function usePlanSheet(id: string | undefined): PlanSheet | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.planSheets.get(id)) ?? null) : null), [id]);
}

export async function savePlanSheet(
  sheet: Omit<PlanSheet, 'id' | 'createdAt' | 'updatedAt' | 'systems' | 'storagePath'>,
): Promise<PlanSheet> {
  const now = Date.now();
  const rec: PlanSheet = { ...sheet, id: uuid(), systems: [], storagePath: null, createdAt: now, updatedAt: now };
  await createRecord('planSheets', rec);
  await queuePlanUpload(rec.id, rec.projectId, now);
  return rec;
}

export async function deletePlanSheet(id: string): Promise<void> {
  const sheet = await db.planSheets.get(id);
  if (!sheet) return;
  await deleteRecord('planSheets', id);
  await queuePlanDelete(id, sheet.projectId, Boolean(sheet.storagePath));
}

/** The sheet's devices or systems replaced (one synced field each). */
export async function updatePlanSheet(
  id: string,
  patch: Partial<Pick<PlanSheet, 'devices' | 'systems'>>,
): Promise<void> {
  if (patch.devices) await setField('planSheets', id, 'devices', patch.devices);
  if (patch.systems) await setField('planSheets', id, 'systems', patch.systems);
}

/** Change a device's reading (text recognition slips, a tag the plan reader mis-split). */
export async function updatePlanDevice(
  sheetId: string,
  key: string,
  patch: Partial<Pick<PlanSheet['devices'][number], 'type' | 'size' | 'cfm' | 'x' | 'y'>>,
): Promise<void> {
  const sheet = await db.planSheets.get(sheetId);
  if (!sheet) return;
  await updatePlanSheet(sheetId, { devices: sheet.devices.map((d) => (d.key === key ? { ...d, ...patch } : d)) });
}

export async function addPlanSystem(
  sheetId: string,
  system: Omit<PlanSystem, 'id' | 'createdAt' | 'rowIds'>,
): Promise<PlanSystem> {
  const sheet = await db.planSheets.get(sheetId);
  if (!sheet) throw new Error('sheet not found');
  const rec: PlanSystem = { ...system, id: uuid(), rowIds: {}, createdAt: Date.now() };
  await updatePlanSheet(sheetId, { systems: [...sheet.systems, rec] });
  return rec;
}

export async function updatePlanSystem(
  sheetId: string,
  systemId: string,
  patch: Partial<Omit<PlanSystem, 'id' | 'createdAt'>>,
): Promise<void> {
  const sheet = await db.planSheets.get(sheetId);
  if (!sheet) return;
  await updatePlanSheet(sheetId, { systems: sheet.systems.map((s) => (s.id === systemId ? { ...s, ...patch } : s)) });
}

/** Remove a system from the sheet (the rows it wrote stay with the unit). */
export async function removePlanSystem(sheetId: string, systemId: string): Promise<void> {
  const sheet = await db.planSheets.get(sheetId);
  if (!sheet) return;
  await updatePlanSheet(sheetId, { systems: sheet.systems.filter((s) => s.id !== systemId) });
}

/** The unit's area served, for the rows. */
const areaOf = (unit: Equipment): string | null => {
  const a = unit.data.areaServed;
  return typeof a === 'string' && a.trim() ? a.trim() : null;
};

/**
 * Write a system's devices into its unit's airflow table: one row per device in letter order (No., area served, type,
 * size, design CFM; source 'plan'). Rows written before are updated in place (their No. and design follow the
 * system); devices added since get new rows. Returns the rows written.
 */
export async function applyPlanSystem(
  sheetId: string,
  systemId: string,
): Promise<{ created: number; updated: number; rows: PlanRowData[] }> {
  const sheet = await db.planSheets.get(sheetId);
  const system = sheet?.systems.find((s) => s.id === systemId);
  if (!sheet || !system) throw new Error('system not found');
  const unit = await db.equipment.get(system.equipmentId);
  if (!unit) throw new Error('the unit no longer exists');
  const table = getSpec(unit.type)
    .sections.flatMap((s) => s.tables ?? [])
    .find((t) => t.key === system.table);
  if (!table) throw new Error(`${unit.designation} has no ${system.table} table`);
  const byKey = new Map(sheet.devices.map((d) => [d.key, d]));
  const devices = system.deviceKeys.map((k) => byKey.get(k)).filter((d): d is NonNullable<typeof d> => Boolean(d));
  const rows = rowsForDevices(
    devices,
    areaOf(unit),
    system.deviceKeys.map((_, i) => systemRowNo(system, i)).filter((_, i) => Boolean(byKey.get(system.deviceKeys[i]))),
  );
  const rowIds = { ...system.rowIds };
  let created = 0;
  let updated = 0;
  const existing = new Set((await db.airflowRows.where('equipmentId').equals(unit.id).toArray()).map((r) => r.id));
  for (let i = 0; i < devices.length; i++) {
    const d = devices[i];
    const r = rows[i];
    const data: Record<string, string | number | null> = {
      no: r.no,
      ...(r.area ? { area: r.area } : {}),
      type: r.type,
      ...(r.size ? { size: r.size } : {}),
      ...(r.designCfm !== null ? { designCfm: r.designCfm } : {}),
    };
    const rowId = rowIds[d.key];
    if (rowId && existing.has(rowId)) {
      for (const [k, v] of Object.entries(data))
        await setField('airflowRows', rowId, `data.${k}`, v, { source: 'plan' });
      updated++;
    } else {
      const row = await addAirflowRow(unit, system.table, data, { source: 'plan' });
      rowIds[d.key] = row.id;
      created++;
    }
  }
  await updatePlanSystem(sheetId, systemId, { rowIds });
  return { created, updated, rows };
}

/**
 * Systems from a tech's markup (domain/markupImport.ts), each with its unit chosen: a label without a plan device gets a
 * placeholder device at the label (type and CFM to fill in), the system keeps the labels as written, and the rows are
 * written at once. Systems without a unit are skipped.
 */
export async function importMarkupSystems(
  sheetId: string,
  systems: readonly (MarkupSystem & { unit: Equipment | null })[],
): Promise<{ systems: number; rows: number; placeholders: number }> {
  const sheet = await db.planSheets.get(sheetId);
  if (!sheet) throw new Error('sheet not found');
  let placeholders = 0;
  const added: PlanSheetDevice[] = [];
  const made: { system: Omit<PlanSystem, 'id' | 'createdAt' | 'rowIds'> }[] = [];
  for (const m of systems) {
    if (!m.unit) continue;
    const keys: string[] = [];
    const labels: string[] = [];
    m.items.forEach((it, i) => {
      let key = it.device?.key;
      if (!key) {
        key = `m-${m.prefix}-${it.label.letter}-${i}`;
        added.push({
          key,
          tag: {
            x: it.x,
            y: it.y,
            box: { x0: it.x - 6, y0: it.y - 6, x1: it.x + 6, y1: it.y + 6 },
            lines: [it.label.text],
          },
          type: '',
          size: null,
          cfm: null,
          x: it.x,
          y: it.y,
          how: 'tag',
          count: 1,
          index: 0,
        });
        placeholders++;
      }
      keys.push(key);
      labels.push(it.label.text.toUpperCase().replace(/\s+/g, ''));
    });
    made.push({
      system: {
        equipmentId: m.unit.id,
        table: m.table,
        polygon: m.polygon,
        deviceKeys: keys,
        color: m.color,
        prefix: m.prefix,
        labels,
      },
    });
  }
  if (added.length) await updatePlanSheet(sheetId, { devices: [...sheet.devices, ...added] });
  let rows = 0;
  for (const { system } of made) {
    const rec = await addPlanSystem(sheetId, system);
    const r = await applyPlanSystem(sheetId, rec.id);
    rows += r.created + r.updated;
  }
  return { systems: made.length, rows, placeholders };
}
