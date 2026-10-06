/**
 * Map audit over EVERY block of every equipment type (the spike audits the first and last blocks): every mapped
 * input cell of every block is a writable input (not a formula, not hidden under a merge, not written twice)
 * and round-trips through export -> import. This verifies the block strides / page offsets for all slots.
 */
import { describe, expect, it } from 'vitest';
import { exportWorkbookWithReport } from './exportWorkbook.js';
import { diff, importWorkbook, normalizeProject } from './importWorkbook.js';
import { TEMPLATE_LISTS } from './lists.js';
import JSZip from 'jszip';
import { blockLayout, sequenceCells, tableRows, TEMPLATE_MAP, TEMPLATE_MAP_06, type Layout, type TemplateMap } from './templateMap.js';
import { detectTemplateRevision, importWorkbookWithReport } from './importWorkbook.js';
import { template06Bytes, templateBytes } from './testTemplate.js';
import type { Cell, LayoutData, ProjectData, UnitData } from './types.js';

/** List values revision 07 added (not in the rev 05 / 06 template's lists). */
const REV07_VALUES = new Set<string | number>(['Intake', 'Flat Oval']);

function fill(layout: Layout, seed: number, rev06 = false): LayoutData {
  let n = seed;
  const val = (d: { type: string; list?: string; values?: readonly (string | number)[] }): Cell => {
    n++;
    if (d.type === 'number') return n % 11 === 0 ? 'Not Acc.' : n + 0.5;
    if (d.type === 'date') return '2026-09-24';
    if (d.type === 'list') {
      const opts =
        d.values ??
        (d.list === 'Service.Factors2'
          ? TEMPLATE_LISTS['Service.Factors2']
          : TEMPLATE_LISTS[d.list as keyof typeof TEMPLATE_LISTS]);
      const usable = rev06 ? opts.filter((o) => !REV07_VALUES.has(o)) : opts;
      return usable[n % usable.length];
    }
    return `t${n}`;
  };
  const out: LayoutData = {};
  for (const fd of layout.fields ?? []) (out.fields ??= {})[fd.key] = val(fd);
  for (const td of layout.tables ?? []) {
    (out.tables ??= {})[td.key] = tableRows(td).map((r) => {
      const rec: Record<string, Cell> = {};
      for (const c of td.columns) if (!r.omit.includes(c.col)) rec[c.key] = val(c);
      return rec;
    });
  }
  for (const ld of layout.lines ?? []) (out.lines ??= {})[ld.key] = ld.cells.map(() => `line ${n++}`);
  for (const sd of layout.sequences ?? [])
    (out.sequences ??= {})[sd.key] = sequenceCells(sd).map(() => val({ type: sd.type }));
  for (const cd of layout.columnTables ?? []) {
    (out.columnTables ??= {})[cd.key] = cd.cols.map(() => Object.fromEntries(cd.fields.map((fd) => [fd.key, val(fd)])));
  }
  return out;
}

describe.each([
  ['revision 07', TEMPLATE_MAP, templateBytes],
  ['revision 05 / 06 layout', TEMPLATE_MAP_06, template06Bytes],
] as [string, TemplateMap, () => Uint8Array][])('template map audit (every block): %s', (_name, map, template) => {
  const rev06 = map === TEMPLATE_MAP_06;
  it('every mapped input of every block of every type is writable and round-trips', async () => {
    const p: ProjectData = { templateRevision: map.revision, sections: {}, equipment: {} };
    let seed = 0;
    for (const e of map.equipment) {
      const units: UnitData[] = [];
      for (let slot = 1; slot <= e.capacity; slot++) {
        const u: UnitData = { slot, ...fill(blockLayout(e, slot), (seed += 1000), rev06) };
        if (e.ede)
          u.schedule = Object.fromEntries(
            e.ede.fields.map((fd, i) => [
              fd.key,
              fd.type === 'number'
                ? slot * 100 + i
                : fd.type === 'list'
                  ? fd.values![slot % fd.values!.length]
                  : `${e.key}-${slot}-${fd.key}`,
            ]),
          );
        units.push(u);
      }
      p.equipment[e.key] = units;
    }
    const { bytes, report } = await exportWorkbookWithReport(template(), p, { map });
    expect(report.cellsWritten).toBeGreaterThan(20_000);
    // the importer picks the workbook's own layout by itself
    const back = await importWorkbook(bytes);
    expect(back.templateRevision).toBe(map.revision);
    const {
      calibration: _c,
      buildingBalance: _b,
      equipmentSummary: _s,
      certification: _z,
      ...sections
    } = back.sections;
    expect(diff(normalizeProject({ ...back, sections }), normalizeProject(p))).toEqual([]);
  }, 120_000);

  it('every mapped input of every single-sheet section is writable and round-trips', async () => {
    const p: ProjectData = { templateRevision: map.revision, sections: {}, equipment: {} };
    let seed = 0;
    for (const sec of map.sections) p.sections[sec.key] = fill(sec, (seed += 1000), rev06);
    const { bytes } = await exportWorkbookWithReport(template(), p, { map });
    const back = await importWorkbook(bytes);
    expect(diff(normalizeProject(back), normalizeProject(p))).toEqual([]);
  }, 60_000);
});

describe('template revision of a workbook', () => {
  it('revision 07 carries its revision name; revision 06 has none (read with the rev 05 / 06 layout)', async () => {
    expect(await detectTemplateRevision(await JSZip.loadAsync(templateBytes()))).toBe('07');
    expect(await detectTemplateRevision(await JSZip.loadAsync(template06Bytes()))).toBeNull();
    expect((await importWorkbookWithReport(template06Bytes())).project.templateRevision).toBe('06');
    expect((await importWorkbookWithReport(templateBytes())).project.templateRevision).toBe('07');
  });

  it('the two layouts differ only where revision 07 moved or added cells', () => {
    const mau7 = TEMPLATE_MAP.equipment.find((e) => e.key === 'mau')!.block;
    const mau6 = TEMPLATE_MAP_06.equipment.find((e) => e.key === 'mau')!.block;
    expect(mau6.fields?.find((f) => f.key === 'method')?.row).toBe(52 + 18);
    expect(mau7.fields?.find((f) => f.key === 'method')?.row).toBe(52 + 30);
    expect(TEMPLATE_MAP_06.equipment[0].block.fields?.some((f) => f.key === 'sheaveBore')).toBe(true);
    expect(TEMPLATE_MAP.equipment[0].block.fields?.some((f) => f.key === 'sheaveBore')).toBe(false);
    expect(TEMPLATE_MAP.equipment[0].block.fields?.find((f) => f.key === 'motorHp')).toMatchObject({ col: 'E', row: 17 });
  });
});
