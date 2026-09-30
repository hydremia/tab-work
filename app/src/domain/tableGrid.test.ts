/**
 * Schedules rebuilt from their grid lines: ruling lines found in a raster (rasterLines), words put in the cells
 * (tableGrid: title row, stacked and merged group headers, merged body cells, notes row, low-confidence cells), OCR
 * clean-up (ocrClean).
 */
import { describe, expect, it } from 'vitest';
import { EQUIPMENT_TYPES } from './equipmentTypes';
import { cleanOcrCell, cleanOcrWord } from './ocrClean';
import { findLines, type Gray, type HLine, type VLine } from './rasterLines';
import { gridTables, tableBoxes, type Word } from './tableGrid';

const KNOWN = EQUIPMENT_TYPES.map((t) => t.key);

/** A white raster with black lines drawn in (1-2 px), plus a solid block and some "text" specks. */
function raster(w: number, h: number, hs: HLine[], vs: VLine[]): Gray {
  const data = new Uint8Array(w * h).fill(255);
  for (const l of hs) for (let x = l.x0; x <= l.x1; x++) data[l.y * w + x] = 0;
  for (const l of vs) for (let y = l.y0; y <= l.y1; y++) data[y * w + l.x] = 0;
  // a filled rectangle (hatching / title block): too thick to be a line
  for (let y = 5; y < 25; y++) for (let x = 300; x < 380; x++) data[y * w + x] = 0;
  // short strokes (text): too short
  for (let x = 40; x < 50; x++) data[60 * w + x] = 0;
  return { width: w, height: h, data };
}

/**
 * A fan schedule: title row across the top, two header rows (a "ELECTRICAL" group header over HP and V-PH), three
 * data rows (one "REMOVE AND CAP" across the data columns), a notes row across the bottom.
 *   columns x: 10 | 60 | 140 | 200 | 240 | 290
 *   rows    y: 10 | 30 | 45 | 60 | 75 | 90 | 105 | 125
 */
const XS = [10, 60, 140, 200, 240, 290];
const YS = [10, 30, 45, 60, 75, 90, 105, 125];
function fanLines(): { h: HLine[]; v: VLine[] } {
  const h = YS.map((y) => ({ y, x0: XS[0], x1: XS[5] }));
  const v: VLine[] = [
    { x: XS[0], y0: YS[0], y1: YS[7] },
    { x: XS[5], y0: YS[0], y1: YS[7] },
    // inner lines: not through the title row (0) nor the notes row (6)
    { x: XS[1], y0: YS[1], y1: YS[6] },
    { x: XS[2], y0: YS[1], y1: YS[6] },
    // HP | V-PH split only below the "ELECTRICAL" group header row, and not in the REMOVE AND CAP row (5)
    { x: XS[3], y0: YS[2], y1: YS[5] },
    { x: XS[4], y0: YS[1], y1: YS[5] },
  ];
  return { h, v };
}
const w = (text: string, x0: number, y0: number, conf = 95): Word => ({
  text,
  x0,
  y0,
  x1: x0 + text.length * 4,
  y1: y0 + 8,
  conf,
});
function fanWords(): Word[] {
  return [
    w('FAN', 120, 16),
    w('SCHEDULE', 136, 16),
    w('UNIT', 14, 34),
    w('SERVICE', 64, 34),
    w('ELECTRICAL', 150, 34),
    w('CFM', 245, 34),
    w('NO.', 14, 49),
    w('HP', 145, 49),
    w('V-PH', 205, 49),
    w('EF-2', 14, 64),
    w('HOOD', 64, 64),
    w('H-2', 90, 64),
    w('1.50', 145, 64),
    w('460-3', 205, 64),
    w('2,300', 245, 64),
    w('EF-3', 14, 79),
    w('KITCHEN', 64, 79),
    w('0.5O', 145, 79, 41),
    w('115-1', 205, 79),
    w('1,200', 245, 79),
    w('EF-17', 14, 94),
    w('SIGN', 64, 94),
    w('ROOM', 88, 94),
    w('REMOVE', 150, 94),
    w('AND', 180, 94),
    w('CAP', 196, 94),
    w('NOTES:', 14, 110),
    w('PROVIDE', 44, 110),
    w('DISCONNECT.', 78, 110),
  ];
}

