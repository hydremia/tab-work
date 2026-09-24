import { describe, expect, it } from 'vitest';
import { emptyNaState, type NaState } from '../data/types';
import { sampleBundle } from '../test/fixtures';
import {
  computeCompletion,
  displayColor,
  photoNaKey,
  rollup,
  rollupText,
  tableNaKey,
  type CompletionInput,
} from './completion';
import { getSpec } from './specs';

const project = { scopeProfile: 'full' as const, customScope: {}, tolerance: 0.1 };

function fullRtu(): CompletionInput {
  const b = sampleBundle();
  const rtu = b.equipment[0];
  return {
    spec: getSpec('rtu'),
    unit: { designation: rtu.designation, data: { ...rtu.data }, naState: structuredClone(rtu.naState) },
    rows: b.rows.filter((r) => r.equipmentId === rtu.id),
    photos: [{ category: 'unit' }, { category: 'tag' }, { category: 'oa_damper' }],
    project,
    openIssues: 0,
  };
}
const withData = (i: CompletionInput, data: Record<string, unknown>): CompletionInput => ({
  ...i,
  unit: { ...i.unit, data: { ...i.unit.data, ...(data as CompletionInput['unit']['data']) } },
});
const withNa = (i: CompletionInput, na: Partial<NaState>): CompletionInput => ({
  ...i,
  unit: {
    ...i.unit,
    naState: {
      ...i.unit.naState,
      ...na,
      sections: { ...i.unit.naState.sections, ...na.sections },
      fields: { ...i.unit.naState.fields, ...na.fields },
    },
  },
});

describe('RTU completion colors', () => {
  it('gray when nothing but the designation and presets are entered', () => {
    const c = computeCompletion({
      ...fullRtu(),
      unit: { designation: 'RTU-2', data: { unitType: 'RTU' }, naState: emptyNaState() },
      rows: [],
      photos: [],
    });
    expect(c.color).toBe('gray');
    expect(c.label).toBe('Not started');
    expect(c.missing.length).toBeGreaterThan(40);
  });

  it('amber once something is entered and required fields are still blank', () => {
    const c = computeCompletion({
      ...fullRtu(),
      unit: { designation: 'RTU-2', data: { unitType: 'RTU', serial: 'X1' }, naState: emptyNaState() },
      rows: [],
      photos: [],
    });
    expect(c.color).toBe('amber');
    expect(c.missing.map((m) => m.key)).toContain('manufacturer');
    expect(c.missing.map((m) => m.key)).toContain('supply');
  });

  it('green when every required item is filled or N/A (the fixture RTU)', () => {
    const c = computeCompletion(fullRtu());
    expect(c.missing).toEqual([]);
    expect(c.color).toBe('green');
    expect(c.fields.fla).toMatchObject({ state: 'na', notation: 'Not Avail.' });
    expect(c.required).toBe(c.satisfied);
    expect(c.sections.motor.state).toBe('complete');
  });

  it('photos are required unless N/A (R2)', () => {
    const c = computeCompletion({ ...fullRtu(), photos: [] });
    expect(c.color).toBe('amber');
    expect(c.missing.map((m) => m.label)).toEqual(['Unit photo', 'Unit label / tag photo', 'OA damper photo']);
    const na = computeCompletion(withNa({ ...fullRtu(), photos: [] }, { sections: { photos: { notation: 'N/A' } } }));
    expect(na.color).toBe('green');
    expect(na.sections.photos).toMatchObject({ state: 'na', naSource: 'section' });
    const one = computeCompletion(
      withNa(
        { ...fullRtu(), photos: [{ category: 'unit' }, { category: 'tag' }] },
        { fields: { [photoNaKey('oa_damper')]: { notation: 'Not Acc.' } } },
      ),
    );
    expect(one.color).toBe('green');
  });

  it('prelim rule: a row is complete with Initial OR Final; a blank reading is missing', () => {
    const i = fullRtu();
    const rows = i.rows.map((r) =>
      r.table === 'supply' && r.order === 2 ? { ...r, data: { ...r.data, finalVel: null } } : r,
    );
    const c = computeCompletion({ ...i, rows });
    expect(c.color).toBe('amber');
    const row = rows.find((r) => r.table === 'supply' && r.order === 2)!;
    expect(c.tables.supply.rows[row.id].missing).toEqual(['reading']);
  });
});

