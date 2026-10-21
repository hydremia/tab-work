import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { applyToleranceColors, percentCells, sqrefOf } from './toleranceColors.js';

const pct = (row: number) =>
  `<c r="M${row}"><f>IF(OR(H${row}="",H${row}=0),"",IF(K${row}="",IF(J${row}="","",J${row}/H${row}),K${row}/H${row}))</f></c>`;
const SHEET = `<worksheet><sheetData><row r="30">${pct(30)}</row><row r="31">${pct(31)}</row><row r="32">${pct(32)}</row></sheetData><pageMargins left="0.7"/></worksheet>`;
const PART = 'xl/worksheets/sheet1.xml';

async function zipWith(sheet = SHEET) {
  const zip = new JSZip();
  zip.file(PART, sheet);
  zip.file('xl/styles.xml', '<styleSheet><tableStyles count="0"/></styleSheet>');
  return zip;
}
const blocks = (xml: string) => [...xml.matchAll(/<conditionalFormatting sqref="([^"]+)">([\s\S]*?)<\/conditionalFormatting>/g)];

describe('tolerance colours', () => {
  it('finds the % of design cells by their formulas', () => {
    expect(percentCells(SHEET)).toEqual(['M30', 'M31', 'M32']);
    expect(sqrefOf(['M30', 'M31', 'M32', 'M40'])).toBe('M30:M32 M40');
  });

  it('good / bad rules on every % cell; nothing neutral without accepted rows', async () => {
    const zip = await zipWith();
    expect(await applyToleranceColors(zip, [{ part: PART }], 0.1)).toBe(3);
    const xml = await zip.file(PART)!.async('string');
    const b = blocks(xml);
    expect(b).toHaveLength(1);
    expect(b[0][1]).toBe('M30:M32');
    expect(b[0][2]).toContain('ABS(M30-1)&lt;=0.1');
    expect(b[0][2]).toContain('ABS(M30-1)&gt;0.1');
    const styles = await zip.file('xl/styles.xml')!.async('string');
    expect(styles.match(/<dxf>/g)).toHaveLength(2);
    expect(styles).not.toContain('FFEB9C');
  });

  it('accepted rows get the neutral style instead of red (green inside the tolerance as usual); re-runs replace', async () => {
    const zip = await zipWith();
    const accepted = new Map([[PART, new Set([31])]]);
    expect(await applyToleranceColors(zip, [{ part: PART }], 0.1, undefined, accepted)).toBe(3);
    let xml = await zip.file(PART)!.async('string');
    let b = blocks(xml);
    expect(b.map((m) => m[1])).toEqual(['M30 M32', 'M31']);
    const styles = await zip.file('xl/styles.xml')!.async('string');
    const dxfs = [...styles.matchAll(/<dxf>[\s\S]*?<\/dxf>/g)].map((m) => m[0]);
    expect(dxfs).toHaveLength(3);
    const neutralId = dxfs.findIndex((d) => d.includes('FFEB9C'));
    expect(neutralId).toBe(2);
    // the accepted block: good inside, neutral outside; the others: good inside, bad outside
    expect(b[1][2]).toContain(`dxfId="${neutralId}"`);
    expect(b[1][2]).toContain('ABS(M31-1)&gt;0.1');
    expect(b[1][2]).toContain('dxfId="0"');
    expect(b[0][2]).toContain('dxfId="1"');
    expect(b[0][2]).not.toContain(`dxfId="${neutralId}"`);
    // priorities do not collide
    const prios = [...xml.matchAll(/priority="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(prios).size).toBe(prios.length);
    // a second export (nothing accepted any more) replaces both blocks with one
    expect(await applyToleranceColors(zip, [{ part: PART }], 0.1)).toBe(3);
    xml = await zip.file(PART)!.async('string');
    b = blocks(xml);
    expect(b.map((m) => m[1])).toEqual(['M30:M32']);
  });
});
