/**
 * Repository: the only place that writes to the local database. Every edit goes through `setField()`, which
 * updates the record AND appends a FieldChange to the sync outbox in one Dexie transaction. Creates and
 * deletes are logged the same way (op 'create' / 'delete').
 */
import { DEFAULT_INSTRUMENTS, TEMPLATE_MAP, TEMPLATE_REVISION, tableRows } from '@a2b/workbook/map';
import type { Table } from 'dexie';
import { equipmentType, nextFreeSlot, type EquipmentTypeKey } from '../domain/equipmentTypes';
import { db } from './db';
import { uuid } from './uuid';
import { getCurrentUser, getDeviceId, nextTimestamp } from './identity';
import { deepEqual, getPath, setPath, assertEditablePath } from './paths';
import {
  emptyNaState,
  type AirflowRow,
  type Equipment,
  type FieldChange,
  type Instrument,
  type Issue,
  type IssueKind,
  type Photo,
  type PhotoCategory,
  type Project,
  type ScopeProfile,
  type TableName,
} from './types';

type AnyRecord = { id: string; projectId?: string; updatedAt: number };

function tableOf(name: TableName): Table<AnyRecord, string> {
  return db.table(name) as Table<AnyRecord, string>;
}

function projectIdOf(name: TableName, rec: AnyRecord): string {
  return name === 'projects' ? rec.id : (rec.projectId ?? '');
}

/** Outbox copy of a record: photos are logged without their Blob (the file uploads separately). */
function loggable(name: TableName, rec: AnyRecord): unknown {
  if (name === 'photos') {
    const { blob: _blob, ...rest } = rec as unknown as Photo;
    return rest;
  }
  return rec;
}

async function change(
  partial: Pick<FieldChange, 'projectId' | 'table' | 'recordId' | 'op' | 'field' | 'value'>,
  ts: number,
): Promise<FieldChange> {
  return {
    id: uuid(),
    ...partial,
    userId: getCurrentUser(),
    deviceId: await getDeviceId(),
    ts,
    synced: 0,
  };
}

/**
 * Set one field of one record. `field` is a dotted path inside the record ("data.serial",
 * "naState.fields.serial", "blueprints.0.sheet"). No-op when the value is unchanged.
 * Consecutive unsynced edits of the same field from this device are coalesced into one outbox entry.
 */
export async function setField(table: TableName, recordId: string, field: string, value: unknown): Promise<void> {
  assertEditablePath(field);
  const deviceId = await getDeviceId();
  await db.transaction('rw', tableOf(table), db.fieldChanges, async () => {
    const t = tableOf(table);
    const rec = await t.get(recordId);
    if (!rec) throw new Error(`${table}/${recordId} not found`);
    if (deepEqual(getPath(rec, field), value)) return;
    const ts = nextTimestamp();
    const next = setPath(rec, field, value);
    next.updatedAt = ts;
    await t.put(next);
    const pending = await db.fieldChanges
      .where('[table+recordId+field]')
      .equals([table, recordId, field])
      .filter((c) => c.synced === 0 && c.op === 'set' && c.deviceId === deviceId)
      .toArray();
    const prev = pending.sort((a, b) => b.ts - a.ts)[0];
    if (prev) {
      await db.fieldChanges.update(prev.id, { value: value ?? null, ts, userId: getCurrentUser() });
    } else {
      await db.fieldChanges.add(
        await change(
          { projectId: projectIdOf(table, rec), table, recordId, op: 'set', field, value: value ?? null },
          ts,
        ),
      );
    }
  });
}

/** Set several fields of one record (each is its own field change, one transaction). */
export async function setFields(table: TableName, recordId: string, values: Record<string, unknown>): Promise<void> {
  await db.transaction('rw', tableOf(table), db.fieldChanges, db.meta, async () => {
    for (const [k, v] of Object.entries(values)) await setField(table, recordId, k, v);
  });
}

export async function createRecord<T extends AnyRecord>(table: TableName, rec: T): Promise<T> {
  await getDeviceId();
  await db.transaction('rw', tableOf(table), db.fieldChanges, async () => {
    await tableOf(table).add(rec);
    await db.fieldChanges.add(
      await change(
        {
          projectId: projectIdOf(table, rec),
          table,
          recordId: rec.id,
          op: 'create',
          field: '',
          value: loggable(table, rec),
        },
        nextTimestamp(),
      ),
    );
  });
  return rec;
}

