import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { exportWorkbookWithReport } from './exportWorkbook.js';
import { listSheets, readText } from './ooxml.js';
import { emptyPageBreaks, paginate, printSettings, sheetLayout } from './pagination.js';
import { TEMPLATE_MAP } from './templateMap.js';
import { templateBytes } from './testTemplate.js';
import type { ProjectData } from './types.js';

const outlet = (no: string, design: number, vel: number) => ({
  no,
  area: 'Area',
  ak: 1,
  designCfm: design,
  finalVel: vel,
});
const units = (prefix: string, n: number, extra: () => object = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({ slot: i + 1, schedule: { designation: `${prefix}-${i + 1}` }, ...extra() }));

/** The CAP report's shape: 4 RTUs and 18 fans with page 1 only, 5 MAUs with PSP readings on page 2, 8 hoods. */
const cap = (): ProjectData => ({
  templateRevision: TEMPLATE_MAP.revision,
  sections: {
    issuesNew: {
      tables: { issues: [{ no: 1, remark: 'RTU-2: VFD held at 48 Hz.', status: 'Closed', comments: 'Resolved.' }] },
    },
  },
  equipment: {
    rtu: units('RTU', 4, () => ({ tables: { supply: [outlet('1', 8000, 7932)] } })),
    mau: units('MAU', 5, () => ({
      fields: { pspLength: 216, pspBlanks: 2 },
      sequences: { pspVelocities: [129, 133, 147] },
    })),
    fan: units('EF', 18, () => ({ tables: { outlets: [outlet('1', 600, 560)] } })),
    hood: units('H', 8),
  },
});

async function open(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const wb = await readText(zip, 'xl/workbook.xml');
  const sheets = await listSheets(zip);
  const sheet = async (name: string) => {
    const s = sheets.find((x) => x.name === name)!;
    return { s, xml: await readText(zip, s.part) };
  };
  return { zip, wb, sheet };
}

