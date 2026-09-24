import { db } from '../data/db';
import type { ProjectBundle } from './adapter';

export async function loadBundle(projectId: string): Promise<ProjectBundle> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error('Project not found');
  const [equipment, rows, issues, instruments] = await Promise.all([
    db.equipment.where('projectId').equals(projectId).toArray(),
    db.airflowRows.where('projectId').equals(projectId).toArray(),
    db.issues.where('projectId').equals(projectId).toArray(),
    db.instruments.where('projectId').equals(projectId).toArray(),
  ]);
  return { project, equipment, rows, issues, instruments };
}
