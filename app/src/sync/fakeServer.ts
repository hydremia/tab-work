/**
 * In-memory stand-in for the Supabase backend with the same rules as supabase/migrations/0001–0003 (keep the two in
 * step; supabase/tests/sync_rules_test.sql checks the SQL, sync/fakeServer.test.ts this file):
 *
 *  - one log of field changes per server, `server_seq` assigned on insert (and, as in Postgres, not given back when a
 *    request fails: the log has gaps), `received_at` = the server clock;
 *  - a push is one atomic request: every row applies in order, or none does;
 *  - a change whose id is already in the log is skipped (idempotent retry);
 *  - users belong to an organization and see / write only its projects; a change must be made as the signed-in user;
 *  - last writer wins per record + field by client_ts (ties: the higher device id), the loser is logged with
 *    applied = false; a create never overwrites an existing record or brings a deleted one back;
 *  - report lock: while a project's `lock` is an object, only the lock itself and deleting the whole project are
 *    accepted, anything else fails the request with TAB_LOCKED (detail: the refused change id);
 *  - review: a change of a reviewed unit (its fields, rows, photos) by a device that had not seen the review (base_seq
 *    older than the review's server_seq) clears it with a server change (device 'server');
 *  - deleting a project deletes its records (cascade); photo files by path `<projectId>/<photoId>.jpg`.
 *
 * No browser or Dexie dependency: the e2e server (deploy/serve-dist.ts) runs it in Node.
 */
import { deepEqual, setPath } from '../data/paths';
import type { FieldChangeRow, PushedRow } from './backend';

export interface FakeUser {
  id: string;
  email: string;
  orgId: string;
}

/** Error in the shape PostgREST returns ({ message, code, details, hint }). */
export class FakeServerError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details: string | null = null,
    readonly hint: string | null = null,
  ) {
    super(message);
    this.name = 'FakeServerError';
  }
}

type Rec = Record<string, unknown> & { id: string };
type Tables = Map<string, Map<string, Rec>>;

const CHILD_TABLES = ['equipment', 'airflowRows', 'issues', 'photos', 'instruments'];

export class FakeSyncServer {
  /** Server clock (ms). Tests move it; defaults to the real clock. */
  now: () => number = () => Date.now();
  readonly users = new Map<string, FakeUser>();
  log: FieldChangeRow[] = [];
  private seq = 0;
  private tables: Tables = new Map();
  readonly files = new Map<string, { data: Blob; contentType: string; orgId: string }>();
  /** Every push request received (for tests: batching and order). */
  readonly requests: { userId: string; ids: string[] }[] = [];

  addUser(email: string, orgId = 'a2b', id: string = crypto.randomUUID()): FakeUser {
    const u = { id, email, orgId };
    this.users.set(id, u);
    return u;
  }

  userByEmail(email: string): FakeUser | undefined {
    return [...this.users.values()].find((u) => u.email === email);
  }

  table(name: string): Map<string, Rec> {
    let t = this.tables.get(name);
    if (!t) this.tables.set(name, (t = new Map()));
    return t;
  }

  record(table: string, id: string): Rec | undefined {
    return this.table(table).get(id);
  }

  private user(userId: string): FakeUser {
    const u = this.users.get(userId);
    if (!u) throw new FakeServerError('JWT expired or invalid', 'PGRST301');
    return u;
  }

  private projectOrg(projectId: string): string | null {
    const p = this.record('projects', projectId);
    if (p) return p.orgId as string;
    return (this.log.find((r) => r.project_id === projectId && r.org_id)?.org_id as string | undefined) ?? null;
  }

