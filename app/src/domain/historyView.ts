/**
 * Change history view (pure): readable field labels, old / new value text, filters and grouping by time for the
 * History tab and the unit page's History section. Entries come from the `history` table (data/history.ts).
 */
import type {
  AirflowRow,
  Equipment,
  HistoryEntry,
  Instrument,
  Issue,
  NaMark,
  PhotoCategory,
  ProjectLock,
  Review,
} from '../data/types';
import { CATEGORY_LABEL } from '../photos/labels';
import { CERT_LABELS } from './certification';
import { PRESSURE_FIELDS, PRESSURE_KEYS } from './projectCompletion';
import { SPARE_OA_LABELS } from './spareOa';
import { INFO_FIELDS } from './projectFields';
import { getSpec, tableColumns, type EquipmentSpec } from './specs';

/** The records a label may need (current state; deleted records fall back to generic text). */
export interface HistoryContext {
  equipment: ReadonlyMap<string, Equipment>;
  rows: ReadonlyMap<string, AirflowRow>;
  issues: ReadonlyMap<string, Issue>;
  instruments: ReadonlyMap<string, Instrument>;
}

export const emptyContext = (): HistoryContext => ({
  equipment: new Map(),
  rows: new Map(),
  issues: new Map(),
  instruments: new Map(),
});

export function makeContext(input: {
  equipment?: readonly Equipment[];
  rows?: readonly AirflowRow[];
  issues?: readonly Issue[];
  instruments?: readonly Instrument[];
}): HistoryContext {
  const byId = <T extends { id: string }>(xs: readonly T[] | undefined) => new Map((xs ?? []).map((x) => [x.id, x]));
  return {
    equipment: byId(input.equipment),
    rows: byId(input.rows),
    issues: byId(input.issues),
    instruments: byId(input.instruments),
  };
}

const PRESSURE_LABEL: Record<string, string> = {
  [PRESSURE_KEYS.buildingRemarks]: 'Building vs Outdoors remarks',
  [PRESSURE_KEYS.kitchenRemarks]: 'Kitchen vs Dining remarks',
  [PRESSURE_KEYS.spareTest]: 'Spare pressure: test space',
  [PRESSURE_KEYS.spareRef]: 'Spare pressure: reference space',
  [PRESSURE_KEYS.spareDp]: 'Spare pressure ΔP',
  [PRESSURE_KEYS.spareRemarks]: 'Spare pressure remarks',
  [PRESSURE_KEYS.notes]: 'Building pressure notes',
};

function infoLabel(key: string): string {
  return (
    PRESSURE_LABEL[key] ??
    CERT_LABELS[key] ??
    SPARE_OA_LABELS[key] ??
    INFO_FIELDS.find((f) => f.key === key)?.label.replace(/:.*$/, '') ??
    PRESSURE_FIELDS.find((f) => f.key === key)?.label ??
    key
  );
}

/** Label of a unit field key: form fields, reading runs (PSP velocity 3), photos, tables, sections. */
export function unitFieldLabel(spec: EquipmentSpec, key: string): string {
  for (const s of spec.sections) {
    const f = s.fields.find((x) => x.key === key);
    if (f) return f.label;
    for (const q of s.sequences ?? []) {
      const m = new RegExp(`^${q.key}_(\\d+)$`).exec(key);
      if (m) return `${q.label} ${m[1]}`;
    }
  }
  return key;
}

function unitNaLabel(spec: EquipmentSpec, key: string): string {
  if (key.startsWith('photo:')) {
    const cat = key.slice(6);
    const p = spec.sections.flatMap((s) => s.photos ?? []).find((x) => x.category === cat);
    return `${p?.label ?? CATEGORY_LABEL[cat as PhotoCategory] ?? cat} photo`;
  }
  if (key.startsWith('table:')) {
    const t = spec.sections.flatMap((s) => s.tables ?? []).find((x) => x.key === key.slice(6));
    return t?.label ?? key.slice(6);
  }
  if (key.startsWith('seq:')) {
    const q = spec.sections.flatMap((s) => s.sequences ?? []).find((x) => x.key === key.slice(4));
    return q?.label ?? key.slice(4);
  }
  return unitFieldLabel(spec, key);
}

const RECORD_FIELD: Record<string, string> = {
  designation: 'Designation',
  isExisting: 'New / Existing',
  review: 'Review',
  slot: 'Workbook slot',
  slotMove: 'Slot move note',
};

const issueName = (i: Pick<Issue, 'kind' | 'number'>) => `Issue ${i.kind === 'existing' ? 'E' : 'N'}-${i.number}`;

