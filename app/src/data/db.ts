import Dexie, { type EntityTable } from 'dexie';
import type {
  AirflowRow,
  BaseWorkbook,
  Equipment,
  FieldChange,
  HistoryEntry,
  Instrument,
  Issue,
  LibraryInstrument,
  Meta,
  Photo,
  PhotoUpload,
  Project,
  Revision,
  SyncConflict,
} from './types';

export class TabDatabase extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  equipment!: EntityTable<Equipment, 'id'>;
  airflowRows!: EntityTable<AirflowRow, 'id'>;
  issues!: EntityTable<Issue, 'id'>;
  photos!: EntityTable<Photo, 'id'>;
  instruments!: EntityTable<Instrument, 'id'>;
  fieldChanges!: EntityTable<FieldChange, 'id'>;
  meta!: EntityTable<Meta, 'key'>;
  revisions!: EntityTable<Revision, 'id'>;
  baseWorkbooks!: EntityTable<BaseWorkbook, 'projectId'>;
  photoUploads!: EntityTable<PhotoUpload, 'photoId'>;
  history!: EntityTable<HistoryEntry, 'id'>;
  conflicts!: EntityTable<SyncConflict, 'id'>;
  libraryInstruments!: EntityTable<LibraryInstrument, 'id'>;

  constructor(name = 'a2b-tab') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt',
      equipment: 'id, projectId, [projectId+type]',
      airflowRows: 'id, equipmentId, projectId',
      issues: 'id, projectId, equipmentId, [projectId+kind]',
      photos: 'id, projectId, equipmentId, [projectId+category]',
      instruments: 'id, projectId',
      fieldChanges: 'id, synced, ts, projectId, [table+recordId+field]',
      meta: 'key',
    });
    // v2: revision history (issued workbooks + baseline values) and the base workbook for the next export (F1).
    // New tables only; existing data is kept as is. Old devices upgrade on first open.
    this.version(2)
      .stores({
        revisions: 'id, projectId, [projectId+createdAt]',
        baseWorkbooks: 'projectId',
      })
      .upgrade(async (tx) => {
        await tx.table('meta').put({ key: 'schemaUpgradedTo2', value: Date.now() });
      });
    // v3 (Phase 4, photos): issueId index on photos, photo sort order, the photo upload queue. Existing photos get
    // an order (their creation time) and an upload-queue entry; thumbnails are made on demand by the UI.
    this.version(3)
      .stores({
        photos: 'id, projectId, equipmentId, issueId, [projectId+category]',
        photoUploads: 'photoId, projectId, status',
      })
      .upgrade(async (tx) => {
        const uploads = tx.table('photoUploads');
        await tx
          .table('photos')
          .toCollection()
          .modify((p: Photo) => {
            if (p.order === undefined) p.order = p.createdAt;
          });
        for (const p of (await tx.table('photos').toArray()) as Photo[]) {
          if (!p.uploaded)
            await uploads.put({
              photoId: p.id,
              projectId: p.projectId,
              status: 'pending',
              attempts: 0,
              lastError: null,
              createdAt: p.createdAt,
              updatedAt: p.createdAt,
            } satisfies PhotoUpload);
        }
      });
    // v4 (Phase 6): the append-only change history (audit). Backfilled from the outbox / audit log: those entries
    // have no previous value (shown as "—"), and repeated unsynced edits that the outbox coalesced stay one entry.
    this.version(4)
      .stores({ history: 'id, projectId, equipmentId, ts, [projectId+ts]' })
      .upgrade(async (tx) => {
        const owner = new Map<string, string | null>();
        for (const name of ['airflowRows', 'photos', 'issues'] as const) {
          await tx
            .table(name)
            .toCollection()
            .each((r: { id: string; equipmentId?: string | null }) => owner.set(r.id, r.equipmentId ?? null));
        }
        const out: HistoryEntry[] = [];
        await tx
          .table('fieldChanges')
          .toCollection()
          .each((c: FieldChange) => {
            const created =
              c.op === 'create' && c.value && typeof c.value === 'object' ? (c.value as Record<string, unknown>) : null;
            out.push({
              id: c.id,
              projectId: c.projectId,
              ts: c.ts,
              kind: c.op === 'set' ? 'edit' : c.op,
              table: c.table,
              recordId: c.recordId,
              equipmentId:
                c.table === 'equipment'
                  ? c.recordId
                  : ((created?.equipmentId as string | null | undefined) ?? owner.get(c.recordId) ?? null),
              field: c.field,
              ...(c.op === 'set' ? { value: c.value } : {}),
              ...(created && typeof created.designation === 'string' ? { note: created.designation } : {}),
              userId: c.userId,
              deviceId: c.deviceId,
            });
          });
        await tx.table('history').bulkPut(out);
      });
    // v5 (Phase 5, sync): conflicts found on pull (and changes held back by a report lock). New table only.
    this.version(5).stores({ conflicts: 'id, projectId, recordId, status, [projectId+status]' });
    // v6: the shared calibration library (instruments stored once, picked into projects). New table only.
    this.version(6).stores({ libraryInstruments: 'id, updatedAt' });
  }
}

export const DEFAULT_DB_NAME = 'a2b-tab';

/** The app's database. `let` so tests can simulate several devices in one process (switchDatabase). */
export let db = new TabDatabase(DEFAULT_DB_NAME);

const instances = new Map<string, TabDatabase>([[DEFAULT_DB_NAME, db]]);

/**
 * Test hook: switch every module to another database (another simulated device). Modules import `db` as a live
 * binding, so they see the switch. Call resetIdentityCache() afterwards (the device id lives in the database).
 */
export function switchDatabase(name: string): TabDatabase {
  let next = instances.get(name);
  if (!next) instances.set(name, (next = new TabDatabase(name)));
  db = next;
  return db;
}

/** Test hook: delete a simulated device's database. */
export async function dropDatabase(name: string): Promise<void> {
  const d = instances.get(name);
  if (!d || name === DEFAULT_DB_NAME) return;
  instances.delete(name);
  d.close();
  await d.delete();
}
