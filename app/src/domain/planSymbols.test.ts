// @vitest-environment node
/**
 * Devices placed on their symbols: a sheet drawn with pdf-lib the way plans are (a diffuser as a square with corner
 * diagonals built from separate lines, a leader with an arrowhead from the tag, "(TYP 3)" tags, a hexagon tag frame
 * with plotted strokes inside), read through pdf.js and placed by planSymbols.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { readPdfGeometry } from '../workbook/pdfGeometry';
import { readPdfText } from '../workbook/pdfText';
import { planDevices } from './planDevices';
import { glyphs, placeDevices, tagFrames } from './planSymbols';

const black = rgb(0, 0, 0);

/** An 18 × 18 diffuser symbol at (x, y) (its lower-left in PDF space): square + four corner diagonals, 8 lines. */
function diffuser(p: PDFPage, x: number, y: number) {
  const s = 18;
  const seg = (x0: number, y0: number, x1: number, y1: number) =>
    p.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: 0.4, color: black });
  seg(x, y, x + s, y);
  seg(x + s, y, x + s, y + s);
  seg(x + s, y + s, x, y + s);
  seg(x, y + s, x, y);
  seg(x, y, x + 5, y + 5);
  seg(x + s, y, x + s - 5, y + 5);
  seg(x, y + s, x + 5, y + s - 5);
  seg(x + s, y + s, x + s - 5, y + s - 5);
}

/** A register symbol: a 20 × 6 rectangle with two arrows (different signature from the diffuser). */
function register(p: PDFPage, x: number, y: number) {
  p.drawRectangle({ x, y, width: 20, height: 6, borderWidth: 0.4, borderColor: black });
  p.drawLine({ start: { x: x + 5, y: y + 6 }, end: { x: x + 5, y: y + 14 }, thickness: 0.4, color: black });
  p.drawLine({ start: { x: x + 15, y: y + 6 }, end: { x: x + 15, y: y + 14 }, thickness: 0.4, color: black });
  p.drawLine({ start: { x: x + 3, y: y + 11 }, end: { x: x + 5, y: y + 14 }, thickness: 0.4, color: black });
  p.drawLine({ start: { x: x + 13, y: y + 11 }, end: { x: x + 15, y: y + 14 }, thickness: 0.4, color: black });
}

function tag(p: PDFPage, f: PDFFont, x: number, y: number, lines: string[]) {
  lines.forEach((t, i) => {
    const w = f.widthOfTextAtSize(t, 6);
    p.drawText(t, { x: x - w / 2, y: y - i * 7.5, size: 6, font: f });
  });
}

function leader(p: PDFPage, from: [number, number], to: [number, number]) {
  p.drawLine({ start: { x: from[0], y: from[1] }, end: { x: to[0], y: to[1] }, thickness: 0.7, color: black });
  // arrowhead at the symbol end
  p.drawSvgPath('M 0 0 L -2 -4 L 2 -4 Z', { x: to[0], y: to[1], color: black, borderWidth: 0 });
}

async function sheet(draw: (p: PDFPage, f: PDFFont) => void) {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([800, 600]);
  draw(p, f);
  const bytes = await doc.save();
  const text = (await readPdfText(bytes.slice())).pages[0];
  const geo = (await readPdfGeometry(bytes)).pages[0];
  return { text, geo };
}

