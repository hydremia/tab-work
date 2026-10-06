/**
 * @a2b/workbook: the TAB workbook library shared by the app (browser) and the export spike (Node).
 * Everything here is platform neutral (JSZip + string patching). The browser cover-photo cropper is a separate
 * entry point, `@a2b/workbook/browser`; the Node one lives in spike/export.
 */
export * from './templateMap.js';
export * from './hydronicMap.js';
export type * from './types.js';
export * from './ooxml.js';
export * from './exportWorkbook.js';
export * from './importWorkbook.js';
export * from './coverPhoto.js';
export * from './certImages.js';
export * from './lists.js';
export * from './docProps.js';
export * from './inputCells.js';
export * from './compat.js';
export * from './schedule.js';
export * from './zipLimits.js';

/** File name of the template TEMPLATE_MAP describes (at the repository root). */
export const TEMPLATE_FILE_NAME = '07 - a2b_Blank_TAB_Workbook 10-6-26.xlsm';
/** File name of the revision 06 template (the rev 05 / 06 layout, TEMPLATE_MAP_06). */
export const TEMPLATE_06_FILE_NAME = '06 - a2b_Blank_TAB_Workbook 10-1-26.xlsm';
export * from './toleranceColors.js';
export * from './hideBlocks.js';
