/**
 * Installability / offline check of a build (app/dist), without a browser or an external service (Lighthouse no
 * longer has a PWA category). Run after `npm run build`:  npm run pwa-check -w app
 *
 * Checks: the web app manifest (name, short name, id / start_url / scope, display, colors, icons incl. 192 / 512 and
 * maskable, each icon file present with the declared PNG size); index.html (manifest link, viewport, theme-color,
 * iOS meta tags, apple-touch-icon, favicon, no inline script, so the CSP holds); the service worker (precaches
 * index.html, every built file, the icons and the workbook template, SPA navigation fallback); and the hosting
 * files (_headers / _redirects copied into dist with the CSP).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const problems: string[] = [];
let passed = 0;
function ok(cond: unknown, what: string) {
  if (cond) passed++;
  else problems.push(what);
}

function pngSize(file: string): [number, number] | null {
  const b = readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('pwa-check: app/dist missing, run `npm run build` first');
  process.exit(1);
}

// ---------------------------------------------------------------- manifest
const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.webmanifest'), 'utf8')) as {
  name?: string;
  short_name?: string;
  id?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  theme_color?: string;
  background_color?: string;
  description?: string;
  icons?: { src: string; sizes: string; type: string; purpose?: string }[];
};
ok(manifest.name === 'a2b TAB', 'manifest name "a2b TAB"');
ok(manifest.short_name === 'TAB', 'manifest short_name "TAB"');
ok(manifest.id && manifest.start_url === '/' && manifest.scope === '/', 'manifest id / start_url / scope');
ok(manifest.display === 'standalone', 'manifest display standalone');
ok(/^#[0-9a-f]{6}$/i.test(manifest.theme_color ?? ''), 'manifest theme_color');
ok(/^#[0-9a-f]{6}$/i.test(manifest.background_color ?? ''), 'manifest background_color');
ok((manifest.description ?? '').length > 20, 'manifest description');
const icons = manifest.icons ?? [];
for (const [size, purpose] of [
  ['192x192', 'any'],
  ['512x512', 'any'],
  ['512x512', 'maskable'],
]) {
  ok(
    icons.some((i) => i.sizes === size && i.type === 'image/png' && (i.purpose ?? 'any').split(' ').includes(purpose)),
    `manifest icon ${size} ${purpose}`,
  );
}
for (const i of icons) {
  const f = join(DIST, i.src.replace(/^\//, ''));
  ok(existsSync(f), `icon file ${i.src}`);
  if (existsSync(f) && i.type === 'image/png') {
    const s = pngSize(f);
    ok(s && `${s[0]}x${s[1]}` === i.sizes, `icon ${i.src} is ${i.sizes} (found ${s?.join('x')})`);
  }
}

// ---------------------------------------------------------------- index.html
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
ok(/<link rel="manifest" href="\/manifest\.webmanifest"/.test(html), 'index.html links the manifest');
ok(/name="viewport" content="[^"]*width=device-width/.test(html), 'viewport meta');
ok(/name="theme-color"/.test(html), 'theme-color meta');
ok(/name="apple-mobile-web-app-capable" content="yes"/.test(html), 'apple-mobile-web-app-capable');
ok(/name="apple-mobile-web-app-status-bar-style"/.test(html), 'apple status bar style');
ok(/name="apple-mobile-web-app-title" content="TAB"/.test(html), 'apple-mobile-web-app-title');
const touch = /rel="apple-touch-icon" href="\/([^"]+)"/.exec(html)?.[1];
ok(touch && pngSize(join(DIST, touch))?.[0] === 180, 'apple-touch-icon 180 × 180');
ok(/rel="icon" href="\/favicon\.svg"/.test(html) && existsSync(join(DIST, 'favicon.ico')), 'favicon (svg + ico)');
ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'no inline <script> (CSP script-src self)');
ok(!/\sstyle="/.test(html) && !/<style/.test(html), 'no inline style in index.html (CSP style-src self)');

// ---------------------------------------------------------------- service worker
const sw = readFileSync(join(DIST, 'sw.js'), 'utf8');
const precached = new Set([...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]));
ok(precached.has('index.html'), 'SW precaches index.html');
ok(precached.has('templates/tab-template-rev05.xlsm'), 'SW precaches the workbook template (offline export)');
ok(precached.has('manifest.webmanifest'), 'SW precaches the manifest');
for (const f of readdirSync(join(DIST, 'assets'))) ok(precached.has(`assets/${f}`), `SW precaches assets/${f}`);
for (const i of icons) ok(precached.has(i.src.replace(/^\//, '')), `SW precaches ${i.src}`);
ok(/NavigationRoute/.test(sw) && /index\.html/.test(sw), 'SW: navigation fallback to index.html (offline deep links)');
// "prompt" updates: skipWaiting() only inside the SKIP_WAITING message handler (the update toast's Reload)
ok(
  (sw.match(/skipWaiting\(\)/g) ?? []).length === 1 &&
    /"SKIP_WAITING"===\w+\.data\.type&&self\.skipWaiting\(\)/.test(sw),
  'SW waits for the update toast (skipWaiting only on the SKIP_WAITING message)',
);
ok(/clientsClaim\(\)/.test(sw), 'SW claims the page on first install (offline from the first visit)');

// ---------------------------------------------------------------- hosting files in the build
const headers = existsSync(join(DIST, '_headers')) ? readFileSync(join(DIST, '_headers'), 'utf8') : '';
ok(/Content-Security-Policy: default-src 'self'/.test(headers), '_headers with the CSP in dist');
ok(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/.test(headers), '_headers: immutable assets');
ok(existsSync(join(DIST, '_redirects')), '_redirects (SPA fallback) in dist');

if (problems.length) {
  console.error(`pwa-check: ${passed} ok, ${problems.length} FAILED`);
  for (const p of problems) console.error(`  FAIL ${p}`);
  process.exit(1);
}
console.log(`pwa-check: ${passed} checks ok (manifest, icons, index.html, service worker, hosting files)`);
