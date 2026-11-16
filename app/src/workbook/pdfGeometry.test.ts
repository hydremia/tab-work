// @vitest-environment node
/**
 * Vector geometry from a PDF: shapes drawn with pdf-lib (rectangles, lines, a circle, a translated / scaled group,
 * a rotated sheet) come back as polylines on the upright page, y downwards, with their paint and stroke width.
 */
import { degrees, PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { pathsFromDrawOps, readPdfGeometry } from './pdfGeometry';

const near = (a: number, b: number, tol = 0.6) => Math.abs(a - b) <= tol;

describe('pdfGeometry', () => {
  it('decodes a DrawOPS list: subpaths, closing, curves flattened, the frame applied', () => {
    // moveTo 0,0 lineTo 10,0 lineTo 10,10 closePath ; moveTo 20,20 lineTo 30,20 ; curve
    const data = [0, 0, 0, 1, 10, 0, 1, 10, 10, 4, 0, 20, 20, 1, 30, 20, 2, 40, 20, 50, 30, 50, 40];
    const ps = pathsFromDrawOps(data, [1, 0, 0, -1, 0, 100], 'stroke', 0.5);
    expect(ps).toHaveLength(2);
    expect(ps[0].closed).toBe(true);
    expect(ps[0].pts).toEqual([
      [0, 100],
      [10, 100],
      [10, 90],
    ]);
    expect(ps[1].closed).toBe(false);
    expect(ps[1].pts[0]).toEqual([20, 80]);
    expect(ps[1].pts[1]).toEqual([30, 80]);
    expect(ps[1].pts).toHaveLength(2 + 4);
    expect(ps[1].pts[ps[1].pts.length - 1]).toEqual([50, 60]);
    expect([ps[1].x0, ps[1].y0, ps[1].x1, ps[1].y1]).toEqual([20, 60, 50, 80]);
  });

  it('reads rectangles, lines, circles and transformed groups from a page, upright and y downwards', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    page.drawRectangle({ x: 20, y: 200, width: 30, height: 20, borderWidth: 0.5, borderColor: rgb(0, 0, 0) });
    page.drawLine({ start: { x: 100, y: 100 }, end: { x: 160, y: 140 }, thickness: 2, color: rgb(0, 0, 0) });
    page.drawCircle({ x: 300, y: 50, size: 10, borderWidth: 1, borderColor: rgb(0, 0, 0) });
    page.drawRectangle({ x: 200, y: 200, width: 10, height: 10, color: rgb(0, 0, 0) }); // filled, no border
    // a group drawn at half scale, moved to (300, 200): a 20 × 20 square becomes 10 × 10 at (300, 200)
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(0.5, 0, 0, 0.5, 300, 200));
    page.drawRectangle({ x: 0, y: 0, width: 20, height: 20, borderWidth: 2, borderColor: rgb(0, 0, 0) });
    page.pushOperators(popGraphicsState());
    const { pages, pageCount } = await readPdfGeometry(await doc.save());
    expect(pageCount).toBe(1);
    const g = pages[0];
    expect([g.width, g.height]).toEqual([400, 300]);
    const rect = g.paths.find((p) => near(p.x0, 20) && near(p.x1, 50));
    expect(rect).toBeTruthy();
    // y downwards: the rectangle's top is at 300 - 220 = 80
    expect(near(rect!.y0, 80) && near(rect!.y1, 100)).toBe(true);
    expect(rect!.closed).toBe(true);
    expect(rect!.paint).toBe('stroke');
    expect(rect!.lineWidth).toBeCloseTo(0.5, 1);
    const line = g.paths.find((p) => p.pts.length === 2 && near(p.x0, 100));
    expect(line).toBeTruthy();
    expect(near(line!.pts[1][0], 160) && near(line!.pts[1][1], 160)).toBe(true);
    expect(line!.lineWidth).toBeCloseTo(2, 1);
    const circle = g.paths.find((p) => near(p.x0, 290) && near(p.x1, 310));
    expect(circle).toBeTruthy();
    expect(near(circle!.y0, 240) && near(circle!.y1, 260)).toBe(true);
    expect(circle!.pts.length).toBeGreaterThan(8);
    const filled = g.paths.find((p) => p.paint === 'fill');
    expect(filled).toBeTruthy();
    expect(near(filled!.x0, 200) && near(filled!.y0, 90)).toBe(true);
    expect(filled!.lineWidth).toBe(0);
    const scaled = g.paths.find((p) => near(p.x0, 300) && near(p.x1, 310));
    expect(scaled).toBeTruthy();
    expect(near(scaled!.y0, 90) && near(scaled!.y1, 100)).toBe(true);
    expect(scaled!.lineWidth).toBeCloseTo(1, 1); // 2 at half scale
  });

  it('a sheet stored rotated comes out upright, and `only` picks pages', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const page = doc.addPage([300, 400]); // portrait media box, displayed landscape
    page.setRotation(degrees(90));
    // in the unrotated frame: a rectangle near the bottom-left corner
    page.drawRectangle({ x: 10, y: 20, width: 30, height: 10, borderWidth: 1, borderColor: rgb(0, 0, 0) });
    const { pages, pageCount } = await readPdfGeometry(await doc.save(), [2]);
    expect(pageCount).toBe(2);
    expect(pages).toHaveLength(1);
    const g = pages[0];
    expect(g.page).toBe(2);
    expect([g.width, g.height]).toEqual([400, 300]);
    const rect = g.paths.find((p) => p.closed);
    expect(rect).toBeTruthy();
    // rotated 90° clockwise for display: x = y_pdf, y = x_pdf → the rectangle spans x 20..30, y 10..40
    expect(near(rect!.x0, 20) && near(rect!.x1, 30) && near(rect!.y0, 10) && near(rect!.y1, 40)).toBe(true);
  });
});
