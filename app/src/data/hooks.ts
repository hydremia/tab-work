/** Live (reactive) queries over IndexedDB for the UI. */
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { needsAttention, type AttentionItem } from '../domain/attention';
import {
  computeCompletion,
  displayColor,
  rollup,
  type Completion,
  type DisplayColor,
  type Rollup,
} from '../domain/completion';
import { computeProjectCompletion, type ProjectCompletion } from '../domain/projectCompletion';
import { dashboardRow, type DashboardRow } from '../domain/dashboard';
import { EQUIPMENT_TYPES, type EquipmentTypeKey } from '../domain/equipmentTypes';
import { getSpec } from '../domain/specs';
import { db } from './db';
import { exportStatus, type ExportStatus } from './exportStatus';
import { projectHistory } from './history';
import type {
  AirflowRow,
  BaseWorkbook,
  CertProfile,
  LibraryValve,
  LibraryPump,
  Equipment,
  HistoryEntry,
  Instrument,
  Issue,
  Photo,
  Project,
  Revision,
  SyncConflict,
} from './types';
import { hoodLinks } from '../domain/equipmentCalcs';
import { openDeficiencies } from '../domain/issues';

export function useProjects(): Project[] | undefined {
  return useLiveQuery(() => db.projects.orderBy('updatedAt').reverse().toArray(), []);
}

/** undefined while loading, null when missing. */
export function useProject(id: string | undefined): Project | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.projects.get(id)) ?? null) : null), [id]);
}

export function useEquipmentList(projectId: string | undefined): Equipment[] | undefined {
  return useLiveQuery(
    async () => (projectId ? db.equipment.where('projectId').equals(projectId).toArray() : []),
    [projectId],
  );
}

export function useEquipment(id: string | undefined): Equipment | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.equipment.get(id)) ?? null) : null), [id]);
}

export function useAirflowRows(equipmentId: string | undefined): AirflowRow[] | undefined {
  return useLiveQuery(
    async () =>
      equipmentId
        ? (await db.airflowRows.where('equipmentId').equals(equipmentId).toArray()).sort((a, b) => a.order - b.order)
        : [],
    [equipmentId],
  );
}

export function useIssues(projectId: string | undefined): Issue[] | undefined {
  return useLiveQuery(
    async () =>
      projectId
        ? (await db.issues.where('projectId').equals(projectId).toArray()).sort((a, b) => a.number - b.number)
        : [],
    [projectId],
  );
}

export function usePhotos(projectId: string | undefined, equipmentId?: string | null): Photo[] | undefined {
  return useLiveQuery(async () => {
    if (!projectId) return [];
    const all = await db.photos.where('projectId').equals(projectId).toArray();
    return equipmentId === undefined ? all : all.filter((p) => p.equipmentId === equipmentId);
  }, [projectId, equipmentId]);
}

export function useInstruments(projectId: string | undefined): Instrument[] | undefined {
  return useLiveQuery(
    async () =>
      projectId
        ? (await db.instruments.where('projectId').equals(projectId).toArray()).sort((a, b) => a.order - b.order)
        : [],
    [projectId],
  );
}

export interface ProjectStatus {
  byEquipment: Map<string, Completion>;
  /** What the cards show: the completion color, or blue for a green unit that was reviewed. */
  display: Map<string, DisplayColor>;
  byType: Map<EquipmentTypeKey, Rollup>;
  total: Rollup;
}

interface StatusInputs {
  project: Project;
  equipment: Equipment[];
  rows: AirflowRow[];
  photos: Pick<Photo, 'equipmentId' | 'category'>[];
  issues: Issue[];
}

export function projectStatus({ project, equipment, rows, photos, issues }: StatusInputs): ProjectStatus {
  const byEquipment = new Map<string, Completion>();
  const display = new Map<string, DisplayColor>();
  const linked = hoodLinks(equipment);
  for (const e of equipment) {
    byEquipment.set(
      e.id,
      computeCompletion({
        spec: getSpec(e.type),
        unit: e,
        rows: rows.filter((r) => r.equipmentId === e.id),
        photos: photos.filter((p) => p.equipmentId === e.id),
        project,
        openIssues: openDeficiencies(issues.filter((i) => i.equipmentId === e.id)).length,
        hoodLinked: linked.has(e.id),
      }),
    );
    const c = byEquipment.get(e.id)!;
    display.set(e.id, displayColor(c.color, Boolean(e.review), c.complete));
  }
  const roll = (list: readonly Equipment[]) =>
    rollup(
      list.map((e) => display.get(e.id)!),
      list.map((e) => byEquipment.get(e.id)!.complete),
    );
  const byType = new Map<EquipmentTypeKey, Rollup>();
  for (const t of EQUIPMENT_TYPES) {
    const list = equipment.filter((e) => e.type === t.key);
    if (list.length) byType.set(t.key, roll(list));
  }
  return { byEquipment, display, byType, total: roll(equipment) };
}

