/** Test helper (Node only): the revision 05 template bytes from the repository root. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TEMPLATE_PATH = fileURLToPath(
  new URL('../../../05 - a2b_Blank_TAB_Workbook 9-23-26.xlsm', import.meta.url),
);
let cached: Uint8Array | undefined;
export function templateBytes(): Uint8Array {
  cached ??= new Uint8Array(readFileSync(TEMPLATE_PATH));
  return cached;
}
