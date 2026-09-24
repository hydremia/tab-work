/**
 * Writes the hosting config files from deploy/hosting.ts:
 *   npm run hosting-config -w app            (all *.supabase.co allowed in connect-src)
 *   VITE_SUPABASE_URL=https://<ref>.supabase.co npm run hosting-config -w app   (one Supabase project)
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostingFiles } from './files';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const [rel, text] of Object.entries(hostingFiles())) {
  writeFileSync(join(root, rel), text);
  console.log(`hosting-config: wrote ${rel}`);
}
