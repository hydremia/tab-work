import { describe, expect, it } from 'vitest';
import { EQUIPMENT_TYPES, nextFreeSlot, suggestDesignation } from './equipmentTypes';

describe('equipment types', () => {
  it('capacities come from the template map', () => {
    const cap = Object.fromEntries(EQUIPMENT_TYPES.map((t) => [t.key, t.capacity]));
    expect(cap).toEqual({ rtu: 40, mau: 10, erv: 10, fan: 40, smallFan: 40, vav: 80, hood: 20, traverse: 48 });
  });
  it('next free slot fills gaps', () => {
    expect(nextFreeSlot([1, 2, 4], 5)).toBe(3);
    expect(nextFreeSlot([1, 2], 2)).toBeNull();
  });
  it('suggests the next designation', () => {
    expect(suggestDesignation('RTU-', ['RTU-1', 'RTU-7', 'AHU-9'])).toBe('RTU-8');
    expect(suggestDesignation('EF-S', ['EF-S1'])).toBe('EF-S2');
    expect(suggestDesignation('VAV-', [])).toBe('VAV-1');
  });
});
