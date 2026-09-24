/**
 * Map audit over EVERY block of every equipment type (the spike audits the first and last blocks): every mapped
 * input cell of every block is a writable input (not a formula, not hidden under a merge, not written twice)
 * and round-trips through export -> import. This verifies the block strides / page offsets for all slots.
 */
import { describe, expect, it } from 'vitest';
import { exportWorkbookWithReport } from './exportWorkbook.js';
import { diff, importWorkbook, normalizeProject } from './importWorkbook.js';
import { TEMPLATE_LISTS } from './lists.js';
import { blockLayout, sequenceCells, tableRows, TEMPLATE_MAP, type Layout } from './templateMap.js';
import { templateBytes } from './testTemplate.js';
import type { Cell, LayoutData, ProjectData, UnitData } from './types.js';

function fill(layout: Layout, seed: number): LayoutData {
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
      return opts[n % opts.length];
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

describe('template map audit (every block)', () => {
  it('every mapped input of every block of every type is writable and round-trips', async () => {
    const p: ProjectData = { templateRevision: TEMPLATE_MAP.revision, sections: {}, equipment: {} };
    let seed = 0;
    for (const e of TEMPLATE_MAP.equipment) {
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
                  ? fd.values![slot % fd.values!.length]
                  : `${e.key}-${slot}-${fd.key}`,
            ]),
          );
        units.push(u);
      }
      p.equipment[e.key] = units;
    }
    const { bytes, report } = await exportWorkbookWithReport(templateBytes(), p);
    expect(report.cellsWritten).toBeGreaterThan(20_000);
    const back = await importWorkbook(bytes);
    const { calibration: _c, buildingBalance: _b, equipmentSummary: _s, ...sections } = back.sections;
    expect(diff(normalizeProject({ ...back, sections }), normalizeProject(p))).toEqual([]);
  }, 120_000);
});