describe('automatic N/A rules', () => {
  it('direct / ECM drive -> sheave, pulley, belts, C to C, bore', () => {
    const c = computeCompletion(
      withData(fullRtu(), {
        driveType: 'Direct',
        motorSheave: null,
        fanPulley: null,
        belts: null,
        cToC: null,
        sheaveBore: null,
      }),
    );
    for (const k of ['motorSheave', 'fanPulley', 'belts', 'cToC', 'sheaveBore'])
      expect(c.fields[k]).toMatchObject({ state: 'auto-na', reason: 'direct / ECM drive' });
    expect(c.color).toBe('green');
    const belt = computeCompletion(withData(fullRtu(), { driveType: 'Belt', belts: null }));
    expect(belt.fields.belts.state).toBe('missing');
  });

  it('design OA 0 -> OA damper, OA row and OA damper photo', () => {
    const i = withData(fullRtu(), { designOaCfm: 0, oaDamper: null });
    const c = computeCompletion({
      ...i,
      rows: i.rows.filter((r) => r.table !== 'oa'),
      photos: [{ category: 'unit' }, { category: 'tag' }],
    });
    expect(c.fields.oaDamper.state).toBe('auto-na');
    expect(c.tables.oa.state).toBe('auto-na');
    expect(c.photos.oa_damper.state).toBe('auto-na');
    expect(c.color).toBe('green');
    const withOa = computeCompletion({
      ...withData(fullRtu(), { oaDamper: null }),
      rows: fullRtu().rows.filter((r) => r.table !== 'oa'),
    });
    expect(withOa.missing.map((m) => m.key)).toEqual(expect.arrayContaining(['oaDamper', 'oa']));
  });

  it('no VFD -> VSD frequency; VFD -> final VSD required', () => {
    expect(computeCompletion(fullRtu()).fields.vsdFinal.state).toBe('auto-na');
    const blank = computeCompletion(withData(fullRtu(), { hasVfd: null }));
    expect(blank.fields.vsdFinal.state).toBe('auto-na');
    expect(blank.fields.hasVfd.state).toBe('missing');
    const vfd = computeCompletion(withData(fullRtu(), { hasVfd: 'Yes' }));
    expect(vfd.fields.vsdFinal.state).toBe('missing');
    expect(vfd.fields.vsdInitial.state).toBe('optional');
  });

  it('1-phase -> voltage and amperage legs 2 and 3', () => {
    const c = computeCompletion(
      withData(fullRtu(), { phase: '1-phase', volts2: null, volts3: null, amps2: null, amps3: null }),
    );
    for (const k of ['volts2', 'volts3', 'amps2', 'amps3']) expect(c.fields[k].state).toBe('auto-na');
    expect(c.color).toBe('green');
  });

  it('unit type sets the static-profile components (RTU has no wheel, DOAS does)', () => {
    expect(computeCompletion(fullRtu()).fields.spLeaving2.state).toBe('auto-na');
    expect(computeCompletion(withData(fullRtu(), { unitType: 'DOAS' })).fields.spLeaving2.state).toBe('missing');
  });

  it('no filters -> filter description and filter leaving static', () => {
    const c = computeCompletion(withData(fullRtu(), { hasFilters: 'No', filters: null, spLeaving1: null }));
    expect(c.fields.filters.state).toBe('auto-na');
    expect(c.fields.spLeaving1.state).toBe('auto-na');
  });
});

