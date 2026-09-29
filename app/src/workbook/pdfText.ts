/**
 * The text of a PDF with positions (pdf.js), page by page, for domain/pdfTables.ts. Lazy-loaded with the schedule
 * file reader; pdf.js parses in its worker. Nothing is rendered and no fonts are loaded. The legacy build: it runs
 * on older tablets' browsers (the modern build needs Promise.try).
 */
import type { PdfPageText } from '../domain/pdfTables';

/** Drawing sets can be long: the pages read at most. */
export const MAX_PDF_PAGES = 200;

export async function readPdfText(bytes: Uint8Array): Promise<{ pages: PdfPageText[]; pageCount: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  const task = pdfjs.getDocument({ data: bytes, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages: PdfPageText[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
      const page = await doc.getPage(n);
      const view = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.flatMap((it) =>
        'str' in it ? [{ str: it.str, transform: it.transform as number[], width: it.width, height: it.height }] : [],
      );
      // a rotated sheet (landscape drawings are often stored rotated): the viewport transform brings it upright, then
      // y is flipped back to upwards for pdfTables
      const [a, b, c, d, e, f] = view.transform;
      const upright = items.map((it) => {
        const [ia, ib, ic, id, ix, iy] = it.transform;
        return {
          ...it,
          transform: [
            a * ia + c * ib,
            -(b * ia + d * ib),
            a * ic + c * id,
            -(b * ic + d * id),
            a * ix + c * iy + e,
            view.height - (b * ix + d * iy + f),
          ],
        };
      });
      pages.push({ page: n, width: view.width, height: view.height, items: upright });
      page.cleanup();
    }
    return { pages, pageCount: doc.numPages };
  } finally {
    await task.destroy();
  }
}
