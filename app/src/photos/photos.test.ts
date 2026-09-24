import { describe, expect, it } from 'vitest';
import { db } from '../data/db';
import {
  addEquipment,
  addIssue,
  addPhoto,
  createProject,
  deleteRecord,
  moveIssue,
  movePhoto,
  reassignPhoto,
  replacePhoto,
} from '../data/repo';
import type { Photo } from '../data/types';
import {
  allPhotoLabels,
  deficiencyLabels,
  groupKeyOf,
  groupPhotoLabels,
  issueLabel,
  safeFileName,
  zipEntryNames,
  type PhotoMeta,
} from './labels';

const jpg = (name = 'x.jpg') =>
  Object.assign(new Blob([new Uint8Array([0xff, 0xd8, 1])], { type: 'image/jpeg' }), { name });

async function setup() {
  const p = await createProject({ name: 'Photo Test' });
  const rtu1 = await addEquipment(p.id, 'rtu', 'RTU-1');
  const rtu2 = await addEquipment(p.id, 'rtu', 'RTU-2');
  const n1 = await addIssue(p.id, { kind: 'new', remark: 'Belt worn', equipmentId: rtu1.id });
  const n2 = await addIssue(p.id, { kind: 'new', remark: 'Damper stuck' });
  const e1 = await addIssue(p.id, { kind: 'existing', remark: 'Old unit leaks', equipmentId: rtu2.id });
  return { p, rtu1, rtu2, n1, n2, e1 };
}

const photosOf = async (projectId: string) => db.photos.where('projectId').equals(projectId).toArray();

