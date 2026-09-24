/**
 * Renders the placeholder PWA icons (PNG) from an inline SVG with the preinstalled Chromium (playwright-core).
 * Run once: `node scripts/make-icons.mjs` (the PNGs are committed). Set CHROMIUM_PATH to override the browser.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const svg = (
  size,
  padding,
) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${padding ? 0 : 14}" fill="#0f4c81"/>
  <g transform="${padding ? 'translate(9.6 9.6) scale(0.7)' : ''}">
    <path d="M14 40c6-10 12-10 18 0s12 10 18 0" fill="none" stroke="#7fc4ff" stroke-width="4" stroke-linecap="round"/>
    <path d="M14 28c6-10 12-10 18 0s12 10 18 0" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
    <text x="32" y="56" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="11" fill="#ffffff">TAB</text>
  </g>
</svg>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon-180.png', 180, true],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, maskable)}</body></html>`);
  await page.screenshot({
    path: join(out, name),
    omitBackground: !maskable,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  console.log('wrote', name);
}
await browser.close();
