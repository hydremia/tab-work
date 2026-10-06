/** Test helper (Node only): the revision 07 template bytes from the repository root. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TEMPLATE_PATH = fileURLToPath(
  new URL('../../../07 - a2b_Blank_TAB_Workbook 10-6-26.xlsm', import.meta.url),
);
let cached: Uint8Array | undefined;
export function templateBytes(): Uint8Array {
  cached ??= new Uint8Array(readFileSync(TEMPLATE_PATH));
  return cached;
}

/** Test helper (Node only): the revision 06 template (the rev 05 / 06 layout, TEMPLATE_MAP_06). */
export const TEMPLATE_06_PATH = fileURLToPath(
  new URL('../../../06 - a2b_Blank_TAB_Workbook 10-1-26.xlsm', import.meta.url),
);
let cached06: Uint8Array | undefined;
export function template06Bytes(): Uint8Array {
  cached06 ??= new Uint8Array(readFileSync(TEMPLATE_06_PATH));
  return cached06;
}

/** Test helper (Node only): the hydronic H01 template bytes from the repository root. */
export const HYDRONIC_TEMPLATE_PATH = fileURLToPath(
  new URL('../../../H01 - a2b_Blank_Hydronic_Workbook 9-29-26.xlsm', import.meta.url),
);
let cachedHydronic: Uint8Array | undefined;
export function hydronicTemplateBytes(): Uint8Array {
  cachedHydronic ??= new Uint8Array(readFileSync(HYDRONIC_TEMPLATE_PATH));
  return cachedHydronic;
}
