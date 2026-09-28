// @vitest-environment node
import jsQR from 'jsqr';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { parseTagUrl, qrMatrix, qrSvg, tagsPdf, tagUrl, TAG_LAYOUT } from './tags';

const P = 'aaaaaaaa-0000-4000-8000-000000000001';
const U = 'bbbbbbbb-0000-4000-8000-000000000001';

/** Render the QR modules to RGBA pixels (4 px per module, quiet zone) and decode them. */
function decode(m: boolean[][]): string | null {
  const scale = 4;
  const n = (m.length + 8) * scale;
  const px = new Uint8ClampedArray(n * n * 4).fill(255);
  m.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (!dark) return;
      for (let y = 0; y < scale; y++)
        for (let x = 0; x < scale; x++) {
          const i = (((r + 4) * scale + y) * n + (c + 4) * scale + x) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
    }),
  );
  return jsQR(px, n, n)?.data ?? null;
}

describe('equipment QR tags', () => {
  it('the tag link opens the unit, from any origin; other links are not tags', () => {
    const url = tagUrl('https://tab.example.com/', P, U);
    expect(url).toBe(`https://tab.example.com/t/${P}/${U}`);
    expect(parseTagUrl(url)).toEqual({ projectId: P, unitId: U });
    expect(parseTagUrl(`https://preview-123.vercel.app/t/${P}/${U}?x=1`)).toEqual({ projectId: P, unitId: U });
    expect(parseTagUrl('https://example.com/p/whatever')).toBeNull();
    expect(parseTagUrl('SN 1234567')).toBeNull();
  });

  it('the QR code decodes back to the link (checked with an independent decoder)', () => {
    const url = tagUrl('https://tab.example.com', P, U);
    expect(decode(qrMatrix(url))).toBe(url);
    expect(qrSvg(url)).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/);
  });

  it('labels: 12 per Letter page inside the page, the rest on the next page', async () => {
    const L = TAG_LAYOUT;
    expect(L.left * 2 + L.cols * L.size + (L.cols - 1) * L.gapX).toBe(8.5 * 72);
    expect(L.top * 2 + L.rows * L.size + (L.rows - 1) * L.gapY).toBe(11 * 72);
    const labels = Array.from({ length: 13 }, (_, i) => ({
      url: tagUrl('https://tab.example.com', P, U),
      designation: `RTU-${i + 1}`,
      typeLabel: 'RTU / AHU / DOAS',
      project: 'Riverside Medical Office with a very long project name that does not fit',
    }));
    const doc = await PDFDocument.load(await tagsPdf(labels));
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });
});
