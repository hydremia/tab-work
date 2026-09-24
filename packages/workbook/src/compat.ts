/**
 * Is a workbook (a previously issued report) still a revision-05-compatible copy of the template, so an export can
 * write into it? The workbook has no revision stamp, so this checks structure against the blank template:
 *  - every sheet of the template is there (by name);
 *  - every named dropdown list the map uses is defined;
 *  - on every sheet the map writes to, every formula cell of the template is still a formula at the same address
 *    (rows / columns inserted or deleted, or a formula typed over, would move or break what the map writes);
 *  - the formulas are revision 05's N/A-safe versions (ISTEXT guards), not an older revision's.
 * Hand formatting (styles, widths, heights, text in non-input cells, print setup) does not matter.
 */
import JSZip from 'jszip';
import { listSheets, parseCells, parseDefinedNames, readText, workbookPart } from './ooxml.js';
import { TEMPLATE_MAP, TemplateMap } from './templateMap.js';

export interface CompatResult {
  ok: boolean;
  problems: string[];
}

function mapSheets(map: TemplateMap): string[] {
  const s = new Set<string>();
  for (const sec of map.sections) s.add(sec.sheet);
  for (const def of map.equipment) {
    s.add(def.block.sheet);
    if (def.ede) s.add(def.ede.sheet);
  }
  return [...s];
}

function mapLists(map: TemplateMap): string[] {
  const s = new Set<string>();
  const add = (x: { list?: string }) => x.list && s.add(x.list);
  const layout = (l: TemplateMap['sections'][number] | TemplateMap['equipment'][number]['block']) => {
    l.fields?.forEach(add);
    l.tables?.forEach((t) => t.columns.forEach(add));
    l.columnTables?.forEach((t) => t.fields.forEach(add));
  };
  map.sections.forEach(layout);
  for (const def of map.equipment) {
    layout(def.block);
    def.ede?.fields.forEach(add);
  }
  return [...s];
}

export async function checkTemplateCompatibility(
  workbook: Uint8Array,
  template: Uint8Array,
  map: TemplateMap = TEMPLATE_MAP,
): Promise<CompatResult> {
  const problems: string[] = [];
  let bz: JSZip;
  try {
    bz = await JSZip.loadAsync(workbook);
  } catch {
    return { ok: false, problems: ['not a workbook (zip) file'] };
  }
  const tz = await JSZip.loadAsync(template);
  let bSheets: Awaited<ReturnType<typeof listSheets>>;
  try {
    bSheets = await listSheets(bz);
  } catch (e) {
    return { ok: false, problems: [`not a readable workbook: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const tSheets = await listSheets(tz);
  const missingSheets = tSheets.filter((t) => !bSheets.some((b) => b.name === t.name)).map((t) => t.name);
  if (missingSheets.length) problems.push(`sheets missing: ${missingSheets.join(', ')}`);

  const names = parseDefinedNames(await readText(bz, await workbookPart(bz)));
  const missingLists = mapLists(map).filter((n) => !names.some((d) => d.name === n && d.localSheetId === undefined));
  if (missingLists.length) problems.push(`dropdown lists missing: ${missingLists.join(', ')}`);

  let guarded = 0;
  let guardedKept = 0;
  for (const sheet of mapSheets(map)) {
    const b = bSheets.find((s) => s.name === sheet);
    const t = tSheets.find((s) => s.name === sheet);
    if (!b || !t) continue;
    const tc = parseCells(await readText(tz, t.part));
    const bc = parseCells(await readText(bz, b.part));
    const lost: string[] = [];
    for (const [ref, cell] of tc) {
      if (cell.formula === undefined) continue;
      const other = bc.get(ref);
      if (other?.formula === undefined) {
        lost.push(ref);
        continue;
      }
      // shared-formula children carry no text (Excel writes the text on the first cell of the range only)
      if (cell.formula.includes('ISTEXT(') && other.formula !== '') {
        guarded++;
        if (other.formula.includes('ISTEXT(')) guardedKept++;
      }
    }
    if (lost.length) {
      problems.push(
        `${sheet}: ${lost.length} formula cell(s) are no longer formulas at the template's addresses (e.g. ${lost.slice(0, 5).join(', ')}); rows or columns inserted / deleted, or values typed over formulas`,
      );
    }
  }
  if (guarded >= 20 && guardedKept / guarded < 0.9) {
    problems.push(
      `the formulas are not revision ${map.revision}'s N/A-safe versions (${guardedKept} of ${guarded}); an older template revision?`,
    );
  }
  return { ok: problems.length === 0, problems };
}
