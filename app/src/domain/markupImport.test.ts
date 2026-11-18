import { describe, expect, it } from 'vitest';
import type { Equipment, PlanSheetDevice } from '../data/types';
import type { MarkupLabel, MarkupShape } from '../workbook/pdfAnnotations';
import { letterOrder, markupSystems, parseLabel, tableFor, unitScore } from './markupImport';

const unit = (designation: string, type: Equipment['type'] = 'rtu'): Equipment =>
  ({
    id: `u-${designation}`,
    projectId: 'p',
    type,
    designation,
    slot: 1,
    isExisting: false,
    data: {},
    naState: { sections: {}, fields: {} },
    createdAt: 0,
    updatedAt: 0,
  }) as unknown as Equipment;
const dev = (key: string, x: number, y: number, type = 'S1', cfm: number | null = 565): PlanSheetDevice => ({
  key,
  tag: { x, y, box: { x0: x - 5, y0: y - 5, x1: x + 5, y1: y + 5 }, lines: [type, String(cfm)] },
  type,
  size: null,
  cfm,
  x,
  y,
  how: 'leader',
  count: 1,
  index: 0,
});
const label = (text: string, x: number, y: number, color: string | null = '#38e5ff'): MarkupLabel => ({
  text,
  x,
  y,
  box: { x0: x - 8, y0: y - 6, x1: x + 8, y1: y + 6 },
  color,
});

