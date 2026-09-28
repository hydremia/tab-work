/**
 * The certification profile syncs like the calibration library (an organization record filed under its own id, 0006):
 * created on one device, images and CP details reach the other; new projects take the CP lines from it; another
 * organization neither sees nor edits it; two devices each creating one settle on the oldest.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { createProject, ensureCertProfile, getCertProfile, setCertImage, setField } from '../data/repo';
import type { StoredImage } from '../data/types';
import { makeDevice, type Device } from '../test/devices';
import { FakeSyncServer, type FakeUser } from './fakeServer';

let server: FakeSyncServer;
let alice: FakeUser;
let bob: FakeUser;
let A: Device;
let B: Device;

beforeEach(() => {
  server = new FakeSyncServer();
  alice = server.addUser('alice@a2b.test');
  bob = server.addUser('bob@a2b.test');
  A = makeDevice(server, 'A', alice);
  B = makeDevice(server, 'B', bob);
});

const stamp: StoredImage = { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 600, height: 600, type: 'png' };

describe('certification profile sync', () => {
  it('stamp, signature and CP details reach the other device; new projects there start from them', async () => {
    await A.run(async () => {
      const p = await ensureCertProfile();
      await setField('certProfiles', p.id, 'cpName', 'Dana Kim');
      await setField('certProfiles', p.id, 'certNumber', '31337');
      await setCertImage('stamp', stamp);
    });
    await A.sync();
    await B.sync();
    const onB = await B.run(() => getCertProfile());
    expect(onB).toMatchObject({ cpName: 'Dana Kim', certNumber: '31337', stamp });
    const proj = await B.run(() => createProject({ name: 'Riverside' }));
    expect(proj.info).toMatchObject({ certCpName: 'Dana Kim', certNumber: '31337' });
    // B removes the stamp: gone on A too
    await B.run(() => setCertImage('stamp', null));
    await B.sync();
    await A.sync();
    expect((await A.run(() => getCertProfile()))?.stamp).toBeNull();
    // the server's copy
    expect(server.valueOf('certProfiles', onB!.id, 'cpName')).toBe('Dana Kim');
  });

  it('two profiles created offline merge into the oldest: missing images move over, a different value is a conflict', async () => {
    const a = await A.run(() => ensureCertProfile());
    await new Promise((r) => setTimeout(r, 5)); // A's is the older one
    const b = await B.run(async () => {
      const p = await ensureCertProfile();
      await setCertImage('stamp', stamp); // only B has a stamp
      await setField('certProfiles', p.id, 'cpName', 'Dana Kim'); // A keeps the template's name
      return p;
    });
    await A.sync();
    await B.sync();
    await A.sync();
    await B.sync();
    const [keep, gone] = [a, b];
    expect(a.createdAt).toBeLessThan(b.createdAt);
    for (const d of [A, B]) {
      const p = await d.run(() => getCertProfile());
      expect(p?.id).toBe(keep.id);
      expect(p?.stamp).toEqual(stamp); // B's stamp is not lost
      expect(await d.run(() => db.certProfiles.get(gone.id))).toBeUndefined();
    }
    // the names differ: a conflict on the kept profile (the older name stays until someone picks)
    const conflicts = await B.run(() => db.conflicts.where('recordId').equals(keep.id).toArray());
    expect(conflicts.find((c) => c.field === 'cpName' && c.status === 'open')).toMatchObject({
      current: { value: 'Isaac Rochester' },
      other: { value: 'Dana Kim' },
    });
    expect((await A.run(() => getCertProfile()))?.cpName).toBe('Isaac Rochester');
  });

  it('another organization neither sees nor edits it', async () => {
    const x = makeDevice(server, 'X', server.addUser('x@other.test', 'other'));
    const p = await A.run(() => ensureCertProfile());
    await A.sync();
    await x.sync();
    expect(await x.run(() => db.certProfiles.count())).toBe(0);
    expect(() =>
      server.push(x.user.id, [
        {
          id: crypto.randomUUID(),
          project_id: p.id,
          table_name: 'certProfiles',
          record_id: p.id,
          op: 'set',
          field: 'cpName',
          value: 'x',
          user_id: x.user.id,
          device_id: 'X',
          client_ts: Date.now(),
        },
      ]),
    ).toThrow(/TAB_FORBIDDEN/);
  });
});
