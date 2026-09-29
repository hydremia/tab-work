/**
 * E2E: the report check. A workbook exported earlier in the run is checked on /check without importing it (the page
 * reads it in memory), then imported, and the project's Export tab shows the same checklist; a finding links to the
 * page that fixes it. Screenshot 41.
 */
import { join } from 'node:path';
import type { Browser } from 'playwright-core';

type Check = (name: string, ok: boolean, detail?: string) => void;

export async function reviewFlow(browser: Browser, base: string, workbookFile: string, docShots: string, check: Check) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    // ---- a file, without importing it
    await page.goto(base);
    await page.getByTestId('check-link').click();
    await page.waitForURL(/\/check$/);
    await page.locator('input[aria-label="Workbook to check"]').setInputFiles(workbookFile);
    const card = page.getByTestId('report-check');
    await card.waitFor({ timeout: 20_000 });
    const summary = await page.getByTestId('report-check-summary').innerText();
    const projects = await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      return dbs.map((d) => d.name).join(',');
    });
    check(
      'report check: a workbook file is checked without importing it (no "complete" check, it needs photos)',
      /to check · \d+ OK/.test(summary) && (await page.getByTestId('check-complete').count()) === 0,
      `${summary} | dbs ${projects}`,
    );
    await page.screenshot({ path: join(docShots, '41-report-check.png') });

    // ---- the same file as a project: the Export tab shows the checklist, a finding links to its page
    await page.goto(`${base}/import`);
    await page.locator('input[aria-label="Workbook file"]').setInputFiles(workbookFile);
    await page.getByTestId('import-create').click();
    await page.waitForURL(/\/p\/[^/]+\/equipment/);
    const projectUrl = page.url().replace(/\/equipment.*$/, '');
    await page.goto(`${projectUrl}/export`);
    await page.getByTestId('report-check').waitFor();
    const complete = page.getByTestId('check-complete');
    const status = await complete.getAttribute('data-status');
    await complete.locator('summary').click();
    const firstLink = complete.locator('a').first();
    const hasLink = (await firstLink.count()) > 0;
    if (hasLink) {
      await firstLink.click();
      await page.waitForURL(/\/e\//);
    }
    check(
      'report check: on the Export tab; imported units have no photos, so "Every unit complete" asks to check and links to the unit',
      status === 'warn' && hasLink && /\/e\//.test(page.url()),
      `status ${status} → ${page.url()}`,
    );
    check('report check e2e: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}
