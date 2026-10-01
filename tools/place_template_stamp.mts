/**
 * Template build step (tools/build_rev06.py): the NEBB stamp in the Certification sheet's stamp box, placed with the
 * exporter's own code (packages/workbook certImages.ts: fitted into C51:G56, centred, aspect kept, placeholder note
 * cleared) and named "a2b NEBB Stamp" (TEMPLATE_STAMP_NAME). An export keeps it, or replaces it with the certification
 * profile's stamp when the profile has one.
 *
 *     npx tsx tools/place_template_stamp.mts <workbook.xlsm> <stamp.png>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { CERT_PICTURE_NAMES, placeCertImages, TEMPLATE_STAMP_NAME } from '../packages/workbook/src/certImages.js';
import { listSheets, readText } from '../packages/workbook/src/ooxml.js';
import { TEMPLATE_MAP } from '../packages/workbook/src/templateMap.js';

const [path, pngPath] = process.argv.slice(2);
if (!path || !pngPath) throw new Error('usage: place_template_stamp.mts <workbook.xlsm> <stamp.png>');
const png = new Uint8Array(readFileSync(pngPath));
// PNG IHDR: width and height at bytes 16-23
const dv = new DataView(png.buffer, png.byteOffset);
const stamp = { bytes: png, type: 'png' as const, width: dv.getUint32(16), height: dv.getUint32(20) };

const zip = await JSZip.loadAsync(readFileSync(path));
const report = await placeCertImages(zip, await listSheets(zip), TEMPLATE_MAP.certImages, { stamp });
if (!report.placed.includes('stamp') || !report.drawingPart) throw new Error(`stamp not placed: ${JSON.stringify(report)}`);
const drawing = await readText(zip, report.drawingPart);
const renamed = drawing.replaceAll(`"${CERT_PICTURE_NAMES.stamp}"`, `"${TEMPLATE_STAMP_NAME}"`);
zip.file(report.drawingPart, renamed);
writeFileSync(path, await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
console.log(`place_template_stamp: ${stamp.width} x ${stamp.height} stamp placed in ${report.drawingPart}`);
