import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { exportWorkbookWithReport } from './exportWorkbook.js';
import { setRowsHidden } from './hideBlocks.js';
import { listSheets, readText } from './ooxml.js';
import { TEMPLATE_MAP } from './templateMap.js';
import { templateBytes } from './testTemplate.js';
import type { ProjectData } from './types.js';

const outlet = (no: string, design: number, vel: number) => ({
  no,
  area: 'Office',
  ak: 1,
  designCfm: design,
  finalVel: vel,
});

/** RTU-1 and RTU-3 (slot 2 unused), RTU-1 with 2 outlets on page 1 only; one fan; one hood; nothing else. */
const project = (): ProjectData => ({
  templateRevision: TEMPLATE_MAP.revision,
  sections: {},
  equipment: {
    rtu: [
      {
        slot: 1,
        schedule: { designation: 'RTU-1' },
        tables: { supply: [outlet('S-1', 500, 510), outlet('S-2', 500, 490)] },
      },
      { slot: 3, schedule: { designation: 'RTU-3' } },
    ],
    fan: [{ slot: 1, schedule: { designation: 'EF-1' } }],
    hood: [{ slot: 1, schedule: { designation: 'H-1' } }],
  },
});

async function state(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const wb = await readText(zip, 'xl/workbook.xml');
  const hiddenSheets = [...wb.matchAll(/<sheet\b[^>]*>/g)]
    .filter((m) => /state="hidden"/.test(m[0]))
    .map((m) => /name="([^"]+)"/.exec(m[0])![1]);
  const sheets = await listSheets(zip);
  const hiddenRows = async (name: string) => {
    const xml = await readText(zip, sheets.find((s) => s.name === name)!.part);
    return new Set([...xml.matchAll(/<row\b[^>]*?\br="(\d+)"[^>]*?\bhidden="1"/g)].map((m) => Number(m[1])));
  };
  return { hiddenSheets, hiddenRows };
}

describe('unused blocks hidden at export (the Print Report macro, done by the export)', () => {
  it('hides unit sheets without units, unused blocks, empty continuation pages and empty table rows', async () => {
    const { bytes, report } = await exportWorkbookWithReport(templateBytes(), project(), { hideUnused: true });
    const s = await state(bytes);
    expect(s.hiddenSheets).toEqual(expect.arrayContaining(['MAUs', 'ERVs', 'Small Fans', 'VAVs', 'Traverses']));
    expect(s.hiddenSheets).not.toContain('RTUs');
    expect(report.hidden?.hiddenSheets).toContain('MAUs');
    const rtu = await s.hiddenRows('RTUs');
    // RTU-1 (rows 4-107): page 1 shown with its 2 outlets (rows 33-34), the 8 empty outlet rows hidden; page 2 hidden
    expect(rtu.has(4)).toBe(false);
    expect([33, 34].some((r) => rtu.has(r))).toBe(false);
    expect([35, 36, 42].every((r) => rtu.has(r))).toBe(true);
    expect(rtu.has(56) && rtu.has(107)).toBe(true);
    // the return / OA tables have no lines: their first row stays (the return's design is a formula there)
    expect(rtu.has(46) || rtu.has(51)).toBe(false);
    expect(rtu.has(47)).toBe(true);
    // RTU-2 (rows 108-211) unused: hidden; RTU-3 (212-) shown; RTU-4 onward hidden
    expect(rtu.has(108) && rtu.has(211)).toBe(true);
    expect(rtu.has(212)).toBe(false);
    expect(rtu.has(316) && rtu.has(4163)).toBe(true);
    // hoods: H-1 shown, H-2's block hidden, the page's remark box kept, the next pages hidden
    const hood = await s.hiddenRows('Hoods');
    expect(hood.has(4)).toBe(false);
    expect(hood.has(25) && hood.has(45)).toBe(true);
    expect([47, 48, 49].some((r) => hood.has(r))).toBe(false);
    expect(hood.has(53)).toBe(true);
    // Equipment Summary: RTU-1 / RTU-3 lines and the Rooftop Units / Fans / Kitchen Hoods headings stay; RTU-2's line,
    // the empty types and their headings go
    const es = await s.hiddenRows('Equipment Summary');
    expect([8, 9, 11].some((r) => es.has(r))).toBe(false);
    expect(es.has(10)).toBe(true);
    expect(es.has(49) && es.has(50)).toBe(true); // Make-up Air Units heading + MAU-1 line
    expect(es.has(71) || es.has(72)).toBe(false); // Fans heading + EF-1
    // Building Balance: RTU-1 / EF-1 on row 7, RTU-3 on row 9; row 8 (RTU-2 / EF-2) hidden
    const bb = await s.hiddenRows('Building Balance');
    expect(bb.has(7) || bb.has(9)).toBe(false);
    expect(bb.has(8)).toBe(true);
  }, 60_000);

  it('a re-export onto the issued workbook shows again what is now used', async () => {
    const first = (await exportWorkbookWithReport(templateBytes(), project(), { hideUnused: true })).bytes;
    const more = project();
    more.equipment.rtu.push({ slot: 2, schedule: { designation: 'RTU-2' } });
    more.equipment.mau = [{ slot: 1, schedule: { designation: 'MAU-1' } }];
    const again = await exportWorkbookWithReport(first, more, {
      hideUnused: true,
      reset: { template: templateBytes(), sections: [] },
    });
    const s = await state(again.bytes);
    expect(s.hiddenSheets).not.toContain('MAUs');
    const rtu = await s.hiddenRows('RTUs');
    expect(rtu.has(108)).toBe(false);
    expect((await s.hiddenRows('Equipment Summary')).has(10)).toBe(false);
  }, 60_000);

  it('without the option nothing is hidden', async () => {
    const { bytes } = await exportWorkbookWithReport(templateBytes(), project());
    const s = await state(bytes);
    expect(s.hiddenSheets).toEqual(['{Dropdowns}', 'Photos']);
    expect((await s.hiddenRows('RTUs')).size).toBe(0);
  }, 60_000);

  it('setRowsHidden sets and clears the attribute in a range, adding rows that are missing', () => {
    const xml =
      '<worksheet><sheetData><row r="1"/><row r="2" hidden="1" ht="12"></row><row r="5"></row></sheetData></worksheet>';
    const out = setRowsHidden(xml, 1, 5, new Set([1, 3]));
    expect(out).toBe(
      '<worksheet><sheetData><row r="1" hidden="1"/><row r="2" ht="12"></row><row r="3" hidden="1"/><row r="5"></row></sheetData></worksheet>',
    );
  });
});