describe('ruling lines from a raster', () => {
  it('finds the grid lines; fills and text strokes are not lines', () => {
    const { h, v } = fanLines();
    const found = findLines(raster(400, 140, h, v), { minLength: 20 });
    expect(found.h.map((l) => l.y).sort((a, b) => a - b)).toEqual(YS);
    expect(found.v.map((l) => l.x).sort((a, b) => a - b)).toEqual([...XS.slice(0, 5), XS[5]].sort((a, b) => a - b));
    expect(found.h.every((l) => l.x0 === XS[0] && l.x1 === XS[5])).toBe(true);
  });

  it('lines that reach the edge of the image (a tight crop, a photo) count too', () => {
    const found = findLines(
      raster(
        100,
        60,
        [
          { y: 0, x0: 0, x1: 99 },
          { y: 59, x0: 0, x1: 99 },
        ],
        [{ x: 99, y0: 0, y1: 59 }],
      ),
      { minLength: 20 },
    );
    expect(found.h.map((l) => [l.y, l.x0, l.x1])).toEqual([
      [0, 0, 99],
      [59, 0, 99],
    ]);
    expect(found.v.map((l) => [l.x, l.y0, l.y1])).toEqual([[99, 0, 59]]);
  });
});

describe('schedule from its grid', () => {
  it('title row, stacked / group headers, rows by cell, merged body cell, notes left out', () => {
    const [t] = gridTables(fanLines(), fanWords(), KNOWN);
    expect(t.title).toBe('FAN SCHEDULE');
    expect(t.type).toBe('fan');
    expect(t.rows).toEqual([
      ['UNIT NO.', 'SERVICE', 'ELECTRICAL HP', 'ELECTRICAL V-PH', 'CFM'],
      ['EF-2', 'HOOD H-2', '1.50', '460-3', '2,300'],
      ['EF-3', 'KITCHEN', '0.5O', '115-1', '1,200'],
      ['EF-17', 'SIGN ROOM', 'REMOVE AND CAP', null, null],
    ]);
    // the unsure OCR word: body row 2 ("EF-3"), column 2
    expect(t.lowConfidence).toEqual([[2, 2]]);
  });

  it('a text-layer table (no confidence) and the table boxes for text recognition', () => {
    const words = fanWords().map(({ conf: _c, ...x }) => x);
    const [t] = gridTables(fanLines(), words, KNOWN);
    expect(t.lowConfidence).toEqual([]);
    expect(tableBoxes(fanLines())).toEqual([{ x0: XS[0], y0: YS[0], x1: XS[5], y1: YS[7] }]);
  });

  it('lines that do not form a grid (a border, a dimension line) are no table', () => {
    const lines = { h: [{ y: 10, x0: 0, x1: 100 }], v: [{ x: 0, y0: 0, y1: 50 }] };
    expect(gridTables(lines, fanWords(), KNOWN)).toEqual([]);
    expect(tableBoxes(lines)).toEqual([]);
  });
});

describe('text recognition clean-up', () => {
  it('dashes are blank, stray bars go, serif ones in model numbers, O in numbers', () => {
    expect(cleanOcrWord('-—')).toBe('-');
    expect(cleanOcrWord('RPM|')).toBe('RPM');
    expect(cleanOcrWord('DUI180HFA')).toBe('DU180HFA');
    expect(cleanOcrWord('CASREI13DD')).toBe('CASRE13DD');
    expect(cleanOcrWord('DRI12HFA')).toBe('DR12HFA');
    expect(cleanOcrWord('DUI80OHFA')).toBe('DU180HFA');
    expect(cleanOcrWord('DRI0OHFA')).toBe('DR10HFA');
    expect(cleanOcrWord('48GEHNO06B2P6-3U5A0')).toBe('48GEHN06B2P6-3U5A0');
    expect(cleanOcrWord('A2-D.250-20D')).toBe('A2-D.250-20D');
    expect(cleanOcrWord('48GERN24B2P6-3U5C0')).toBe('48GERN24B2P6-3U5C0');
    expect(cleanOcrWord('1O0')).toBe('100');
    expect(cleanOcrWord('HOOD')).toBe('HOOD');
    expect(cleanOcrWord('EF-12')).toBe('EF-12');
    expect(cleanOcrCell('— —')).toBeNull();
    expect(cleanOcrCell('460 - 3')).toBe('460 - 3');
  });
});
