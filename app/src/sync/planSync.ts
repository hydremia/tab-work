/**
 * Plan sheet files and the cloud (bucket "plans", path `<projectId>/<sheetId>.pdf`; 0016). The sheet *records* sync
 * through the field-change outbox like everything else (devices and systems are fields); the drawing files move here,
 * after each push, the way the photos do (photoSync.ts):
 *
 *  - upload queue (`planUploads`, one entry per sheet, created with it): pending / failed entries are uploaded once
 *    their project is on the server, with the same backoff; the record's `storagePath` is set when the file is up,
 *    so other devices know they can fetch it.
 *  - deletes: a sheet deleted after its file was uploaded leaves a 'delete' entry; the file is removed, then the entry.
 *  - downloads: sheets pulled from other devices arrive without their file (pdf null) and are downloaded here, a few
 *    per sync, once their `storagePath` is set.
 */
import { db } from '../data/db';
import { setField } from '../data/repo';
import type { PlanUpload } from '../data/types';
import { planPath, PLANS_BUCKET, type SyncBackend } from './backend';
import { localOnlyProjects } from './outbox';
import { backoff } from './photoSync';

export const PLAN_DOWNLOADS_PER_SYNC = 3;

export interface PlanSyncResult {
  uploaded: number;
  deleted: number;
  failed: number;
  downloaded: number;
}

/** Is the project on the server? (its create change was pushed) */
async function projectOnServer(projectId: string): Promise<boolean> {
  const create = await db.fieldChanges
    .where('[table+recordId+field]')
    .equals(['projects', projectId, ''])
    .filter((c) => c.op === 'create')
    .first();
  return !create || create.synced === 1;
}

/** Queue a sheet's file for upload (called with the record). */
export async function queuePlanUpload(sheetId: string, projectId: string, now = Date.now()): Promise<void> {
  await db.planUploads.put({
    sheetId,
    projectId,
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });
}

/** A deleted sheet: its uploaded file is removed on the next sync; a never-uploaded one just drops its entry. */
export async function queuePlanDelete(
  sheetId: string,
  projectId: string,
  uploaded: boolean,
  now = Date.now(),
): Promise<void> {
  if (!uploaded) {
    await db.planUploads.delete(sheetId);
    return;
  }
  await db.planUploads.put({
    sheetId,
    projectId,
    status: 'delete',
    attempts: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });
}

export async function processPlanQueue(backend: SyncBackend, now = Date.now()): Promise<PlanSyncResult> {
  const res: PlanSyncResult = { uploaded: 0, deleted: 0, failed: 0, downloaded: 0 };
  const localOnly = await localOnlyProjects();
  const due = (await db.planUploads.toArray()).filter(
    (u) => u.status !== 'done' && (u.nextAttemptAt ?? 0) <= now && !localOnly.has(u.projectId),
  );
  const fail = async (u: PlanUpload, e: unknown) => {
    const attempts = u.attempts + 1;
    await db.planUploads.update(u.sheetId, {
      status: u.status === 'delete' ? 'delete' : 'failed',
      attempts,
      lastError: e instanceof Error ? e.message : String(e),
      nextAttemptAt: now + backoff(attempts),
      updatedAt: now,
    });
    res.failed++;
  };
  for (const u of due) {
    const path = planPath(u.projectId, u.sheetId);
    if (u.status === 'delete') {
      try {
        await backend.deleteFile(PLANS_BUCKET, path);
        await db.planUploads.delete(u.sheetId);
        res.deleted++;
      } catch (e) {
        await fail(u, e);
      }
      continue;
    }
    const sheet = await db.planSheets.get(u.sheetId);
    if (!sheet) {
      await db.planUploads.delete(u.sheetId);
      continue;
    }
    if (!sheet.pdf || !(await projectOnServer(u.projectId))) continue; // wait for the record to be pushed
    await db.planUploads.update(u.sheetId, { status: 'uploading', updatedAt: now });
    try {
      await backend.uploadFile(
        PLANS_BUCKET,
        path,
        new Blob([sheet.pdf as BlobPart], { type: 'application/pdf' }),
        'application/pdf',
      );
      await db.planUploads.update(u.sheetId, { status: 'done', lastError: null, updatedAt: now });
      if (sheet.storagePath !== path) await setField('planSheets', sheet.id, 'storagePath', path, { source: 'auto' });
      res.uploaded++;
    } catch (e) {
      await fail(u, e);
    }
  }
  // sheets from other devices without their file
  const missing = (await db.planSheets.toArray()).filter((s) => !s.pdf && s.storagePath && !localOnly.has(s.projectId));
  for (const s of missing.slice(0, PLAN_DOWNLOADS_PER_SYNC)) {
    try {
      const blob = await backend.downloadFile(PLANS_BUCKET, s.storagePath!);
      if (!blob) continue; // not uploaded yet: next time
      await db.planSheets.update(s.id, { pdf: await blobBytes(blob) });
      res.downloaded++;
    } catch {
      // network: next sync
    }
  }
  return res;
}

/** A Blob's bytes (FileReader where the Blob has no arrayBuffer(), as in older WebViews and jsdom). */
async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsArrayBuffer(blob);
  });
}

/** On start: entries left 'uploading' by a closed app are tried again. */
export async function resumePlanQueue(): Promise<void> {
  const stuck = await db.planUploads.where('status').equals('uploading').toArray();
  for (const u of stuck) await db.planUploads.update(u.sheetId, { status: 'pending', updatedAt: Date.now() });
}
