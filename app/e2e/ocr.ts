/**
 * E2E: schedules that have no text: a "scanned" drawing (a PDF that is only an image) and a photo of a schedule.
 * The schedule is drawn as an HTML table in a scratch page, captured as PNG, and wrapped in an image-only PDF with
 * pdf-lib. Import schedule reads both through the grid lines and text recognition (tesseract.js served from /ocr,
 * under the app's CSP): type from the title, units previewed, the text-recognition note. Screenshot 45.
 */
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { Browser, Page } from 'playwright-core';

type Check = (name: string, ok: boolean, detail?: string) => void;

const ROWS = [
  ['EF-31', 'TOILETS', '450', '0.500', '1/4', '115-1', 'GREENHECK', 'SP-B110'],
  ['EF-32', 'JANITOR', '120', '0.375', '1/10', '115-1', 'GREENHECK', 'SP-A90'],
  ['EF-33', 'ELEC ROOM', '800', '0.750', '1/2', '115-1', 'COOK', 'GC-148'],
];

/** A drawing-style schedule (serif caps, thin ruling lines, a group header) as a PNG. */
async function schedulePng(browser: Browser): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 420 }, deviceScaleFactor: 2 });
  const cell = 'border:1.2px solid #000;padding:6px 10px;text-align:center';
  const html = `<!doctype html><html><body style="margin:20px;background:#fff;font:15px 'Times New Roman',serif">
  <table id="t" style="border-collapse:collapse">
   <tr><th colspan="8" style="${cell};font-size:26px;font-weight:normal">EXHAUST FAN SCHEDULE</th></tr>
   <tr><th rowspan="2" style="${cell}">MARK</th><th rowspan="2" style="${cell}">SERVICE</th><th rowspan="2" style="${cell}">CFM</th>
       <th rowspan="2" style="${cell}">ESP (IN. W.G.)</th><th colspan="2" style="${cell}">MOTOR</th>
       <th rowspan="2" style="${cell}">MANUFACTURER</th><th rowspan="2" style="${cell}">MODEL</th></tr>
   <tr><th style="${cell}">HP</th><th style="${cell}">V-PH</th></tr>
   ${ROWS.map((r) => `<tr>${r.map((c) => `<td style="${cell}">${c}</td>`).join('')}</tr>`).join('')}
   <tr><td colspan="8" style="${cell};text-align:left">NOTES: 1. PROVIDE WITH DISCONNECT.</td></tr>
  </table></body></html>`;
  await page.setContent(html);
  const png = await page.locator('#t').screenshot({ type: 'png' });
  await page.close();
  return png;
}

async function imagePdf(png: Buffer): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  // a 17" x 11" sheet with the schedule placed on it at about 200 dpi, no text layer
  const page = doc.addPage([1224, 792]);
  const w = (img.width / 200) * 72;
  const h = (img.height / 200) * 72;
  page.drawImage(img, { x: 60, y: 792 - 60 - h, width: w, height: h });
  return doc.save();
}

async function importFile(page: Page, projectUrl: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto(`${projectUrl}/schedule`);
  await page.getByRole('button', { name: 'File (CSV, Excel, PDF)' }).click();
  await page.locator('input[aria-label="Schedule file"]').setInputFiles(file);
  await page.getByTestId('preview-summary-fan').waitFor({ timeout: 120_000 });
}

export async function ocrFlow(browser: Browser, base: string, docShots: string, check: Check) {
  const png = await schedulePng(browser);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${base}/new`);
    await page.locator('#np-name').fill('Scanned schedule job');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.waitForURL(/\/p\/.+\/info$/);
    const projectUrl = page.url().replace(/\/info$/, '');

    // ---- an image-only PDF (a scan / text drawn as outlines)
    await importFile(page, projectUrl, {
      name: 'M-601 scanned.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await imagePdf(png)),
    });
    const sheetName = await page
      .locator('select[aria-label="Sheet"] option:checked')
      .innerText()
      .catch(() => '');
    const note = await page.getByTestId('ocr-note').isVisible();
    const type = await page.locator('#si-type').inputValue();
    const summary = await page.getByTestId('preview-summary-fan').innerText();
    const cells = await page.getByTestId('preview-fan').locator('tbody tr').allInnerTexts();
    check(
      'scanned PDF: the schedule is read by text recognition (grid lines, title -> Fans, 3 units previewed)',
      note && type === 'fan' && /3 new/.test(summary) && /EF-31/.test(cells.join()) && /EF-33/.test(cells.join()),
      `${sheetName} | ${type} | ${summary} | ${cells.map((c) => c.replace(/\s+/g, ' ')).join(' / ')}`,
    );
    const ef32 = cells.find((c) => /EF-32/.test(c)) ?? '';
    check(
      'scanned PDF: values land in their columns (EF-32: 120 CFM, ESP 0.375, 1/10 HP, 115 V, Greenheck SP-A90)',
      /120/.test(ef32) && /0\.375/.test(ef32) && /0\.1/.test(ef32) && /115/.test(ef32) && /SP-A90/.test(ef32),
      ef32.replace(/\s+/g, ' '),
    );
    await page.getByTestId('ocr-note').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(docShots, '45-scanned-schedule.png') });

    // ---- a photo of the schedule
    await importFile(page, projectUrl, { name: 'schedule photo.png', mimeType: 'image/png', buffer: png });
    const photoCells = await page.getByTestId('preview-fan').locator('tbody tr').allInnerTexts();
    check(
      'photo of a schedule: read the same way',
      photoCells.length === 3 && /EF-31/.test(photoCells.join()),
      photoCells.map((c) => c.replace(/\s+/g, ' ')).join(' / '),
    );
    check('text recognition e2e: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}
