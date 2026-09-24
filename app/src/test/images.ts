/**
 * Test images without a canvas: JPEG via jpeg-js (pure JS) and PNG via zlib, plus an EXIF (APP1) segment builder
 * for orientation / capture time / GPS. Used by unit tests (Node / jsdom) and the e2e run (Node side).
 */
import jpeg from 'jpeg-js';
import { deflateSync } from 'node:zlib';

type Rgb = [number, number, number];

/** W x H JPEG; `color` is a fixed colour or a function of the pixel. */
export function makeJpeg(w: number, h: number, color: Rgb | ((x: number, y: number) => Rgb), quality = 85): Uint8Array {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = typeof color === 'function' ? color(x, y) : color;
      const i = (y * w + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  return new Uint8Array(jpeg.encode({ data, width: w, height: h }, quality).data);
}

/** W x H solid-colour PNG (RGB, no alpha). */
export function makePng(w: number, h: number, c: Rgb): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let k = n;
    for (let j = 0; j < 8; j++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1;
    return k >>> 0;
  });
  const crc = (b: Uint8Array) => {
    let x = 0xffffffff;
    for (const v of b) x = crcTable[(x ^ v) & 0xff] ^ (x >>> 8);
    return (x ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, body: Uint8Array) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'ascii');
    Buffer.from(body).copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(c, y * (w * 3 + 1) + 1 + x * 3);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', new Uint8Array()),
    ]),
  );
}

export interface ExifSpec {
  orientation?: number;
  /** "YYYY:MM:DD HH:MM:SS" */
  dateTimeOriginal?: string;
  gps?: { lat: number; lon: number };
  /** Big-endian (Motorola) TIFF instead of little-endian. */
  bigEndian?: boolean;
}

/** An APP1 "Exif" segment (marker included). */
export function exifSegment(spec: ExifSpec): Uint8Array {
  const le = !spec.bigEndian;
  const buf = Buffer.alloc(1024);
  const w16 = (o: number, v: number) => (le ? buf.writeUInt16LE(v, o) : buf.writeUInt16BE(v, o));
  const w32 = (o: number, v: number) => (le ? buf.writeUInt32LE(v, o) : buf.writeUInt32BE(v, o));
  buf.write(le ? 'II' : 'MM', 0, 'ascii');
  w16(2, 42);
  w32(4, 8);
  type Entry = { tag: number; type: number; count: number; inline?: (o: number) => void; data?: Buffer };
  let free = 0;
  let end = 0;
  const writeIfd = (at: number, entries: Entry[]) => {
    entries.sort((a, b) => a.tag - b.tag);
    w16(at, entries.length);
    let data = at + 2 + entries.length * 12 + 4;
    entries.forEach((e, k) => {
      const o = at + 2 + k * 12;
      w16(o, e.tag);
      w16(o + 2, e.type);
      w32(o + 4, e.count);
      if (e.data) {
        w32(o + 8, data);
        e.data.copy(buf, data);
        data += e.data.length + (e.data.length % 2);
      } else e.inline?.(o + 8);
    });
    w32(at + 2 + entries.length * 12, 0);
    free = data;
    end = Math.max(end, data);
  };
  const rationals = (vals: number[]) => {
    const b = Buffer.alloc(vals.length * 8);
    vals.forEach((v, k) => {
      const den = 10000;
      if (le) {
        b.writeUInt32LE(Math.round(v * den), k * 8);
        b.writeUInt32LE(den, k * 8 + 4);
      } else {
        b.writeUInt32BE(Math.round(v * den), k * 8);
        b.writeUInt32BE(den, k * 8 + 4);
      }
    });
    return b;
  };
  const dms = (deg: number) => {
    const a = Math.abs(deg);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const s = (a - d - m / 60) * 3600;
    return [d, m, s];
  };
  // IFD0 first (pointers patched after the sub-IFDs are written)
  const ifd0: Entry[] = [];
  if (spec.orientation) ifd0.push({ tag: 0x0112, type: 3, count: 1, inline: (o) => w16(o, spec.orientation!) });
  let exifAt = 0;
  let gpsAt = 0;
  if (spec.dateTimeOriginal) ifd0.push({ tag: 0x8769, type: 4, count: 1, inline: (o) => w32(o, exifAt) });
  if (spec.gps) ifd0.push({ tag: 0x8825, type: 4, count: 1, inline: (o) => w32(o, gpsAt) });
  writeIfd(8, ifd0);
  if (spec.dateTimeOriginal) {
    exifAt = free;
    const s = Buffer.from(`${spec.dateTimeOriginal}\0`, 'ascii');
    writeIfd(exifAt, [{ tag: 0x9003, type: 2, count: s.length, data: s }]);
  }
  if (spec.gps) {
    gpsAt = free;
    const ref = (c: string) => (o: number) => buf.write(`${c}\0`, o, 'ascii');
    writeIfd(gpsAt, [
      { tag: 0x0001, type: 2, count: 2, inline: ref(spec.gps.lat < 0 ? 'S' : 'N') },
      { tag: 0x0002, type: 5, count: 3, data: rationals(dms(spec.gps.lat)) },
      { tag: 0x0003, type: 2, count: 2, inline: ref(spec.gps.lon < 0 ? 'W' : 'E') },
      { tag: 0x0004, type: 5, count: 3, data: rationals(dms(spec.gps.lon)) },
    ]);
  }
  writeIfd(8, ifd0); // again, now with the sub-IFD offsets
  const tiff = buf.subarray(0, end);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return new Uint8Array(Buffer.concat([head, body]));
}

/** Insert an EXIF segment right after the JPEG's SOI marker. */
export function withExif(jpegBytes: Uint8Array, spec: ExifSpec): Uint8Array {
  return new Uint8Array(Buffer.concat([jpegBytes.subarray(0, 2), exifSegment(spec), jpegBytes.subarray(2)]));
}
