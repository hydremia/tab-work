/**
 * Revision history and the base workbook (decisions F1, N1).
 *
 * Storage on the device (IndexedDB): a revision-05 workbook is about 4 MB, so only the newest KEEP_REVISION_FILES
 * exports of a project keep their .xlsm; older ones keep their label, date, size and baseline values (a few hundred
 * KB at most), which is all a re-import of that workbook needs. The base workbook (the last re-imported issued
 * file) is one more file per project. Worst case per project: (5 + 1) x ~4 MB.
 */
import { db } from '../data/db';
import { getCurrentUser } from '../data/identity';
import type { BaseWorkbook, Revision } from '../data/types';

export const KEEP_REVISION_FILES = 5;

/** Prelim for the first export, then Rev 1, Rev 2 ... (after the highest "Rev n" so far). */
export function suggestLabel(revisions: readonly Pick<Revision, 'kind' | 'label'>[]): string {
  const exports = revisions.filter((r) => r.kind === 'export');
  if (!exports.length) return 'Prelim';
  const nums = exports
    .map((r) => /^rev\s*(\d+)$/i.exec(r.label.trim())?.[1])
    .filter(Boolean)
    .map(Number);
  return `Rev ${nums.length ? Math.max(...nums) + 1 : exports.length}`;
}

export async function listRevisions(projectId: string): Promise<Revision[]> {
  const all = await db.revisions.where('projectId').equals(projectId).toArray();
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

/** Store a revision; drop the file of export revisions past the newest KEEP_REVISION_FILES (values are kept). */
export async function saveRevision(rev: Revision): Promise<void> {
  await db.transaction('rw', db.revisions, async () => {
    await db.revisions.add(rev);
    const exportsWithFile = (await db.revisions.where('projectId').equals(rev.projectId).toArray())
      .filter((r) => r.kind === 'export' && r.bytes)
      .sort((a, b) => b.createdAt - a.createdAt);
    for (const old of exportsWithFile.slice(KEEP_REVISION_FILES)) await db.revisions.update(old.id, { bytes: null });
  });
}

export function newRevisionBase(projectId: string): Pick<Revision, 'projectId' | 'createdAt' | 'userId'> {
  return { projectId, createdAt: Date.now(), userId: getCurrentUser() };
}

export async function getBaseWorkbook(projectId: string): Promise<BaseWorkbook | undefined> {
  return db.baseWorkbooks.get(projectId);
}

/** Forget the base workbook: the next export uses the blank template again. */
export async function clearBaseWorkbook(projectId: string): Promise<void> {
  await db.baseWorkbooks.delete(projectId);
}

export interface BaselineChoice {
  revision: Revision | null;
  /** marker: the workbook's own revision; latest: the project's newest export (marker missing / unknown). */
  how: 'marker' | 'latest' | 'none';
}

/** The export revision a re-imported workbook came from: by its marker, else the newest export of the project. */
export async function baselineFor(projectId: string, revisionId: string | null | undefined): Promise<BaselineChoice> {
  const revs = (await listRevisions(projectId)).filter((r) => r.kind === 'export' && r.baseline);
  if (revisionId) {
    const hit = revs.find((r) => r.id === revisionId);
    if (hit) return { revision: hit, how: 'marker' };
  }
  return revs[0] ? { revision: revs[0], how: 'latest' } : { revision: null, how: 'none' };
}
