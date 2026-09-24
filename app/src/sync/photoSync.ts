/**
 * Photo files and the cloud (bucket "photos", path `<projectId>/<photoId>.jpg`). The photo *records* sync through the
 * field-change outbox like everything else; the files move here, after each push:
 *
 *  - upload queue (`photoUploads`, one entry per photo, created with it): pending / failed entries are uploaded once
 *    their project is on the server; a failure is retried with exponential backoff (5 s, 10 s, 20 s … at most 1 h).
 *    The queue is in IndexedDB, so it resumes after a reload; an entry left 'uploading' by a closed app is retried.
 *  - deletes: a photo deleted after its file was uploaded leaves a 'delete' entry; the file is removed, then the entry.
 *    (Another device's delete removes the local copy only: the deleting device removes the file.)
 *  - downloads: photos pulled from other devices arrive without their file (blob null) and are downloaded here, a few
 *    per sync (the file may not be uploaded yet: tried again next time).
 */
import { db } from '../data/db';
import type { PhotoUpload } from '../data/types';
import { photoPath, type SyncBackend } from './backend';
import { localOnlyProjects } from './outbox';

export const UPLOAD_BACKOFF_MS = 5000;
export const UPLOAD_BACKOFF_MAX_MS = 3600_000;
export const DOWNLOADS_PER_SYNC = 20;

export const backoff = (attempts: number) =>
  Math.min(UPLOAD_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), UPLOAD_BACKOFF_MAX_MS);

export interface PhotoSyncResult {
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
  // no create in the log at all: a project pulled from the server (its create is logged as synced) or pre-sync data
  return !create || create.synced === 1;
}

export async function processPhotoQueue(backend: SyncBackend, now = Date.now()): Promise<PhotoSyncResult> {
  const res: PhotoSyncResult = { uploaded: 0, deleted: 0, failed: 0, downloaded: 0 };
  const localOnly = await localOnlyProjects();
  const due = (await db.photoUploads.toArray()).filter(
    (u) => u.status !== 'done' && (u.nextAttemptAt ?? 0) <= now && !localOnly.has(u.projectId),
  );
  const fail = async (u: PhotoUpload, e: unknown) => {
    const attempts = u.attempts + 1;
    await db.photoUploads.update(u.photoId, {
      status: u.status === 'delete' ? 'delete' : 'failed',
      attempts,
      lastError: e instanceof Error ? e.message : String(e),
      nextAttemptAt: now + backoff(attempts),
      updatedAt: now,
    });
    res.failed++;
  };
  for (const u of due) {
    const path = photoPath(u.projectId, u.photoId);
    if (u.status === 'delete') {
      try {
        await backend.deletePhoto(path);
        await db.photoUploads.delete(u.photoId);
        res.deleted++;
      } catch (e) {
        await fail(u, e);
      }
      continue;
    }
    const photo = await db.photos.get(u.photoId);
    if (!photo) {
      await db.photoUploads.delete(u.photoId);
      continue;
    }
    if (!photo.blob || !(await projectOnServer(u.projectId))) continue; // wait for the record to be pushed
    await db.photoUploads.update(u.photoId, { status: 'uploading', updatedAt: now });
    try {
      await backend.uploadPhoto(path, photo.blob, photo.blob.type || photo.mimeType || 'image/jpeg');
      await db.transaction('rw', db.photoUploads, db.photos, async () => {
        await db.photoUploads.update(u.photoId, { status: 'done', lastError: null, updatedAt: now });
        // local upload state, not a synced field (every device derives the path)
        await db.photos.update(u.photoId, { uploaded: 1 });
      });
      res.uploaded++;
    } catch (e) {
      await fail(u, e);
    }
  }
  // files of photos pulled from other devices
  const missing = (await db.photos.filter((p) => !p.blob).toArray()).slice(0, DOWNLOADS_PER_SYNC);
  for (const p of missing) {
    try {
      const blob = await backend.downloadPhoto(photoPath(p.projectId, p.id));
      if (!blob) continue;
      await db.photos.update(p.id, { blob, uploaded: 1 });
      res.downloaded++;
    } catch {
      /* next sync */
    }
  }
  return res;
}

/** At start-up: an upload interrupted by closing the app is pending again. */
export async function resumePhotoQueue(): Promise<number> {
  return db.photoUploads.where('status').equals('uploading').modify({ status: 'pending' });
}
