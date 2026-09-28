/**
 * Stamp and signature images of the certification profile: kept as small data URLs in the synced record
 * (data/types.ts StoredImage), decoded for the export (packages/workbook certImages.ts places them on the
 * Certification sheet).
 */
import type { CertImage, CertImages } from '@a2b/workbook';
import type { CertProfile, StoredImage } from '../data/types';

/** Largest image kept in the profile (the data URL travels in the sync log). */
export const MAX_IMAGE_BYTES = 400 * 1024;
/** Long edge of a stored stamp / signature (the stamp box prints at about 1.1 in; 300 dpi is plenty). */
export const MAX_IMAGE_EDGE = { stamp: 700, signature: 900 } as const;

export function dataUrlBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toCertImage(img: StoredImage | null | undefined): CertImage | null {
  if (!img?.dataUrl) return null;
  return { bytes: dataUrlBytes(img.dataUrl), type: img.type, width: img.width, height: img.height };
}

/** What every export places: the profile's images (none: pictures of an earlier export are removed). */
export function certImagesOf(profile: CertProfile | undefined): CertImages {
  return { stamp: toCertImage(profile?.stamp), signature: toCertImage(profile?.signature) };
}

export class ImageTooLargeError extends Error {
  constructor() {
    super('The picture is too large even after shrinking it. Crop it closer to the stamp / signature and try again.');
    this.name = 'ImageTooLargeError';
  }
}

/**
 * A picked or drawn image -> StoredImage: downscaled to the long edge, PNG kept as PNG (transparency: a stamp or
 * signature on a transparent background prints cleanly over the sheet), anything else re-encoded as PNG too when
 * small enough, else JPEG. Browser only (canvas).
 */
export async function processCertImage(blob: Blob, kind: 'stamp' | 'signature'): Promise<StoredImage> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const edge = MAX_IMAGE_EDGE[kind];
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process images.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const png = canvas.toDataURL('image/png');
  if (png.length * 0.75 <= MAX_IMAGE_BYTES) return { dataUrl: png, width, height, type: 'png' };
  const jpeg = canvas.toDataURL('image/jpeg', 0.85);
  if (jpeg.length * 0.75 <= MAX_IMAGE_BYTES) return { dataUrl: jpeg, width, height, type: 'jpeg' };
  throw new ImageTooLargeError();
}
