/**
 * End-to-end walk through the vertical slice in a real (headless) Chromium at iPhone size (390 x 844):
 *   create project -> project info (+ cover photo) -> add 2 RTUs -> fill RTU-1 completely (outlet rows, one N/A)
 *   -> card colors (RTU-1 green, RTU-2 gray) -> export .xlsm (download) -> verify the file with the workbook
 *   library's importer in Node -> reload (IndexedDB persisted) -> offline: app shell loads, edits save, export works.
 *
 *   npm run build && npm run e2e          (serves dist/ with deploy/serve-dist.ts on port 4173: the production
 *                                          headers incl. the Content-Security-Policy; E2E_SERVER=vite uses
 *                                          `vite preview` instead, without the headers)
 *
 * Browser: playwright-core's Chromium from PLAYWRIGHT_BROWSERS_PATH, or CHROMIUM_PATH / /opt/pw-browsers/chromium.
 * Screenshots go to app/e2e-screenshots/ (git-ignored).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { chromium, type Browser, type Page } from 'playwright-core';
import { importWorkbook } from '@a2b/workbook';
import { fillNewTypes, readLivePanels, recalcCrossCheck, verifyNewTypes } from './newTypes';
import { reimportFlow } from './reimport';
import { photosFlow } from './photos';
import { pressuresAndAttention, scheduleFlow } from './features';
import { workflowFlow } from './workflow';
import { deployFlow } from './deploy';
import { syncFlow } from './sync';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(APP, 'e2e-screenshots');
const OUT = join(APP, 'e2e-output');
const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const COVER = join(APP, '..', 'spike', 'export', 'sample', 'cover-photo.jpg');
const DOC_SHOTS = join(APP, '..', 'docs', 'screenshots');

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
}
const shot = (page: Page, name: string, fullPage = false) =>
  page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage });

/** The production-like server (deploy/serve-dist.ts: CSP and caching headers, SPA fallback, test hooks). */
const USE_VITE = process.env.E2E_SERVER === 'vite';

async function startPreview(): Promise<ChildProcess | null> {
  if (process.env.E2E_BASE_URL) return null;
  if (!existsSync(join(APP, 'dist', 'index.html'))) throw new Error('dist/ missing: run `npm run build` first');
  const busy = await fetch(BASE).then(
    () => true,
    () => false,
  );
  if (busy) throw new Error(`port ${PORT} is already in use (a stale preview server?): stop it or set E2E_PORT`);
  const proc = USE_VITE
    ? spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
        cwd: APP,
        stdio: 'pipe',
        detached: true,
      })
    : spawn('npx', ['tsx', 'deploy/serve-dist.ts'], {
        cwd: APP,
        stdio: 'pipe',
        detached: true, // own process group: stopServer() ends npx and the server it started

        env: { ...process.env, PORT: String(PORT), SERVE_TEST_HOOKS: '1' },
      });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(BASE)).ok) return proc;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  stopServer(proc);
  throw new Error('vite preview did not start');
}

/**
 * The two-device sync walk runs on a second build with VITE_FAKE_SYNC=1 (app/dist-fake; the production build has no
 * fake code) served on PORT + 1 with the fake sync server (deploy/serve-dist.ts, SERVE_FAKE_SYNC=1).
 */
