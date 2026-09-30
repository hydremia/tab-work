/** The engineer's building air balance table: reading it, telling it from unit and space tables, checking units. */
import { describe, expect, it } from 'vitest';
import { airBalanceChecks, entryTotals, readAirBalance, tableKind, typeFromTag, unitDesignBalance } from './airBalance';

// the WFM "VENTILATION CALCULATION" layout: UNIT | OSA (CFM) | UNIT | EXHAUST (CFM), totals, net
const VENT = [
  ['UNIT', 'OSA (CFM)', 'UNIT', 'EXHAUST (CFM)'],
  ['RTU-1', '4,100', 'EF-1', '1,890'],
  ['MAU-9', '3,352', 'EF-8', '1,575'],
  ['RTU-9', '500', 'EF-22', '1000 (1)'],
  [null, null, 'EF-40', '300'],
  ['TOTAL', '7,952', 'TOTAL', '4,765'],
  ['NET POSITIVE PRESSURIZATION', null, null, '3,187'],
];

describe('air balance table', () => {
  it('reads OA and exhaust entries, note marks, stated totals and net', () => {
    const t = readAirBalance(VENT)!;
    expect(t.entries.map((e) => [e.side, e.designation, e.cfm, e.note ?? ''])).toEqual([
      ['oa', 'RTU-1', 4100, ''],
      ['exhaust', 'EF-1', 1890, ''],
      ['oa', 'MAU-9', 3352, ''],
      ['exhaust', 'EF-8', 1575, ''],
      ['oa', 'RTU-9', 500, ''],
      ['exhaust', 'EF-22', 1000, '1'],
      ['exhaust', 'EF-40', 300, ''],
    ]);
    expect([t.totalOa, t.totalExhaust, t.net]).toEqual([7952, 4765, 3187]);
    expect(t.excluded).toEqual([]);
    expect(entryTotals(t)).toEqual({ oa: 7952, exhaust: 4765 });
  });

  it('noted rows the stated total leaves out ("serve mechanical spaces, not part of the air balance")', () => {
    const rows = VENT.map((r) => [...r]);
    rows[5] = ['TOTAL', '7,952', 'TOTAL', '3,765'];
    const t = readAirBalance(rows)!;
    expect(t.excluded).toEqual(['EF-22']);
    expect(entryTotals(t)).toEqual({ oa: 7952, exhaust: 3765 });
    expect(
      unitDesignBalance(
        [
          { type: 'fan', designation: 'EF-1', data: { designTotalCfm: 1890 } },
          { type: 'fan', designation: 'EF-22', data: { designTotalCfm: 1000 } },
        ],
        0,
        t.excluded,
      ).exhaust,
    ).toBe(1890);
  });

  it('one unit column with both sides; a negative net; no totals', () => {
    const t = readAirBalance([
      ['UNIT', 'OA CFM', 'EXHAUST CFM'],
      ['ERV-1', '800', '750'],
      ['EF-2', null, '400'],
      ['NET NEGATIVE', null, '350'],
    ])!;
    expect(t.entries.map((e) => `${e.side}:${e.designation}:${e.cfm}`)).toEqual([
      'oa:ERV-1:800',
      'exhaust:ERV-1:750',
      'exhaust:EF-2:400',
    ]);
    expect(t.net).toBe(-350);
  });

  it('tells air balance, space-by-space ventilation and unit schedules apart', () => {
    expect(tableKind(VENT, 'VENTILATION CALCULATION')).toBe('airBalance');
    expect(
      tableKind(
        [
          ['ROOM', 'AREA (SF)', 'OCCUPANCY', 'Rp', 'Ra', 'Voz'],
          ['SALES', '12,000', '180', '7.5', '0.12', '2,790'],
        ],
        'VENTILATION SCHEDULE',
      ),
    ).toBe('spaces');
    expect(
      tableKind([
        ['UNIT NO.', 'SERVICE', 'CFM', 'HP'],
        ['EF-2', 'HOOD H-2', '2,300', '1.5'],
        ['EF-3', 'KITCHEN', '1,200', '0.5'],
      ]),
    ).toBeNull();
  });

  it('checks the units: match, differs, blank, missing (type from the tag), not listed', () => {
    const t = readAirBalance(VENT)!;
    const { checks, notListed } = airBalanceChecks(t, [
      { type: 'rtu', designation: 'RTU-1', data: { designOaCfm: 4100 } },
      { type: 'fan', designation: 'EF-1', data: { designTotalCfm: 1890 } },
      { type: 'mau', designation: 'MAU-9', data: { designTotalCfm: 3352 } },
      { type: 'fan', designation: 'EF-8', data: { designTotalCfm: 1200 } },
      { type: 'fan', designation: 'EF-22', data: {} },
      { type: 'fan', designation: 'EF-5', data: { designTotalCfm: 600 } },
      { type: 'hood', designation: 'H-2', data: { designCfm: 2300 } },
    ]);
    expect(checks.map((c) => [c.entry.designation, c.status, c.unitCfm ?? c.suggestType ?? c.field ?? ''])).toEqual([
      ['RTU-1', 'match', 'designOaCfm'],
      ['EF-1', 'match', 'designTotalCfm'],
      ['MAU-9', 'match', 'designTotalCfm'],
      ['EF-8', 'differs', 1200],
      ['RTU-9', 'missing', 'rtu'],
      ['EF-22', 'blank', 'designTotalCfm'],
      ['EF-40', 'missing', 'fan'],
    ]);
    expect(notListed.map((u) => u.designation)).toEqual(['EF-5']);
    expect(typeFromTag('KEF-3', 'exhaust')).toBe('fan');
    expect(typeFromTag('TOILET', 'oa')).toBeNull();
  });

  it('design balance from the units (hoods not counted: their fans are)', () => {
    expect(
      unitDesignBalance(
        [
          { type: 'rtu', designation: 'RTU-1', data: { designOaCfm: 4100, designTotalCfm: 12000 } },
          { type: 'mau', designation: 'MAU-9', data: { designTotalCfm: 3352 } },
          { type: 'fan', designation: 'EF-1', data: { designTotalCfm: 1890 } },
          { type: 'hood', designation: 'H-1', data: { designCfm: 1890 } },
          { type: 'smallFan', designation: 'EF-S31', data: { designTotalCfm: 50 }, slot: 31 },
        ],
        100,
      ),
    ).toEqual({ oa: 7552, exhaust: 1890, net: 5662 });
  });
});

