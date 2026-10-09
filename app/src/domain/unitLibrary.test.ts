import { describe, expect, it } from 'vitest';
import type { LibraryUnit } from '../data/types';
import { compareWithTemplate, isBuiltIn, makeMatches, matchLibraryUnit, orderText, withBuiltIn } from './unitLibrary';
import { UNIT_LIBRARY_SEED } from './unitLibrarySeed';

const library: LibraryUnit[] = UNIT_LIBRARY_SEED.map((s, i) => ({ ...s, id: `u${i}`, createdAt: 0, updatedAt: 0 }));
const line = (make: string, model: string) => matchLibraryUnit(library, make, model)?.line ?? null;

describe('unit configuration library', () => {
  it('an empty team library still matches the researched lines (built in); the team entry wins', () => {
    const m = matchLibraryUnit(withBuiltIn([]), 'Munters', 'HCUC8040ACS')!;
    expect(isBuiltIn(m)).toBe(true);
    expect(m.components!.map((c) => c.kind)).toEqual(['damper', 'filter', 'coil', 'desiccant', 'fan', 'heat']);
    const own: LibraryUnit = { ...m, id: 'team-1', notes: 'edited by the team', components: [{ kind: 'fan' }] };
    const lib = withBuiltIn([own]);
    expect(lib.filter((u) => u.line === m.line)).toHaveLength(1);
    expect(matchLibraryUnit(lib, 'Munters', 'HCUC8040ACS')!.id).toBe('team-1');
  });

  it('matches the Capitola units by make and model (case, spaces, dashes and dots ignored)', () => {
    expect(line('Carrier', '48GERN24B2P6-3U5C0')).toBe('WeatherMaster 48GE');
    expect(line('Carrier', '48GEHN06B2P6-3U5A0')).toBe('WeatherMaster 48GE');
    expect(line('Munters', 'HCUC8040ACS-GBBS60M-LFTSM0GBB-0B0B… (verify)')).toBe('DryCool HCUc / Standard (desiccant)');
    expect(line('CaptiveAire', 'A2-D.250-20D')).toBe('Direct-fired make-up air, A-series (A1-A5 D)');
    expect(line('Captive-Aire', 'D76')).toBe('D76 compact direct-fired heater');
    expect(line('carrier corp', '48tc-d08a2a5')).toBe('WeatherMaker 48TC / 48HC, WeatherExpert 48LC');
    expect(line('Johnson Controls', 'ZJ078N10')).toBe('Predator, Sun Pro, ZE/XN, ZJ/ZR/ZF 3-25 ton');
  });

  it('no match without the make, for another make, or for an unknown model', () => {
    expect(line('', '48GERN24')).toBeNull();
    expect(line('Trane', '48GERN24')).toBeNull();
    expect(line('Carrier', '50XC-12')).toBeNull();
    expect(makeMatches('York, Johnson Controls', 'JCI')).toBe(false);
  });

  it('the most specific pattern wins', () => {
    const lib: LibraryUnit[] = [
      { ...library[0], id: 'a', make: 'X', line: 'all', modelPatterns: 'AB*' },
      { ...library[0], id: 'b', make: 'X', line: 'specific', modelPatterns: 'ABC12*' },
    ];
    expect(matchLibraryUnit(lib, 'X', 'abc-1234')?.line).toBe('specific');
    expect(matchLibraryUnit(lib, 'X', 'ab99')?.line).toBe('all');
  });

  it('order in words, and the template order compared: the revision 08 RTU and MAU orders match, a desiccant unit entered as a DOAS is flagged', () => {
    const ge = matchLibraryUnit(library, 'Carrier', '48GERN24')!;
    expect(orderText(ge.components)).toBe(
      'Economizer / OA-RA dampers (option) → Filter → Evaporator coil → Humidi-MiZer reheat coil (option) → Vane-axial direct-drive indoor fan (EcoBlue) → Gas heat exchanger',
    );
    // revision 08: Filter, Coil, Reheat, Fan, Heat (the heat after the fan, a place for the reheat)
    expect(compareWithTemplate('RTU', ge.components)).toEqual({ sameOrder: true, notes: [] });
    const mau = compareWithTemplate('MAU', matchLibraryUnit(library, 'CaptiveAire', 'A2-D.250-20D')!.components)!;
    expect(mau).toEqual({ sameOrder: true, notes: [] });
    // Capitola RTU-2: a desiccant unit entered as a DOAS: the revision 08 DOAS has the wheel after the coil too
    expect(compareWithTemplate('DOAS', matchLibraryUnit(library, 'Munters', 'HCUC8040')!.components)).toEqual({
      sameOrder: true,
      notes: [],
    });
    // an energy-recovery wheel ahead of the coil (a library configuration) is flagged against the DOAS order
    const erw = [{ kind: 'filter' as const }, { kind: 'wheel' as const }, { kind: 'coil' as const }, { kind: 'fan' as const }];
    expect(compareWithTemplate('DOAS', erw)!.notes[0]).toBe(
      "The template draws Filter → Coil → Wheel → Fan; this unit's order is Filter → Wheel → Coil → Fan.",
    );
    // the DHU unit type is its order
    expect(compareWithTemplate('DHU', matchLibraryUnit(library, 'Munters', 'HCUC8040')!.components)).toEqual({
      sameOrder: true,
      notes: [],
    });
    // RTU-1, the same model entered as an RTU: the order agrees, but the RTU has no wheel (enter it as a DHU)
    expect(compareWithTemplate('RTU', matchLibraryUnit(library, 'Munters', 'HCUC8040')!.components)!.notes[0]).toMatch(
      /no place for: Desiccant wheel/,
    );
    expect(compareWithTemplate('RTU', null)).toBeNull();
  });

  it('every seeded entry is complete enough to show', () => {
    for (const s of UNIT_LIBRARY_SEED) {
      expect(s.make && s.line && s.unitType && s.evidence).toBeTruthy();
      expect(['stated', 'inferred', 'unconfirmed']).toContain(s.confidence);
      for (const d of s.documents ?? []) expect(d.title).toBeTruthy();
    }
  });
});
