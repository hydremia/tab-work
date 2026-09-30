/**
 * Copies the workbook templates (airside revision 06, hydronic H01) from the repository root into public/templates/
 * so Vite serves and bundles them (and the service worker precaches them for offline export). The copies are
 * git-ignored: each template is kept in git once, at the repository root.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = [
  ['06 - a2b_Blank_TAB_Workbook 9-30-26.xlsm', 'tab-template-rev06.xlsm'],
  ['H01 - a2b_Blank_Hydronic_Workbook 9-29-26.xlsm', 'tab-hydronic-h01.xlsm'],
];

for (const [source, target] of TEMPLATES) {
  const SOURCE = join(here, '..', '..', source);
  const TARGET = join(here, '..', 'public', 'templates', target);
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
  console.log(`copy-template: ${fresh ? 'up to date' : 'copied'} -> public/templates/${target}`);
}
