/**
 * E2E: the report check. A workbook exported earlier in the run is checked on /check without importing it (the page
 * reads it in memory), then imported, and the project's Export tab shows the same checklist; a finding links to the
 * page that fixes it. Screenshot 41.
 */
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { PDFDocument } from 'pdf-lib';
import type { Browser } from 'playwright-core';

type Check = (name: string, ok: boolean, detail?: string) => void;

export async function reviewFlow(
  browser: Browser,
  base: string,
  workbookFile: string,
  docShots: string,
  outDir: string,
  check: Check,
) {
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
    // graphics appendix from the same project
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('report-graphics').click()]);
    const pdfPath = join(outDir, 'graphics.pdf');
    await dl.saveAs(pdfPath);
    const pdf = await PDFDocument.load(new Uint8Array(readFileSync(pdfPath)));
    check(
      'graphics appendix: a PDF of figures (static profiles, outlet charts, traverses) from the project',
      pdf.getPageCount() >= 2 && /Graphics Appendix/.test(dl.suggestedFilename()),
      `${dl.suggestedFilename()} · ${pdf.getPageCount()} pages`,
    );
    // final report: the workbook printed to PDF (LibreOffice here, Excel's Print Report in the field), figures placed
    // after their unit's pages, every page numbered
    if (spawnSync('sh', ['-c', 'command -v soffice']).status === 0) {
      const pdfDir = mkdtempSync(join(tmpdir(), 'e2e-report-pdf-'));
      const profile = mkdtempSync(join(tmpdir(), 'lo-profile-'));
      spawnSync(
        'soffice',
        [`-env:UserInstallation=file://${profile}`, '--headless', '--convert-to', 'pdf', '--outdir', pdfDir, workbookFile],
        { encoding: 'utf8', timeout: 600_000 },
      );
      const reportPdf = join(pdfDir, basename(workbookFile).replace(/\.xlsm$/i, '.pdf'));
      const reportPages = (await PDFDocument.load(new Uint8Array(readFileSync(reportPdf)))).getPageCount();
      await page.getByTestId('final-outlet-charts').check();
      const [dl2] = await Promise.all([
        page.waitForEvent('download', { timeout: 180_000 }),
        page.locator('input[aria-label="Report PDF from Excel"]').setInputFiles(reportPdf),
      ]);
      const finalPath = join(outDir, 'final-report.pdf');
      await dl2.saveAs(finalPath);
      const finalPages = (await PDFDocument.load(new Uint8Array(readFileSync(finalPath)))).getPageCount();
      const note = await page.getByTestId('final-note').innerText();
      check(
        'final report: the workbook PDF with the figures after their units, every page numbered, ToC kept in step',
        finalPages > reportPages && /[1-9]\d* figure groups? placed/.test(note) && /TAB Report/.test(dl2.suggestedFilename()),
        `${dl2.suggestedFilename()} · ${reportPages} -> ${finalPages} pages · ${note}`,
      );
      await page.getByTestId('report-final').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(docShots, '52-final-report.png') });
    } else check('LibreOffice available for the final report check', false, 'soffice not on PATH');
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
