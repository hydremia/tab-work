import { describe, expect, it } from 'vitest';
import {
  autoMap,
  buildPreview,
  looksLikeHeader,
  normalizePhase,
  parseDelimited,
  parseNumber,
  scheduleTargets,
  splitElectrical,
} from './scheduleImport';
import { nextDesignation } from './equipmentTypes';
import { duplicateData, duplicateRow, duplicableKeys } from './duplicate';

describe('schedule import: parsing', () => {
  it('tab-separated paste from Excel (blank cells kept, trailing newline ignored)', () => {
    expect(parseDelimited('Tag\tCFM\tHP\nRTU-1\t1,200\t3\nRTU-2\t\t5\n')).toEqual([
      ['Tag', 'CFM', 'HP'],
      ['RTU-1', '1,200', '3'],
      ['RTU-2', null, '5'],
    ]);
  });

  it('CSV with quotes, embedded commas, quotes and newlines; blank lines dropped', () => {
    expect(parseDelimited('Tag,Area,Model\r\n"EF-1","Toilets, 2nd floor","A ""B"" \nC"\r\n\r\nEF-2,Kitchen,X')).toEqual(
      [
        ['Tag', 'Area', 'Model'],
        ['EF-1', 'Toilets, 2nd floor', 'A "B" \nC'],
        ['EF-2', 'Kitchen', 'X'],
      ],
    );
  });

  it('numbers, phases and V/Ph/Hz', () => {
    expect(parseNumber('1,200 CFM')).toBe(1200);
    expect(parseNumber('0.75 in. w.g.')).toBe(0.75);
    expect(parseNumber('1/2')).toBe(0.5);
    expect(parseNumber('1-1/2 HP')).toBe(1.5);
    expect(parseNumber('¾')).toBe(0.75);
    expect(parseNumber('abc')).toBeNull();
    expect(normalizePhase('3')).toBe('3-phase');
    expect(normalizePhase('1 PH')).toBe('1-phase');
    expect(normalizePhase('Three')).toBe('3-phase');
    expect(normalizePhase('3Φ')).toBe('3-phase');
    expect(normalizePhase('2')).toBeNull();
    expect(splitElectrical('460/3/60')).toEqual({ volts: 460, phase: '3-phase' });
    expect(splitElectrical('115-1-60')).toEqual({ volts: 115, phase: '1-phase' });
    expect(splitElectrical('208V/3PH')).toEqual({ volts: 208, phase: '3-phase' });
  });
});

describe('schedule import: header mapping', () => {
  it('maps an engineer RTU schedule by header text; the longest / exact match wins, each field once', () => {
    const headers = [
      'Mark',
      'Area Served',
      'Location',
      'Mfr',
      'Model No.',
      'Supply CFM',
      'OA CFM',
      'ESP (in. wg)',
      'Motor HP',
      'Fan RPM',
      'V/Ph/Hz',
      'Notes',
    ];
    expect(autoMap(headers, 'rtu')).toEqual([
      'designation',
      'areaServed',
      'location',
      'manufacturer',
      'model',
      'designTotalCfm',
      'designOaCfm',
      'unitEsp',
      'hp',
      'fanRpm',
      'voltage',
      null,
    ]);
    expect(looksLikeHeader(headers, 'rtu')).toBe(true);
    expect(looksLikeHeader(['RTU-1', 'Lobby', 'Roof'], 'rtu')).toBe(false);
    expect(looksLikeHeader(['MAU-1'], 'mau')).toBe(false);
    expect(looksLikeHeader(['Tag'], 'mau')).toBe(true);
    expect(looksLikeHeader(['RTU-1', 'Carrier', '460/3/60'], 'rtu')).toBe(false);
  });

  it('maps a VAV schedule (max / min / heating / fan CFM, DDC address, type)', () => {
    expect(
      autoMap(['Tag', 'Inlet Size', 'Type', 'Max CFM', 'Min CFM', 'Htg CFM', 'Fan CFM', 'DDC Address'], 'vav'),
    ).toEqual([
      'designation',
      'inletSize',
      'terminalType',
      'designMaxCfm',
      'designMinCfm',
      'heatingCfm',
      'fanCfm',
      'ddcAddress',
    ]);
  });

  it('targets are the {Equipment Data Entry} columns the app has a field for (hood KEF interlock is not)', () => {
    expect(scheduleTargets('hood').map((t) => t.key)).toEqual([
      'designation',
      'areaServed',
      'location',
      'manufacturer',
      'designCfm',
      'model',
      'lengthFt',
    ]);
    expect(scheduleTargets('smallFan').map((t) => t.key)).toEqual([
      'designation',
      'areaServed',
      'location',
      'manufacturer',
      'model',
      'hp',
      'voltage',
      'phase',
      'designCfm',
    ]);
    expect(scheduleTargets('traverse').map((t) => t.key)).toEqual([
      'designation',
      'areaServed',
      'designCfm',
      'shape',
      'width',
      'height',
      'liner',
    ]);
  });
});

