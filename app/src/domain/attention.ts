/**
 * Needs-attention view (pure): one project-wide list of what a tech or PM should look at before issuing a report,
 * grouped, each item linked to the unit (and section) or page it concerns.
 *
 *   design       R8 schedule design CFM vs. the outlet design sum; unit ESP actual vs. design (± tolerance)
 *   motor        measured amps above corrected FLA × SF; estimated BHP above the nameplate HP
 *   tolerance    readings / unit totals outside ± the project tolerance
 *   photos       started units still missing a required photo
 *   issues       open issues
 *   capacity     a type at its workbook capacity; small fans past slot 30 (not on Building Balance)
 *   calibration  instruments used on units without a calibration row, or calibrated more than 12 months before
 *                the TAB date (or with no date)
 */
import type { AirflowRow, Equipment, Instrument, Issue, Photo, Project } from '../data/types';
import { formatNumber, formatPercent } from './calc';
import { computeCompletion, type Completion } from './completion';
import { EQUIPMENT_TYPES, equipmentType, slotCollisions } from './equipmentTypes';
import {
  calibrationExpired,
  impliedNeeds,
  INSTRUMENT_FIELDS,
  matchingRows,
  needFor,
  type InstrumentNeed,
} from './instruments';
import { motorCalc, motorInputs, motorWarnings } from './motorCalcs';
import { getSpec } from './specs';
import { espDiscrepancy, staticInputs, staticProfile } from './staticProfile';
import { unitCells } from '../workbook/adapter';

export type AttentionGroup = 'design' | 'motor' | 'tolerance' | 'photos' | 'issues' | 'capacity' | 'calibration';

export const ATTENTION_GROUPS: { key: AttentionGroup; title: string }[] = [
  { key: 'tolerance', title: 'Out of tolerance' },
  { key: 'issues', title: 'Open issues' },
  { key: 'design', title: 'Design discrepancies' },
  { key: 'motor', title: 'Motor checks' },
  { key: 'photos', title: 'Missing required photos' },
  { key: 'calibration', title: 'Calibration' },
  { key: 'capacity', title: 'Capacity' },
];

export interface AttentionItem {
  id: string;
  group: AttentionGroup;
  /** Unit designation, issue label or page ("Info"). */
  subject: string;
  text: string;
  /** App path to open (relative to the project: `e/<id>#sec-…`, `issues`, `info#cal-h`). */
  to: string;
  equipmentId?: string;
}

export interface AttentionInput {
  project: Project;
  equipment: readonly Equipment[];
  rows: readonly AirflowRow[];
  photos: readonly Pick<Photo, 'equipmentId' | 'category'>[];
  issues: readonly Issue[];
  instruments: readonly Instrument[];
  /** Completions already computed (the project status); computed here when missing. */
  completions?: ReadonlyMap<string, Completion>;
}

const hasSectionCalc = (e: Equipment, calc: string) => getSpec(e.type).sections.some((s) => s.calc === calc);
const sectionOfField = (e: Equipment, key: string) =>
  getSpec(e.type).sections.find((s) => s.fields.some((f) => f.key === key))?.key;

