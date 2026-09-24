/**
 * @a2b/workbook: the TAB workbook library shared by the app (browser) and the export spike (Node).
 * Everything here is platform neutral (JSZip + string patching). The browser cover-photo cropper is a separate
 * entry point, `@a2b/workbook/browser`; the Node one lives in spike/export.
 */
export * from './templateMap.js';
export type * from './types.js';
export * from './ooxml.js';
export * from './exportWorkbook.js';
export * from './importWorkbook.js';
export * from './coverPhoto.js';
export * from './lists.js';

/** File name of the template the map describes (at the repository root). */
export const TEMPLATE_FILE_NAME = '05 - a2b_Blank_TAB_Workbook 9-23-26.xlsm';
