import { describe, expect, it } from 'vitest';
import type { Equipment } from '../data/types';
import { traverseTotals } from './equipmentCalcs';
import { seqKey } from './specs';
import { lineSync, lineFromTraverse, traverseLinkLabel, traverseLinks } from './traverseLinks';

const u = (id: string, type: Equipment['type'], designation: string, data: Equipment['data'] = {}) => ({
  id,
  type,
  designation,
  data,
});

describe('traverse links', () => {
  const rtu = u('r3', 'rtu', 'RTU-3');
  const t1 = u('t1', 'traverse', 'T-1', { traverseOf: 'r3', traverseLine: 'oa1' });
  const t2 = u('t2', 'traverse', 'T-2', { traverseOf: 'r3' });
  const t3 = u('t3', 'traverse', 'T-3');
  const names = new Map([['oa1', { rowId: 'oa1', equipmentId: 'r3', short: 'OA', long: 'OA (Outside air)' }]]);

  it('groups the traverses by unit and by line', () => {
    const { byUnit, byLine } = traverseLinks([t2, rtu, t1, t3]);
    expect(byUnit.get('r3')?.map((t) => t.designation)).toEqual(['T-1', 'T-2']);
    expect(byLine.get('oa1')?.map((t) => t.designation)).toEqual(['T-1']);
    expect(byUnit.size).toBe(1);
  });

  it('labels the link: unit and line, the unit alone, nothing when unlinked or the unit is gone', () => {
    expect(traverseLinkLabel(t1, [rtu], names)).toBe('RTU-3 · OA (Outside air)');
    expect(traverseLinkLabel(t2, [rtu], names)).toBe('RTU-3');
    expect(traverseLinkLabel(t3, [rtu], names)).toBeNull();
    expect(traverseLinkLabel(t1, [], names)).toBeNull();
  });

  it("fills a line with the traverse's size, Ak and velocity (VEL x Ak = the traverse CFM)", () => {
    const readings = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [seqKey('readings', i + 1), 800 + i * 10]),
    );
    const t = u('t', 'traverse', 'T-1', { shape: 'Round', width: 8, initialVel: 700, ...readings });
    const line = lineFromTraverse(t);
    const tot = traverseTotals(t.data);
    expect(line).toMatchObject({ size: tot.sizeText, ak: tot.ak, initialVel: 700, finalVel: tot.finalVel });
    expect(Math.round((line.finalVel as number) * (line.ak as number))).toBe(tot.finalCfm);
  });

  it('keeps a linked line in step: changes only, velocities the traverse lost are cleared, nothing before a reading', () => {
    const t = u('t', 'traverse', 'T-1', { shape: 'Round', width: 14, initialVel: 900 });
    const tot = traverseTotals(t.data);
    const row = { data: { size: 'old', ak: 9, initialVel: 500, finalVel: 480 } };
    expect(lineSync(t, row)).toEqual({
      'data.size': tot.sizeText,
      'data.ak': tot.ak,
      'data.initialVel': 900,
      'data.finalVel': null,
    });
    expect(lineSync(t, { data: { size: tot.sizeText, ak: tot.ak, initialVel: 900 } })).toEqual({});
    expect(lineSync(u('t0', 'traverse', 'T-0', { shape: 'Round', width: 14 }), row)).toEqual({});
  });
});