async function startFakeCloud(): Promise<{ proc: ChildProcess; base: string } | null> {
  if (USE_VITE || process.env.E2E_BASE_URL || process.env.E2E_SKIP_SYNC) return null;
  const port = PORT + 1;
  const base = `http://localhost:${port}`;
  const built = spawnSync('npx', ['vite', 'build', '--outDir', 'dist-fake', '--emptyOutDir', '--logLevel', 'error'], {
    cwd: APP,
    env: { ...process.env, VITE_FAKE_SYNC: '1' },
    stdio: 'inherit',
  });
  if (built.status !== 0) throw new Error('fake-cloud build failed');
  const proc = spawn('npx', ['tsx', 'deploy/serve-dist.ts'], {
    cwd: APP,
    stdio: 'pipe',
    detached: true,
    env: { ...process.env, PORT: String(port), DIST_DIR: 'dist-fake', SERVE_FAKE_SYNC: '1' },
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) return { proc, base };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  stopServer(proc);
  throw new Error('fake-cloud server did not start');
}

/** Stop the server's whole process group (npx leaves its child running when only npx is killed). */
function stopServer(proc: ChildProcess): void {
  try {
    if (proc.pid) process.kill(-proc.pid, 'SIGTERM');
  } catch {
    proc.kill();
  }
}

async function launch(): Promise<Browser> {
  // 1. CHROMIUM_PATH, 2. playwright-core's own lookup (PLAYWRIGHT_BROWSERS_PATH), 3. the preinstalled binary
  const attempts: (string | undefined)[] = process.env.CHROMIUM_PATH ? [process.env.CHROMIUM_PATH] : [];
  attempts.push(undefined, '/opt/pw-browsers/chromium');
  let last: unknown;
  for (const executablePath of attempts) {
    try {
      return await chromium.launch({ executablePath });
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

const field = (page: Page, key: string, el = 'input') => page.locator(`[data-field="${key}"] ${el}`).first();

async function fill(page: Page, values: Record<string, string | number>) {
  for (const [k, v] of Object.entries(values)) {
    await field(page, k).fill(String(v));
    await field(page, k).blur();
  }
}
async function select(page: Page, values: Record<string, string>) {
  for (const [k, v] of Object.entries(values)) await field(page, k, 'select.select').selectOption(v);
}
async function yesNo(page: Page, key: string, v: 'Yes' | 'No') {
  await page.locator(`[data-field="${key}"] button`, { hasText: v }).click();
}

async function main() {
  rmSync(SHOTS, { recursive: true, force: true });
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const server = await startPreview();
  const browser = await launch();
  // every page of every context: report CSP violations (securitypolicyviolation events and console reports)
  const cspViolations: string[] = [];
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const ctx = await newContext(options);
    await ctx.addInitScript(`
      document.addEventListener('securitypolicyviolation', (e) =>
        console.error('CSP violation: ' + e.violatedDirective + ' blocked ' + (e.blockedURI || '(inline)')),
      );
    `);
    ctx.on('console', (m) => {
      const t = m.text();
      if (/CSP violation|Content Security Policy|Refused to (load|execute|apply|connect|create)/i.test(t))
        cspViolations.push(t);
    });
    return ctx;
  };
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
    colorScheme: 'light',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => void d.accept());

  try {
    // ------------------------------------------------------------------ production headers (CSP)
    const head = await fetch(BASE);
    const csp = head.headers.get('content-security-policy') ?? '';
    const underCsp = /script-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp);
    check(
      underCsp ? 'served with the production headers (CSP, nosniff, Permissions-Policy)' : 'served without headers',
      USE_VITE || (underCsp && head.headers.get('x-content-type-options') === 'nosniff'),
      csp.slice(0, 90),
    );

    // ------------------------------------------------------------------ project list + create
    await page.goto(BASE);
    await page.getByRole('heading', { name: 'Projects' }).waitFor();
    check(
      'app loads, local-mode banner shown',
      await page.getByTestId('local-banner').isVisible(),
      await page.getByTestId('sync-status').innerText(),
    );
    await page.getByRole('link', { name: 'New project' }).click();
    await page.locator('#np-name').fill('Riverside Medical Office');
    await page.locator('#np-address').fill('1450 Riverside Dr, Sacramento, CA');
    await page.locator('#np-date').fill('2026-09-15');
    await shot(page, '01-new-project');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.waitForURL(/\/p\/.+\/info$/);
    const projectUrl = page.url().replace(/\/info$/, '');

    // ------------------------------------------------------------------ project info
    await fill(page, {
      architect: 'Lionakis',
      mechanicalEngineer: 'Capital Engineering',
      generalContractor: 'Otto & Sons',
      mechanicalContractor: 'Air Systems Inc.',
      technicians: 'J. Alvarez, M. Chen',
      projectManager: 'R. Singh',
    });
    await field(page, 'reportDate').fill('2026-09-24');
    await field(page, 'electricalEngineer', 'select.na-select').selectOption('N/A');
    await field(page, 'narrative', 'textarea').fill('Two packaged rooftop units serving the lobby and suites.');
    await field(page, 'narrative', 'textarea').blur();
    await page.locator('#bp-sheet-0').fill('M-101 Mechanical Floor Plan');
    await page.locator('#bp-sheet-0').blur();
    await page.locator('#bp-date-0').fill('2026-06-12');
    if (existsSync(COVER)) await page.locator('input[aria-label="Cover photo"]').setInputFiles(COVER);
    await page.waitForTimeout(600);
    check(
      'electrical engineer marked N/A',
      (await page.getByTestId('na-electricalEngineer').innerText()).includes('N/A'),
    );
    await shot(page, '02-project-info');

    // ------------------------------------------------------------------ add 2 RTUs
    await page.getByRole('link', { name: /^Equipment/ }).click();
    await page.getByTestId('add-equipment').click();
    await page.getByRole('button', { name: 'Add & add another' }).click();
    await page.waitForTimeout(300);
    const second = await page.locator('#eq-designation').inputValue();
    check('designation suggestion increments', second === 'RTU-2', second);
    await page.getByRole('button', { name: 'Add RTU-2' }).click();
    await page.waitForURL(/\/e\//);
    await page.getByRole('link', { name: 'Back' }).click();
    await page.getByTestId('equip-RTU-1').waitFor();
    check(
      'two RTUs listed, both gray',
      (await page.getByTestId('equip-RTU-1').getAttribute('data-color')) === 'gray' &&
        (await page.getByTestId('equip-RTU-2').getAttribute('data-color')) === 'gray',
    );

    // ------------------------------------------------------------------ fill RTU-1
    await page.getByTestId('equip-RTU-1').click();
    await page.waitForURL(/\/e\//);
    await fill(page, { areaServed: 'Lobby / Suites 101-104', location: 'Roof' });
    await fill(page, {
      manufacturer: 'Carrier',
      model: '48FC-D07',
      hp: 3,
      unitEsp: 0.8,
      fanRpm: 1100,
      voltage: 460,
      designTotalCfm: 1000,
      designOaCfm: 200,
    });
    await select(page, { phase: '3-phase', unitType: 'RTU' });
    await fill(page, { serial: '4719G20331', motorManufacturer: 'WEG', motorRpm: 1725, frame: '182T' });
    await select(page, { serviceFactor: 'SF 1.15' });
    await field(page, 'fla', 'select.na-select').selectOption('Not Avail.'); // the one N/A
    await fill(page, { volts1: 468, volts2: 465, volts3: 470, amps1: 3.9, amps2: 4.1, amps3: 4.0 });
    await select(page, { driveType: 'Belt' });
    await fill(page, {
      motorSheave: '1VP44 x 7/8',
      fanPulley: 'AK74 x 1',
      belts: 'A42',
      cToC: '14 1/4',
      sheaveBore: '7/8 / 1',
    });
    await fill(page, { rotationDesign: 'CW', rotationActual: 'CW' });
    await yesNo(page, 'hasFilters', 'Yes');
    await fill(page, { filters: '2" pleated 16x20 x 4', finalSettings: 'Sheave 2.5 turns open' });
    await fill(page, { motorRpmFinal: 1742, fanRpmFinal: 1105 });
    await yesNo(page, 'hasVfd', 'No');
    await fill(page, {
      oaDamper: '35 % open',
      spEntering: -0.35,
      spLeaving1: -0.55,
      spLeaving3: -0.95,
      spLeaving4: -1.05,
      spLeaving5: 0.72,
    });
    await select(page, { instrument: 'Flow Hood' });
    // outlet rows: first one typed, the second one pre-filled from the first ("fill down")
    await page.getByTestId('add-supply').click();
    const r0 = page.getByTestId('row-supply-0');
    await r0.waitFor();
    for (const [k, v] of Object.entries({
      no: 'S-1',
      area: 'Lobby',
      type: 'CD',
      size: '24x24',
      ak: '1',
      designCfm: '500',
      initialVel: '480',
      finalVel: '505',
    })) {
      await page.locator(`#supply-0-${k}`).fill(v);
    }
    await page.locator('#supply-0-finalVel').blur();
    await page.waitForTimeout(500);
    await page.getByTestId('add-supply').click();
    await page.getByTestId('row-supply-1').waitFor();
    const filledDown = await page.locator('#supply-1-no').inputValue();
    check(
      'new outlet row numbered and filled down from the previous row',
      filledDown === 'S-2' && (await page.locator('#supply-1-size').inputValue()) === '24x24',
      filledDown,
    );
    await page.locator('#supply-1-designCfm').fill('500');
    await page.locator('#supply-1-finalVel').fill('470');
    await page.locator('#supply-1-finalVel').blur();
    check(
      'numeric keypad on readings',
      (await page.locator('#supply-1-finalVel').getAttribute('inputmode')) === 'decimal',
    );
    await page.getByTestId('add-oa').click();
    await page.getByTestId('row-oa-0').waitFor();
    for (const [k, v] of Object.entries({
      no: 'OA-1',
      area: 'Economizer',
      type: 'OA',
      size: '36x18',
      ak: '4.5',
      designCfm: '200',
      finalVel: '45',
    })) {
      await page.locator(`#oa-0-${k}`).fill(v);
    }
    await page.locator('#oa-0-finalVel').blur();
    await page.waitForTimeout(500);
    const calc = await page.getByTestId('row-supply-0').locator('.outlet-foot').innerText();
    check(
      'live CFM = VEL x Ak and % of design',
      /final 505/.test(calc) && /101 %/.test(calc),
      calc.replace(/\s+/g, ' '),
    );
    // photos: one real photo, one N/A, one Not Acc.
    await page.locator('input[aria-label="Unit photo"]').setInputFiles(join(APP, 'public', 'icons', 'icon-512.png'));
    await page.getByTestId('photo-tag').locator('select.na-select').selectOption('N/A');
    await page.getByTestId('photo-oa_damper').locator('select.na-select').selectOption('Not Acc.');
    await page.waitForTimeout(800);
    await page.locator('#sec-remarks textarea').fill('Belt replaced during TAB.');
    await page.locator('#sec-remarks textarea').blur();
    await page.waitForTimeout(500);
    const badge = await page.getByTestId('status-badge').first().innerText();
    const progress = await page.getByTestId('unit-progress').innerText();
    check('RTU-1 complete (green) after filling everything', badge.includes('Complete'), `${badge}; ${progress}`);

    // live static profile + motor panels (checked against the recalculated export further down)
    const rtuUi: Record<string, string> = {};
    await readLivePanels(page, 'rtu', rtuUi);
    check(
      'RTU-1 static profile: TSP 1.77, ESP 1.07, unit ΔP -0.70 in. w.g.; filter Δ -0.20, wheel absent, coil Δ -0.40',
      rtuUi['rtu.sp-tsp'] === '1.77 in. w.g.' &&
        rtuUi['rtu.sp-esp'] === '1.07 in. w.g.' &&
        rtuUi['rtu.sp-unitdp'] === '-0.70 in. w.g.' &&
        rtuUi['rtu.sp-dp-1'] === 'Δ -0.20' &&
        rtuUi['rtu.sp-dp-2'] === 'absent' &&
        rtuUi['rtu.sp-dp-3'] === 'Δ -0.40' &&
        rtuUi['rtu.unit-esp-actual'] === '1.07',
      JSON.stringify(rtuUi),
    );
    check(
      'RTU-1 motor: avg 467.7 V / 4.00 A, corrected FLA blank (FLA Not Avail.), BHP 3.13 (3-phase)',
      rtuUi['rtu.motor-avg-volts'].startsWith('467.7 V') &&
        rtuUi['rtu.motor-avg-amps'].startsWith('4.00 A') &&
        rtuUi['rtu.motor-fla'] === '—' &&
        rtuUi['rtu.motor-bhp'] === '3.13',
    );
    const espWarn = await page.getByTestId('esp-warning').innerText();
    const bhpWarn = await page.getByTestId('motor-warning-bhp').innerText();
    check(
      'amber field checks: ESP 1.07 vs design 0.80 (134 %), BHP 3.13 above 3 HP; ESP in the unit summary',
      /design 0\.80 vs\. actual 1\.07/.test(espWarn) &&
        /3\.13 is above the nameplate 3 HP/.test(bhpWarn) &&
        (await page.getByTestId('summary-esp-warning').count()) === 1 &&
        (await page.getByTestId('motor-warning-amps').count()) === 0,
      `${espWarn} | ${bhpWarn}`,
    );
    // screenshot: motor and static panels together (the sections in between folded, a taller viewport)
    for (const key of ['drive', 'misc', 'rpm', 'oa'])
      await page.locator(`#sec-${key} .section-head button.toggle`).click();
    await page.setViewportSize({ width: 390, height: 1800 });
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="calc-motor"]');
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 150);
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(DOC_SHOTS, '13-rtu-static-motor.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const key of ['drive', 'misc', 'rpm', 'oa'])
      await page.locator(`#sec-${key} .section-head button.toggle`).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '03-rtu-form-top');
    await page.locator('#sec-airflow').scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const el = document.getElementById('sec-airflow');
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 110);
    });
    await shot(page, '04-rtu-airflow');
    await shot(page, '04b-rtu-full', true);

    // tolerance: push S-2 out of tolerance -> red, then back
    await page.locator('#supply-1-finalVel').fill('400');
    await page.locator('#supply-1-finalVel').blur();
    await page.waitForTimeout(500);
    check(
      'reading outside ±10 % turns the unit red',
      (await page.getByTestId('status-badge').first().innerText()).includes('Issue / tolerance'),
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '05-rtu-out-of-tolerance');
    await page.locator('#supply-1-finalVel').fill('470');
    await page.locator('#supply-1-finalVel').blur();
    await page.waitForTimeout(500);

    // ------------------------------------------------------------------ card colors
    await page.goto(`${projectUrl}/equipment`);
    await page.getByTestId('equip-RTU-1').waitFor();
    const c1 = await page.getByTestId('equip-RTU-1').getAttribute('data-color');
    const c2 = await page.getByTestId('equip-RTU-2').getAttribute('data-color');
    check('card colors: RTU-1 green, RTU-2 gray', c1 === 'green' && c2 === 'gray', `RTU-1 ${c1}, RTU-2 ${c2}`);
    const roll = await page.getByTestId('rollup-rtu').innerText();
    check('type rollup "RTUs 1/2 complete"', roll.includes('1/2 complete'), roll);
    await shot(page, '06-equipment-list');
    await page.getByRole('button', { name: 'Needs data' }).click();
    check(
      '"Needs data" filter hides the complete unit',
      (await page.getByTestId('equip-RTU-1').count()) === 0 && (await page.getByTestId('equip-RTU-2').count()) === 1,
    );
    await page.getByRole('button', { name: 'All' }).click();

    // ------------------------------------------------------------------ MAU, ERV, fan, small fan, hood, traverse
    const { ui } = await fillNewTypes(page, projectUrl, check, DOC_SHOTS, join(APP, 'public', 'icons', 'icon-512.png'));

    // ------------------------------------------------------------------ building pressures, needs attention
    await pressuresAndAttention(page, projectUrl, DOC_SHOTS, check);

    // ------------------------------------------------------------------ export
    await page.getByRole('link', { name: 'Export' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-xlsm').click()]);
    const file = join(OUT, download.suggestedFilename());
    await download.saveAs(file);
    await page.getByTestId('export-result').waitFor();
    check('export downloads an .xlsm', file.endsWith('.xlsm'), download.suggestedFilename());
    await shot(page, '07-export');

    // verify the file with the workbook library (Node)
    const bytes = new Uint8Array(readFileSync(file));
    const wb = await importWorkbook(bytes);
    const info = wb.sections.projectInfo?.fields ?? {};
    const rtus = wb.equipment.rtu ?? [];
    const u1 = rtus.find((u) => u.slot === 1);
    const u2 = rtus.find((u) => u.slot === 2);
    check(
      'workbook: project information',
      info.projectName === 'Riverside Medical Office' &&
        info.tabDate === '2026-09-15' &&
        info.reportDate === '2026-09-24' &&
        info.electricalEngineer === 'N/A' &&
        info.architect === 'Lionakis',
      JSON.stringify(info),
    );
    check(
      'workbook: narrative + blueprint',
      wb.sections.narrative?.fields?.text === 'Two packaged rooftop units serving the lobby and suites.' &&
        wb.sections.projectInfo?.tables?.blueprints?.[0]?.sheet === 'M-101 Mechanical Floor Plan',
    );
    check(
      'workbook: RTU-1 schedule row',
      u1?.schedule?.designation === 'RTU-1' &&
        u1.schedule.manufacturer === 'Carrier' &&
        u1.schedule.designTotalCfm === 1000 &&
        u1.schedule.phase === '3-phase',
      JSON.stringify(u1?.schedule),
    );
    check(
      'workbook: RTU-1 block fields incl. the N/A notation',
      u1?.fields?.serial === '4719G20331' &&
        u1.fields.fla === 'Not Avail.' &&
        u1.fields.driveType === 'Belt' &&
        u1.fields.spLeaving5 === 0.72 &&
        u1.fields.serviceFactor === 'SF 1.15',
      JSON.stringify(u1?.fields),
    );
    check(
      'workbook: RTU-1 outlet rows',
      JSON.stringify(u1?.tables?.supply) ===
        JSON.stringify([
          {
            no: 'S-1',
            area: 'Lobby',
            type: 'CD',
            size: '24x24',
            ak: 1,
            designCfm: 500,
            initialVel: 480,
            finalVel: 505,
          },
          { no: 'S-2', area: 'Lobby', type: 'CD', size: '24x24', ak: 1, designCfm: 500, finalVel: 470 },
        ]) && u1?.tables?.oa?.[0]?.finalVel === 45,
      JSON.stringify(u1?.tables),
    );
    check('workbook: remarks', u1?.lines?.remarks?.[0] === 'Belt replaced during TAB.');
    const bb = wb.sections.buildingBalance;
    check(
      'workbook: Building Balance pressures (rows 97-99) and notes',
      JSON.stringify(bb?.tables?.pressures) ===
        JSON.stringify([
          {
            testSpace: 'Building',
            referenceSpace: 'Outdoors',
            dp: 0.02,
            remarks: 'All doors closed, RTUs in occupied mode',
          },
          { testSpace: 'Kitchen', referenceSpace: 'Dining', dp: -0.01, remarks: 'Hood and MAU running' },
          { testSpace: 'Suite 101', referenceSpace: 'Corridor', dp: 0.01 },
        ]) && bb?.lines?.notes?.[0] === 'Measured at 2 pm, wind calm.',
      JSON.stringify(bb),
    );
    const wbNew = await verifyNewTypes(bytes, check);
    await recalcCrossCheck(file, wbNew, { ...ui, ...rtuUi }, check);
    check('workbook: RTU-2 in slot 2', u2?.schedule?.designation === 'RTU-2', JSON.stringify(u2));
    const zip = await JSZip.loadAsync(bytes);
    const media = Object.keys(zip.files).filter((n) => n.startsWith('xl/media/'));
    const vba = zip.file('xl/vbaProject.bin');
    check('workbook: macros kept', Boolean(vba) && (await vba!.async('uint8array')).length > 90_000);
    if (existsSync(COVER)) {
      // the exporter adds the cropped photo as the next free xl/media/imageN.jpeg
      const jpeg = media
        .filter((n) => /image\d+\.jpeg$/.test(n))
        .sort((a, b) => Number(/(\d+)\.jpeg$/.exec(b)![1]) - Number(/(\d+)\.jpeg$/.exec(a)![1]))[0];
      const img = jpeg ? await zip.file(jpeg)!.async('uint8array') : undefined;
      let w = 0,
        h = 0; // JPEG SOF0/SOF2 marker scan
      for (let i = 2; img && i < img.length - 9;) {
        if (img[i] !== 0xff) break;
        const m = img[i + 1];
        const len = (img[i + 2] << 8) | img[i + 3];
        if (m === 0xc0 || m === 0xc2) {
          h = (img[i + 5] << 8) | img[i + 6];
          w = (img[i + 7] << 8) | img[i + 8];
          break;
        }
        i += 2 + len;
      }
      check(
        'workbook: cover photo cropped in the browser to the cover box (~1.685:1)',
        Boolean(jpeg) && Math.abs(w / h - 1.685) < 0.01,
        `${jpeg} ${w}x${h}`,
      );
    }

    // ------------------------------------------------------------------ photos, issues with photos, PDF reports, zip
    await photosFlow(page, projectUrl, OUT, DOC_SHOTS, check);

    // ------------------------------------------------------------------ reload: persisted in IndexedDB
    await page.goto(BASE);
    await page.getByTestId('project-card').waitFor();
    await shot(page, '00-project-list');
    await page.goto(`${projectUrl}/equipment`);
    await page.reload();
    await page.getByTestId('equip-RTU-1').waitFor();
    await page.getByTestId('equip-RTU-1').click();
    await page.waitForURL(/\/e\//);
    const serial = await field(page, 'serial').inputValue();
    const s0 = await page.locator('#supply-0-finalVel').inputValue();
    check(
      'after reload: data persisted',
      serial === '4719G20331' && s0 === '505' && (await page.getByTestId('na-fla').innerText()).includes('Not Avail.'),
      `${serial} / ${s0}`,
    );

    // ------------------------------------------------------------------ offline
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return reg.active?.state;
    });
    // wait until the service worker controls the page (precache done)
    for (let i = 0; i < 50 && !(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))); i++) {
      await page.waitForTimeout(200);
      if (i === 10) await page.reload();
    }
    check('service worker controls the page', await page.evaluate(() => Boolean(navigator.serviceWorker.controller)));
    await context.setOffline(true);
    await page.goto(BASE);
    await page.getByRole('heading', { name: 'Projects' }).waitFor({ timeout: 10_000 });
    check('offline: app shell loads from the service worker', await page.getByTestId('project-card').isVisible());
    await page
      .waitForFunction(
        () => /offline/i.test(document.querySelector('[data-testid="sync-status"]')?.textContent ?? ''),
        null,
        { timeout: 5000 },
      )
      .catch(() => undefined);
    const pill = await page.getByTestId('sync-status').innerText();
    check('offline: detected (status pill)', /offline/i.test(pill), pill);
    await shot(page, '08-project-list-offline');
    await page.getByTestId('project-card').click();
    await page.getByTestId('equip-RTU-2').click();
    await page.waitForURL(/\/e\//);
    await fill(page, { areaServed: 'Suites 105-108' });
    await page.waitForTimeout(400);
    await page.getByRole('link', { name: 'Back' }).click();
    await page.getByTestId('equip-RTU-2').waitFor();
    const c2b = await page.getByTestId('equip-RTU-2').getAttribute('data-color');
    await page.reload();
    await page.getByTestId('equip-RTU-2').waitFor();
    const sub = await page.getByTestId('equip-RTU-2').innerText();
    check(
      'offline: edit saved (and survives reload offline)',
      c2b === 'amber' && sub.includes('Suites 105-108'),
      sub.replace(/\s+/g, ' '),
    );
    await page.getByRole('link', { name: 'Export' }).click();
    const [dl2] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.getByTestId('export-xlsm').click(),
    ]);
    const file2 = join(OUT, `offline-${dl2.suggestedFilename()}`);
    await dl2.saveAs(file2);
    const wb2 = await importWorkbook(new Uint8Array(readFileSync(file2)));
    check(
      'offline: export still works (template precached)',
      wb2.equipment.rtu?.find((u) => u.slot === 2)?.schedule?.areaServed === 'Suites 105-108',
    );
    await context.setOffline(false);

    // ------------------------------------------------------------------ dark mode + desktop screenshots
    const dark = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
      isMobile: true,
      hasTouch: true,
    });
    const dp = await dark.newPage();
    // separate context = separate IndexedDB: import the exported workbook to have data
    await dp.goto(`${BASE}/import`);
    await dp.locator('input[aria-label="Workbook file"]').setInputFiles(file);
    await dp.getByTestId('import-summary').waitFor();
    await shot(dp, '09-import-dark');
    await dp.getByTestId('import-create').click();
    await dp.getByTestId('equip-RTU-1').waitFor();
    const imported = await dp.getByTestId('equip-RTU-1').getAttribute('data-color');
    const importedSub = await dp.getByTestId('equip-RTU-1').innerText();
    // photos (and photo N/A marks) live in the app, not in the workbook: after a re-import exactly those 3 items are
    // open ("VFD on the unit? No" comes back from the VSD frequency written as automatic "N/A")
    check(
      'import: exported workbook re-imports as a new project (RTU-1 amber: the 3 photos are open)',
      imported === 'amber' && importedSub.includes('3 required items missing'),
      `RTU-1 ${imported}: ${importedSub.replace(/\s+/g, ' ')}`,
    );
    await shot(dp, '10-equipment-dark');
    await dark.close();
    const wide = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const wp = await wide.newPage();
    await wp.goto(`${BASE}/import`);
    await wp.locator('input[aria-label="Workbook file"]').setInputFiles(file);
    await wp.getByTestId('import-create').click();
    await wp.getByTestId('equip-RTU-1').click();
    await wp.waitForURL(/\/e\//);
    await wp.locator('#sec-airflow').waitFor();
    await wp.evaluate(() => {
      const el = document.getElementById('sec-airflow');
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70);
    });
    await shot(wp, '11-rtu-airflow-desktop');
    await wide.close();

    // ------------------------------------------------------------------ re-import of an issued workbook, revisions
    await reimportFlow(browser, BASE, file, OUT, DOC_SHOTS, check);

    // ------------------------------------------------------------------ schedule import, duplicate (own project)
    await scheduleFlow(browser, BASE, file, DOC_SHOTS, check);

    // ------------------------------------------------------------------ review, issue / lock, unlock, history
    await workflowFlow(browser, BASE, file, OUT, DOC_SHOTS, check);

    // ------------------------------------------------------------------ install, update, share, export reminder
    await deployFlow(browser, BASE, file, DOC_SHOTS, SHOTS, check, {
      testHooks: !USE_VITE && !process.env.E2E_BASE_URL,
    });

    // ------------------------------------------------------------------ two devices: sign-in, sync, conflict
    const cloud = await startFakeCloud();
    if (cloud) {
      try {
        await syncFlow(browser, cloud.base, file, DOC_SHOTS, check, SHOTS);
      } finally {
        stopServer(cloud.proc);
      }
    } else console.log('SKIP  two-device sync walk (needs the local serve-dist server)');

    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    check(
      'no Content-Security-Policy violations in any context (camera input, photos, PDF, workbook, SW, IndexedDB)',
      cspViolations.length === 0,
      cspViolations.slice(0, 3).join(' | '),
    );
  } catch (e) {
    check('e2e run finished without an exception', false, e instanceof Error ? e.stack : String(e));
    await shot(page, 'zz-failure').catch(() => undefined);
  } finally {
    await browser.close();
    if (server) stopServer(server);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nE2E: ${results.length - failed} PASS, ${failed} FAIL. Screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
}

void main();
