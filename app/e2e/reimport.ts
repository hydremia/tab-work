/**
 * E2E: issued report -> edits in Excel -> re-import review -> apply -> next revision onto the issued workbook.
 *
 *   project (imported from the main walk's export, all 8 unit types) -> export "Prelim" -> in Node, "Excel edits" as
 *   direct XML changes on the downloaded file: RTU-1 remark polished (and restyled), one reading changed (S-1 final
 *   velocity), another reading changed (amps L1) that is ALSO changed in the app (collision), column D widened, a label
 *   cell's text and a row height changed -> meanwhile in the app: amps L1 and the final fan RPM
 *   -> a LibreOffice re-save of the edited file is re-imported only as an import source (shared strings, number
 *   formatting drift): same review, then Cancel (nothing changes). LibreOffice is never used as an export base (it
 *   shrinks the VBA project).
 *   -> the XML-edited file is re-imported: 1 remark change, 1 incoming reading, 1 collision, no false changes
 *   -> resolve, apply -> values in the app -> export "Rev 1" (onto the issued workbook): the Excel formatting is still
 *   there, the VBA project is byte-identical, and the values read back are correct.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import type { Browser, Page } from 'playwright-core';
import { importWorkbookWithReport, listSheets, readText } from '@a2b/workbook';
import { soffice } from './newTypes';

type Check = (name: string, ok: boolean, detail?: string) => void;

const REMARK = 'Belt replaced during TAB; belt tension checked and set.';
const S1_FINAL = 512; // was 505
const AMPS_EXCEL = 3.8; // was 3.9
const AMPS_APP = 4.2;
const RPM_APP = 1110; // was 1105

async function editSheet(bytes: Uint8Array, sheet: string, edit: (xml: string) => string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const info = (await listSheets(zip)).find((s) => s.name === sheet)!;
  zip.file(info.part, edit(await readText(zip, info.part)));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
function editCell(xml: string, ref: string, f: (tag: string) => string): string {
  const m = new RegExp(`<c r="${ref}"(?=[\\s>/])[^>]*?(?:/>|>[\\s\\S]*?</c>)`).exec(xml);
  if (!m) throw new Error(`cell ${ref} not found`);
  const next = f(m[0]);
  if (next === m[0]) throw new Error(`cell ${ref} unchanged: ${m[0]}`);
  return xml.replace(m[0], next);
}
const cellTag = (xml: string, ref: string) =>
  new RegExp(`<c r="${ref}"(?=[\\s>/])[^>]*?(?:/>|>[\\s\\S]*?</c>)`).exec(xml)?.[0] ?? '';
const sheetXml = async (bytes: Uint8Array, sheet: string) => {
  const zip = await JSZip.loadAsync(bytes);
  return readText(zip, (await listSheets(zip)).find((s) => s.name === sheet)!.part);
};
/** The whole page in one viewport (fixed / sticky bars stay where they belong, unlike a full-page capture). */
async function tallShot(page: Page, path: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 390, height: Math.min(h, 4000) });
  await page.waitForTimeout(300);
  await page.screenshot({ path });
  await page.setViewportSize({ width: 390, height: 844 });
}
const COL_D = /<col\b[^>]*min="4" max="4"[^>]*\/>/;

async function counts(page: Page) {
  await page.getByTestId('reimport-review').waitFor({ timeout: 60_000 });
  const n = async (id: string) => Number((await page.getByTestId(id).locator('b').innerText()).trim());
  const items = page.getByTestId('diff-item');
  const all = await items.evaluateAll((els) =>
    els.map((e) => ({
      kind: (e as HTMLElement).dataset.kind,
      cell: (e as HTMLElement).dataset.cell,
      change: (e as HTMLElement).dataset.change,
      text: (e as HTMLElement).innerText.replace(/\s+/g, ' '),
    })),
  );
  return {
    incoming: await n('review-incoming'),
    collisions: await n('review-collisions'),
    added: await n('review-added'),
    items: all,
    remarks: all.filter((i) => /Remark/.test(i.text) && i.cell === 'remarks').length,
  };
}

