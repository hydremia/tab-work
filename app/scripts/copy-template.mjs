/**
 * Copies the revision 05 TAB workbook template from the repository root into public/templates/ so Vite serves
 * and bundles it (and the service worker precaches it for offline export). The copy is git-ignored: the
 * template is kept in git once, at the repository root.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, '..', '..', '05 - a2b_Blank_TAB_Workbook 9-23-26.xlsm');
const TARGET = join(here, '..', 'public', 'templates', 'tab-template-rev05.xlsm');

if (!existsSync(SOURCE)) {
  console.error(`copy-template: template not found at ${SOURCE}`);
  process.exit(1);
}
mkdirSync(dirname(TARGET), { recursive: true });
const fresh =
  existsSync(TARGET) &&
  statSync(TARGET).size === statSync(SOURCE).size &&
  statSync(TARGET).mtimeMs >= statSync(SOURCE).mtimeMs;
if (!fresh) copyFileSync(SOURCE, TARGET);
console.log(`copy-template: ${fresh ? 'up to date' : 'copied'} -> public/templates/tab-template-rev05.xlsm`);
