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
  }
}

export const db = new TabDatabase();