export async function deleteRecord(table: TableName, recordId: string): Promise<void> {
  await getDeviceId();
  await db.transaction(
    'rw',
    [db.projects, db.equipment, db.airflowRows, db.issues, db.photos, db.instruments, db.fieldChanges],
    async () => {
      const rec = await tableOf(table).get(recordId);
      if (!rec) return;
      const log = async (name: TableName, r: AnyRecord) => {
        await tableOf(name).delete(r.id);
        await db.fieldChanges.add(
          await change(
            { projectId: projectIdOf(name, r), table: name, recordId: r.id, op: 'delete', field: '', value: null },
            nextTimestamp(),
          ),
        );
      };
      if (table === 'projects') {
        for (const name of ['airflowRows', 'photos', 'issues', 'instruments', 'equipment'] as const) {
          for (const child of await tableOf(name).where('projectId').equals(recordId).toArray()) await log(name, child);
        }
      } else if (table === 'equipment') {
        for (const r of await db.airflowRows.where('equipmentId').equals(recordId).toArray())
          await log('airflowRows', r);
        for (const p of await db.photos.where('equipmentId').equals(recordId).toArray()) await log('photos', p);
        for (const i of await db.issues.where('equipmentId').equals(recordId).toArray()) {
          await setField('issues', i.id, 'equipmentId', null); // the issue becomes "General (N/A)"
        }
      }
      await log(table, rec);
    },
  );
}

// ------------------------------------------------------------------------------------------ projects
export interface NewProjectInput {
  name: string;
  address?: string;
  scopeProfile?: ScopeProfile;
  tabDate?: string;
}

