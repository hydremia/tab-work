import { describe, expect, it } from 'vitest';
import { exportWorkbookWithReport, FormulaCellError, ValidationError } from './exportWorkbook.js';
import { diff, importWorkbook, normalizeProject } from './importWorkbook.js';
import { TEMPLATE_MAP } from './templateMap.js';
import type { ProjectData } from './types.js';
import { templateBytes } from './testTemplate.js';

const project: ProjectData = {
  templateRevision: TEMPLATE_MAP.revision,
  sections: {
    projectInfo: {
      fields: { projectName: 'Library test', address: '1 Main St', tabDate: '2026-09-15', reportDate: '2026-09-24' },
    },
    equipmentSummary: { fields: { tolerance: 0.1 } },
  },
  equipment: {
    rtu: [
      {
        slot: 1,
        schedule: { designation: 'RTU-1', manufacturer: 'Carrier', phase: '3-phase', designTotalCfm: 1000, hp: 'N/A' },
        fields: { driveType: 'Belt', serial: 'Not Avail.', volts1: 460, unitType: 'RTU' },
        tables: {
          supply: [{ no: 'S-1', area: 'Lobby', type: 'CD', size: '24x24', ak: 1, designCfm: 500, finalVel: 480 }],
        },
        lines: { remarks: ['First line', 'Second line'] },
      },
    ],
  },
};

describe('workbook library round trip (Node)', () => {
  it('export -> import returns the same project, only input cells written', async () => {
    const { bytes, report } = await exportWorkbookWithReport(templateBytes(), project);
    expect(report.changedParts.every((p) => p.startsWith('xl/worksheets/'))).toBe(true);
    const back = await importWorkbook(bytes);
    // the template's pre-loaded calibration instruments and building pressures come back too; compare what we wrote
    const { calibration: _c, buildingBalance: _b, ...sections } = back.sections;
    expect(diff(normalizeProject({ ...back, sections }), normalizeProject(project))).toEqual([]);
  });

  it('refuses to write into a formula cell', async () => {
    const bad: ProjectData = { ...project, equipment: { rtu: [{ slot: 1, tables: { return: [{ designCfm: 5 }] } }] } };
    const { report } = await exportWorkbookWithReport(templateBytes(), bad);
    expect(report.warnings.join('\n')).toMatch(/formula/); // omitted column -> warning, not a write
    const map = structuredClone(TEMPLATE_MAP) as typeof TEMPLATE_MAP;
    // point a field at a known formula cell (RTUs D+0 = System, from EDE)
    (map.equipment[0].block.fields as { key: string; col: string; row: number; type: string }[]).push({
      key: 'x',
      col: 'D',
      row: 0,
      type: 'text',
    });
    await expect(
      exportWorkbookWithReport(
        templateBytes(),
        { ...project, equipment: { rtu: [{ slot: 1, fields: { x: 'y' } }] } },
        { map },
      ),
    ).rejects.toBeInstanceOf(FormulaCellError);
  });

  it('rejects list values that are not in the template list', async () => {
    const bad: ProjectData = { ...project, equipment: { rtu: [{ slot: 1, fields: { driveType: 'Chain' } }] } };
    await expect(exportWorkbookWithReport(templateBytes(), bad)).rejects.toBeInstanceOf(ValidationError);
  });
});
