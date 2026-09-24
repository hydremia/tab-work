/**
 * Import a workbook into the app (browser side):
 *  - parseWorkbook(): read the values and the revision marker;
 *  - saveAsNewProject(): a project that was never in the app on this device;
 *  - prepareReview() + applyReimport(): re-import of an issued workbook into an existing project, with the
 *    three-way diff (reimportDiff.ts) reviewed by the user. Applying writes the accepted values through the
 *    repository (setField / createRecord / deleteRecord: field changes in the sync outbox) in one transaction, keeps
 *    the file as the base workbook of the next export (F1) and records an "imported" revision.
 */
import { importWorkbookWithReport, type ProjectData, type RevisionMarker } from '@a2b/workbook';
import { db } from '../data/db';
import { createRecord, deleteRecord, setField } from '../data/repo';
import type { Revision } from '../data/types';
import { uuid } from '../data/uuid';
import { fromProjectData, type ProjectBundle } from './adapter';
import { loadBundle } from './bundle';
import { XLSM_MIME } from './exportProject';
import { planApply, type ApplyPlan } from './reimportApply';
import { reimportDiff, type Choice, type FullDiff } from './reimportDiff';
import { baselineFor, newRevisionBase, saveRevision, type BaselineChoice } from './revisions';

export interface ParsedImport {
  bundle: ProjectBundle;
  /** The workbook's values as read (the "wb" side of a re-import). */
  data: ProjectData;
  marker: RevisionMarker | null;
  warnings: string[];
  fileName: string;
  bytes: Uint8Array;
}

export async function parseWorkbook(bytes: Uint8Array, fileName: string): Promise<ParsedImport> {
  const { project, report, marker } = await importWorkbookWithReport(bytes);
  const fallbackName = fileName.replace(/\.(xlsm|xlsx)$/i, '');
  return {
    bundle: fromProjectData(project, { fallbackName }),
    data: project,
    marker,
    warnings: report.warnings,
    fileName,
    bytes,
  };
}

/** The project the workbook was exported from, when it is on this device. */
export async function markerProject(parsed: ParsedImport): Promise<{ id: string; name: string } | null> {
  if (!parsed.marker) return null;
  const p = await db.projects.get(parsed.marker.projectId);
  return p ? { id: p.id, name: p.name } : null;
}

const ALL_TABLES = () => [
  db.projects,
  db.equipment,
  db.airflowRows,
  db.issues,
  db.instruments,
  db.photos,
  db.fieldChanges,
  db.meta,
  db.revisions,
  db.baseWorkbooks,
];

async function keepAsBase(projectId: string, parsed: ParsedImport, blob: Blob, fromRevisionId: string | null) {
  await db.baseWorkbooks.put({
    projectId,
    blob,
    fileName: parsed.fileName,
    size: parsed.bytes.length,
    importedAt: Date.now(),
    fromRevisionId,
  });
}

export async function saveAsNewProject(parsed: ParsedImport): Promise<string> {
  const b = parsed.bundle;
  const blob = new Blob([parsed.bytes as BlobPart], { type: XLSM_MIME });
  await db.transaction('rw', ALL_TABLES(), async () => {
    await createRecord('projects', b.project);
    for (const e of b.equipment) await createRecord('equipment', e);
    for (const r of b.rows) await createRecord('airflowRows', r);
    for (const i of b.issues) await createRecord('issues', i);
    for (const i of b.instruments) await createRecord('instruments', i);
    // the imported workbook is this project's issued report: the next export writes into it (F1)
    await keepAsBase(b.project.id, parsed, blob, null);
    await saveRevision(importRevision(b.project.id, parsed, null, null));
  });
  return b.project.id;
}

function importRevision(
  projectId: string,
  parsed: ParsedImport,
  fromRevisionId: string | null,
  applied: Revision['applied'] | null,
): Revision {
  return {
    ...newRevisionBase(projectId),
    id: uuid(),
    kind: 'import',
    label: parsed.marker?.label ? `Imported ${parsed.marker.label}` : 'Imported',
    fileName: parsed.fileName,
    size: parsed.bytes.length,
    bytes: null, // the file itself is kept as the base workbook
    baseline: null,
    fromRevisionId,
    ...(applied ? { applied } : {}),
  };
}

export interface Review {
  projectId: string;
  bundle: ProjectBundle;
  diff: FullDiff;
  baseline: BaselineChoice;
}

/**
 * Compare a workbook with a project. `twoWay`: no baseline (a workbook that was not exported from this project):
 * every difference is an incoming change.
 */
export async function prepareReview(projectId: string, parsed: ParsedImport, twoWay = false): Promise<Review> {
  const bundle = await loadBundle(projectId);
  const sameProject = parsed.marker?.projectId === projectId;
  const baseline: BaselineChoice = twoWay
    ? { revision: null, how: 'none' }
    : await baselineFor(projectId, sameProject ? parsed.marker?.revisionId : null);
  const diff = reimportDiff({
    base: (baseline.revision?.baseline as ProjectData | null) ?? null,
    app: bundle,
    wb: parsed.data,
  });
  return { projectId, bundle, diff, baseline };
}

export interface ApplySummary extends ApplyPlan {
  collisions: number;
}

/** Apply the reviewed decisions (one transaction). Cancel = simply don't call this. */
export async function applyReimport(
  review: Review,
  parsed: ParsedImport,
  decisions: Readonly<Record<string, Choice | undefined>>,
): Promise<ApplySummary> {
  const open = review.diff.items.filter((i) => i.kind === 'collision' && !decisions[i.id]);
  if (open.length) throw new Error(`${open.length} collision(s) are not resolved`);
  // fresh records: the plan is made against the project as it is right now
  const current = await loadBundle(review.projectId);
  const plan = planApply(current, review.diff, decisions);
  const blob = new Blob([parsed.bytes as BlobPart], { type: XLSM_MIME });
  const fromRevisionId = review.baseline.how === 'marker' ? (review.baseline.revision?.id ?? null) : null;
  await db.transaction('rw', ALL_TABLES(), async () => {
    for (const op of plan.ops) {
      if (op.op === 'set') await setField(op.table, op.id, op.field, op.value);
      else if (op.op === 'create') await createRecord(op.table, op.record);
      else await deleteRecord(op.table, op.id);
    }
    await keepAsBase(review.projectId, parsed, blob, fromRevisionId);
    await saveRevision(
      importRevision(review.projectId, parsed, fromRevisionId, {
        accepted: plan.accepted,
        declined: plan.declined,
        collisions: review.diff.counts.collisions,
      }),
    );
  });
  return { ...plan, collisions: review.diff.counts.collisions };
}