/** Readable label of the field an entry changed ("Serial number", "Supply outlets S-2: Final VEL", "FLA N/A"). */
export function fieldLabel(e: HistoryEntry, ctx: HistoryContext): string {
  const f = e.field;
  const [head, ...rest] = f.split('.');
  const tail = rest.join('.');
  switch (e.table) {
    case 'projects': {
      if (f === 'name') return 'Project name';
      if (f === 'lock') return 'Report lock';
      if (head === 'info') return infoLabel(tail);
      if (head === 'naState' && rest[0] === 'fields') return `${infoLabel(rest.slice(1).join('.'))} N/A`;
      if (head === 'blueprints') {
        const [i, k] = rest;
        return i === undefined
          ? 'Blueprints'
          : `Blueprint ${Number(i) + 1} ${k === 'revisionDate' ? 'revision date' : 'sheet'}`;
      }
      if (f === 'tolerance') return 'Tolerance';
      if (f === 'scopeProfile') return 'Scope profile';
      if (head === 'customScope') return 'Custom scope';
      if (f === 'reportKind') return 'Report kind';
      return f;
    }
    case 'equipment': {
      const unit = e.recordId ? ctx.equipment.get(e.recordId) : undefined;
      if (RECORD_FIELD[f]) return RECORD_FIELD[f];
      if (!unit) return tail || f;
      const spec = getSpec(unit.type);
      if (head === 'data') return unitFieldLabel(spec, tail);
      if (head === 'naState') {
        if (rest[0] === 'equipment') return 'Whole unit N/A';
        if (rest[0] === 'fields') return `${unitNaLabel(spec, rest.slice(1).join('.'))} N/A`;
        if (rest[0] === 'sections') {
          const s = spec.sections.find((x) => x.key === rest[1]);
          return `${s?.label ?? rest[1]} section N/A`;
        }
      }
      return f;
    }
    case 'airflowRows': {
      const row = e.recordId ? ctx.rows.get(e.recordId) : undefined;
      const unit = row
        ? ctx.equipment.get(row.equipmentId)
        : e.equipmentId
          ? ctx.equipment.get(e.equipmentId)
          : undefined;
      const t =
        unit && row
          ? getSpec(unit.type)
              .sections.flatMap((s) => s.tables ?? [])
              .find((x) => x.key === row.table)
          : undefined;
      const no = row?.data.no;
      const where = `${t?.label ?? 'Row'}${no ? ` ${String(no)}` : ''}`;
      if (f === 'order') return `${where}: order`;
      const col = t ? tableColumns(t).find((c) => c.key === rest.join('.').replace(/^fields\./, '')) : undefined;
      if (head === 'data') return `${where}: ${col?.label ?? tail}`;
      if (head === 'na') return `${where}: ${col?.label ?? tail} N/A`;
      return `${where}: ${f}`;
    }
    case 'issues': {
      const issue = e.recordId ? ctx.issues.get(e.recordId) : undefined;
      const name = issue ? issueName(issue) : 'Issue';
      const labels: Record<string, string> = {
        remark: 'remark',
        status: 'status',
        comments: 'comments',
        equipmentId: 'linked unit',
        number: 'number',
        kind: 'New / Existing',
      };
      return `${name} ${labels[f] ?? f}`;
    }
    case 'photos': {
      const labels: Record<string, string> = {
        caption: 'Photo caption',
        category: 'Photo category',
        order: 'Photo order',
        equipmentId: 'Photo unit',
        issueId: 'Photo issue',
      };
      return labels[f] ?? `Photo ${f}`;
    }
    case 'instruments': {
      const ins = e.recordId ? ctx.instruments.get(e.recordId) : undefined;
      const labels: Record<string, string> = {
        type: 'type',
        manufacturer: 'manufacturer',
        model: 'model',
        serial: 'serial',
        calibrationDate: 'calibration date',
        order: 'order',
      };
      if (f === 'libraryId') return `Instrument${ins ? ` ${ins.order + 1}` : ''} library link`;
      return `Instrument${ins ? ` ${ins.order + 1}` : ''} ${labels[f] ?? f}`;
    }
    case 'libraryInstruments':
      return `Instrument library ${f === 'calibrationDate' ? 'calibration date' : f}`;
    default:
      return f;
  }
}

const isNaMark = (v: unknown): v is NaMark =>
  Boolean(v) && typeof v === 'object' && typeof (v as NaMark).notation === 'string';

