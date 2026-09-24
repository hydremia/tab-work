/**
 * Phase 4 e2e: photo capture and processing, Photos tab, deficiency photos on issues, PDF reports and the photo zip.
 * Runs on the main e2e project (after its workbook export) in the same page:
 *   - RTU-1: clear the tag / OA damper N/A marks -> amber; attach an EXIF-rotated JPEG (orientation 6, capture time,
 *     GPS) as the tag photo and a PNG as the OA damper photo -> green again; the stored tag photo is upright
 *   - issues: New N-1 (RTU-1) with 2 deficiency photos, New N-2 (General), Existing E-1 with 1 photo
 *   - Photos tab: groups, labels, viewer (caption, reorder), missing-photo list, storage
 *   - Export: Photo Report, Issues Report (All / New / Existing), combined, zip -> verified in Node with pdf-lib,
 *     pdftotext and JSZip; page 1 of the Photo and Issues reports rendered with pdftoppm into docs/screenshots.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import type { Page } from 'playwright-core';
import { makeJpeg, withExif } from '../src/test/images';

type Check = (name: string, ok: boolean, detail?: string) => void;

const libraryInput = (page: Page, testId: string) =>
  page.getByTestId(testId).locator('input[type="file"]:not([capture])');

/** 400 x 200 stored JPEG: left half red, right half blue; EXIF orientation 6 = displayed 200 x 400, red on top. */
function rotatedJpeg(): Buffer {
  const raw = makeJpeg(400, 200, (x) => (x < 200 ? [220, 20, 20] : [20, 40, 220]), 90);
  return Buffer.from(
    withExif(raw, { orientation: 6, dateTimeOriginal: '2026:09:15 10:30:00', gps: { lat: 38.5816, lon: -121.4944 } }),
  );
}
const photoFile = (name: string, rgb: [number, number, number], w = 640, h = 480) => ({
  name,
  mimeType: 'image/jpeg',
  buffer: Buffer.from(makeJpeg(w, h, (x, y) => [rgb[0], (rgb[1] + x / 4) % 255, (rgb[2] + y / 4) % 255], 85)),
});

async function download(page: Page, testId: string, out: string): Promise<string> {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByTestId(testId).click(),
  ]);
  const file = join(out, dl.suggestedFilename());
  await dl.saveAs(file);
  await page.getByTestId('report-result').waitFor();
  return file;
}

const pdfText = (file: string) => spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }).stdout ?? '';
const pageCount = async (file: string) => (await PDFDocument.load(readFileSync(file))).getPageCount();
function renderPage1(file: string, png: string) {
  const base = png.replace(/\.png$/, '');
  spawnSync('pdftoppm', ['-r', '80', '-png', '-f', '1', '-l', '1', '-singlefile', file, base]);
}

