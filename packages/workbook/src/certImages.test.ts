import JSZip from 'jszip';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CERT_PICTURE_NAMES, fitInBox, TEMPLATE_STAMP_NAME, type CertImage } from './certImages.js';
import { drawingPictures } from './coverPhoto.js';
import { exportWorkbookWithReport } from './exportWorkbook.js';
import { importWorkbook } from './importWorkbook.js';
import { attr, listSheets, parseRels, readText, relsPathFor, resolveTarget } from './ooxml.js';
import { TEMPLATE_MAP } from './templateMap.js';
import { templateBytes } from './testTemplate.js';
import type { ProjectData } from './types.js';

/** A valid w x h RGBA PNG (solid colour). */
function png(w: number, h: number, rgba = [200, 30, 30, 255]): CertImage {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(h * (1 + 4 * w));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgba, y * (1 + 4 * w) + 1 + 4 * x);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array()),
  ];
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
  }
  return { bytes, type: 'png', width: w, height: h };
}

const project: ProjectData = {
  templateRevision: TEMPLATE_MAP.revision,
  sections: { projectInfo: { fields: { projectName: 'Stamp test' } } },
  equipment: {},
};

async function certParts(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const sheet = (await listSheets(zip)).find((s) => s.name === 'Certification')!;
  const sheetXml = await readText(zip, sheet.part);
  const tag = /<drawing\b[^>]*\/>/.exec(sheetXml);
  if (!tag) return { zip, sheetXml, drawingXml: null, pictures: [], media: [] as string[] };
  const rel = parseRels(await readText(zip, relsPathFor(sheet.part))).find((r) => r.id === attr(tag[0], 'r:id'))!;
  const drawingPart = resolveTarget(sheet.part, rel.target);
  const drawingXml = await readText(zip, drawingPart);
  const drels = parseRels(await readText(zip, relsPathFor(drawingPart)));
  const pictures = drawingPictures(drawingXml);
  const media = pictures.map((p) => resolveTarget(drawingPart, drels.find((r) => r.id === p.embed)!.target));
  return { zip, sheetXml, drawingXml, pictures, media, drawingPart };
}

