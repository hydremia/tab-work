/** Live (reactive) queries over IndexedDB for the UI. */
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { computeCompletion, rollup, type Completion, type Rollup } from '../domain/completion';
import { EQUIPMENT_TYPES, type EquipmentTypeKey } from '../domain/equipmentTypes';
import { getSpec } from '../domain/specs';
import { db } from './db';
import type { AirflowRow, BaseWorkbook, Equipment, Instrument, Issue, Photo, Project, Revision } from './types';

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
  for (const e of equipment) {
    byEquipment.set(
      e.id,
      computeCompletion({
        spec: getSpec(e.type),
        unit: e,
        rows: rows.filter((r) => r.equipmentId === e.id),
        photos: photos.filter((p) => p.equipmentId === e.id),
        project,
        openIssues: issues.filter((i) => i.equipmentId === e.id && i.status === 'Open').length,
      }),
    );
  }
  const byType = new Map<EquipmentTypeKey, Rollup>();
  for (const t of EQUIPMENT_TYPES) {
    const list = equipment.filter((e) => e.type === t.key);
    if (list.length) byType.set(t.key, rollup(list.map((e) => byEquipment.get(e.id)!.color)));
  }
  return { byEquipment, byType, total: rollup([...byEquipment.values()].map((c) => c.color)) };
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
      .filter((u) => u.status !== 'done')
      .count();
    return { count, bytes, pendingUploads };
  }, [projectId]);
}

/** One photo (live); undefined while loading, null when missing. */
export function usePhoto(id: string | null | undefined): Photo | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.photos.get(id)) ?? null) : null), [id]);
}
