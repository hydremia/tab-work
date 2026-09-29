import { describe, expect, it } from 'vitest';
import { EQUIPMENT_TYPES, isHydronic, nextFreeSlot, suggestDesignation, workbookDef } from './equipmentTypes';

describe('equipment types', () => {
  it('capacities come from the template map', () => {
    const cap = Object.fromEntries(EQUIPMENT_TYPES.map((t) => [t.key, t.capacity]));
    expect(cap).toEqual({
      rtu: 40,
      mau: 10,
      erv: 10,
      fan: 40,
      smallFan: 40,
      vav: 80,
      hood: 20,
      traverse: 48,
      pump: 20,
      valveSystem: 25,
      plant: 40,
      flowMeasurement: 24,
    });
  });
  it('airside types first, then the hydronic workbook types', () => {
    expect(EQUIPMENT_TYPES.filter((t) => t.discipline === 'hydronic').map((t) => t.key)).toEqual([
      'pump',
      'valveSystem',
      'plant',
      'flowMeasurement',
    ]);
    expect(isHydronic('pump')).toBe(true);
    expect(isHydronic('rtu')).toBe(false);
    expect(workbookDef('valveSystem')?.block.sheet).toBe('Valves');
    expect(workbookDef('rtu')?.block.sheet).toBe('RTUs');
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
