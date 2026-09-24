import Dexie, { type EntityTable } from 'dexie';
import type {
  AirflowRow,
  BaseWorkbook,
  Equipment,
  FieldChange,
  Instrument,
  Issue,
  Meta,
  Photo,
  PhotoUpload,
  Project,
  Revision,
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
  }
}

export const db = new TabDatabase();
