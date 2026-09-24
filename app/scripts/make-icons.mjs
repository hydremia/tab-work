/**
 * The a2b TAB app icon set, drawn as SVG paths (no font needed, so every renderer shows the same letters), and the
 * PNG / ICO renders of it made with the preinstalled Chromium (playwright-core).
 *
 *   node scripts/make-icons.mjs            writes public/favicon.svg, public/favicon.ico, public/icons/*.png and
 *                                          public/icons/icon.svg (the source), all committed
 *   node scripts/make-icons.mjs --preview  also renders the set side by side to ../docs/screenshots/28-icons.png
 *
 * Set CHROMIUM_PATH to override the browser.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, '..', 'public');
const OUT = join(PUBLIC, 'icons');
mkdirSync(OUT, { recursive: true });

const NAVY = '#0f4c81';
const NAVY_DARK = '#0a365d';
const SKY = '#8fd0ff';

/** "a2b" (white) over an airflow line and "TAB" (sky blue), on a 512 × 512 grid, centred on (256, 256). */
const MARK = `
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g stroke="#ffffff" stroke-width="34" transform="translate(-20 -20)">
      <circle cx="136" cy="226" r="50"/>
      <path d="M186 176 V276"/>
      <path d="M228 170 C234 146 252 136 272 136 C298 136 316 153 316 176 C316 198 302 212 282 228 L230 276 H322"/>
      <path d="M366 116 V276"/>
      <circle cx="416" cy="226" r="50"/>
    </g>
    <path transform="translate(0 -20)" d="M96 326 C150 306 196 346 256 326 S362 306 416 326" stroke="${SKY}" stroke-width="14" opacity="0.9"/>
    <g stroke="${SKY}" stroke-width="26" transform="translate(-14 -20)">
      <path d="M150 370 H226 M188 370 V438"/>
      <path d="M244 438 L276 370 L308 438 M256 414 H296"/>
      <path d="M332 370 V438 M332 370 H356 C376 370 384 380 384 390 C384 400 376 404 358 404 H332 M358 404 C380 404 390 412 390 422 C390 432 380 438 358 438 H332"/>
    </g>
  </g>`;

/**
 * @param {'rounded' | 'full'} shape rounded: transparent corners (favicon, "any" icons); full: full-bleed square
 *   (maskable, apple-touch-icon, which the platform masks itself)
 * @param {number} scale mark scale around the centre (maskable: inside the 80 % safe circle)
 */
function iconSvg(shape, scale = 1, size = 512) {
  const t = (1 - scale) * 256;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${NAVY}"/>
      <stop offset="1" stop-color="${NAVY_DARK}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${shape === 'rounded' ? 112 : 0}" fill="url(#bg)"/>
  <g transform="translate(${t} ${t}) scale(${scale})">${MARK}
  </g>
</svg>
`;
}

/** Favicon: the same mark, a little larger (tabs are tiny), on the rounded square. */
const FAVICON = iconSvg('rounded', 1.06).replace(/ width="512" height="512"/, '');
const SOURCE = iconSvg('rounded').replace(/ width="512" height="512"/, '');

const RENDERS = [
  // file, size, shape, scale
  ['icon-192.png', 192, 'rounded', 1],
  ['icon-512.png', 512, 'rounded', 1],
  ['icon-maskable-192.png', 192, 'full', 0.74],
  ['icon-maskable-512.png', 512, 'full', 0.74],
  ['apple-touch-icon-180.png', 180, 'full', 0.84],
  ['favicon-32.png', 32, 'rounded', 1.06],
  ['favicon-16.png', 16, 'rounded', 1.06],
];

/** A .ico holding PNG images (supported by every browser since IE Vista-era). */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

writeFileSync(join(PUBLIC, 'favicon.svg'), FAVICON);
writeFileSync(join(OUT, 'icon.svg'), SOURCE);
console.log('wrote favicon.svg, icons/icon.svg');

const browser = await chromium
  .launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
  .catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
const page = await browser.newPage();
const rendered = new Map();
for (const [name, size, shape, scale] of RENDERS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${iconSvg(shape, scale, size)}</body></html>`,
  );
  const data = await page.screenshot({
    omitBackground: shape === 'rounded',
    clip: { x: 0, y: 0, width: size, height: size },
  });
  writeFileSync(join(OUT, name), data);
  rendered.set(name, data);
  console.log('wrote', name);
}
writeFileSync(
  join(PUBLIC, 'favicon.ico'),
  ico([
    { size: 16, data: rendered.get('favicon-16.png') },
    { size: 32, data: rendered.get('favicon-32.png') },
  ]),
);
console.log('wrote favicon.ico');