async function loadStatusInputs(projectIds: string[]) {
  const [projects, equipment, rows, photos, issues] = await Promise.all([
    db.projects.bulkGet(projectIds),
    db.equipment.where('projectId').anyOf(projectIds).toArray(),
    db.airflowRows.where('projectId').anyOf(projectIds).toArray(),
    // metadata only: completion needs categories, not the image blobs
    db.photos
      .where('projectId')
      .anyOf(projectIds)
      .toArray()
      .then((ps) => ps.map(({ projectId, equipmentId, category }) => ({ projectId, equipmentId, category }))),
    db.issues.where('projectId').anyOf(projectIds).toArray(),
  ]);
  return { projects, equipment, rows, photos, issues };
}

/** Completion colors for every unit of a project (live). */
export function useProjectStatus(projectId: string | undefined): ProjectStatus | undefined {
  const data = useLiveQuery(async () => (projectId ? loadStatusInputs([projectId]) : undefined), [projectId]);
  return useMemo(() => {
    const project = data?.projects[0];
    if (!data || !project) return undefined;
    return projectStatus({
      project,
      equipment: data.equipment,
      rows: data.rows,
      photos: data.photos,
      issues: data.issues,
    });
  }, [data]);
}

/** Needs-attention items of a project (live), reusing the unit completions of the project status when given. */
export function useAttention(projectId: string | undefined, status?: ProjectStatus): AttentionItem[] | undefined {
  const data = useLiveQuery(async () => {
    if (!projectId) return undefined;
    const inputs = await loadStatusInputs([projectId]);
    const instruments = await db.instruments.where('projectId').equals(projectId).toArray();
    return { ...inputs, instruments };
  }, [projectId]);
  return useMemo(() => {
    const project = data?.projects[0];
    if (!data || !project) return undefined;
    return needsAttention({
      project,
      equipment: data.equipment,
      rows: data.rows,
      photos: data.photos,
      issues: data.issues,
      instruments: data.instruments,
      completions: status?.byEquipment,
    });
  }, [data, status]);
}

/** Project-level completion (Project Information, cover, calibration, building pressures), live. */
export function useProjectCompletion(project: Project | null | undefined): ProjectCompletion | undefined {
  const data = useLiveQuery(async () => {
    if (!project) return undefined;
    const [hoods, cover, instruments] = await Promise.all([
      db.equipment.where('[projectId+type]').equals([project.id, 'hood']).count(),
      db.photos.where('[projectId+category]').equals([project.id, 'cover']).count(),
      db.instruments.where('projectId').equals(project.id).toArray(),
    ]);
    return { hoods, cover, instruments };
  }, [project?.id]);
  return useMemo(
    () =>
      project && data
        ? computeProjectCompletion({
            project,
            hasHoods: data.hoods > 0,
            hasCover: data.cover > 0,
            instruments: data.instruments,
          })
        : undefined,
    [project, data],
  );
}

/** Rollups for the project list. */
export function useAllProjectRollups(): Map<string, Rollup> | undefined {
  const data = useLiveQuery(
    async () => loadStatusInputs((await db.projects.toCollection().primaryKeys()) as string[]),
    [],
  );
  return useMemo(() => {
    if (!data) return undefined;
    const out = new Map<string, Rollup>();
    for (const project of data.projects) {
      if (!project) continue;
      const pick = <T extends { projectId: string }>(xs: T[]) => xs.filter((x) => x.projectId === project.id);
      out.set(
        project.id,
        projectStatus({
          project,
          equipment: pick(data.equipment),
          rows: pick(data.rows),
          photos: pick(data.photos),
          issues: pick(data.issues),
        }).total,
      );
    }
    return out;
  }, [data]);
}

