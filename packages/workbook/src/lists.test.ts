import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  cellValue,
  colToNum,
  listSheets,
  numToCol,
  parseCells,
  parseDefinedNames,
  readText,
  workbookPart,
} from './ooxml.js';
import { DEFAULT_INSTRUMENTS, TEMPLATE_LISTS } from './lists.js';
import { importWorkbook } from './importWorkbook.js';
import { TEMPLATE_FILE_NAME } from './index.js';
import { TEMPLATE_PATH, templateBytes } from './testTemplate.js';

describe('template lists', () => {
  it('TEMPLATE_FILE_NAME names the template the tests use', () => {
    expect(TEMPLATE_PATH.endsWith(TEMPLATE_FILE_NAME)).toBe(true);
  });

  it('copies of the dropdown lists match the template named ranges', async () => {
    const zip = await JSZip.loadAsync(templateBytes());
    const sheets = await listSheets(zip);
    const names = parseDefinedNames(await readText(zip, await workbookPart(zip)));
    for (const [name, expected] of Object.entries(TEMPLATE_LISTS)) {
      const dn = names.find((n) => n.name === name && n.localSheetId === undefined);
      expect(dn, name).toBeDefined();
      const m = /^'?(.*?)'?!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(dn!.ref)!;
      const info = sheets.find((s) => s.name === m[1])!;
      const cells = parseCells(await readText(zip, info.part));
      const vals: unknown[] = [];
      for (let c = colToNum(m[2]); c <= colToNum(m[4]); c++) {
        for (let r = Number(m[3]); r <= Number(m[5]); r++) {
          const v = cellValue(cells.get(`${numToCol(c)}${r}`), []);
          if (v !== null) vals.push(v);
        }
      }
      const actual = name === 'Service.Factors2' ? vals.slice(1) : vals; // first entry is the "SF" header
      expect(actual, name).toEqual(expected);
    }
  });

  it('DEFAULT_INSTRUMENTS are the Calibration sheet pre-loads', async () => {
    const p = await importWorkbook(templateBytes());
    expect(p.sections.calibration?.tables?.instruments).toEqual(DEFAULT_INSTRUMENTS);
  });
});
