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

  it('leaves the leaving static of an absent component blank (the strip passes the entering static through)', () => {
    const b = sampleBundle();
    const u = toProjectData(b).data.equipment.rtu[0];
    // RTU: component 2 is "—"; an "N/A" there would reach the coil's entering static and blank its ΔP
    expect(u.fields).not.toHaveProperty('spLeaving2');
    expect(u.fields).toMatchObject({ spEntering: -0.35, spLeaving1: -0.55, spLeaving5: 0.72 });
    // no filters: the filter's leaving static is left blank too; the filter text itself is still "N/A"
    b.equipment[0].data.hasFilters = 'No';
    delete b.equipment[0].data.spLeaving1;
    delete b.equipment[0].data.filters;
    const nf = toProjectData(b).data.equipment.rtu[0];
    expect(nf.fields).not.toHaveProperty('spLeaving1');
    expect(nf.fields).toMatchObject({ filters: 'N/A' });
    // an explicit mark on a component that applies is still written (rev 05 then blanks the downstream ΔP)
    b.equipment[0].naState.fields.spLeaving3 = { notation: 'Not Acc.' };
    delete b.equipment[0].data.spLeaving3;
    expect(toProjectData(b).data.equipment.rtu[0].fields).toMatchObject({ spLeaving3: 'Not Acc.' });
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

describe('toProjectData: MAU, ERV, fans, small fans, hoods, traverses', () => {
  const { data, warnings } = toProjectData(sampleBundle());
  const unitOf = (type: string, slot: number) => data.equipment[type].find((u) => u.slot === slot)!;

  it('exports without warnings', () => expect(warnings).toEqual([]));

  it('MAU PSP: velocities as a sequence (per-reading notation), unchosen methods written as N/A', () => {
    const m = unitOf('mau', 1);
    expect(m.fields).toMatchObject({
      method: 'PSP',
      pspLength: 96,
      pspWidth: 12,
      profileHousing: 'N/A',
      profilePressure: 'N/A',
    });
    expect(m.sequences?.pspVelocities).toHaveLength(20);
    expect(m.sequences?.pspVelocities?.[6]).toBe('Not Acc.');
    expect(m.columnTables?.filterGrid).toEqual([{ size: 'N/A' }]); // an N/A table: its notation in the first cell
    expect(m.tables?.supply).toBeUndefined(); // optional with PSP, no rows
  });

  it('MAU filter grid rows become the column table; values of a method switched away from are not exported', () => {
    expect(unitOf('mau', 2).columnTables?.filterGrid).toEqual([
      { size: '16" x 20"', velocity: 400 },
      { size: '12" x 24"', velocity: 300 },
      { size: '16" x 20"', velocity: 'Not Avail.' },
    ]);
    const b = sampleBundle();
    const mau2 = b.equipment.find((e) => e.designation === 'MAU-2')!;
    mau2.data.method = 'PSP';
    mau2.data.pspLength = 90;
    const u = toProjectData(b).data.equipment.mau.find((x) => x.slot === 2)!;
    expect(u.columnTables?.filterGrid).toEqual([{ size: 'N/A' }]);
    mau2.data.method = 'Filter Grid';
    expect(toProjectData(b).data.equipment.mau.find((x) => x.slot === 2)!.fields).toMatchObject({ pspLength: 'N/A' });
  });

  it('ERV: design supply / exhaust CFM and ΔP in the schedule, both tables, exhaust instrument', () => {
    const e = unitOf('erv', 1);
    expect(e.schedule).toMatchObject({ designSupplyCfm: 1000, designExhaustCfm: 950, designExhaustDp: 'N/A' });
    expect(e.fields).toMatchObject({ supplyDpActual: 0.33, exhaustInstrument: 'Flow Hood', unitType: 'ERV' });
    expect(e.tables?.exhaust?.[1]).toMatchObject({ no: 'E-2', ak: 'Not Avail.' });
  });

  it('hoods: filter rows with VelGrid readings 2-3 and No Filter readings written as N/A; remarks by page position', () => {
    const h1 = unitOf('hood', 1);
    expect(h1.tables?.filters?.[0]).toEqual({
      size: '16" x 20"',
      init1: 170,
      init2: 'N/A',
      init3: 'N/A',
      final1: 177,
      final2: 'N/A',
      final3: 'N/A',
    });
    expect(h1.lines).toEqual({
      technicianNotes: ['Grease filters cleaned before test.'],
      remarks: ['Hood balanced.', 'Lights out on the left side.'],
    });
    const h2 = unitOf('hood', 2);
    expect(h2.tables?.filters?.[2]).toMatchObject({ size: 'No Filter', final1: 'N/A', init1: 'N/A' });
    expect(h2.tables?.filters?.[1]).toMatchObject({ final3: 'Not Acc.' });
  });

  it('traverses: point label in the block, readings in quick-entry order, height N/A for round', () => {
    const t1 = unitOf('traverse', 1);
    expect(t1.schedule).toBeUndefined();
    expect(t1.fields).toMatchObject({ designation: 'T-1', shape: 'Rectangular', width: 24 });
    expect(t1.sequences?.readings?.slice(0, 3)).toEqual([480, 'N/A', 488]);
    expect(unitOf('traverse', 2).fields).toMatchObject({ height: 'N/A' });
    expect(unitOf('traverse', 3).sequences).toBeUndefined(); // initial only: the grid is optional
    expect(unitOf('traverse', 3).lines).toBeUndefined();
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
