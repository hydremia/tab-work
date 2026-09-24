import { describe, expect, it } from 'vitest';
import { makeJpeg, makePng, withExif } from '../test/images';
import {
  fitWithin,
  jpegSize,
  normalizeExifDate,
  orientationTransform,
  orientedSize,
  readExif,
  sniffImageType,
} from './exif';
import { exifDateToMs } from './process';

describe('EXIF reader', () => {
  const base = makeJpeg(40, 20, [200, 30, 30]);

  it('reads orientation, capture time and GPS (little-endian)', () => {
    const bytes = withExif(base, {
      orientation: 6,
      dateTimeOriginal: '2026:09:15 14:03:22',
      gps: { lat: 38.581572, lon: -121.4944 },
    });
    const e = readExif(bytes);
    expect(e.orientation).toBe(6);
    expect(e.dateTimeOriginal).toBe('2026-09-15T14:03:22');
    expect(e.gps?.lat).toBeCloseTo(38.581572, 4);
    expect(e.gps?.lon).toBeCloseTo(-121.4944, 4);
  });

  it('reads big-endian (Motorola) TIFF and southern / eastern positions', () => {
    const e = readExif(withExif(base, { orientation: 3, bigEndian: true, gps: { lat: -33.8568, lon: 151.2153 } }));
    expect(e.orientation).toBe(3);
    expect(e.gps?.lat).toBeCloseTo(-33.8568, 4);
    expect(e.gps?.lon).toBeCloseTo(151.2153, 4);
    expect(e.dateTimeOriginal).toBeNull();
  });

  it('defaults for a JPEG without EXIF, a PNG and garbage', () => {
    expect(readExif(base)).toEqual({ orientation: 1, dateTimeOriginal: null, gps: null });
    expect(readExif(makePng(4, 4, [0, 0, 0]))).toEqual({ orientation: 1, dateTimeOriginal: null, gps: null });
    expect(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 4, 1, 2]))).toEqual({
      orientation: 1,
      dateTimeOriginal: null,
      gps: null,
    });
  });

  it('jpegSize reads the stored (un-rotated) size; sniffImageType', () => {
    expect(jpegSize(withExif(base, { orientation: 6 }))).toEqual({ width: 40, height: 20 });
    expect(sniffImageType(base)).toBe('jpeg');
    expect(sniffImageType(makePng(2, 2, [1, 2, 3]))).toBe('png');
    const heic = new Uint8Array([0, 0, 0, 24, ...Buffer.from('ftypheic'), 0, 0, 0, 0]);
    expect(sniffImageType(heic)).toBe('heic');
    expect(sniffImageType(new Uint8Array([1, 2, 3, 4]))).toBe('unknown');
  });

  it('normalizes EXIF dates', () => {
    expect(normalizeExifDate('2026:01:02 03:04:05')).toBe('2026-01-02T03:04:05');
    expect(normalizeExifDate('0000:00:00 00:00:00')).toBeNull();
    expect(normalizeExifDate('junk')).toBeNull();
    expect(exifDateToMs('2026-01-02T03:04:05')).toBe(new Date(2026, 0, 2, 3, 4, 5).getTime());
    expect(exifDateToMs(null)).toBeNull();
  });
});

describe('image math', () => {
  it('orientedSize swaps for 5-8', () => {
    expect(orientedSize(4000, 3000, 1)).toEqual({ width: 4000, height: 3000 });
    expect(orientedSize(4000, 3000, 3)).toEqual({ width: 4000, height: 3000 });
    for (const o of [5, 6, 7, 8]) expect(orientedSize(4000, 3000, o)).toEqual({ width: 3000, height: 4000 });
  });

  it('fitWithin downscales the long edge to the maximum and never upscales', () => {
    expect(fitWithin(4032, 3024, 2000)).toMatchObject({ width: 2000, height: 1500 });
    expect(fitWithin(3024, 4032, 2000)).toMatchObject({ width: 1500, height: 2000 });
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600, scale: 1 });
    expect(fitWithin(4032, 3024, 320)).toMatchObject({ width: 320, height: 240 });
    expect(fitWithin(10000, 1, 320)).toMatchObject({ width: 320, height: 1 });
  });

  it('orientationTransform maps the raw image exactly onto the upright canvas', () => {
    const rawW = 40;
    const rawH = 20;
    for (let o = 1; o <= 8; o++) {
      const { width: W, height: H } = orientedSize(rawW, rawH, o);
      const [a, b, c, d, e, f] = orientationTransform(o, W, H);
      const map = (x: number, y: number) => [a * x + c * y + e, b * x + d * y + f];
      const corners = [map(0, 0), map(rawW, 0), map(0, rawH), map(rawW, rawH)];
      const xs = corners.map((p) => p[0]).sort((m, n) => m - n);
      const ys = corners.map((p) => p[1]).sort((m, n) => m - n);
      expect([xs[0], xs[3], ys[0], ys[3]]).toEqual([0, W, 0, H]);
    }
    // orientation 6 (rotate 90° clockwise): the raw top-left corner ends up top-right
    const [a, b, c, d, e, f] = orientationTransform(6, 20, 40);
    expect([a * 0 + c * 0 + e, b * 0 + d * 0 + f]).toEqual([20, 0]);
    // orientation 8 (rotate 90° counter-clockwise): the raw top-left ends up bottom-left
    const t8 = orientationTransform(8, 20, 40);
    expect([t8[4], t8[5]]).toEqual([0, 40]);
  });
});
