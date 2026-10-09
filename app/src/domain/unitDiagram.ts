/**
 * The unit diagram behind the static pressure profile, in the unit's own component order: the sections of the cabinet
 * (from the unit configuration library when the unit matches an entry, else the unit type's order in the revision 08
 * template) and the static taps placed where each reading was taken. Drawn by the unit page (UnitDiagram.tsx) and the
 * graphics appendix (reports/graphics.ts). Pure.
 *
 * The readings belong to the template's components (entering, then the leaving static of each component of the unit
 * type, in airflow order: RTU Filter, Coil, Reheat, Fan, Heat ...). Each tap goes after the matching component in the
 * unit's order; the last component's leaving static is the discharge, in the supply duct. A reading whose component
 * the library order puts past the fan while the template has it before the fan is the fan inlet static and is drawn
 * there; one with no matching component follows the tap before it.
 */
import type { UnitComponent, UnitComponentKind } from '../data/types';
import { ABSENT, unitTypeRow, xlNum, type StaticInputs, type XCell } from './staticProfile';
import { spKey } from './staticSlots';

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
  /** -1 = the unit's entering static, 0-5 = the leaving static of the template's component k. */
  slot: number;
  /** The unit field the reading is in (spEntering, spCoil, spFan ...). */
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

/** Template components as library kinds; a component also takes the listed stand-ins. */
const SLOT_KINDS: Record<string, UnitComponentKind[]> = {
  Filter: ['filter'],
  Wheel: ['wheel', 'desiccant'],
  Core: ['wheel'],
  Coil: ['coil'],
  Desiccant: ['desiccant', 'wheel'],
  Reheat: ['reheat'],
  Burner: ['burner', 'heat'],
  Fan: ['fan'],
  Heat: ['heat', 'burner'],
};
const TEMPLATE_KIND: Record<string, UnitComponentKind> = {
  Filter: 'filter',
  Wheel: 'wheel',
  Core: 'wheel',
  Coil: 'coil',
  Desiccant: 'desiccant',
  Reheat: 'reheat',
  Burner: 'burner',
  Fan: 'fan',
  Heat: 'heat',
};

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export interface DiagramOptions {
  /** The unit data says it has no filters ("Unit has filters?" No): no filter section and no filter tap. */
  noFilters?: boolean;
  /** The unit has a reheat coil ("Has reheat coil?" Yes); without it the template's reheat is left out. */
  hasReheat?: boolean;
}

export function unitDiagram(
  input: StaticInputs,
  components?: readonly UnitComponent[] | null,
  opts: DiagramOptions = {},
): UnitDiagram {
  const row = unitTypeRow(input.unitType);
  // the template's components this unit has (a reheat only when the unit has one, unless a reading is there)
  const read = (k: number) => input.leaving[k] !== undefined && input.leaving[k] !== null && input.leaving[k] !== '';
  const tplLabels = row.labels.map((l, k) =>
    l === 'Reheat' && !opts.hasReheat && !read(k) ? ABSENT : l === 'Filter' && opts.noFilters ? ABSENT : l,
  );
  const fromLibrary = Boolean(components?.length);
  const sections: DiagramSection[] = [];
  if (fromLibrary) {
    // the library's dampers are the inlet section; otherwise the template's inlet ("RA / OA")
    if (components![0].kind !== 'damper') sections.push({ kind: 'inlet', name: row.inlet || 'Inlet' });
    for (const c of components!) {
      if (c.kind === 'reheat' && c.optional && !opts.hasReheat && !tplLabels.includes('Reheat')) continue;
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
    for (const l of tplLabels)
      if (l && l !== ABSENT)
        sections.push({ kind: TEMPLATE_KIND[l] ?? 'other', name: SECTION_NAME[TEMPLATE_KIND[l] ?? 'other'] });
  }
  if (opts.noFilters)
    for (let i = sections.length - 1; i > 0; i--) if (sections[i].kind === 'filter') sections.splice(i, 1);
  const last = sections.length - 1;
  const fanAt = sections.findIndex((s) => s.kind === 'fan');
  const tplFan = tplLabels.indexOf('Fan');
  // first section matching a template component (dampers and the inlet never match)
  const find = (label: string) => {
    for (const k of SLOT_KINDS[label] ?? []) {
      const i = sections.findIndex((s) => s.kind === k);
      if (i >= 0) return i;
    }
    return -1;
  };
  const taps: DiagramTap[] = [
    {
      slot: -1,
      field: 'spEntering',
      entered: 'Entering',
      name: 'Unit inlet',
      station: 0,
      inDuct: false,
      value: input.entering ?? null,
    },
  ];
  const notes: string[] = [];
  let prev = 0;
  tplLabels.forEach((label, k) => {
    if (!label || label === ABSENT) return;
    const value = input.leaving[k] ?? null;
    const entered = `${label} leaving`;
    const field = spKey(label);
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
    if (fanAt >= 0 && at > fanAt && tplFan >= 0 && k < tplFan) {
      const s = sections[at];
      const note = `the ${lower(s.name)} is after the fan on this unit, so the ${lower(entered)} reading is the fan inlet static`;
      taps.push({ slot: k, field, entered, name: 'Fan inlet', station: fanAt - 1, inDuct: false, value, note });
      if (xlNum(value) !== null) notes.push(`Drawn at the fan inlet: ${note}.`);
      prev = fanAt - 1;
      return;
    }
    // the last section's leaving static is the discharge, in the supply duct
    if (at === last) {
      taps.push({ slot: k, field, entered, name: 'Discharge', station: last, inDuct: true, value });
      prev = at;
      return;
    }
    const s = sections[at];
    taps.push({ slot: k, field, entered, name: `${s.name} leaving`, station: at, inDuct: false, value });
    prev = at;
  });
  // airflow order: by station, the duct last; ties keep the template's order
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
      spans.push({
        from,
        to: i,
        dp: v - xlNum(a.value)!,
        across: sections.slice(lo, hi + 1).map((s) => s.name),
        fan: fanAt >= lo && fanAt <= hi,
      });
    }
    from = i;
  });
  if (fromLibrary) {
    const tplOrder = tplLabels.filter((l) => l && l !== ABSENT).join(' → ');
    const own = sections
      .filter((s) => s.kind !== 'inlet' && s.kind !== 'damper')
      .map((s) => s.name)
      .join(' → ');
    if (tplOrder && notes.length + Number(orderDiffers(tplLabels, sections)) > 0)
      notes.unshift(`The workbook lists ${tplOrder}; drawn here in this unit's order, ${own}.`);
  }
  if (opts.noFilters) notes.push('No filters on this unit (unit data), so no filter section.');
  return { source: fromLibrary ? 'library' : 'template', sections, taps: sorted, spans, notes };
}

/** The template's components (that this unit has) come in a different order than the unit's. */
function orderDiffers(labels: readonly string[], sections: readonly DiagramSection[]): boolean {
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
