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
import {
  DEFAULT_INSTRUMENTS,
  FILTER_CONSTANTS,
  filterSizesFor,
  PROFILE_CURVE,
  PSP_K,
  TEMPLATE_LISTS,
} from './lists.js';
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

  it('filter constants, PSP K-factors and the profile-pressure curve match {Dropdowns}', async () => {
    const zip = await JSZip.loadAsync(templateBytes());
    const info = (await listSheets(zip)).find((s) => s.name === '{Dropdowns}')!;
    const cells = parseCells(await readText(zip, info.part));
    const v = (ref: string) => cellValue(cells.get(ref), []);
    const table: { type: string; size: string; area: unknown; k: unknown }[] = [];
    for (let r = 2; r <= 50; r++) {
      const key = v(`H${r}`);
      if (typeof key !== 'string' || !key.includes('|')) continue; // H45 holds the source note (template quirk)
      const [type, size] = key.split('|');
      expect(v(`I${r}`), `I${r}`).toBe(size);
      expect(v(`L${r}`), `L${r}`).toBe(type);
      table.push({ type, size, area: v(`J${r}`), k: v(`K${r}`) });
    }
    expect(FILTER_CONSTANTS).toEqual(table);
    expect(v('H45')).toMatch(/^Source:/); // the Supply Filter 24x24 key is overwritten by the note
    expect(filterSizesFor('Supply Filter (VelGrid)')).not.toContain('24" x 24"');
    expect(filterSizesFor('HVC / Slot (Airfoil)')).toEqual(['No Filter', '16" Wide', '20" Wide']);
    PSP_K.forEach(([w, k], i) => expect([v(`R${i + 2}`), v(`S${i + 2}`)]).toEqual([w, k]));
    PROFILE_CURVE.pressures.forEach((p, i) => {
      expect(v(`U${i + 2}`)).toBe(p);
      PROFILE_CURVE.cfm.forEach((col, h) => expect(v(`${'VWXYZ'[h]}${i + 2}`)).toBe(col[i]));
    });
  });

  it('DEFAULT_INSTRUMENTS are the Calibration sheet pre-loads', async () => {
    const p = await importWorkbook(templateBytes());
    expect(p.sections.calibration?.tables?.instruments).toEqual(DEFAULT_INSTRUMENTS);
  });
});
