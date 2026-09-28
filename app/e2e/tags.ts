/**
 * E2E: QR equipment tags. A browser whose camera is a video file (Chromium's fake capture device): a project is
 * imported, the Equipment tab's QR tags page downloads the label PDF (screenshot 36), then the video shows RTU-1's tag
 * and *Scan tag* in the app reads it (BarcodeDetector or jsQR on the frames) and opens RTU-1's page.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { Browser } from 'playwright-core';
import { qrMatrix } from '../src/tags/tags';

type Check = (name: string, ok: boolean, detail?: string) => void;

/** A Y4M video (a few identical frames) of a QR code, white around it. */
function qrVideo(text: string, path: string): void {
  const m = qrMatrix(text);
  const scale = 5;
  const w = 320;
  const h = 240;
  const side = (m.length + 8) * scale;
  const ox = Math.floor((w - side) / 2);
  const oy = Math.floor((h - side) / 2);
  const y = Buffer.alloc(w * h, 235);
  m.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) y[(oy + (r + 4) * scale + dy) * w + ox + (c + 4) * scale + dx] = 16;
    }),
  );
  const uv = Buffer.alloc((w / 2) * (h / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, uv, uv]);
  writeFileSync(
    path,
    Buffer.concat([Buffer.from(`YUV4MPEG2 W${w} H${h} F10:1 Ip A1:1 C420jpeg\n`), ...Array(10).fill(frame)]),
  );
}

export async function tagsFlow(
  base: string,
  workbookFile: string,
  docShots: string,
  outDir: string,
  check: Check,
  launch: (args: string[]) => Promise<Browser>,
) {
  const video = join(outDir, 'qr-camera.y4m');
  writeFileSync(video, ''); // replaced once the unit's link is known (read when the camera starts)
  const browser = await launch([
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${video}`,
  ]);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
    permissions: ['camera'],
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${base}/import`);
    await page.locator('input[aria-label="Workbook file"]').setInputFiles(workbookFile);
    await page.getByTestId('import-create').click();
    await page.getByTestId('equip-RTU-1').click();
    await page.waitForURL(/\/e\//);
    const unitPath = new URL(page.url()).pathname;
    const [, projectId, unitId] = /\/p\/([^/]+)\/e\/([^/]+)/.exec(unitPath)!;
    await page.goto(`${base}/p/${projectId}/equipment`);
    await page.getByTestId('qr-tags').click();
    await page.waitForURL(/\/tags$/);
    await page.getByTestId('tag-preview').first().waitFor();
    await page.screenshot({ path: join(docShots, '36-qr-tags.png') });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('tags-download').click()]);
    const pdfFile = join(outDir, 'qr-tags.pdf');
    await dl.saveAs(pdfFile);
    const pdf = await PDFDocument.load(new Uint8Array((await import('node:fs')).readFileSync(pdfFile)));
    const labels = (await page.getByTestId('tags-download').innerText()).replace(/\D+/g, ' ').trim();
    check(
      'QR tags: label PDF for the project units (Letter pages, 12 per page)',
      pdf.getPageCount() === Math.ceil(Number(labels) / 12) && /QR tags\.pdf$/.test(dl.suggestedFilename()),
      `${labels} labels, ${pdf.getPageCount()} page(s), ${dl.suggestedFilename()}`,
    );
    // the camera shows RTU-1's tag: Scan tag opens the unit
    qrVideo(`${base}/t/${projectId}/${unitId}`, video);
    await page.goto(base);
    await page.getByTestId('scan-link').click();
    await page.waitForURL((u) => u.pathname === unitPath, { timeout: 20_000 }).catch(() => undefined);
    const opened = new URL(page.url()).pathname;
    const err = await page
      .getByTestId('scan-error')
      .innerText()
      .catch(() => '');
    check(
      'QR tags: Scan tag reads the tag from the camera and opens the unit',
      opened === unitPath,
      `${opened} ${err}`,
    );
    check('QR tags e2e: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
    await browser.close();
  }
}