describe('markup import', () => {
  it('parses the a2b labels: unit letters, number, side and letter', () => {
    expect(parseLabel('3A')).toMatchObject({ letters: '', number: '3', side: '', letter: 'A', prefix: '3' });
    expect(parseLabel('1RA')).toMatchObject({ letters: '', number: '1', side: 'R', letter: 'A', prefix: '1R' });
    expect(parseLabel('2OB')).toMatchObject({ number: '2', side: 'O', letter: 'B', prefix: '2O' });
    expect(parseLabel('D1C')).toMatchObject({ letters: 'D', number: '1', side: '', letter: 'C', prefix: 'D1' });
    expect(parseLabel('E1E')).toMatchObject({ letters: 'E', number: '1', side: '', letter: 'E', prefix: 'E1' });
    expect(parseLabel('rtu-2 b')).toMatchObject({ letters: 'RTU', number: '2', letter: 'B', prefix: 'RTU2' });
    expect(parseLabel('12AA')).toMatchObject({ number: '12', letter: 'AA' });
    expect(parseLabel('3RAA')).toMatchObject({ number: '3', side: 'R', letter: 'AA' });
    // not labels: a note, a size, a plain number, a unit tag
    expect(parseLabel('SEE NOTE 3')).toBeNull();
    expect(parseLabel('12x8')).toBeNull();
    expect(parseLabel('14')).toBeNull();
    expect(parseLabel('RTU-1')).toBeNull();
    expect([...'ABHJKNPQZ'].map(letterOrder)).toEqual([0, 1, 7, 8, 9, 12, 13, 14, 23]);
    expect(letterOrder('AA')).toBeGreaterThan(letterOrder('Z'));
  });

  it('matches units by number and kind: no letters → the packaged unit, D → DOAS, E → EF, W → WSHP', () => {
    const rtu1 = unit('RTU-1');
    const doas1 = unit('DOAS-1');
    const ef1 = unit('EF-1', 'fan');
    const wshp1 = unit('WSHP-1');
    const p = parseLabel('1A')!;
    expect(unitScore(p, rtu1)).toBeGreaterThan(unitScore(p, doas1));
    expect(unitScore(parseLabel('D1A')!, doas1)).toBeGreaterThan(unitScore(parseLabel('D1A')!, rtu1));
    expect(unitScore(parseLabel('E1A')!, ef1)).toBeGreaterThan(0);
    expect(unitScore(parseLabel('E1A')!, rtu1)).toBe(0);
    expect(unitScore(parseLabel('W1A')!, wshp1)).toBe(4);
    expect(unitScore(parseLabel('2A')!, rtu1)).toBe(0);
    expect(tableFor(rtu1, 'R')).toBe('return');
    expect(tableFor(rtu1, 'O')).toBe('oa');
    expect(tableFor(rtu1, '')).toBe('supply');
    expect(tableFor(ef1, '')).toBe('outlets');
  });

  it('groups labels into systems in letter order, matches the nearest device once, picks the shape round them', () => {
    const equipment = [unit('RTU-1'), unit('RTU-2'), unit('DOAS-1'), unit('EF-1', 'fan')];
    const devices = [
      dev('d0', 100, 100, 'S1', 565),
      dev('d1', 200, 100, 'S4', 525),
      dev('d2', 300, 100, 'S1', 400),
      dev('d3', 100, 300, 'R3', 2100),
      dev('d4', 500, 500, 'S1', 280),
    ];
    const labels = [
      label('1B', 205, 115),
      label('1A', 108, 112),
      label('1C', 290, 112),
      label('1RA', 100, 318),
      label('2A', 512, 512, '#ff7002'),
      label('2B', 700, 700, '#ff7002'), // no device within reach: a row with no values
      label('E1A', 100, 600, '#ffd100'),
      label('NOTE: VERIFY ON SITE', 400, 400),
    ];
    const shapes: MarkupShape[] = [
      {
        kind: 'polygon',
        points: [
          [50, 50],
          [350, 50],
          [350, 150],
          [50, 150],
        ],
        color: '#38e5ff',
      },
    ];
    const systems = markupSystems(labels, shapes, equipment, devices);
    expect(
      systems.map((s) => [s.prefix, s.unit?.designation, s.table, s.items.map((i) => i.label.letter).join('')]),
    ).toEqual([
      ['1', 'RTU-1', 'supply', 'ABC'],
      ['1R', 'RTU-1', 'return', 'A'],
      ['2', 'RTU-2', 'supply', 'AB'],
      ['E1', 'EF-1', 'outlets', 'A'],
    ]);
    const s1 = systems[0];
    expect(s1.items.map((i) => i.device?.key)).toEqual(['d0', 'd1', 'd2']);
    expect(s1.polygon).toEqual(shapes[0].points);
    expect(s1.color).toBe('#38e5ff');
    expect(systems[1].items[0].device?.key).toBe('d3');
    expect(systems[1].polygon.length).toBeGreaterThanOrEqual(4); // a hull round the one label
    const s2 = systems[2];
    expect(s2.items.map((i) => i.device?.key ?? null)).toEqual(['d4', null]);
    expect(s2.color).toBe('#ff7002');
    expect(systems.every((s) => s.duplicates.length === 0)).toBe(true);
  });

  it('labels beside their devices in a tight row each keep their own device (least total distance, not nearest first)', () => {
    // registers 27 pt apart, each label 18 pt to the right of its own device (9 pt from the next device)
    const devices = [dev('a', 802, 1314), dev('b', 829, 1314), dev('c', 856, 1314)];
    const labels = [label('3C', 820, 1314), label('3D', 847, 1314), label('3E', 874, 1314)];
    const [s] = markupSystems(labels, [], [unit('RTU-3')], devices);
    expect(s.items.map((i) => [i.label.letter, i.device?.key])).toEqual([
      ['C', 'a'],
      ['D', 'b'],
      ['E', 'c'],
    ]);
  });

  it('a TYP group stacked at its tag still serves labels spread along the duct (second pass, wider reach)', () => {
    // "(TYP 5) 12x8 SR1 285" at (773, 1328): the reader placed all five at the tag; the tech's labels run 200 pt
    const typ = (key: string, index: number): PlanSheetDevice => ({
      ...dev(key, 773, 1328, 'SR1', 285),
      count: 5,
      index,
    });
    const devices = [
      typ('t-0', 0),
      typ('t-1', 1),
      typ('t-2', 2),
      typ('t-3', 3),
      typ('t-4', 4),
      dev('x', 1200, 1328, 'S1', 400),
    ];
    const labels = ['3A', '3B', '3C', '3D', '3E'].map((t, i) => label(t, 700 + i * 60, i % 2 ? 1350 : 1300));
    const [s] = markupSystems(labels, [], [unit('RTU-3')], devices);
    expect(s.items.map((i) => i.device?.cfm)).toEqual([285, 285, 285, 285, 285]);
    expect(new Set(s.items.map((i) => i.device?.key)).size).toBe(5);
    // a single device far away is not taken by the second pass
    const [s2] = markupSystems([label('3A', 700, 1300)], [], [unit('RTU-3')], [dev('x', 1000, 1300, 'S1', 400)]);
    expect(s2.items[0].device).toBeNull();
  });

  it('a repeated letter is reported; an unknown unit number leaves the unit open', () => {
    const systems = markupSystems(
      [label('3A', 0, 0), label('3A', 50, 0), label('3B', 100, 0)],
      [],
      [unit('RTU-1')],
      [],
    );
    expect(systems).toHaveLength(1);
    expect(systems[0].unit).toBeNull();
    expect(systems[0].duplicates).toEqual(['3A']);
    expect(systems[0].items).toHaveLength(3);
  });
});
