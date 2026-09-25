/**
 * Export onto a previously issued workbook (F1), the revision marker, and the template compatibility check.
 * "Excel edits" are simulated with raw XML changes on the exported file (Excel itself is not available here).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { checkTemplateCompatibility } from './compat.js';
import { readCustomProperties, readRevisionMarker } from './docProps.js';
import { exportWorkbookWithReport } from './exportWorkbook.js';
import { diff, importWorkbook, importWorkbookWithReport, normalizeProject } from './importWorkbook.js';
import { listSheets, parseCells, readText } from './ooxml.js';
import { TEMPLATE_MAP } from './templateMap.js';
import { templateBytes } from './testTemplate.js';
import type { ProjectData } from './types.js';

const APP_SECTIONS = ['projectInfo', 'narrative', 'issuesNew', 'issuesExisting', 'calibration', 'equipmentSummary'];

const full = (): ProjectData => ({
  templateRevision: TEMPLATE_MAP.revision,
  sections: {
    projectInfo: {
      fields: { projectName: 'Base test', address: '1 Main St', architect: 'Lionakis', tabDate: '2026-09-15' },
      tables: { blueprints: [{ sheet: 'M-101', revisionDate: '2026-06-12' }, { sheet: 'M-102' }] },
    },
    narrative: { fields: { text: 'Two RTUs.' } },
    issuesNew: {
      tables: {
        issues: [
          { no: 1, remark: 'RTU-1: belt worn', status: 'Open' },
          { no: 2, remark: 'Door', status: 'Closed' },
        ],
      },
    },
    calibration: {
      tables: {
        instruments: [
          { type: 'Flow Hood', manufacturer: 'TSI', model: '6200', serial: 'A1', calibrationDate: '2026-01-02' },
        ],
      },
    },
    equipmentSummary: { fields: { tolerance: 0.1 } },
  },
  equipment: {
    rtu: [
      {
        slot: 1,
        schedule: { designation: 'RTU-1', manufacturer: 'Carrier', designTotalCfm: 1000 },
        fields: { serial: '4719G', volts1: 460, amps1: 3.9, unitType: 'RTU', driveType: 'Belt' },
        tables: {
          supply: [
            { no: 'S-1', area: 'Lobby', type: 'CD', size: '24x24', ak: 1, designCfm: 500, finalVel: 505 },
            { no: 'S-2', area: 'Lobby', type: 'CD', size: '24x24', ak: 1, designCfm: 500, finalVel: 470 },
          ],
        },
        lines: { remarks: ['First line', 'Second line'] },
      },
      { slot: 2, schedule: { designation: 'RTU-2', manufacturer: 'Trane' }, fields: { unitType: 'RTU', serial: 'X9' } },
    ],
  },
});

async function sheetXml(bytes: Uint8Array, sheet: string): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const info = (await listSheets(zip)).find((s) => s.name === sheet)!;
  return readText(zip, info.part);
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

const cellTag = (xml: string, ref: string) =>
  new RegExp(`<c r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`).exec(xml)?.[0] ?? '';

/**
 * Simulate how Excel stores a saved workbook: every inline string becomes a shared string (xl/sharedStrings.xml),
 * formulas get cached values, and a calculation chain part is added.
 */
