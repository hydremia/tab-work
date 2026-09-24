/**
 * Taking / choosing a photo: process it (photos/process.ts), store it (repo), and on the first photo ask the browser
 * to keep this site's storage (navigator.storage.persist) so photos are not evicted under storage pressure.
 */
import { db } from '../data/db';
import { addPhoto, replacePhoto, setField, type PhotoTarget } from '../data/repo';
import type { Photo } from '../data/types';
import { processPhoto } from './process';

export type PersistState = 'persisted' | 'denied' | 'unsupported' | 'unknown';

/** Ask for persistent storage once (the result is remembered in meta 'storagePersist'). */
export async function requestPersistentStorage(): Promise<PersistState> {
  const st = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!st?.persist) {
    await db.meta.put({ key: 'storagePersist', value: 'unsupported' });
    return 'unsupported';
  }
  try {
    const already = st.persisted ? await st.persisted() : false;
    const ok = already || (await st.persist());
    const state: PersistState = ok ? 'persisted' : 'denied';
    await db.meta.put({ key: 'storagePersist', value: state });
    return state;
  } catch {
    return 'unknown';
  }
}

export async function persistState(): Promise<PersistState> {
  const st = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (st?.persisted) {
    try {
      if (await st.persisted()) return 'persisted';
    } catch {
      /* fall through */
    }
  }
  const v = (await db.meta.get('storagePersist'))?.value;
  return v === 'persisted' || v === 'denied' || v === 'unsupported' ? v : 'unknown';
}

/**
 * Process and store one picked file. `replace`: single-photo slots (cover, unit, tag, OA damper) replace the
 * existing photo of that slot.
 */
export async function savePhotoFile(
  projectId: string,
  file: File | (Blob & { name?: string }),
  target: PhotoTarget,
  opts: { replace?: boolean } = {},
): Promise<Photo> {
  const p = await processPhoto(file);
  const img = {
    blob: p.blob,
    thumb: p.thumb,
    width: p.width,
    height: p.height,
    capturedAt: p.capturedAt,
    gps: p.gps,
    fileName: p.sourceName.replace(/\.[^.]+$/, '') + '.jpg',
  };
  const first = (await db.meta.get('storagePersist')) === undefined;
  const photo = opts.replace
    ? await replacePhoto(projectId, img, target.category, target.equipmentId ?? null)
    : await addPhoto(projectId, img, target);
  if (target.caption && opts.replace) await setField('photos', photo.id, 'caption', target.caption);
  if (first) void requestPersistentStorage();
  return photo;
}

/** Process and store several files one at a time (keeps memory low); returns the errors by file name. */
export async function savePhotoFiles(
  projectId: string,
  files: readonly (File | Blob)[],
  target: PhotoTarget,
  onProgress?: (done: number, total: number) => void,
): Promise<{ saved: Photo[]; errors: string[] }> {
  const saved: Photo[] = [];
  const errors: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    try {
      saved.push(await savePhotoFile(projectId, f, target));
    } catch (e) {
      errors.push(`${(f as File).name ?? 'photo'}: ${e instanceof Error ? e.message : String(e)}`);
    }
    onProgress?.(i + 1, files.length);
  }
  return { saved, errors };
}

/** Bytes used by a project's photos on this device (images + thumbnails). */
export async function projectPhotoBytes(projectId: string): Promise<{ count: number; bytes: number }> {
  let bytes = 0;
  let count = 0;
  await db.photos
    .where('projectId')
    .equals(projectId)
    .each((p) => {
      count++;
      bytes += (p.blob?.size ?? 0) + (p.thumb?.size ?? 0);
    });
  return { count, bytes };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
