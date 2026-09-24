import { describe, expect, it } from 'vitest';
import type { AirflowRow, Equipment, HistoryEntry, Issue } from '../data/types';
import { emptyNaState } from '../data/types';
import {
  actorText,
  describeEntry,
  fieldLabel,
  filterHistory,
  groupHistory,
  makeContext,
  valueText,
  GROUP_GAP_MS,
} from './historyView';

const rtu: Equipment = {
  id: 'e1',
  projectId: 'p',
  type: 'rtu',
  designation: 'RTU-1',
  slot: 1,
  isExisting: false,
  data: {},
  naState: emptyNaState(),
  createdAt: 0,
  updatedAt: 0,
};
const row: AirflowRow = {
  id: 'r1',
  projectId: 'p',
  equipmentId: 'e1',
  table: 'supply',
  order: 1,
  data: { no: 'S-2' },
  na: {},
  createdAt: 0,
  updatedAt: 0,
};
const issue: Issue = {
  id: 'i1',
  projectId: 'p',
  kind: 'existing',
  number: 3,
  remark: '',
  status: 'Open',
  comments: '',
  equipmentId: 'e1',
  createdAt: 0,
  updatedAt: 0,
};
const ctx = makeContext({ equipment: [rtu], rows: [row], issues: [issue] });

let n = 0;
const entry = (p: Partial<HistoryEntry>): HistoryEntry => ({
  id: `h${n++}`,
  projectId: 'p',
  ts: Date.UTC(2026, 8, 24, 15),
  kind: 'edit',
  table: 'equipment',
  recordId: 'e1',
  equipmentId: 'e1',
  field: 'data.serial',
  previous: null,
  value: 'SN',
  userId: 'local',
  deviceId: 'abcd1234-0000',
  ...p,
});

describe('history labels and values', () => {
  it('readable field labels for units, rows, N/A marks, project fields, issues', () => {
    expect(fieldLabel(entry({}), ctx)).toBe('Serial number');
    expect(fieldLabel(entry({ field: 'naState.fields.fla' }), ctx)).toBe('FLA N/A');
    expect(fieldLabel(entry({ field: 'naState.fields.photo:tag' }), ctx)).toBe('Unit label / tag photo N/A');
    expect(fieldLabel(entry({ field: 'naState.equipment' }), ctx)).toBe('Whole unit N/A');
    expect(fieldLabel(entry({ field: 'review' }), ctx)).toBe('Review');
    expect(fieldLabel(entry({ table: 'airflowRows', recordId: 'r1', field: 'data.finalVel' }), ctx)).toBe(
      'Supply outlets S-2: Final VEL',
    );
    expect(fieldLabel(entry({ table: 'projects', recordId: 'p', field: 'info.tabDate' }), ctx)).toBe('TAB date');
    expect(fieldLabel(entry({ table: 'projects', recordId: 'p', field: 'info.bbKitchenRemarks' }), ctx)).toBe(
      'Kitchen vs Dining remarks',
    );
    expect(fieldLabel(entry({ table: 'projects', recordId: 'p', field: 'blueprints.1.sheet' }), ctx)).toBe(
      'Blueprint 2 sheet',
    );
    expect(fieldLabel(entry({ table: 'issues', recordId: 'i1', field: 'remark' }), ctx)).toBe('Issue E-3 remark');
  });

  it('values: blank, unknown (—), N/A marks, New / Existing, linked unit, review and lock', () => {
    const e = entry({});
    expect(valueText(e, null, ctx)).toBe('blank');
    expect(valueText(e, undefined, ctx)).toBe('—');
    expect(valueText(e, { notation: 'Not Acc.', reason: 'roof' }, ctx)).toBe('Not Acc. (roof)');
    expect(valueText(entry({ field: 'isExisting' }), true, ctx)).toBe('Existing');
    expect(valueText(entry({ table: 'issues', field: 'equipmentId' }), 'e1', ctx)).toBe('RTU-1');
    expect(describeEntry(entry({ kind: 'review', field: 'review', value: { name: 'Dana' } }), ctx)).toEqual({
      type: 'event',
      text: 'Marked reviewed by Dana',
    });
    expect(
      describeEntry(entry({ kind: 'unlock', table: 'projects', field: 'lock', previous: { label: 'Prelim' } }), ctx),
    ).toEqual({ type: 'event', text: 'Report unlocked for follow-up (was Prelim)' });
    expect(describeEntry(entry({ previous: undefined }), ctx)).toEqual({
      type: 'change',
      label: 'Serial number',
      from: '—',
      to: 'SN',
    });
    expect(actorText({ userId: 'local', deviceId: 'abcd1234', userName: 'Dana' })).toBe('Dana · device abcd');
    expect(actorText({ userId: 'local', deviceId: 'abcd1234' })).toBe('Local user · device abcd');
  });
});

describe('grouping and filters', () => {
  const t0 = Date.UTC(2026, 8, 24, 15);
  const list = [
    entry({ ts: t0, field: 'data.serial' }),
    entry({ ts: t0 + 60_000, field: 'data.model' }),
    entry({ ts: t0 + 60_000 + GROUP_GAP_MS + 1, field: 'data.fla' }),
    entry({ ts: t0 + 60_000 + GROUP_GAP_MS + 2, kind: 'review', field: 'review', value: { name: 'D' } }),
    entry({ ts: t0 + 3 * 86400_000, table: 'projects', recordId: 'p', equipmentId: null, field: 'info.tabDate' }),
    entry({ ts: t0 + 3 * 86400_000 + 1, deviceId: 'ffff0000', field: 'data.hp' }),
  ];

  it('groups by day, then runs of edits by the same person on the same unit within 10 minutes', () => {
    const days = groupHistory(list, ctx);
    expect(days).toHaveLength(2);
    // newest first
    expect(days[0].groups.map((g) => [g.subject, g.entries.length])).toEqual([
      ['RTU-1', 1],
      ['Project', 1],
    ]);
    expect(days[1].groups.map((g) => [g.kind, g.entries.length])).toEqual([
      ['review', 1],
      ['edit', 1],
      ['edit', 2],
    ]);
  });

  it('filters by unit, field text, date range and user / device', () => {
    expect(filterHistory(list, { unit: 'project' }, ctx)).toHaveLength(1);
    expect(filterHistory(list, { unit: 'e1' }, ctx)).toHaveLength(5);
    expect(filterHistory(list, { field: 'serial' }, ctx)).toHaveLength(1);
    expect(filterHistory(list, { field: 'reviewed' }, ctx)).toHaveLength(1);
    const day = new Date(t0 + 3 * 86400_000);
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    expect(filterHistory(list, { from: iso }, ctx)).toHaveLength(2);
    expect(filterHistory(list, { to: iso }, ctx)).toHaveLength(6);
    expect(filterHistory(list, { actor: 'local|ffff0000' }, ctx)).toHaveLength(1);
  });
});