export async function photosFlow(page: Page, projectUrl: string, out: string, docShots: string, check: Check) {
  // ------------------------------------------------------------------ unit photos + completion
  await page.goto(`${projectUrl}/equipment`);
  await page.getByTestId('equip-RTU-1').click();
  await page.waitForURL(/\/e\//);
  await page.getByTestId('photo-tag').locator('select.na-select').selectOption('clear');
  await page.getByTestId('photo-oa_damper').locator('select.na-select').selectOption('clear');
  await page.waitForTimeout(500);
  const amber = await page.getByTestId('status-badge').first().innerText();
  check('RTU-1: tag / OA damper photos required again -> not complete', !amber.includes('Complete'), amber);

  await libraryInput(page, 'photo-tag').setInputFiles({
    name: 'IMG_0421.JPG',
    mimeType: 'image/jpeg',
    buffer: rotatedJpeg(),
  });
  await page.getByTestId('photo-tag').locator('img').waitFor();
  await libraryInput(page, 'photo-oa_damper').setInputFiles(photoFile('oa.jpg', [90, 120, 60]));
  await page.getByTestId('photo-oa_damper').locator('img').waitFor();
  await page.waitForTimeout(500);
  const green = await page.getByTestId('status-badge').first().innerText();
  check(
    'RTU-1: complete (green) again once the tag and OA damper photos are attached',
    green.includes('Complete'),
    green,
  );

  await page.getByTestId('photo-tag').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, 'unit-photos.png') });
  // the stored tag photo: processed upright (EXIF orientation applied), capture time + GPS kept
  await page.getByRole('button', { name: /View .*tag photo/i }).click();
  await page.getByTestId('photo-viewer').waitFor();
  const meta = await page.getByTestId('photo-viewer').innerText();
  // (a string, so the bundler's name helpers are not injected into the page)
  const px = (await page.evaluate(`(async () => {
    const img = document.querySelector('[data-testid="photo-viewer"] .viewer-img img');
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const x = Math.floor(img.naturalWidth / 2);
    return {
      w: img.naturalWidth,
      h: img.naturalHeight,
      top: Array.from(ctx.getImageData(x, 20, 1, 1).data.slice(0, 3)),
      bottom: Array.from(ctx.getImageData(x, img.naturalHeight - 20, 1, 1).data.slice(0, 3)),
    };
  })()`)) as { w: number; h: number; top: number[]; bottom: number[] };
  check(
    'EXIF-rotated JPEG stored upright: 200 x 400, red on top, blue at the bottom; capture time and GPS kept',
    px.w === 200 &&
      px.h === 400 &&
      px.top[0] > 150 &&
      px.top[2] < 100 &&
      px.bottom[2] > 150 &&
      px.bottom[0] < 100 &&
      /200 × 400 px/.test(meta) &&
      /taken/.test(meta) &&
      /GPS 38\.58/.test(meta),
    `${JSON.stringify(px)} | ${meta.replace(/\s+/g, ' ').slice(0, 160)}`,
  );
  await page.locator('#pv-caption').fill('Nameplate on the return side');
  await page.locator('#pv-caption').blur();
  await page.getByTestId('photo-viewer').getByRole('button', { name: 'Close', exact: true }).click();

  // ------------------------------------------------------------------ issues with deficiency photos
  await page.goto(`${projectUrl}/issues`);
  await page.getByRole('button', { name: 'Add new issue' }).click();
  await page.getByTestId('issue-new-1').waitFor();
  await page.getByRole('button', { name: 'Add new issue' }).click();
  await page.getByTestId('issue-new-2').waitFor();
  await page.getByRole('button', { name: 'Add existing issue' }).click();
  await page.getByTestId('issue-existing-1').waitFor();
  const n1 = page.getByTestId('issue-new-1');
  await n1.getByLabel('Issue N-1 equipment').selectOption({ label: 'RTU-1' });
  await n1.locator('textarea').first().fill('Supply fan belt worn and slipping; replace and re-tension.');
  await n1.locator('textarea').nth(1).fill('Mechanical contractor notified 9/20.');
  await n1.locator('textarea').nth(1).blur();
  await n1
    .locator('input[aria-label="Issue N-1 photo"]')
    .setInputFiles([photoFile('belt-1.jpg', [140, 60, 40]), photoFile('belt-2.jpg', [60, 60, 140], 480, 640)]);
  const n2 = page.getByTestId('issue-new-2');
  await n2.locator('textarea').first().fill('Balancing damper for S-4 missing.');
  await n2.locator('textarea').first().blur();
  await n2.getByRole('button', { name: 'Closed' }).click();
  const e1 = page.getByTestId('issue-existing-1');
  await e1.locator('textarea').first().fill('Existing exhaust fan bearing noisy.');
  await e1.locator('textarea').first().blur();
  await e1.locator('input[aria-label="Issue E-1 photo"]').setInputFiles([photoFile('ef.jpg', [30, 140, 90])]);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="deficiency-photo"]').length === 3, null, {
    timeout: 15_000,
  });
  const labels = await page
    .getByTestId('deficiency-photo')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-label')));
  check(
    'deficiency photos numbered to their issue: Photo N-1.1, N-1.2, E-1.1',
    JSON.stringify(labels) === JSON.stringify(['Photo N-1.1', 'Photo N-1.2', 'Photo E-1.1']),
    JSON.stringify(labels),
  );
  await page.evaluate(() =>
    window.scrollTo(
      0,
      document.querySelector('[data-testid="issue-new-1"]')!.getBoundingClientRect().top + window.scrollY - 120,
    ),
  );
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(docShots, '17-issue-photos.png') });

  // reorder: N-1.2 becomes N-1.1
  await n1.getByRole('button', { name: 'Open Photo N-1.2' }).click();
  await page.getByTestId('photo-move-up').click();
  await page.waitForTimeout(300);
  const relabelled = await page.getByTestId('viewer-label').innerText();
  check("reordering an issue's photos renumbers them (N-1.2 -> N-1.1)", relabelled === 'Photo N-1.1', relabelled);
  await page.locator('#pv-caption').fill('Belt glazing close-up');
  await page.locator('#pv-caption').blur();
  await page.getByTestId('photo-viewer').getByRole('button', { name: 'Close', exact: true }).click();

  // ------------------------------------------------------------------ Photos tab
  await page.goto(`${projectUrl}/photos`);
  await page.getByTestId('photo-count').waitFor();
  const groups = await page
    .locator('[data-testid^="photo-group-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('photo-group-', '')));
  check(
    'Photos tab: grouped by cover, equipment and issue',
    groups[0] === 'Cover' && groups.includes('RTU-1') && groups.includes('Issue N-1') && groups.includes('Issue E-1'),
    groups.join(', '),
  );
  const missing = await page
    .getByTestId('missing-photos')
    .innerText()
    .catch(() => '');
  check(
    'Photos tab: units missing required photos are listed (RTU-2)',
    /RTU-2/.test(missing) && !/RTU-1:/.test(missing),
    missing.replace(/\s+/g, ' ').slice(0, 200),
  );
  await page.getByRole('button', { name: 'Deficiency', exact: true }).click();
  const defCount = await page.getByTestId('photo-card').count();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  check('Photos tab: category filter (Deficiency: 3)', defCount === 3, String(defCount));
  const storage = await page.getByTestId('photo-storage').innerText();
  check(
    'Photos tab: storage used and persistence shown',
    /photos · \d/.test(storage) && /Storage/.test(storage),
    storage.replace(/\s+/g, ' ').slice(0, 200),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(docShots, '16-photos-tab.png') });

  // ------------------------------------------------------------------ reports
  await page.goto(`${projectUrl}/export`);
  await page.getByTestId('reports').waitFor();
  await page
    .waitForFunction(() => (document.querySelector('[data-testid="report-label"]') as HTMLInputElement)?.value, null, {
      timeout: 5000,
    })
    .catch(() => undefined);
  const label = await page.getByTestId('report-label').inputValue();
  check('report label defaults to the last workbook revision', label === 'Prelim', label);

  const photoPdf = await download(page, 'report-photos', out);
  const photoPages = await pageCount(photoPdf);
  const pt = pdfText(photoPdf);
  check(
    'Photo Report: valid PDF, header, unit groups, labels, captions, deficiency photos, page numbers',
    photoPages >= 3 &&
      [
        'a2b accurate air balancing, llc',
        'Photo Report',
        'Riverside Medical Office',
        'RTU-1 · Unit',
        'RTU-1 · Tag / label',
        'Nameplate on the return side',
        'Photo N-1.1',
        'Belt glazing close-up',
        'Photo E-1.1',
        'Prelim',
        `Page ${photoPages} of ${photoPages}`,
      ].every((s) => pt.includes(s)),
    `${photoPdf.split('/').pop()}: ${photoPages} pages`,
  );
  renderPage1(photoPdf, join(docShots, '18-photo-report-p1.png'));

  const issuesPdf = await download(page, 'report-issues', out);
  const it = pdfText(issuesPdf);
  check(
    'Issues Report (all): New and Existing sections, numbers, status, remark, comments, deficiency photos',
    [
      'Issues Report',
      'New Equipment',
      'Existing Equipment',
      'Issue N-1',
      'Issue N-2',
      'Issue E-1',
      'OPEN',
      'CLOSED',
      'Supply fan belt worn',
      'Mechanical contractor notified 9/20.',
      'General',
      'Photo N-1.2',
      'Photo E-1.1',
    ].every((s) => it.includes(s)),
    `${await pageCount(issuesPdf)} pages`,
  );
  renderPage1(issuesPdf, join(docShots, '19-issues-report-p1.png'));

  await page.getByTestId('issue-scope-new').click();
  const newPdf = await download(page, 'report-issues', out);
  const nt = pdfText(newPdf);
  check(
    'Issues Report (New only): no Existing issues',
    newPdf.includes('(New)') &&
      nt.includes('Issue N-1') &&
      !nt.includes('Issue E-1') &&
      !nt.includes('Existing Equipment'),
    newPdf.split('/').pop(),
  );
  await page.getByTestId('issue-scope-existing').click();
  const exPdf = await download(page, 'report-issues', out);
  const et = pdfText(exPdf);
  check(
    'Issues Report (Existing only): no New issues',
    exPdf.includes('(Existing)') && et.includes('Issue E-1') && !et.includes('Issue N-1'),
    exPdf.split('/').pop(),
  );
  await page.getByTestId('issue-scope-all').click();
  const combPdf = await download(page, 'report-combined', out);
  const ct = pdfText(combPdf);
  const combPages = await pageCount(combPdf);
  check(
    'Combined Issues + Photos report',
    ct.includes('Issues and Photo Report') &&
      ct.includes('Issue E-1') &&
      ct.includes('RTU-1 · Unit') &&
      combPages > photoPages / 2,
    `${combPages} pages`,
  );

  const zipFile = await download(page, 'report-zip', out);
  const zip = await JSZip.loadAsync(readFileSync(zipFile));
  const names = Object.keys(zip.files).sort();
  check(
    'Photos zip: named by unit / category / issue',
    [
      'Cover.jpg',
      'RTU-1 - Unit - 01.jpg',
      'RTU-1 - Tag - 01.jpg',
      'RTU-1 - OA Damper - 01.jpg',
      'Issue N-1 - 1.jpg',
      'Issue N-1 - 2.jpg',
      'Issue E-1 - 1.jpg',
    ].every((n) => names.includes(n)),
    names.join(', '),
  );
  await page.screenshot({ path: join(out, 'reports-export.png'), fullPage: true });
}