describe('schedule import: preview', () => {
  const existing = [
    { id: 'a', designation: 'RTU-1', slot: 1, type: 'rtu' as const },
    { id: 'b', designation: 'RTU-3', slot: 3, type: 'rtu' as const },
  ];

  it('create / update / invalid / duplicate / no designation, phase from V/Ph/Hz, slots in order', () => {
    const p = buildPreview({
      type: 'rtu',
      rows: [
        ['rtu-1', '1200', '460/3/60', null],
        ['RTU-2', '2,000', '208', '1'],
        ['RTU-4', 'lots', '460', '3'],
        ['RTU-2', '900', '460', '3'],
        [null, '500', null, null],
        ['RTU-5', '800', '440', 'three'],
      ],
      mapping: ['designation', 'designTotalCfm', 'voltage', 'phase'],
      existing,
    });
    expect(p.rows.map((r) => [r.designation, r.action, r.slot])).toEqual([
      ['rtu-1', 'update', 1],
      ['RTU-2', 'create', 2],
      ['RTU-4', 'skip', null],
      ['RTU-2', 'skip', null],
      ['', 'skip', null],
      ['RTU-5', 'create', 4],
    ]);
    expect(p.rows[0].values).toEqual({ designTotalCfm: 1200, voltage: 460, phase: '3-phase' });
    expect(p.rows[1].values).toEqual({ designTotalCfm: 2000, voltage: 208, phase: '1-phase' });
    expect(p.rows[2].errors).toEqual(['Design total CFM: "lots" is not a number']);
    expect(p.rows[3].errors[0]).toMatch(/Duplicate: RTU-2 is also in row 2/);
    expect(p.rows[4].errors[0]).toBe('No designation');
    expect(p.rows[5].warnings[0]).toMatch(/440 V is not a standard voltage/);
    expect([p.create, p.update, p.skip, p.totalAfter]).toEqual([2, 1, 3, 4]);
  });

  it('capacity: MAUs past 10 are over capacity; small fans past slot 30 are warned', () => {
    const maus = Array.from({ length: 11 }, (_, i) => [`MAU-${i + 1}`]);
    const p = buildPreview({ type: 'mau', rows: maus, mapping: ['designation'], existing: [] });
    expect(p.create).toBe(10);
    expect(p.rows[10].errors).toEqual(['Over capacity: the workbook has room for 10 MAUs']);
    expect(p.notes[0]).toMatch(/1 row over capacity/);
    const fans = buildPreview({
      type: 'smallFan',
      rows: [['EF-S31']],
      mapping: ['designation'],
      existing: Array.from({ length: 30 }, (_, i) => ({
        id: `s${i}`,
        designation: `EF-S${i + 1}`,
        slot: i + 1,
        type: 'smallFan' as const,
      })),
    });
    expect(fans.rows[0]).toMatchObject({ action: 'create', slot: 31 });
    expect(fans.rows[0].warnings.join(' ')).toMatch(/Building Balance lists small fans 1–30 only/);
    expect(fans.notes[0]).toMatch(/31 small fans after the import/);
  });

  it('select fields accept a case-insensitive / prefix match (traverse shape)', () => {
    const p = buildPreview({
      type: 'traverse',
      rows: [
        ['T-1', 'rect', '24'],
        ['T-2', 'Oval', '10'],
      ],
      mapping: ['designation', 'shape', 'width'],
      existing: [],
    });
    expect(p.rows[0].values).toEqual({ shape: 'Rectangular', width: 24 });
    expect(p.rows[1].errors[0]).toMatch(/shape: "Oval" is not one of Rectangular, Round/);
  });
});

describe('duplicate', () => {
  it('next designation: trailing number incremented past used ones', () => {
    expect(nextDesignation('VAV-12', ['VAV-12'])).toBe('VAV-13');
    expect(nextDesignation('VAV-12', ['VAV-12', 'vav-13'])).toBe('VAV-14');
    expect(nextDesignation('EF-S3', [])).toBe('EF-S4');
    expect(nextDesignation('VAV-09', [])).toBe('VAV-10');
    expect(nextDesignation('RTU-1A', [])).toBe('RTU-2A');
    expect(nextDesignation('Kitchen hood', ['Kitchen hood'])).toBe('Kitchen hood 2');
  });

  it('copies schedule and configuration, not readings, serial or remarks; rows without readings', () => {
    expect(duplicableKeys('rtu')).toEqual(
      expect.arrayContaining(['manufacturer', 'designTotalCfm', 'unitType', 'driveType', 'fla', 'instrument']),
    );
    expect(duplicableKeys('rtu')).not.toContain('serial');
    const { data, fieldMarks } = duplicateData({
      type: 'vav',
      data: {
        designMaxCfm: 600,
        manufacturer: 'Titus',
        serial: 'X1',
        minCfmActual: 150,
        remarks: 'r',
        instrument: 'Flow Hood',
      },
      naState: { sections: {}, fields: { ddcAddress: { notation: 'N/A' }, serial: { notation: 'Not Acc.' } } },
    });
    expect(data).toEqual({ designMaxCfm: 600, manufacturer: 'Titus', instrument: 'Flow Hood' });
    expect(fieldMarks).toEqual({ ddcAddress: { notation: 'N/A' } });
    expect(
      duplicateRow('vav', {
        table: 'outlets',
        data: {
          no: 'S-1',
          area: 'Office',
          type: 'CD',
          size: '12x12',
          ak: 0.5,
          designCfm: 200,
          initialVel: 380,
          finalVel: 400,
        },
        na: { finalVel: { notation: 'Not Acc.' }, type: null },
      }),
    ).toEqual({ data: { no: 'S-1', area: 'Office', type: 'CD', size: '12x12', ak: 0.5, designCfm: 200 }, na: {} });
    expect(
      duplicateRow('hood', { table: 'filters', data: { size: '16" x 20"', init1: 300, final1: 310 }, na: {} }).data,
    ).toEqual({
      size: '16" x 20"',
    });
  });
});
