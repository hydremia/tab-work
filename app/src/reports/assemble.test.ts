/**
 * Final report assembly: a small "Excel report" made with pdf-lib (print-header titles, "System <unit>" boxes, a
 * "Page n" footer, a table of contents with "page n" entries), the figures placed after their pages, the pages
 * renumbered and the contents updated. Read back with pdf.js like the app does.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { readPdfText } from '../workbook/pdfText';
import { assembleReport, planReport } from './assemble';
import type { FigureGroup } from './graphics';

type Spec = { title?: string; lines?: string[]; toc?: [string, number][]; footer?: boolean };

async function report(specs: Spec[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  specs.forEach((s, i) => {
    const p = doc.addPage([612, 792]);
    if (s.title) p.drawText(s.title, { x: 220, y: 750, size: 16, font: f });
    (s.lines ?? []).forEach((l, k) => {
      const [a, b] = l.split('|');
      p.drawText(a, { x: 60, y: 690 - k * 40, size: 9, font: f });
      if (b) p.drawText(b, { x: 120, y: 690 - k * 40, size: 9, font: f });
    });
    if (s.toc) {
      p.drawText('Table of Contents', { x: 230, y: 700, size: 14, font: f });
      s.toc.forEach(([name, n], k) => {
        p.drawText(name, { x: 80, y: 650 - k * 20, size: 10, font: f });
        p.drawText(`page ${n}`, { x: 450, y: 650 - k * 20, size: 10, font: f });
      });
    }
    if (s.footer !== false) p.drawText(`Page ${i + 1}`, { x: 290, y: 25, size: 8, font: f });
  });
  return doc.save();
}

async function figures(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) doc.addPage([612, 792]).drawText(`FIGURE ${i}`, { x: 60, y: 700, size: 12, font: f });
  return doc.save();
}

const group = (key: string, unit: string | null, type: FigureGroup['type'], firstPage: number, pageCount = 1) => ({
  key,
  unit,
  type,
  firstPage,
  pageCount,
});

const SPECS: Spec[] = [
  { footer: false, lines: ['CERTIFIED'] }, // 1 cover
  { toc: [['Building Balance', 3], ['Rooftop Units', 4], ['Traverses', 7]] }, // 2
  { title: 'Building Balance Report', lines: ['RTU-1|9,860'] }, // 3 (mentions RTU-1: not its page)
  { title: 'Rooftop Unit Report', lines: ['System|RTU-1', 'Remarks|see RTU-10'] }, // 4
  { title: 'Rooftop Unit Report', lines: ['System (cont.)|RTU-1'] }, // 5
  { title: 'Rooftop Unit Report', lines: ['System|RTU-10', 'Remarks|like RTU-1'] }, // 6
  { title: 'Traverse Measurement Report', lines: ['Traverse|T-1', 'Traverse|T-2'] }, // 7
  { title: 'Site Photos' }, // 8
];

describe('final report assembly', () => {
  it('plans: figures after their unit (continuation page included), summary after the Building Balance', async () => {
    const { pages } = await readPdfText(await report(SPECS));
    const plan = planReport(pages, [
      group('summary', null, null, 0),
      group('rtu|RTU-1', 'RTU-1', 'rtu', 1),
      group('rtu|RTU-10', 'RTU-10', 'rtu', 2),
      group('traverse|T-2', 'T-2', 'traverse', 3),
      group('rtu|RTU-7', 'RTU-7', 'rtu', 4),
      group('pump|P-1', 'P-1', 'pump', 5),
    ]);
    expect(plan.titles[3]).toBe('Rooftop Unit Report');
    expect(plan.placed.map((p) => `${p.key}@${p.after}:${p.how}`)).toEqual([
      'summary@2:summary',
      'rtu|RTU-1@4:unit', // after its continuation page, not after RTU-10's page that mentions it
      'rtu|RTU-10@5:unit',
      'traverse|T-2@6:unit',
      'rtu|RTU-7@5:sheet', // not in the report: after the last RTU page
      'pump|P-1@-1:end',
    ]);
    expect(plan.order.map((o) => (o.src === 'report' ? `r${o.page}` : `g${o.page}`)).join(' ')).toBe(
      'r0 r1 r2 g0 r3 r4 g1 r5 g2 g4 r6 g3 r7 g5',
    );
    expect(plan.footers.size).toBe(7); // the cover has none
    expect(plan.toc.map((t) => t.target)).toEqual([2, 3, 6]);
  });

  it('builds the PDF: pages numbered "Page x of N", the contents moved by the inserted pages', async () => {
    const r = await assembleReport(
      await report(SPECS),
      {
        bytes: await figures(3),
        groups: [group('summary', null, null, 0), group('rtu|RTU-1', 'RTU-1', 'rtu', 1), group('traverse|T-1', 'T-1', 'traverse', 2)],
      },
      (b) => readPdfText(b),
      { title: 'TAB Report', author: 'a2b', now: new Date('2026-10-01T00:00:00Z') },
    );
    expect(r.pages).toBe(11);
    const { pages } = await readPdfText(r.bytes);
    const text = pages.map((p) => p.items.map((i) => i.str).join(' '));
    expect(text[3]).toContain('FIGURE 0'); // summary after Building Balance (page 3)
    expect(text[6]).toContain('FIGURE 1'); // after RTU-1 (cont.)
    expect(text[9]).toContain('FIGURE 2'); // after the traverse page
    expect(text[0]).not.toContain('of 11'); // the cover stays unnumbered
    for (const i of [1, 2, 3, 6, 10]) expect(text[i]).toContain(`Page ${i + 1} of 11`);
    // contents: Building Balance still page 3, Rooftop Units 4 -> 5, Traverses 7 -> 9
    expect(text[1]).toMatch(/page 3[\s\S]*page 5[\s\S]*page 9/);
  });

  it('without figures it only numbers the pages', async () => {
    const r = await assembleReport(
      await report(SPECS.slice(0, 4)),
      { bytes: new Uint8Array(), groups: [] },
      (b) => readPdfText(b),
      { title: 'TAB Report', author: 'a2b' },
    );
    const { pages } = await readPdfText(r.bytes);
    expect(r.pages).toBe(4);
    expect(pages[3].items.map((i) => i.str).join(' ')).toContain('Page 4 of 4');
  });
});
