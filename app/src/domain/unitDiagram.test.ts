import { describe, expect, it } from 'vitest';
import type { LibraryUnit } from '../data/types';
import { matchLibraryUnit } from './unitLibrary';
import { UNIT_LIBRARY_SEED } from './unitLibrarySeed';
import { unitDiagram } from './unitDiagram';

const library: LibraryUnit[] = UNIT_LIBRARY_SEED.map((s, i) => ({ ...s, id: `u${i}`, createdAt: 0, updatedAt: 0 }));
const comps = (make: string, model: string) => matchLibraryUnit(library, make, model)!.components;
const measured = (d: ReturnType<typeof unitDiagram>) => d.taps.filter((t) => t.value !== null);

/** Revision 08 positions: RTU Filter, Coil, Reheat, Fan, Heat, —; MAU Filter, Burner, Fan; DOAS Filter, Wheel, Coil, Reheat, Fan, Heat. */
describe('unit diagram', () => {
  it('Capitola RTU-3 (Carrier 48GE, 3-point): coil leaving at the fan inlet side, the heat after the fan, discharge in the duct', () => {
    const d = unitDiagram(
      { unitType: 'RTU', entering: -0.317, leaving: [null, -0.806, null, null, 0.514, null] },
      comps('Carrier', '48GERN24B2P6-3U5C0'),
    );
    expect(d.source).toBe('library');
    // the optional Humidi-MiZer coil is left out: the unit has no reheat
    expect(d.sections.map((s) => s.name)).toEqual(['RA / OA dampers', 'Filter', 'Cooling coil', 'Fan', 'Heat']);
    expect(measured(d).map((t) => [t.name, t.station, t.inDuct, t.field])).toEqual([
      ['Unit inlet', 0, false, 'spEntering'],
      ['Cooling coil leaving', 2, false, 'spCoil'],
      ['Discharge', 4, true, 'spHeat'],
    ]);
    expect(d.spans.map((s) => [s.across.join(' · '), s.fan, Number(s.dp.toFixed(3))])).toEqual([
      ['Filter · Cooling coil', false, -0.489],
      ['Fan · Heat', true, 1.32],
    ]);
    expect(d.notes).toEqual([]); // the revision 08 order is the unit's
  });

  it('a unit with reheat draws the library reheat coil', () => {
    const d = unitDiagram(
      { unitType: 'RTU', entering: -0.3, leaving: [-0.4, -0.7, -0.8, null, 0.5, null] },
      comps('Carrier', '48GERN24B2P6-3U5C0'),
      { hasReheat: true },
    );
    expect(d.sections.map((s) => s.kind)).toEqual(['damper', 'filter', 'coil', 'reheat', 'fan', 'heat']);
    expect(measured(d).map((t) => t.name)).toEqual([
      'Unit inlet',
      'Filter leaving',
      'Cooling coil leaving',
      'Reheat coil leaving',
      'Discharge',
    ]);
  });

  it('Capitola RTU-1 (Munters HCUc entered as an RTU): the desiccant wheel between the coil and the fan', () => {
    const d = unitDiagram(
      { unitType: 'RTU', entering: -1.26, leaving: [-1.53, -2.35, null, null, 0.572, null] },
      comps('Munters', 'HCUC8040ACS'),
    );
    expect(measured(d).map((t) => t.name)).toEqual([
      'Unit inlet',
      'Filter leaving',
      'Cooling coil leaving',
      'Discharge',
    ]);
    expect(d.spans.at(-1)!.across).toEqual(['Desiccant wheel', 'Fan', 'Heat']);
  });

  it('a direct-fired MAU: burner before the fan, the fan leaving static is the discharge', () => {
    const d = unitDiagram(
      { unitType: 'MAU', entering: -0.355, leaving: [null, -0.921, 0.339, null, null, null] },
      comps('CaptiveAire', 'A2-D.250-20D'),
    );
    expect(d.sections.map((s) => s.kind)).toEqual(['inlet', 'filter', 'burner', 'fan']);
    expect(measured(d).map((t) => [t.name, t.station, t.inDuct])).toEqual([
      ['Unit inlet', 0, false],
      ['Burner leaving', 2, false],
      ['Discharge', 3, true],
    ]);
    expect(d.notes).toEqual([]);
  });

  it('without a library entry: the unit type order of the revision 08 template', () => {
    const d = unitDiagram({ unitType: 'RTU', entering: -0.5, leaving: [-0.6, -0.9, null, null, 0.5, null] });
    expect(d.source).toBe('template');
    expect(d.sections.map((s) => s.name)).toEqual(['RA / OA', 'Filter', 'Cooling coil', 'Fan', 'Heat']);
    expect(d.taps.map((t) => t.name)).toEqual([
      'Unit inlet',
      'Filter leaving',
      'Cooling coil leaving',
      'Fan leaving',
      'Discharge',
    ]);
    expect(d.spans.map((s) => s.across)).toEqual([['Filter'], ['Cooling coil'], ['Fan', 'Heat']]);
    expect(d.notes).toEqual([]);
  });

  it('a DOAS wheel reading on a desiccant unit goes after the wheel, past the coil, in airflow order', () => {
    const d = unitDiagram(
      { unitType: 'DOAS', entering: -1, leaving: [-1.2, -2.4, -1.9, null, null, 0.5] },
      comps('Munters', 'HCUC8040'),
    );
    expect(measured(d).map((t) => t.name)).toEqual([
      'Unit inlet',
      'Filter leaving',
      'Cooling coil leaving',
      'Desiccant wheel leaving',
      'Discharge',
    ]);
    expect(d.notes[0]).toMatch(
      /^The workbook lists Filter → Wheel → Coil → Fan → Heat; drawn here in this unit's order/,
    );
  });

  it('a unit whose data says it has no filters: no filter section, no filter tap, a note', () => {
    const d = unitDiagram(
      { unitType: 'MAU', entering: -0.3, leaving: [null, -0.6, 0.8, null, null, null] },
      comps('CaptiveAire', 'A2-D.250-20D'),
      { noFilters: true },
    );
    expect(d.sections.map((s) => s.kind)).toEqual(['inlet', 'burner', 'fan']);
    expect(d.taps.map((t) => t.name)).toEqual(['Unit inlet', 'Burner leaving', 'Discharge']);
    expect(d.spans[0].across).toEqual(['Burner']);
    expect(d.notes).toEqual(['No filters on this unit (unit data), so no filter section.']);
  });
});
