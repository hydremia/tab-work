/**
 * E2E stage for the MAU, ERV, fan, small fan, hood and traverse forms (390 x 844): add one of each, fill it
 * completely, check it turns green, switch the MAU supply method (the other method's inputs drop out), and save
 * one screenshot per form to docs/screenshots/. After the export, `verifyNewTypes` checks the file with the
 * importer and `recalcCrossCheck` recalculates it with LibreOffice and compares the workbook's computed values
 * with the app's live calculations.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import JSZip from 'jszip';
import type { Page } from 'playwright-core';
import {
  anchorRow,
  cellValue,
  importWorkbook,
  listSheets,
  loadSharedStrings,
  parseCells,
  readText,
  TEMPLATE_MAP,
  type ProjectData,
} from '@a2b/workbook';
import { fromProjectData, unitCells } from '../src/workbook/adapter';
import { computeCompletion } from '../src/domain/completion';
import { buildingBalance, ervTotals, hoodTotals, mauTotals, traverseTotals } from '../src/domain/equipmentCalcs';
import { motorCalc, motorInputs } from '../src/domain/motorCalcs';
import { getSpec } from '../src/domain/specs';
import { staticInputs, staticProfile } from '../src/domain/staticProfile';
import { spareOaTotals } from '../src/domain/spareOa';

type Check = (name: string, ok: boolean, detail?: string) => void;

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
async function byId(page: Page, values: Record<string, string | number>) {
  for (const [id, v] of Object.entries(values)) {
    await page.locator(`#${id}`).fill(String(v));
    await page.locator(`#${id}`).blur();
  }
}
async function row(page: Page, table: string, index: number, values: Record<string, string | number>) {
  if ((await page.getByTestId(`row-${table}-${index}`).count()) === 0) {
    await page.getByTestId(`add-${table}`).click();
    await page.getByTestId(`row-${table}-${index}`).waitFor();
  }
  for (const [k, v] of Object.entries(values)) {
    const el = page.locator(`#${table}-${index}-${k}`);
    if ((await el.evaluate((x) => x.tagName)) === 'SELECT') await el.selectOption(String(v));
    else {
      await el.fill(String(v));
      await el.blur();
    }
  }
  await page.waitForTimeout(400);
}
async function photo(page: Page, label: string, file: string) {
  await page.locator(`input[aria-label="${label} photo"]`).setInputFiles(file);
  await page.waitForTimeout(300);
}
const badge = async (page: Page) => (await page.getByTestId('status-badge').first().innerText()).trim();
async function scrollTo(page: Page, id: string) {
  await page.evaluate((x) => {
    const el = x.startsWith('[') ? document.querySelector(x) : document.getElementById(x);
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 110);
  }, id);
  await page.waitForTimeout(200);
}

/** Reads the static-profile and motor panels (the values shown to the tech) into ui[`${prefix}.<id>`]. */
export async function readLivePanels(page: Page, prefix: string, ui: Record<string, string>) {
  for (const id of ['sp-tsp', 'sp-esp', 'sp-unitdp', 'motor-fla', 'motor-bhp', 'motor-avg-volts', 'motor-avg-amps'])
    ui[`${prefix}.${id}`] = (await page.getByTestId(id).innerText()).trim();
  for (let k = 1; k <= 5; k++) ui[`${prefix}.sp-dp-${k}`] = (await page.getByTestId(`sp-dp-${k}`).innerText()).trim();
  if ((await page.getByTestId('unit-esp-actual').count()) > 0)
    ui[`${prefix}.unit-esp-actual`] = (await page.getByTestId('unit-esp-actual').innerText()).trim();
}

