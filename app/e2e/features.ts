/**
 * E2E: equipment schedule import, duplicate, building pressures, needs attention.
 *
 *  - pressuresAndAttention(): on the main walk's project (it has a hood, so Kitchen vs Dining is required) fill the
 *    Building Balance pressure table on Info, then open the Needs attention tab: RTU-1's ESP and BHP checks and the
 *    out-of-date balometer (Flow Hood on RTU-1, calibrated 2024-03-14, TAB 2026-09-15) are listed and linked;
 *  - scheduleFlow(): a fresh browser context and project: 9 MAUs pasted (set-up), then a paste of 4 RTUs (one with
 *    an invalid CFM, one unmapped column mapped by hand) and 2 MAUs (MAU-11 over capacity): preview, import, values
 *    normalized (phase, V/Ph/Hz); duplicate RTU-3 -> RTU-4 (next slot, design data copied); the TAB workbook source
 *    reads only the {Equipment Data Entry} of the main walk's export.
 */
import { join } from 'node:path';
import type { Browser, Page } from 'playwright-core';

type Check = (name: string, ok: boolean, detail?: string) => void;

const field = (page: Page, key: string, el = 'input') => page.locator(`[data-field="${key}"] ${el}`).first();

export async function pressuresAndAttention(page: Page, projectUrl: string, docShots: string, check: Check) {
  await page.goto(`${projectUrl}/info`);
  const card = page.getByTestId('building-pressures');
  await card.waitFor();
  check(
    'pressures: the project has a hood, so Kitchen vs Dining is required (not automatic N/A)',
    (await card.locator('[data-field="bbKitchenDp"]').getAttribute('data-state')) === 'missing',
  );
  const put = async (key: string, v: string) => {
    const el = card.locator(`[data-field="${key}"] ${key === 'bbNotes' ? 'textarea' : 'input'}`).first();
    await el.fill(v);
    await el.blur();
  };
  await put('bbBuildingDp', '0.02');
  await put('bbBuildingRemarks', 'All doors closed, RTUs in occupied mode');
  await put('bbKitchenDp', '-0.01');
  await put('bbKitchenRemarks', 'Hood and MAU running');
  await put('bbSpareTest', 'Suite 101');
  await put('bbSpareRef', 'Corridor');
  await put('bbSpareDp', '0.01');
  await put('bbNotes', 'Measured at 2 pm, wind calm.');
  await page.waitForTimeout(500);
  const missing = await page.getByTestId('project-completion').innerText();
  check(
    'pressures: filled on Info; project-level completion no longer lists them',
    !/ΔP/.test(missing),
    missing.replace(/\s+/g, ' ').slice(0, 160),
  );
  await card.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="building-pressures"]');
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 110);
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(docShots, '22-building-pressures.png') });

  // ------------------------------------------------ needs attention
  await page.goto(`${projectUrl}/equipment`);
  const count = Number((await page.getByTestId('attention-count').innerText()).trim());
  await page.getByTestId('attention-card').click();
  await page.waitForURL(/\/attention$/);
  await page.getByTestId('attention-item').first().waitFor();
  const items = await page
    .getByTestId('attention-item')
    .evaluateAll((els) =>
      els.map((e) => `${(e as HTMLElement).dataset.group}|${(e as HTMLElement).innerText.replace(/\s+/g, ' ')}`),
    );
  const tab = Number((await page.getByTestId('tab-count-attention').innerText()).trim());
  const has = (re: RegExp) => items.some((i) => re.test(i));
  check(
    'needs attention: RTU-1 ESP (design 0.80 vs 1.07) and BHP 3.13 > 3 HP, old balometer calibration; counts match',
    has(/^design\|RTU-1 Unit ESP: design 0\.80 vs\. actual 1\.07/) &&
      has(/^motor\|RTU-1 Estimated BHP 3\.13 is above the nameplate 3 HP/) &&
      has(/^calibration\|Flow Hood \(RTU-1.*calibrated 2024-03-14, more than 12 months before the TAB date/) &&
      count === items.length &&
      tab === items.length,
    `${count}/${tab}: ${items.join(' || ')}`,
  );
  await page.screenshot({ path: join(docShots, '21-needs-attention.png') });
  await page.locator('[data-testid="attention-item"][data-group="motor"]').first().click();
  await page.waitForURL(/\/e\/.+#sec-motor$/);
  await page.locator('#sec-motor').waitFor();
  const top = await page.evaluate(() => document.getElementById('sec-motor')!.getBoundingClientRect().top);
  check(
    'needs attention: an item opens its unit, scrolled to the section',
    /#sec-motor$/.test(page.url()) && top < 300,
    `${page.url()} (section top ${Math.round(top)} px)`,
  );
  await page.goto(`${projectUrl}/equipment`);
  await page.getByTestId('equip-RTU-1').waitFor();
}

async function paste(page: Page, type: string, text: string) {
  await page.locator('#si-type').selectOption(type);
  await page.getByLabel('Schedule rows').fill(text);
}

export async function scheduleFlow(
  browser: Browser,
  base: string,
  workbookFile: string,
  docShots: string,
  check: Check,
) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'light',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => void d.accept());
  try {
    await page.goto(`${base}/new`);
    await page.locator('#np-name').fill('Schedule import job');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.waitForURL(/\/p\/.+\/info$/);
    const projectUrl = page.url().replace(/\/info$/, '');

    // set-up: 9 MAUs from one paste (no header row: the first column is the designation)
    await page.goto(`${projectUrl}/equipment`);
    await page.getByTestId('import-schedule').click();
    await page.waitForURL(/\/schedule$/);
    await paste(page, 'mau', Array.from({ length: 9 }, (_, i) => `MAU-${i + 1}`).join('\n'));
    await page.getByTestId('preview-summary-mau').waitFor();
    const setupSummary = await page.getByTestId('preview-summary-mau').innerText();
    await page.getByTestId('schedule-import').click();
    await page.getByTestId('schedule-done').waitFor();
    check(
      'schedule paste without a header row: the first column is the designation (9 MAUs created)',
      /9 new/.test(setupSummary) && /9 units created/.test(await page.getByTestId('schedule-done').innerText()),
      setupSummary,
    );

    // the schedule: 4 RTUs (RTU-2's CFM is not a number; "Fan Motor" is not recognised and mapped by hand)
    await paste(
      page,
      'rtu',
      [
        'Tag\tArea Served\tMfr\tModel\tSupply CFM\tOA CFM\tESP\tFan Motor\tV/Ph/Hz\tPhase',
        'RTU-1\tLobby\tCarrier\t48FC-D07\t2,400\t600\t0.8\t3\t460/3/60\t',
        'RTU-2\tSuites 101-104\tCarrier\t48FC-D08\t2,4OO\t400\t0.75\t5\t460/3/60\t3',
        'RTU-3\tSuites 105-108\tTrane\tYSC090\t3000\t750\t0.9\t5\t208\t3 ph',
        'RTU-5\tGym\tTrane\tYSC060\t2000\t500\t0.7\t3\t208\tthree',
      ].join('\n'),
    );
    await page.getByTestId('preview-summary-rtu').waitFor();
    const hpCol = page.getByTestId('map-col-7');
    const hpBefore = await hpCol.inputValue();
    await hpCol.selectOption('hp');
    const summary = await page.getByTestId('preview-summary-rtu').innerText();
    const rowsText = await page.getByTestId('preview-row').allInnerTexts();
    check(
      'schedule paste: headers mapped automatically ("Fan Motor" mapped by hand), 3 new, 1 invalid row skipped',
      hpBefore === '' &&
        (await page.getByTestId('map-col-4').inputValue()) === 'designTotalCfm' &&
        (await page.getByTestId('map-col-8').inputValue()) === 'voltage' &&
        /3 new, 0 updated, 1 skipped/.test(summary) &&
        rowsText.some((t) => /RTU-2[\s\S]*Skip[\s\S]*"2,4OO" is not a number/.test(t)),
      `${summary} | ${rowsText.map((t) => t.replace(/\s+/g, ' ')).join(' || ')}`,
    );
    await page.evaluate(() => {
      const el = document.getElementById('si-map');
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70);
    });
    await page.setViewportSize({ width: 390, height: 1400 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(docShots, '20-schedule-import.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('schedule-import').click();
    await page.getByTestId('schedule-done').waitFor();
    check(
      'schedule import: 3 RTUs created',
      /3 units created, 0 updated/.test(await page.getByTestId('schedule-done').innerText()),
    );

    // 2 MAUs: MAU-10 fits, MAU-11 is over the 10-MAU capacity
    await paste(page, 'mau', 'Tag\tCFM\tHP\nMAU-10\t4000\t3\nMAU-11\t5000\t5');
    await page.getByTestId('preview-summary-mau').waitFor();
    const mauSummary = await page.getByTestId('preview-summary-mau').innerText();
    const capNote = await page.locator('.callout[data-tone="amber"]', { hasText: 'over capacity' }).innerText();
    const mauRows = await page.getByTestId('preview-row').allInnerTexts();
    check(
      'schedule paste: MAU-11 over capacity (10 MAUs), MAU-10 imported',
      /1 new, 0 updated, 1 skipped · 10 \/ 10/.test(mauSummary) &&
        /room for 10 MAUs/.test(capNote) &&
        mauRows.some((t) => /MAU-11[\s\S]*Over capacity/.test(t)),
      `${mauSummary} | ${capNote}`,
    );
    await page.getByTestId('schedule-import').click();
    await page.getByTestId('schedule-done').waitFor();

    // the units in the app
    await page.goto(`${projectUrl}/equipment`);
    await page.getByTestId('equip-RTU-3').waitFor();
    const listed = await page
      .locator('[data-testid^="equip-"]')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid));
    check(
      'equipment list: RTU-1, RTU-3, RTU-5 and MAU-1 … MAU-10 (no RTU-2, no MAU-11)',
      ['equip-RTU-1', 'equip-RTU-3', 'equip-RTU-5', 'equip-MAU-10'].every((x) => listed.includes(x)) &&
        !listed.includes('equip-RTU-2') &&
        !listed.includes('equip-MAU-11') &&
        listed.length === 13,
      listed.join(' '),
    );
    await page.getByTestId('equip-RTU-3').click();
    await page.waitForURL(/\/e\//);
    const v = async (k: string) => field(page, k).inputValue();
    const phase = await field(page, 'phase', 'select.select').inputValue();
    check(
      'RTU-3 values from the schedule: CFM, ESP, HP, voltage 208, phase "3 ph" normalized to 3-phase',
      (await v('designTotalCfm')) === '3000' &&
        (await v('unitEsp')) === '0.9' &&
        (await v('hp')) === '5' &&
        (await v('voltage')) === '208' &&
        phase === '3-phase' &&
        (await v('manufacturer')) === 'Trane',
      `${await v('designTotalCfm')} ${await v('unitEsp')} ${await v('hp')} ${await v('voltage')} ${phase}`,
    );

    // ------------------------------------------------ duplicate RTU-3 -> RTU-4 (next free slot: 4)
    await page.getByTestId('duplicate-open').click();
    const suggested = await page.locator('#dup-designation').inputValue();
    const hint = await page.locator('#dup-designation ~ .field-hint').innerText();
    await page.getByTestId('duplicate-create').click();
    await page.waitForFunction(() => document.querySelector('.app-header .title')?.textContent?.includes('RTU-4'));
    await page.locator('#sec-identity').waitFor();
    check(
      'duplicate: RTU-3 -> RTU-4 suggested (slot 4), design data copied, no serial / readings',
      suggested === 'RTU-4' &&
        /slot 4/.test(hint) &&
        (await v('designTotalCfm')) === '3000' &&
        (await v('manufacturer')) === 'Trane' &&
        (await v('areaServed')) === 'Suites 105-108' &&
        (await v('serial')) === '',
      `${suggested} (${hint})`,
    );

    // ------------------------------------------------ "Import schedule from a workbook": the EDE of the main export
    await page.goto(`${projectUrl}/schedule`);
    await page.getByRole('button', { name: 'TAB workbook' }).click();
    await page.locator('input[aria-label="TAB workbook for schedule"]').setInputFiles(workbookFile);
    await page.getByTestId('preview-summary-rtu').waitFor();
    const wbSummaries = await page.locator('[data-testid^="preview-summary-"]').allInnerTexts();
    check(
      'TAB workbook source: only the Equipment Data Entry rows, every type (RTU-1 / RTU-2 of the export: 1 update, 1 new)',
      /RTUs: 1 new, 1 updated/.test(wbSummaries[0] ?? '') && wbSummaries.length >= 6,
      wbSummaries.map((s) => s.replace(/\s+/g, ' ')).join(' | '),
    );
    check('schedule walk: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}
