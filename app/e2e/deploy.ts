/**
 * E2E: deployment and field-use features, run against deploy/serve-dist.ts (the production headers, incl. the CSP).
 *   - install prompt: Chrome / Android (a beforeinstallprompt event → "Install app" → the browser prompt) and the
 *     iPhone "Share → Add to Home Screen" hint (dismissed, stays dismissed after a reload);
 *   - update toast: sw.js changes on the server (test hook) → "Update available" → Reload → the new worker controls;
 *   - Share…: with a Web Share stub the exported .xlsm and a PDF report go to navigator.share; without Web Share (plain
 *     headless Chromium) "Download again" downloads the file;
 *   - export reminder: the project card's "Last exported … · N changes since", the reminder when leaving a project;
 *   - custom scope on a MAU: a section switched off on Info shows N/A (scope) on the unit.
 */
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';

type Check = (name: string, ok: boolean, detail?: string) => void;

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function importProject(page: Page, base: string, file: string) {
  await page.goto(`${base}/import`);
  await page.locator('input[aria-label="Workbook file"]').setInputFiles(file);
  await page.getByTestId('import-create').click();
  await page.getByTestId('equip-RTU-1').waitFor();
  return page.url().replace(/\/equipment$/, '');
}

async function fakeInstallPrompt(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __prompted: number };
    w.__prompted = 0;
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    e.prompt = () => {
      w.__prompted++;
      return Promise.resolve();
    };
    e.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(e);
  });
}

