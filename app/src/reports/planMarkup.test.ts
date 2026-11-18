// @vitest-environment node
/**
 * The marked-up plan: systems lassoed in the app are drawn (annotations, or flattened for the report); a system read
 * from the tech's own markup is not drawn again, and the drawing's own annotations go through to the report page.
 */
import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { PlanSheet, PlanSystem } from '../data/types';
import { readPlanAnnotations } from '../workbook/pdfAnnotations';
import { planMarkupPdf, sheetMarks } from './planMarkup';

const device = (key: string, x: number, y: number): PlanSheet['devices'][number] => ({
  key,
  tag: { x, y, box: { x0: x - 10, y0: y - 10, x1: x + 10, y1: y + 10 }, lines: [] },
  type: 'S1',
  size: null,
  cfm: 500,
  x,
  y,
  how: 'tag',
  count: 1,
  index: 0,
});
const system = (extra: Partial<PlanSystem> = {}): PlanSystem => ({
  id: 'sys',
  equipmentId: 'u1',
  table: 'supply',
  polygon: [
    [50, 50],
    [250, 50],
    [250, 150],
    [50, 150],
  ],
  deviceKeys: ['a', 'b'],
  color: '#38e5ff',
  prefix: '1',
  rowIds: {},
  createdAt: 0,
  ...extra,
});
const sheet = (pdf: Uint8Array, systems: PlanSystem[]): PlanSheet => ({
  id: 's',
  projectId: 'p',
  fileName: 'M101.pdf',
  pdf,
  page: 1,
  pageCount: 1,
  width: 600,
  height: 400,
  ocr: false,
  devices: [device('a', 100, 100), device('b', 200, 120)],
  systems,
  createdAt: 0,
  updatedAt: 0,
});
const units = [{ id: 'u1', designation: 'RTU-1' }];
const annotCount = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  return annots && 'size' in annots ? (annots as { size(): number }).size() : 0;
};

describe('planMarkupPdf', () => {
  it('draws a lassoed system, and nothing for a system read from the tech’s markup', async () => {
    const blank = await (async () => {
      const d = await PDFDocument.create();
      d.addPage([600, 400]);
      return d.save();
    })();
    // the app's markup of a lasso: one polygon and two labels
    const lassoed = await planMarkupPdf(sheet(blank, [system()]), units);
    expect(await annotCount(lassoed)).toBe(3);
    // the same devices as a system from Import markup (the tech's labels kept): no marks at all
    const fromMarkup = sheet(blank, [system({ source: 'markup', labels: ['1A', '1B'] })]);
    expect(sheetMarks(fromMarkup, units)).toEqual([]);
    expect(await annotCount(await planMarkupPdf(fromMarkup, units))).toBe(0);
    // a system imported before `source` was recorded is told by its labels
    expect(sheetMarks(sheet(blank, [system({ labels: ['1A', '1B'] })]), units)).toEqual([]);
    // both kinds on one sheet: only the lasso is drawn
    expect(
      sheetMarks(
        sheet(blank, [system({ source: 'markup', labels: ['1A', '1B'] }), system({ id: 'l', prefix: '2' })]),
        units,
      ),
    ).toHaveLength(1);
  });

  it('the report page of a tech’s marked-up drawing keeps the drawing’s own annotations and adds none', async () => {
    const blank = await (async () => {
      const d = await PDFDocument.create();
      d.addPage([600, 400]);
      return d.save();
    })();
    // stand-in for the tech's file: a drawing already carrying a polygon and labels 1A, 1B
    const techs = await planMarkupPdf(sheet(blank, [system()]), units);
    const imported = sheet(techs, [system({ source: 'markup', labels: ['1A', '1B'] })]);
    const page = await planMarkupPdf(imported, units, { flatten: true, onlyPage: true });
    expect(await annotCount(page)).toBe(3);
    const { labels, shapes } = await readPlanAnnotations(page, 1);
    expect(labels.map((l) => l.text).sort()).toEqual(['1A', '1B']);
    expect(shapes).toHaveLength(1);
    // the Markup PDF of that sheet is the drawing as it is: still three annotations, not six
    expect(await annotCount(await planMarkupPdf(imported, units))).toBe(3);
  });
});