describe('N/A levels and scope profiles', () => {
  it('section N/A covers every field of the section', () => {
    const i = withData(fullRtu(), { motorManufacturer: null, motorRpm: null, frame: null });
    expect(computeCompletion(i).color).toBe('amber');
    const c = computeCompletion(withNa(i, { sections: { motor: { notation: 'Not Acc.' } } }));
    expect(c.fields.frame).toMatchObject({ state: 'section-na', notation: 'Not Acc.' });
    expect(c.sections.motor).toMatchObject({ state: 'na', naSource: 'section', notation: 'Not Acc.' });
    expect(c.color).toBe('green');
  });

  it('identity cannot be N/A at section level', () => {
    const i = withData(fullRtu(), { areaServed: null });
    const c = computeCompletion(withNa(i, { sections: { identity: { notation: 'N/A' } } }));
    expect(c.fields.areaServed.state).toBe('missing');
  });

  it('equipment N/A makes the whole unit complete, labelled with the notation', () => {
    const c = computeCompletion({
      ...fullRtu(),
      unit: {
        designation: 'RTU-3',
        data: { unitType: 'RTU' },
        naState: { sections: {}, fields: {}, equipment: { notation: 'N/A' } },
      },
      rows: [],
      photos: [],
    });
    expect(c.color).toBe('green');
    expect(c.label).toBe('Complete (N/A)');
  });

  it('Airflow Only: unit data, motor, drive, RPM, static, misc and photos are N/A; design CFM and airflow stay required', () => {
    const blank = { designation: 'RTU-4', data: { unitType: 'RTU', areaServed: 'Lobby' }, naState: emptyNaState() };
    const c = computeCompletion({
      ...fullRtu(),
      unit: blank,
      rows: [],
      photos: [],
      project: { ...project, scopeProfile: 'airflow' },
    });
    expect(c.fields.fla.state).toBe('scope-na');
    expect(c.fields.manufacturer.state).toBe('scope-na');
    expect(c.photos.unit.state).toBe('scope-na');
    expect(c.sections.motor.state).toBe('na');
    expect(c.sections.design.state).toBe('incomplete'); // design CFMs still required
    const keys = c.missing.map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(['location', 'designTotalCfm', 'designOaCfm', 'instrument', 'supply']));
    expect(keys).not.toContain('fla');
  });

  it("a section marked 'applies' overrides the scope profile", () => {
    const i = { ...fullRtu(), project: { ...project, scopeProfile: 'airflow' as const } };
    const c = computeCompletion(withData(withNa(i, { sections: { motor: 'applies' } }), { frame: null }));
    expect(c.fields.frame.state).toBe('missing');
    expect(c.fields.serial.state).toBe('value');
  });

  it('Custom: sections switched off for the type are N/A', () => {
    const c = computeCompletion(
      withData(
        { ...fullRtu(), project: { ...project, scopeProfile: 'custom', customScope: { rtu: { static: false } } } },
        { spEntering: null },
      ),
    );
    expect(c.fields.spEntering.state).toBe('scope-na');
    expect(c.color).toBe('green');
  });

  it('an airflow table can be marked N/A explicitly', () => {
    const i = fullRtu();
    const c = computeCompletion(
      withNa(
        { ...i, rows: i.rows.filter((r) => r.table !== 'oa') },
        { fields: { [tableNaKey('oa')]: { notation: 'Not Acc.' } } },
      ),
    );
    expect(c.tables.oa.state).toBe('na');
    expect(c.color).toBe('green');
  });
});