export async function deployFlow(
  browser: Browser,
  base: string,
  file: string,
  docShots: string,
  shotsDir: string,
  check: Check,
  opts: { testHooks: boolean },
): Promise<void> {
  const contexts: BrowserContext[] = [];
  try {
    // ---------------------------------------------------------------- install prompt (Chrome / Android)
    const android = await browser.newContext({ ...PHONE, colorScheme: 'light' });
    contexts.push(android);
    const page = await android.newPage();
    page.on('dialog', (d) => void d.accept());
    await importProject(page, base, file);
    await page.goto(base);
    await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
    check(
      'install: no card until the browser offers installation',
      (await page.getByTestId('install-prompt').count()) === 0,
    );
    await fakeInstallPrompt(page);
    await page.getByTestId('install-app').waitFor();
    await page.screenshot({ path: join(docShots, '26-install-prompt.png') });
    await page.getByTestId('install-app').click();
    await page.waitForTimeout(200);
    check(
      'install: "Install app" opens the browser prompt once, then the card goes away',
      (await page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)) === 1 &&
        (await page.getByTestId('install-prompt').count()) === 0,
    );

    // ---------------------------------------------------------------- update toast (a new service worker)
    if (opts.testHooks) {
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 15_000 });
      const before = await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL,
      );
      const bumped = await (await fetch(`${base}/__test/bump-sw`, { method: 'POST' })).text();
      await page.evaluate(async () => {
        const r = await navigator.serviceWorker.getRegistration();
        await r?.update();
      });
      await page.getByTestId('update-toast').waitFor({ timeout: 20_000 });
      const toast = await page.getByTestId('update-toast').innerText();
      await page.screenshot({ path: join(shotsDir, '26b-update-toast.png') });
      const [nav] = await Promise.all([
        page
          .waitForEvent('framenavigated', { timeout: 20_000 })
          .then(() => true)
          .catch(() => false),
        page.getByTestId('update-reload').click(),
      ]);
      await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
      await page.waitForTimeout(300);
      const after = await page.evaluate(async () => {
        const r = await navigator.serviceWorker.getRegistration();
        return { waiting: Boolean(r?.waiting), active: r?.active?.state };
      });
      check(
        'update: a new service worker → "Update available" toast → Reload activates it (page reloaded)',
        /Update available/.test(toast) &&
          nav &&
          !after.waiting &&
          after.active === 'activated' &&
          (await page.getByTestId('update-toast').count()) === 0,
        `${bumped}; ${before ?? '?'}; after reload waiting=${after.waiting} active=${after.active}`,
      );
    } else {
      check('update toast: skipped (needs deploy/serve-dist.ts test hooks)', true);
    }

    // ---------------------------------------------------------------- export reminder
    await page.getByTestId('project-card').first().waitFor();
    const beforeExport = await page.getByTestId('project-export-state').first().innerText();
    await page.getByTestId('project-card').first().click();
    await page.getByTestId('export-reminder-armed').waitFor({ state: 'attached' });
    await page.getByRole('link', { name: 'Back' }).click();
    await page.getByTestId('export-reminder').waitFor({ timeout: 5000 });
    const reminder = await page.getByTestId('export-reminder').innerText();
    await page.screenshot({ path: join(shotsDir, '26c-export-reminder.png') });
    await page.getByTestId('export-reminder-export').click();
    await page.waitForURL(/\/export$/);
    check(
      'export reminder: an imported, never exported project warns when leaving; "Go to Export" opens the tab',
      /Not exported yet/.test(beforeExport) && /Export before you leave\?/.test(reminder),
      `${beforeExport} | ${reminder.replace(/\s+/g, ' ').slice(0, 120)}`,
    );

    // ---------------------------------------------------------------- Share… fallback (no Web Share in headless Chromium)
    const hasShare = await page.evaluate(() => typeof navigator.share === 'function');
    await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), page.getByTestId('export-xlsm').click()]);
    await page.getByTestId('export-result').waitFor();
    const exportState = await page.getByTestId('export-state').innerText();
    const [again] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }),
      page.getByTestId('share-xlsm-download').click(),
    ]);
    const details = await page.getByTestId('export-details').innerText();
    check(
      'share fallback: without Web Share the result offers "Download again", which downloads the .xlsm',
      !hasShare && again.suggestedFilename().endsWith('.xlsm') && (await page.getByTestId('share-xlsm').count()) === 0,
      again.suggestedFilename(),
    );
    check(
      'export result: technical notes hidden behind "Technical details"; Export tab shows the export state',
      /Technical details/.test(details) &&
        !(await page.getByTestId('export-details').evaluate((d) => (d as HTMLDetailsElement).open)) &&
        /Last exported .* no changes since/.test(exportState),
      exportState,
    );
    await page.goto(`${page.url().replace(/\/export$/, '')}/info`);
    await page.locator('[data-field="architect"] input').first().fill('Lionakis Beaumont');
    await page.locator('[data-field="architect"] input').first().blur();
    await page.getByTestId('export-reminder-armed').waitFor({ state: 'attached' });
    await page.getByRole('link', { name: 'Back' }).click();
    await page.getByTestId('export-reminder-leave').click();
    await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
    const card = await page.getByTestId('project-export-state').first().innerText();
    check(
      'export reminder: after an edit the reminder shows again; "Leave" goes to the list, card counts the changes since',
      /Last exported .*· \d+ changes? since/.test(card) &&
        (await page.getByTestId('project-export-state').first().getAttribute('data-tone')) === 'amber',
      card,
    );

    // ---------------------------------------------------------------- iPhone: Add to Home Screen hint
    const ios = await browser.newContext({ ...PHONE, userAgent: IPHONE_UA });
    contexts.push(ios);
    const ip = await ios.newPage();
    await ip.goto(base);
    await ip.getByTestId('install-ios-hint').waitFor();
    const hint = await ip.getByTestId('install-ios-hint').innerText();
    await ip.screenshot({ path: join(shotsDir, '26d-install-ios.png') });
    await ip.getByTestId('install-dismiss').click();
    await ip.reload();
    await ip.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
    check(
      'install (iPhone): "Share → Add to Home Screen" hint, no Install button; "Got it" stays dismissed after a reload',
      /Add to Home Screen/.test(hint) && (await ip.getByTestId('install-prompt').count()) === 0,
      hint.replace(/\s+/g, ' ').slice(0, 80),
    );

    // ---------------------------------------------------------------- Share… with Web Share (stubbed)
    const sharer = await browser.newContext({ ...PHONE, acceptDownloads: true });
    contexts.push(sharer);
    // a string, not a function: tsx would add its __name helper to a serialized function
    await sharer.addInitScript(`
      window.__shared = [];
      Object.defineProperty(navigator, 'canShare', { value: (d) => Boolean(d && d.files && d.files.length) });
      Object.defineProperty(navigator, 'share', {
        value: async (d) => {
          for (const f of d.files || []) window.__shared.push({ name: f.name, type: f.type, size: f.size });
        },
      });
    `);
    const sp = await sharer.newPage();
    sp.on('dialog', (d) => void d.accept());
    const projectUrl = await importProject(sp, base, file);
    await sp.goto(`${projectUrl}/export`);
    await Promise.all([sp.waitForEvent('download', { timeout: 20_000 }), sp.getByTestId('export-xlsm').click()]);
    await sp.getByTestId('share-xlsm').waitFor();
    await sp.getByTestId('export-result').evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await sp.evaluate(() => window.scrollBy(0, 60));
    await sp.screenshot({ path: join(docShots, '27-export-share.png') });
    await sp.getByTestId('share-xlsm').click();
    await Promise.all([sp.waitForEvent('download', { timeout: 30_000 }), sp.getByTestId('report-issues').click()]);
    await sp.getByTestId('share-report').click();
    await sp.waitForTimeout(200);
    const shared = await sp.evaluate(
      () => (window as unknown as { __shared: { name: string; type: string; size: number }[] }).__shared,
    );
    check(
      'share: "Share…" hands the .xlsm and the PDF report to navigator.share (name, type, bytes)',
      shared.length === 2 &&
        shared[0].name.endsWith('.xlsm') &&
        shared[0].type.toLowerCase() === 'application/vnd.ms-excel.sheet.macroenabled.12' &&
        shared[0].size > 1_000_000 &&
        shared[1].name.endsWith('.pdf') &&
        shared[1].type === 'application/pdf',
      shared.map((s) => `${s.name} (${s.type}, ${s.size})`).join(' | '),
    );

    // ---------------------------------------------------------------- custom scope on another type (MAU)
    await sp.goto(`${base}/new`);
    await sp.locator('#np-name').fill('Custom scope job');
    await sp.getByRole('button', { name: /^Custom/ }).click();
    await sp.getByRole('button', { name: 'Create project' }).click();
    await sp.waitForURL(/\/p\/.+\/info$/);
    const cUrl = sp.url().replace(/\/info$/, '');
    await sp.getByTestId('scope-mau').locator('summary').click();
    await sp.getByTestId('scope-mau').getByRole('button', { name: 'Static pressure profile' }).click();
    await sp.waitForTimeout(300);
    const summary = await sp.getByTestId('scope-mau').locator('summary').innerText();
    await sp.goto(`${cUrl}/equipment`);
    await sp.getByTestId('add-equipment').click();
    await sp.getByRole('button', { name: /^MAUs\b/ }).click();
    await sp.getByRole('button', { name: 'Add MAU-1' }).click();
    await sp.waitForURL(/\/e\//);
    await sp.locator('#sec-static').waitFor();
    const staticHead = await sp.locator('#sec-static .section-head').innerText();
    const motorHead = await sp.locator('#sec-motor .section-head').innerText();
    check(
      'custom scope: MAU "Static pressure profile" switched off on Info → N/A (scope) on MAU-1, other sections unaffected',
      /1 of \d+ sections off/.test(summary) && /N\/A \(scope\)/.test(staticHead) && !/scope/.test(motorHead),
      `${summary.replace(/\s+/g, ' ')} | ${staticHead.replace(/\s+/g, ' ')} | ${motorHead.replace(/\s+/g, ' ')}`,
    );
  } finally {
    for (const c of contexts) await c.close();
  }
}