describe('photo numbering and labels', () => {
  it('issue labels: N-/E- with separate numbering', async () => {
    const { n1, n2, e1 } = await setup();
    expect([issueLabel(n1), issueLabel(n2), issueLabel(e1)]).toEqual(['N-1', 'N-2', 'E-1']);
  });

  it('deficiency photos are numbered to their issue and renumber on reorder / issue move', async () => {
    const { p, n1, n2, e1 } = await setup();
    const a = await addPhoto(p.id, jpg(), { category: 'deficiency', issueId: n2.id });
    const b = await addPhoto(p.id, jpg(), { category: 'deficiency', issueId: n2.id });
    const c = await addPhoto(p.id, jpg(), { category: 'deficiency', issueId: e1.id });
    let issues = await db.issues.toArray();
    let labels = deficiencyLabels(await photosOf(p.id), issues);
    expect([labels.get(a.id), labels.get(b.id), labels.get(c.id)]).toEqual([
      'Photo N-2.1',
      'Photo N-2.2',
      'Photo E-1.1',
    ]);

    await movePhoto(b.id, -1);
    labels = deficiencyLabels(await photosOf(p.id), await db.issues.toArray());
    expect([labels.get(a.id), labels.get(b.id)]).toEqual(['Photo N-2.2', 'Photo N-2.1']);

    await moveIssue(n2.id, -1); // N-2 becomes N-1
    issues = await db.issues.toArray();
    expect(issues.find((i) => i.id === n2.id)?.number).toBe(1);
    expect(issues.find((i) => i.id === n1.id)?.number).toBe(2);
    labels = deficiencyLabels(await photosOf(p.id), issues);
    expect([labels.get(b.id), labels.get(a.id), labels.get(c.id)]).toEqual([
      'Photo N-1.1',
      'Photo N-1.2',
      'Photo E-1.1',
    ]);
    // moving past the end is a no-op
    await moveIssue(e1.id, 1);
    expect((await db.issues.get(e1.id))?.number).toBe(1);
  });

  it('equipment photo labels number repeated categories; general photos are "General n"', () => {
    const mk = (id: string, category: Photo['category'], order: number): PhotoMeta => ({
      id,
      projectId: 'p',
      equipmentId: 'e',
      issueId: null,
      category,
      caption: '',
      createdAt: order,
      order,
    });
    const labels = groupPhotoLabels(
      [mk('u', 'unit', 1), mk('t', 'tag', 2), mk('o1', 'other', 3), mk('o2', 'other', 4)],
      'RTU-1',
    );
    expect([...labels.values()]).toEqual(['RTU-1 · Unit', 'RTU-1 · Tag / label', 'RTU-1 · Other 1', 'RTU-1 · Other 2']);
    expect([...groupPhotoLabels([mk('g1', 'other', 1), mk('g2', 'other', 2)], null).values()]).toEqual([
      'General 1',
      'General 2',
    ]);
  });

  it('zip entry names', async () => {
    const { p, rtu1, n2, e1 } = await setup();
    const unit = await addPhoto(p.id, jpg(), 'unit', rtu1.id);
    const tag = await addPhoto(p.id, jpg(), 'tag', rtu1.id);
    const oa = await addPhoto(p.id, jpg(), 'oa_damper', rtu1.id);
    const o1 = await addPhoto(p.id, jpg(), 'other', rtu1.id);
    const o2 = await addPhoto(p.id, jpg(), 'other', rtu1.id);
    const d1 = await addPhoto(p.id, jpg(), { category: 'deficiency', issueId: n2.id });
    const d2 = await addPhoto(p.id, jpg(), { category: 'deficiency', issueId: e1.id });
    const d3 = await addPhoto(p.id, jpg(), { category: 'deficiency', issueId: e1.id });
    const g = await addPhoto(p.id, jpg(), 'other');
    const cover = await addPhoto(p.id, jpg(), 'cover');
    const names = zipEntryNames(await photosOf(p.id), await db.equipment.toArray(), await db.issues.toArray());
    expect(names.get(unit.id)).toBe('RTU-1 - Unit - 01.jpg');
    expect(names.get(tag.id)).toBe('RTU-1 - Tag - 01.jpg');
    expect(names.get(oa.id)).toBe('RTU-1 - OA Damper - 01.jpg');
    expect(names.get(o1.id)).toBe('RTU-1 - Other - 01.jpg');
    expect(names.get(o2.id)).toBe('RTU-1 - Other - 02.jpg');
    expect(names.get(d1.id)).toBe('Issue N-2 - 1.jpg');
    expect(names.get(d2.id)).toBe('Issue E-1 - 1.jpg');
    expect(names.get(d3.id)).toBe('Issue E-1 - 2.jpg');
    expect(names.get(g.id)).toBe('General - 01.jpg');
    expect(names.get(cover.id)).toBe('Cover.jpg');
    expect(new Set(names.values()).size).toBe(names.size);
  });

  it('zip names are safe and unique when designations clash', () => {
    expect(safeFileName('RTU/1: "roof"')).toBe('RTU-1- -roof-');
    const photos = ['a', 'b'].map((id, k) => ({
      id,
      projectId: 'p',
      equipmentId: id === 'a' ? 'e1' : 'e2',
      issueId: null,
      category: 'unit' as const,
      caption: '',
      createdAt: k,
      order: 1,
      mimeType: 'image/jpeg',
    }));
    const names = zipEntryNames(
      photos,
      [
        { id: 'e1', designation: 'EF-1' },
        { id: 'e2', designation: 'EF-1' },
      ],
      [],
    );
    expect([...names.values()].sort()).toEqual(['EF-1 - Unit - 01 (2).jpg', 'EF-1 - Unit - 01.jpg']);
  });

  it('allPhotoLabels covers every group', async () => {
    const { p, rtu1, n1 } = await setup();
    const u = await addPhoto(p.id, jpg(), 'unit', rtu1.id);
    const d = await addPhoto(p.id, jpg(), { category: 'deficiency', issueId: n1.id });
    const c = await addPhoto(p.id, jpg(), 'cover');
    const g = await addPhoto(p.id, jpg(), 'other');
    const labels = allPhotoLabels(await photosOf(p.id), await db.equipment.toArray(), await db.issues.toArray());
    expect([labels.get(u.id), labels.get(d.id), labels.get(c.id), labels.get(g.id)]).toEqual([
      'RTU-1 · Unit',
      'Photo N-1.1',
      'Cover photo',
      'General 1',
    ]);
  });
});

