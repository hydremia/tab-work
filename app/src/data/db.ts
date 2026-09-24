import Dexie, { type EntityTable } from 'dexie';
import type { AirflowRow, Equipment, FieldChange, Instrument, Issue, Meta, Photo, Project } from './types';

export class TabDatabase extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  equipment!: EntityTable<Equipment, 'id'>;
  airflowRows!: EntityTable<AirflowRow, 'id'>;
  issues!: EntityTable<Issue, 'id'>;
  photos!: EntityTable<Photo, 'id'>;
  instruments!: EntityTable<Instrument, 'id'>;
  fieldChanges!: EntityTable<FieldChange, 'id'>;
  meta!: EntityTable<Meta, 'key'>;

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
  }
}

export const db = new TabDatabase();