describe('planSymbols', () => {
  it('glyphs: small rectangles from separate lines or closed paths, signed by size and inner strokes', async () => {
    const { geo } = await sheet((p) => {
      diffuser(p, 100, 400);
      diffuser(p, 300, 400);
      register(p, 500, 400);
      // a long grid line nearby is not part of any glyph
      p.drawLine({ start: { x: 0, y: 390 }, end: { x: 800, y: 390 }, thickness: 0.2, color: black });
    });
    const gs = glyphs(geo.paths);
    expect(gs).toHaveLength(3);
    // the square from four separate lines, the four corner diagonals inside it
    const d = gs.filter((g) => g.sig === '18x18');
    expect(d.every((g) => g.strokes === 4)).toBe(true);
    expect(d).toHaveLength(2);
    expect(d[0].cx).toBeCloseTo(109, 0);
    expect(d[0].cy).toBeCloseTo(600 - 409, 0); // y downwards
    // the register: a closed rectangle, its arrows outside
    const r = gs.find((g) => g.sig === '20x6');
    expect(r).toBeTruthy();
    expect(Math.round(r!.cx)).toBe(510);
  });

  it('places tags on their symbols by leader, expands TYP n to the nearest same symbols, falls back to the tag', async () => {
    const { text, geo } = await sheet((p, f) => {
      // tag A with a leader to the diffuser at (100, 400)
      diffuser(p, 100, 400);
      tag(p, f, 160, 470, ['8"Ø', 'SD1', '200 CFM']);
      leader(p, [148, 462], [118, 418]);
      // tag B: (TYP 3) with a leader to the first of three registers in a row; a diffuser nearby must not be taken
      register(p, 300, 300);
      register(p, 340, 300);
      register(p, 380, 300);
      diffuser(p, 420, 290);
      tag(p, f, 300, 360, ['(TYP 3)', '12"x8"', 'SR1', '285 CFM']);
      leader(p, [300, 336], [310, 308]);
      // tag C: no leader; a diffuser 30 pt away takes it (the sheet's device symbol)
      diffuser(p, 600, 400);
      tag(p, f, 630, 450, ['10"Ø', 'SD2', '250 CFM']);
      // tag D: a lone tag far from any symbol keeps its own position
      tag(p, f, 700, 100, ['6"Ø', 'EG1', '75 CFM']);
    });
    const devs = planDevices(text).devices;
    expect(devs.map((d) => d.type).sort()).toEqual(['EG1', 'SD1', 'SD2', 'SR1']);
    const gs = glyphs(geo.paths);
    const placed = placeDevices(devs, geo.paths, gs);
    expect(placed).toHaveLength(6);
    const a = placed.find((x) => x.device.type === 'SD1')!;
    expect(a.how).toBe('leader');
    expect([Math.round(a.x), Math.round(a.y)]).toEqual([109, 600 - 409]);
    const b = placed.filter((x) => x.device.type === 'SR1').sort((x, y) => x.index - y.index);
    expect(b.map((x) => x.how)).toEqual(['leader', 'typ', 'typ']);
    expect(b.map((x) => Math.round(x.x)).sort((m, n) => m - n)).toEqual([310, 350, 390]);
    expect(b.every((x) => x.glyph!.sig === b[0].glyph!.sig)).toBe(true);
    const c = placed.find((x) => x.device.type === 'SD2')!;
    expect(c.how).toBe('nearest');
    expect(Math.round(c.x)).toBe(609);
    const d = placed.find((x) => x.device.type === 'EG1')!;
    expect(d.how).toBe('tag');
    expect(d.x).toBeCloseTo(700, 0);
  });

  it('tag frames: a hexagon with plotted strokes inside, not an empty one or a diffuser square', async () => {
    const { geo } = await sheet((p) => {
      // a hexagon 38 wide, 24 tall with a divider, and letter-like strokes inside
      const hex = (x: number, y: number, strokes: boolean) => {
        p.drawSvgPath('M 0 12 L 8 0 L 30 0 L 38 12 L 30 24 L 8 24 Z M 0 12 L 38 12', {
          x,
          y: y + 24,
          borderWidth: 1,
          borderColor: black,
        });
        if (strokes)
          for (let i = 0; i < 6; i++)
            p.drawLine({
              start: { x: x + 10 + i * 3, y: y + 3 },
              end: { x: x + 12 + i * 3, y: y + 10 },
              thickness: 1,
              color: black,
            });
      };
      hex(100, 400, true);
      hex(300, 400, false);
      diffuser(p, 500, 400);
    });
    const frames = tagFrames(geo.paths);
    expect(frames).toHaveLength(1);
    expect(Math.round(frames[0].x0)).toBe(100);
    expect(Math.round(frames[0].y0)).toBe(600 - 424);
  });
});
