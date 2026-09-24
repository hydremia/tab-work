/**
 * Repository: the only place that writes to the local database. Every edit goes through `setField()`, which
 * updates the record AND appends a FieldChange to the sync outbox in one Dexie transaction. Creates and
 * deletes are logged the same way (op 'create' / 'delete').
 */
import { DEFAULT_INSTRUMENTS, TEMPLATE_MAP, TEMPLATE_REVISION, tableRows } from '@a2b/workbook/map';
import type { Table } from 'dexie';
import { duplicateData, duplicateRow } from '../domain/duplicate';
import { equipmentType, nextFreeSlot, type EquipmentTypeKey } from '../domain/equipmentTypes';
import type { PreviewRow } from '../domain/scheduleImport';
import { db } from './db';
import { uuid } from './uuid';
import { getCurrentUser, getDeviceId, nextTimestamp } from './identity';
import { deepEqual, getPath, setPath, assertEditablePath } from './paths';
import { comparePhotos, groupKeyOf, sortKey } from '../photos/labels';
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
    const { blob: _blob, thumb: _thumb, ...rest } = rec as unknown as Photo;
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
    [
      db.projects,
      db.equipment,
      db.airflowRows,
      db.issues,
      db.photos,
      db.instruments,
      db.fieldChanges,
      db.photoUploads,
      // only a project delete touches the local revision tables (keeps nested transactions of other deletes valid)
      ...(table === 'projects' ? [db.revisions, db.baseWorkbooks] : []),
    ],
    async () => {
      const rec = await tableOf(table).get(recordId);
      if (!rec) return;
      const log = async (name: TableName, r: AnyRecord) => {
        await tableOf(name).delete(r.id);
        if (name === 'photos') await db.photoUploads.delete(r.id);
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
        // local revision history and the base workbook go with the project (not synced)
        await db.revisions.where('projectId').equals(recordId).delete();
        await db.baseWorkbooks.delete(recordId);
      } else if (table === 'equipment') {
        for (const r of await db.airflowRows.where('equipmentId').equals(recordId).toArray())
          await log('airflowRows', r);
        for (const p of await db.photos.where('equipmentId').equals(recordId).toArray()) await log('photos', p);
        for (const i of await db.issues.where('equipmentId').equals(recordId).toArray()) {
          await setField('issues', i.id, 'equipmentId', null); // the issue becomes "General (N/A)"
        }
      } else if (table === 'issues') {
        // an issue's deficiency photos go with it
        for (const p of await db.photos.where('issueId').equals(recordId).toArray()) await log('photos', p);
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
  const block = TEMPLATE_MAP.equipment.find((e) => e.key === type)?.block;
  const def = block?.tables?.find((t) => t.key === table);
  if (def) return tableRows(def).length;
  // column tables (MAU filter grid: one filter per column)
  return block?.columnTables?.find((t) => t.key === table)?.cols.length ?? 0;
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

// ------------------------------------------------------------------------------------------ schedule import
/**
 * Create / update units from a schedule import preview (domain/scheduleImport.ts) in one transaction: a new unit is
 * created (next free slot, like "Add equipment"), then every value goes through setField; an existing unit (same
 * designation) gets only the values the schedule has (blank schedule cells never clear app values). Rows with
 * action 'skip' are ignored.
 */
export async function applyScheduleImport(
  projectId: string,
  type: EquipmentTypeKey,
  rows: readonly Pick<PreviewRow, 'action' | 'designation' | 'values' | 'existingId'>[],
  isExisting = false,
): Promise<{ created: Equipment[]; updated: number }> {
  return db.transaction('rw', db.equipment, db.fieldChanges, db.meta, async () => {
    const created: Equipment[] = [];
    let updated = 0;
    for (const r of rows) {
      if (r.action === 'skip') continue;
      let id = r.existingId;
      if (r.action === 'create') {
        const unit = await addEquipment(projectId, type, r.designation, isExisting);
        created.push(unit);
        id = unit.id;
      } else updated++;
      if (!id) continue;
      for (const [k, v] of Object.entries(r.values)) {
        if (v === null || v === '') continue;
        await setField('equipment', id, `data.${k}`, v);
      }
    }
    return { created, updated };
  });
}

/**
 * Duplicate a unit: same type, next free slot, the design / schedule data and configuration (domain/duplicate.ts),
 * optionally its outlet / filter rows without readings. Photos, readings, serial and remarks are not copied.
 */
export async function duplicateEquipment(
  sourceId: string,
  designation: string,
  opts: { rows?: boolean } = {},
): Promise<Equipment> {
  return db.transaction('rw', db.equipment, db.airflowRows, db.fieldChanges, db.meta, async () => {
    const src = await db.equipment.get(sourceId);
    if (!src) throw new Error('unit not found');
    const unit = await addEquipment(src.projectId, src.type, designation, src.isExisting);
    const { data, fieldMarks } = duplicateData(src);
    for (const [k, v] of Object.entries(data)) await setField('equipment', unit.id, `data.${k}`, v);
    for (const [k, m] of Object.entries(fieldMarks)) await setField('equipment', unit.id, `naState.fields.${k}`, m);
    for (const [k, m] of Object.entries(src.naState.sections))
      if (m) await setField('equipment', unit.id, `naState.sections.${k}`, m);
    if (opts.rows) {
      const rows = (await db.airflowRows.where('equipmentId').equals(src.id).toArray()).sort(
        (a, b) => a.order - b.order,
      );
      for (const r of rows) {
        const copy = duplicateRow(src.type, r);
        const now = Date.now();
        await createRecord<AirflowRow>('airflowRows', {
          id: uuid(),
          projectId: src.projectId,
          equipmentId: unit.id,
          table: r.table,
          order: r.order,
          data: copy.data,
          na: copy.na,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return (await db.equipment.get(unit.id))!;
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
/** What a new photo is attached to. */
export interface PhotoTarget {
  category: PhotoCategory;
  equipmentId?: string | null;
  issueId?: string | null;
  caption?: string;
}

/** A processed image (see photos/process.ts); a raw Blob is stored as is (tests, legacy callers). */
export interface PhotoImage {
  blob: Blob;
  thumb?: Blob | null;
  width?: number;
  height?: number;
  capturedAt?: number | null;
  gps?: { lat: number; lon: number } | null;
  fileName?: string;
}

const photoTables = () => [db.photos, db.photoUploads, db.fieldChanges, db.meta];

/** Next sort key at the end of the photo's group. */
async function nextPhotoOrder(
  projectId: string,
  target: Pick<Photo, 'category' | 'equipmentId' | 'issueId'>,
  exceptId?: string,
) {
  const key = groupKeyOf(target);
  const all = await db.photos.where('projectId').equals(projectId).toArray();
  return all.filter((p) => p.id !== exceptId && groupKeyOf(p) === key).reduce((m, p) => Math.max(m, sortKey(p)), 0) + 1;
}

export async function addPhoto(
  projectId: string,
  file: (Blob & { name?: string }) | PhotoImage,
  categoryOrTarget: PhotoCategory | PhotoTarget,
  equipmentId: string | null = null,
): Promise<Photo> {
  const target: PhotoTarget =
    typeof categoryOrTarget === 'string' ? { category: categoryOrTarget, equipmentId } : categoryOrTarget;
  const img: PhotoImage = file instanceof Blob ? { blob: file, fileName: (file as { name?: string }).name } : file;
  const now = Date.now();
  return db.transaction('rw', photoTables(), async () => {
    const base = {
      category: target.category,
      equipmentId:
        target.category === 'deficiency' || target.category === 'cover' ? null : (target.equipmentId ?? null),
      issueId: target.category === 'deficiency' ? (target.issueId ?? null) : null,
    };
    const photo = await createRecord<Photo>('photos', {
      id: uuid(),
      projectId,
      ...base,
      caption: target.caption ?? '',
      blob: img.blob,
      thumb: img.thumb ?? null,
      mimeType: img.blob.type || 'image/jpeg',
      fileName: img.fileName ?? `${target.category}.jpg`,
      width: img.width,
      height: img.height,
      capturedAt: img.capturedAt ?? null,
      gps: img.gps ?? null,
      order: await nextPhotoOrder(projectId, base),
      uploaded: 0,
      createdAt: now,
      updatedAt: now,
    });
    await db.photoUploads.put({
      photoId: photo.id,
      projectId,
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });
    return photo;
  });
}

/** Replace the photo of a single-photo slot (cover, unit, tag, OA damper); the new photo keeps the old one's place. */
export async function replacePhoto(
  projectId: string,
  file: (Blob & { name?: string }) | PhotoImage,
  category: PhotoCategory,
  equipmentId: string | null = null,
): Promise<Photo> {
  return db.transaction(
    'rw',
    [...photoTables(), db.projects, db.equipment, db.airflowRows, db.issues, db.instruments],
    async () => {
      const old = (await db.photos.where('[projectId+category]').equals([projectId, category]).toArray()).filter(
        (p) => p.equipmentId === equipmentId,
      );
      for (const p of old) await deleteRecord('photos', p.id);
      const photo = await addPhoto(projectId, file, { category, equipmentId });
      if (old[0]) await setField('photos', photo.id, 'order', sortKey(old[0]));
      return (await db.photos.get(photo.id))!;
    },
  );
}

/** Move a photo one place earlier (-1) or later (+1) within its group (swaps sort keys with the neighbour). */
export async function movePhoto(photoId: string, dir: -1 | 1): Promise<void> {
  await db.transaction('rw', photoTables(), async () => {
    const photo = await db.photos.get(photoId);
    if (!photo) return;
    const key = groupKeyOf(photo);
    const group = (await db.photos.where('projectId').equals(photo.projectId).toArray())
      .filter((p) => groupKeyOf(p) === key)
      .sort(comparePhotos);
    const i = group.findIndex((p) => p.id === photoId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= group.length) return;
    // renumber the whole group 1..n in the new order (sort keys may tie for legacy photos)
    [group[i], group[j]] = [group[j], group[i]];
    for (let k = 0; k < group.length; k++) await setField('photos', group[k].id, 'order', k + 1);
  });
}

/** Re-attach a photo (category, equipment, issue); it moves to the end of its new group. */
export async function reassignPhoto(photoId: string, target: PhotoTarget): Promise<void> {
  await db.transaction('rw', photoTables(), async () => {
    const photo = await db.photos.get(photoId);
    if (!photo) return;
    const next = {
      category: target.category,
      equipmentId:
        target.category === 'deficiency' || target.category === 'cover' ? null : (target.equipmentId ?? null),
      issueId: target.category === 'deficiency' ? (target.issueId ?? null) : null,
    };
    const moved = groupKeyOf(next) !== groupKeyOf(photo);
    await setFields('photos', photoId, next);
    if (moved) await setField('photos', photoId, 'order', await nextPhotoOrder(photo.projectId, next, photoId));
  });
}

/** Swap an issue with its neighbour of the same kind (their numbers swap; deficiency photo labels follow). */
export async function moveIssue(issueId: string, dir: -1 | 1): Promise<void> {
  await db.transaction('rw', db.issues, db.fieldChanges, db.meta, async () => {
    const issue = await db.issues.get(issueId);
    if (!issue) return;
    const same = (await db.issues.where('[projectId+kind]').equals([issue.projectId, issue.kind]).toArray()).sort(
      (a, b) => a.number - b.number,
    );
    const i = same.findIndex((x) => x.id === issueId);
    const other = same[i + dir];
    if (!other) return;
    await setField('issues', issue.id, 'number', other.number);
    await setField('issues', other.id, 'number', issue.number);
  });
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
