// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { diff, exportWorkbookWithReport, importWorkbook, normalizeProject, TEMPLATE_FILE_NAME } from '@a2b/workbook';
import { describe, expect, it } from 'vitest';
import { sampleBundle } from '../test/fixtures';
import { fromProjectData, toProjectData, type ProjectBundle } from './adapter';

const template = () =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../${TEMPLATE_FILE_NAME}`, import.meta.url))));

describe('toProjectData', () => {
  const { data, warnings } = toProjectData(sampleBundle());
  const rtu = data.equipment.rtu[0];

  it('maps project information, narrative, tolerance, blueprints and N/A marks', () => {
    expect(warnings).toEqual([]);
    expect(data.sections.projectInfo.fields).toMatchObject({
      projectName: 'Riverside Medical Office',
      address: '1450 Riverside Dr, Sacramento, CA',
      electricalEngineer: 'N/A',
      tabDate: '2026-09-15',
    });
    expect(data.sections.projectInfo.tables?.blueprints).toEqual([
      { sheet: 'M-101 Floor plan', revisionDate: '2026-06-12' },
    ]);
    expect(data.sections.narrative.fields?.text).toContain('±10 %');
    expect(data.sections.equipmentSummary.fields?.tolerance).toBe(0.1);
  });

  it('routes unit fields to the schedule row or the unit block by template key', () => {
    expect(rtu.slot).toBe(1);
    expect(rtu.schedule).toMatchObject({
      designation: 'RTU-1',
      manufacturer: 'Carrier',
      phase: '3-phase',
      designTotalCfm: 1000,
    });
    expect(rtu.fields).toMatchObject({ driveType: 'Belt', serial: '4719G', fla: 'Not Avail.', unitType: 'RTU' });
    expect(rtu.fields).not.toHaveProperty('hasVfd'); // app-only
    expect(rtu.fields).toMatchObject({ vsdFinal: 'N/A' }); // automatic N/A is written as "N/A" (blank never means N/A)
    expect(rtu.lines?.remarks).toEqual(['Belt replaced.', 'Second remark line.']);
    expect(rtu.tables?.supply).toHaveLength(2);
    expect(rtu.tables?.oa?.[0]).toMatchObject({ no: 'OA-1', finalVel: 'Not Acc.' });
  });

  it('writes section-level N/A marks as their notation and automatic N/A as "N/A"', () => {
    const b = sampleBundle();
    const unit = b.equipment[0];
    unit.naState.sections.drive = { notation: 'Not Acc.' };
    for (const k of ['motorSheave', 'fanPulley', 'belts', 'cToC', 'sheaveBore']) delete unit.data[k];
    const u = toProjectData(b).data.equipment.rtu[0];
    expect(u.schedule).toMatchObject({ motorSheave: 'Not Acc.', belts: 'Not Acc.' });
    expect(u.fields).toMatchObject({ sheaveBore: 'Not Acc.' });
    unit.naState.sections = {};
    unit.data.driveType = 'Direct';
    const d = toProjectData(b).data.equipment.rtu[0];
    expect(d.schedule).toMatchObject({ belts: 'N/A', motorSheave: 'N/A' });
  });

  it('writes scope-profile N/A (Airflow Only) as "N/A" in the unit fields, not blanks', () => {
    const b = sampleBundle();
    b.project.scopeProfile = 'airflow';
    const unit = b.equipment[0];
    delete unit.data.serial;
    delete unit.data.frame;
    const u = toProjectData(b).data.equipment.rtu[0];
    expect(u.fields).toMatchObject({ serial: 'N/A', frame: 'N/A' });
  });

  it('numbers issues separately and prefixes the linked designation', () => {
    expect(data.sections.issuesNew.tables?.issues).toEqual([
      { no: 1, status: 'Closed', remark: 'RTU-1: belt worn; replaced during TAB.' },
      { no: 2, status: 'Open', remark: 'Ceiling access blocked at corridor.' },
    ]);
    expect(data.sections.issuesExisting.tables?.issues?.[0]).toMatchObject({
      no: 1,
      remark: 'VAV-101: damper actuator seized.',
    });
  });

  it('coerces numeric text and warns about text in number fields', () => {
    const b = sampleBundle();
    b.equipment[0].data.hp = '5';
    b.equipment[0].data.fanRpm = 'about 1000';
    const r = toProjectData(b);
    expect(r.data.equipment.rtu[0].schedule?.hp).toBe(5);
    expect(r.data.equipment.rtu[0].schedule).not.toHaveProperty('fanRpm');
    expect(r.warnings[0]).toMatch(/fanRpm: "about 1000" is not a number/);
  });
});

describe('round trip: app project -> export (rev 05 template) -> import -> app project', () => {
  it('comes back equal', async () => {
    const original = sampleBundle();
    const { data } = toProjectData(original);
    const { bytes, report } = await exportWorkbookWithReport(template(), data);
    expect(report.warnings).toEqual([expect.stringMatching(/revisionDate\) has no date number format/)]); // known template quirk (spike README)
    const imported = await importWorkbook(bytes);
    // 1. workbook level: everything written is read back (Building Balance keeps the template's own
    //    pre-filled pressure labels: the app does not manage that sheet yet)
    const { buildingBalance: _bb, ...importedSections } = imported.sections;
    expect(diff(normalizeProject({ ...imported, sections: importedSections }), normalizeProject(data))).toEqual([]);
    // 2. app level
    let i = 0;
    const back: ProjectBundle = fromProjectData(imported, { newId: () => `id-${++i}`, now: 1 });
    const byTypeSlot = (a: { type: string; slot: number }, b: { type: string; slot: number }) =>
      a.type.localeCompare(b.type) || a.slot - b.slot;
    original.equipment.sort(byTypeSlot);
    back.equipment.sort(byTypeSlot);
    expect(back.project).toMatchObject({
      name: original.project.name,
      tolerance: 0.1,
      info: original.project.info,
      blueprints: original.project.blueprints,
    });
    expect(back.project.naState.fields).toEqual(original.project.naState.fields);
    expect(back.equipment.map((e) => [e.type, e.slot, e.designation])).toEqual(
      original.equipment.map((e) => [e.type, e.slot, e.designation]),
    );
    for (const [a, b] of original.equipment.map((e, k) => [e, back.equipment[k]] as const)) {
      // app-only answers are not in the workbook: "Has filters?" is derived back from the filter text,
      // "Has VFD?" = Yes only when a VSD frequency was recorded
      const { hasVfd: _v1, ...bd } = b.data;
      const { hasVfd: _v2, ...ad } = a.data;
      expect(bd).toEqual(ad);
      expect(b.naState.fields).toEqual(a.naState.fields);
      const rowsOf = (bundle: ProjectBundle, id: string) =>
        bundle.rows
          .filter((r) => r.equipmentId === id)
          .sort((x, y) => x.table.localeCompare(y.table) || x.order - y.order)
          .map((r) => ({ table: r.table, order: r.order, data: r.data, na: r.na }));
      expect(rowsOf(back, b.id)).toEqual(rowsOf(original, a.id));
    }
    const issueView = (bundle: ProjectBundle) =>
      bundle.issues.map((x) => ({
        kind: x.kind,
        number: x.number,
        remark: x.remark,
        status: x.status,
        eq: bundle.equipment.find((e) => e.id === x.equipmentId)?.designation ?? null,
      }));
    expect(issueView(back)).toEqual(issueView(original));
    expect(
      back.instruments.map(({ type, manufacturer, model, serial, calibrationDate }) => ({
        type,
        manufacturer,
        model,
        serial,
        calibrationDate,
      })),
    ).toEqual(
      original.instruments.map(({ type, manufacturer, model, serial, calibrationDate }) => ({
        type,
        manufacturer,
        model,
        serial,
        calibrationDate,
      })),
    );
    // 3. and the re-exported workbook data is identical
    expect(diff(normalizeProject(toProjectData(back).data), normalizeProject(data))).toEqual([]);
  });
});
