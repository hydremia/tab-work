/**
 * Client-side photo processing before a photo is stored:
 *  - decode with createImageBitmap (EXIF orientation applied by the browser, `imageOrientation: 'from-image'`);
 *    fallback <img> element (also applies orientation). If a browser decoded a rotated JPEG without applying its
 *    orientation (detected from the swapped size), the rotation is applied here;
 *  - downscale to a long edge of at most MAX_EDGE px and encode JPEG at QUALITY; a THUMB_EDGE px thumbnail;
 *  - keep the EXIF capture time and GPS position as metadata; everything else in EXIF is dropped by the re-encode.
 * HEIC: iPhone Safari converts to JPEG when a photo is picked; a browser that cannot decode the file gets a clear
 * message (PhotoDecodeError).
 */
import { fitWithin, jpegSize, orientationSwapsAxes, orientationTransform, readExif, sniffImageType } from './exif';

export const MAX_EDGE = 2000;
export const QUALITY = 0.8;
export const THUMB_EDGE = 320;
export const THUMB_QUALITY = 0.7;

export interface ProcessedPhoto {
  blob: Blob;
  thumb: Blob;
  width: number;
  height: number;
  /** ms since epoch from EXIF DateTimeOriginal (interpreted as device local time), or null. */
  capturedAt: number | null;
  gps: { lat: number; lon: number } | null;
  /** The original file's name (for reference) and size. */
  sourceName: string;
  sourceSize: number;
}

export class PhotoDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoDecodeError';
  }
}

type Source = ImageBitmap | HTMLImageElement;
interface Decoded {
  src: Source;
  width: number;
  height: number;
  close: () => void;
}

async function decode(blob: Blob, kind: string): Promise<Decoded> {
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    return { src: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { src: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new PhotoDecodeError(
        kind === 'heic'
          ? 'This is a HEIC photo, which this browser cannot open. On an iPhone choose the photo from Safari (it converts to JPEG), or set Settings > Camera > Formats > Most Compatible.'
          : 'This file could not be opened as an image. Use a JPEG or PNG photo.',
      );
    }
  }
}

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): { ctx: Canvas2D; toBlob: (q: number) => Promise<Blob> } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no 2D canvas context');
    return { ctx, toBlob: (q) => c.convertToBlob({ type: 'image/jpeg', quality: q }) };
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas context');
  return {
    ctx,
    toBlob: (q) =>
      new Promise<Blob>((resolve, reject) =>
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encoding failed'))), 'image/jpeg', q),
      ),
  };
}

/**
 * Draw `img` (decoded size srcW x srcH) upright into a JPEG whose long edge is at most maxEdge. `manualOrientation`
 * rotates/flips when the decoder did not apply the EXIF orientation.
 */
async function encode(
  img: Decoded,
  maxEdge: number,
  quality: number,
  manualOrientation: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const swap = orientationSwapsAxes(manualOrientation);
  const upW = swap ? img.height : img.width;
  const upH = swap ? img.width : img.height;
  const out = fitWithin(upW, upH, maxEdge);
  const { ctx, toBlob } = makeCanvas(out.width, out.height);
  ctx.fillStyle = '#fff'; // PNG transparency -> white, not black, in the JPEG
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (manualOrientation !== 1) ctx.setTransform(...orientationTransform(manualOrientation, out.width, out.height));
  // raw drawn size: the upright size with the axes swapped back
  const dw = swap ? out.height : out.width;
  const dh = swap ? out.width : out.height;
  ctx.drawImage(img.src, 0, 0, dw, dh);
  return { blob: await toBlob(quality), width: out.width, height: out.height };
}

/** "2026-09-15T14:03:22" (local) -> ms since epoch. */
export function exifDateToMs(s: string | null): number | null {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : null;
}

export async function processPhoto(file: Blob & { name?: string }): Promise<ProcessedPhoto> {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const kind = sniffImageType(head);
  const exif = kind === 'jpeg' ? readExif(head) : { orientation: 1, dateTimeOriginal: null, gps: null };
  const img = await decode(file, kind === 'unknown' && /\.hei[cf]$/i.test(file.name ?? '') ? 'heic' : kind);
  try {
    // did the decoder apply the orientation? (only detectable for 90-degree rotations of non-square images)
    let manual = 1;
    const raw = kind === 'jpeg' ? jpegSize(head) : null;
    if (
      raw &&
      orientationSwapsAxes(exif.orientation) &&
      raw.width !== raw.height &&
      img.width === raw.width &&
      img.height === raw.height
    )
      manual = exif.orientation;
    const full = await encode(img, MAX_EDGE, QUALITY, manual);
    const thumb = await encode(img, THUMB_EDGE, THUMB_QUALITY, manual);
    return {
      blob: full.blob,
      thumb: thumb.blob,
      width: full.width,
      height: full.height,
      capturedAt: exifDateToMs(exif.dateTimeOriginal),
      gps: exif.gps,
      sourceName: file.name ?? 'photo.jpg',
      sourceSize: file.size,
    };
  } finally {
    img.close();
  }
}

/**
 * Re-encode a stored photo for a PDF report: long edge at most maxEdge, JPEG. One image at a time keeps memory low
 * (a 200-photo report embeds ~150 KB per photo instead of the stored ~0.5-1 MB).
 */
export async function downscaleForReport(
  blob: Blob,
  maxEdge: number,
  quality = 0.75,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const img = await decode(blob, 'jpeg');
  try {
    const r = await encode(img, maxEdge, quality, 1);
    return { bytes: new Uint8Array(await r.blob.arrayBuffer()), width: r.width, height: r.height };
  } finally {
    img.close();
  }
}
