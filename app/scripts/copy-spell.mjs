/**
 * Copies the Hunspell en-US dictionary (dictionary-en: index.aff, index.dic, about 560 KB) from node_modules into
 * public/spell/ so the app serves it itself and the Spelling check works offline (precached with the app shell).
 * The copies are git-ignored.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// the package exports only its index.js (which reads the two files next to it)
const dir = dirname(fileURLToPath(import.meta.resolve('dictionary-en')));
const OUT = join(here, '..', 'public', 'spell');
mkdirSync(OUT, { recursive: true });
for (const [source, target] of [
  [join(dir, 'index.aff'), 'en.aff'],
  [join(dir, 'index.dic'), 'en.dic'],
]) {
  if (!existsSync(source)) {
    console.error(`copy-spell: not found: ${source}`);
    process.exit(1);
  }
  const to = join(OUT, target);
  const fresh = existsSync(to) && statSync(to).size === statSync(source).size;
  if (!fresh) copyFileSync(source, to);
  console.log(`copy-spell: ${fresh ? 'up to date' : 'copied'} -> public/spell/${target}`);
}
