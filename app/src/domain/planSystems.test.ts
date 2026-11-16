import { describe, expect, it } from 'vitest';
import type { PlanSheetDevice } from '../data/types';
import {
  designCheck,
  deviceLabel,
  devicesInLasso,
  nextSystemColor,
  pointInPolygon,
  reportSize,
  rowLetter,
  rowsForDevices,
  systemPrefix,
  walkOrder,
} from './planSystems';

const dev = (key: string, x: number, y: number, extra: Partial<PlanSheetDevice> = {}): PlanSheetDevice => ({
  key,
  tag: { x, y, box: { x0: x - 5, y0: y - 5, x1: x + 5, y1: y + 5 }, lines: [] },
  type: 'S1',
  size: null,
  cfm: 100,
  x,
  y,
  how: 'tag',
  count: 1,
  index: 0,
  ...extra,
});

describe('plan systems', () => {
  it('lasso: even-odd point in polygon, devices inside', () => {
    const poly: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    expect(pointInPolygon([50, 50], poly)).toBe(true);
    expect(pointInPolygon([150, 50], poly)).toBe(false);
    const concave: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [50, 20],
      [0, 100],
    ];
    expect(pointInPolygon([50, 60], concave)).toBe(false);
    expect(pointInPolygon([10, 50], concave)).toBe(true);
    const ds = [dev('a', 10, 10), dev('b', 90, 90), dev('c', 110, 10)];
    expect(devicesInLasso(ds, poly).map((d) => d.key)).toEqual(['a', 'b']);
    expect(devicesInLasso(ds, poly.slice(0, 2))).toEqual([]);
  });

  it('letters skip I and O, then go on with two letters', () => {
    expect([0, 1, 7, 8, 12, 13, 14, 23, 24, 25].map(rowLetter)).toEqual([
      'A',
      'B',
      'H',
      'J',
      'N',
      'P',
      'Q',
      'Z',
      'AA',
      'AB',
    ]);
    expect(deviceLabel('1R', 1)).toBe('1RB');
  });

  it('walk order: nearest next from the top-left device, close to the Trader Joe’s markup lettering', () => {
    // the markup's label positions (points), in the tech's letter order
    const rtu1: [string, number, number][] = [
      ['1A', 961, 716],
      ['1B', 921, 927],
      ['1C', 917, 1075],
      ['1D', 1053, 1008],
      ['1E', 1283, 961],
      ['1F', 1451, 888],
      ['1G', 1570, 1020],
      ['1H', 1618, 907],
      ['1J', 1586, 727],
      ['1K', 1490, 704],
    ];
    const rtu2: [string, number, number][] = [
      ['2A', 913, 1151],
      ['2B', 946, 1433],
      ['2C', 1151, 1438],
      ['2D', 1269, 1404],
      ['2E', 1407, 1435],
      ['2F', 1566, 1437],
      ['2G', 1617, 1242],
      ['2H', 1611, 1122],
      ['2J', 1510, 1233],
      ['2K', 1420, 1273],
      ['2L', 1224, 1273],
    ];
    // shuffled in: the order comes from the geometry alone. The tech followed the duct run; the nearest-next walk
    // agrees except where a branch doubles back (1G / 1H swapped; RTU-2 walks the near branch first), which the
    // sheet view's "start here" and reorder cover.
    const w1 = walkOrder([...rtu1].reverse().map(([k, x, y]) => dev(k, x, y))).map((d) => d.key);
    expect(w1).toEqual(['1A', '1B', '1C', '1D', '1E', '1F', '1H', '1G', '1J', '1K']);
    const w2 = walkOrder([...rtu2].reverse().map(([k, x, y]) => dev(k, x, y))).map((d) => d.key);
    expect(w2.slice(0, 4)).toEqual(['2A', '2B', '2C', '2D']);
    expect([...w2].sort()).toEqual(rtu2.map(([k]) => k).sort());
    // a chosen start
    const ds = rtu1.map(([k, x, y]) => dev(k, x, y));
    expect(
      walkOrder(ds, ds[2])
        .map((d) => d.key)
        .slice(0, 3),
    ).toEqual(['1C', '1B', '1D']);
    expect(walkOrder([])).toEqual([]);
  });

  it('rows: letter, area, type, the report’s size spelling, design CFM; the design check', () => {
    const ds = [
      dev('a', 0, 0, { size: '8"Ø', cfm: 200 }),
      dev('b', 1, 1, { type: 'SR1', size: '12"x8"', cfm: 290 }),
      dev('c', 2, 2, { size: '12" DIA', cfm: null }),
    ];
    expect(rowsForDevices(ds, 'Sales')).toEqual([
      { no: 'A', area: 'Sales', type: 'S1', size: '8"R', designCfm: 200 },
      { no: 'B', area: 'Sales', type: 'SR1', size: '12"x8"', designCfm: 290 },
      { no: 'C', area: 'Sales', type: 'S1', size: '12"R', designCfm: null },
    ]);
    expect(reportSize('14 x 14')).toBe('14x14');
    expect(reportSize('10"ø')).toBe('10"R');
    expect(reportSize(null)).toBeNull();
    expect(designCheck(ds, 500)).toEqual({ total: 490, unit: 500, ratio: 0.98, ok: true });
    expect(designCheck(ds, 400).ok).toBe(false);
    expect(designCheck(ds, null)).toEqual({ total: 490, unit: null, ratio: null, ok: null });
    expect(designCheck([dev('x', 0, 0, { cfm: null })], 400).total).toBeNull();
  });

  it('markup prefixes and colours follow the a2b convention', () => {
    expect(systemPrefix('RTU-1', 'supply')).toBe('1');
    expect(systemPrefix('RTU-1', 'return')).toBe('1R');
    expect(systemPrefix('RTU-2', 'oa')).toBe('2O');
    expect(systemPrefix('DOAS-1', 'supply')).toBe('D1');
    expect(systemPrefix('EF-1', 'exhaust')).toBe('E1');
    expect(systemPrefix('KEF-2', 'exhaust')).toBe('E2');
    expect(systemPrefix('WSHP-3', 'supply')).toBe('3');
    expect(systemPrefix('VAV 12', 'outlets')).toBe('V12');
    expect(nextSystemColor([])).toBe('#ff809d');
    expect(nextSystemColor([{ color: '#ff809d' }, { color: '#38e5ff' }])).toBe('#ff7002');
  });
});
