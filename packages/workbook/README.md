# @a2b/workbook

The TAB workbook library shared by the app (browser) and the export spike (Node): a plain TypeScript source
package (no build step; consumers compile it).

| Entry                   | Contents                                                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@a2b/workbook`         | Template map (rev 05), `exportWorkbook` (patches input cells in the sheet XML with JSZip), `importWorkbook`, OOXML helpers, cover-photo box maths, dropdown list copies, `TEMPLATE_FILE_NAME` |
| `@a2b/workbook/map`     | Template map + lists + types only (no JSZip), for UI code                                                                                                                                     |
| `@a2b/workbook/browser` | `cropCoverPhotoBrowser` (createImageBitmap + canvas, EXIF orientation honoured)                                                                                                               |

The Node cover-photo cropper (jpeg-js) lives in `spike/export/src/coverPhotoNode.ts`. Pass a cropper as
`exportWorkbook(template, project, { coverPhoto, cropCoverPhoto })`.

`npm test` (Vitest, Node): list copies vs. the template, a small export → import round trip against the real
template, formula-cell and list-value guards. The full verification (LibreOffice recalculation, 189 expected values,
package integrity) is the spike: `npm run spike -w spike/export`.