export function needsAttention(input: AttentionInput): AttentionItem[] {
  const { project, instruments } = input;
  const items: AttentionItem[] = [];
  const tol = project.tolerance;
  const byOrder = [...input.equipment].sort(
    (a, b) =>
      EQUIPMENT_TYPES.findIndex((t) => t.key === a.type) - EQUIPMENT_TYPES.findIndex((t) => t.key === b.type) ||
      a.slot - b.slot,
  );
  const openIssues = input.issues.filter((i) => i.status === 'Open');
  const used = new Map<string, { need: InstrumentNeed; units: string[]; to: string }>();
  const markUsed = (need: InstrumentNeed, e: Equipment, section: string | undefined) => {
    const k = need.meter;
    const u = used.get(k) ?? { need, units: [], to: `e/${e.id}${section ? `#sec-${section}` : ''}` };
    if (!u.units.includes(e.designation)) u.units.push(e.designation);
    used.set(k, u);
  };

  for (const e of byOrder) {
    const unitPath = (section?: string) => `e/${e.id}${section ? `#sec-${section}` : ''}`;
    const c =
      input.completions?.get(e.id) ??
      computeCompletion({
        spec: getSpec(e.type),
        unit: e,
        rows: input.rows.filter((r) => r.equipmentId === e.id),
        photos: input.photos.filter((p) => p.equipmentId === e.id),
        project,
        openIssues: openIssues.filter((i) => i.equipmentId === e.id).length,
      });
    const add = (group: AttentionGroup, key: string, text: string, section?: string) =>
      items.push({
        id: `${group}:${e.id}:${key}`,
        group,
        subject: e.designation,
        text,
        to: unitPath(section),
        equipmentId: e.id,
      });

    // tolerance
    for (const t of c.outOfTolerance) {
      const sec = getSpec(e.type).sections.find((s) => s.tables?.some((x) => x.key === t.table))?.key;
      add(
        'tolerance',
        `${t.table}:${t.rowId}`,
        `${t.label}: ${formatPercent(t.ratio)} of design (±${Math.round(tol * 100)} %)`,
        sec,
      );
    }
    // design (R8) + ESP
    for (const d of c.designDiscrepancies) {
      add(
        'design',
        `r8:${d.field}`,
        `Schedule ${formatNumber(d.schedule)} CFM vs. ${d.label} ${formatNumber(d.outlets)} CFM`,
        sectionOfField(e, d.field),
      );
    }
    const cells = unitCells(e, c);
    if (c.fields.unitEsp && hasSectionCalc(e, 'staticProfile')) {
      const esp = espDiscrepancy(cells.unitEsp, staticProfile(staticInputs(cells)).esp, tol);
      if (esp)
        add(
          'design',
          'esp',
          `Unit ESP: design ${formatNumber(esp.design, 2)} vs. actual ${formatNumber(esp.actual, 2)} in. w.g. (${formatPercent(esp.ratio)})`,
          'static',
        );
    }
    // motor
    if (hasSectionCalc(e, 'motor')) {
      const inp = motorInputs(cells);
      for (const w of motorWarnings(motorCalc(inp), inp, cells.serviceFactor, cells.hp))
        add('motor', w.key, w.text, 'motor');
    }
    // photos (started units only: a unit not started yet is simply "to do")
    if (c.started) {
      const missing = Object.entries(c.photos).filter(([, r]) => r.state === 'missing');
      if (missing.length) {
        const labels = getSpec(e.type)
          .sections.flatMap((s) => s.photos ?? [])
          .filter((p) => missing.some(([k]) => k === p.category))
          .map((p) => p.label);
        add('photos', 'photos', `Missing: ${labels.join(', ')}`, 'photos');
      }
    }
    // instruments used
    for (const f of INSTRUMENT_FIELDS) {
      const need = needFor(e.data[f]);
      if (need) markUsed(need, e, sectionOfField(e, f));
    }
    for (const need of impliedNeeds(e)) markUsed(need, e, undefined);
  }

  // issues
  for (const i of [...openIssues].sort((a, b) =>
    a.kind === b.kind ? a.number - b.number : a.kind === 'new' ? -1 : 1,
  )) {
    const unit = i.equipmentId ? input.equipment.find((e) => e.id === i.equipmentId) : undefined;
    items.push({
      id: `issues:${i.id}`,
      group: 'issues',
      subject: `Issue ${i.kind === 'new' ? 'N' : 'E'}-${i.number}${unit ? ` · ${unit.designation}` : ''}`,
      text: i.remark.trim() || '(no remark yet)',
      to: 'issues',
      equipmentId: unit?.id,
    });
  }

  // capacity
  for (const t of EQUIPMENT_TYPES) {
    const list = input.equipment.filter((e) => e.type === t.key);
    if (list.length >= t.capacity)
      items.push({
        id: `capacity:${t.key}`,
        group: 'capacity',
        subject: t.plural,
        text: `${list.length} of ${t.capacity} ${t.plural}: the workbook has no room for more`,
        to: 'equipment',
      });
    if (t.warnAbove) {
      const past = list.filter((e) => e.slot > t.warnAbove!).sort((a, b) => a.slot - b.slot);
      if (past.length)
        items.push({
          id: `capacity:${t.key}:past`,
          group: 'capacity',
          subject: t.plural,
          text: `${past.map((e) => e.designation).join(', ')} past slot ${t.warnAbove}: not on Building Balance (left out of the exhaust total)`,
          to: `e/${past[0].id}`,
          equipmentId: past[0].id,
        });
    }
  }

  // workbook slot collisions (two devices gave new units the same slot; sync moves the later one when it can)
  for (const c of slotCollisions(input.equipment)) {
    const t = equipmentType(c.type);
    const list = c.ids
      .map((id) => input.equipment.find((e) => e.id === id)!)
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    const names = list.map((e) => e.designation);
    const full = !hasFreeSlot(input.equipment, c.type, t.capacity);
    items.push({
      id: `capacity:slot:${c.type}:${c.slot}`,
      group: 'capacity',
      subject: t.plural,
      text: `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} both use slot ${c.slot}: ${
        full
          ? `the workbook has no free ${t.plural.replace(/s$/, '')} slot. Delete one (or another ${t.plural.replace(/s$/, '')}); only ${names[0]} is exported`
          : 'the next sync moves the later one to a free slot'
      }`,
      to: `e/${list[list.length - 1].id}`,
      equipmentId: list[list.length - 1].id,
    });
  }

  // calibration
  const tabDate = project.info.tabDate;
  for (const { need, units, to } of used.values()) {
    const rows = matchingRows(need, instruments);
    const who = `${need.label}${units.length ? ` (${units.slice(0, 6).join(', ')}${units.length > 6 ? ` +${units.length - 6}` : ''})` : ''}`;
    if (!rows.length) {
      items.push({
        id: `calibration:none:${need.meter}`,
        group: 'calibration',
        subject: who,
        text: `No calibration row for ${need.meter}`,
        to,
      });
      continue;
    }
    // covered when at least one matching meter is in date
    const inDate = rows.filter((r) => r.calibrationDate && !calibrationExpired(r.calibrationDate, tabDate));
    if (inDate.length) continue;
    const r = rows[0];
    const name = [r.type, r.manufacturer, r.model].filter(Boolean).join(' ');
    items.push({
      id: `calibration:old:${need.meter}`,
      group: 'calibration',
      subject: who,
      text: r.calibrationDate
        ? `${name}: calibrated ${r.calibrationDate}, more than 12 months before the TAB date${typeof tabDate === 'string' && tabDate ? ` (${tabDate})` : ''}`
        : `${name}: no calibration date`,
      to: 'info#cal-h',
    });
  }
  return items;
}

function hasFreeSlot(units: readonly Equipment[], type: string, capacity: number): boolean {
  const used = new Set(units.filter((e) => e.type === type).map((e) => e.slot));
  return used.size < capacity;
}

/** Items per group in display order (empty groups left out). */
export function groupAttention(
  items: readonly AttentionItem[],
): { key: AttentionGroup; title: string; items: AttentionItem[] }[] {
  return ATTENTION_GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.key) })).filter(
    (g) => g.items.length,
  );
}