export async function reimportFlow(
  browser: Browser,
  base: string,
  sourceFile: string,
  outDir: string,
  docShots: string,
  check: Check,
): Promise<void> {
  const dir = join(outDir, 'reimport');
  mkdirSync(dir, { recursive: true });
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
  page.on('dialog', (d) => void d.accept());
  const template = readFileSync(join(import.meta.dirname, '..', 'public', 'templates', 'tab-template-rev05.xlsm'));
  const vbaOf = async (b: Uint8Array) => (await JSZip.loadAsync(b)).file('xl/vbaProject.bin')!.async('uint8array');
  const templateVba = await vbaOf(template);
  try {
    // ------------------------------------------------ a project with units (a workbook not exported on this device)
    await page.goto(`${base}/import`);
    await page.locator('input[aria-label="Workbook file"]').setInputFiles(sourceFile);
    await page.getByTestId('import-summary').waitFor();
    await page.getByTestId('import-create').click();
    await page.getByTestId('equip-RTU-1').waitFor();
    const projectUrl = page.url().replace(/\/equipment$/, '');

    // ------------------------------------------------ export "Prelim"
    await page.getByRole('link', { name: 'Export' }).click();
    await page.waitForFunction(() =>
      Boolean((document.querySelector('[data-testid="revision-label"]') as HTMLInputElement)?.value),
    );
    const suggested = await page.getByTestId('revision-label').inputValue();
    check('export: the first revision label suggested is "Prelim"', suggested === 'Prelim', suggested);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-xlsm').click()]);
    const prelimFile = join(dir, 'prelim.xlsm');
    await dl.saveAs(prelimFile);
    await page.getByTestId('export-result').waitFor();
    const prelim = new Uint8Array(readFileSync(prelimFile));
    const prelimRead = await importWorkbookWithReport(prelim);
    check(
      'Prelim carries the revision marker (custom document properties)',
      prelimRead.marker?.label === 'Prelim' &&
        Boolean(prelimRead.marker?.revisionId) &&
        /Prelim/.test(dl.suggestedFilename()),
      `${JSON.stringify(prelimRead.marker)} ${dl.suggestedFilename()}`,
    );

    // ------------------------------------------------ "Excel": direct XML edits on the issued file
    let issued = await editSheet(prelim, 'RTUs', (xml) => {
      let x = editCell(xml, 'D52', (t) =>
        t.replace(/<t>[^<]*<\/t>/, `<t>${REMARK}</t>`).replace(/ s="\d+"/, ' s="188"'),
      );
      x = editCell(x, 'K33', (t) => t.replace(/<v>[^<]*<\/v>/, `<v>${S1_FINAL}</v>`));
      x = editCell(x, 'E20', (t) => t.replace(/<v>[^<]*<\/v>/, `<v>${AMPS_EXCEL}</v>`));
      x = editCell(x, 'B10', (t) => t.replace('<t>Serial Number</t>', '<t>Serial No. (verified)</t>'));
      x = x.replace(COL_D, (c) => c.replace(/width="[^"]*"/, 'width="12.75"'));
      x = x.replace(/<row r="52" ht="[^"]*"/, '<row r="52" ht="27.5"');
      return x;
    });
    issued = await editSheet(issued, '{Project Information}', (xml) =>
      editCell(xml, 'B2', (t) => t.replace(/ s="\d+"/, ' s="3"')),
    );
    const issuedFile = join(dir, 'Riverside - TAB Report Prelim (edited in Excel).xlsm');
    writeFileSync(issuedFile, issued);

    // ------------------------------------------------ meanwhile in the app: the same reading (collision) + another field
    await page.goto(`${projectUrl}/equipment`);
    await page.getByTestId('equip-RTU-1').click();
    await page.waitForURL(/\/e\//);
    for (const [k, v] of [
      ['amps1', AMPS_APP],
      ['fanRpmFinal', RPM_APP],
    ] as const) {
      await page.locator(`[data-field="${k}"] input`).first().fill(String(v));
      await page.locator(`[data-field="${k}"] input`).first().blur();
    }
    await page.waitForTimeout(600);

    const expectReview = async (label: string) => {
      const c = await counts(page);
      const remark = c.items.filter((i) => i.cell === 'remarks');
      const reading = c.items.filter((i) => i.kind === 'incoming' && i.cell === 'finalVel');
      const collision = c.items.filter((i) => i.kind === 'collision');
      check(
        `${label}: 1 remark change, 1 incoming reading, 1 collision, no false changes`,
        c.items.length === 3 &&
          remark.length === 1 &&
          reading.length === 1 &&
          collision.length === 1 &&
          collision[0].cell === 'amps1' &&
          c.incoming === 2 &&
          c.collisions === 1 &&
          c.added === 0,
        JSON.stringify(c),
      );
      return c;
    };

    // ------------------------------------------------ LibreOffice re-save: an import source only (never a base)
    if (spawnSync('sh', ['-c', 'command -v soffice']).status === 0) {
      const loFile = soffice(issuedFile, join(dir, 'libreoffice'));
      if (existsSync(loFile)) {
        const lo = new Uint8Array(readFileSync(loFile));
        const loZip = await JSZip.loadAsync(lo);
        const loRead = await importWorkbookWithReport(lo);
        const loVba = await loZip.file('xl/vbaProject.bin')?.async('uint8array');
        check(
          'LibreOffice re-save uses shared strings and is not a faithful copy (VBA shrinks), so it is only an import source',
          Boolean(loZip.file('xl/sharedStrings.xml')) && (loVba?.length ?? 0) !== templateVba.length,
          `sharedStrings ${Boolean(loZip.file('xl/sharedStrings.xml'))}, vba ${loVba?.length} vs ${templateVba.length}, marker ${loRead.marker ? 'kept' : 'lost'}`,
        );
        await page.goto(`${projectUrl}/export`);
        await page.getByTestId('reimport-link').click();
        await page.locator('input[aria-label="Workbook file"]').setInputFiles(loFile);
        await expectReview(`LibreOffice re-save (marker ${loRead.marker ? 'kept' : 'lost: latest export used'})`);
        await page.getByTestId('review-cancel').click();
        await page.waitForURL(/\/export$/);
        const baseText = await page.getByTestId('export-base').innerText();
        await page.goto(`${projectUrl}/equipment`);
        await page.getByTestId('equip-RTU-1').click();
        await page.waitForURL(/\/e\//);
        const amps = await page.locator('[data-field="amps1"] input').first().inputValue();
        check(
          'Cancel leaves everything untouched (app value, base workbook)',
          amps === String(AMPS_APP) && !baseText.includes('edited in Excel'),
          `amps1 ${amps}; base: ${baseText}`,
        );
      } else check('LibreOffice re-save produced a file', false, loFile);
    } else check('LibreOffice available for the re-save import check', false, 'soffice not on PATH');

    // ------------------------------------------------ re-import the issued (Excel-edited) workbook
    await page.goto(`${projectUrl}/export`);
    await page.getByTestId('reimport-link').click();
    await page.locator('input[aria-label="Workbook file"]').setInputFiles(issuedFile);
    await expectReview('Re-import of the Excel-edited workbook');
    const apply = page.getByTestId('review-apply');
    check('Apply is disabled while the collision is open', await apply.isDisabled());
    await page.getByTestId('accept-all').click();
    check('"Accept all incoming" does not resolve the collision', await apply.isDisabled());
    const collisionText = await page.locator('[data-testid="diff-item"][data-kind="collision"]').innerText();
    check(
      'collision shows the exported, app and workbook values',
      collisionText.includes('3.9') &&
        collisionText.includes(String(AMPS_APP)) &&
        collisionText.includes(String(AMPS_EXCEL)),
      collisionText.replace(/\s+/g, ' '),
    );
    await tallShot(page, join(docShots, '14-reimport-review.png'));
    await page
      .locator('[data-testid="diff-item"][data-kind="collision"]')
      .getByRole('button', { name: 'Use workbook' })
      .click();
    check('Apply is enabled once every collision is resolved', await apply.isEnabled());
    await apply.click();
    await page.getByTestId('reimport-applied').waitFor({ timeout: 30_000 });
    const baseAfter = await page.getByTestId('export-base').innerText();
    check('the re-imported file is the base of the next export', baseAfter.includes('edited in Excel'), baseAfter);

    await page.goto(`${projectUrl}/equipment`);
    await page.getByTestId('equip-RTU-1').click();
    await page.waitForURL(/\/e\//);
    const val = (k: string) => page.locator(`[data-field="${k}"] input`).first().inputValue();
    const remarkNow = await page.locator('#sec-remarks textarea').inputValue();
    const s1 = await page.locator('#supply-0-finalVel').inputValue();
    const a1 = await val('amps1');
    const rpm = await val('fanRpmFinal');
    check(
      'applied: remark, incoming reading and the collision (workbook) in the app; the app-only change kept',
      remarkNow === REMARK && s1 === String(S1_FINAL) && a1 === String(AMPS_EXCEL) && rpm === String(RPM_APP),
      `remark "${remarkNow}", S-1 ${s1}, amps1 ${a1}, rpm ${rpm}`,
    );
    const pendingSets = await page.evaluate(async () => {
      const req = indexedDB.open('a2b-tab');
      const db: IDBDatabase = await new Promise((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const all: { field: string; synced: number; op: string }[] = await new Promise((res) => {
        const r = db.transaction('fieldChanges').objectStore('fieldChanges').getAll();
        r.onsuccess = () => res(r.result);
      });
      db.close();
      return all.filter((c) => c.synced === 0 && c.op === 'set').map((c) => c.field);
    });
    check(
      'accepted values are field changes in the sync outbox',
      ['data.remarks', 'data.finalVel', 'data.amps1'].every((f) => pendingSets.includes(f)),
      pendingSets.filter((f) => /remarks|finalVel|amps1/.test(f)).join(', '),
    );

    // ------------------------------------------------ export "Rev 1" onto the issued workbook
    await page.goto(`${projectUrl}/export`);
    await page.getByTestId('revision').nth(2).waitFor();
    await page.waitForFunction(() =>
      Boolean((document.querySelector('[data-testid="revision-label"]') as HTMLInputElement)?.value),
    );
    const next = await page.getByTestId('revision-label').inputValue();
    check('next revision label suggested is "Rev 1"', next === 'Rev 1', next);
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-xlsm').click()]);
    const rev1File = join(dir, 'rev1.xlsm');
    await dl2.saveAs(rev1File);
    const resultText = await page.getByTestId('export-result').innerText();
    const rev1 = new Uint8Array(readFileSync(rev1File));
    const rtus = await sheetXml(rev1, 'RTUs');
    const pi = await sheetXml(rev1, '{Project Information}');
    check(
      'Rev 1 was written into the issued workbook',
      resultText.includes('edited in Excel'),
      resultText.replace(/\s+/g, ' ').slice(0, 200),
    );
    check(
      'Rev 1 keeps the Excel formatting: restyled remark cell, column D width, row height, label text, restyled header',
      /s="188"/.test(cellTag(rtus, 'D52')) &&
        /width="12.75"/.test(COL_D.exec(rtus)?.[0] ?? '') &&
        /<row r="52" ht="27.5"/.test(rtus) &&
        cellTag(rtus, 'B10').includes('Serial No. (verified)') &&
        / s="3"/.test(cellTag(pi, 'B2')),
      `${cellTag(rtus, 'D52').slice(0, 80)} | ${COL_D.exec(rtus)?.[0]}`,
    );
    check(
      'Rev 1: VBA project byte-identical to the template',
      Buffer.from(await vbaOf(rev1)).equals(Buffer.from(templateVba)),
    );
    const back = await importWorkbookWithReport(rev1);
    const u1 = back.project.equipment.rtu?.find((u) => u.slot === 1);
    check(
      'Rev 1 values (read back): remark, readings, collision result, app-only change; new revision marker',
      u1?.lines?.remarks?.[0] === REMARK &&
        u1.tables?.supply?.[0]?.finalVel === S1_FINAL &&
        u1.fields?.amps1 === AMPS_EXCEL &&
        u1.fields?.fanRpmFinal === RPM_APP &&
        back.marker?.label === 'Rev 1' &&
        back.marker.revisionId !== prelimRead.marker?.revisionId,
      JSON.stringify({ r: u1?.lines?.remarks, s: u1?.tables?.supply?.[0], a: u1?.fields?.amps1, m: back.marker }),
    );
    // a second re-import of Rev 1 right away: nothing to review
    await page.getByTestId('reimport-link').click();
    await page.locator('input[aria-label="Workbook file"]').setInputFiles(rev1File);
    await page.getByTestId('reimport-review').waitFor();
    check('re-import of the untouched Rev 1: no changes', (await page.getByTestId('review-nothing').count()) === 1);
    await page.getByTestId('review-cancel').click();
    await page.waitForURL(/\/export$/);

    // ------------------------------------------------ revision history
    await page.getByTestId('revision').nth(3).waitFor();
    const revs = await page
      .getByTestId('revision')
      .evaluateAll((els) =>
        els.map((e) => `${(e as HTMLElement).dataset.kind}:${(e.querySelector('b') as HTMLElement).innerText}`),
      );
    check(
      'revision history: Rev 1, Imported Prelim (the re-import), Prelim, Imported Prelim (the project was created from a Prelim)',
      JSON.stringify(revs.slice(0, 3)) ===
        JSON.stringify(['export:Rev 1', 'import:Imported Prelim', 'export:Prelim']) &&
        /^import:Imported/.test(revs[3] ?? ''),
      JSON.stringify(revs),
    );
    await tallShot(page, join(docShots, '15-revisions.png'));
    const [dl3] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download Prelim' }).click(),
    ]);
    const again = join(dir, 'prelim-again.xlsm');
    await dl3.saveAs(again);
    check('a past revision re-downloads byte-identical', readFileSync(again).equals(readFileSync(prelimFile)));
    check('re-import walk: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}