describe('air balance vs unit schedules', () => {
  it('a unit schedule with a unit and an OA CFM column among many is no air balance', () => {
    const rtu = [
      ['UNIT', 'SERVICE', 'SUPPLY CFM', 'OA CFM', 'ESP', 'HP', 'V-PH', 'MANUFACTURER', 'MODEL'],
      ['RTU-1', 'SALES', '12,000', '4,100', '1.0', '7.5', '460-3', 'CARRIER', '48X'],
      ['RTU-2', 'SALES', '12,000', '4,100', '1.0', '7.5', '460-3', 'CARRIER', '48X'],
    ];
    expect(readAirBalance(rtu)).toBeNull();
    expect(tableKind(rtu, 'ROOFTOP PACKAGED UNIT SCHEDULE')).toBeNull();
  });
});

describe('split system tags', () => {
  it('"HP-3/FC-3" in the table matches a unit tagged FC-3 or "HP-3 / FC-3"', () => {
    const t = readAirBalance([
      ['UNIT', 'OSA (CFM)', 'UNIT', 'EXHAUST (CFM)'],
      ['HP-3/FC-3', '680', 'EF-1', '100'],
      ['AC-1', '500', 'EF-2', '200'],
    ])!;
    expect(t.entries[0].designation).toBe('HP-3/FC-3');
    const a = airBalanceChecks(t, [{ type: 'rtu', designation: 'FC-3', data: { designOaCfm: 680 } }]);
    expect(a.checks[0].status).toBe('match');
    const b = airBalanceChecks(t, [{ type: 'rtu', designation: 'HP-3 / FC-3', data: {} }]);
    expect(b.checks[0].status).toBe('blank');
  });
});
