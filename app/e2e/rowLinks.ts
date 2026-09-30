/**
 * E2E: issues and photos of one airflow line. A new project gets RTU-1 with supply outlets S-1 and S-2; from S-1's row
 * menu an issue is added (the Issues tab opens on it, its line set) and a photo taken; the row shows both chips; the
 * Photos tab labels the photo with the line; the workbook's Summary - New names the line after the unit.
 * Screenshot 44 (the row with its chips).
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { importWorkbook } from '@a2b/workbook';
import type { Browser } from 'playwright-core';
import { makeJpeg } from '../src/test/images';

type Check = (name: string, ok: boolean, detail?: string) => void;

export async function rowLinksFlow(browser: Browser, base: string, docShots: string, outDir: string, check: Check) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${base}/new`);
    await page.locator('#np-name').fill('Line links job');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.waitForURL(/\/p\/.+\/info$/);
    const projectUrl = page.url().replace(/\/info$/, '');
    await page.goto(`${projectUrl}/add`);
    await page.getByTestId('type-picker-air').getByRole('button', { name: /RTUs/ }).click();
    await page.locator('#eq-designation').fill('RTU-1');
    await page.getByRole('button', { name: 'Add RTU-1', exact: true }).click();
    await page.waitForURL(/\/e\//);
    const unitUrl = page.url();
    for (const [i, no] of [
      [0, 'S-1'],
      [1, 'S-2'],
    ] as const) {
      await page.getByTestId('add-supply').click();
      const el = page.getByTestId(`row-supply-${i}`).getByLabel(/ No\.$/);
      await el.fill(no);
      await el.blur();
    }
    await page.waitForTimeout(300);

    // an issue for S-1, from its row menu
    await page.getByTestId('row-supply-0').locator('select.row-menu').selectOption('line-issue');
    await page.waitForURL(/\/issues#issue-/);
    const card = page.locator('article.issue-card').first();
    await card.waitFor();
    const lineValue = await card
      .getByLabel(/airflow line/)
      .locator('option:checked')
      .innerText();
    await card.getByLabel('Remark').fill('Balancing damper stuck closed above the ceiling');
    await card.getByLabel('Remark').blur();
    check(
      'line links: "Add issue for this line" opens the new issue with the unit and the line set',
      /S-1 /.test(`${lineValue} `) && (await card.locator('select').first().inputValue()) !== '',
      lineValue,
    );

    // a photo of S-1
    await page.goto(unitUrl);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByTestId('row-supply-0').locator('select.row-menu').selectOption('line-photo'),
    ]);
    await chooser.setFiles({
      name: 'elbow.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(makeJpeg(320, 240, () => [120, 140, 160], 85)),
    });
    const chips = page.getByTestId('row-supply-0').getByTestId('row-links');
    await chips.getByText('📷 1').waitFor({ timeout: 15_000 });
    const chipText = await chips.innerText();
    const otherChips = await page.getByTestId('row-supply-1').getByTestId('row-links').count();
    check(
      'line links: the row shows its issue (⚑ N-1) and photo (📷 1); the other row none',
      /N-1/.test(chipText) && /📷 1/.test(chipText) && otherChips === 0,
      chipText.replace(/\s+/g, ' '),
    );
    await page.getByTestId('row-supply-0').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(docShots, '44-line-links.png') });

    // Photos tab: the photo is labelled with the line
    await page.goto(`${projectUrl}/photos`);
    // the line names load just after the photos: wait for the label to include the line
    await page
      .waitForFunction(
        () => document.querySelector('[data-testid="photo-card"]')?.getAttribute('data-label')?.endsWith('S-1'),
        undefined,
        { timeout: 5000 },
      )
      .catch(() => undefined);
    const label = await page.getByTestId('photo-card').first().getAttribute('data-label');
    check('line links: the Photos tab labels the photo with its line', label === 'RTU-1 · Other · S-1', String(label));

    // workbook: Summary - New names the line after the unit
    await page.goto(`${projectUrl}/export`);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-xlsm').click()]);
    const file = join(outDir, 'line-links.xlsm');
    await dl.saveAs(file);
    const back = await importWorkbook(new Uint8Array(readFileSync(file)));
    const remark = back.sections.issuesNew?.tables?.issues?.[0]?.remark;
    check(
      'line links: the workbook remark reads "RTU-1 · S-1: …"',
      remark === 'RTU-1 · S-1: Balancing damper stuck closed above the ceiling',
      String(remark),
    );
    check('line links e2e: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}
