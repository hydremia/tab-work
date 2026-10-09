import { describe, expect, it } from 'vitest';
import type { LibraryUnit } from '../data/types';
import { matchLibraryUnit } from './unitLibrary';
import { UNIT_LIBRARY_SEED } from './unitLibrarySeed';
import { unitDiagram } from './unitDiagram';

const library: LibraryUnit[] = UNIT_LIBRARY_SEED.map((s, i) => ({ ...s, id: `u${i}`, createdAt: 0, updatedAt: 0 }));
const comps = (make: string, model: string) => matchLibraryUnit(library, make, model)!.components;

describe('unit diagram', () => {
  it('Capitola RTU-3 (Carrier 48GE, 3-point): the heat-leaving reading is the fan inlet, heat after the fan', () => {
    const d = unitDiagram(
      { unitType: 'RTU', entering: -0.317, leaving: [null, null, null, -0.806, 0.514] },
      comps('Carrier', '48GERN24B2P6-3U5C0'),
    );
    expect(d.source).toBe('library');
    expect(d.sections.map((s) => s.name)).toEqual([
      'RA / OA dampers',
      'Filter',
      'Cooling coil',
      'Reheat coil',
      'Fan',
      'Heat',
    ]);
    const measured = d.taps.filter((t) => t.value !== null);
    expect(measured.map((t) => [t.name, t.station, t.inDuct])).toEqual([
      ['Unit inlet', 0, false],
      ['Fan inlet', 3, false],
      ['Discharge', 5, true],
    ]);
    expect(measured[1].entered).toBe('Heat leaving');
    // the 3-point profile: one span across the filter and coils, then the fan and the heat exchanger together
    expect(d.spans.map((s) => [s.across.join(' · '), s.fan, Number(s.dp.toFixed(3))])).toEqual([
      ['Filter · Cooling coil · Reheat coil', false, -0.489],
      ['Fan · Heat', true, 1.32],
    ]);
    expect(d.notes[0]).toBe(
      "The workbook strip lists Filter → Coil → Heat → Fan; drawn here in this unit's order, Filter → Cooling coil → Reheat coil → Fan → Heat.",
    );
    expect(d.notes[1]).toMatch(/^Drawn at the fan inlet: the heat is after the fan/);
  });

  it('Capitola RTU-1 (Munters HCUc entered as an RTU): filter and coil taps in place, the desiccant wheel between coil and fan', () => {
    const d = unitDiagram(
      { unitType: 'RTU', entering: -1.26, leaving: [-1.53, null, -2.35, null, 0.572] },
      comps('Munters', 'HCUC8040ACS'),
    );
    const measured = d.taps.filter((t) => t.value !== null);
    expect(measured.map((t) => t.name)).toEqual(['Unit inlet', 'Filter leaving', 'Cooling coil leaving', 'Discharge']);
    expect(d.spans.at(-1)!.across).toEqual(['Desiccant wheel', 'Fan', 'Heat']);
    // the empty heat-leaving slot still has a place (the fan inlet) for the unit page to show
    expect(d.taps.find((t) => t.field === 'spLeaving4')!.name).toBe('Fan inlet');
  });

  it('a direct-fired MAU matches the template: no notes, burner before the fan', () => {
    const d = unitDiagram(
      { unitType: 'MAU', entering: -0.355, leaving: [null, null, -0.921, null, 0.339] },
      comps('CaptiveAire', 'A2-D.250-20D'),
    );
    expect(d.sections.map((s) => s.kind)).toEqual(['inlet', 'filter', 'burner', 'fan']);
    expect(d.taps.filter((t) => t.value !== null).map((t) => [t.name, t.station])).toEqual([
      ['Unit inlet', 0],
      ['Burner leaving', 2],
      ['Discharge', 3],
    ]);
    expect(d.notes).toEqual([]);
  });

  it('without a library entry: the template order, as the workbook strip draws it', () => {
    const d = unitDiagram({ unitType: 'RTU', entering: -0.5, leaving: [-0.6, null, -0.9, -1, 0.5] });
    expect(d.source).toBe('template');
    expect(d.sections.map((s) => s.name)).toEqual(['RA / OA', 'Filter', 'Coil', 'Heat', 'Fan']);
    expect(d.taps.map((t) => t.name)).toEqual([
      'Unit inlet',
      'Filter leaving',
      'Coil leaving',
      'Heat leaving',
      'Discharge',
    ]);
    expect(d.spans.map((s) => s.across)).toEqual([['Filter'], ['Coil'], ['Heat'], ['Fan']]);
    expect(d.notes).toEqual([]);
  });

  it('a DOAS wheel reading on a desiccant unit goes after the wheel, past the coil, in airflow order', () => {
    const d = unitDiagram(
      { unitType: 'DOAS', entering: -1, leaving: [-1.2, -2.4, -1.9, null, 0.5] },
      comps('Munters', 'HCUC8040'),
    );
    expect(d.taps.filter((t) => t.value !== null).map((t) => t.name)).toEqual([
      'Unit inlet',
      'Filter leaving',
      'Cooling coil leaving',
      'Desiccant wheel leaving',
      'Discharge',
    ]);
    expect(d.notes[0]).toMatch(/strip lists Filter → Wheel → Coil → Heat → Fan/);
  });

  it('a unit whose data says it has no filters: no filter section, no filter tap, a note', () => {
    const d = unitDiagram(
      { unitType: 'MAU', entering: -0.3, leaving: [null, null, -0.6, null, 0.8] },
      comps('CaptiveAire', 'A2-D.250-20D'),
      { noFilters: true },
    );
    expect(d.sections.map((s) => s.kind)).toEqual(['inlet', 'burner', 'fan']);
    expect(d.taps.map((t) => t.name)).toEqual(['Unit inlet', 'Burner leaving', 'Discharge']);
    expect(d.spans[0].across).toEqual(['Burner']);
    expect(d.notes).toEqual(['No filters on this unit (unit data), so no filter section.']);
    // the template order too
    const t = unitDiagram({ unitType: 'RTU', entering: -0.5, leaving: [null, null, -0.9, -1, 0.5] }, null, {
      noFilters: true,
    });
    expect(t.sections.map((s) => s.name)).toEqual(['RA / OA', 'Coil', 'Heat', 'Fan']);
  });
});