  /** Atomic append of changes as `userId` (see the rules above). */
  push(userId: string, rows: readonly FieldChangeRow[]): PushedRow[] {
    const user = this.user(userId);
    this.requests.push({ userId, ids: rows.map((r) => r.id) });
    const savedTables: Tables = new Map(
      [...this.tables].map(([k, v]) => [k, new Map([...v].map(([id, r]) => [id, structuredClone(r)]))]),
    );
    const savedLog = this.log.length;
    const out: PushedRow[] = [];
    try {
      for (const row of rows) {
        const r = this.insert(user, { ...row });
        if (r) out.push({ id: r.id, server_seq: r.server_seq! });
      }
      return out;
    } catch (e) {
      this.tables = savedTables;
      this.log.length = savedLog;
      throw e;
    }
  }

  private insert(user: FakeUser, row: FieldChangeRow): FieldChangeRow | null {
    const seq = ++this.seq; // consumed even when the request fails (as a Postgres identity)
    if (this.log.some((r) => r.id === row.id)) return null; // idempotent re-push
    if ((row.user_id ?? user.id) !== user.id)
      throw new FakeServerError('TAB_FORBIDDEN: a change must be made as the signed-in user', '42501');
    const project = this.record('projects', row.project_id);
    const org =
      project?.orgId ??
      (row.table_name === 'projects' && row.op === 'create'
        ? (this.projectOrg(row.project_id) ?? user.orgId)
        : this.projectOrg(row.project_id));
    if (org !== user.orgId)
      throw new FakeServerError('TAB_FORBIDDEN: the project belongs to another organization', '42501');
    // the record must belong to the change's project (the checks above and the lock are about project_id)
    if (row.table_name === 'projects') {
      if (row.record_id !== row.project_id)
        throw new FakeServerError('TAB_FORBIDDEN: a project change must name the project itself', '42501');
    } else {
      const target = this.record(row.table_name, row.record_id);
      if (target && target.projectId !== row.project_id)
        throw new FakeServerError('TAB_FORBIDDEN: the record belongs to another project', '42501');
    }
    const lock = project?.lock;
    if (
      project &&
      lock &&
      typeof lock === 'object' &&
      !(row.table_name === 'projects' && ((row.op === 'set' && row.field === 'lock') || row.op === 'delete'))
    ) {
      throw new FakeServerError(
        `TAB_LOCKED: the report was issued as ${String((lock as { label?: string }).label ?? '?')}; unlock the project to edit.`,
        'P0001',
        JSON.stringify({ change_id: row.id, project_id: row.project_id, lock }),
        'TAB_LOCKED',
      );
    }
    const stored: FieldChangeRow = {
      ...row,
      user_id: user.id,
      server_seq: seq,
      received_at: this.now(),
      org_id: org,
      applied: true,
      note: null,
      base_seq: row.base_seq ?? null,
    };
    const units = this.changeUnits(row);
    const t = this.table(row.table_name);
    if (row.op === 'delete') {
      t.delete(row.record_id);
      if (row.table_name === 'projects')
        for (const c of CHILD_TABLES)
          for (const [id, r] of this.table(c)) if (r.projectId === row.record_id) this.table(c).delete(id);
      if (row.table_name === 'equipment') {
        for (const [id, r] of this.table('airflowRows'))
          if (r.equipmentId === row.record_id) this.table('airflowRows').delete(id);
        for (const [id, r] of this.table('photos'))
          if (r.equipmentId === row.record_id) this.table('photos').delete(id);
      }
    } else if (row.op === 'create') {
      if (this.log.some((r) => r.record_id === row.record_id && r.op === 'delete')) {
        stored.applied = false;
        stored.note = 'record was deleted';
      } else if (t.has(row.record_id)) {
        stored.applied = false;
        stored.note = 'record already exists';
      } else {
        const value = (row.value ?? {}) as Record<string, unknown>;
        t.set(row.record_id, {
          ...value,
          id: row.record_id,
          ...(row.table_name === 'projects' ? { orgId: org } : { projectId: row.project_id }),
        });
      }
    } else {
      const newer = this.log.some(
        (f) =>
          f.record_id === row.record_id &&
          f.field === row.field &&
          f.op === 'set' &&
          (f.client_ts > row.client_ts || (f.client_ts === row.client_ts && f.device_id > row.device_id)),
      );
      const rec = t.get(row.record_id);
      if (newer) {
        stored.applied = false;
        stored.note = 'superseded by a newer edit';
      } else if (rec) t.set(row.record_id, setPath(rec, row.field, row.value ?? null) as Rec);
    }
    this.log.push(stored);
    if (stored.applied) {
      for (const unitId of units) {
        const unit = this.record('equipment', unitId);
        if (!unit?.review || typeof unit.review !== 'object') continue;
        const review = [...this.log]
          .reverse()
          .find((f) => f.record_id === unitId && f.field === 'review' && f.op === 'set' && f.applied);
        if (row.base_seq == null || !review || row.base_seq < review.server_seq!) {
          this.insert(user, {
            id: crypto.randomUUID(),
            project_id: row.project_id,
            table_name: 'equipment',
            record_id: unitId,
            op: 'set',
            field: 'review',
            value: null,
            user_id: user.id,
            device_id: 'server',
            client_ts: Math.max(row.client_ts, (review?.client_ts ?? 0) + 1),
            base_seq: seq,
            note: 'automatic: the unit changed after it was reviewed',
          });
        }
      }
    }
    return stored;
  }