async function excelLikeSave(bytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const sst: string[] = [];
  const index = new Map<string, number>();
  for (const s of await listSheets(zip)) {
    const xml = await readText(zip, s.part);
    const out = xml
      .replace(
        /<c\b([^>]*?)\st="inlineStr"([^>]*)><is>([\s\S]*?)<\/is><\/c>/g,
        (_m, a: string, b: string, is: string) => {
          const text = [...is.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('');
          if (!index.has(text)) {
            index.set(text, sst.length);
            sst.push(text);
          }
          return `<c${a} t="s"${b}><v>${index.get(text)}</v></c>`;
        },
      )
      .replace(/(<f>[^<]*<\/f>)<v><\/v>/g, '$1<v>0</v>');
    zip.file(s.part, out);
  }
  zip.file(
    'xl/sharedStrings.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sst.length}" uniqueCount="${sst.length}">${sst.map((t) => `<si><t xml:space="preserve">${t}</t></si>`).join('')}</sst>`,
  );
  zip.file(
    'xl/calcChain.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="D2" i="11"/></calcChain>',
  );
  const rels = await readText(zip, 'xl/_rels/workbook.xml.rels');
  zip.file(
    'xl/_rels/workbook.xml.rels',
    rels.replace(
      '</Relationships>',
      '<Relationship Id="rId900" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
        '<Relationship Id="rId901" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>',
    ),
  );
  const ct = await readText(zip, '[Content_Types].xml');
  zip.file(
    '[Content_Types].xml',
    ct.replace(
      '</Types>',
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
        '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>',
    ),
  );
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

const reset = { template: templateBytes(), sections: APP_SECTIONS };
const values = async (bytes: Uint8Array) => normalizeProject(await importWorkbook(bytes));

describe('revision marker (custom document properties)', () => {
  it('is written only when asked, touching docProps/custom.xml, _rels/.rels and [Content_Types].xml only', async () => {
    const plain = await exportWorkbookWithReport(templateBytes(), full());
    expect(plain.report.addedParts).toEqual([]);
    expect(await readRevisionMarker(await JSZip.loadAsync(plain.bytes))).toBeNull();

    const marker = { projectId: 'p-1', revisionId: 'r-1', label: 'Prelim', exportedAt: '2026-09-24T10:00:00Z' };
    const { bytes, report } = await exportWorkbookWithReport(templateBytes(), full(), { marker });
    expect(report.addedParts).toEqual(['docProps/custom.xml']);
    expect(report.changedParts.filter((p) => !p.startsWith('xl/worksheets/')).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
    ]);
    const back = await importWorkbookWithReport(bytes);
    expect(back.marker).toEqual(marker);
    const vba = async (b: Uint8Array) => (await JSZip.loadAsync(b)).file('xl/vbaProject.bin')!.async('uint8array');
    expect(await vba(bytes)).toEqual(await vba(templateBytes()));
  });

  it('is replaced on the next export onto the same file, other custom properties kept', async () => {
    const first = await exportWorkbookWithReport(templateBytes(), full(), {
      marker: { projectId: 'p-1', revisionId: 'r-1' },
    });
    // someone adds their own custom property in Excel
    const zip = await JSZip.loadAsync(first.bytes);
    const xml = await zip.file('docProps/custom.xml')!.async('string');
    zip.file(
      'docProps/custom.xml',
      xml.replace(
        '</Properties>',
        '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="9" name="Checked by"><vt:lpwstr>PM</vt:lpwstr></property></Properties>',
      ),
    );
    const edited = await zip.generateAsync({ type: 'uint8array' });
    const second = await exportWorkbookWithReport(edited, full(), {
      marker: { projectId: 'p-1', revisionId: 'r-2', label: 'Rev 1' },
      reset,
    });
    const z2 = await JSZip.loadAsync(second.bytes);
    expect(await readRevisionMarker(z2)).toEqual({ projectId: 'p-1', revisionId: 'r-2', label: 'Rev 1' });
    const props = await readCustomProperties(z2);
    expect(props['Checked by']).toBe('PM');
    expect(Object.keys(props).filter((k) => k.startsWith('a2bTab.'))).toHaveLength(3);
    // no duplicate relationship / content type
    expect((await readText(z2, '_rels/.rels')).match(/custom-properties/g)).toHaveLength(1);
    expect((await readText(z2, '[Content_Types].xml')).match(/docProps\/custom\.xml/g)).toHaveLength(1);
  });
});

describe('export onto a previously issued workbook', () => {
  it('clears values removed in the app (value only, the cell style is kept) and restores unused blocks', async () => {
    const issued = (await exportWorkbookWithReport(templateBytes(), full())).bytes;
    const next = full();
    const rtu1 = next.equipment.rtu[0];
    delete rtu1.fields!.serial;
    rtu1.tables!.supply = [rtu1.tables!.supply[0]];
    rtu1.lines!.remarks = ['First line'];
    next.equipment.rtu = [rtu1]; // RTU-2 deleted in the app
    delete next.sections.narrative;
    delete next.sections.projectInfo.fields!.architect;
    next.sections.issuesNew.tables!.issues = [next.sections.issuesNew.tables!.issues[0]];

    const { bytes } = await exportWorkbookWithReport(issued, next, { reset });
    const onTemplate = (await exportWorkbookWithReport(templateBytes(), next)).bytes;
    // the same values as a first export of the same project
    expect(diff(await values(bytes), await values(onTemplate))).toEqual([]);
    const back = await importWorkbook(bytes);
    expect(back.equipment.rtu).toHaveLength(1);
    expect(back.equipment.rtu[0].fields?.serial).toBeUndefined();
    expect(back.equipment.rtu[0].tables?.supply).toHaveLength(1);
    expect(back.sections.narrative).toBeUndefined();
    // the architect is cleared (as a first export clears the template's placeholder)
    const pi = await sheetXml(bytes, '{Project Information}');
    expect(cellTag(pi, 'E4')).toBe(cellTag(await sheetXml(onTemplate, '{Project Information}'), 'E4'));
    expect(cellTag(pi, 'E4')).not.toContain('Lionakis');
    // cleared cells keep their style
    const rtus = await sheetXml(bytes, 'RTUs');
    const tRtus = await sheetXml(templateBytes(), 'RTUs');
    expect(cellTag(rtus, 'D10')).toBe('<c r="D10" s="204"/>');
    expect(cellTag(tRtus, 'D10')).toContain('s="204"');
  });

  it('keeps hand formatting: cell styles, column widths, row heights, text in non-input cells', async () => {
    const issued = (await exportWorkbookWithReport(templateBytes(), full())).bytes;
    // "Excel edits": restyle the remark cell (input) and a label, widen column D, a taller row, a note typed in a label
    const edited = await editSheet(issued, 'RTUs', (xml) =>
      xml
        .replace(/(<c r="D52" s=")\d+(")/, '$1188$2')
        .replace(/(<c r="B10" s=")\d+(")/, '$1153$2')
        .replace(
          '<col width="6" customWidth="1" style="162" min="4" max="4"/>',
          '<col width="14.5" customWidth="1" style="162" min="4" max="4"/>',
        )
        .replace('<row r="52" ht="13.35"', '<row r="52" ht="30"')
        .replace('<t>Serial Number</t>', '<t>Serial No. (checked)</t>'),
    );
    const next = full();
    next.equipment.rtu[0].lines!.remarks = ['Polished first line', 'Second line'];
    next.equipment.rtu[0].fields!.amps1 = 4.2;
    const { bytes } = await exportWorkbookWithReport(edited, next, { reset });
    const xml = await sheetXml(bytes, 'RTUs');
    expect(cellTag(xml, 'D52')).toMatch(
      /^<c r="D52" s="188" t="inlineStr"><is><t>Polished first line<\/t><\/is><\/c>$/,
    );
    expect(cellTag(xml, 'B10')).toContain('s="153"');
    expect(cellTag(xml, 'B10')).toContain('Serial No. (checked)');
    expect(xml).toContain('<col width="14.5" customWidth="1" style="162" min="4" max="4"/>');
    expect(xml).toContain('<row r="52" ht="30"');
    expect((await importWorkbook(bytes)).equipment.rtu[0].fields?.amps1).toBe(4.2);
  });

  it('writes into an Excel-style save (shared strings, cached values, calcChain) and removes the stale calcChain', async () => {
    const issued = await excelLikeSave(
      (await exportWorkbookWithReport(templateBytes(), full(), { marker: { projectId: 'p', revisionId: 'r' } })).bytes,
    );
    expect(
      diff(await values(issued), normalizeProject(full())).filter(
        (d) => !/calibration|buildingBalance|certification/.test(d),
      ),
    ).toEqual([]);
    const next = full();
    next.equipment.rtu[0].fields!.driveType = 'Direct'; // a list value: checked against the {Dropdowns} (shared strings)
    const { bytes, report } = await exportWorkbookWithReport(issued, next, {
      reset,
      marker: { projectId: 'p', revisionId: 'r2' },
    });
    expect(report.removedParts).toContain('xl/calcChain.xml');
    const zip = await JSZip.loadAsync(bytes);
    expect(await readText(zip, 'xl/_rels/workbook.xml.rels')).not.toContain('calcChain');
    expect(await readText(zip, '[Content_Types].xml')).not.toContain('calcChain');
    expect(
      diff(await values(bytes), await values((await exportWorkbookWithReport(templateBytes(), next)).bytes)),
    ).toEqual([]);
    expect((await importWorkbookWithReport(bytes)).marker?.revisionId).toBe('r2');
  });

  it('overwrites an input cell someone turned into a formula, but never a template formula', async () => {
    const issued = (await exportWorkbookWithReport(templateBytes(), full())).bytes;
    const edited = await editSheet(issued, 'RTUs', (xml) =>
      xml.replace(/<c r="E19"([^>]*?)>[\s\S]*?<\/c>/, '<c r="E19"$1><f>2*230</f><v></v></c>'),
    );
    expect(parseCells(await sheetXml(edited, 'RTUs')).get('E19')?.formula).toBe('2*230');
    const { bytes } = await exportWorkbookWithReport(edited, full(), { reset });
    const e19 = parseCells(await sheetXml(bytes, 'RTUs')).get('E19');
    expect(e19?.formula).toBeUndefined();
    expect(e19?.v).toBe('460');
    // a template formula cell is still protected
    const d2 = parseCells(await sheetXml(bytes, 'RTUs')).get('D2');
    expect(d2?.formula).toContain('{Project Information}');
  });
});

describe('template compatibility of a base workbook', () => {
  it('accepts the template and an exported (and "Excel-saved") workbook', async () => {
    expect(await checkTemplateCompatibility(templateBytes(), templateBytes())).toEqual({ ok: true, problems: [] });
    const exported = (await exportWorkbookWithReport(templateBytes(), full())).bytes;
    expect((await checkTemplateCompatibility(await excelLikeSave(exported), templateBytes())).ok).toBe(true);
  });

  it('rejects a workbook with a deleted row (formulas moved) and a file that is not a workbook', async () => {
    const exported = (await exportWorkbookWithReport(templateBytes(), full())).bytes;
    const broken = await editSheet(exported, 'RTUs', (xml) =>
      xml.replace(/<c r="M10"([^>]*?)><f>[^<]*<\/f><v><\/v><\/c>/, '<c r="M10"$1/>'),
    );
    const r = await checkTemplateCompatibility(broken, templateBytes());
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/RTUs: 1 formula cell.*M10/);
    expect((await checkTemplateCompatibility(new Uint8Array([1, 2, 3]), templateBytes())).ok).toBe(false);
  });

  const rev04 = fileURLToPath(new URL('../../../04 - a2b_Blank_TAB_Workbook 9-18-26.xlsm', import.meta.url));
  it.skipIf(!existsSync(rev04))('rejects revision 04 (same layout, formulas without the N/A guards)', async () => {
    const r = await checkTemplateCompatibility(new Uint8Array(readFileSync(rev04)), templateBytes());
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/N\/A-safe/);
  });
});