export async function createProject(input: NewProjectInput): Promise<Project> {
  const now = Date.now();
  const project: Project = {
    id: uuid(),
    name: input.name.trim(),
    scopeProfile: input.scopeProfile ?? 'full',
    customScope: {},
    tolerance: 0.1,
    reportKind: 'prelim',
    info: { address: input.address?.trim() || null, tabDate: input.tabDate || null },
    blueprints: [],
    naState: emptyNaState(),
    templateRevision: TEMPLATE_REVISION,
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction('rw', db.projects, db.instruments, db.fieldChanges, db.meta, async () => {
    await createRecord('projects', project);
    // the template's 7 pre-loaded a2b instruments (the export replaces the Calibration list)
    let order = 0;
    for (const ins of DEFAULT_INSTRUMENTS) {
      await createRecord<Instrument>('instruments', {
        id: uuid(),
        projectId: project.id,
        order: order++,
        ...ins,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
  return project;
}

// ------------------------------------------------------------------------------------------ equipment
export class CapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapacityError';
  }
}

/** Initial field values of a new unit (the template's presets). */
const PRESETS: Partial<Record<EquipmentTypeKey, Record<string, string>>> = {
  rtu: { unitType: 'RTU' },
  mau: { unitType: 'MAU' },
  erv: { unitType: 'ERV' },
  fan: { unitType: 'EF' },
};

export async function addEquipment(
  projectId: string,
  type: EquipmentTypeKey,
  designation: string,
  isExisting = false,
): Promise<Equipment> {
  const info = equipmentType(type);
  return db.transaction('rw', db.equipment, db.fieldChanges, db.meta, async () => {
    const existing = await db.equipment.where('[projectId+type]').equals([projectId, type]).toArray();
    const slot = nextFreeSlot(
      existing.map((e) => e.slot),
      info.capacity,
    );
    if (slot === null) throw new CapacityError(`The workbook has room for ${info.capacity} ${info.plural}.`);
    const now = Date.now();
    return createRecord<Equipment>('equipment', {
      id: uuid(),
      projectId,
      type,
      designation: designation.trim(),
      slot,
      isExisting,
      data: { ...(PRESETS[type] ?? {}) },
      naState: emptyNaState(),
      createdAt: now,
      updatedAt: now,
    });
  });
}

/** Rows available in an airflow table of an equipment type (from the template map). */
export function airflowTableCapacity(type: EquipmentTypeKey, table: string): number {
  const def = TEMPLATE_MAP.equipment.find((e) => e.key === type)?.block.tables?.find((t) => t.key === table);
  return def ? tableRows(def).length : 0;
}

export async function addAirflowRow(
  equipment: Pick<Equipment, 'id' | 'projectId' | 'type'>,
  table: string,
  data: AirflowRow['data'] = {},
): Promise<AirflowRow> {
  return db.transaction('rw', db.airflowRows, db.fieldChanges, db.meta, async () => {
    const rows = (await db.airflowRows.where('equipmentId').equals(equipment.id).toArray()).filter(
      (r) => r.table === table,
    );
    const cap = airflowTableCapacity(equipment.type, table);
    if (rows.length >= cap) throw new CapacityError(`This table has room for ${cap} rows in the workbook.`);
    const now = Date.now();
    return createRecord<AirflowRow>('airflowRows', {
      id: uuid(),
      projectId: equipment.projectId,
      equipmentId: equipment.id,
      table,
      order: rows.reduce((m, r) => Math.max(m, r.order), 0) + 1,
      data,
      na: {},
      createdAt: now,
      updatedAt: now,
    });
  });
}

// ------------------------------------------------------------------------------------------ issues
export async function addIssue(
  projectId: string,
  input: Partial<Pick<Issue, 'kind' | 'remark' | 'status' | 'comments' | 'equipmentId'>> = {},
): Promise<Issue> {
  return db.transaction('rw', db.issues, db.fieldChanges, db.meta, async () => {
    const kind: IssueKind = input.kind ?? 'new';
    const same = await db.issues.where('[projectId+kind]').equals([projectId, kind]).toArray();
    const now = Date.now();
    return createRecord<Issue>('issues', {
      id: uuid(),
      projectId,
      kind,
      number: same.reduce((m, i) => Math.max(m, i.number), 0) + 1,
      remark: input.remark ?? '',
      status: input.status ?? 'Open',
      comments: input.comments ?? '',
      equipmentId: input.equipmentId ?? null,
      createdAt: now,
      updatedAt: now,
    });
  });
}

// ------------------------------------------------------------------------------------------ photos
export async function addPhoto(
  projectId: string,
  file: Blob & { name?: string },
  category: PhotoCategory,
  equipmentId: string | null = null,
): Promise<Photo> {
  const now = Date.now();
  return createRecord<Photo>('photos', {
    id: uuid(),
    projectId,
    equipmentId,
    issueId: null,
    category,
    caption: '',
    blob: file,
    mimeType: file.type || 'image/jpeg',
    fileName: file.name ?? `${category}.jpg`,
    uploaded: 0,
    createdAt: now,
    updatedAt: now,
  });
}

/** Replace the photo of a single-photo category (cover, unit, tag, OA damper). */
export async function replacePhoto(
  projectId: string,
  file: Blob & { name?: string },
  category: PhotoCategory,
  equipmentId: string | null = null,
): Promise<Photo> {
  return db.transaction(
    'rw',
    [db.photos, db.fieldChanges, db.meta, db.projects, db.equipment, db.airflowRows, db.issues, db.instruments],
    async () => {
      const old = (await db.photos.where('[projectId+category]').equals([projectId, category]).toArray()).filter(
        (p) => p.equipmentId === equipmentId,
      );
      for (const p of old) await deleteRecord('photos', p.id);
      return addPhoto(projectId, file, category, equipmentId);
    },
  );
}

// ------------------------------------------------------------------------------------------ instruments
export async function addInstrument(projectId: string): Promise<Instrument> {
  return db.transaction('rw', db.instruments, db.fieldChanges, db.meta, async () => {
    const all = await db.instruments.where('projectId').equals(projectId).toArray();
    const now = Date.now();
    return createRecord<Instrument>('instruments', {
      id: uuid(),
      projectId,
      order: all.reduce((m, i) => Math.max(m, i.order), -1) + 1,
      type: '',
      manufacturer: '',
      model: '',
      serial: '',
      calibrationDate: '',
      createdAt: now,
      updatedAt: now,
    });
  });
}