describe('photo repository', () => {
  it('addPhoto stores metadata, a thumbnail and an upload-queue entry; the outbox copy has no blobs', async () => {
    const { p, rtu1 } = await setup();
    const thumb = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
    const photo = await addPhoto(
      p.id,
      {
        blob: jpg(),
        thumb,
        width: 2000,
        height: 1500,
        capturedAt: 123,
        gps: { lat: 1, lon: 2 },
        fileName: 'IMG_1.jpg',
      },
      { category: 'unit', equipmentId: rtu1.id, caption: 'North side' },
    );
    const stored = (await db.photos.get(photo.id))!;
    expect(stored).toMatchObject({
      width: 2000,
      height: 1500,
      capturedAt: 123,
      caption: 'North side',
      order: 1,
      uploaded: 0,
    });
    expect(stored.thumb).toBeTruthy();
    expect(await db.photoUploads.get(photo.id)).toMatchObject({ status: 'pending', projectId: p.id, attempts: 0 });
    const log = (await db.fieldChanges.toArray()).find((c) => c.recordId === photo.id);
    expect(log?.op).toBe('create');
    expect(log?.value).not.toHaveProperty('blob');
    expect(log?.value).not.toHaveProperty('thumb');
    expect(log?.value).toMatchObject({ caption: 'North side', width: 2000 });
  });

  it('deficiency photos carry the issue, not the unit; deleting the issue deletes them and their queue entries', async () => {
    const { p, rtu1, n1 } = await setup();
    const d = await addPhoto(p.id, jpg(), { category: 'deficiency', issueId: n1.id, equipmentId: rtu1.id });
    expect(d.equipmentId).toBeNull();
    expect(d.issueId).toBe(n1.id);
    expect(groupKeyOf(d)).toBe(`issue:${n1.id}`);
    await deleteRecord('issues', n1.id);
    expect(await db.photos.get(d.id)).toBeUndefined();
    expect(await db.photoUploads.get(d.id)).toBeUndefined();
    const logged = (await db.fieldChanges.toArray()).filter((c) => c.recordId === d.id).sort((a, b) => a.ts - b.ts);
    expect(logged.map((c) => c.op)).toEqual(['create', 'delete']);
  });

  it('replacePhoto keeps the slot position; reassign moves the photo to the end of its new group', async () => {
    const { p, rtu1, rtu2 } = await setup();
    const u = await addPhoto(p.id, jpg(), 'unit', rtu1.id);
    const t = await addPhoto(p.id, jpg(), 'tag', rtu1.id);
    const u2 = await replacePhoto(p.id, jpg(), 'unit', rtu1.id);
    expect(await db.photos.get(u.id)).toBeUndefined();
    expect(u2.order).toBe(1);
    expect((await db.photos.get(t.id))?.order).toBe(2);

    await addPhoto(p.id, jpg(), 'unit', rtu2.id);
    await reassignPhoto(t.id, { category: 'other', equipmentId: rtu2.id });
    const moved = (await db.photos.get(t.id))!;
    expect(moved).toMatchObject({ category: 'other', equipmentId: rtu2.id, order: 2 });

    // to General
    await reassignPhoto(t.id, { category: 'other', equipmentId: null });
    expect(groupKeyOf((await db.photos.get(t.id))!)).toBe('general');
  });

  it('deleting a unit deletes its photos but keeps deficiency photos of its issues', async () => {
    const { p, rtu1, n1 } = await setup();
    const u = await addPhoto(p.id, jpg(), 'unit', rtu1.id);
    const d = await addPhoto(p.id, jpg(), { category: 'deficiency', issueId: n1.id });
    await deleteRecord('equipment', rtu1.id);
    expect(await db.photos.get(u.id)).toBeUndefined();
    expect(await db.photos.get(d.id)).toBeTruthy();
    expect((await db.issues.get(n1.id))?.equipmentId).toBeNull();
  });
});
