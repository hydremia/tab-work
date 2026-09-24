import { DEFAULT_INSTRUMENTS } from '@a2b/workbook/map';
import { describe, expect, it } from 'vitest';
import {
  emptyNaState,
  type AirflowRow,
  type Equipment,
  type Instrument,
  type Issue,
  type Project,
} from '../data/types';
import { groupAttention, needsAttention } from './attention';
import { calibrationExpired, pickerWarning } from './instruments';

const project: Project = {
  id: 'p',
  name: 'Job',
  scopeProfile: 'full',
  customScope: {},
  tolerance: 0.1,
  reportKind: 'prelim',
  info: { tabDate: '2026-09-15' },
  blueprints: [],
  naState: emptyNaState(),
  templateRevision: '05',
  createdAt: 0,
  updatedAt: 0,
};
const unit = (type: Equipment['type'], designation: string, slot: number, data: Equipment['data'] = {}): Equipment => ({
  id: `${type}-${slot}`,
  projectId: 'p',
  type,
  designation,
  slot,
  isExisting: false,
  data,
  naState: emptyNaState(),
  createdAt: 0,
  updatedAt: 0,
});
const instruments: Instrument[] = DEFAULT_INSTRUMENTS.map((d, i) => ({
  id: `i${i}`,
  projectId: 'p',
  order: i,
  ...d,
  createdAt: 0,
  updatedAt: 0,
}));
const row = (equipmentId: string, table: string, data: AirflowRow['data']): AirflowRow => ({
  id: `${equipmentId}-${table}-${String(data.no)}`,
  projectId: 'p',
  equipmentId,
  table,
  order: 1,
  data,
  na: {},
  createdAt: 0,
  updatedAt: 0,
});

describe('instruments vs. calibration', () => {
  it('picker warning only when no calibration row matches the kind', () => {
    expect(pickerWarning('Flow Hood', instruments)).toBeNull(); // Balometer
    expect(pickerWarning('Evergreen VelGrid', instruments)).toBeNull(); // Digital Micromanometer
    expect(pickerWarning('Manometer/Pitot Tube', instruments)).toBeNull();
    expect(pickerWarning('Hot Wire Anemometer', instruments)).toMatch(/No calibration row for a hot-wire/);
    expect(pickerWarning('Flow Hood', [])).toMatch(/flow hood/);
    expect(pickerWarning('DDC / Controller Reading', [])).toBeNull();
    expect(pickerWarning(null, [])).toBeNull();
  });

  it('calibration older than 12 months before the TAB date', () => {
    expect(calibrationExpired('2024-03-14', '2026-09-15')).toBe(true);
    expect(calibrationExpired('2025-10-21', '2026-09-15')).toBe(false);
    expect(calibrationExpired('2025-09-15', '2026-09-15')).toBe(false);
    expect(calibrationExpired('2025-09-14', '2026-09-15')).toBe(true);
    expect(calibrationExpired('2024-01-01', null)).toBe(false);
  });
});

describe('needsAttention', () => {
  it('lists design, motor, tolerance, photo, issue, capacity and calibration items, grouped and linked', () => {
    const rtu = unit('rtu', 'RTU-1', 1, {
      areaServed: 'Lobby',
      unitType: 'RTU',
      designTotalCfm: 1200,
      unitEsp: 0.8,
      hp: 3,
      fla: 4,
      phase: '3-phase',
      voltage: 460,
      volts1: 468,
      volts2: 465,
      volts3: 470,
      amps1: 5.2,
      amps2: 4.1,
      amps3: 4.0,
      spEntering: -0.35,
      spLeaving1: -0.55,
      spLeaving3: -0.95,
      spLeaving4: -1.05,
      spLeaving5: 0.72,
      instrument: 'Flow Hood',
    });
    const vav = unit('vav', 'VAV-1', 1, { designMaxCfm: 300, instrument: 'Hot Wire Anemometer' });
    const maus = Array.from({ length: 10 }, (_, i) => unit('mau', `MAU-${i + 1}`, i + 1));
    const sf = unit('smallFan', 'EF-S31', 31, { areaServed: 'Toilet' });
    const rows = [
      row(rtu.id, 'supply', { no: 'S-1', ak: 1, designCfm: 1000, finalVel: 1000 }),
      row(vav.id, 'outlets', { no: 'S-1', ak: 1, designCfm: 300, finalVel: 200 }),
    ];
    const issues: Issue[] = [
      {
        id: 'x',
        projectId: 'p',
        kind: 'new',
        number: 1,
        remark: 'Damper stuck',
        status: 'Open',
        comments: '',
        equipmentId: rtu.id,
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'y',
        projectId: 'p',
        kind: 'existing',
        number: 1,
        remark: 'Closed one',
        status: 'Closed',
        comments: '',
        equipmentId: null,
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const items = needsAttention({
      project,
      equipment: [rtu, vav, ...maus, sf],
      rows,
      photos: [],
      issues,
      instruments,
    });
    const brief = items.map((i) => `${i.group}|${i.subject}|${i.text}`);
    expect(brief).toEqual(
      expect.arrayContaining([
        'design|RTU-1|Schedule 1,200 CFM vs. outlets 1,000 CFM',
        'design|RTU-1|Unit ESP: design 0.80 vs. actual 1.07 in. w.g. (134 %)',
        expect.stringMatching(/^motor\|RTU-1\|Measured amps above corrected FLA × SF .* L1 5\.2 A/),
        'motor|RTU-1|Estimated BHP 3.47 is above the nameplate 3 HP.',
        'tolerance|VAV-1|Outlets S-1: 67 % of design (±10 %)',
        'photos|RTU-1|Missing: Unit, Unit label / tag',
        'issues|Issue N-1 · RTU-1|Damper stuck',
        'capacity|MAUs|10 of 10 MAUs: the workbook has no room for more',
        'capacity|Small fans|EF-S31 past slot 30: not on Building Balance (left out of the exhaust total)',
        'calibration|Hot Wire Anemometer (VAV-1)|No calibration row for a hot-wire (thermal) anemometer',
        'calibration|Flow Hood (RTU-1)|Balometer Evergreen Telemetry Three Pounder: calibrated 2024-03-14, more than 12 months before the TAB date (2026-09-15)',
      ]),
    );
    // closed issues, units not started (the MAUs) and in-date meters (tachometer, multimeter, manometer) are not listed
    expect(brief.some((b) => b.includes('Closed one'))).toBe(false);
    expect(items.some((i) => i.group === 'photos' && i.subject.startsWith('MAU'))).toBe(false);
    expect(brief.filter((b) => b.startsWith('calibration'))).toHaveLength(2);
    // links
    expect(items.find((i) => i.group === 'motor')?.to).toBe(`e/${rtu.id}#sec-motor`);
    expect(items.find((i) => i.group === 'issues')?.to).toBe('issues');
    expect(groupAttention(items).map((g) => g.key)).toEqual([
      'tolerance',
      'issues',
      'design',
      'motor',
      'photos',
      'calibration',
      'capacity',
    ]);
  });

  it('an empty project needs no attention', () => {
    expect(needsAttention({ project, equipment: [], rows: [], photos: [], issues: [], instruments })).toEqual([]);
  });
});