const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Old / new value as text: "—" = not known (entries from before schema v4), "blank" = empty. */
export function valueText(e: HistoryEntry, v: unknown, ctx: HistoryContext): string {
  if (v === undefined) return '—';
  if (v === null || v === '') return 'blank';
  if (e.table === 'equipment' && e.field === 'isExisting') return v ? 'Existing' : 'New';
  if (e.field === 'equipmentId' && typeof v === 'string') return ctx.equipment.get(v)?.designation ?? 'a deleted unit';
  if (e.field === 'issueId' && typeof v === 'string') {
    const i = ctx.issues.get(v);
    return i ? issueName(i) : 'a deleted issue';
  }
  if (e.table === 'equipment' && e.field === 'review' && typeof v === 'object')
    return `Reviewed${(v as Review).name ? ` by ${(v as Review).name}` : ''}`;
  if (e.table === 'projects' && e.field === 'lock' && typeof v === 'object')
    return `Issued as ${(v as ProjectLock).label}`;
  if (e.table === 'projects' && e.field === 'tolerance' && typeof v === 'number') return `±${Math.round(v * 100)} %`;
  if (e.table === 'equipment' && e.field === 'slotMove' && typeof v === 'object')
    return `Moved from slot ${(v as { from: number }).from} to ${(v as { to: number }).to}`;
  if (isNaMark(v)) return `${v.notation}${v.reason ? ` (${v.reason})` : ''}`;
  if (v === 'applies') return 'Include (override scope)';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number' || typeof v === 'string') return clip(String(v).replace(/\s+/g, ' '));
  return clip(JSON.stringify(v));
}

/** Who: the name given on the device, else the user id (signed in) or "Local user", plus a short device id. */
export function actorText(e: Pick<HistoryEntry, 'userId' | 'userName' | 'deviceId'>): string {
  const who = e.userName || (e.userId && e.userId !== 'local' ? e.userId.slice(0, 8) : 'Local user');
  return `${who} · device ${e.deviceId.slice(0, 4)}`;
}
export const actorKey = (e: Pick<HistoryEntry, 'userId' | 'deviceId'>) => `${e.userId}|${e.deviceId}`;

/** What an entry is about: the unit's designation, "Project", or an issue / instrument. */
export function subjectText(e: HistoryEntry, ctx: HistoryContext): string {
  if (e.kind === 'lock' || e.kind === 'unlock' || e.kind === 'revision' || e.kind === 'import') return 'Report';
  if (e.equipmentId)
    return (
      ctx.equipment.get(e.equipmentId)?.designation ?? (e.table === 'equipment' && e.note ? e.note : 'Deleted unit')
    );
  switch (e.table) {
    case 'issues':
      return 'Issues';
    case 'photos':
      return 'Photos';
    case 'instruments':
      return 'Instruments';
    default:
      return 'Project';
  }
}

const SOURCE_TEXT: Record<NonNullable<HistoryEntry['source']>, string> = {
  import: 're-import',
  schedule: 'schedule import',
  remote: 'synced',
  auto: 'automatic',
};
export const sourceText = (e: HistoryEntry) => (e.source ? SOURCE_TEXT[e.source] : '');

/** One line of an entry: an event sentence, or a field change (label, old, new). */
export type HistoryLine = { type: 'event'; text: string } | { type: 'change'; label: string; from: string; to: string };

export function describeEntry(e: HistoryEntry, ctx: HistoryContext): HistoryLine {
  switch (e.kind) {
    case 'lock':
      return { type: 'event', text: `Report issued and locked as ${(e.value as ProjectLock | null)?.label ?? '?'}` };
    case 'unlock':
      return {
        type: 'event',
        text: `Report unlocked for follow-up${e.previous && typeof e.previous === 'object' ? ` (was ${(e.previous as ProjectLock).label})` : ''}`,
      };
    case 'review':
      return {
        type: 'event',
        text: `Marked reviewed${(e.value as Review | null)?.name ? ` by ${(e.value as Review).name}` : ''}`,
      };
    case 'review-cleared':
      return {
        type: 'event',
        text: e.source === 'auto' ? 'Review cleared automatically (the unit changed)' : 'Review cleared',
      };
    case 'revision':
      return { type: 'event', text: e.note ?? 'Exported' };
    case 'import':
      return { type: 'event', text: `Re-imported ${e.note ?? ''}`.trim() };
    case 'conflict':
      return {
        type: 'event',
        text: e.table
          ? `Sync conflict on ${fieldLabel(e, ctx)}: "${valueText(e, e.value, ctx)}" kept, "${valueText(e, e.previous, ctx)}" flagged${e.note ? ` (${e.note})` : ''}`
          : `Sync: ${e.note ?? 'conflict'}`,
      };
    case 'conflict-resolved':
      return {
        type: 'event',
        text: e.table
          ? `Conflict on ${fieldLabel(e, ctx)} resolved: ${e.note ?? ''}${e.value !== undefined ? ` ("${valueText(e, e.value, ctx)}")` : ''}`
          : `Sync: ${e.note ?? 'resolved'}`,
      };
    case 'create':
      return { type: 'event', text: `Added ${createdText(e, ctx)}` };
    case 'delete':
      return { type: 'event', text: `Deleted ${createdText(e, ctx)}` };
    default:
      return {
        type: 'change',
        label: fieldLabel(e, ctx),
        from: valueText(e, e.previous, ctx),
        to: valueText(e, e.value, ctx),
      };
  }
}