describe('red: tolerance and issues', () => {
  it('a reading outside ±10 % of design turns the unit red; 110 % is inside', () => {
    const i = fullRtu();
    const at = (vel: number) =>
      computeCompletion({
        ...i,
        rows: i.rows.map((r) =>
          r.table === 'supply' && r.order === 1 ? { ...r, data: { ...r.data, finalVel: vel } } : r,
        ),
      });
    expect(at(550).color).toBe('green'); // 110 %
    expect(at(450).color).toBe('green'); // 90 %
    const hi = at(560);
    expect(hi.color).toBe('red');
    expect(hi.outOfTolerance[0]).toMatchObject({ table: 'supply', label: 'Supply outlets S-1' });
    expect(hi.outOfTolerance[0].ratio).toBeCloseTo(1.12);
  });

  it('uses Final when present, otherwise Initial', () => {
    const i = fullRtu();
    const rows = i.rows.map((r) =>
      r.table === 'supply' && r.order === 1 ? { ...r, data: { ...r.data, initialVel: 300, finalVel: 500 } } : r,
    );
    expect(computeCompletion({ ...i, rows }).color).toBe('green');
    const init = rows.map((r) =>
      r.table === 'supply' && r.order === 1 ? { ...r, data: { ...r.data, finalVel: null } } : r,
    );
    expect(computeCompletion({ ...i, rows: init }).color).toBe('red');
  });

  it('the project tolerance is configurable', () => {
    const c = computeCompletion({ ...fullRtu(), project: { ...project, tolerance: 0.05 } });
    expect(c.color).toBe('red'); // S-2 is at 94 %
  });

  it('a linked open issue turns a complete unit red', () => {
    expect(computeCompletion({ ...fullRtu(), openIssues: 1 }).color).toBe('red');
  });

  it('first return row: design is total supply design - OA design (workbook formula) and is not required', () => {
    const i = fullRtu();
    const ret = {
      id: 'r1',
      table: 'return',
      order: 1,
      data: { no: 'R-1', area: 'Plenum', type: 'RG', size: '24x24', ak: 1, finalVel: 800 },
      na: {},
    };
    const c = computeCompletion({ ...i, rows: [...i.rows, ret] });
    expect(c.tables.return.rows.r1).toMatchObject({ missing: [], design: 800, ratio: 1 });
    expect(c.color).toBe('green');
  });
});

describe('design discrepancy (R8)', () => {
  it('flags when the schedule design CFM differs from the outlet design sum', () => {
    expect(computeCompletion(fullRtu()).designDiscrepancy).toBeUndefined();
    expect(computeCompletion(withData(fullRtu(), { designTotalCfm: 1200 })).designDiscrepancy).toEqual({
      schedule: 1200,
      outlets: 1000,
    });
  });
});

describe('VAV', () => {
  function vav(): CompletionInput {
    const b = sampleBundle();
    const v = b.equipment[1];
    return {
      spec: getSpec('vav'),
      unit: { designation: v.designation, data: { ...v.data }, naState: emptyNaState() },
      rows: b.rows.filter((r) => r.equipmentId === v.id),
      photos: [{ category: 'unit' }],
      project,
      openIssues: 0,
    };
  }
  it('pressure-independent box with no heating: complete', () => {
    const c = computeCompletion(vav());
    expect(c.fields.fanCfm.state).toBe('auto-na');
    expect(c.fields.fanCfmActual.state).toBe('auto-na');
    expect(c.fields.heatingCfmActual.state).toBe('auto-na');
    expect(c.color).toBe('green');
  });
  it('fan-powered: fan CFM design and actual are required; scheduled heating needs an actual', () => {
    const c = computeCompletion(withData(vav(), { terminalType: 'Series Fan Powered', heatingCfm: 300 }));
    expect(c.missing.map((m) => m.key)).toEqual(['fanCfm', 'heatingCfmActual', 'fanCfmActual']);
  });
});

describe('rollup', () => {
  it('counts colors', () => {
    expect(rollup(['green', 'green', 'amber', 'gray', 'red'])).toEqual({
      total: 5,
      gray: 1,
      amber: 1,
      green: 2,
      red: 1,
      reviewed: 0,
    });
  });

  it('counts blue (reviewed) as complete and reviewed', () => {
    const r = rollup(['blue', 'green', 'blue', 'amber']);
    expect(r).toMatchObject({ total: 4, green: 3, reviewed: 2, amber: 1 });
    expect(rollupText(r)).toBe('3/4 complete, 2 reviewed');
    expect(rollupText(rollup(['green', 'amber']))).toBe('1/2 complete');
    expect(displayColor('green', true)).toBe('blue');
    expect(displayColor('red', true)).toBe('red');
    expect(displayColor('green', false)).toBe('green');
  });
});