async function addUnit(page: Page, projectUrl: string, typePlural: string, designation: string) {
  await page.goto(`${projectUrl}/equipment`);
  await page.getByTestId('add-equipment').click();
  await page.getByRole('button', { name: new RegExp(`^${typePlural}\\b`) }).click();
  await page.locator('#eq-designation').fill(designation);
  await page.getByRole('button', { name: `Add ${designation}` }).click();
  await page.waitForURL(/\/e\//);
  await page.locator('#sec-identity').waitFor();
}

/** Schedule + unit data + motor + drive (direct) + misc + RPM of the big unit sheets. */
async function fillUnitBasics(page: Page, schedule: Record<string, string | number>) {
  await fill(page, { areaServed: 'Kitchen', location: 'Roof', manufacturer: 'Greenheck', model: 'M-1', hp: 2 });
  await fill(page, { fanRpm: 1750, voltage: 208, ...schedule });
  await select(page, { phase: '3-phase' });
  await fill(page, { serial: 'SN-1', motorManufacturer: 'Baldor', motorRpm: 1750, fla: 6.2, frame: '184T' });
  await select(page, { serviceFactor: 'SF 1.15', driveType: 'Direct' });
  await fill(page, { volts1: 207, volts2: 209, volts3: 208, amps1: 5.1, amps2: 5.3, amps3: 5.2 });
  await fill(page, { rotationDesign: 'CW', rotationActual: 'CW' });
  await yesNo(page, 'hasFilters', 'Yes');
  await fill(page, {
    filters: '2" pleated 20x20 x 6',
    finalSettings: 'ECM dial 7',
    motorRpmFinal: 1748,
    fanRpmFinal: 1748,
  });
  await yesNo(page, 'hasVfd', 'No');
}

export async function fillNewTypes(
  page: Page,
  projectUrl: string,
  check: Check,
  shotsDir: string,
  photoFile: string,
): Promise<{ ui: Record<string, string> }> {
  mkdirSync(shotsDir, { recursive: true });
  const docShot = async (name: string) => page.screenshot({ path: join(shotsDir, `${name}.png`) });
  const ui: Record<string, string> = {};

  // ------------------------------------------------------------------ MAU-1: PSP, then switch methods
  await addUnit(page, projectUrl, 'MAUs', 'MAU-1');
  await fillUnitBasics(page, { unitEsp: 0.6, designTotalCfm: 2100 });
  await fill(page, { spEntering: -0.2, spLeaving1: -0.35, spLeaving3: -0.6, spLeaving5: 0.55 });
  await select(page, { method: 'PSP' });
  await page.locator('#sec-psp').waitFor();
  check(
    'MAU: choosing PSP shows only the PSP inputs',
    (await page.locator('#sec-filterGrid, #sec-profile').count()) === 0,
  );
  await fill(page, { designCfmOverride: 2100, pspLength: 96, pspBlanks: 1 });
  await select(page, { pspWidth: '12' });
  const psp = [300, 305, 310, 295, 290, 300, 315, 305, 298, 302, 296, 304, 310, 300, 292, 308, 301, 299, 303, 297];
  await byId(page, Object.fromEntries(psp.map((v, i) => [`pspVelocities-${i + 1}`, v])));
  await photo(page, 'Unit', photoFile);
  await photo(page, 'Unit label / tag', photoFile);
  await page.waitForTimeout(600);
  const mauBadge = await badge(page);
  await readLivePanels(page, 'mau', ui);
  ui.mauMethodTotal = await page.getByTestId('mau-method-total').innerText();
  check(
    'MAU-1 (PSP) complete (green)',
    mauBadge.includes('Complete'),
    `${mauBadge}; PSP method total ${ui.mauMethodTotal}`,
  );
  await scrollTo(page, '[data-testid="seq-pspVelocities"]');
  await docShot('07-mau-psp');
  // switch to Filter Grid: the PSP inputs drop out, the grid is now what is missing
  await select(page, { method: 'Filter Grid' });
  await page.locator('#sec-filterGrid').waitFor();
  await page.waitForTimeout(400);
  const switched = await badge(page);
  check(
    'MAU: switching to Filter Grid drops the PSP inputs and requires the grid',
    (await page.locator('#sec-psp').count()) === 0 &&
      switched.includes('In progress') &&
      (await page.getByTestId('unit-progress').innerText()).length > 0,
    switched,
  );
  await row(page, 'filterGrid', 0, { size: '16" x 20"', velocity: 400 });
  check(
    'MAU: one 16" x 20" filter at 400 fpm = 945 CFM of 2,100 -> red (method total out of tolerance)',
    (await badge(page)).includes('Issue / tolerance'),
    await badge(page),
  );
  await row(page, 'filterGrid', 1, { velocity: 420 }); // size filled down; 945 + 992.25 = 1937.25 (92 %)
  check('MAU: Filter Grid filled -> complete', (await badge(page)).includes('Complete'), await badge(page));
  await select(page, { method: 'PSP' });
  await page.locator('#sec-psp').waitFor();
  await page.waitForTimeout(400);
  check(
    'MAU: back to PSP, the kept PSP readings count again (green); the grid drops out',
    (await badge(page)).includes('Complete') &&
      (await page.locator('#sec-filterGrid').count()) === 0 &&
      (await page.locator('#pspVelocities-20').inputValue()) === '297',
    await badge(page),
  );

  // ------------------------------------------------------------------ ERV-1
  await addUnit(page, projectUrl, 'ERVs', 'ERV-1');
  await fillUnitBasics(page, {
    designSupplyCfm: 1000,
    designExhaustCfm: 950,
    designSupplyDp: 0.35,
    designExhaustDp: 0.4,
  });
  await fill(page, { spEntering: -0.2, spLeaving1: -0.35, spLeaving2: -0.5, spLeaving5: 0.55 });
  await fill(page, { supplyDpActual: 0.33, exhaustDpActual: 0.41 });
  await select(page, { instrument: 'Flow Hood', exhaustInstrument: 'Flow Hood' });
  const o = { area: 'Offices', type: 'CD', size: '24x24', ak: 1 };
  await row(page, 'supply', 0, { no: 'S-1', ...o, designCfm: 500, finalVel: 490 });
  await row(page, 'supply', 1, { designCfm: 500, finalVel: 520 });
  await row(page, 'exhaust', 0, { no: 'E-1', ...o, type: 'RG', designCfm: 500, finalVel: 480 });
  await row(page, 'exhaust', 1, { designCfm: 450, finalVel: 460 });
  await photo(page, 'Unit', photoFile);
  await photo(page, 'Unit label / tag', photoFile);
  await page.waitForTimeout(600);
  await readLivePanels(page, 'erv', ui);
  ui.ervSupply = await page.getByTestId('erv-supply').innerText();
  ui.ervExhaust = await page.getByTestId('erv-exhaust').innerText();
  check(
    'ERV-1 complete (green)',
    (await badge(page)).includes('Complete'),
    `${await badge(page)}; ${ui.ervSupply}; ${ui.ervExhaust}`,
  );
  await scrollTo(page, 'sec-exhaustAirflow');
  await docShot('08-erv');

  // ------------------------------------------------------------------ EF-1
  await addUnit(page, projectUrl, 'Fans', 'EF-1');
  await fillUnitBasics(page, { unitEsp: 0.5, designTotalCfm: 600 });
  await fill(page, { spEntering: -0.45, spLeaving5: 0.05 });
  await select(page, { instrument: 'Flow Hood' });
  const e = { area: 'Restrooms', type: 'EG', size: '12x12', ak: 0.6 };
  await row(page, 'outlets', 0, { no: 'E-1', ...e, designCfm: 200, finalVel: 330 });
  await row(page, 'outlets', 1, { designCfm: 200, finalVel: 340 });
  await row(page, 'outlets', 2, { designCfm: 200, finalVel: 350 });
  await photo(page, 'Unit', photoFile);
  await photo(page, 'Unit label / tag', photoFile);
  await page.waitForTimeout(600);
  await readLivePanels(page, 'fan', ui);
  const fanStatic = await page.locator('#sec-static').innerText();
  check(
    'EF-1 complete (green); only the fan is on the static profile',
    (await badge(page)).includes('Complete') && (fanStatic.match(/Auto N\/A/g) ?? []).length >= 4,
    await badge(page),
  );
  await scrollTo(page, 'sec-static');
  await docShot('09-fan');

  // ------------------------------------------------------------------ EF-S1 (R6 short form)
  await addUnit(page, projectUrl, 'Small fans', 'EF-S1');
  await fill(page, { areaServed: 'Toilet 101', location: 'Ceiling', manufacturer: 'Broan', model: 'L150' });
  await fill(page, { serial: 'BR-5521', amps: 0.9, designCfm: 110 });
  await select(page, { instrument: 'Flow Hood' });
  await row(page, 'outlets', 0, {
    no: '1',
    area: 'Toilet 101',
    type: 'EG',
    size: '8x8',
    ak: 1,
    designCfm: 110,
    finalVel: 104,
  });
  await photo(page, 'Unit / tag', photoFile);
  await page.waitForTimeout(600);
  check(
    'EF-S1 complete with only the R6 fields (optional data blank)',
    (await badge(page)).includes('Complete'),
    await badge(page),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await scrollTo(page, 'sec-unit');
  await docShot('10-small-fan');

  // ------------------------------------------------------------------ H-1: Captrate 5 x 16" x 20"
  await addUnit(page, projectUrl, 'Hoods', 'H-1');
  await fill(page, {
    areaServed: 'Kitchen',
    manufacturer: 'CaptiveAire',
    designCfm: 2000,
    lengthFt: 8,
    associatedFan: 'KEF-1',
  });
  await fill(page, {
    model: '5424ND-2-PSP-F',
    serial: 'CA-5512',
    hoodType: 'Type I',
    filterManufacturer: 'CaptiveAire',
  });
  await select(page, { filterType: 'Captrate (VelGrid)', instrument: 'Evergreen VelGrid' });
  const finals = [177, 187, 183, 175, 162];
  for (const [i, v] of finals.entries())
    await row(page, 'filters', i, i === 0 ? { size: '16" x 20"', final1: v } : { final1: v });
  await photo(page, 'Hood', photoFile);
  await photo(page, 'Hood tag', photoFile);
  await page.waitForTimeout(600);
  ui.hoodFinal = await page.getByTestId('hood-final').innerText();
  check(
    'H-1 complete (green); VelGrid rows show one reading; live total 2,049.29 CFM',
    (await badge(page)).includes('Complete') &&
      ui.hoodFinal === '2,049.29' &&
      (await page.locator('#filters-0-final2').count()) === 0,
    `${await badge(page)}; ${ui.hoodFinal}`,
  );
  await scrollTo(page, 'sec-filters');
  await docShot('11-hood');

  // ------------------------------------------------------------------ T-1: 24" x 12", 12 points
  await addUnit(page, projectUrl, 'Traverses', 'T-1');
  await fill(page, { areaServed: 'RTU-1 supply main', designCfm: 1000 });
  await select(page, { shape: 'Rectangular' });
  await fill(page, { width: 24, height: 12, liner: 0 });
  const readings = Array.from({ length: 12 }, (_, i) => 480 + i * 4);
  await page.locator('#readings-12').waitFor();
  await byId(page, Object.fromEntries(readings.map((v, i) => [`readings-${i + 1}`, v])));
  await select(page, { instrument: 'Manometer/Pitot Tube' });
  await fill(page, { ductStatic: 0.45, temperature: 55 });
  await page.waitForTimeout(600);
  ui.traverseCfm = await page.getByTestId('traverse-cfm').innerText();
  const layout = await page.getByTestId('calc-traverse').innerText();
  check(
    'T-1 complete (green); 4 x 3 points at 3/9/15/21", CFM 1,004',
    (await badge(page)).includes('Complete') &&
      /4 x 3 = 12/.test(layout) &&
      /3" · 9" · 15" · 21"/.test(layout) &&
      ui.traverseCfm === '1,004',
    `${await badge(page)}; ${layout.replace(/\s+/g, ' ')}`,
  );
  await scrollTo(page, 'sec-readings');
  await docShot('12-traverse');

  // ------------------------------------------------------------------ list colors
  await page.goto(`${projectUrl}/equipment`);
  await page.getByTestId('equip-T-1').waitFor();
  const colors: Record<string, string | null> = {};
  for (const d of ['MAU-1', 'ERV-1', 'EF-1', 'EF-S1', 'H-1', 'T-1'])
    colors[d] = await page.getByTestId(`equip-${d}`).getAttribute('data-color');
  check(
    'equipment list: every new unit green',
    Object.values(colors).every((c) => c === 'green'),
    JSON.stringify(colors),
  );
  return { ui };
}

// ------------------------------------------------------------------------------------------ after export
export async function verifyNewTypes(bytes: Uint8Array, check: Check): Promise<ProjectData> {
  const wb = await importWorkbook(bytes);
  const u = (t: string) => wb.equipment[t]?.find((x) => x.slot === 1);
  const mau = u('mau');
  check(
    'workbook: MAU-1 PSP inputs, velocities, other methods N/A',
    mau?.fields?.method === 'PSP' &&
      mau.fields.pspWidth === 12 &&
      mau.sequences?.pspVelocities?.length === 20 &&
      mau.fields.profileHousing === 'N/A' &&
      JSON.stringify(mau.columnTables?.filterGrid) === JSON.stringify([{ size: 'N/A' }]),
    JSON.stringify({ fields: mau?.fields, grid: mau?.columnTables }),
  );
  check(
    'workbook: ERV-1 supply / exhaust tables',
    u('erv')?.tables?.exhaust?.length === 2 && u('erv')?.schedule?.designExhaustCfm === 950,
  );
  check(
    'workbook: EF-1 outlets + unit type EF',
    u('fan')?.tables?.outlets?.length === 3 && u('fan')?.fields?.unitType === 'EF',
  );
  check(
    'workbook: EF-S1 serial / amps',
    u('smallFan')?.fields?.serial === 'BR-5521' && u('smallFan')?.fields?.amps === 0.9,
  );
  const hood = u('hood');
  check(
    'workbook: H-1 filters in P-U (VelGrid readings 2-3 N/A), never in J/L',
    hood?.tables?.filters?.length === 5 &&
      hood.tables.filters[0].final1 === 177 &&
      hood.tables.filters[0].final2 === 'N/A',
    JSON.stringify(hood?.tables?.filters?.[0]),
  );
  const t = u('traverse');
  check(
    'workbook: T-1 point label, duct and 12 quick-entry readings',
    t?.fields?.designation === 'T-1' && t.fields.width === 24 && t.sequences?.readings?.length === 12,
    JSON.stringify(t?.fields),
  );
  return wb;
}

export function soffice(input: string, outdir: string): string {
  const profile = mkdtempSync(join(tmpdir(), 'lo-profile-'));
  mkdirSync(join(profile, 'user'), { recursive: true });
  writeFileSync(
    join(profile, 'user', 'registrymodifications.xcu'),
    `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="ODFRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>`,
  );
  mkdirSync(outdir, { recursive: true });
  spawnSync(
    'soffice',
    [
      `-env:UserInstallation=file://${profile}`,
      '--headless',
      '--calc',
      '--convert-to',
      'xlsm:Calc MS Excel 2007 VBA XML',
      '--outdir',
      outdir,
      input,
    ],
    { encoding: 'utf8', timeout: 600_000 },
  );
  rmSync(profile, { recursive: true, force: true });
  return join(outdir, basename(input));
}

/** LibreOffice recalculation: 0 error cells, and the workbook's results equal the app's live calculations. */
export async function recalcCrossCheck(file: string, wb: ProjectData, ui: Record<string, string>, check: Check) {
  if (spawnSync('sh', ['-c', 'command -v soffice']).status !== 0) {
    check('LibreOffice available for the recalculation cross-check', false, 'soffice not on PATH');
    return;
  }
  const out = soffice(file, mkdtempSync(join(tmpdir(), 'e2e-recalc-')));
  check('LibreOffice recalculates the exported workbook', existsSync(out), out);
  if (!existsSync(out)) return;
  const zip = await JSZip.loadAsync(readFileSync(out));
  const sheets = await listSheets(zip);
  const sst = await loadSharedStrings(zip);
  const cache = new Map<string, Map<string, ReturnType<typeof parseCells> extends Map<string, infer C> ? C : never>>();
  const cells = async (name: string) => {
    if (!cache.has(name)) cache.set(name, parseCells(await readText(zip, sheets.find((s) => s.name === name)!.part)));
    return cache.get(name)!;
  };
  const val = async (sheet: string, ref: string) => cellValue((await cells(sheet)).get(ref), sst);
  const errors: string[] = [];
  for (const s of sheets) {
    for (const c of (await cells(s.name)).values()) {
      const v = cellValue(c, sst);
      if (c.t === 'e' || (typeof v === 'string' && /^(#(VALUE!|DIV\/0!|REF!|NAME\?|N\/A|NUM!|NULL!)|Err:\d+)/.test(v)))
        errors.push(`${s.name}!${c.ref}=${String(v)}`);
    }
  }
  check(
    'recalculated workbook: 0 error cells',
    errors.length === 0,
    `${errors.length} ${errors.slice(0, 5).join(', ')}`,
  );

  // the app's live calculations on the same data (the exported workbook read back into app records)
  const bundle = fromProjectData(wb);
  const unit = (type: string) => bundle.equipment.find((x) => x.type === type && x.slot === 1)!;
  const rowsOf = (id: string) => bundle.rows.filter((r) => r.equipmentId === id);
  const close = (a: unknown, b: number | null, tol = 1e-6) =>
    b === null ? a === null || a === '' : typeof a === 'number' && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
  const cmp = async (label: string, sheet: string, ref: string, expected: number | null) => {
    const got = await val(sheet, ref);
    check(
      `recalc: ${label} (${sheet}!${ref}) = app live calc`,
      close(got, expected),
      `workbook ${String(got)}, app ${String(expected)}`,
    );
  };
  const Q = 52;
  const mau = unit('mau');
  const m = mauTotals(mau.data, rowsOf(mau.id));
  const P = anchorRow(TEMPLATE_MAP.equipment.find((x) => x.key === 'mau')!.block.anchor, 1);
  await cmp('MAU-1 method total (PSP)', 'MAUs', `E${P + Q + 19}`, m.methodTotal);
  await cmp('MAU-1 total actual', 'MAUs', `L${P + 5}`, m.actual);
  await cmp('MAU-1 total design (override)', 'MAUs', `K${P + 5}`, m.design);
  check(
    'app UI shows the same MAU method total',
    ui.mauMethodTotal === Math.round(m.methodTotal ?? 0).toLocaleString('en-US'),
    ui.mauMethodTotal,
  );
  const hood = unit('hood');
  const h = hoodTotals(hood.data, rowsOf(hood.id));
  await cmp('H-1 final total', 'Hoods', 'F22', h.final);
  await cmp('H-1 % of design', 'Hoods', 'H22', h.ratio);
  const t = traverseTotals(unit('traverse').data);
  await cmp('T-1 Ak', 'Traverses', 'H7', t.ak);
  await cmp('T-1 final VEL', 'Traverses', 'L7', t.finalVel);
  await cmp('T-1 CFM', 'Traverses', 'M7', t.finalCfm);
  check(
    'recalc: T-1 point layout text',
    (await val('Traverses', 'M9')) === t.layoutText,
    String(await val('Traverses', 'M9')),
  );
  const erv = unit('erv');
  const et = ervTotals(rowsOf(erv.id));
  await cmp('ERV-1 supply design', 'ERVs', 'K9', et.supply.design);
  await cmp('ERV-1 supply actual', 'ERVs', 'L9', et.supply.actual);
  await cmp('ERV-1 exhaust design', 'ERVs', 'K10', et.exhaust.design);
  await cmp('ERV-1 exhaust actual', 'ERVs', 'L10', et.exhaust.actual);
  // static-pressure profile and motor data (RTU-1, MAU-1, ERV-1, EF-1): workbook = app functions = what the UI showed
  const fmt2 = (x: unknown, unit: string) =>
    typeof x === 'number'
      ? `${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${unit}`
      : '—';
  for (const [type, sheet, espRow] of [
    ['rtu', 'RTUs', 8],
    ['mau', 'MAUs', 6],
    ['erv', 'ERVs', null],
    ['fan', 'Fans', 6],
  ] as const) {
    const e = unit(type);
    const c = computeCompletion({
      spec: getSpec(type),
      unit: e,
      rows: rowsOf(e.id),
      photos: [],
      project: bundle.project,
      openIssues: 0,
    });
    const cells = unitCells(e, c);
    const sp = staticProfile(staticInputs(cells));
    const mc = motorCalc(motorInputs(cells));
    const P0 = anchorRow(TEMPLATE_MAP.equipment.find((x) => x.key === type)!.block.anchor, 1);
    const name = e.designation;
    await cmp(`${name} fan TSP`, sheet, `E${P0 + 25}`, sp.tsp);
    await cmp(`${name} ESP`, sheet, `I${P0 + 25}`, sp.esp);
    await cmp(`${name} unit ΔP`, sheet, `M${P0 + 25}`, sp.unitDp);
    if (espRow !== null) await cmp(`${name} unit ESP actual`, sheet, `L${P0 + espRow}`, sp.esp);
    await cmp(`${name} corrected FLA`, sheet, `D${P0 + 14}`, mc.correctedFla);
    await cmp(`${name} estimated BHP`, sheet, `G${P0 + 14}`, mc.bhp);
    const dps: string[] = [];
    for (const col of ['D', 'F', 'H', 'J', 'L']) dps.push(String((await val(sheet, `${col}${P0 + 24}`)) ?? ''));
    check(
      `recalc: ${name} component ΔP texts (${sheet}!D:L${P0 + 24}) = app`,
      dps.every((t, k) => t === (sp.dpText[k] ?? '')),
      dps.join(' | '),
    );
    // what the tech saw in the panels equals the recalculated workbook
    const key = type;
    const shown = (id: string) => ui[`${key}.${id}`];
    const wbTsp = await val(sheet, `E${P0 + 25}`);
    const wbEsp = await val(sheet, `I${P0 + 25}`);
    const wbFla = await val(sheet, `D${P0 + 14}`);
    const wbBhp = await val(sheet, `G${P0 + 14}`);
    const uiDps = [1, 2, 3, 4, 5].map((k) => shown(`sp-dp-${k}`));
    check(
      `UI panels = recalculated workbook: ${name} TSP ${shown('sp-tsp')}, ESP ${shown('sp-esp')}, corrected FLA ${shown('motor-fla')}, BHP ${shown('motor-bhp')}`,
      shown('sp-tsp') === fmt2(wbTsp, ' in. w.g.') &&
        shown('sp-esp') === fmt2(wbEsp, ' in. w.g.') &&
        shown('motor-fla') === fmt2(wbFla, ' A') &&
        shown('motor-bhp') === fmt2(wbBhp, '') &&
        (espRow === null || shown('unit-esp-actual') === fmt2(wbEsp, '')) &&
        uiDps.every((t, k) => (sp.absent[k] ? t === 'absent' : t === (dps[k] || 'Δ —'))),
      `workbook TSP ${String(wbTsp)}, ESP ${String(wbEsp)}, FLA ${String(wbFla)}, BHP ${String(wbBhp)}; ΔP ${uiDps.join(' ')}`,
    );
  }

  const bb = buildingBalance(bundle.equipment, bundle.rows, spareOaTotals(bundle.project));
  await cmp('Building Balance OA design total', 'Building Balance', 'C87', bb.oaDesign);
  await cmp('Building Balance OA actual total', 'Building Balance', 'E87', bb.oaActual);
  await cmp('Building Balance exhaust design total', 'Building Balance', 'I87', bb.exhaustDesign);
  await cmp('Building Balance exhaust actual total', 'Building Balance', 'K87', bb.exhaustActual);
  await cmp('Building Balance design balance', 'Building Balance', 'H89', bb.designBalance);
  await cmp('Building Balance actual balance', 'Building Balance', 'H91', bb.actualBalance);
  // the measured building pressures are inputs: the recalculated sheet shows them as written
  const pr = wb.sections.buildingBalance?.tables?.pressures ?? [];
  const shown: string[] = [];
  for (let i = 0; i < 3; i++) {
    for (const col of ['B', 'E', 'H', 'K'])
      shown.push(String((await val('Building Balance', `${col}${97 + i}`)) ?? ''));
  }
  const want = pr.flatMap((r) => [r.testSpace, r.referenceSpace, r.dp, r.remarks].map((x) => String(x ?? '')));
  // spare OA rows and the Certification lines are inputs too
  const oaShown: string[] = [];
  for (let i = 0; i < 2; i++)
    for (const col of ['B', 'C', 'E']) oaShown.push(String((await val('Building Balance', `${col}${67 + i}`)) ?? ''));
  const certShown: string[] = [];
  for (const ref of ['C30', 'C32', 'C34', 'I53', 'I56'])
    certShown.push(String((await val('Certification', ref)) ?? ''));
  check(
    'recalc: Building Balance other OA rows (B67:E68) and Certification lines (C30 … I56) as exported',
    oaShown.join('|') === 'Transfer grille TG-1|400|385|Relief opening|150|Not Acc.' &&
      certShown.join('|') ===
        'NEBB Certified Professional:  Isaac Rochester|Certification Number:  24053|Expiration Date: December 31, 2026|Isaac Rochester|9/25/2026',
    `${oaShown.join(' | ')} // ${certShown.join(' | ')}`,
  );
  check(
    'recalc: Building Balance pressure table (B97:K99) as exported',
    pr.length === 3 && want.every((w, k) => w === shown[k]),
    shown.join(' | '),
  );
  rmSync(out, { force: true });
}
