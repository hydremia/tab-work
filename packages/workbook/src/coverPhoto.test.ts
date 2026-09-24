import { describe, expect, it } from 'vitest';
import { centreCrop } from './coverPhoto.js';

describe('centreCrop', () => {
  it('crops a wide photo left and right', () => {
    const c = centreCrop(4000, 1000, 2, 1600);
    expect(c).toEqual({ x: 1000, y: 0, w: 2000, h: 1000, outW: 1600, outH: 800 });
  });
  it('crops a tall photo top and bottom, never upscales', () => {
    const c = centreCrop(1000, 3000, 1.685, 1600);
    expect(c.w).toBe(1000);
    expect(c.h).toBe(Math.round(1000 / 1.685));
    expect(c.y).toBe(Math.floor((3000 - c.h) / 2));
    expect(c.outW).toBe(1000);
  });
});
