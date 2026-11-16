// @vitest-environment node
/**
 * Air device tags from a plan sheet: pages drawn with pdf-lib the two ways engineers tag outlets (stacked size / type
 * / CFM lines with "(TYP n)", and the hexagon type-over-CFM tag), read with pdf.js (workbook/pdfText.ts) and found by
 * planDevices(). Equipment marks, note callouts, duct labels and dimensions on the same sheet must not count.
 */
import { degrees, PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { readPdfText } from '../workbook/pdfText';
import { devicesCfm, planDevices } from './planDevices';

interface Stack {
  x: number;
  y: number;
  lines: string[];
  size?: number;
}

/** Centred lines, top to bottom, like a CAD tag (text written one line per item). */
function stack(page: PDFPage, font: PDFFont, s: Stack, rotate = false) {
  const size = s.size ?? 6;
  s.lines.forEach((t, i) => {
    const w = font.widthOfTextAtSize(t, size);
    const x = s.x - w / 2;
    const y = s.y - i * size * 1.25;
    if (!rotate) page.drawText(t, { x, y, size, font });
    else page.drawText(t, { x: page.getWidth() - y, y: x, size, font, rotate: degrees(90) });
  });
}

async function sheet(draw: (page: PDFPage, font: PDFFont) => void, opts: { rotate?: boolean } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = opts.rotate ? doc.addPage([400, 600]) : doc.addPage([600, 400]);
  if (opts.rotate) page.setRotation(degrees(90));
  draw(page, font);
  const { pages } = await readPdfText(await doc.save());
  return pages[0];
}

describe('air devices from a plan', () => {
  it('stacked tags: size / type / CFM in any order, (TYP n) multipliers, returns without CFM', async () => {
    const page = await sheet((p, f) => {
      stack(p, f, { x: 60, y: 350, lines: ['12"x8"', 'SR1', '290 CFM'] });
      stack(p, f, { x: 160, y: 350, lines: ['(TYP 5)', '12"x8"', 'SR1', '285 CFM'] });
      stack(p, f, { x: 260, y: 350, lines: ['SD1', '8"Ø', '200 CFM'] }); // type first
      stack(p, f, { x: 360, y: 350, lines: ['24"x16"', 'RG3'] }); // a return sized by the duct
      stack(p, f, { x: 460, y: 350, lines: ['10"Ø', 'EG-2', '250 CFM', '(TYP)'] }); // typical, uncounted
      stack(p, f, { x: 60, y: 250, lines: ['6"Ø', 'EG1', '75 CFM'] });
      // not devices: a heat pump mark over its number, duct labels, a plan note callout, a dimension, a thermostat
      stack(p, f, { x: 160, y: 250, lines: ['WSHP', '2'] });
      stack(p, f, { x: 260, y: 250, lines: ['12"x10" SA', 'BOD: 9\' - 9"'] });
      stack(p, f, { x: 360, y: 250, lines: ['7'] });
      stack(p, f, { x: 460, y: 250, lines: ['T', '2'] });
      stack(p, f, { x: 60, y: 150, lines: ['MD', '12"x8"'] }); // a damper with a size: no number in the mark
      p.drawText('MECHANICAL PLAN - LEVEL 1', { x: 40, y: 40, size: 14, font: f });
    });
    const r = planDevices(page);
    const byType = Object.fromEntries(r.types.map((t) => [t.type, t.count]));
    expect(byType).toEqual({ SR1: 6, SD1: 1, RG3: 1, 'EG-2': 1, EG1: 1 });
    expect(r.devices.map((d) => [d.type, d.size, d.cfm, d.count, d.typical])).toEqual(
      expect.arrayContaining([
        ['SR1', '12"x8"', 290, 1, false],
        ['SR1', '12"x8"', 285, 5, false],
        ['SD1', '8"Ø', 200, 1, false],
        ['RG3', '24"x16"', null, 1, false],
        ['EG-2', '10"Ø', 250, 1, true],
        ['EG1', '6"Ø', 75, 1, false],
      ]),
    );
    expect(r.devices).toHaveLength(6);
    expect(devicesCfm(r.devices)).toBe(290 + 5 * 285 + 200 + 250 + 75);
    // positions: the tag's centre, y downwards from the top of the page
    const sr = r.devices.find((d) => d.cfm === 290)!;
    expect(sr.x).toBeCloseTo(60, 0);
    expect(sr.y).toBeGreaterThan(40);
    expect(sr.y).toBeLessThan(70);
    expect(sr.lines).toEqual(['12"x8"', 'SR1', '290 CFM']);
  });

  it('hexagon tags: type over CFM; equipment and fan marks over small numbers are not devices', async () => {
    const page = await sheet((p, f) => {
      stack(p, f, { x: 60, y: 350, lines: ['S1', '565'] });
      stack(p, f, { x: 120, y: 350, lines: ['S4', '525'] });
      stack(p, f, { x: 180, y: 350, lines: ['R3', '2100'] });
      stack(p, f, { x: 240, y: 350, lines: ['E1', '75'] });
      stack(p, f, { x: 300, y: 350, lines: ['E2', '250'] });
      stack(p, f, { x: 360, y: 350, lines: ['CDF', '14'] }); // a ceiling fan: equipment prefix
      stack(p, f, { x: 420, y: 350, lines: ['RTU-1', '2'] });
      stack(p, f, { x: 480, y: 350, lines: ['FCU', '5'] });
      stack(p, f, { x: 540, y: 350, lines: ['EF-2', '250'] }); // a fan over a number is not a grille
      stack(p, f, { x: 60, y: 250, lines: ['ACR', '1'] });
      stack(p, f, { x: 120, y: 250, lines: ['S1'] }); // a type alone (the number was lost): not a device
      stack(p, f, { x: 180, y: 250, lines: ['9'] });
      p.drawText('600 CFM 12Ø', { x: 250, y: 250, size: 6, font: f }); // a duct label
    });
    const r = planDevices(page);
    expect(r.devices.map((d) => [d.type, d.size, d.cfm])).toEqual([
      ['S1', null, 565],
      ['S4', null, 525],
      ['R3', null, 2100],
      ['E1', null, 75],
      ['E2', null, 250],
    ]);
    // one device each: alphabetical
    expect(r.types.map((t) => t.type)).toEqual(['E1', 'E2', 'R3', 'S1', 'S4']);
  });

  it('the schedule’s types settle doubtful marks: known marks count, unknown ones need a size line', async () => {
    const page = await sheet((p, f) => {
      stack(p, f, { x: 60, y: 350, lines: ['CDF', '140'] }); // on this job CDF is a diffuser mark
      stack(p, f, { x: 160, y: 350, lines: ['XY', '140'] }); // not on the schedule, no size: left out
      stack(p, f, { x: 260, y: 350, lines: ['XY', '8"Ø', '140'] }); // a size line makes it a device
      stack(p, f, { x: 360, y: 350, lines: ['S1', '565'] });
    });
    const r = planDevices(page, ['CDF', 'S-1']);
    expect(r.devices.map((d) => [d.type, d.cfm, d.typeMatch])).toEqual([
      ['CDF', 140, 'known'],
      ['XY', 140, 'pattern'],
      ['S1', 565, 'known'],
    ]);
  });

  it('a sheet stored rotated reads the same', async () => {
    const page = await sheet(
      (p, f) => {
        stack(p, f, { x: 60, y: 350, lines: ['12"x8"', 'SR1', '290 CFM'] }, true);
        stack(p, f, { x: 160, y: 350, lines: ['S1', '565'] }, true);
      },
      { rotate: true },
    );
    const r = planDevices(page);
    expect(r.devices.map((d) => [d.type, d.cfm])).toEqual([
      ['SR1', 290],
      ['S1', 565],
    ]);
  });
});
