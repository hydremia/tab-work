/**
 * Copies the text-recognition files (tesseract.js worker, its WebAssembly core, the English model) from node_modules
 * into public/ocr/ so the app serves them itself: no CDN, and they work offline once cached. Used by the schedule
 * import for drawings without a text layer (outlined / scanned PDFs) and photos (workbook/pdfOcr.ts). The copies are
 * git-ignored. Not precached at install (about 7 MB): cached on first use, and fetched in the background once online
 * (src/ocrPrefetch.ts).
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const FILES = [
  [join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), 'worker.min.js'],
  // tesseract.js picks the SIMD build where the browser supports it (all current ones), else the plain one
  [join(pkgDir('tesseract.js-core'), 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [join(pkgDir('tesseract.js-core'), 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  // the compact LSTM model (about 3 MB)
  [join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
];

const OUT = join(here, '..', 'public', 'ocr');
mkdirSync(OUT, { recursive: true });
for (const [source, target] of FILES) {
  if (!existsSync(source)) {
    console.error(`copy-ocr: not found: ${source}`);
    process.exit(1);
  }
  const to = join(OUT, target);
  const fresh = existsSync(to) && statSync(to).size === statSync(source).size;
  if (!fresh) copyFileSync(source, to);
  console.log(`copy-ocr: ${fresh ? 'up to date' : 'copied'} -> public/ocr/${target}`);
}
