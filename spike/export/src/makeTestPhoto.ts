/**
 * Generates the synthetic cover photo sample/cover-photo.jpg (4032 x 3024, a 12 MP phone-camera size).
 * Nothing is downloaded. The picture makes cropping and distortion visible:
 *  - a labelled grid (columns A-P, rows 1-12, 252 px cells);
 *  - a circle and a square in the centre (they stay round / square only if the aspect ratio is kept);
 *  - red "CROP" bands on the top and bottom 300 px: a centre crop to ~1.69:1 removes ~315 px at the
 *    top and bottom, so no red may be visible on the cover page;
 *  - "TOP" / "BOTTOM" / "LEFT" / "RIGHT" markers just inside the area that must survive.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';

const W = 4032, H = 3024;
const FONT: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e], C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e], E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f], F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f], H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c], K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11], L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11], N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11], O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10], Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d], R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e], T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04], U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04], W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a], X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x11, 0x0a, 0x04, 0x04, 0x04], Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e], '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e], '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e], '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02], '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e], '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08], '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c], '-': [0, 0, 0, 0x1f, 0, 0, 0], ' ': [0, 0, 0, 0, 0, 0, 0], ':': [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  '.': [0, 0, 0, 0, 0, 0x0c, 0x0c], '/': [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
};

export function makeTestPhoto(): Uint8Array {
  const px = new Uint8Array(W * H * 4);
  const set = (x: number, y: number, r: number, g: number, b: number, a = 1) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    px[i] = px[i] * (1 - a) + r * a; px[i + 1] = px[i + 1] * (1 - a) + g * a; px[i + 2] = px[i + 2] * (1 - a) + b * a; px[i + 3] = 255;
  };
  const rect = (x0: number, y0: number, w: number, h: number, r: number, g: number, b: number, a = 1) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, r, g, b, a);
  };
  const text = (s: string, x0: number, y0: number, scale: number, rgb: [number, number, number]) => {
    let x = x0;
    for (const ch of s.toUpperCase()) {
      const g = FONT[ch] ?? FONT[' '];
      g.forEach((bits, gy) => { for (let gx = 0; gx < 5; gx++) if (bits & (0x10 >> gx)) rect(x + gx * scale, y0 + gy * scale, scale, scale, ...rgb); });
      x += 6 * scale;
    }
  };
  const textW = (s: string, scale: number) => s.length * 6 * scale - scale;

  // sky-to-ground gradient
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const r = Math.round(90 + 110 * t), g = Math.round(150 + 60 * t), b = Math.round(220 - 90 * t);
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; }
  }
  // grid with labels
  const cell = 252;
  for (let gx = 0; gx <= W; gx += cell) rect(gx - 3, 0, 6, H, 30, 30, 40);
  for (let gy = 0; gy <= H; gy += cell) rect(0, gy - 3, W, 6, 30, 30, 40);
  for (let cx = 0; cx < W / cell; cx++) {
    for (let cy = 0; cy < H / cell; cy++) text(`${String.fromCharCode(65 + cx)}${cy + 1}`, cx * cell + 14, cy * cell + 14, 6, [255, 255, 255]);
  }
  // crop bands (must NOT be visible after the centre crop)
  for (const y0 of [0, H - 300]) {
    rect(0, y0, W, 300, 220, 30, 30, 0.75);
    for (let x = 60; x < W; x += 1300) text('CROP', x, y0 + 80, 20, [255, 255, 255]);
  }
  // circle + square in the centre
  const cx = W / 2, cy = H / 2, R = 900;
  for (let a = 0; a < 2 * Math.PI; a += 0.0004) for (let t = -14; t <= 14; t++) set(Math.round(cx + (R + t) * Math.cos(a)), Math.round(cy + (R + t) * Math.sin(a)), 255, 215, 0);
  rect(cx - 640, cy - 640, 1280, 24, 0, 90, 0); rect(cx - 640, cy + 616, 1280, 24, 0, 90, 0);
  rect(cx - 640, cy - 640, 24, 1280, 0, 90, 0); rect(cx + 616, cy - 640, 24, 1280, 0, 90, 0);
  const t1 = 'SPIKE COVER PHOTO', t2 = '4032 X 3024';
  rect(cx - textW(t1, 16) / 2 - 30, cy - 170, textW(t1, 16) + 60, 360, 0, 0, 0, 0.55);
  text(t1, cx - textW(t1, 16) / 2, cy - 140, 16, [255, 255, 255]);
  text(t2, cx - textW(t2, 16) / 2, cy + 40, 16, [255, 255, 255]);
  // markers just inside the kept area
  text('TOP', cx - textW('TOP', 14) / 2, 340, 14, [255, 255, 0]);
  text('BOTTOM', cx - textW('BOTTOM', 14) / 2, H - 340 - 7 * 14, 14, [255, 255, 0]);
  text('LEFT', 40, cy - 49, 14, [255, 255, 0]);
  text('RIGHT', W - 40 - textW('RIGHT', 14), cy - 49, 14, [255, 255, 0]);
  return new Uint8Array(jpeg.encode({ data: px, width: W, height: H }, 88).data);
}

const here = dirname(fileURLToPath(import.meta.url));
export const TEST_PHOTO_PATH = join(here, '..', 'sample', 'cover-photo.jpg');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(dirname(TEST_PHOTO_PATH), { recursive: true });
  const bytes = makeTestPhoto();
  writeFileSync(TEST_PHOTO_PATH, bytes);
  console.log(`wrote ${TEST_PHOTO_PATH} (${W}x${H}, ${(bytes.length / 1e6).toFixed(2)} MB)`);
}
