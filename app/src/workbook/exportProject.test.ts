// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import {
  exportWorkbookWithReport,
  importWorkbook,
  importWorkbookWithReport,
  listSheets,
  readText,
  TEMPLATE_07_FILE_NAME,
  TEMPLATE_FILE_NAME,
  TEMPLATE_MAP_07,
} from '@a2b/workbook';
import { describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { createRecord, setCertImage, setField, unlockProject, writeTables } from '../data/repo';
import type { Revision } from '../data/types';
import { sampleBundle } from '../test/fixtures';
import { toProjectData, type ProjectBundle } from './adapter';
import { toCertImage } from '../certification/images';
import { exportFileName, exportProject } from './exportProject';
import { applyReimport, parseWorkbook, prepareReview } from './importProject';
import { KEEP_REVISION_FILES, listRevisions, saveRevision, suggestLabel } from './revisions';

// a 1 x 1 transparent PNG
const PNG_1X1 = [
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66,
  96, 130,
];

const template = new Uint8Array(
  readFileSync(fileURLToPath(new URL(`../../../${TEMPLATE_FILE_NAME}`, import.meta.url))),
);

async function store(b: ProjectBundle): Promise<void> {
  await db.transaction('rw', writeTables(), async () => {
    await createRecord('projects', b.project);
    for (const e of b.equipment) await createRecord('equipment', e);
    for (const r of b.rows) await createRecord('airflowRows', r);
    for (const i of b.issues) await createRecord('issues', i);
    for (const i of b.instruments) await createRecord('instruments', i);
  });
}

async function editSheet(bytes: Uint8Array, sheet: string, edit: (xml: string) => string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const info = (await listSheets(zip)).find((s) => s.name === sheet)!;
  const before = await readText(zip, info.part);
  const after = edit(before);
  expect(after).not.toBe(before);
  zip.file(info.part, after);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
const sheetXml = async (bytes: Uint8Array, sheet: string) => {
  const zip = await JSZip.loadAsync(bytes);
  return readText(zip, (await listSheets(zip)).find((s) => s.name === sheet)!.part);
};
const cellTag = (xml: string, ref: string) =>
  new RegExp(`<c r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`).exec(xml)?.[0] ?? '';

describe('export revisions', () => {
  it('labels: Prelim, then Rev 1, Rev 2 ...; file name carries the label', () => {
    expect(suggestLabel([])).toBe('Prelim');
    expect(suggestLabel([{ kind: 'export', label: 'Prelim' }])).toBe('Rev 1');
    expect(
      suggestLabel([
        { kind: 'export', label: 'Prelim' },
        { kind: 'import', label: 'Imported' },
        { kind: 'export', label: 'Rev 3' },
      ]),
    ).toBe('Rev 4');
    expect(exportFileName('A/B Job', 'Rev 1', new Date(2026, 8, 24))).toBe(
      'A-B Job - TAB Report Rev 1 2026-09-24.xlsm',
    );
  });

  it(`keeps the file of the newest ${KEEP_REVISION_FILES} exports and the baseline values of all`, async () => {
    const rev = (i: number): Revision => ({
      id: `r${i}`,
      projectId: 'p',
      kind: 'export',
      label: `Rev ${i}`,
      createdAt: i,
      fileName: 'f.xlsm',
      size: 3,
      bytes: new Blob([new Uint8Array([1, 2, 3])]),
      baseline: { i },
      userId: 'local',
    });
    for (let i = 1; i <= KEEP_REVISION_FILES + 2; i++) await saveRevision(rev(i));
    const revs = await listRevisions('p');
    expect(revs.map((r) => [r.id, r.bytes !== null])).toEqual([
      ['r7', true],
      ['r6', true],
      ['r5', true],
      ['r4', true],
      ['r3', true],
      ['r2', false],
      ['r1', false],
    ]);
    expect(revs.every((r) => r.baseline !== null)).toBe(true);
  });

  it('first export: blank template, revision "Prelim" with the file, the baseline and the marker', async () => {
    const b = sampleBundle();
    await store(b);
    const r = await exportProject(b.project.id, { template });
    expect(r.baseFileName).toBeUndefined();
    expect(r.revision).toMatchObject({ kind: 'export', label: 'Prelim', onBase: false, size: r.bytes.length });
    const back = await importWorkbookWithReport(r.bytes);
    expect(back.marker).toMatchObject({ projectId: b.project.id, revisionId: r.revision.id, label: 'Prelim' });
    expect(r.revision.baseline).toEqual(back.project);
    const stored = (await db.revisions.get(r.revision.id))!;
    expect(stored.bytes?.size).toBe(r.bytes.length);
  });

  it('issue -> Excel edits -> re-import -> export onto it: formatting kept, removed values cleared, marker renewed', async () => {
    const b = sampleBundle();
    await store(b);
    const rtu = b.equipment.find((e) => e.type === 'rtu')!;
    const prelim = await exportProject(b.project.id, { template });
    // Excel: polish the RTU-1 remark (D52), restyle it, widen column D, a note in a label cell
    const issued = await editSheet(prelim.bytes, 'RTUs', (xml) =>
      xml
        .replace(
          /<c r="D52"([^>]*?) s="\d+"([^>]*)><is><t>Belt replaced.<\/t><\/is><\/c>/,
          '<c r="D52"$1 s="188"$2><is><t>Belt replaced (new A42 belt).</t></is></c>',
        )
        .replace(
          '<col width="6" customWidth="1" style="162" min="4" max="4"/>',
          '<col width="14.5" customWidth="1" style="162" min="4" max="4"/>',
        )
        .replace('<t>Serial Number</t>', '<t>Serial No. (verified)</t>'),
    );
    const parsed = await parseWorkbook(issued, 'Riverside - TAB Report Prelim.xlsm');
    const review = await prepareReview(b.project.id, parsed);
    expect(review.baseline.how).toBe('marker');
    expect(review.diff.items.map((i) => [i.cell, i.wb])).toEqual([
      ['remarks', 'Belt replaced (new A42 belt).\nSecond remark line.'],
    ]);
    await applyReimport(review, parsed, {});
    expect((await db.baseWorkbooks.get(b.project.id))?.size).toBe(issued.length);

    // meanwhile a value is removed in the app
    await setField('equipment', rtu.id, 'data.serial', null);
    const rev1 = await exportProject(b.project.id, { template });
    expect(rev1.revision.label).toBe('Rev 1');
    expect(rev1.baseFileName).toBe('Riverside - TAB Report Prelim.xlsm');
    expect(rev1.revision.onBase).toBe(true);
    const xml = await sheetXml(rev1.bytes, 'RTUs');
    expect(cellTag(xml, 'D52')).toContain('s="188"');
    expect(cellTag(xml, 'D52')).toContain('Belt replaced (new A42 belt).');
    expect(xml).toContain('<col width="14.5" customWidth="1" style="162" min="4" max="4"/>');
    expect(cellTag(xml, 'B10')).toContain('Serial No. (verified)');
    const back = await importWorkbookWithReport(rev1.bytes);
    expect(back.marker?.revisionId).toBe(rev1.revision.id);
    const u = back.project.equipment.rtu.find((x) => x.slot === 1)!;
    expect(u.fields?.serial).toBeUndefined(); // cleared
    expect(u.lines?.remarks).toEqual(['Belt replaced (new A42 belt).', 'Second remark line.']);
    const vba = async (x: Uint8Array) => (await JSZip.loadAsync(x)).file('xl/vbaProject.bin')!.async('uint8array');
    expect(await vba(rev1.bytes)).toEqual(await vba(template));
  });

  it("the certification profile's stamp and signature go on every export, once, also onto an issued workbook", async () => {
    const b = sampleBundle();
    await store(b);
    const png = 'data:image/png;base64,' + btoa(String.fromCharCode(...PNG_1X1));
    await setCertImage('stamp', { dataUrl: png, width: 600, height: 600, type: 'png' });
    await setCertImage('signature', { dataUrl: png, width: 800, height: 200, type: 'png' });
    const prelim = await exportProject(b.project.id, { template });
    const pictures = async (bytes: Uint8Array) => {
      const zip = await JSZip.loadAsync(bytes);
      const names: string[] = [];
      for (const f of Object.keys(zip.files).filter((n) => /^xl\/drawings\/drawing\d+\.xml$/.test(n)))
        for (const m of (await readText(zip, f)).matchAll(/<xdr:cNvPr\b[^>]*name="(TAB App [^"]+)"/g)) names.push(m[1]);
      return names.sort();
    };
    expect(await pictures(prelim.bytes)).toEqual(['TAB App Signature', 'TAB App Stamp']);
    expect(await sheetXml(prelim.bytes, 'Certification')).not.toContain('insert the stamp image here');
    // issued -> re-imported -> exported onto it: still one of each; the stamp removed from the profile -> gone
    const parsed = await parseWorkbook(prelim.bytes, 'Riverside - TAB Report Prelim.xlsm');
    await applyReimport(await prepareReview(b.project.id, parsed), parsed, {});
    const rev1 = await exportProject(b.project.id, { template });
    expect(rev1.revision.onBase).toBe(true);
    expect(await pictures(rev1.bytes)).toEqual(['TAB App Signature', 'TAB App Stamp']);
    await setCertImage('stamp', null);
    const rev2 = await exportProject(b.project.id, { template });
    expect(await pictures(rev2.bytes)).toEqual(['TAB App Signature']);
  });

  it('a damaged image from another device is ignored instead of breaking the export', async () => {
    const ok = { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 10, height: 10, type: 'png' as const };
    expect(toCertImage(ok)?.bytes.length).toBeGreaterThan(0);
    expect(toCertImage({ ...ok, dataUrl: 'data:image/png;base64,***' })).toBeNull();
    expect(toCertImage({ ...ok, width: 0 })).toBeNull();
    expect(toCertImage({ ...ok, type: 'gif' as never })).toBeNull();
    expect(toCertImage(null)).toBeNull();
    const b = sampleBundle();
    await store(b);
    await setCertImage('stamp', { ...ok, dataUrl: 'not a data url' });
    const r = await exportProject(b.project.id, { template });
    expect(r.bytes.length).toBeGreaterThan(0);
  });

  it('Issue report: exports the revision (marked issued) and locks the project at it; re-import is blocked', async () => {
    const b = sampleBundle();
    await store(b);
    const rtu = b.equipment.find((e) => e.type === 'rtu')!;
    const r = await exportProject(b.project.id, { template, label: 'Prelim', issue: true });
    expect(r.revision).toMatchObject({ label: 'Prelim', issued: true });
    const lock = (await db.projects.get(b.project.id))?.lock;
    expect(lock).toMatchObject({ label: 'Prelim', revisionId: r.revision.id, userId: 'local' });
    await expect(setField('equipment', rtu.id, 'data.serial', 'X')).rejects.toThrow(/issued as Prelim/);
    const parsed = await parseWorkbook(r.bytes, 'issued.xlsm');
    await expect(prepareReview(b.project.id, parsed)).rejects.toMatchObject({ name: 'LockedError' });
    const kinds = (await db.history.where('projectId').equals(b.project.id).toArray())
      .sort((x, y) => x.ts - y.ts)
      .map((h) => h.kind)
      .slice(-2);
    expect(kinds).toEqual(['revision', 'lock']);
    // unlocked for follow-up: the next suggestion is Rev 1 and the re-import review opens again
    await unlockProject(b.project.id);
    expect(suggestLabel(await listRevisions(b.project.id))).toBe('Rev 1');
    expect((await prepareReview(b.project.id, parsed)).diff.items).toEqual([]);
  });

  it('a revision 07 base (an issued rev 07 report): the export moves the project to revision 08, with a warning', async () => {
    const b = sampleBundle();
    await store(b);
    const rev07 = new Uint8Array(
      readFileSync(fileURLToPath(new URL(`../../../${TEMPLATE_07_FILE_NAME}`, import.meta.url))),
    );
    const { data } = toProjectData(b, 'air', TEMPLATE_MAP_07);
    const old = (await exportWorkbookWithReport(rev07, data, { map: TEMPLATE_MAP_07 })).bytes;
    await db.baseWorkbooks.put({
      projectId: b.project.id,
      blob: new Blob([old as BlobPart]),
      fileName: 'issued-rev07.xlsm',
      size: old.length,
      importedAt: 1,
      fromRevisionId: null,
    });
    const r = await exportProject(b.project.id, { template });
    expect(r.baseFileName).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(
      /issued-rev07\.xlsm is a revision 07 workbook: this export moves the project to revision 08/,
    );
    const back = await importWorkbook(r.bytes);
    expect(back.templateRevision).toBe('08');
    // RTU-1 positions in revision 08: Filter, Coil, Reheat, Fan, Heat
    expect(back.equipment.rtu[0].fields).toMatchObject({ spLeaving1: -0.55, spLeaving2: -1.05, spLeaving5: 0.72 });
  });

  it('a base that is no longer a copy of its revision: blank template, with a warning', async () => {
    const b = sampleBundle();
    await store(b);
    const prelim = await exportProject(b.project.id, { template });
    const broken = await editSheet(prelim.bytes, 'RTUs', (xml) =>
      xml.replace(/<c r="M10"([^>]*?)><f>[^<]*<\/f><v><\/v><\/c>/, '<c r="M10"$1/>'),
    );
    await db.baseWorkbooks.put({
      projectId: b.project.id,
      blob: new Blob([broken as BlobPart]),
      fileName: 'old.xlsm',
      size: broken.length,
      importedAt: 1,
      fromRevisionId: null,
    });
    const r = await exportProject(b.project.id, { template });
    expect(r.baseFileName).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/not a revision 08 workbook.*M10/);
    expect((await importWorkbook(r.bytes)).equipment.rtu.length).toBeGreaterThan(0);
  });
});