describe('stamp and signature on the Certification sheet', () => {
  it('places both pictures inside their boxes (the template stamp is replaced by the profile stamp)', async () => {
    const { bytes, report } = await exportWorkbookWithReport(templateBytes(), project, {
      certImages: { stamp: png(400, 400), signature: png(600, 150, [0, 0, 120, 255]) },
    });
    // revision 06 has its own stamp ("a2b NEBB Stamp") in the box: the profile's stamp replaces it
    expect(report.certImages).toMatchObject({ placed: ['stamp', 'signature'], removed: 1, createdDrawing: false });
    const c = await certParts(bytes);
    expect(c.pictures.map((p) => p.name)).toEqual([CERT_PICTURE_NAMES.stamp, CERT_PICTURE_NAMES.signature]);
    for (const m of c.media) expect(c.zip.file(m)).toBeTruthy();
    const ct = await readText(c.zip, '[Content_Types].xml');
    expect(ct).toMatch(/Extension="png"/);
    expect(ct).toContain(`PartName="/${c.drawingPart}"`);
    // the stamp stays in C51:G56 (cols 2..6, rows 50..55 zero-based), the signature in J51:L53
    const [stamp, sig] = c.pictures.map((p) => p.anchor!);
    expect(stamp.fromCol).toBeGreaterThanOrEqual(2);
    expect(stamp.toCol).toBeLessThanOrEqual(6);
    expect(stamp.fromRow).toBeGreaterThanOrEqual(50);
    expect(stamp.toRow).toBeLessThanOrEqual(55);
    expect(sig.fromCol).toBeGreaterThanOrEqual(9);
    expect(sig.toCol).toBeLessThanOrEqual(11);
    expect(sig.toRow).toBe(52); // sits on the signature line (bottom of row 53)
    // <drawing> comes before legacyDrawing etc. and the r namespace is declared
    expect(c.sheetXml).toMatch(/<worksheet\b[^>]*xmlns:r=/);
    expect(c.sheetXml.indexOf('<drawing ')).toBeLessThan(c.sheetXml.indexOf('</worksheet>'));
    expect(c.sheetXml).not.toMatch(/insert the stamp image here/);
    expect(c.sheetXml).toMatch(/<c r="C50" s="511"\/>/);
    // the workbook still imports
    const back = await importWorkbook(bytes);
    expect(back.sections.projectInfo?.fields?.projectName).toBe('Stamp test');
  });

  it('re-exporting onto an exported workbook replaces the pictures (no duplicates) and removes a dropped one', async () => {
    const first = await exportWorkbookWithReport(templateBytes(), project, {
      certImages: { stamp: png(400, 400), signature: png(600, 150) },
    });
    const before = await certParts(first.bytes);
    const { bytes, report } = await exportWorkbookWithReport(first.bytes, project, {
      certImages: { stamp: png(300, 200), signature: null },
    });
    expect(report.certImages).toMatchObject({ placed: ['stamp'], removed: 2, createdDrawing: false });
    const after = await certParts(bytes);
    expect(after.pictures.map((p) => p.name)).toEqual([CERT_PICTURE_NAMES.stamp]);
    for (const m of before.media) expect(after.zip.file(m)).toBeNull(); // old image parts gone
    expect((after.drawingXml!.match(/<xdr:twoCellAnchor/g) ?? []).length).toBe(1);
  });

  it('without images the template stamp stays; with certImages {} an earlier picture is removed', async () => {
    const plain = await exportWorkbookWithReport(templateBytes(), project, {});
    expect(plain.report.certImages).toBeUndefined();
    const none = await exportWorkbookWithReport(templateBytes(), project, { certImages: {} });
    expect(none.report.certImages).toMatchObject({ placed: [], removed: 0 });
    expect((await certParts(none.bytes)).pictures.map((p) => p.name)).toEqual([TEMPLATE_STAMP_NAME]);
    const stamped = await exportWorkbookWithReport(templateBytes(), project, { certImages: { stamp: png(10, 10) } });
    const cleared = await exportWorkbookWithReport(stamped.bytes, project, { certImages: {} });
    expect(cleared.report.certImages).toMatchObject({ removed: 1, placed: [] });
    expect((await certParts(cleared.bytes)).pictures).toHaveLength(0);
  });

  it('leaves a box that already holds a picture (a stamp inserted in Excel) alone, and skips an unusable image', async () => {
    const first = await exportWorkbookWithReport(templateBytes(), project, { certImages: { stamp: png(40, 40) } });
    // someone replaced our stamp by hand in Excel: the same box, another name
    const zip = await JSZip.loadAsync(first.bytes);
    const c = await certParts(first.bytes);
    await zip.file(c.drawingPart!, c.drawingXml!.replace(`name="${CERT_PICTURE_NAMES.stamp}"`, 'name="Picture 3"'));
    const edited = await zip.generateAsync({ type: 'uint8array' });
    const { bytes, report } = await exportWorkbookWithReport(edited, project, {
      certImages: { stamp: png(40, 40), signature: { ...png(10, 10), width: 0 } },
    });
    expect(report.certImages?.placed).toEqual([]);
    expect(report.certImages?.skipped.map((x) => x.kind).sort()).toEqual(['signature', 'stamp']);
    expect((await certParts(bytes)).pictures.map((p) => p.name)).toEqual(['Picture 3']);
  });

  it('fits keeping the aspect ratio: a wide signature is limited by the width, a tall stamp by the height', async () => {
    const zip = await JSZip.loadAsync(templateBytes());
    const sheet = (await listSheets(zip)).find((s) => s.name === 'Certification')!;
    const xml = await readText(zip, sheet.part);
    const wide = fitInBox(xml, TEMPLATE_MAP.certImages.signature, { width: 1000, height: 100 }, 'bottom', 1);
    expect(wide.cx / wide.cy).toBeCloseTo(10, 1);
    const tall = fitInBox(xml, TEMPLATE_MAP.certImages.stamp, { width: 100, height: 1000 }, 'centre');
    expect(tall.cx / tall.cy).toBeCloseTo(0.1, 2);
    // box C51:G56 is 6 rows x 13.35 pt; 3 pt padding top and bottom
    expect(tall.cy).toBe(Math.round((6 * 13.35 - 6) * 12700));
  });
});