if (process.argv.includes('--preview')) {
  const img = (name, size, label, extra = '') =>
    `<figure><img src="data:image/png;base64,${rendered.get(name).toString('base64')}" width="${size}" height="${size}" style="${extra}"><figcaption>${label}</figcaption></figure>`;
  const b64 = (s) => Buffer.from(s).toString('base64');
  const html = `<html><head><style>
    body{margin:0;padding:28px;font:14px system-ui,sans-serif;color:#15202b;background:#f3f5f8;width:1044px}
    h1{font-size:20px;margin:0 0 4px} p{margin:0 0 20px;color:#56657a}
    .row{display:flex;gap:28px;align-items:flex-end;flex-wrap:wrap;margin-bottom:26px}
    figure{margin:0;text-align:center} figcaption{margin-top:8px;font-size:12px;color:#56657a}
    .dark{background:#0e141b;padding:20px;border-radius:12px;display:flex;gap:24px;align-items:flex-end}
    .dark figcaption{color:#a9b6c5}
    .home{display:grid;grid-template-columns:repeat(4,72px);gap:18px;padding:20px;border-radius:16px;
      background:linear-gradient(160deg,#6d8fb3,#304a66)}
    .home figcaption{color:#fff}
    .tab{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #d9e0e8;border-radius:8px 8px 0 0;
      padding:8px 12px;width:200px}
  </style></head><body>
    <h1>a2b TAB — app icons</h1>
    <p>Source: app/public/icons/icon.svg (paths, no font). Navy #0f4c81 → #0a365d, white "a2b", sky-blue airflow line and "TAB".</p>
    <div class="row">
      ${img('icon-512.png', 256, 'icon-512.png (any)')}
      ${img('icon-maskable-512.png', 256, 'icon-maskable-512.png', 'border-radius:50%')}
      ${img('icon-maskable-512.png', 256, 'maskable (squircle mask)', 'border-radius:28%')}
      ${img('apple-touch-icon-180.png', 180, 'apple-touch-icon-180.png', 'border-radius:22%')}
    </div>
    <div class="row">
      ${img('icon-192.png', 96, 'icon-192.png')}
      ${img('icon-maskable-192.png', 96, 'maskable-192', 'border-radius:50%')}
      <figure><img src="data:image/svg+xml;base64,${b64(FAVICON)}" width="64" height="64"><figcaption>favicon.svg</figcaption></figure>
      ${img('favicon-32.png', 32, 'favicon-32')}
      ${img('favicon-16.png', 16, 'favicon-16')}
      <figure><div class="tab"><img src="data:image/png;base64,${rendered.get('favicon-32.png').toString('base64')}" width="16" height="16"> a2b TAB</div><figcaption>browser tab</figcaption></figure>
      <div class="dark">
        ${img('icon-192.png', 72, 'on dark')}
        ${img('favicon-32.png', 32, '32 px')}
      </div>
    </div>
    <div class="row">
      <div class="home">
        ${img('apple-touch-icon-180.png', 72, 'TAB', 'border-radius:22%')}
        ${img('icon-maskable-192.png', 72, 'TAB (Android)', 'border-radius:50%')}
        ${img('icon-192.png', 72, 'TAB (desktop)')}
        ${img('icon-maskable-192.png', 72, 'TAB (squircle)', 'border-radius:30%')}
      </div>
    </div>
  </body></html>`;
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.setContent(html);
  const docShots = join(here, '..', '..', 'docs', 'screenshots');
  await page.screenshot({ path: join(docShots, '28-icons.png'), fullPage: true });
  console.log('wrote docs/screenshots/28-icons.png');
}
await browser.close();
