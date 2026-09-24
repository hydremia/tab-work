/**
 * Browser cover-photo cropper: decode with createImageBitmap (EXIF orientation honoured via
 * `imageOrientation: 'from-image'`), centre-crop to the cover box aspect, downscale with the canvas'
 * high-quality smoothing and encode JPEG. Falls back to an <img> element when createImageBitmap cannot decode
 * the file (older Safari with HEIC); <img> also applies EXIF orientation (CSS image-orientation: from-image).
 */
import { centreCrop, type CroppedPhoto } from './coverPhoto.js';

type Source = ImageBitmap | HTMLImageElement;

async function decode(bytes: Uint8Array): Promise<{ src: Source; width: number; height: number; close: () => void }> {
  const blob = new Blob([bytes as BlobPart]);
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
    } catch (e) {
      URL.revokeObjectURL(url);
      throw new Error(`the cover photo could not be decoded by this browser (${String(e)})`);
    }
  }
}

export async function cropCoverPhotoBrowser(
  bytes: Uint8Array,
  aspect: number,
  maxWidth = 1600,
  quality = 85,
): Promise<CroppedPhoto> {
  const img = await decode(bytes);
  try {
    const c = centreCrop(img.width, img.height, aspect, maxWidth);
    let out: Blob;
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(c.outW, c.outH);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2D canvas context');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img.src, c.x, c.y, c.w, c.h, 0, 0, c.outW, c.outH);
      out = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality / 100 });
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = c.outW;
      canvas.height = c.outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2D canvas context');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img.src, c.x, c.y, c.w, c.h, 0, 0, c.outW, c.outH);
      out = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encoding failed'))), 'image/jpeg', quality / 100),
      );
    }
    return {
      jpeg: new Uint8Array(await out.arrayBuffer()),
      width: c.outW,
      height: c.outH,
      srcWidth: img.width,
      srcHeight: img.height,
      crop: { x: c.x, y: c.y, w: c.w, h: c.h },
    };
  } finally {
    img.close();
  }
}
