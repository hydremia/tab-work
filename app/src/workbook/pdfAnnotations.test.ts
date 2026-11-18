// @vitest-environment node
/**
 * Markup annotations read back: the app's own markup (reports/planMarkup.ts: Polygon + FreeText annotations) and a
 * tech's ink / square / highlight marks drawn with pdf-lib come back as labels and shapes on the upright page.
 */
import { PDFDocument, PDFString, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { PlanSheet } from '../data/types';
import { planMarkupPdf } from '../reports/planMarkup';
import { hull, readPlanAnnotations } from './pdfAnnotations';

async function sheetPdf(rotate = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = rotate ? doc.addPage([400, 600]) : doc.addPage([600, 400]);
  if (rotate) page.setRotation(degrees(90));
  return doc.save();
}

describe('pdfAnnotations', () => {
  it('reads the app’s own markup back: labels with their colour, polygons with their points', async () => {
    const sheet: PlanSheet = {
      id: 's',
      projectId: 'p',
      fileName: 'M101.pdf',
      pdf: await sheetPdf(),
      page: 1,
      pageCount: 1,
      width: 600,
      height: 400,
      ocr: false,
      devices: [
        {
          key: 'a',
          tag: { x: 100, y: 100, box: { x0: 90, y0: 90, x1: 110, y1: 110 }, lines: [] },
          type: 'S1',
          size: null,
          cfm: 500,
          x: 100,
          y: 100,
          how: 'tag',
          count: 1,
          index: 0,
        },
        {
          key: 'b',
          tag: { x: 200, y: 120, box: { x0: 190, y0: 110, x1: 210, y1: 130 }, lines: [] },
          type: 'S1',
          size: null,
          cfm: 400,
          x: 200,
          y: 120,
          how: 'tag',
          count: 1,
          index: 0,
        },
      ],
      systems: [
        {
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
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const bytes = await planMarkupPdf(sheet, [{ id: 'u1', designation: 'RTU-1' }]);
    const { labels, shapes } = await readPlanAnnotations(bytes, 1);
    expect(labels.map((l) => l.text).sort()).toEqual(['1A', '1B']);
    const a = labels.find((l) => l.text === '1A')!;
    // the label sits right of its device, vertically centred, in the system's colour (y downwards)
    expect(a.x).toBeGreaterThan(100);
    expect(a.x).toBeLessThan(130);
    expect(Math.abs(a.y - 100)).toBeLessThan(2);
    expect(a.color).toBe('#38e5ff');
    expect(shapes).toHaveLength(1);
    expect(shapes[0].kind).toBe('polygon');
    expect(shapes[0].points.map(([x, y]) => [Math.round(x), Math.round(y)])).toEqual([
      [50, 50],
      [250, 50],
      [250, 150],
      [50, 150],
    ]);
    expect(shapes[0].color).toBe('#38e5ff');
  });

  it('reads a tech’s marks on a rotated sheet: free text, ink, square and highlight, upright', async () => {
    const doc = await PDFDocument.load(await sheetPdf(true));
    const page = doc.getPage(0);
    const ctx = doc.context;
    const annot = (dict: Record<string, unknown>) =>
      page.node.addAnnot(ctx.register(ctx.obj(dict as unknown as Parameters<typeof ctx.obj>[0])));
    // media box 400 × 600 rotated 90°: displayed 600 × 400. PDF user point (x, y) shows at upright (y, x).
    annot({
      Type: 'Annot',
      Subtype: 'FreeText',
      Rect: [100, 190, 130, 210],
      Contents: PDFString.of('3A'),
      DA: PDFString.of('1 0 0 rg /Helv 12 Tf'),
      F: 4,
    });
    annot({
      Type: 'Annot',
      Subtype: 'Ink',
      Rect: [0, 0, 400, 600],
      InkList: [[10, 10, 50, 10, 50, 60, 10, 60]],
      C: [0, 1, 0],
      F: 4,
    });
    annot({ Type: 'Annot', Subtype: 'Square', Rect: [200, 300, 260, 340], C: [0, 0, 1], IC: [0.5, 0.5, 1], F: 4 });
    annot({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: [300, 100, 340, 120],
      QuadPoints: [300, 120, 340, 120, 300, 100, 340, 100],
      C: [1, 1, 0],
      F: 4,
    });
    const { labels, shapes } = await readPlanAnnotations(await doc.save(), 1);
    expect(labels).toHaveLength(1);
    expect(labels[0].text).toBe('3A');
    // Rect x 100..130, y 190..210 → upright x = y_pdf (190..210), y = x_pdf (100..130)
    expect(Math.round(labels[0].x)).toBe(200);
    expect(Math.round(labels[0].y)).toBe(115);
    expect(labels[0].color).toBe('#ff0000');
    expect(shapes.map((s) => s.kind).sort()).toEqual(['highlight', 'ink', 'rect']);
    const ink = shapes.find((s) => s.kind === 'ink')!;
    expect(ink.points.map(([x, y]) => [Math.round(x), Math.round(y)])).toEqual([
      [10, 10],
      [10, 50],
      [60, 50],
      [60, 10],
    ]);
    expect(ink.color).toBe('#00ff00');
    const rect = shapes.find((s) => s.kind === 'rect')!;
    expect(rect.color).toBe('#0000ff'); // pdf.js reports the border colour of a square
    const hl = shapes.find((s) => s.kind === 'highlight')!;
    expect(hl.points.length).toBe(4);
  });

  it('hull: the outline of a point cloud', () => {
    expect(
      hull([
        [0, 0],
        [2, 0],
        [1, 1],
        [2, 2],
        [0, 2],
        [1, 0.5],
      ]),
    ).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]);
  });
});
