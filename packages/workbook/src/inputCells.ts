/**
 * Every input cell the template map knows, by sheet: the cells an export onto a previously issued workbook resets to
 * the blank template's values before it writes the project (so values removed in the app are cleared there too).
 */
import { anchorRow, blockLayout, Layout, sequenceCells, tableRows, TemplateMap } from './templateMap.js';

export interface SheetInputCells {
  sheet: string;
  refs: string[];
}

function layoutRefs(layout: Layout, base: number, out: Set<string>): void {
  for (const f of layout.fields ?? []) out.add(`${f.col}${base + f.row}`);
  for (const t of layout.tables ?? []) {
    for (const r of tableRows(t)) {
      for (const c of t.columns) if (!r.omit.includes(c.col)) out.add(`${c.col}${base + r.row}`);
    }
  }
  for (const l of layout.lines ?? []) for (const c of l.cells) out.add(`${c.col}${base + c.row}`);
  for (const s of layout.sequences ?? []) for (const c of sequenceCells(s)) out.add(`${c.col}${base + c.row}`);
  for (const ct of layout.columnTables ?? []) {
    for (const col of ct.cols) for (const f of ct.fields) out.add(`${col}${base + f.row}`);
  }
}

/**
 * Input cells of the given single-sheet sections (by key) and of every block and data-entry row of every equipment
 * type (all slots, used or not).
 */
export function inputCells(map: TemplateMap, opts: { sections: readonly string[] }): SheetInputCells[] {
  const bySheet = new Map<string, Set<string>>();
  const of = (sheet: string) => {
    if (!bySheet.has(sheet)) bySheet.set(sheet, new Set());
    return bySheet.get(sheet)!;
  };
  for (const sec of map.sections) if (opts.sections.includes(sec.key)) layoutRefs(sec, 0, of(sec.sheet));
  for (const def of map.equipment) {
    for (let n = 1; n <= def.capacity; n++) {
      if (def.ede) {
        const row = def.ede.firstRow + n - 1;
        for (const f of def.ede.fields) of(def.ede.sheet).add(`${f.col}${row}`);
      }
      layoutRefs(blockLayout(def, n), anchorRow(def.block.anchor, n), of(def.block.sheet));
    }
  }
  return [...bySheet].map(([sheet, refs]) => ({ sheet, refs: [...refs] }));
}
