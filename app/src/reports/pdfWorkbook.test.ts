import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATE_FILE_NAME } from '@a2b/workbook';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { workbookForPdf } from './pdfWorkbook';

// the committed template at the repository root (public/templates is a build-time copy, absent in CI)
const template = () =>
  new Uint8Array(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', TEMPLATE_FILE_NAME)));

describe('workbook for the Graph PDF conversion', () => {
  it('drops the VBA project with its relationship and content type, hides the {…} sheets, keeps everything else', async () => {
    const before = await JSZip.loadAsync(template());
    const r = await workbookForPdf(template());
    expect(r.vbaRemoved).toBe(true);
    expect(r.hidden).toEqual(['{Project Information}', '{Equipment Data Entry}', '{Dropdowns}']);
    const after = await JSZip.loadAsync(r.bytes);
    expect(after.file('xl/vbaProject.bin')).toBeNull();
    const ct = await after.file('[Content_Types].xml')!.async('string');
    expect(ct).not.toMatch(/vba/i);
    expect(ct).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml');
    const rels = await after.file('xl/_rels/workbook.xml.rels')!.async('string');
    expect(rels).not.toMatch(/vbaProject/);
    const wb = await after.file('xl/workbook.xml')!.async('string');
    const sheets = [...wb.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => m[0]);
    expect(sheets).toHaveLength(24);
    const state = (name: string) => /\bstate="([^"]*)"/.exec(sheets.find((s) => s.includes(`name="${name}"`))!)![1];
    expect(state('Cover Page')).toBe('visible');
    expect(state('RTUs')).toBe('visible');
    expect(state('{Project Information}')).toBe('hidden');
    expect(state('{Equipment Data Entry}')).toBe('hidden');
    expect(state('Photos')).toBe('hidden');
    expect(wb).toMatch(/activeTab="0"/);
    // every other part is byte-identical
    const changed = ['[Content_Types].xml', 'xl/_rels/workbook.xml.rels', 'xl/workbook.xml', 'xl/vbaProject.bin'];
    const names = Object.keys(before.files).filter((p) => !before.files[p].dir);
    expect(Object.keys(after.files).filter((p) => !after.files[p].dir)).toHaveLength(names.length - 1);
    for (const p of names) {
      if (changed.includes(p)) continue;
      const a = await before.file(p)!.async('nodebuffer');
      const b = await after.file(p)!.async('nodebuffer');
      expect(a.equals(b), p).toBe(true);
    }
  });

  it('a workbook without VBA passes through with only the data-entry sheets hidden', async () => {
    const r1 = await workbookForPdf(template());
    const r2 = await workbookForPdf(r1.bytes);
    expect(r2.vbaRemoved).toBe(false);
    expect(r2.hidden).toEqual(r1.hidden);
  });
});
