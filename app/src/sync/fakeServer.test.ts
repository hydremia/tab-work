/**
 * The fake server follows the same rules as supabase/migrations/0003_sync_rules.sql (checked on PostgreSQL by
 * supabase/tests/sync_rules_test.sql); these cases mirror that SQL test so the two stay in step. Also: the Supabase
 * backend's calls and error mapping with a mocked client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { SyncError, toSyncError, type FieldChangeRow } from './backend';
import { FakeServerError, FakeSyncServer } from './fakeServer';
import { SupabaseBackend } from './supabaseBackend';

const P = 'aaaaaaaa-0000-4000-8000-000000000001';
const U = 'bbbbbbbb-0000-4000-8000-000000000001';
let n = 0;
const row = (over: Partial<FieldChangeRow>): FieldChangeRow => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  project_id: P,
  table_name: 'equipment',
  record_id: U,
  op: 'set',
  field: 'data.serial',
  value: 'x',
  user_id: null,
  device_id: 'devA',
  client_ts: 1000 + n,
  base_seq: null,
  ...over,
});

function setup() {
  const s = new FakeSyncServer();
  const a = s.addUser('a@a2b.com');
  const b = s.addUser('b@a2b.com');
  const x = s.addUser('x@other.com', 'other');
  s.push(a.id, [
    row({ table_name: 'projects', record_id: P, op: 'create', field: '', value: { name: 'Riverside' } }),
    row({ op: 'create', field: '', value: { type: 'rtu', slot: 1, designation: 'RTU-1', data: {} } }),
  ]);
  return { s, a, b, x };
}

const refused = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e as FakeServerError;
  }
  throw new Error('not refused');
};

describe('fake server rules (as 0004: library, links)', () => {
  const L = 'eeeeeeee-0000-4000-8000-000000000001';
  const P2 = 'aaaaaaaa-0000-4000-8000-000000000002';
  const U2 = 'bbbbbbbb-0000-4000-8000-000000000002';
  const lib = (over: Partial<FieldChangeRow>) =>
    row({ table_name: 'libraryInstruments', project_id: L, record_id: L, ...over });

  it('library instruments: organization records filed under their own id; other organizations are refused', () => {
    const { s, a, b, x } = setup();
    s.push(a.id, [lib({ op: 'create', field: '', value: { type: 'Balometer', calibrationDate: '2024-03-14' } })]);
    expect(s.record('libraryInstruments', L)).toMatchObject({ type: 'Balometer', orgId: 'a2b' });
    expect(s.log.at(-1)?.org_id).toBe('a2b');
    s.push(b.id, [lib({ field: 'calibrationDate', value: '2026-09-01', device_id: 'devB' })]);
    expect(s.valueOf('libraryInstruments', L, 'calibrationDate')).toBe('2026-09-01');
    expect(s.pull(b.id, 0, 100).filter((r) => r.table_name === 'libraryInstruments')).toHaveLength(2);
    expect(s.pull(x.id, 0, 100)).toHaveLength(0);
    expect(refused(() => s.push(x.id, [lib({ field: 'model', value: 'x', device_id: 'devX' })])).message).toMatch(
      /TAB_FORBIDDEN/,
    );
    expect(refused(() => s.push(a.id, [lib({ project_id: P, field: 'notes', value: 'x' })])).message).toMatch(
      /library change must name the instrument itself/,
    );
    // deleted, then a create of the same id is logged but not applied
    s.push(a.id, [lib({ op: 'delete', field: '', value: null })]);
    s.push(b.id, [lib({ op: 'create', field: '', value: { type: 'again' }, device_id: 'devB' })]);
    expect(s.record('libraryInstruments', L)).toBeUndefined();
  });

  it('links inside values must stay in the project (units, issues) / organization (library)', () => {
    const { s, a, x } = setup();
    s.push(a.id, [
      row({ table_name: 'projects', project_id: P2, record_id: P2, op: 'create', field: '', value: { name: 'P2' } }),
      row({
        project_id: P2,
        record_id: U2,
        op: 'create',
        field: '',
        value: { type: 'rtu', slot: 1, designation: 'RTU-9' },
      }),
    ]);
    const I = 'dddddddd-0000-4000-8000-000000000001';
    const bad = refused(() =>
      s.push(a.id, [
        row({ table_name: 'issues', record_id: I, op: 'create', field: '', value: { number: 1, equipmentId: U2 } }),
      ]),
    );
    expect(bad.message).toMatch(/TAB_FORBIDDEN: equipmentId names a record of another project/);
    s.push(a.id, [
      row({ table_name: 'issues', record_id: I, op: 'create', field: '', value: { number: 1, equipmentId: U } }),
    ]);
    expect(
      refused(() => s.push(a.id, [row({ table_name: 'issues', record_id: I, field: 'equipmentId', value: U2 })]))
        .message,
    ).toMatch(/another project/);
    expect(
      refused(() =>
        s.push(a.id, [
          row({
            table_name: 'photos',
            record_id: 'f0000000-0000-4000-8000-000000000001',
            op: 'create',
            field: '',
            value: { category: 'deficiency', issueId: 'dddddddd-0000-4000-8000-000000000009' },
          }),
          row({
            table_name: 'airflowRows',
            record_id: 'c0000000-0000-4000-8000-000000000001',
            op: 'create',
            field: '',
            value: { equipmentId: U2, table: 'supply' },
          }),
        ]),
      ).message,
    ).toMatch(/equipmentId names a record of another project/);
    // another organization's library instrument
    const XL = 'eeeeeeee-0000-4000-8000-000000000009';
    s.push(x.id, [
      lib({ project_id: XL, record_id: XL, op: 'create', field: '', value: { type: 'theirs' }, device_id: 'devX' }),
    ]);
    const INS = 'ffffffff-0000-4000-8000-000000000001';
    expect(
      refused(() =>
        s.push(a.id, [
          row({
            table_name: 'instruments',
            record_id: INS,
            op: 'create',
            field: '',
            value: { order: 0, libraryId: XL },
          }),
        ]),
      ).message,
    ).toMatch(/libraryId names a record of another organization/);
  });
});

describe('fake server rules (as 0003)', () => {
  it('idempotent re-push, last writer wins, create never overwrites', () => {
    const { s, a, b } = setup();
    const create = s.log[1];
    s.push(b.id, [row({ field: 'designation', value: 'RTU-1A', device_id: 'devB', client_ts: 5000 })]);
    expect(s.push(a.id, [{ ...create }])).toEqual([]); // skipped, nothing returned
    expect(s.valueOf('equipment', U, 'designation')).toBe('RTU-1A');
    s.push(a.id, [row({ field: 'designation', value: 'OLD', client_ts: 10 })]);
    expect(s.log.at(-1)).toMatchObject({ applied: false, note: 'superseded by a newer edit' });
    expect(s.valueOf('equipment', U, 'designation')).toBe('RTU-1A');
  });

  it('spoofed user and other organization are refused; nothing applied', () => {
    const { s, a, b, x } = setup();
    expect(refused(() => s.push(b.id, [row({ user_id: a.id })])).message).toMatch(/^TAB_FORBIDDEN/);
    expect(refused(() => s.push(x.id, [row({ value: 'hack' })])).message).toMatch(/another organization/);
    expect(s.pull(x.id, 0, 100)).toEqual([]);
    expect(s.valueOf('equipment', U, 'data.serial')).toBeUndefined();
    expect(() => s.upload(x.id, `${P}/p.jpg`, new Blob(['1']), 'image/jpeg')).toThrow(/row-level security/);
  });

  it('a change reaches only records of its own project (no cross-organization / lock bypass via project_id)', () => {
    const { s, a, x } = setup();
    const X = 'eeeeeeee-0000-4000-8000-000000000001';
    const P2 = 'aaaaaaaa-0000-4000-8000-000000000002';
    s.push(x.id, [row({ project_id: X, table_name: 'projects', record_id: X, op: 'create', field: '', value: {} })]);
    expect(refused(() => s.push(x.id, [row({ project_id: X, value: 'hack' })])).message).toMatch(/another project/);
    expect(refused(() => s.push(x.id, [row({ project_id: X, op: 'delete', field: '', value: null })])).code).toBe(
      '42501',
    );
    expect(
      refused(() =>
        s.push(x.id, [row({ project_id: X, table_name: 'projects', record_id: P, op: 'delete', field: '' })]),
      ).message,
    ).toMatch(/^TAB_FORBIDDEN/);
    // same organization: a locked project's unit cannot be edited by filing the change under another project
    s.push(a.id, [
      row({ project_id: P2, table_name: 'projects', record_id: P2, op: 'create', field: '', value: {} }),
      row({ table_name: 'projects', record_id: P, field: 'lock', value: { label: 'Prelim' } }),
    ]);
    expect(refused(() => s.push(a.id, [row({ project_id: P2, value: 'bypass' })])).message).toMatch(/another project/);
    expect(s.valueOf('equipment', U, 'data.serial')).toBeUndefined();
    // a deleted project's id stays its organization's
    s.push(a.id, [row({ table_name: 'projects', record_id: P, op: 'delete', field: '', value: null })]);
    expect(
      refused(() => s.push(x.id, [row({ table_name: 'projects', record_id: P, op: 'create', field: '', value: {} })]))
        .message,
    ).toMatch(/another organization/);
  });

  it('a request is atomic; failed requests still use up log positions (gaps, as a Postgres identity)', () => {
    const { s, a } = setup();
    const before = s.log.length;
    s.push(a.id, [row({ table_name: 'projects', record_id: P, field: 'lock', value: { label: 'Prelim' } })]);
    const err = refused(() => s.push(a.id, [row({ value: 'ok' }), row({ field: 'data.model', value: 'm' })]));
    expect(err).toMatchObject({ code: 'P0001', hint: 'TAB_LOCKED' });
    expect(JSON.parse(err.details!)).toMatchObject({ project_id: P, lock: { label: 'Prelim' } });
    expect(s.log.length).toBe(before + 1);
    const next = s.push(a.id, [
      row({ table_name: 'projects', record_id: P, field: 'lock', value: null }),
      row({ value: 'after unlock' }),
    ]);
    expect(s.valueOf('equipment', U, 'data.serial')).toBe('after unlock');
    expect(next[0].server_seq).toBeGreaterThan(s.log[before].server_seq! + 1); // positions were consumed
  });

  it('while locked: only the lock and deleting the whole project; the delete cascades and is visible to members', () => {
    const { s, a, b } = setup();
    s.push(a.id, [row({ table_name: 'projects', record_id: P, field: 'lock', value: { label: 'Rev 1' } })]);
    expect(refused(() => s.push(b.id, [row({ op: 'delete', field: '', value: null })])).hint).toBe('TAB_LOCKED');
    expect(refused(() => s.push(b.id, [row({ field: 'review', value: null })])).hint).toBe('TAB_LOCKED');
    s.push(b.id, [row({ table_name: 'projects', record_id: P, op: 'delete', field: '', value: null })]);
    expect(s.record('projects', P)).toBeUndefined();
    expect(s.record('equipment', U)).toBeUndefined();
    expect(s.pull(a.id, 0, 100).at(-1)).toMatchObject({ table_name: 'projects', op: 'delete' });
    s.push(a.id, [row({ table_name: 'projects', record_id: P, op: 'create', field: '', value: { name: 'again' } })]);
    expect(s.record('projects', P)).toBeUndefined();
    expect(s.log.at(-1)).toMatchObject({ applied: false, note: 'record was deleted' });
  });

  it('review: cleared by the server for a change made without knowing it, not for one made after', () => {
    const { s, a, b } = setup();
    s.push(a.id, [row({ field: 'review', value: { name: 'Kim' }, base_seq: 2 })]);
    const reviewSeq = s.log.at(-1)!.server_seq!;
    s.push(a.id, [row({ field: 'data.model', value: 'M', base_seq: reviewSeq })]);
    expect(s.log.filter((r) => r.device_id === 'server')).toHaveLength(0);
    s.push(b.id, [row({ field: 'data.fla', value: 12, device_id: 'devB', base_seq: 2 })]);
    expect(s.valueOf('equipment', U, 'review')).toBeNull();
    expect(s.log.at(-1)).toMatchObject({ device_id: 'server', field: 'review', applied: true });
    // issues never clear it
    s.push(a.id, [row({ field: 'review', value: { name: 'Kim' }, base_seq: 99 })]);
    s.push(b.id, [
      row({ table_name: 'issues', record_id: crypto.randomUUID(), op: 'create', field: '', value: { equipmentId: U } }),
    ]);
    expect(s.valueOf('equipment', U, 'review')).toEqual({ name: 'Kim' });
  });
});

describe('error mapping', () => {
  it('TAB_LOCKED -> locked with the refused change; RLS / forbidden; network; other', () => {
    const e = toSyncError(
      {
        message: 'TAB_LOCKED: the report was issued as Prelim; unlock the project to edit.',
        code: 'P0001',
        hint: 'TAB_LOCKED',
        details: '{"change_id":"c1","project_id":"p1","lock":{"label":"Prelim"}}',
      },
      'push',
    );
    expect(e).toMatchObject({ kind: 'locked', info: { changeId: 'c1', projectId: 'p1' } });
    expect(e.message).toBe('the report was issued as Prelim; unlock the project to edit.');
    expect(toSyncError({ message: 'new row violates row-level security policy', code: '42501' }, 'push').kind).toBe(
      'forbidden',
    );
    expect(toSyncError(new TypeError('Failed to fetch'), 'pull').kind).toBe('network');
    expect(toSyncError({ message: 'boom', code: 'XX000' }, 'pull').kind).toBe('server');
  });
});

describe('SupabaseBackend (mocked client)', () => {
  function mockClient(result: { data: unknown; error: unknown }) {
    const calls: { fn: string; args: unknown[] }[] = [];
    const chain: Record<string, unknown> = {};
    for (const fn of ['from', 'upsert', 'select', 'gt', 'order', 'limit'])
      chain[fn] = (...args: unknown[]) => {
        calls.push({ fn, args });
        return chain;
      };
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
    const storage = {
      from: (bucket: string) => ({
        upload: (...args: unknown[]) => (calls.push({ fn: `upload:${bucket}`, args }), Promise.resolve(result)),
        download: (...args: unknown[]) => (calls.push({ fn: 'download', args }), Promise.resolve(result)),
        remove: (...args: unknown[]) => (calls.push({ fn: 'remove', args }), Promise.resolve(result)),
      }),
    };
    const client = {
      from: chain.from,
      rpc: (name: string) => (calls.push({ fn: `rpc:${name}`, args: [] }), Promise.resolve(result)),
      storage,
    };
    return { client: client as unknown as SupabaseClient, calls };
  }

  it('push = upsert ignoring duplicate ids, returning id + server_seq; pull by server_seq', async () => {
    const { client, calls } = mockClient({ data: [{ id: 'a', server_seq: 7 }], error: null });
    const b = new SupabaseBackend(async () => client);
    expect(await b.push([row({})])).toEqual([{ id: 'a', server_seq: 7 }]);
    expect(calls.find((c) => c.fn === 'upsert')?.args[1]).toEqual({ onConflict: 'id', ignoreDuplicates: true });
    expect(calls.find((c) => c.fn === 'select')?.args[0]).toBe('id, server_seq');
    await b.pull(5, 100);
    expect(calls.filter((c) => ['gt', 'order', 'limit'].includes(c.fn)).map((c) => c.args)).toEqual([
      ['server_seq', 5],
      ['server_seq', { ascending: true }],
      [100],
    ]);
  });

  it('maps a lock refusal to SyncError(locked); server time via rpc; a missing file is null', async () => {
    const locked = mockClient({
      data: null,
      error: { message: 'TAB_LOCKED: x', hint: 'TAB_LOCKED', details: '{"change_id":"c9"}' },
    });
    await expect(new SupabaseBackend(async () => locked.client).push([row({})])).rejects.toMatchObject({
      kind: 'locked',
      info: { changeId: 'c9' },
    });
    const t = mockClient({ data: '1790000000000', error: null });
    expect(await new SupabaseBackend(async () => t.client).serverTime()).toBe(1_790_000_000_000);
    expect(t.calls[0].fn).toBe('rpc:server_time_ms');
    const nf = mockClient({ data: null, error: { message: 'Object not found', statusCode: '404' } });
    expect(await new SupabaseBackend(async () => nf.client).downloadPhoto('p/x.jpg')).toBeNull();
    const up = mockClient({ data: {}, error: null });
    await new SupabaseBackend(async () => up.client).uploadPhoto('p/x.jpg', new Blob(['1']), 'image/jpeg');
    expect(up.calls[0]).toMatchObject({
      fn: 'upload:photos',
      args: ['p/x.jpg', expect.anything(), { contentType: 'image/jpeg', upsert: true }],
    });
    const down = mockClient({ data: null, error: new TypeError('Failed to fetch') });
    await expect(new SupabaseBackend(async () => down.client).pull(0, 1)).rejects.toBeInstanceOf(SyncError);
  });
});
