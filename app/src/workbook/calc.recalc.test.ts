// @vitest-environment node
/**
 * The formula calculator (@a2b/workbook calc.ts) against LibreOffice, every formula cell of whole workbooks: the
 * sample project exported onto revisions 07 and 06, the blank template, and the revision 07 template with random
 * values typed into every input cell the map knows (numbers, negatives, blanks, N/A notations, list options, text,
 * numbers as text). Numbers must agree to 1e-9 (relative), text and errors exactly. Skipped where LibreOffice
 * (`soffice`) is not installed, e.g. in CI.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import {
  calculateWorkbook,
  exportWorkbookWithReport,
  inputCells,
  listSheets,
  parseCells,
  readText,
  TEMPLATE_06_FILE_NAME,
  TEMPLATE_FILE_NAME,
  TEMPLATE_LISTS,
  TEMPLATE_MAP,
  TEMPLATE_MAP_06,
  xmlEscape,
  XlError,
} from '@a2b/workbook';
import { describe, expect, it } from 'vitest';
import { sampleBundle } from '../test/fixtures';
import { hasSoffice, recalc } from '../test/recalc';
import { toProjectData } from './adapter';

const file = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../${name}`, import.meta.url))));

/** Every formula cell where the calculator and LibreOffice disagree, and how many numbers / errors were compared. */
async function compare(bytes: Uint8Array): Promise<{ bad: string[]; numbers: number; errors: number }> {
  const zip = await JSZip.loadAsync(bytes);
  const book = await calculateWorkbook(zip);
  expect(book.unsupported).toEqual([]);
  const lo = await recalc(bytes);
  const out: string[] = [];
  let numbers = 0;
  let errors = 0;
  for (const s of await listSheets(zip)) {
    for (const [ref, c] of parseCells(await readText(zip, s.part))) {
      if (!c.formula) continue;
      const v = book.value(s.name, ref);
      const mine = v instanceof XlError ? v.code : v;
      const theirs = await lo(s.name, ref);
      if (typeof mine === 'number') numbers++;
      if (v instanceof XlError) errors++;
      const same =
        mine === theirs ||
        (mine === '' && theirs === null) ||
        (typeof mine === 'number' &&
          typeof theirs === 'number' &&
          Math.abs(mine - theirs) <= 1e-9 * Math.max(1, Math.abs(theirs)));
      if (!same) out.push(`${s.name}!${ref}: ${JSON.stringify(mine)} vs ${JSON.stringify(theirs)} = ${c.formula}`);
    }
  }
  return { bad: out, numbers, errors };
}
const mismatches = async (bytes: Uint8Array) => (await compare(bytes)).bad;

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The template with random values in every input cell (cells holding a formula are left alone). */
async function fuzzed(seed: number): Promise<Uint8Array> {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const options = [
    ...new Set<string | number>(Object.values(TEMPLATE_LISTS).flat()),
    'Round',
    'Flat Oval',
    'Rectangular',
    'PSP',
    'Intake',
  ];
  const value = (): string | number | null => {
    const x = r();
    if (x < 0.3) return null;
    if (x < 0.62)
      return pick([Math.floor(r() * 2000), Math.round((r() * 10 - 5) * 1000) / 1000, Math.round(r() * 3000) / 100, 0]);
    if (x < 0.72) return pick(['N/A', 'Not Avail.', 'Not Acc.', 'N/L', '—']);
    if (x < 0.88) return pick(options);
    if (x < 0.93) return String(1 + Math.floor(r() * 900));
    return pick(['x', 'see remarks', '12x8', '7/8']);
  };
  const zip = await JSZip.loadAsync(file(TEMPLATE_FILE_NAME));
  const sheets = await listSheets(zip);
  const sections = TEMPLATE_MAP.sections.map((s) => s.key);
  for (const { sheet, refs } of inputCells(TEMPLATE_MAP, { sections })) {
    const part = sheets.find((s) => s.name === sheet)!.part;
    let xml = await readText(zip, part);
    const targets = new Set(refs);
    // existing input cells (the template styles every one): replace their contents, keep the style
    xml = xml.replace(
      /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
      (whole, ref: string, attrs: string, body?: string) => {
        if (!targets.has(ref) || (body && body.includes('<f'))) return whole;
        const style = /\bs="\d+"/.exec(attrs)?.[0] ?? '';
        const v = value();
        if (v === null) return `<c r="${ref}"${style ? ` ${style}` : ''}/>`;
        if (typeof v === 'number') return `<c r="${ref}"${style ? ` ${style}` : ''}><v>${v}</v></c>`;
        return `<c r="${ref}"${style ? ` ${style}` : ''} t="inlineStr"><is><t>${xmlEscape(v)}</t></is></c>`;
      },
    );
    zip.file(part, xml);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

describe.skipIf(!hasSoffice())('formula calculator = LibreOffice, every formula cell', () => {
  it('the sample project exported onto revision 07 (block hiding on)', async () => {
    const { data } = toProjectData(sampleBundle());
    const { bytes } = await exportWorkbookWithReport(file(TEMPLATE_FILE_NAME), data, { hideUnused: true });
    expect(await mismatches(bytes)).toEqual([]);
  }, 300_000);

  it('the sample project re-issued onto revision 06', async () => {
    const { data } = toProjectData(sampleBundle(), 'air', TEMPLATE_MAP_06);
    const { bytes } = await exportWorkbookWithReport(file(TEMPLATE_06_FILE_NAME), data, { map: TEMPLATE_MAP_06 });
    expect(await mismatches(bytes)).toEqual([]);
  }, 300_000);

  it.each([1, 2])(
    'revision 07 with random values in every input cell (seed %i)',
    async (seed) => {
      const r = await compare(await fuzzed(seed));
      expect(r.bad).toEqual([]);
      // the random values reach the calculations (and their error paths)
      expect(r.numbers).toBeGreaterThan(3000);
      expect(r.errors).toBeGreaterThan(20);
    },
    300_000,
  );
});
