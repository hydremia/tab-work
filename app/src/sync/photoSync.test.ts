/**
 * Photo files and the cloud: upload after the record is pushed, retry with backoff, resume after a reload, deletes
 * propagate (file removed by the deleting device, record removed on the other), the other device downloads the file.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { addPhoto, createProject, deleteRecord } from '../data/repo';
import { makeDevice, type Device } from '../test/devices';
import { photoPath } from './backend';
import { FakeSyncServer } from './fakeServer';
import { backoff, processPhotoQueue, resumePhotoQueue } from './photoSync';

let server: FakeSyncServer;
let A: Device;
let B: Device;

beforeEach(() => {
  server = new FakeSyncServer();
  A = makeDevice(server, 'A', server.addUser('alice@a2b.test'));
  B = makeDevice(server, 'B', server.addUser('bob@a2b.test'));
});

const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

async function withPhoto() {
  return A.run(async () => {
    const p = await createProject({ name: 'Photos' });
    const photo = await addPhoto(p.id, jpeg(), 'other');
    return { p, photo };
  });
}

describe('photo upload queue', () => {
  it('uploads after the record is pushed; the other device downloads the file', async () => {
    const { p, photo } = await withPhoto();
    // not before the project is on the server
    expect(await A.run(() => processPhotoQueue(A.backend))).toMatchObject({ uploaded: 0 });
    const res = await A.sync();
    expect(res.photos).toMatchObject({ uploaded: 1, failed: 0 });
    expect(server.files.get(photoPath(p.id, photo.id))).toMatchObject({ contentType: 'image/jpeg' });
    await A.run(async () => {
      expect((await db.photoUploads.get(photo.id))?.status).toBe('done');
      expect((await db.photos.get(photo.id))?.uploaded).toBe(1);
    });
    const rb = await B.sync();
    expect(rb.photos?.downloaded).toBe(1);
    await B.run(async () => {
      const got = await db.photos.get(photo.id);
      expect(got?.blob).toBeTruthy(); // (fake-indexeddb keeps a jsdom Blob as a plain object: no size to compare)
      expect(got?.uploaded).toBe(1);
      expect(await db.photoUploads.count()).toBe(0); // nothing for B to upload
    });
  });

  it('a pulled photo whose file is not uploaded yet shows up without it and is fetched on a later sync', async () => {
    const { photo } = await withPhoto();
    A.backend.failUploads = 1;
    await A.sync();
    await B.sync();
    await B.run(async () => expect((await db.photos.get(photo.id))?.blob).toBeNull());
    await A.run(() => processPhotoQueue(A.backend, Date.now() + backoff(1)));
    await B.sync();
    await B.run(async () => expect((await db.photos.get(photo.id))?.blob).not.toBeNull());
  });

  it('retries with exponential backoff and records the error', async () => {
    const { photo } = await withPhoto();
    A.backend.failUploads = 2;
    const t0 = Date.now();
    await A.sync();
    const e1 = await A.run(() => db.photoUploads.get(photo.id));
    expect(e1).toMatchObject({ status: 'failed', attempts: 1, lastError: expect.stringMatching(/Failed to fetch/) });
    expect(e1!.nextAttemptAt! - t0).toBeGreaterThanOrEqual(backoff(1));
    // not due yet: nothing is tried
    const calls = A.backend.calls.upload;
    await A.run(() => processPhotoQueue(A.backend, t0 + 1000));
    expect(A.backend.calls.upload).toBe(calls);
    await A.run(() => processPhotoQueue(A.backend, e1!.nextAttemptAt!));
    const e2 = await A.run(() => db.photoUploads.get(photo.id));
    expect(e2).toMatchObject({ status: 'failed', attempts: 2 });
    expect(e2!.nextAttemptAt! - e1!.nextAttemptAt!).toBeGreaterThanOrEqual(backoff(2));
    await A.run(() => processPhotoQueue(A.backend, e2!.nextAttemptAt!));
    expect((await A.run(() => db.photoUploads.get(photo.id)))?.status).toBe('done');
    expect(backoff(1)).toBe(5000);
    expect(backoff(2)).toBe(10_000);
    expect(backoff(30)).toBe(3600_000);
  });

  it('resumes after a reload: an upload left "uploading" by a closed app is sent again', async () => {
    const { photo } = await withPhoto();
    await A.run(() => A.engine.push());
    await A.run(() => db.photoUploads.update(photo.id, { status: 'uploading' }));
    expect(await A.run(() => resumePhotoQueue())).toBe(1);
    expect((await A.run(() => processPhotoQueue(A.backend))).uploaded).toBe(1);
  });

  it('deletes propagate: the file is removed from storage and the photo from the other device', async () => {
    const { p, photo } = await withPhoto();
    await A.sync();
    await B.sync();
    await A.run(() => deleteRecord('photos', photo.id));
    expect((await A.run(() => db.photoUploads.get(photo.id)))?.status).toBe('delete');
    A.backend.offline = true;
    await expect(A.sync()).rejects.toBeTruthy();
    A.backend.offline = false;
    const res = await A.sync();
    expect(res.photos?.deleted).toBe(1);
    expect(server.files.has(photoPath(p.id, photo.id))).toBe(false);
    await A.run(async () => expect(await db.photoUploads.count()).toBe(0));
    await B.sync();
    await B.run(async () => expect(await db.photos.get(photo.id)).toBeUndefined());
  });

  it('a photo deleted before it was uploaded never reaches storage', async () => {
    const { photo } = await withPhoto();
    await A.run(() => deleteRecord('photos', photo.id));
    await A.sync();
    expect(A.backend.calls.upload).toBe(0);
    expect(A.backend.calls.remove).toBe(0);
  });

  it('deleting a whole project removes its uploaded files', async () => {
    const { p, photo } = await withPhoto();
    await A.sync();
    await A.run(() => deleteRecord('projects', p.id));
    await A.sync();
    expect(server.files.has(photoPath(p.id, photo.id))).toBe(false);
  });
});
