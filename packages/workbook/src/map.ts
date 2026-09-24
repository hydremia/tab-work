/**
 * Lightweight entry point (`@a2b/workbook/map`): the template map and the list copies only, without the
 * JSZip-based exporter / importer, so UI code can use the map without pulling the workbook engine into the
 * main bundle.
 */
export * from './templateMap.js';
export * from './lists.js';
export type * from './types.js';
export type { RevisionMarker } from './docProps.js';
