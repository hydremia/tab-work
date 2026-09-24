# Phase 0 export spike

This spike tests the app's planned Excel export (docs/ROADMAP.md §2, "Excel I/O") from start to finish. It fills the
revision 05 template (`05 - a2b_Blank_TAB_Workbook 9-23-26.xlsm`) by writing **only input cells** into the sheet
XML with JSZip. It never loads the workbook into a spreadsheet library. It then reads the same cells back.

```
cd spike/export
npm install
npm run spike        # ~30 s; needs LibreOffice Calc (libreoffice-calc) and, for the PNGs, poppler-utils
```

`npm run make-photo` regenerates the synthetic cover photo `sample/cover-photo.jpg`. The spike also creates it
automatically when it is missing.

For realistic page renders, install `fonts-crosextra-carlito` (a Calibri-metric font). Without it, LibreOffice
substitutes a wider font, and both the page layout and the cover box change.

## What it proves

| # | Claim | How it is checked (`src/runSpike.ts`) |
|---|---|---|
| 1 | Only input cells are written. Styles, formulas, VBA, drawings, header logos, the form button, validations, conditional formats and names survive. | Every part that is not touched is **byte-identical** to the template (66 of 83 parts). Only worksheet XML and the cover drawing's `.rels` change. `vbaProject.bin`, `workbook.xml`, `styles.xml`, `[Content_Types].xml`, `drawing1.xml` and the VML are identical. The counts of validations (37), conditional-format blocks (1041), merges (17044) and defined names (52) are unchanged. |
| 2 | The patched XML is valid. | Every changed part is well-formed (fast-xml-parser), and rows and cells are in ascending order. The zip passes CRC checks in JSZip and `unzip -t`. |
| 3 | The template map is correct. | **Map audit**: a generated project fills *every* mapped input of block 1 **and of the last block** of every equipment type (4,874 cells). The export must not hit a formula or a cell hidden under a merge, and the import must return exactly the same project. |
| 4 | Formulas give the right answers. | LibreOffice loads the export, is forced to recalculate, and saves it. The whole workbook has **0 error cells**. **189 computed cells** match values computed independently in TypeScript (`src/expectations.ts`). |
| 5 | Round trip (re-import requirement). | `importWorkbook(export)` deep-equals the input. The LibreOffice re-save (shared strings, cached values) also imports with no differences. |
| 6 | Safety. | Writing into a formula cell throws `FormulaCellError`, both through a field and through a table row (the first return row's Design CFM). Also rejected: a cell hidden inside a merged range, a value not in the dropdown list, free text in a numeric field, and an unknown key. |
| 7 | Cover photo. | The "Project Photo" picture's box is computed from `sheet1.xml` column widths and row heights. The photo is centre-cropped to that ratio, downscaled to 1600 px and saved as a new `xl/media/image9.jpeg`. `rId1008` is repointed to it and the old `image8.png` is removed (no orphan, no mismatched extension). The logos are untouched. Rendered to `out/cover-page.png`. |

### Results (last run)

`71 PASS, 0 FAIL, 2 INFO` in about 28 s. The export itself takes about 3.8 s, of which about 3 s is pure-JS JPEG decoding
of the 12 MP photo. The full table is written to `out/spike-report.md` and `out/spike-report.json`.

| Section | Result |
|---|---|
| a. Package | 66 of 83 parts byte-identical. Changed: 15 worksheets and `drawing1.xml.rels`. Added: `image9.jpeg`. Removed: `image8.png`. Validations, conditional formats, merges and names unchanged. Template has 41,827 formula cells and **0 cached values** (verified). An injected stale cached value is stripped. Map audit: 4,874 cells, 0 differences. |
| b. LibreOffice | 0 error cells. 189/189 expectations match. Examples: RTU-1 total 2400 / 2414.1, corrected FLA 4.7213, TSP 1.77, ESP 1.07. RTU-2 (1-phase) corrected FLA 3.2311. RTU-3 (N/A notations) totals 2000 / 1930, BHP from the remaining legs. MAU PSP 2034.12 CFM. Hood Captrate 16x20 2049.2888 CFM. Traverses 1004 CFM (rectangular 24x12) and 332 CFM (round 10"). Building Balance: small fan 21 in row 47; OA design 3600, exhaust design 2800. Cover G32 / G34 / G36. Summary sheets. |
| c. Round trip | Own export: identical. LibreOffice `.xlsm` re-save (sharedStrings path): identical. |
| d. Safety | 6 of 6 rejected with a clear message. |
| e. Render | 56-page PDF. `out/cover-page.png` and `out/rtu-1-page.png`. |

The two INFO rows:
- **Blueprint revision dates.** `{Project Information}` E17:E25 have a General (text) style, so revision dates are
  written as text `M/D/YYYY`. They still import back as dates.
- **LibreOffice is not a stand-in for Excel.** A LibreOffice re-save shrinks `vbaProject.bin` from 93,696 to
  17,920 bytes and the package from 83 to 55 parts. Use it only for testing; never ship a LibreOffice-saved file.

## Files

| File | What it is |
|---|---|
| `src/templateMap.ts` | Typed, data-driven template map: sections, equipment types, block anchor formulas, fields, tables, remark lines, reading grids, column tables and list names. Sheets are resolved by name through `workbook.xml` and its rels. |
| `src/exportWorkbook.ts` | `exportWorkbook(templateBytes, project, opts)`. The `…WithReport` variant also returns changed parts, counts and warnings. |
| `src/importWorkbook.ts` | `importWorkbook(bytes)`: reads inline strings, shared strings, numbers and dates back into `ProjectData`. Also `normalizeProject` and `diff`. |
| `src/ooxml.ts` | Browser-safe helpers for OOXML: rels, sheets, defined names, cells, shared strings, date styles and date serials. |
| `src/coverPhoto.ts` | Anchor box size from column widths and row heights; centre crop, box-filter downscale and JPEG encode (jpeg-js). |
| `src/expectations.ts` | Independent expected results for the sample project. |
| `src/makeTestPhoto.ts` | Synthetic 4032×3024 test photo (grid, circle and square, red "CROP" bands that must not be visible). |
| `sample/project.json` | Sample project: 3 RTUs (3-phase belt with full data; 1-phase direct drive; one with N/A, Not Avail. and Not Acc.), MAU with PSP, 2 exhaust fans, 3 VAVs, a Captrate hood with 3 readings on some filters, small fans #1 and #21, 2 quick-entry traverses, 2 new issues and 1 existing issue, narrative, one calibration row, building pressures. |
| `out/` (git-ignored) | `Spike Project - TAB Report.xlsm`, the PDF, `cover-page.png`, `rtu-1-page.png`, `LibreOffice re-save.xlsm` and the reports. |

## How the export writes cells

- The export finds the existing `<c>` and keeps its `s` style. If the cell or row is missing, it creates it in
  column / row order (`dimension` is widened if needed). Text is written as `t="inlineStr"`, numbers as `<v>`,
  and dates as serials when the cell has a date format (otherwise as text, with a warning). `N/A`, `Not Avail.`
  and `Not Acc.` are written as text in any numeric, date or list field. All text is XML-escaped, and characters
  that are invalid in XML are stripped.
- Before anything is written, the export checks that the cell is not a formula (**`FormulaCellError`**), that it
  is not hidden inside a merge, that it is not written twice, that list values are in the template's own named
  list (read from `{Dropdowns}`), and that numbers are numbers.
- Tables, remark lines and reading grids **replace** the template content: rows past the end of the project's
  list are cleared. Calibration therefore also clears the 7 pre-loaded a2b instruments. The app should pre-load
  them into new projects instead.
- Placeholders are cleared when the project has no value: `{ProjectCode}`, `{Address}`, `Architect Firm`,
  `TBD`, and the sample TAB date. So is the sample designation of every unused equipment section (RTU-1,
  MUA-1, ERV-1, EF-1, H-1, VAV-1, EF-S1).
- `fullCalcOnLoad="1"` is kept (it is added if missing). Cached `<v>` values in formula cells are emptied (the
  revision 05 template has none).

## Known limitations and next steps for the real app

1. **Cover box aspect ratio needs an Excel check.** With the ECMA-376 column-width formula (Calibri 11, maximum
   digit width 7 px), a column of `width="6.855"` is 48 px. That makes the box C15:L30 480 × 284.8 px, which is
   **1.685 : 1**. The export crops to that ratio. LibreOffice sizes columns differently: its render shows the box
   at about 1.83 : 1, so the test circle looks about 8 % wide in `out/cover-page.png`. The crop itself is correct:
   no red band is visible, and TOP / BOTTOM / LEFT / RIGHT are all visible. Open the export in desktop Excel once
   and confirm the circle is round. If it is not, change `MDW` / `colWidthPx` in `src/coverPhoto.ts`.
2. **Browser build.** `jpeg-js` works in the browser but is slow (about 3 s for 12 MP) and ignores EXIF
   orientation. The app should crop with `createImageBitmap(file, { imageOrientation: 'from-image' })` and a
   canvas, then call `canvas.toBlob('image/jpeg')`. This also covers HEIC on iOS Safari. The rest of the code
   (JSZip, string patching) has no Node dependencies. Only `runSpike.ts` and `makeTestPhoto.ts` use Node APIs.
3. **The template map is a subset.** It covers the areas the spike needed plus ERVs, and the map audit proves
   every entry. Still to add: the Building Balance spare OA rows 67–86, hood and traverse page remarks,
   Certification (signature, date, stamp), the traverse point label, and ToC. The map is TypeScript data today;
   make it versioned JSON per template revision.
4. **Re-import of Excel-saved files.** The shared-strings path was tested with a LibreOffice re-save, not with
   Excel. Things to confirm with real Excel files: rich-text runs, numbers typed into text fields (they import as
   strings, e.g. the calibration serial `1700164`), dates typed as text, and `t="str"` / `t="e"` cells.
5. **Only testable in desktop Excel:** that the file opens without a "repair" prompt; that `fullCalcOnLoad`
   recalculates everything; that the macros (ToC sync, `PrintReport`) still run and the ToC button still works;
   that dropdowns show the written values; that the cover photo aspect is right; the print layout with real
   Calibri; and that the "Closed" conditional format applies to the Summary rows.
6. The first return row's Final VEL is accepted but has no effect (a template quirk). The export warns when a
   project supplies a value for a formula column that the map skips.