describe('printed layout at export (no empty pages, ToC page numbers)', () => {
  it('removes the breaks of empty continuation pages; every unit prints the pages it fills', async () => {
    const { bytes, report } = await exportWorkbookWithReport(templateBytes(), cap(), { hideUnused: true });
    const { wb, sheet } = await open(bytes);
    for (const name of ['RTUs', 'MAUs', 'Fans']) {
      const { s, xml } = await sheet(name);
      const ps = printSettings(wb, s.index);
      // no manual break is left whose page holds no visible row (Excel would print a title-only page)
      expect(emptyPageBreaks(sheetLayout(xml), ps.area!)).toEqual([]);
    }
    const pages = Object.fromEntries(report.layout!.pages.map((p) => [p.sheet, p.pages]));
    expect(pages).toMatchObject({ RTUs: 4, MAUs: 10, Fans: 18, Hoods: 4, 'Summary - New': 1, 'Equipment Summary': 1 });
    expect(pages['Summary - (E)']).toBeUndefined(); // no existing equipment, nothing on it: hidden
    expect(report.layout!.breaksRemoved).toBeGreaterThanOrEqual(22);
  });

  it('writes the ToC page numbers and hides the entries of sections that print nothing', async () => {
    const { bytes, report } = await exportWorkbookWithReport(templateBytes(), cap(), { hideUnused: true });
    const { sheet } = await open(bytes);
    const { xml } = await sheet('ToC');
    const text = (ref: string) =>
      /<t[^>]*>([^<]*)<\/t>/.exec(
        new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*>([\\s\\S]*?)</c>`).exec(xml)?.[1] ?? '',
      )?.[1];
    // cover 1, ToC 2, Narrative 3, Summary - New 4, Equipment Summary 5, Building Balance 6, RTUs 7-10, MAUs 11-20,
    // Fans 21-38, Hoods 39-42, Certification 43, NEBB Cert 44-45, NEBB Frm Cert 46, Abbreviations 47, Calibration 48
    expect(['K10', 'K13', 'K16', 'K19', 'K22', 'K28', 'K31', 'K37', 'K40', 'K43'].map(text)).toEqual([
      'page 2',
      'page 3',
      'page 5',
      'page 7',
      'page 11',
      'page 21',
      'page 39',
      'page 43',
      'page 47',
      'page 48',
    ]);
    const hidden = new Set([...xml.matchAll(/<row\b[^>]*?\br="(\d+)"[^>]*?\bhidden="1"/g)].map((m) => Number(m[1])));
    // ERVs (25-27), Traverses (34-36), Floorplans (46-48), Site Photos (49-51)
    expect([25, 26, 27, 34, 35, 36, 46, 47, 48, 49, 50].every((r) => hidden.has(r))).toBe(true);
    expect([10, 13, 19, 22, 28, 31, 37, 40, 43].some((r) => hidden.has(r))).toBe(false);
    expect(report.layout!.toc.find((t) => t.label === 'Energy Recovery Units')?.page).toBeNull();
  });

  it('keeps the Summary deficiencies to their first page, and to the rows in use past it', async () => {
    const p = cap();
    const { bytes } = await exportWorkbookWithReport(templateBytes(), p, { hideUnused: true });
    const { wb, sheet } = await open(bytes);
    const { s, xml } = await sheet('Summary - New');
    const ps = printSettings(wb, s.index);
    expect(paginate(sheetLayout(xml), ps.area!, ps.titles)).toHaveLength(1);
    // 40 deficiencies run onto a second page: rows through the 40th (row 52) shown, the rest hidden
    p.sections.issuesNew.tables!.issues = Array.from({ length: 40 }, (_, i) => ({
      no: i + 1,
      remark: `Item ${i + 1}`,
      status: 'Open',
    }));
    const again = await open((await exportWorkbookWithReport(templateBytes(), p, { hideUnused: true })).bytes);
    const x = (await again.sheet('Summary - New')).xml;
    const hidden = new Set([...x.matchAll(/<row\b[^>]*?\br="(\d+)"[^>]*?\bhidden="1"/g)].map((m) => Number(m[1])));
    expect(hidden.has(52)).toBe(false);
    expect([53, 62].every((r) => hidden.has(r))).toBe(true);
    expect(paginate(sheetLayout(x), printSettings(again.wb, s.index).area!, ps.titles)).toHaveLength(2);
  });

  it('shows Summary - (E) when the project has existing equipment', async () => {
    const p = cap();
    (p.equipment.rtu[0] as { existing?: boolean }).existing = true;
    const { report } = await exportWorkbookWithReport(templateBytes(), p, { hideUnused: true });
    expect(report.layout!.pages.find((x) => x.sheet === 'Summary - (E)')?.pages).toBe(1);
  });

  it("clears the template's yellow fill on the Hoods' linked cells", async () => {
    const { bytes } = await exportWorkbookWithReport(templateBytes(), cap(), { hideUnused: true });
    const { zip, sheet } = await open(bytes);
    const styles = await readText(zip, 'xl/styles.xml');
    const fills = [.../<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(styles)![1].matchAll(/<fill\b[\s\S]*?<\/fill>/g)].map(
      (m) => m[0],
    );
    const xfs = [
      .../<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)![1].matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g),
    ].map((m) => m[0]);
    expect(Number(/<cellXfs\b[^>]*count="(\d+)"/.exec(styles)![1])).toBe(xfs.length);
    const { xml } = await sheet('Hoods');
    for (const ref of ['E8', 'E9', 'E13', 'E14', 'E29']) {
      const s = Number(new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*\\bs="(\\d+)"`).exec(xml)![1]);
      const fill = fills[Number(/fillId="(\d+)"/.exec(xfs[s])![1])];
      expect(fill).not.toMatch(/FFFFFF00/i);
    }
  });

  it('centres every printed sheet horizontally (the cover sat left of centre)', async () => {
    const { bytes } = await exportWorkbookWithReport(templateBytes(), cap(), { hideUnused: true });
    const { sheet } = await open(bytes);
    for (const name of ['Cover Page', 'Certification', 'RTUs', 'Hoods']) {
      const { xml } = await sheet(name);
      expect(xml).toMatch(/<printOptions horizontalCentered="1"\/><pageMargins/);
    }
  });

  it('writes a TAB date range as text in the Date cell', async () => {
    const p = cap();
    p.sections.projectInfo = { fields: { tabDate: '10/2-5/26' } };
    const { bytes } = await exportWorkbookWithReport(templateBytes(), p, { hideUnused: true });
    const { xml } = await (await open(bytes)).sheet('{Project Information}');
    expect(xml).toMatch(/<c r="E11"[^>]*t="inlineStr"[^>]*><is><t>10\/2-5\/26<\/t><\/is><\/c>/);
  });
});
