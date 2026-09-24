/**
 * Import a workbook into the app: parse -> ProjectBundle -> create a new project, or update an existing one.
 * Every write goes through the repository, so imported data lands in the sync outbox like any other edit.
 * (The field-by-field diff / merge review of a re-imported issued workbook is Phase 3.)
 */
import { importWorkbookWithReport } from '@a2b/workbook';
import { db } from '../data/db';
import { createRecord, deleteRecord, setField } from '../data/repo';
import { fromProjectData, type ProjectBundle } from './adapter';

export interface ParsedImport {
  bundle: ProjectBundle;
  warnings: string[];
  fileName: string;
}

export async function parseWorkbook(bytes: Uint8Array, fileName: string): Promise<ParsedImport> {
  const { project, report } = await importWorkbookWithReport(bytes);
  const fallbackName = fileName.replace(/\.(xlsm|xlsx)$/i, '');
  return { bundle: fromProjectData(project, { fallbackName }), warnings: report.warnings, fileName };
}

export async function saveAsNewProject(b: ProjectBundle): Promise<string> {
  await db.transaction(
    'rw',
    [db.projects, db.equipment, db.airflowRows, db.issues, db.instruments, db.fieldChanges, db.meta],
    async () => {
      await createRecord('projects', b.project);
      for (const e of b.equipment) await createRecord('equipment', e);
      for (const r of b.rows) await createRecord('airflowRows', r);
      for (const i of b.issues) await createRecord('issues', i);
      for (const i of b.instruments) await createRecord('instruments', i);
    },
  );
  return b.project.id;
}

export interface UpdateSummary {
  fieldsChanged: number;
  equipmentAdded: number;
  issuesAdded: number;
}

/**
 * Update an existing project from an imported bundle: project info and unit fields are set field by field
 * (only changed values), units are matched by type + slot, airflow rows and instruments are replaced,
 * issues are matched by New/Existing + number.
 */
export async function updateProjectFromImport(projectId: string, b: ProjectBundle): Promise<UpdateSummary> {
  const s: UpdateSummary = { fieldsChanged: 0, equipmentAdded: 0, issuesAdded: 0 };
  const tables = [
    db.projects,
    db.equipment,
    db.airflowRows,
    db.issues,
    db.instruments,
    db.photos,
    db.fieldChanges,
    db.meta,
  ];
  await db.transaction('rw', tables, async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('Project not found');
    const set = async (
      table: Parameters<typeof setField>[0],
      id: string,
      field: string,
      before: unknown,
      after: unknown,
    ) => {
      if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return;
      await setField(table, id, field, after ?? null);
      s.fieldsChanged++;
    };
    await set('projects', projectId, 'name', project.name, b.project.name);
    for (const [k, v] of Object.entries(b.project.info))
      await set('projects', projectId, `info.${k}`, project.info[k], v);
    for (const [k, v] of Object.entries(b.project.naState.fields))
      await set('projects', projectId, `naState.fields.${k}`, project.naState.fields[k], v);
    await set('projects', projectId, 'blueprints', project.blueprints, b.project.blueprints);
    await set('projects', projectId, 'tolerance', project.tolerance, b.project.tolerance);

    const existing = await db.equipment.where('projectId').equals(projectId).toArray();
    for (const e of b.equipment) {
      const match = existing.find((x) => x.type === e.type && x.slot === e.slot);
      let targetId: string;
      if (!match) {
        await createRecord('equipment', { ...e, projectId });
        targetId = e.id;
        s.equipmentAdded++;
      } else {
        targetId = match.id;
        await set('equipment', match.id, 'designation', match.designation, e.designation);
        for (const [k, v] of Object.entries(e.data)) await set('equipment', match.id, `data.${k}`, match.data[k], v);
        for (const [k, v] of Object.entries(e.naState.fields))
          await set('equipment', match.id, `naState.fields.${k}`, match.naState.fields[k], v);
        for (const r of await db.airflowRows.where('equipmentId').equals(match.id).toArray())
          await deleteRecord('airflowRows', r.id);
      }
      for (const r of b.rows.filter((x) => x.equipmentId === e.id)) {
        await createRecord('airflowRows', { ...r, projectId, equipmentId: targetId });
      }
    }

    const issues = await db.issues.where('projectId').equals(projectId).toArray();
    const eqIdMap = new Map<string, string>();
    for (const e of b.equipment) {
      const match = existing.find((x) => x.type === e.type && x.slot === e.slot);
      eqIdMap.set(e.id, match ? match.id : e.id);
    }
    for (const i of b.issues) {
      const equipmentId = i.equipmentId ? (eqIdMap.get(i.equipmentId) ?? null) : null;
      const match = issues.find((x) => x.kind === i.kind && x.number === i.number);
      if (!match) {
        await createRecord('issues', { ...i, projectId, equipmentId });
        s.issuesAdded++;
      } else {
        await set('issues', match.id, 'remark', match.remark, i.remark);
        await set('issues', match.id, 'status', match.status, i.status);
        await set('issues', match.id, 'comments', match.comments, i.comments);
        await set('issues', match.id, 'equipmentId', match.equipmentId, equipmentId);
      }
    }

    if (b.instruments.length) {
      for (const i of await db.instruments.where('projectId').equals(projectId).toArray())
        await deleteRecord('instruments', i.id);
      for (const i of b.instruments) await createRecord('instruments', { ...i, projectId });
    }
  });
  return s;
}
