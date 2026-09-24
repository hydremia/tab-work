// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { importWorkbook, importWorkbookWithReport, listSheets, readText, TEMPLATE_FILE_NAME } from '@a2b/workbook';
import { describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { createRecord, setField, unlockProject, writeTables } from '../data/repo';
import type { Revision } from '../data/types';
import { sampleBundle } from '../test/fixtures';
import type { ProjectBundle } from './adapter';
import { exportFileName, exportProject } from './exportProject';
import { applyReimport, parseWorkbook, prepareReview } from './importProject';
import { KEEP_REVISION_FILES, listRevisions, saveRevision, suggestLabel } from './revisions';

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

  it('a base that is no longer a revision-05 workbook: blank template, with a warning', async () => {
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
    expect(r.warnings.join(' ')).toMatch(/not a revision 05 workbook.*M10/);
    expect((await importWorkbook(r.bytes)).equipment.rtu.length).toBeGreaterThan(0);
  });
});
