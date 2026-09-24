/**
 * Minimal EXIF reader for JPEG files (pure, no DOM): orientation, capture time (DateTimeOriginal) and GPS position.
 * Only these are kept as photo metadata; the processed image is re-encoded through a canvas, which drops every
 * other EXIF tag (camera serial numbers, thumbnails, maker notes ...).
 */

export interface ExifInfo {
  /** EXIF orientation 1..8 (1 = upright). */
  orientation: number;
  /** DateTimeOriginal (or DateTime) as "YYYY-MM-DDTHH:MM:SS" local time, without a time zone. */
  dateTimeOriginal: string | null;
  /** Decimal degrees (south / west negative). */
  gps: { lat: number; lon: number } | null;
}

const EMPTY: ExifInfo = { orientation: 1, dateTimeOriginal: null, gps: null };

/** Read EXIF from JPEG bytes. Returns defaults for anything that is not a JPEG with an APP1 Exif segment. */
export function readExif(bytes: Uint8Array): ExifInfo {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { ...EMPTY };
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) break;
    if (
      marker === 0xe1 &&
      bytes[i + 4] === 0x45 && // E
      bytes[i + 5] === 0x78 && // x
      bytes[i + 6] === 0x69 && // i
      bytes[i + 7] === 0x66 // f
    ) {
      try {
        return parseTiff(bytes, i + 10, Math.min(bytes.length, i + 2 + len));
      } catch {
        return { ...EMPTY };
      }
    }
    i += 2 + len;
  }
  return { ...EMPTY };
}

function parseTiff(b: Uint8Array, start: number, end: number): ExifInfo {
  const little = b[start] === 0x49 && b[start + 1] === 0x49;
  if (!little && !(b[start] === 0x4d && b[start + 1] === 0x4d)) return { ...EMPTY };
  const u16 = (o: number) => {
    if (start + o + 2 > end) throw new RangeError('exif');
    return little ? b[start + o] | (b[start + o + 1] << 8) : (b[start + o] << 8) | b[start + o + 1];
  };
  const u32 = (o: number) => {
    if (start + o + 4 > end) throw new RangeError('exif');
    return little
      ? (b[start + o] | (b[start + o + 1] << 8) | (b[start + o + 2] << 16) | (b[start + o + 3] << 24)) >>> 0
      : ((b[start + o] << 24) | (b[start + o + 1] << 16) | (b[start + o + 2] << 8) | b[start + o + 3]) >>> 0;
  };
  const ascii = (o: number, n: number) => {
    let s = '';
    for (let k = 0; k < n && start + o + k < end; k++) {
      const c = b[start + o + k];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  /** Tags of one IFD: tag -> { type, count, valueOffset (absolute within TIFF) }. */
  const ifd = (off: number) => {
    const tags = new Map<number, { type: number; count: number; at: number }>();
    const n = u16(off);
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 } as Record<number, number>)[type] ?? 1;
      const at = size * count <= 4 ? e + 8 : u32(e + 8);
      tags.set(tag, { type, count, at });
    }
    return tags;
  };
  const rational = (at: number) => {
    const d = u32(at + 4);
    return d ? u32(at) / d : 0;
  };

  const out: ExifInfo = { ...EMPTY };
  const ifd0 = ifd(u32(4));
  const o = ifd0.get(0x0112);
  if (o) {
    const v = u16(o.at);
    if (v >= 1 && v <= 8) out.orientation = v;
  }
  let dt: string | null = null;
  const dt0 = ifd0.get(0x0132);
  if (dt0) dt = ascii(dt0.at, dt0.count);
  const exifPtr = ifd0.get(0x8769);
  if (exifPtr) {
    const sub = ifd(u32(exifPtr.at));
    const dto = sub.get(0x9003) ?? sub.get(0x9004);
    if (dto) dt = ascii(dto.at, dto.count);
  }
  out.dateTimeOriginal = normalizeExifDate(dt);
  const gpsPtr = ifd0.get(0x8825);
  if (gpsPtr) {
    const g = ifd(u32(gpsPtr.at));
    const lat = g.get(0x0002);
    const lon = g.get(0x0004);
    if (lat && lon && lat.count >= 3 && lon.count >= 3) {
      const dms = (at: number) => rational(at) + rational(at + 8) / 60 + rational(at + 16) / 3600;
      const latRef = g.get(0x0001);
      const lonRef = g.get(0x0003);
      let la = dms(lat.at);
      let lo = dms(lon.at);
      if (latRef && ascii(latRef.at, 1) === 'S') la = -la;
      if (lonRef && ascii(lonRef.at, 1) === 'W') lo = -lo;
      if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && (la || lo))
        out.gps = { lat: Math.round(la * 1e6) / 1e6, lon: Math.round(lo * 1e6) / 1e6 };
    }
  }
  return out;
}

/** "2026:09:15 14:03:22" -> "2026-09-15T14:03:22" (null when not a valid EXIF date). */
export function normalizeExifDate(s: string | null | undefined): string | null {
  const m = s ? /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim()) : null;
  if (!m || m[1] === '0000') return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

/** Orientations 5-8 rotate by 90 degrees: width and height swap. */
export function orientationSwapsAxes(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

/** Displayed (upright) size of a W x H stored image with the given EXIF orientation. */
export function orientedSize(w: number, h: number, orientation: number): { width: number; height: number } {
  return orientationSwapsAxes(orientation) ? { width: h, height: w } : { width: w, height: h };
}

/** Scale W x H down so its long edge is at most maxEdge (never up). Integer pixels, at least 1. */
export function fitWithin(w: number, h: number, maxEdge: number): { width: number; height: number; scale: number } {
  const long = Math.max(w, h);
  const scale = long > maxEdge ? maxEdge / long : 1;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

/**
 * Canvas transform that draws a raw (sensor-orientation) image upright: ctx.setTransform(a, b, c, d, e, f) on a
 * canvas of the oriented size (outW x outH), then drawImage(img, 0, 0, rawW, rawH) where rawW x rawH is the stored
 * size scaled. Used only when the browser decoded the file WITHOUT applying its orientation.
 */
export function orientationTransform(
  orientation: number,
  outW: number,
  outH: number,
): [number, number, number, number, number, number] {
  switch (orientation) {
    case 2:
      return [-1, 0, 0, 1, outW, 0];
    case 3:
      return [-1, 0, 0, -1, outW, outH];
    case 4:
      return [1, 0, 0, -1, 0, outH];
    case 5:
      return [0, 1, 1, 0, 0, 0];
    case 6:
      return [0, 1, -1, 0, outW, 0];
    case 7:
      return [0, -1, -1, 0, outW, outH];
    case 8:
      return [0, -1, 1, 0, 0, outH];
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}

/** Width x height of a JPEG from its SOF marker (pure; null when not found). The stored, un-oriented size. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let i = 2; i + 9 < bytes.length;) {
    if (bytes[i] !== 0xff) return null;
    const m = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    i += 2 + len;
  }
  return null;
}

/** Sniff an image type from its first bytes. */
export function sniffImageType(bytes: Uint8Array): 'jpeg' | 'png' | 'heic' | 'webp' | 'gif' | 'unknown' {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
  const s = (a: number, n: number) => String.fromCharCode(...bytes.slice(a, a + n));
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'webp';
  if (s(4, 4) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)/.test(s(8, 4))) return 'heic';
  return 'unknown';
}
