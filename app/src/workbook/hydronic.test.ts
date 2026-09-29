// @vitest-environment node
/**
 * Hydronic units in the app: completion (auto N/A, tolerance), and the hydronic workbook export: app records ->
 * toProjectData(…, 'hydronic') -> the H01 template -> read back with the hydronic map. The airside export leaves the
 * hydronic units out and vice versa; issues follow their unit's report.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  exportWorkbookWithReport,
  HYDRONIC_MAP,
  HYDRONIC_TEMPLATE_FILE_NAME,
  importWorkbook,
  TEMPLATE_FILE_NAME,
} from '@a2b/workbook';
import { describe, expect, it } from 'vitest';
import { emptyNaState, type AirflowRow, type Equipment } from '../data/types';
import { computeCompletion } from '../domain/completion';
import { getSpec } from '../domain/specs';
import { sampleBundle } from '../test/fixtures';
import { toProjectData, type ProjectBundle } from './adapter';

const hydronicTemplate = new Uint8Array(
  readFileSync(fileURLToPath(new URL(`../../../${HYDRONIC_TEMPLATE_FILE_NAME}`, import.meta.url))),
);
const airTemplate = new Uint8Array(
  readFileSync(fileURLToPath(new URL(`../../../${TEMPLATE_FILE_NAME}`, import.meta.url))),
);

let n = 900;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const now = 1_790_000_000_000;
function unit(
  projectId: string,
  type: Equipment['type'],
  slot: number,
  designation: string,
  data: Equipment['data'],
): Equipment {
  return {
    id: id(),
    projectId,
    type,
    designation,
    slot,
    isExisting: false,
    data,
    naState: emptyNaState(),
    createdAt: now,
    updatedAt: now,
  };
}
function valve(projectId: string, equipmentId: string, order: number, data: AirflowRow['data']): AirflowRow {
  return { id: id(), projectId, equipmentId, table: 'valves', order, data, na: {}, createdAt: now, updatedAt: now };
}

function hydronicBundle(): ProjectBundle {
  const b = sampleBundle();
  const pid = b.project.id;
  const pump = unit(pid, 'pump', 1, 'P-1', {
    service: 'Chilled Water',
    system: 'CHW',
    location: 'Mech room',
    manufacturer: 'B&G',
    model: 'e-1510 3BC',
    pumpType: 'VFD',
    designGpm: 200,
    designHead: 60,
    hp: 7.5,
    rpm: 1750,
    voltage: 460,
    phase: '3-phase',
    serial: 'S123',
    flowMethod: 'Pump curve',
    actualGpm: 190,
    finalSuction: 9,
    finalDischarge: 35,
  });
  const sys = unit(pid, 'valveSystem', 1, 'CHW', {
    service: 'Chilled Water',
    vfdSetpoint: '12 psi',
    dpUnits: 'ft w.g.',
  });
  const chiller = unit(pid, 'plant', 1, 'CH-1', {
    plantType: 'Chiller (water-cooled)',
    circuit1: 'Evaporator',
    designGpm1: 240,
    actualGpm1: 228,
    circuit2: 'Condenser',
    designGpm2: 300,
    actualGpm2: 250,
  });
  const reading = unit(pid, 'flowMeasurement', 1, 'U-1', { system: 'CHW', designGpm: 200, measuredGpm: 210 });
  b.equipment.push(pump, sys, chiller, reading);
  b.rows.push(
    valve(pid, sys.id, 1, {
      no: '1',
      tag: 'CBV-1',
      serves: 'FCU-1',
      makeModel: 'B&G CB-1',
      size: '1"',
      type: 'A',
      designGpm: 10,
      finalGpm: 11,
    }),
    valve(pid, sys.id, 2, { no: '2', tag: 'CBV-2', serves: 'FCU-2', designGpm: 20, finalGpm: 30, wideOpen: '✓' }),
  );
  b.issues.push({ ...b.issues[0], id: id(), number: 99, remark: 'Strainer dirty', equipmentId: pump.id });
  return b;
}

const done = (b: ProjectBundle, designation: string) => {
  const e = b.equipment.find((x) => x.designation === designation)!;
  return computeCompletion({
    spec: getSpec(e.type),
    unit: e,
    rows: b.rows.filter((r) => r.equipmentId === e.id),
    photos: [],
    project: b.project,
    openIssues: 0,
  });
};

describe('hydronic units', () => {
  it('completion: valve out of tolerance, plant condenser out of tolerance, a single-circuit unit, integrated pumps', () => {
    const b = hydronicBundle();
    const sys = done(b, 'CHW');
    expect(sys.outOfTolerance.map((o) => o.label)).toEqual(['Valves 2']); // 30 / 20 = 150 %
    expect(sys.color).toBe('red');
    const ch = done(b, 'CH-1');
    expect(ch.outOfTolerance.map((o) => o.label)).toEqual(['Condenser flow']); // 250 / 300
    const boiler = unit(b.project.id, 'plant', 2, 'B-1', { plantType: 'Hot-water boiler', designGpm1: 90 });
    const cb = computeCompletion({
      spec: getSpec('plant'),
      unit: boiler,
      rows: [],
      photos: [],
      project: b.project,
      openIssues: 0,
    });
    expect(cb.fields.designGpm2.state).toBe('auto-na'); // one water circuit
    const ivs = unit(b.project.id, 'pump', 2, 'P-2', { pumpType: 'Integrated variable speed' });
    const ci = computeCompletion({
      spec: getSpec('pump'),
      unit: ivs,
      rows: [],
      photos: [],
      project: b.project,
      openIssues: 0,
    });
    expect(ci.fields.shutoffSuction.state).toBe('auto-na');
    expect(ci.fields.finalSuction.state).toBe('optional');
    expect(done(b, 'U-1').outOfTolerance).toEqual([]); // 105 %
  });

  it('exports the hydronic workbook: pumps, valves, plant, flow readings, System Summary, shared pages', async () => {
    const b = hydronicBundle();
    const { data, warnings } = toProjectData(b, 'hydronic');
    expect(warnings).toEqual([]);
    expect(Object.keys(data.equipment).sort()).toEqual(['flowMeasurement', 'plant', 'pump', 'valveSystem']);
    expect(data.sections.buildingBalance).toBeUndefined(); // airside only
    expect(data.sections.systemSummary?.tables?.systems).toEqual([
      { system: 'CHW', service: 'Chilled Water', pumps: 'P-1', vfdSetpoint: '12 psi' },
    ]);
    // issues follow their unit: the pump's issue is here, the RTU's is not
    const remarks = data.sections.issuesNew?.tables?.issues.map((i) => i.remark) ?? [];
    expect(remarks.some((r) => String(r).startsWith('P-1: Strainer'))).toBe(true);
    expect(remarks.some((r) => String(r).startsWith('RTU-'))).toBe(false);

    const { bytes } = await exportWorkbookWithReport(hydronicTemplate, data, { map: HYDRONIC_MAP });
    const back = await importWorkbook(bytes, { map: HYDRONIC_MAP });
    expect(back.sections.projectInfo?.fields?.projectName).toBe('Riverside Medical Office');
    expect(back.equipment.pump[0].schedule).toMatchObject({
      designation: 'P-1',
      system: 'CHW',
      designGpm: 200,
      phase: '3-phase',
    });
    expect(back.equipment.pump[0].fields).toMatchObject({
      serial: 'S123',
      finalSuction: 9,
      finalDischarge: 35,
      actualGpm: 190,
    });
    expect(back.equipment.valveSystem[0].fields).toMatchObject({
      designation: 'CHW',
      service: 'Chilled Water',
      dpUnits: 'ft w.g.',
    });
    expect(back.equipment.valveSystem[0].tables?.valves.map((v) => v.tag)).toEqual(['CBV-1', 'CBV-2']);
    expect(back.equipment.plant[0].fields).toMatchObject({ designation: 'CH-1', actualGpm2: 250 });
    expect(back.equipment.flowMeasurement[0].fields).toMatchObject({ designation: 'U-1', measuredGpm: 210 });
  });

  it('the airside workbook leaves the hydronic units out (and still exports)', async () => {
    const b = hydronicBundle();
    const { data } = toProjectData(b);
    expect(
      Object.keys(data.equipment).some((k) => ['pump', 'valveSystem', 'plant', 'flowMeasurement'].includes(k)),
    ).toBe(false);
    const remarks = data.sections.issuesNew?.tables?.issues.map((i) => String(i.remark)) ?? [];
    expect(remarks.some((r) => r.startsWith('P-1:'))).toBe(false);
    await exportWorkbookWithReport(airTemplate, data);
  });
});
