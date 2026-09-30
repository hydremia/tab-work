/**
 * Text recognition for the schedule import (workbook/pdfSchedules.ts) works offline once its files are in the
 * service worker's "a2b-ocr" cache (vite.config.ts runtimeCaching). They are not precached at install (about 7 MB,
 * and most sessions never need them): once the app has been open a while, online and not on a data saver, they are
 * fetched once in the background, so a drawing can be read on site without signal.
 */
const FILES = ['/ocr/worker.min.js', '/ocr/tesseract-core-simd-lstm.wasm.js', '/ocr/eng.traineddata.gz'];
const DELAY_MS = 30_000;

export function prefetchOcr(): void {
  if (!('serviceWorker' in navigator) || !('caches' in window)) return;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  window.setTimeout(() => {
    void (async () => {
      if (!navigator.onLine || !navigator.serviceWorker.controller) return;
      for (const url of FILES) {
        if (await caches.match(url)) continue;
        // through the service worker, which stores the response (CacheFirst)
        await fetch(url).catch(() => undefined);
      }
    })();
  }, DELAY_MS);
}
