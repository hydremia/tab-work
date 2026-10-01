import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { exportWorkbook } from './exportWorkbook.js';
import { TEMPLATE_MAP } from './templateMap.js';
import { templateBytes } from './testTemplate.js';
import type { ProjectData } from './types.js';

const unit = (type: string, n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ slot: i + 1, schedule: { designation: `${prefix}-${i + 1}` } }));

async function areas(p: ProjectData): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(await exportWorkbook(templateBytes(), p));
  const wb = await zip.file('xl/workbook.xml')!.async('string');
  return Object.fromEntries(
    [...wb.matchAll(/<definedName\b[^>]*name="_xlnm\.Print_Area"[^>]*>'?([^'!]+)'?!([^<]+)</g)].map((m) => [
      m[1],
      m[2],
    ]),
  );
}

describe('print areas fitted to the units', () => {
  it('each unit sheet prints through the page of its last unit', async () => {
    const a = await areas({
      templateRevision: TEMPLATE_MAP.revision,
      sections: {},
      equipment: {
        hood: unit('hood', 8, 'H'),
        rtu: unit('rtu', 6, 'RTU'),
        vav: unit('vav', 3, 'VAV'),
        traverse: Array.from({ length: 4 }, (_, i) => ({ slot: i + 1, fields: {} })),
      },
    });
    expect(a.Hoods).toBe('$A$1:$N$199'); // two hoods a page: H-7 / H-8 on page 4 (rows 151-199)
    expect(a.RTUs).toBe('$A$1:$N$627'); // RTU-6's continuation page
    expect(a.VAVs).toBe('$A$1:$N$107'); // VAV-3 on page 2
    expect(a.Traverses).toBe('$A$1:$M$101'); // three a page: T-4 on page 2
    expect(a.MAUs).toBe('$A$1:$N$107'); // none: the first unit's two pages, like Print Report
    expect(a.Narrative).toBe('$A$1:$M$41'); // other sheets untouched
  });
});