function createdText(e: HistoryEntry, ctx: HistoryContext): string {
  const noun: Record<string, string> = {
    projects: 'project',
    equipment: 'unit',
    airflowRows: 'row',
    issues: 'issue',
    photos: 'photo',
    instruments: 'instrument',
  };
  if (e.table === 'issues' && e.recordId) {
    const i = ctx.issues.get(e.recordId);
    if (i) return issueName(i);
  }
  return e.note || noun[e.table ?? ''] || 'record';
}

// ------------------------------------------------------------------------------------------ filters, grouping
export interface HistoryFilter {
  /** '' = all, 'project' = project-level (no unit), else a unit id. */
  unit?: string;
  /** Text matched against the field label / event text (case-insensitive). */
  field?: string;
  /** ISO dates (inclusive, local days). */
  from?: string;
  to?: string;
  /** actorKey(); '' = everyone. */
  actor?: string;
}

const dayStart = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

export function filterHistory(entries: readonly HistoryEntry[], f: HistoryFilter, ctx: HistoryContext): HistoryEntry[] {
  const from = f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from) ? dayStart(f.from) : -Infinity;
  const to = f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to) ? dayStart(f.to) + 24 * 3600 * 1000 : Infinity;
  const q = f.field?.trim().toLowerCase();
  return entries.filter((e) => {
    if (e.ts < from || e.ts >= to) return false;
    if (f.unit === 'project' && e.equipmentId) return false;
    if (f.unit && f.unit !== 'project' && e.equipmentId !== f.unit) return false;
    if (f.actor && actorKey(e) !== f.actor) return false;
    if (q) {
      const line = describeEntry(e, ctx);
      const text = line.type === 'event' ? line.text : line.label;
      if (!text.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

export interface HistoryGroup {
  key: string;
  /** Newest / oldest entry time of the group. */
  last: number;
  first: number;
  subject: string;
  actor: string;
  /** 'edit' for a run of edits / creates / deletes; the event kind for review / lock / unlock / revision / import. */
  kind: HistoryEntry['kind'];
  entries: HistoryEntry[];
}

export interface HistoryDay {
  day: string;
  label: string;
  groups: HistoryGroup[];
}

const EVENT_KINDS = new Set<HistoryEntry['kind']>([
  'review',
  'review-cleared',
  'lock',
  'unlock',
  'revision',
  'import',
  'conflict',
  'conflict-resolved',
]);

/** Entries within this gap, by the same person on the same subject, form one group. */
export const GROUP_GAP_MS = 10 * 60 * 1000;

const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Group newest-first entries by local day, then into runs of edits (same person, same subject, ≤ 10 min apart). */
export function groupHistory(entries: readonly HistoryEntry[], ctx: HistoryContext): HistoryDay[] {
  const sorted = [...entries].sort((a, b) => b.ts - a.ts);
  const days: HistoryDay[] = [];
  for (const e of sorted) {
    const dk = dayKey(e.ts);
    let day = days[days.length - 1];
    if (!day || day.day !== dk) {
      day = {
        day: dk,
        label: new Date(e.ts).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        groups: [],
      };
      days.push(day);
    }
    const subject = subjectText(e, ctx);
    const actor = actorText(e);
    const kind = EVENT_KINDS.has(e.kind) ? e.kind : 'edit';
    const g = day.groups[day.groups.length - 1];
    if (
      g &&
      kind === 'edit' &&
      g.kind === 'edit' &&
      g.subject === subject &&
      g.actor === actor &&
      g.first - e.ts <= GROUP_GAP_MS
    ) {
      g.entries.push(e);
      g.first = e.ts;
    } else {
      day.groups.push({ key: e.id, last: e.ts, first: e.ts, subject, actor, kind, entries: [e] });
    }
  }
  return days;
}
