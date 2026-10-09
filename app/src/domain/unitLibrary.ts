/**
 * The unit configuration library (data/types.ts LibraryUnit): which entry a unit matches (make + model pattern), the
 * component order in words, and how that order compares with the template's fixed order for the unit type
 * (@a2b/workbook UNIT_TYPE_COMPONENTS), so a unit page can say when the static profile is drawn in the wrong order.
 * Pure.
 */
import { UNIT_TYPE_COMPONENTS } from '@a2b/workbook/map';
import type { LibraryUnit, UnitComponent, UnitComponentKind } from '../data/types';
import { UNIT_LIBRARY_SEED } from './unitLibrarySeed';

export const COMPONENT_LABEL: Record<UnitComponentKind, string> = {
  damper: 'Dampers / economizer',
  filter: 'Filter',
  wheel: 'Energy recovery wheel',
  coil: 'Cooling coil',
  reheat: 'Reheat coil',
  desiccant: 'Desiccant wheel',
  burner: 'Burner',
  heat: 'Heat',
  fan: 'Fan',
  finalFilter: 'Final filter',
  other: 'Other',
};

export const COMPONENT_KINDS = Object.keys(COMPONENT_LABEL) as UnitComponentKind[];

export const componentLabel = (c: UnitComponent): string => c.label?.trim() || COMPONENT_LABEL[c.kind];

/** "Filter → Cooling coil → Reheat coil (option) → Fan → Heat" */
export function orderText(components: readonly UnitComponent[] | null | undefined): string {
  return (components ?? []).map((c) => `${componentLabel(c)}${c.optional ? ' (option)' : ''}`).join(' → ');
}

const norm = (s: unknown) => (typeof s === 'string' ? s.toUpperCase().replace(/[\s\-_./]/g, '') : '');
const normMake = (s: unknown) => (typeof s === 'string' ? s.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');

/** A model pattern as a regular expression over the normalized model (spaces, dashes, dots and slashes ignored). */
function patternRe(p: string): RegExp | null {
  const n = norm(p);
  if (!n) return null;
  const body = n.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : `\\${ch}`));
  return new RegExp(`^${body}$`);
}

/** The literal characters of a pattern: the more, the more specific the match. */
const specificity = (p: string) => norm(p).replace(/[*?]/g, '').length;

export function makeMatches(entryMake: string, unitMake: unknown): boolean {
  const u = normMake(unitMake);
  if (!u) return false;
  return entryMake
    .split(',')
    .map(normMake)
    .filter(Boolean)
    .some((m) => m === u || u.startsWith(m) || m.startsWith(u));
}

/** The library entry for a unit's make and model: the matching entry whose pattern is the most specific. */
export function matchLibraryUnit(
  library: readonly LibraryUnit[] | undefined,
  make: unknown,
  model: unknown,
): LibraryUnit | null {
  const m = norm(model);
  if (!library || !m) return null;
  let best: { u: LibraryUnit; score: number } | null = null;
  for (const u of library) {
    if (!makeMatches(u.make, make)) continue;
    for (const p of u.modelPatterns.split(',')) {
      const re = patternRe(p);
      if (re?.test(m)) {
        const score = specificity(p);
        if (!best || score > best.score) best = { u, score };
      }
    }
  }
  return best?.u ?? null;
}

/** A product line's identity across libraries: its first make name and its line, ignoring case. */
export const lineKey = (make: string, line: string) =>
  `${make.split(',')[0].trim().toLowerCase()}|${line.trim().toLowerCase()}`;

const BUILT_IN = 'builtin:';
export const isBuiltIn = (u: LibraryUnit) => u.id.startsWith(BUILT_IN);

/**
 * The library a unit is matched against: the team's entries, then the built-in researched lines
 * (domain/unitLibrarySeed.ts) the team's library does not hold yet, so a unit is drawn in its own order before anyone
 * loads them on the Library page. The team's entries come first: on an equally specific pattern they win.
 */
export function withBuiltIn(library: readonly LibraryUnit[] | undefined): LibraryUnit[] {
  const own = library ?? [];
  const have = new Set(own.map((u) => lineKey(u.make, u.line)));
  const builtIn = UNIT_LIBRARY_SEED.map((s, i) => ({ ...s, id: `${BUILT_IN}${i}`, createdAt: 0, updatedAt: 0 })).filter(
    (u) => !have.has(lineKey(u.make, u.line)),
  );
  return [...own, ...builtIn];
}

/** The template's components for a unit type, as library kinds ("Core" = energy recovery, "Burner" kept). */
export function templateKinds(unitType: unknown): UnitComponentKind[] {
  const list = typeof unitType === 'string' ? UNIT_TYPE_COMPONENTS[unitType] : undefined;
  if (!list) return [];
  const kind: Record<string, UnitComponentKind> = {
    Filter: 'filter',
    Wheel: 'wheel',
    Core: 'wheel',
    Coil: 'coil',
    Reheat: 'reheat',
    Desiccant: 'desiccant',
    Heat: 'heat',
    Burner: 'burner',
    Fan: 'fan',
  };
  return list.filter((x): x is string => x !== null).map((x) => kind[x] ?? 'other');
}

export interface TemplateComparison {
  /** The template draws the components it has in the same order as the library entry. */
  sameOrder: boolean;
  /** What differs, in words. */
  notes: string[];
}

/** The template's fixed order for a unit type against a library entry's order. */
export function compareWithTemplate(
  unitType: unknown,
  components: readonly UnitComponent[] | null | undefined,
): TemplateComparison | null {
  const tpl = templateKinds(unitType);
  if (!tpl.length || !components?.length) return null;
  const notes: string[] = [];
  // the burner of a direct-fired unit is the template's heat slot, and a desiccant wheel its wheel slot
  const slot = (k: UnitComponentKind) => (k === 'burner' ? 'heat' : k === 'desiccant' ? 'wheel' : k);
  const name: Partial<Record<UnitComponentKind, string>> = {
    filter: 'Filter',
    wheel: 'Wheel',
    coil: 'Coil',
    reheat: 'Reheat',
    heat: 'Heat',
    fan: 'Fan',
  };
  const tplSlots = tpl.map(slot);
  const lib = components.map((c) => slot(c.kind));
  const shared = tplSlots.filter((k) => lib.includes(k));
  const libShared = lib.filter((k, i) => shared.includes(k) && lib.indexOf(k) === i);
  const sameOrder = shared.join() === libShared.join();
  const words = (ks: UnitComponentKind[]) => ks.map((k) => name[k] ?? COMPONENT_LABEL[k]).join(' → ');
  if (!sameOrder) notes.push(`The template draws ${words(shared)}; this unit's order is ${words(libShared)}.`);
  const missing = components.filter((c) => !tplSlots.includes(slot(c.kind)) && c.kind !== 'damper');
  if (missing.length) notes.push(`The template has no place for: ${missing.map((c) => componentLabel(c)).join(', ')}.`);
  return { sameOrder, notes };
}
