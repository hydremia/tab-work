/**
 * Node cover-photo cropper for the spike: pure JS (jpeg-js) centre crop, box-filter downscale and JPEG encode.
 * The app uses the browser cropper in @a2b/workbook/browser instead (createImageBitmap + canvas).
 * Note: jpeg-js ignores EXIF orientation.
 */
import jpeg from 'jpeg-js';
import { centreCrop, type CroppedPhoto } from '@a2b/workbook';

/** Centre-crop to `aspect` (width / height), box-filter downscale to at most maxWidth, encode JPEG. */
export function cropResizeJpeg(src: Uint8Array, aspect: number, maxWidth = 1600, quality = 85): CroppedPhoto {
  const img = jpeg.decode(src, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 200 });
  const W = img.width, H = img.height;
  const { x: cx0, y: cy0, w: cw, h: ch, outW: tw, outH: th } = centreCrop(W, H, aspect, maxWidth);
  const out = new Uint8Array(tw * th * 4);
  const sx = cw / tw, sy = ch / th;
  const data = img.data;
  for (let ty = 0; ty < th; ty++) {
    const y0 = cy0 + Math.floor(ty * sy), y1 = Math.max(y0 + 1, cy0 + Math.floor((ty + 1) * sy));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = cx0 + Math.floor(tx * sx), x1 = Math.max(x0 + 1, cx0 + Math.floor((tx + 1) * sx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * W + x0) * 4;
        for (let x = x0; x < x1; x++, i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
      }
      const o = (ty * tw + tx) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  const enc = jpeg.encode({ data: out, width: tw, height: th }, quality);
  return { jpeg: new Uint8Array(enc.data), width: tw, height: th, srcWidth: W, srcHeight: H, crop: { x: cx0, y: cy0, w: cw, h: ch } };
}
