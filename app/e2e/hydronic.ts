/**
 * E2E: hydronic units. A new project gets a pump (design data, gauge readings: the pump-test panel shows the head
 * from the gauges), a chilled-water valve system with two valves (one out of tolerance), then the Export tab's
 * hydronic workbook is downloaded and read back with the hydronic map. Screenshots 37 (pump test) and 38 (valves).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HYDRONIC_MAP, importWorkbook } from '@a2b/workbook';
import type { Browser, Page } from 'playwright-core';

type Check = (name: string, ok: boolean, detail?: string) => void;

const field = (page: Page, key: string, el = 'input') => page.locator(`[data-field="${key}"] ${el}`).first();
async function put(page: Page, key: string, v: string) {
  const el = field(page, key);
  await el.fill(v);
  await el.blur();
}
async function pick(page: Page, key: string, v: string) {
  await field(page, key, 'select').selectOption(v);
}

async function addUnit(page: Page, projectUrl: string, plural: RegExp, designation: string) {
  await page.goto(`${projectUrl}/add`);
  await page.getByTestId('type-picker-hydronic').getByRole('button', { name: plural }).click();
  await page.locator('#eq-designation').fill(designation);
  await page.getByRole('button', { name: `Add ${designation}`, exact: true }).click();
  await page.waitForURL(/\/e\//);
}

export async function hydronicFlow(browser: Browser, base: string, docShots: string, outDir: string, check: Check) {
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
    await page.locator('#np-name').fill('Hydronic job');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.waitForURL(/\/p\/.+\/info$/);
    const projectUrl = page.url().replace(/\/info$/, '');

    // ---- pump
    await addUnit(page, projectUrl, /Pumps/, 'P-1');
    await put(page, 'service', 'Chilled Water');
    await put(page, 'system', 'CHW');
    await pick(page, 'pumpType', 'VFD');
    await put(page, 'designGpm', '200');
    await put(page, 'designHead', '60');
    await pick(page, 'phase', '3-phase');
    await put(page, 'voltage', '460');
    await put(page, 'actualGpm', '190');
    await put(page, 'finalSuction', '9');
    await put(page, 'finalDischarge', '35');
    await page.waitForTimeout(300);
    const head = await page.getByTestId('pump-final-head').innerText();
    check('hydronic: pump test panel shows the head from the gauges ((35 − 9) × 2.31)', /60\.1 ft/.test(head), head);
    const panel = page.getByTestId('calc-pumpTest');
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(docShots, '37-pump-test.png') });

    // ---- a valve in the shared library (test data: an adjustable orifice valve with a two-row Cv table)
    await page.goto(`${base}/library`);
    await page.getByTestId('add-lib-valve').click();
    const item = page.getByTestId('valve-lib-item').last();
    const lput = async (label: string, v: string) => {
      const el = item.getByLabel(label, { exact: true });
      await el.fill(v);
      await el.blur();
    };
    await lput('Make', 'TestCo');
    await lput('Model', 'CBV');
    await lput('Size', '1"');
    await item.getByLabel('Type', { exact: true }).selectOption('A');
    await lput('Cv table', '0 0.5\n4 3.5');
    await lput('Data sheet', 'e2e test data');
    await page.waitForTimeout(300);

    // ---- valve system
    await addUnit(page, projectUrl, /Valve systems/, 'CHW');
    await put(page, 'service', 'Chilled Water');
    await put(page, 'vfdSetpoint', '12 psi');
    const valve = async (i: number, tag: string, design: string, final: string) => {
      await page.getByTestId('add-valves').click();
      const row = page.getByTestId(`row-valves-${i}`);
      await row.getByLabel(`Valves valve ${i + 1} Valve`).fill(tag);
      await row.getByLabel(`Valves valve ${i + 1} Design`).fill(design);
      await row.getByLabel(`Valves valve ${i + 1} Final`).fill(final);
      await row.getByLabel(`Valves valve ${i + 1} Final`).blur();
    };
    await valve(0, 'CBV-1', '10', '10.5');
    // valve 1 from the library: setting 4, ΔP 1 psi -> Cv 3.5 x √1 = 3.5 GPM (test data), taken as the final flow
    const r0 = page.getByTestId('row-valves-0');
    await r0.getByLabel('Valves valve 1 library valve').selectOption({ label: 'TestCo CBV 1" (A)' });
    await r0.getByLabel('Valves valve 1 Setting').fill('4');
    await r0.getByLabel('Valves valve 1 ΔP').fill('1');
    await r0.getByLabel('Valves valve 1 ΔP').blur();
    await page.waitForTimeout(300);
    const flowText = await r0.getByTestId('valve-flow').innerText();
    await r0.getByTestId('valve-use-final').click();
    await page.waitForTimeout(300);
    const finalNow = await r0.getByLabel('Valves valve 1 Final').inputValue();
    const mm = await r0.getByLabel('Valves valve 1 Make / model').inputValue();
    check(
      'hydronic: a library valve gives the flow from setting and ΔP (Cv 3.5 × √1 psi) and fills make / model',
      /3\.5 GPM/.test(flowText) && finalNow === '3.5' && mm === 'TestCo CBV',
      `${flowText} | final ${finalNow} | ${mm}`,
    );
    await r0.getByLabel('Valves valve 1 Final').fill('10.5');
    await r0.getByLabel('Valves valve 1 Final').blur();
    await valve(1, 'CBV-2', '20', '30');
    await page.waitForTimeout(300);
    const out = await page.getByTestId('row-valves-1').getAttribute('data-out');
    check('hydronic: a valve at 150 % of design is flagged out of tolerance', out === 'true', `data-out=${out}`);
    await page.getByTestId('table-valves').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(docShots, '38-valves.png') });

    // ---- list and export
    await page.goto(`${projectUrl}/equipment`);
    const divider = await page
      .getByTestId('hydronic-divider')
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check('hydronic: the equipment list shows a Hydronic divider', divider);
    await page.screenshot({ path: join(docShots, '39-hydronic-list.png') });
    await page.goto(`${projectUrl}/export`);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-hydronic').click()]);
    const file = join(outDir, 'hydronic.xlsm');
    await dl.saveAs(file);
    const back = await importWorkbook(new Uint8Array(readFileSync(file)), { map: HYDRONIC_MAP });
    const pump = back.equipment.pump?.[0];
    const sys = back.equipment.valveSystem?.[0];
    check(
      'hydronic: the exported workbook holds the pump, its gauges and the valves',
      pump?.schedule?.designation === 'P-1' &&
        pump?.schedule?.designGpm === 200 &&
        pump?.fields?.finalDischarge === 35 &&
        sys?.fields?.designation === 'CHW' &&
        sys?.tables?.valves?.map((v) => v.tag).join() === 'CBV-1,CBV-2' &&
        /Hydronic TAB Report/.test(dl.suggestedFilename()),
      `${dl.suggestedFilename()} ${JSON.stringify(pump?.schedule)}`,
    );
    check(
      'hydronic: System Summary line for CHW (pump P-1, setpoint)',
      JSON.stringify(back.sections.systemSummary?.tables?.systems?.[0]) ===
        JSON.stringify({ system: 'CHW', service: 'Chilled Water', pumps: 'P-1', vfdSetpoint: '12 psi' }),
      JSON.stringify(back.sections.systemSummary?.tables?.systems?.[0]),
    );
    check('hydronic e2e: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}
