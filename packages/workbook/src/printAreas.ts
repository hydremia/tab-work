/**
 * Print areas of the unit sheets, fitted at export: each sheet prints through the page of its last unit (Hoods
 * through H-8, RTUs through RTU-6's continuation page), so the workbook opens in Page Break Preview with every filled
 * unit inside the print area. The template ships with a fixed area (a few units); TABReport's Print Report sets the
 * same areas again (and hides unused blocks) before printing.
 *
 * The page end is the first manual page break at or after the last unit's last row (the template has a break after
 * every page of the unit sheets); a sheet without breaks ends at that row.
 */
import type JSZip from 'jszip';
import { readText } from './ooxml.js';
import { anchorRow, type TemplateMap } from './templateMap.js';

export interface PrintAreaUnits {
  /** equipment type key -> slots in use */
  [type: string]: readonly { slot: number }[] | undefined;
}

/** Last row of block n: a linear block spans its stride; a paged block (two hoods a page) ends with its page. */
function blockEnd(def: TemplateMap['equipment'][number], n: number): number {
  const a = def.block.anchor;
  return a.kind === 'linear' ? anchorRow(a, n) + a.stride - 1 : anchorRow(a, n);
}

export async function fitPrintAreas(
  zip: JSZip,
  sheets: readonly { name: string; part: string; index: number }[],
  wbXml: string,
  map: TemplateMap,
  units: PrintAreaUnits,
): Promise<{ xml: string; changed: string[] }> {
  // last row needed per sheet (at least the first unit's page, like Print Report)
  const need = new Map<string, number>();
  for (const def of map.equipment) {
    const last = Math.max(1, ...(units[def.key] ?? []).map((u) => u.slot));
    need.set(def.block.sheet, Math.max(need.get(def.block.sheet) ?? 0, blockEnd(def, last)));
  }
  let xml = wbXml;
  const changed: string[] = [];
  for (const [name, row] of need) {
    const s = sheets.find((x) => x.name === name);
    if (!s) continue;
    const sheet = await readText(zip, s.part);
    const breaks = [...sheet.matchAll(/<rowBreaks\b[\s\S]*?<\/rowBreaks>/g)]
      .flatMap((m) => [...m[0].matchAll(/<brk\b[^>]*\bid="(\d+)"/g)].map((b) => Number(b[1])))
      .sort((a, b) => a - b);
    const end = breaks.find((b) => b >= row) ?? row;
    const re = new RegExp(
      `(<definedName\\b[^>]*name="_xlnm\\.Print_Area"[^>]*localSheetId="${s.index}"[^>]*>[^<]*?!\\$[A-Z]+\\$\\d+:\\$[A-Z]+\\$)(\\d+)(<)`,
    );
    const m = re.exec(xml);
    if (!m || Number(m[2]) === end) continue;
    xml = xml.replace(re, `$1${end}$3`);
    changed.push(`${name} 1-${end}`);
  }
  return { xml, changed };
}
