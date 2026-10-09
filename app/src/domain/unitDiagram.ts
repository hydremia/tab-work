/**
 * The unit diagram behind the static pressure profile, in the unit's own component order: the sections of the cabinet
 * (from the unit configuration library when the unit matches an entry, else the template's fixed order) and the
 * static taps placed where each reading of the strip was taken. Drawn by the unit page (UnitDiagram.tsx) and the
 * graphics appendix (reports/graphics.ts). Pure.
 *
 * The strip's readings belong to the template's slots (entering, then the leaving static of Filter, Wheel / Core,
 * Coil, Heat / Burner, Fan). Each tap goes after the matching component in the unit's order, with two rules:
 *   - the fan's leaving static is the discharge, in the supply duct past every component;
 *   - a slot whose component sits after the fan on this unit (an RTU's heat, blow-through) cannot be read between it
 *     and the fan: the template puts it just before the fan, so it is the fan inlet static and is drawn there.
 * A slot with no matching component follows the tap before it.
 */
import type { UnitComponent, UnitComponentKind } from '../data/types';
import { ABSENT, unitTypeRow, xlNum, type StaticInputs, type XCell } from './staticProfile';

export type DiagramKind = UnitComponentKind | 'inlet';

export interface DiagramSection {
  kind: DiagramKind;
  /** Short name drawn under the section ("Cooling coil"). */
  name: string;
  /** The library's own words for it ("Humidi-MiZer reheat coil"), when they differ. */
  detail?: string;
  optional?: boolean;
}

export interface DiagramTap {
  /** -1 = the unit's entering static, 0-4 = the leaving static of template slot k. */
  slot: number;
  /** The unit field the reading is in (spEntering, spLeaving1 ... spLeaving5). */
  field: string;
  /** The template's name for the reading ("Heat leaving"). */
  entered: string;
  /** Where it is on this unit ("Fan inlet"). */
  name: string;
  /** Station: the tap is just after section `station`; `inDuct` = in the supply duct past the last section. */
  station: number;
  inDuct: boolean;
  value: XCell;
  /** Why it is drawn somewhere other than its slot name says. */
  note?: string;
}

export interface DiagramSpan {
  /** Taps (indexes into `taps`) at each end. */
  from: number;
  to: number;
  dp: number;
  /** Names of the sections between the two taps. */
  across: string[];
  /** The span holds the fan: a rise, not a drop. */
  fan: boolean;
}

export interface UnitDiagram {
  source: 'library' | 'template';
  sections: DiagramSection[];
  /** In airflow order. */
  taps: DiagramTap[];
  /** Consecutive measured taps and the pressure change between them. */
  spans: DiagramSpan[];
  notes: string[];
}

export const SECTION_NAME: Record<DiagramKind, string> = {
  inlet: 'Inlet',
  damper: 'Dampers',
  filter: 'Filter',
  wheel: 'ERV wheel',
  coil: 'Cooling coil',
  reheat: 'Reheat coil',
  desiccant: 'Desiccant wheel',
  burner: 'Burner',
  heat: 'Heat',
  fan: 'Fan',
  finalFilter: 'Final filter',
  other: 'Other',
};

/** Template slot names as library kinds; a slot also takes the listed stand-ins. */
const SLOT_KINDS: Record<string, UnitComponentKind[]> = {
  Filter: ['filter'],
  Wheel: ['wheel', 'desiccant'],
  Core: ['wheel'],
  Coil: ['coil'],
  Heat: ['heat', 'burner'],
  Burner: ['burner', 'heat'],
  Fan: ['fan'],
};
const TEMPLATE_KIND: Record<string, UnitComponentKind> = {
  Filter: 'filter',
  Wheel: 'wheel',
  Core: 'wheel',
  Coil: 'coil',
  Heat: 'heat',
  Burner: 'burner',
  Fan: 'fan',
};

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export interface DiagramOptions {
  /** The unit data says it has no filters ("Unit has filters?" No): no filter section and no filter tap. */
  noFilters?: boolean;
}

