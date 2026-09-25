/**
 * Shared calibration library: copies into a project's calibration slots, "Update from library", issued reports never
 * change, capacity, deletes, and sync between two devices (library changes filed under the instrument's own id).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDevice, type Device } from '../test/devices';
import { FakeSyncServer } from '../sync/fakeServer';
import { toProjectData } from '../workbook/adapter';
import { loadBundle } from '../workbook/bundle';
import { db } from './db';
import {
  addInstrumentFromLibrary,
  addLibraryInstrument,
  CapacityError,
  createProject,
  deleteLibraryInstrument,
  differsFromLibrary,
  LockedError,
  lockProject,
  saveInstrumentToLibrary,
  setField,
  updateInstrumentFromLibrary,
} from './repo';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const meter = {
  type: 'Digital Micromanometer',
  manufacturer: 'Evergreen Telemetry',
  model: 'S-PVF-1',
  serial: '1700164',
  calibrationDate: '2025-11-21',
};

describe('calibration library (one device)', () => {
  it('a project keeps its own copy; the library edit is offered as "Update from library"', async () => {
    const p = await createProject({ name: 'Library' });
    const lib = await addLibraryInstrument(meter);
    const ins = await addInstrumentFromLibrary(p.id, lib.id);
    expect(ins).toMatchObject({ ...meter, libraryId: lib.id, order: 7 }); // after the 7 template instruments
    // outbox: the library record's changes are filed under its own id
    const logged = await db.fieldChanges
      .where('[table+recordId+field]')
      .equals(['libraryInstruments', lib.id, ''])
      .first();
    expect(logged?.projectId).toBe(lib.id);

    await setField('libraryInstruments', lib.id, 'calibrationDate', '2026-09-20');
    const copy = (await db.instruments.get(ins.id))!;
    expect(copy.calibrationDate).toBe('2025-11-21'); // not changed silently
    expect(differsFromLibrary(copy, (await db.libraryInstruments.get(lib.id))!)).toBe(true);
    await updateInstrumentFromLibrary(ins.id);
    expect((await db.instruments.get(ins.id))!.calibrationDate).toBe('2026-09-20');
    const { data } = toProjectData(await loadBundle(p.id));
    expect(data.sections.calibration?.tables?.instruments?.[7]).toMatchObject({ calibrationDate: '2026-09-20' });
  });

  it('save a project row to the library; capacity 8; an issued report is frozen; deleting unlinks', async () => {
    const p = await createProject({ name: 'Save' });
    const first = (await db.instruments.where('projectId').equals(p.id).sortBy('order'))[0];
    const lib = await saveInstrumentToLibrary(first.id);
    expect(lib).toMatchObject({ type: first.type, serial: first.serial, calibrationDate: first.calibrationDate });
    expect((await db.instruments.get(first.id))!.libraryId).toBe(lib.id);
    const other = await addLibraryInstrument(meter);
    await addInstrumentFromLibrary(p.id, other.id); // 8 of 8
    await expect(addInstrumentFromLibrary(p.id, other.id)).rejects.toBeInstanceOf(CapacityError);

    await deleteLibraryInstrument(lib.id);
    expect((await db.instruments.get(first.id))!).toMatchObject({ libraryId: null, serial: first.serial });
  });

  it('a locked project refuses library copies; library edits never touch it', async () => {
    const p = await createProject({ name: 'Locked' });
    const lib = await addLibraryInstrument(meter);
    await db.instruments.where('projectId').equals(p.id).delete(); // room
    const ins = await addInstrumentFromLibrary(p.id, lib.id);
    await lockProject(p.id, 'Prelim', null);
    await expect(addInstrumentFromLibrary(p.id, lib.id)).rejects.toBeInstanceOf(LockedError);
    await setField('libraryInstruments', lib.id, 'calibrationDate', '2026-09-20');
    await expect(updateInstrumentFromLibrary(ins.id)).rejects.toBeInstanceOf(LockedError);
    await deleteLibraryInstrument(lib.id); // the locked copy keeps its (dangling) link and details
    expect(await db.libraryInstruments.count()).toBe(0);
    expect(await db.instruments.get(ins.id)).toMatchObject({ libraryId: lib.id, calibrationDate: '2025-11-21' });
  });
});

describe('calibration library sync (two devices)', () => {
  let server: FakeSyncServer;
  let A: Device;
  let B: Device;
  beforeEach(() => {
    server = new FakeSyncServer();
    A = makeDevice(server, 'A', server.addUser('alice@a2b.test'));
    B = makeDevice(server, 'B', server.addUser('bob@a2b.test'));
  });

  it('a library made on A reaches B; B copies it into a project; A recalibrates; B updates from the library', async () => {
    const lib = await A.run(() => addLibraryInstrument(meter));
    await A.sync();
    await B.sync();
    expect(await B.run(() => db.libraryInstruments.get(lib.id))).toMatchObject(meter);
    expect(server.record('libraryInstruments', lib.id)).toMatchObject({ ...meter, orgId: 'a2b' });
    const { p, ins } = await B.run(async () => {
      const p = await createProject({ name: 'Shared' });
      await db.instruments.where('projectId').equals(p.id).delete();
      return { p, ins: await addInstrumentFromLibrary(p.id, lib.id) };
    });
    await B.sync();
    await A.sync();
    expect(await A.run(async () => (await db.instruments.get(ins.id))?.libraryId)).toBe(lib.id);
    await A.run(() => setField('libraryInstruments', lib.id, 'calibrationDate', '2026-09-20'));
    await A.sync();
    await B.sync();
    await B.run(async () => {
      const copy = (await db.instruments.get(ins.id))!;
      expect(copy.calibrationDate).toBe('2025-11-21');
      expect(differsFromLibrary(copy, (await db.libraryInstruments.get(lib.id))!)).toBe(true);
      await updateInstrumentFromLibrary(ins.id);
    });
    await B.sync();
    await A.sync();
    expect(await A.run(async () => (await db.instruments.get(ins.id))?.calibrationDate)).toBe('2026-09-20');
    expect(server.valueOf('instruments', ins.id, 'calibrationDate')).toBe('2026-09-20');
    expect(p.id).toBeTruthy();
    // the library delete syncs too; the project copy stays
    await A.run(() => deleteLibraryInstrument(lib.id));
    await A.sync();
    await B.sync();
    expect(await B.run(() => db.libraryInstruments.count())).toBe(0);
    expect(await B.run(async () => (await db.instruments.get(ins.id))?.serial)).toBe('1700164');
  });
});