  /** The unit(s) a change touches, for the review rule (read before the change applies). */
  private changeUnits(row: FieldChangeRow): string[] {
    if (row.table_name === 'equipment') return row.op === 'set' && row.field !== 'review' ? [row.record_id] : [];
    if (row.table_name !== 'airflowRows' && row.table_name !== 'photos') return [];
    if (row.op === 'create') {
      const e = (row.value as { equipmentId?: string | null } | null)?.equipmentId;
      return e ? [e] : [];
    }
    const e = this.record(row.table_name, row.record_id)?.equipmentId as string | null | undefined;
    const out = e ? [e] : [];
    if (row.op === 'set' && row.field === 'equipmentId' && typeof row.value === 'string') out.push(row.value);
    return out;
  }

  /** The organization's changes after `afterSeq`, oldest first. */
  pull(userId: string, afterSeq: number, limit: number): FieldChangeRow[] {
    const user = this.user(userId);
    return this.log
      .filter((r) => r.org_id === user.orgId && r.server_seq! > afterSeq)
      .sort((a, b) => a.server_seq! - b.server_seq!)
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }

  serverTime(): number {
    return this.now();
  }

  private fileOrg(path: string): string | null {
    const folder = path.split('/')[0];
    return /^[0-9a-fA-F-]{36}$/.test(folder) ? this.projectOrg(folder) : null;
  }

  upload(userId: string, path: string, data: Blob, contentType: string): void {
    const user = this.user(userId);
    // storage policy: the folder's project must exist in the user's organization
    const p = this.record('projects', path.split('/')[0]);
    if (!p || p.orgId !== user.orgId)
      throw new FakeServerError('new row violates row-level security policy for table "objects"', '42501');
    this.files.set(path, { data, contentType, orgId: user.orgId });
  }

  download(userId: string, path: string): Blob | null {
    const user = this.user(userId);
    const f = this.files.get(path);
    if (!f || this.fileOrg(path) !== user.orgId) return null;
    return f.data;
  }

  remove(userId: string, path: string): void {
    const user = this.user(userId);
    if (this.fileOrg(path) === user.orgId) this.files.delete(path);
  }

  /** The value of a field of a record on the server (tests). */
  valueOf(table: string, id: string, path: string): unknown {
    let cur: unknown = this.record(table, id);
    for (const s of path.split('.'))
      cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[s] : undefined;
    return cur;
  }

  /** Records equal (ignoring the server's own keys) — helper for tests comparing a device with the server. */
  static sameRecord(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined, keys: string[]) {
    return keys.every((k) => deepEqual(a?.[k], b?.[k]));
  }
}