/** Last export and the changes since (export reminder). */
export function useExportStatus(projectId: string | undefined): ExportStatus | undefined {
  return useLiveQuery(
    async () => (projectId ? exportStatus(projectId) : { lastExportAt: null, lastLabel: null, changesSince: 0 }),
    [projectId],
  );
}

/** Export status of every project (project list). */
export function useAllExportStatus(): Map<string, ExportStatus> | undefined {
  return useLiveQuery(async () => {
    const ids = (await db.projects.toCollection().primaryKeys()) as string[];
    const out = new Map<string, ExportStatus>();
    for (const id of ids) out.set(id, await exportStatus(id));
    return out;
  }, []);
}

/** Revision history of a project, newest first. */
export function useRevisions(projectId: string | undefined): Revision[] | undefined {
  return useLiveQuery(
    async () =>
      projectId
        ? (await db.revisions.where('projectId').equals(projectId).toArray()).sort((a, b) => b.createdAt - a.createdAt)
        : [],
    [projectId],
  );
}

/** The base workbook of the next export (null: the blank template). */
export function useBaseWorkbook(projectId: string | undefined): BaseWorkbook | null | undefined {
  return useLiveQuery(async () => (projectId ? ((await db.baseWorkbooks.get(projectId)) ?? null) : null), [projectId]);
}

/** Photo metadata of a project (no blobs): what the completion colors need. */
export function usePhotoMeta(projectId: string | undefined): Pick<Photo, 'equipmentId' | 'category'>[] | undefined {
  return useLiveQuery(
    async () =>
      projectId
        ? (await db.photos.where('projectId').equals(projectId).toArray()).map(({ equipmentId, category }) => ({
            equipmentId,
            category,
          }))
        : [],
    [projectId],
  );
}

/** Photos of a project on this device: count, bytes (images + thumbnails) and files waiting for upload. */
export function usePhotoStats(
  projectId: string | undefined,
): { count: number; bytes: number; pendingUploads: number } | undefined {
  return useLiveQuery(async () => {
    if (!projectId) return { count: 0, bytes: 0, pendingUploads: 0 };
    let count = 0;
    let bytes = 0;
    await db.photos
      .where('projectId')
      .equals(projectId)
      .each((p) => {
        count++;
        bytes += (p.blob?.size ?? 0) + (p.thumb?.size ?? 0);
      });
    const pendingUploads = await db.photoUploads
      .where('projectId')
      .equals(projectId)
      .filter((u) => u.status !== 'done' && u.status !== 'delete')
      .count();
    return { count, bytes, pendingUploads };
  }, [projectId]);
}

/** One photo (live); undefined while loading, null when missing. */
export function usePhoto(id: string | null | undefined): Photo | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.photos.get(id)) ?? null) : null), [id]);
}

/** Change history of a project, newest first (optionally one unit: its fields, rows, photos, linked issues). */
export function useHistory(projectId: string | undefined, equipmentId?: string): HistoryEntry[] | undefined {
  return useLiveQuery(async () => {
    if (!projectId) return [];
    if (equipmentId) {
      const list = await db.history.where('equipmentId').equals(equipmentId).toArray();
      return list.sort((a, b) => b.ts - a.ts);
    }
    return projectHistory(projectId);
  }, [projectId, equipmentId]);
}

/** The reviewer / issuer name remembered on this device ('' until given). */
export function useUserName(): string | undefined {
  return useLiveQuery(async () => {
    const row = await db.meta.get('userName');
    return typeof row?.value === 'string' ? row.value : '';
  }, []);
}

/** Open sync conflicts of a project (newest first). */
/**
 * Open sync conflicts of the shared calibration library (filed under the instrument's own id, so no project's
 * useConflicts has them). `libIds`: only these library instruments (e.g. the ones a project's rows came from).
 */
export function useLibraryConflicts(libIds?: readonly string[]): SyncConflict[] | undefined {
  const key = libIds ? libIds.join(',') : '*';
  return useLiveQuery(async () => {
    const ids = libIds ? new Set(libIds) : null;
    const list = await db.conflicts
      .where('status')
      .equals('open')
      .filter((c) => c.table === 'libraryInstruments' && (!ids || (c.recordId !== null && ids.has(c.recordId))))
      .toArray();
    return list.sort((a, b) => b.detectedAt - a.detectedAt);
  }, [key]);
}

