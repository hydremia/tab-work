/**
 * The hydronic map (H01) against the hydronic template: dropdown copies match {Dropdowns}; every mapped input of
 * every block and section is a writable input (not a formula, not under a merge, not written twice) and
 * round-trips through export -> import with the same engine as airside.
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { exportWorkbookWithReport } from './exportWorkbook.js';
import { HYDRONIC_LISTS, HYDRONIC_MAP, HYDRONIC_TEMPLATE_FILE_NAME } from './hydronicMap.js';
import { diff, importWorkbook, normalizeProject } from './importWorkbook.js';
import { TEMPLATE_LISTS } from './lists.js';
import {
  cellValue,
  colToNum,
  listSheets,
  loadSharedStrings,
  numToCol,
  parseCells,
  parseDefinedNames,
  readText,
  workbookPart,
} from './ooxml.js';
import { blockLayout, sequenceCells, tableRows, type Layout } from './templateMap.js';
import { HYDRONIC_TEMPLATE_PATH, hydronicTemplateBytes } from './testTemplate.js';
import type { Cell, LayoutData, ProjectData, UnitData } from './types.js';

const LISTS: Record<string, readonly (string | number)[]> = { ...TEMPLATE_LISTS, ...HYDRONIC_LISTS };

function fill(layout: Layout, seed: number): LayoutData {
  let n = seed;
  const val = (d: { type: string; list?: string; values?: readonly (string | number)[] }): Cell => {
    n++;
    if (d.type === 'number') return n % 11 === 0 ? 'Not Acc.' : n + 0.5;
    if (d.type === 'date') return '2026-09-29';
    if (d.type === 'list') {
      const opts = d.values ?? LISTS[d.list!];
      return opts[n % opts.length];
    }
    return `t${n}`;
  };
  const out: LayoutData = {};
  for (const fd of layout.fields ?? []) (out.fields ??= {})[fd.key] = val(fd);
  for (const td of layout.tables ?? []) {
    (out.tables ??= {})[td.key] = tableRows(td).map((r) => {
      const rec: Record<string, Cell> = {};
      for (const col of td.columns) if (!r.omit.includes(col.col)) rec[col.key] = val(col);
      return rec;
    });
  }
  for (const ld of layout.lines ?? []) (out.lines ??= {})[ld.key] = ld.cells.map(() => `line ${n++}`);
  for (const sd of layout.sequences ?? [])
    (out.sequences ??= {})[sd.key] = sequenceCells(sd).map(() => val({ type: sd.type }));
  return out;
}

describe('hydronic template map (H01)', () => {
  it('HYDRONIC_TEMPLATE_FILE_NAME names the template the tests use', () => {
    expect(HYDRONIC_TEMPLATE_PATH.endsWith(HYDRONIC_TEMPLATE_FILE_NAME)).toBe(true);
  });

  it('copies of the hydronic dropdown lists match the template named ranges', async () => {
    const zip = await JSZip.loadAsync(hydronicTemplateBytes());
    const sheets = await listSheets(zip);
    const sst = await loadSharedStrings(zip);
    const names = parseDefinedNames(await readText(zip, await workbookPart(zip)));
    for (const [name, expected] of Object.entries(HYDRONIC_LISTS)) {
      const dn = names.find((n) => n.name === name && n.localSheetId === undefined);
      expect(dn, name).toBeDefined();
      const m = /^'?(.*?)'?!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(dn!.ref)!;
      const cells = parseCells(await readText(zip, sheets.find((s) => s.name === m[1])!.part));
      const vals: unknown[] = [];
      for (let col = colToNum(m[2]); col <= colToNum(m[4]); col++)
        for (let r = Number(m[3]); r <= Number(m[5]); r++) {
          const v = cellValue(cells.get(`${numToCol(col)}${r}`), sst);
          if (v !== null) vals.push(v);
        }
      expect(vals, name).toEqual(expected);
    }
  });

  it('every mapped input of every pump and valve page is writable and round-trips', async () => {
    const p: ProjectData = { templateRevision: HYDRONIC_MAP.revision, sections: {}, equipment: {} };
    let seed = 0;
    for (const e of HYDRONIC_MAP.equipment) {
      const units: UnitData[] = [];
      for (let slot = 1; slot <= e.capacity; slot++) {
        const u: UnitData = { slot, ...fill(blockLayout(e, slot), (seed += 1000)) };
        if (e.ede)
          u.schedule = Object.fromEntries(
            e.ede.fields.map((fd, i) => [
              fd.key,
              fd.type === 'number'
                ? slot * 100 + i
                : fd.type === 'list'
                  ? (fd.values ?? LISTS[fd.list!])[slot % 2]
                  : `${e.key}-${slot}-${fd.key}`,
            ]),
          );
        units.push(u);
      }
      p.equipment[e.key] = units;
    }
    const { bytes, report } = await exportWorkbookWithReport(hydronicTemplateBytes(), p, { map: HYDRONIC_MAP });
    expect(report.cellsWritten).toBeGreaterThan(20 * 30 + 25 * 38 * 12);
    const back = await importWorkbook(bytes, { map: HYDRONIC_MAP });
    const { calibration: _c, certification: _z, ...sections } = back.sections;
    expect(diff(normalizeProject({ ...back, sections }), normalizeProject(p))).toEqual([]);
  }, 120_000);

  it('every mapped input of every section is writable and round-trips', async () => {
    const p: ProjectData = { templateRevision: HYDRONIC_MAP.revision, sections: {}, equipment: {} };
    let seed = 0;
    for (const sec of HYDRONIC_MAP.sections) p.sections[sec.key] = fill(sec, (seed += 1000));
    const { bytes } = await exportWorkbookWithReport(hydronicTemplateBytes(), p, { map: HYDRONIC_MAP });
    const back = await importWorkbook(bytes, { map: HYDRONIC_MAP });
    expect(diff(normalizeProject(back), normalizeProject(p))).toEqual([]);
  }, 60_000);

  it('a small project: pump schedule and readings, one valve system, a chiller; blank template stays unchanged elsewhere', async () => {
    const p: ProjectData = {
      templateRevision: HYDRONIC_MAP.revision,
      sections: {
        projectInfo: { fields: { projectName: 'Hydronic test' } },
        systemSummary: {
          tables: { systems: [{ system: 'CHW', service: 'Chilled Water', pumps: 'P-1', vfdSetpoint: '12 psi' }] },
        },
        plant: {
          tables: {
            circuits: [
              { unit: 'CH-1', type: 'Chiller (water-cooled)', circuit: 'Evaporator', designGpm: 240, actualGpm: 228 },
            ],
          },
        },
      },
      equipment: {
        pump: [
          {
            slot: 1,
            schedule: {
              designation: 'P-1',
              service: 'Chilled Water',
              system: 'CHW',
              designGpm: 200,
              designHead: 60,
              phase: '3-phase',
              pumpType: 'VFD',
            },
            fields: { finalSuction: 9, finalDischarge: 35, actualGpm: 190, flowMethod: 'Pump curve' },
          },
        ],
        valveSystem: [
          {
            slot: 1,
            fields: { system: 'CHW', dpUnits: 'ft w.g.', method: 'Proportional' },
            tables: {
              valves: [
                {
                  no: '1',
                  tag: 'CBV-1',
                  type: 'A',
                  designGpm: 10,
                  setting: 2.5,
                  dp: 3.1,
                  finalGpm: 10.4,
                  wideOpen: '✓',
                },
              ],
            },
          },
        ],
      },
    };
    const { bytes, report } = await exportWorkbookWithReport(hydronicTemplateBytes(), p, { map: HYDRONIC_MAP });
    expect(report.cellsWritten).toBeGreaterThan(10);
    const back = await importWorkbook(bytes, { map: HYDRONIC_MAP });
    expect(back.equipment.pump).toHaveLength(1);
    expect(back.equipment.pump[0].schedule).toMatchObject({ designation: 'P-1', system: 'CHW', designGpm: 200 });
    expect(back.equipment.pump[0].fields).toMatchObject({ finalSuction: 9, finalDischarge: 35, actualGpm: 190 });
    expect(back.equipment.valveSystem[0].tables!.valves[0]).toMatchObject({
      tag: 'CBV-1',
      designGpm: 10,
      finalGpm: 10.4,
    });
    expect(back.sections.plant.tables!.circuits[0]).toMatchObject({ unit: 'CH-1', actualGpm: 228 });
    // the sample designation "P-1" of the template is replaced, not duplicated; slot 2 stays empty
    expect(back.equipment.pump.find((u) => u.slot === 2)).toBeUndefined();
  });
});
