// @vitest-environment node
/**
 * Schedules from PDFs: drawing-like pages made with pdf-lib (the way CAD / Revit plot schedules: a cell per text
 * item, a character per item, or a row per item; several schedules on one sheet; notes underneath; a sheet stored
 * rotated), read with pdf.js (workbook/pdfText.ts) and rebuilt by pdfTables(), then mapped by the schedule import.
 */
import { degrees, PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { readPdfText } from '../workbook/pdfText';
import { EQUIPMENT_TYPES } from './equipmentTypes';
import { pdfTables, suggestType } from './pdfTables';
import { autoMap, buildPreview, looksLikeHeader } from './scheduleImport';

const KNOWN = EQUIPMENT_TYPES.map((t) => t.key);

interface Sched {
  x: number;
  y: number;
  title: string;
  /** header lines, each [column index, text] (a text over several columns: [first, text, last]) */
  header: (readonly [number, string] | readonly [number, string, number])[][];
  cols: number[];
  rows: string[][];
  notes?: string[];
  mode?: 'cell' | 'char' | 'row';
}

function draw(page: PDFPage, font: PDFFont, s: Sched, rotate = false) {
  const size = 7;
  const text = (t: string, x: number, y: number, sz = size) => {
    if (!rotate) page.drawText(t, { x, y, size: sz, font });
    else page.drawText(t, { x: page.getWidth() - y, y: x, size: sz, font, rotate: degrees(90) });
  };
  const colX = (c: number) => s.x + s.cols.slice(0, c).reduce((a, b) => a + b, 0) + 3;
  text(s.title, s.x, s.y, 10);
  let y = s.y - 16;
  for (const line of s.header) {
    for (const h of line) {
      if (h.length === 3) {
        const [c0, t, c1] = h;
        const mid = (colX(c0) + colX(c1 + 1)) / 2;
        text(t, mid - font.widthOfTextAtSize(t, size) / 2, y);
      } else text(h[1], colX(h[0]), y);
    }
    y -= 9;
  }
  y -= 4;
  for (const row of s.rows) {
    const lines = row.map((c) => c.split('\n'));
    const depth = Math.max(...lines.map((l) => l.length));
    for (let k = 0; k < depth; k++) {
      if (s.mode === 'row') {
        // one text item per line, cells padded with spaces (CAD "single line text")
        const perChar = font.widthOfTextAtSize('0', size);
        let str = '';
        lines.forEach((l, c) => {
          const want = Math.round((colX(c) - s.x) / perChar);
          if (l[k]) str = str.padEnd(Math.max(want, str.length + 2)) + l[k];
        });
        page.drawText(str, { x: s.x, y, size, font: fontMono! });
      } else
        lines.forEach((l, c) => {
          const t = l[k];
          if (!t) return;
          if (s.mode === 'char') {
            let x = colX(c);
            for (const ch of t) {
              if (ch !== ' ') text(ch, x, y);
              x += font.widthOfTextAtSize(ch, size);
            }
          } else text(t, colX(c), y);
        });
      y -= 9;
    }
  }
  y -= 6;
  for (const n of s.notes ?? []) {
    text(n, s.x, y);
    y -= 9;
  }
}
let fontMono: PDFFont | null = null;

const PUMPS: Sched = {
  x: 40,
  y: 740,
  title: 'PUMP SCHEDULE',
  header: [
    [[4, 'DESIGN', 5]],
    [
      [0, 'TAG'],
      [1, 'SERVICE'],
      [2, 'MANUFACTURER'],
      [3, 'MODEL'],
      [4, 'FLOW (GPM)'],
      [5, 'HEAD (FT)'],
      [6, 'HP'],
      [7, 'RPM'],
      [8, 'V/PH/HZ'],
    ],
  ],
  cols: [40, 90, 70, 60, 50, 45, 30, 35, 55],
  rows: [
    ['P-1', 'CHILLED WATER\nPRIMARY', 'B&G', 'e-1510 2BC', '200', '60', '7.5', '1750', '460/3/60'],
    ['P-2', 'HEATING WATER', 'ARMSTRONG', '4030 2x2x9', '150', '45', '5', '1750', '460/3/60'],
    ['P-3', 'CONDENSER WATER', 'B&G', 'e-1510 3AD', '320', '72', '10', '1750', '460/3/60'],
  ],
  notes: ['NOTES: 1. PROVIDE VFD FOR P-1 AND P-3. 2. BALANCE TO DESIGN FLOW WITH TRIPLE DUTY VALVE AT 100% OPEN.'],
};

const FANS: Sched = {
  x: 620,
  y: 740,
  title: 'EXHAUST FAN SCHEDULE',
  header: [
    [
      [0, 'MARK'],
      [1, 'AREA SERVED'],
      [2, 'CFM'],
      [3, 'ESP'],
      [4, 'HP'],
    ],
  ],
  cols: [40, 100, 40, 35, 30],
  rows: [
    ['EF-1', 'TOILETS', '450', '0.5', '1/4'],
    ['EF-2', 'JANITOR', '120', '0.375', '1/10'],
  ],
};

async function pdfOf(scheds: Sched[], opts: { rotate?: boolean } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage(opts.rotate ? [792, 1224] : [1224, 792]);
  if (opts.rotate) page.setRotation(degrees(90));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  fontMono = await doc.embedFont(StandardFonts.Courier);
  for (const s of scheds) draw(page, font, s, opts.rotate);
  return doc.save();
}

async function tablesOf(bytes: Uint8Array) {
  const { pages } = await readPdfText(bytes);
  return pdfTables(pages, KNOWN);
}

describe('schedules from a PDF', () => {
  it('two schedules side by side: titles, stacked and spanning headers, wrapped cells, notes left out', async () => {
    const tables = await tablesOf(await pdfOf([PUMPS, FANS]));
    expect(tables.map((t) => [t.title, t.type])).toEqual([
      ['PUMP SCHEDULE', 'pump'],
      ['EXHAUST FAN SCHEDULE', 'fan'],
    ]);
    const [pumps, fans] = tables;
    expect(pumps.rows[0]).toEqual([
      'TAG',
      'SERVICE',
      'MANUFACTURER',
      'MODEL',
      'DESIGN FLOW (GPM)',
      'DESIGN HEAD (FT)',
      'HP',
      'RPM',
      'V/PH/HZ',
    ]);
    expect(pumps.rows.slice(1)).toEqual([
      ['P-1', 'CHILLED WATER PRIMARY', 'B&G', 'e-1510 2BC', '200', '60', '7.5', '1750', '460/3/60'],
      ['P-2', 'HEATING WATER', 'ARMSTRONG', '4030 2x2x9', '150', '45', '5', '1750', '460/3/60'],
      ['P-3', 'CONDENSER WATER', 'B&G', 'e-1510 3AD', '320', '72', '10', '1750', '460/3/60'],
    ]);
    expect(fans.rows).toEqual([
      ['MARK', 'AREA SERVED', 'CFM', 'ESP', 'HP'],
      ['EF-1', 'TOILETS', '450', '0.5', '1/4'],
      ['EF-2', 'JANITOR', '120', '0.375', '1/10'],
    ]);
  });

  it('the rebuilt pump schedule maps and previews like a pasted one', async () => {
    const [pumps] = await tablesOf(await pdfOf([PUMPS]));
    expect(looksLikeHeader(pumps.rows[0], 'pump')).toBe(true);
    const mapping = autoMap(pumps.rows[0], 'pump');
    expect(mapping).toEqual([
      'designation',
      'service',
      'manufacturer',
      'model',
      'designGpm',
      'designHead',
      'hp',
      'rpm',
      'voltage',
    ]);
    const preview = buildPreview({ type: 'pump', rows: pumps.rows.slice(1), mapping, existing: [] });
    expect(preview.create).toBe(3);
    const p1 = preview.rows[0];
    expect(p1.designation).toBe('P-1');
    expect(p1.values).toMatchObject({ designGpm: 200, designHead: 60, hp: 7.5, voltage: 460 });
    expect(p1.values.phase).toBe('3-phase');
  });

  it('a character per text item, and a whole row in one item', async () => {
    const byChar = await tablesOf(await pdfOf([{ ...FANS, mode: 'char' }]));
    expect(byChar[0].rows[1]).toEqual(['EF-1', 'TOILETS', '450', '0.5', '1/4']);
    const byRow = await tablesOf(await pdfOf([{ ...FANS, mode: 'row' }]));
    expect(byRow[0].rows.slice(1)).toEqual([
      ['EF-1', 'TOILETS', '450', '0.5', '1/4'],
      ['EF-2', 'JANITOR', '120', '0.375', '1/10'],
    ]);
  });

  it('a sheet stored rotated (landscape plotted on a portrait page) reads upright', async () => {
    const tables = await tablesOf(await pdfOf([FANS], { rotate: true }));
    expect(tables[0].title).toBe('EXHAUST FAN SCHEDULE');
    expect(tables[0].rows[1]).toEqual(['EF-1', 'TOILETS', '450', '0.5', '1/4']);
  });

  it('a page without tables gives none; the type is suggested only from known words', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('GENERAL NOTES', { x: 50, y: 700, size: 12, font });
    page.drawText('ALL WORK SHALL COMPLY WITH THE LOCAL CODE.', { x: 50, y: 680, size: 8, font });
    expect(await tablesOf(await doc.save())).toEqual([]);
    expect(suggestType('VAV BOX SCHEDULE', KNOWN)).toBe('vav');
    expect(suggestType('CHILLER SCHEDULE', KNOWN)).toBe('plant');
    expect(suggestType('LIGHT FIXTURE SCHEDULE', KNOWN)).toBeNull();
  });
});
