/**
 * Tolerance colours (ROADMAP §7.1 route A): conditional formatting on the template's "% of design" cells, added at
 * export. Green (Excel's "Good" style) when the value is within ±tolerance of 100 %, red ("Bad") outside; blank and
 * text cells stay as they are. Being conditional formatting, the colours follow the values when the workbook is
 * edited in Excel.
 *
 * The cells are found by their formulas, so no cell list has to be kept in step with the template:
 *   - outlet / inlet rows:  IF(OR(H#="",H#=0),"",IF(K#="",IF(J#="",... J#/H# ...   (Final or Initial CFM / design)
 *   - totals and summaries: IF(OR(L#="",K#="",K#=0),"",IF(OR(ISTEXT(L#),ISTEXT(K#)),"",L#/K#))   (actual / design)
 *   - Building Balance (rev 07): the same ratio inside IF($P#<>"","Excl.", ...) (an excluded row shows "Excl.")
 * Rules added by an earlier export (recognised by their formula) are replaced, never duplicated.
 */
import type JSZip from 'jszip';
import { colToNum, readText, splitRef } from './ooxml.js';

const OUTLET = /^IF\(OR\(([A-Z]+)(\d+)="",\1\2=0\),"",IF\([A-Z]+\2="",IF\([A-Z]+\2="",""/;
const RATIO =
  /^IF\(OR\(([A-Z]+)(\d+)="",([A-Z]+)(\d+)="",\3\4=0\),"",IF\(OR\(ISTEXT\(\1\2\),ISTEXT\(\3\4\)\),"",\1\2\/\3\4\)\)$/;
/** Revision 07 Building Balance: the row's ratio, or "Excl." when the row is left out of the totals. */
const EXCLUDED = /^IF\(\$[A-Z]+\d+<>"","Excl\.",(.*)\)$/;
/** The formulas of the rules this module writes (to find them again). */
const OURS =
  /<conditionalFormatting\b[^>]*>(?:(?!<\/conditionalFormatting>)[\s\S])*?AND\(ISNUMBER\(\$?[A-Z]+\$?\d+\),ABS\([A-Z]+\d+-1\)(?:&lt;=|&gt;)[\d.]+\)(?:(?!<\/conditionalFormatting>)[\s\S])*?<\/conditionalFormatting>/g;

const GOOD =
  '<dxf><font><color rgb="FF006100"/></font><fill><patternFill><bgColor rgb="FFC6EFCE"/></patternFill></fill></dxf>';
const BAD =
  '<dxf><font><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf>';

/** The "% of design" cells of a sheet, by their formulas (shared formulas included: Excel writes them on save). */
export function percentCells(sheetXml: string): string[] {
  const out: string[] = [];
  const sharedHit = new Set<string>();
  const isPercent = (f: string) => {
    let g = f.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, '');
    g = EXCLUDED.exec(g)?.[1] ?? g;
    return OUTLET.test(g) || RATIO.test(g);
  };
  for (const m of sheetXml.matchAll(/<c\b([^>]*)>\s*<f\b([^>]*?)(?:\/>|>([^<]*)<\/f>)/g)) {
    const ref = /\br="([A-Z]+\d+)"/.exec(m[1])?.[1];
    if (!ref) continue;
    const si = /\bt="shared"/.test(m[2]) ? /\bsi="(\d+)"/.exec(m[2])?.[1] : undefined;
    if (m[3] !== undefined && m[3] !== '') {
      if (isPercent(m[3])) {
        out.push(ref);
        if (si !== undefined) sharedHit.add(si);
      }
    } else if (si !== undefined && sharedHit.has(si)) out.push(ref);
  }
  return out;
}

/** Cells -> a compact sqref: contiguous rows of a column become one range ("M30:M77 M100"). */
export function sqrefOf(cells: readonly string[]): string {
  const byCol = new Map<string, number[]>();
  for (const c of cells) {
    const { col, row } = splitRef(c);
    byCol.set(col, [...(byCol.get(col) ?? []), row]);
  }
  const parts: string[] = [];
  for (const col of [...byCol.keys()].sort((a, b) => colToNum(a) - colToNum(b))) {
    const rows = [...new Set(byCol.get(col))].sort((a, b) => a - b);
    let start = rows[0];
    let prev = rows[0];
    for (const r of [...rows.slice(1), Infinity]) {
      if (r === prev + 1) {
        prev = r;
        continue;
      }
      parts.push(start === prev ? `${col}${start}` : `${col}${start}:${col}${prev}`);
      start = r;
      prev = r;
    }
  }
  return parts.join(' ');
}

/** Index of a dxf in styles.xml (added when missing). */
function ensureDxf(styles: string, dxf: string): { styles: string; id: number } {
  const block = /<dxfs\b[^>]*?(?:\/>|>([\s\S]*?)<\/dxfs>)/.exec(styles);
  if (!block) {
    const at = styles.indexOf('<tableStyles');
    const ins = `<dxfs count="1">${dxf}</dxfs>`;
    const out =
      at >= 0 ? styles.slice(0, at) + ins + styles.slice(at) : styles.replace('</styleSheet>', `${ins}</styleSheet>`);
    return { styles: out, id: 0 };
  }
  const items = [...(block[1] ?? '').matchAll(/<dxf>[\s\S]*?<\/dxf>|<dxf\/>/g)].map((m) => m[0]);
  const found = items.indexOf(dxf);
  if (found >= 0) return { styles, id: found };
  const next = [...items, dxf];
  return {
    styles: styles.replace(block[0], `<dxfs count="${next.length}">${next.join('')}</dxfs>`),
    id: items.length,
  };
}

/** Where a conditionalFormatting element goes (CT_Worksheet order). */
function insertAt(xml: string): number {
  const lastCf = xml.lastIndexOf('</conditionalFormatting>');
  if (lastCf >= 0) return lastCf + '</conditionalFormatting>'.length;
  for (const tag of [
    '<dataValidations',
    '<hyperlinks',
    '<printOptions',
    '<pageMargins',
    '<pageSetup',
    '<headerFooter',
    '<rowBreaks',
    '<colBreaks',
    '<ignoredErrors',
    '<drawing',
    '<legacyDrawing',
    '<tableParts',
    '<extLst',
  ]) {
    const i = xml.indexOf(tag);
    if (i >= 0) return i;
  }
  return xml.indexOf('</worksheet>');
}

/**
 * Adds the tolerance colours to every sheet with "% of design" cells (tolerance as a fraction: 0.1 = ±10 %), or only
 * removes earlier ones when `tolerance` is null. Returns the number of cells coloured.
 */
export async function applyToleranceColors(
  zip: JSZip,
  sheets: readonly { part: string }[],
  tolerance: number | null,
  stylesPart = 'xl/styles.xml',
): Promise<number> {
  let styles = zip.file(stylesPart) ? await readText(zip, stylesPart) : null;
  let good = -1;
  let bad = -1;
  if (tolerance !== null && styles) {
    const g = ensureDxf(styles, GOOD);
    const b = ensureDxf(g.styles, BAD);
    styles = b.styles;
    good = g.id;
    bad = b.id;
  }
  let total = 0;
  for (const s of sheets) {
    const xml0 = await readText(zip, s.part);
    let xml = xml0.replace(OURS, '');
    if (tolerance !== null && styles) {
      const cells = percentCells(xml);
      if (cells.length) {
        const priority = Math.max(0, ...[...xml.matchAll(/\bpriority="(\d+)"/g)].map((m) => Number(m[1])));
        const first = cells[0];
        const t = String(Math.round(tolerance * 1e6) / 1e6);
        const cf =
          `<conditionalFormatting sqref="${sqrefOf(cells)}">` +
          `<cfRule type="expression" dxfId="${good}" priority="${priority + 1}"><formula>AND(ISNUMBER(${first}),ABS(${first}-1)&lt;=${t})</formula></cfRule>` +
          `<cfRule type="expression" dxfId="${bad}" priority="${priority + 2}"><formula>AND(ISNUMBER(${first}),ABS(${first}-1)&gt;${t})</formula></cfRule>` +
          `</conditionalFormatting>`;
        const at = insertAt(xml);
        xml = xml.slice(0, at) + cf + xml.slice(at);
        total += cells.length;
      }
    }
    if (xml !== xml0) zip.file(s.part, xml);
  }
  if (styles && tolerance !== null) zip.file(stylesPart, styles);
  return total;
}
