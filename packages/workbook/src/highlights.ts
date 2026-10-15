/**
 * Template highlights that print: the Hoods sheet's cells linked from {Equipment Data Entry} (hood and model
 * manufacturer, design airflow, model number) carry a solid yellow fill in the template, a working mark of the
 * original workbook that printed in every report. The export moves those cells to a copy of their style without the
 * fill (an issued workbook re-exported is cleaned the same way; the template itself is left as shipped).
 */
import type JSZip from 'jszip';
import { attr, readText } from './ooxml.js';

/** Solid fills in this colour are cleared. */
const YELLOW = /rgb="FFFFFF00"/i;

export async function clearHighlights(
  zip: JSZip,
  stylesPart: string,
  sheets: readonly { name: string; part: string }[],
  names: readonly string[],
): Promise<number> {
  let styles = await readText(zip, stylesPart);
  const fillsBlock = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(styles);
  const xfsBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles);
  if (!fillsBlock || !xfsBlock) return 0;
  const fills = [...fillsBlock[1].matchAll(/<fill\b[^>]*\/>|<fill\b[^>]*>[\s\S]*?<\/fill>/g)].map((m) => m[0]);
  const yellow = new Set(
    fills.map((f, i) => (/patternType="solid"/.test(f) && YELLOW.test(f) ? i : -1)).filter((i) => i >= 0),
  );
  if (!yellow.size) return 0;
  const xfs = [...xfsBlock[1].matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map((m) => m[0]);
  const marked = new Set(
    xfs.map((x, i) => (yellow.has(Number(attr(x, 'fillId') ?? -1)) ? i : -1)).filter((i) => i >= 0),
  );
  if (!marked.size) return 0;

  // a copy of each marked style without the fill, added once
  const copyOf = new Map<number, number>();
  const added: string[] = [];
  const clone = (i: number) => {
    if (!copyOf.has(i)) {
      const x = xfs[i].replace(/\sfillId="\d+"/, ' fillId="0"').replace(/\sapplyFill="[^"]*"/, '');
      copyOf.set(i, xfs.length + added.length);
      added.push(x);
    }
    return copyOf.get(i)!;
  };
  let cells = 0;
  for (const s of sheets) {
    if (!names.includes(s.name)) continue;
    const xml = await readText(zip, s.part);
    const out = xml.replace(/<c\b([^>]*?)\bs="(\d+)"/g, (m, pre: string, id: string) => {
      if (!marked.has(Number(id))) return m;
      cells++;
      return `<c${pre}s="${clone(Number(id))}"`;
    });
    if (out !== xml) zip.file(s.part, out);
  }
  if (added.length) {
    const open = /^<cellXfs\b[^>]*>/.exec(xfsBlock[0])![0];
    const block = `${open.replace(/\scount="\d+"/, ` count="${xfs.length + added.length}"`)}${xfsBlock[1]}${added.join('')}</cellXfs>`;
    styles = styles.slice(0, xfsBlock.index) + block + styles.slice(xfsBlock.index + xfsBlock[0].length);
    zip.file(stylesPart, styles);
  }
  return cells;
}