/** The shared valve library, by make / model / size. */
export function useLibraryValves(): LibraryValve[] | undefined {
  return useLiveQuery(async () =>
    (await db.libraryValves.toArray()).sort(
      (a, b) =>
        a.make.localeCompare(b.make) ||
        a.model.localeCompare(b.model) ||
        a.size.localeCompare(b.size, undefined, { numeric: true }),
    ),
  );
}

/** The shared pump-curve library, by make / model / size. */
export function useLibraryPumps(): LibraryPump[] | undefined {
  return useLiveQuery(async () =>
    (await db.libraryPumps.toArray()).sort(
      (a, b) =>
        a.make.localeCompare(b.make) ||
        a.model.localeCompare(b.model) ||
        a.size.localeCompare(b.size, undefined, { numeric: true }),
    ),
  );
}

/** The organization's certification profile (undefined while loading, null when there is none yet). */
export function useCertProfile(): CertProfile | null | undefined {
  return useLiveQuery(
    async () =>
      (await db.certProfiles.toArray()).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))[0] ?? null,
    [],
  );
}

/** Open sync conflicts of the certification profile(s). */
export function useCertProfileConflicts(): SyncConflict[] | undefined {
  return useLiveQuery(
    () =>
      db.conflicts
        .where('status')
        .equals('open')
        .filter((c) => c.table === 'certProfiles')
        .toArray(),
    [],
  );
}

/** The library instruments a project's calibration rows came from. */
export function useProjectLibraryIds(projectId: string | undefined): string[] | undefined {
  return useLiveQuery(async () => {
    if (!projectId) return [];
    const rows = await db.instruments.where('projectId').equals(projectId).toArray();
    return [...new Set(rows.map((r) => r.libraryId).filter((x): x is string => Boolean(x)))].sort();
  }, [projectId]);
}

export function useConflicts(projectId: string | undefined): SyncConflict[] | undefined {
  return useLiveQuery(async () => {
    if (!projectId) return [];
    const list = await db.conflicts.where('[projectId+status]').equals([projectId, 'open']).toArray();
    return list.sort((a, b) => b.detectedAt - a.detectedAt);
  }, [projectId]);
}

/** PM dashboard: one row per project on this device (domain/dashboard.ts), live. */
export function useDashboard(): DashboardRow[] | undefined {
  const data = useLiveQuery(async () => {
    const ids = (await db.projects.toCollection().primaryKeys()) as string[];
    const [inputs, instruments, conflicts, pending] = await Promise.all([
      loadStatusInputs(ids),
      db.instruments.where('projectId').anyOf(ids).toArray(),
      db.conflicts.where('status').equals('open').toArray(),
      db.fieldChanges.where('synced').anyOf(0, 2).toArray(),
    ]);
    const exports = new Map<string, ExportStatus>();
    const activity = new Map<string, number | null>();
    for (const id of ids) {
      exports.set(id, await exportStatus(id));
      const last = await db.history.where('[projectId+ts]').between([id, -Infinity], [id, Infinity]).last();
      activity.set(id, last?.ts ?? null);
    }
    return { ...inputs, instruments, conflicts, pending, exports, activity };
  }, []);
  return useMemo(() => {
    if (!data) return undefined;
    const out: DashboardRow[] = [];
    for (const project of data.projects) {
      if (!project) continue;
      const pick = <T extends { projectId: string }>(xs: T[]) => xs.filter((x) => x.projectId === project.id);
      const inputs = {
        project,
        equipment: pick(data.equipment),
        rows: pick(data.rows),
        photos: pick(data.photos),
        issues: pick(data.issues),
      };
      const status = projectStatus(inputs);
      const open = openDeficiencies(inputs.issues);
      const ex = data.exports.get(project.id)!;
      out.push(
        dashboardRow({
          project,
          total: status.total,
          byType: status.byType,
          openIssues: {
            new: open.filter((i) => i.kind !== 'existing').length,
            existing: open.filter((i) => i.kind === 'existing').length,
            onUnits: open.filter((i) => i.equipmentId).length,
          },
          attention: needsAttention({
            ...inputs,
            instruments: pick(data.instruments),
            completions: status.byEquipment,
          }).length,
          conflicts: data.conflicts.filter((c) => c.projectId === project.id).length,
          lastExport: { label: ex.lastLabel, at: ex.lastExportAt, changesSince: ex.changesSince },
          lastActivity: data.activity.get(project.id) ?? null,
          unsynced: data.pending.filter((c) => c.projectId === project.id).length,
        }),
      );
    }
    return out;
  }, [data]);
}