export function unitDiagram(
  input: StaticInputs,
  components?: readonly UnitComponent[] | null,
  opts: DiagramOptions = {},
): UnitDiagram {
  const row = unitTypeRow(input.unitType);
  const fromLibrary = Boolean(components?.length);
  const sections: DiagramSection[] = [];
  if (fromLibrary) {
    // the library's dampers are the inlet section; otherwise the template's inlet ("RA / OA")
    if (components![0].kind !== 'damper') sections.push({ kind: 'inlet', name: row.inlet || 'Inlet' });
    for (const c of components!) {
      const name = c.kind === 'damper' ? (row.inlet ? `${row.inlet} dampers` : 'Dampers') : SECTION_NAME[c.kind];
      const detail = c.label?.trim();
      sections.push({
        kind: c.kind,
        name: c.kind === 'other' && detail ? detail : name,
        ...(detail && detail !== name ? { detail } : {}),
        ...(c.optional ? { optional: true } : {}),
      });
    }
  } else {
    sections.push({ kind: 'inlet', name: row.inlet || 'Inlet' });
    for (const l of row.labels) if (l && l !== ABSENT) sections.push({ kind: TEMPLATE_KIND[l] ?? 'other', name: l });
  }
  if (opts.noFilters)
    for (let i = sections.length - 1; i > 0; i--) if (sections[i].kind === 'filter') sections.splice(i, 1);
  const last = sections.length - 1;
  const fanAt = sections.findIndex((s) => s.kind === 'fan');
  // first section matching a template slot (dampers and the inlet never match)
  const find = (label: string) => {
    const kinds = SLOT_KINDS[label] ?? [];
    for (const k of kinds) {
      const i = sections.findIndex((s) => s.kind === k);
      if (i >= 0) return i;
    }
    return -1;
  };
  // the first section is always the inlet (or the library's dampers): the entering static is read just past it
  const inletStation = 0;
  const taps: DiagramTap[] = [
    {
      slot: -1,
      field: 'spEntering',
      entered: 'Entering',
      name: 'Unit inlet',
      station: inletStation,
      inDuct: false,
      value: input.entering ?? null,
    },
  ];
  const notes: string[] = [];
  let prev = inletStation;
  row.labels.forEach((label, k) => {
    const value = input.leaving[k] ?? null;
    if (!label || label === ABSENT) return;
    // no filters on this unit: the filter's leaving static is N/A (blank on the sheet), so no tap for it
    if (label === 'Filter' && opts.noFilters) return;
    const entered = `${label} leaving`;
    const field = `spLeaving${k + 1}`;
    if (label === 'Fan') {
      taps.push({ slot: k, field, entered, name: 'Discharge', station: last, inDuct: true, value });
      return;
    }
    const at = find(label);
    if (at < 0) {
      taps.push({
        slot: k,
        field,
        entered,
        name: entered,
        station: prev,
        inDuct: false,
        value,
        note: `this unit has no ${lower(label)} in its library order; drawn with the tap before it`,
      });
      return;
    }
    if (fanAt >= 0 && at > fanAt) {
      const s = sections[at];
      const note = `the ${lower(s.name)} is after the fan on this unit, so the ${lower(entered)} reading is the fan inlet static`;
      taps.push({ slot: k, field, entered, name: 'Fan inlet', station: fanAt - 1, inDuct: false, value, note });
      if (xlNum(value) !== null) notes.push(`Drawn at the fan inlet: ${note}.`);
      prev = fanAt - 1;
      return;
    }
    const s = sections[at];
    taps.push({ slot: k, field, entered, name: `${s.name} leaving`, station: at, inDuct: false, value });
    prev = at;
  });
  // airflow order: by station, the duct last; ties keep the strip's order
  const order = taps.map((t, i) => ({ t, i }));
  order.sort((a, b) => Number(a.t.inDuct) - Number(b.t.inDuct) || a.t.station - b.t.station || a.i - b.i);
  const sorted = order.map((o) => o.t);
  const spans: DiagramSpan[] = [];
  let from = -1;
  sorted.forEach((t, i) => {
    const v = xlNum(t.value);
    if (v === null) return;
    if (from >= 0) {
      const a = sorted[from];
      const lo = a.station + 1;
      const hi = t.inDuct ? last : t.station;
      const across = sections.slice(lo, hi + 1).map((s) => s.name);
      spans.push({
        from,
        to: i,
        dp: v - xlNum(a.value)!,
        across,
        fan: fanAt >= lo && fanAt <= hi,
      });
    }
    from = i;
  });
  if (fromLibrary) {
    const tplOrder = row.labels.filter((l) => l && l !== ABSENT).join(' → ');
    const own = sections
      .filter((s) => s.kind !== 'inlet' && s.kind !== 'damper')
      .map((s) => s.name)
      .join(' → ');
    if (tplOrder && notes.length + Number(sameOrderDiffers(row.labels, sections)) > 0)
      notes.unshift(`The workbook strip lists ${tplOrder}; drawn here in this unit's order, ${own}.`);
  }
  if (opts.noFilters) notes.push('No filters on this unit (unit data), so no filter section.');
  return { source: fromLibrary ? 'library' : 'template', sections, taps: sorted, spans, notes };
}

/** The template's components (that this unit has) come in a different order than the unit's. */
function sameOrderDiffers(labels: readonly string[], sections: readonly DiagramSection[]): boolean {
  const pos = labels
    .filter((l) => l && l !== ABSENT)
    .map((l) => {
      for (const k of SLOT_KINDS[l] ?? []) {
        const i = sections.findIndex((s) => s.kind === k);
        if (i >= 0) return i;
      }
      return -1;
    })
    .filter((i) => i >= 0);
  return pos.some((p, i) => i > 0 && p < pos[i - 1]);
}
