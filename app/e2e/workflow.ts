/**
 * E2E: the Phase 6 reporting workflow, in a fresh browser context (own IndexedDB) on a project imported from the
 * main walk's export:
 *   RTU-1 made green (its 3 required photos marked N/A) -> marked reviewed -> blue card, "RTUs 1/2 complete,
 *   1 reviewed" -> an edit clears the review (green again) -> reviewed again -> Export: Issue report "Prelim" ->
 *   locked: banner on every page, the unit form is read-only and typing changes nothing -> Unlock (confirmed) ->
 *   the edit works, the next export is suggested as Rev 1 -> History: review, automatic clear, issue / lock,
 *   unlock and the edits with old -> new values; the unit page's own History section.
 * Screenshots: docs/screenshots/23-reviewed.png, 24-locked.png, 25-history.png.
 */
import { join } from 'node:path';
import type { Browser, Page } from 'playwright-core';

type Check = (name: string, ok: boolean, detail?: string) => void;

const field = (page: Page, key: string, el = 'input') => page.locator(`[data-field="${key}"] ${el}`).first();

async function badge(page: Page) {
  const b = page.getByTestId('status-badge').first();
  return { color: await b.getAttribute('data-color'), text: (await b.innerText()).trim() };
}

export async function workflowFlow(
  browser: Browser,
  base: string,
  workbookFile: string,
  out: string,
  docShots: string,
  check: Check,
) {
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
  const dialogs: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.accept();
  });
  try {
    // ------------------------------------------------ a project with a green RTU-1
    await page.goto(`${base}/import`);
    await page.locator('input[aria-label="Workbook file"]').setInputFiles(workbookFile);
    await page.getByTestId('import-create').click();
    await page.getByTestId('equip-RTU-1').waitFor();
    const projectUrl = page.url().replace(/\/equipment$/, '');
    await page.getByTestId('equip-RTU-1').click();
    await page.waitForURL(/\/e\//);
    const unitUrl = page.url();
    for (const cat of ['unit', 'tag', 'oa_damper'])
      await page.getByTestId(`photo-${cat}`).locator('select.na-select').selectOption('N/A');
    await page.waitForTimeout(400);
    check('workflow: RTU-1 green (photos marked N/A)', (await badge(page)).color === 'green', (await badge(page)).text);

    // ------------------------------------------------ review -> blue
    await page.locator('#reviewer').fill('Dana Ruiz');
    await page.getByTestId('mark-reviewed').click();
    await page.getByTestId('review-status').filter({ hasText: 'Reviewed by Dana Ruiz' }).waitFor();
    const b1 = await badge(page);
    check(
      'workflow: reviewing a green unit turns it blue ("Reviewed")',
      b1.color === 'blue' && b1.text === 'Reviewed',
      b1.text,
    );
    await page.goto(`${projectUrl}/equipment`);
    await page.getByTestId('equip-RTU-1').waitFor();
    const card = await page.getByTestId('equip-RTU-1').getAttribute('data-color');
    const roll = await page.getByTestId('rollup-rtu').innerText();
    const head = await page.locator('.page-head p').first().innerText();
    check(
      'workflow: blue card, rollup "RTUs 1/2 complete, 1 reviewed", project summary',
      card === 'blue' && roll.includes('1/2 complete, 1 reviewed') && /· 1 reviewed/.test(head),
      `${card} | ${roll} | ${head}`,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(docShots, '23-reviewed.png') });

    // ------------------------------------------------ an edit clears the review
    await page.goto(unitUrl);
    await field(page, 'serial').waitFor();
    const serialBefore = await field(page, 'serial').inputValue();
    await field(page, 'serial').fill('4719G20331-B');
    await field(page, 'serial').blur();
    await page.getByTestId('mark-reviewed').waitFor();
    const b2 = await badge(page);
    check('workflow: editing a reviewed unit clears the review (green again)', b2.color === 'green', b2.text);
    await page.getByTestId('mark-reviewed').click(); // the name is remembered on the device
    await page.getByTestId('review-status').filter({ hasText: 'Reviewed by Dana Ruiz' }).waitFor();

    // ------------------------------------------------ issue report "Prelim" -> locked
    await page.goto(`${projectUrl}/export`);
    await page.getByTestId('issue-report').waitFor();
    await page.getByTestId('revision-label').fill('Prelim');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('issue-report').click()]);
    await dl.saveAs(join(out, `issued-${dl.suggestedFilename()}`));
    await page.getByTestId('issued-state').waitFor();
    const banner = await page.getByTestId('lock-banner').innerText();
    check(
      'workflow: Issue report downloads Prelim and locks the project (banner, issued revision)',
      /Prelim/.test(dl.suggestedFilename()) &&
        /Issued as Prelim on .+ — unlock to edit/.test(banner) &&
        (await page.getByTestId('revision-issued').count()) === 1 &&
        dialogs.some((d) => d.startsWith('Issue the report as Prelim?')),
      `${dl.suggestedFilename()} | ${banner}`,
    );
    check(
      'workflow: re-import blocked while locked',
      (await page.getByTestId('reimport-locked').count()) === 1 &&
        (await page.getByTestId('reimport-link').count()) === 0,
    );

    // ------------------------------------------------ edit attempt blocked
    await page.goto(unitUrl);
    await page.getByTestId('lock-banner').waitFor();
    const serial = field(page, 'serial');
    const disabled = await serial.isDisabled();
    await serial.click({ force: true }).catch(() => undefined);
    await page.keyboard.type('ZZZ');
    await page.waitForTimeout(400);
    const after = await serial.inputValue();
    check(
      'workflow: locked unit form is read-only (typing changes nothing)',
      disabled && after === '4719G20331-B' && (await page.getByTestId('mark-reviewed').count()) === 0,
      `disabled=${disabled} value=${after}`,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(docShots, '24-locked.png') });
    await page.goto(`${projectUrl}/equipment`);
    await page.getByTestId('equip-RTU-1').waitFor();
    check(
      'workflow: no Add equipment / Import schedule while locked',
      (await page.getByTestId('add-equipment').count()) === 0 &&
        (await page.getByTestId('import-schedule').count()) === 0,
    );

    // ------------------------------------------------ unlock -> edit works
    await page.goto(unitUrl);
    await page.getByTestId('unlock').click();
    await page.getByTestId('lock-banner').waitFor({ state: 'detached' });
    check(
      'workflow: unlock asks first and suggests the next revision (Rev 1)',
      dialogs.some((d) => /Unlock .+ for follow-up\?/.test(d) && /suggested as Rev 1/.test(d)),
      dialogs.at(-1)?.replace(/\s+/g, ' '),
    );
    await field(page, 'serial').fill('4719G20331-C');
    await field(page, 'serial').blur();
    await page.waitForTimeout(400);
    await page.reload();
    await field(page, 'serial').waitFor();
    const b3 = await badge(page);
    check(
      'workflow: after unlock the edit is saved (and clears the review again)',
      (await field(page, 'serial').inputValue()) === '4719G20331-C' && b3.color === 'green',
      `${await field(page, 'serial').inputValue()} ${b3.color}`,
    );
    await page.goto(`${projectUrl}/export`);
    await page.getByTestId('issue-report').waitFor();
    check(
      'workflow: next export suggested as Rev 1',
      (await page.getByTestId('revision-label').inputValue()) === 'Rev 1',
      await page.getByTestId('revision-label').inputValue(),
    );

    // ------------------------------------------------ history
    await page.goto(`${projectUrl}/history`);
    await page.getByTestId('history-list').waitFor();
    const lines = (await page.getByTestId('history-line').allInnerTexts()).map((l) => l.replace(/\s+/g, ' ').trim());
    const has = (re: RegExp) => lines.some((l) => re.test(l));
    const want: [string, RegExp][] = [
      ['review', /^Marked reviewed by Dana Ruiz$/],
      ['automatic clear', /^Review cleared automatically/],
      ['issued revision', /^Issued Prelim \(.+\.xlsm\)$/],
      ['lock', /^Report issued and locked as Prelim$/],
      ['unlock', /^Report unlocked for follow-up \(was Prelim\)$/],
      ['edit old -> new', new RegExp(`^Serial number: ${serialBefore} → 4719G20331-B$`)],
      ['edit after unlock', /^Serial number: 4719G20331-B → 4719G20331-C$/],
      ['photo N/A', /^Unit photo N\/A: blank → N\/A$/],
    ];
    const missing = want.filter(([, re]) => !has(re)).map(([n]) => n);
    check(
      'workflow: History lists review, clear, issue / lock, unlock and edits old -> new',
      !missing.length,
      missing.length ? `missing ${missing.join(', ')}; got ${lines.slice(0, 12).join(' | ')}` : `${lines.length} lines`,
    );
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="history-filters"]');
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 124);
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(docShots, '25-history.png') });
    await page.getByTestId('history-filters').click();
    await page.getByLabel('Unit').selectOption({ label: 'RTU-2' });
    await page.waitForTimeout(300);
    const rtu2 = await page.getByTestId('history-count').innerText();
    check(
      'workflow: History filter by unit',
      !/^0 /.test(rtu2) && !(await page.getByTestId('history-line').allInnerTexts()).some((l) => /Dana/.test(l)),
      rtu2,
    );

    // the unit page's own History
    await page.goto(unitUrl);
    await page.getByTestId('unit-history-toggle').click();
    const unitHist = await page.getByTestId('unit-history').innerText();
    check(
      'workflow: unit page History section',
      /Marked reviewed by Dana Ruiz/.test(unitHist) &&
        /Serial number/.test(unitHist) &&
        !/Report unlocked/.test(unitHist),
      unitHist.replace(/\s+/g, ' ').slice(0, 160),
    );
    check('workflow: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}
