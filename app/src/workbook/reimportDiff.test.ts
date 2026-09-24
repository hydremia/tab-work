import { describe, expect, it } from 'vitest';
import type { ProjectData, UnitData } from '@a2b/workbook/map';
import { sampleBundle } from '../test/fixtures';
import { toProjectData, type ProjectBundle } from './adapter';
import { canonicalCell, canonicalText, reimportDiff, sameVal, type DiffItem } from './reimportDiff';

/** The values an export of the bundle writes (what the baseline / an untouched workbook holds). */
const exported = (b: ProjectBundle): ProjectData => structuredClone(toProjectData(b).data);
const unit = (pd: ProjectData, type: string, slot: number): UnitData =>
  pd.equipment[type].find((u) => u.slot === slot)!;
const rtuOf = (b: ProjectBundle) => b.equipment.find((e) => e.type === 'rtu')!;
const brief = (i: DiffItem) => `${i.kind}:${i.change}:${i.recKey}|${i.cell ?? '*'}`;

describe('reimportDiff: the four cases', () => {
  it('an untouched workbook and an unchanged app: nothing to review (every unit type, rows, N/A marks, issues)', () => {
    const app = sampleBundle();
    const base = exported(app);
    const d = reimportDiff({ base, app, wb: exported(app) });
    expect(d.items).toEqual([]);
    expect(d.mode).toBe('three-way');
  });

  it('wb == base: the app value stays, changed or not (no prompt)', () => {
    const app = sampleBundle();
    const base = exported(app);
    const wb = exported(app);
    rtuOf(app).data.serial = 'CHANGED-IN-APP';
    app.project.info.technicians = 'Someone else';
    expect(reimportDiff({ base, app, wb }).items).toEqual([]);
  });

  it('wb != base, app == base: incoming change, accepted by default', () => {
    const app = sampleBundle();
    const base = exported(app);
    const wb = exported(app);
    unit(wb, 'rtu', 1).fields!.volts1 = 470;
    const d = reimportDiff({ base, app, wb });
    expect(d.items.map(brief)).toEqual(['incoming:field:unit:rtu#1|volts1']);
    expect(d.items[0]).toMatchObject({
      base: 468,
      app: 468,
      wb: 470,
      defaultChoice: 'wb',
      groupTitle: 'RTU-1',
      remark: false,
    });
    expect(d.items[0].label).toMatch(/Voltage L1/);
    expect(d.counts).toMatchObject({ incoming: 1, collisions: 0, equipmentAdded: 0 });
  });

  it('wb != base, app != base, wb == app: no prompt', () => {
    const app = sampleBundle();
    const base = exported(app);
    const wb = exported(app);
    unit(wb, 'rtu', 1).fields!.volts1 = 470;
    rtuOf(app).data.volts1 = 470;
    expect(reimportDiff({ base, app, wb }).items).toEqual([]);
  });

  it('wb != base, app != base, wb != app: collision with base / app / workbook values and no default', () => {
    const app = sampleBundle();
    const base = exported(app);
    const wb = exported(app);
    unit(wb, 'rtu', 1).fields!.amps1 = 3.8;
    rtuOf(app).data.amps1 = 4.0;
    const d = reimportDiff({ base, app, wb });
    expect(d.items.map(brief)).toEqual(['collision:field:unit:rtu#1|amps1']);
    expect(d.items[0]).toMatchObject({ base: 3.9, app: 4, wb: 3.8, defaultChoice: null });
    expect(d.counts.collisions).toBe(1);
  });
});

describe('reimportDiff: normalization (no false changes from an Excel re-save)', () => {
  it('number formatting, float noise, text numbers, trimming, date serials and US dates, N/A case', () => {
    const app = sampleBundle();
    const base = exported(app);
    const wb = exported(app);
    const u = unit(wb, 'rtu', 1);
    u.fields!.volts1 = '468.0'; // a number stored as text
    u.fields!.amps1 = 3.9000000000000004; // float noise
    u.fields!.serial = '  4719G  '; // spaces
    u.fields!.fla = 'not avail.'; // notation case
    u.schedule!.designTotalCfm = 1000.0000000001;
    const pi = wb.sections.projectInfo.fields!;
    pi.tabDate = 46280; // Excel date serial of 2026-09-15
    pi.reportDate = '9/23/2026'; // US date text
    pi.electricalEngineer = 'n/a';
    pi.address = `${String(pi.address)}\u00a0 `;
    wb.sections.narrative.fields!.text = String(wb.sections.narrative.fields!.text).replace('\n', '\r\n') + '\n';
    unit(wb, 'rtu', 1).tables!.supply[0].finalVel = '505';
    const d = reimportDiff({ base, app, wb });
    expect(d.items.map(brief)).toEqual([]);
  });

  it('canonical helpers', () => {
    expect(canonicalCell(46280, 'date')).toBe('2026-09-15');
    expect(canonicalCell('46280', 'date')).toBe('2026-09-15');
    expect(canonicalCell('9/15/26', 'date')).toBe('2026-09-15');
    expect(canonicalCell(' 1,250.0 ', 'number')).toBe(1250);
    expect(canonicalCell(0.1 + 0.2, 'number')).toBe(0.3);
    expect(canonicalCell(12, 'text')).toBe('12');
    expect(canonicalCell('   ', 'text')).toBeNull();
    expect(canonicalCell('NOT ACC', 'number')).toBe('Not Acc.');
    expect(canonicalText('a  \r\nb\u00a0')).toBe('a\nb');
    expect(sameVal(1, '1.0')).toBe(true);
    expect(sameVal(1, 1 + 1e-12)).toBe(true);
    expect(sameVal('N/A', null)).toBe(false);
  });

  it('a real change is still found after normalization', () => {
    const app = sampleBundle();
    const base = exported(app);
    const wb = exported(app);
    unit(wb, 'rtu', 1).fields!.serial = '4719G-B';
    wb.sections.projectInfo.fields!.tabDate = 46281;
    expect(reimportDiff({ base, app, wb }).items.map(brief)).toEqual([
      'incoming:field:project|info.tabDate',
      'incoming:field:unit:rtu#1|serial',
    ]);
  });
});

describe('reimportDiff: rows, units, N/A marks, issues, remarks', () => {
  it('rows added / removed / changed in the workbook (matched by No.)', () => {
    const app = sampleBundle();
    const base = exported(app);
    const wb = exported(app);
    const sup = unit(wb, 'rtu', 1).tables!.supply;
    // a row inserted in the middle: with a unique No. on every row, the rows below it do not shift
    sup.splice(1, 0, { no: 'S-1A', area: 'Lobby', type: 'CD', size: '12x12', ak: 0.5, designCfm: 100, finalVel: 190 });
    sup[2].finalVel = 480; // S-2 changed
    unit(wb, 'vav', 1).tables!.outlets.pop(); // VAV row 2 removed
    const d = reimportDiff({ base, app, wb });
    expect(d.items.map(brief).sort()).toEqual([
      'incoming:added:row:rtu#1:supply:no:s-1a|*',
      'incoming:field:row:rtu#1:supply:no:s-2|finalVel',
      'incoming:removed:row:vav#1:outlets:no:2|*',
    ]);
    const added = d.items.find((i) => i.change === 'added')!;
    expect(added.wb).toContain('S-1A');
    expect(added.defaultChoice).toBe('wb');
    const field = d.items.find((i) => i.change === 'field')!;
    expect(field.label).toMatch(/S-2/);
  });

  it('rows without a unique No. are matched by position', () => {
    const app = sampleBundle();
    const base = exported(app);
    const wb = exported(app);
    const sup = unit(wb, 'rtu', 1).tables!.supply;
    sup[1].no = null; // one blank No.
    sup.push({ area: 'Lobby', finalVel: 300 });
    const d = reimportDiff({ base, app, wb });
    expect(d.items.map(brief).sort()).toEqual([
      'incoming:added:row:rtu#1:supply:#2|*',
      'incoming:field:row:rtu#1:supply:#1|no',
    ]);
  });

  it('equipment added in the workbook is one item (its rows included); a removed unit is not accepted by default', () => {
    const app = sampleBundle();
    const base = exported(app);
    const wb = exported(app);
    wb.equipment.vav.push({
      slot: 2,
      schedule: { designation: 'VAV-102', designMaxCfm: 300 },
      tables: { outlets: [{ no: '1', finalVel: 100 }] },
    });
    wb.equipment.fan = wb.equipment.fan.filter((u) => u.slot !== 3);
    const d = reimportDiff({ base, app, wb });
    expect(d.items.map(brief).sort()).toEqual(['incoming:added:unit:vav#2|*', 'incoming:removed:unit:fan#3|*']);
    expect(d.counts.equipmentAdded).toBe(1);
    expect(d.items.find((i) => i.change === 'removed')).toMatchObject({ defaultChoice: 'app', label: 'EF-1' });
    expect(d.items.find((i) => i.change === 'added')?.groupTitle).toBe('VAV-102');
  });

  it('N/A marks: a changed notation, a value replaced by N/A, a whole table N/A; automatic N/A never shows', () => {
    const app = sampleBundle();
    const base = exported(app);
    const wb = exported(app);
    const u = unit(wb, 'rtu', 1);
    u.fields!.fla = 'Not Acc.'; // was Not Avail.
    u.fields!.serial = 'N/A'; // a value -> N/A
    u.tables!.oa = [{ no: 'N/A' }]; // whole OA table N/A
    const d = reimportDiff({ base, app, wb });
    expect(d.items.map(brief).sort()).toEqual([
      'incoming:field:unit:rtu#1|fla',
      'incoming:field:unit:rtu#1|serial',
      'incoming:field:unit:rtu#1|table:oa',
      'incoming:removed:row:rtu#1:oa:no:oa-1|*',
    ]);
    expect(d.items.find((i) => i.cell === 'fla')).toMatchObject({ base: 'Not Avail.', wb: 'Not Acc.' });
  });

  it('a switch to direct drive in the app: its automatic N/A drive data is not a change', () => {
    const app = sampleBundle();
    const base = exported(app);
    const wb = exported(app);
    rtuOf(app).data.driveType = 'Direct';
    expect(reimportDiff({ base, app, wb }).items).toEqual([]);
  });

  it('issues: a polished remark (grouped as a remark), a status change, an issue added in Excel', () => {
    const app = sampleBundle();
    const base = exported(app);
    const wb = exported(app);
    const rows = wb.sections.issuesNew.tables!.issues;
    rows[1].remark = 'Ceiling access blocked at the corridor (east end).';
    rows[1].status = 'Closed';
    rows.push({ no: 3, remark: 'RTU-1: filter rack bent', status: 'Open' });
    const d = reimportDiff({ base, app, wb });
    expect(d.items.map(brief).sort()).toEqual([
      'incoming:added:issue:new#3|*',
      'incoming:field:issue:new#2|remark',
      'incoming:field:issue:new#2|status',
    ]);
    expect(d.items.find((i) => i.cell === 'remark')).toMatchObject({ remark: true, group: 'issues' });
    expect(d.counts.remarks).toBe(1);
  });

  it('unit remarks and the narrative', () => {
    const app = sampleBundle();
    const base = exported(app);
    const wb = exported(app);
    unit(wb, 'rtu', 1).lines!.remarks = ['Belt replaced; tension checked.', 'Second remark line.'];
    wb.sections.narrative.fields!.text = 'Three RTUs, VAVs and fans.';
    const d = reimportDiff({ base, app, wb });
    expect(d.items.map((i) => [i.group, i.cell, i.remark])).toEqual([
      ['narrative', 'info.narrative', false],
      ['unit:rtu#1', 'remarks', true],
    ]);
    expect(d.items[1].wb).toBe('Belt replaced; tension checked.\nSecond remark line.');
  });

  it('removed in the workbook but changed in the app is a collision (and vice versa)', () => {
    const app = sampleBundle();
    const base = exported(app);
    const wb = exported(app);
    unit(wb, 'vav', 1).tables!.outlets.pop(); // VAV row "2" removed in Excel ...
    app.rows.find((r) => r.data.no === '2')!.data.finalVel = 205; // ... and changed in the app
    const d = reimportDiff({ base, app, wb });
    expect(d.items.map(brief)).toEqual(['collision:removed:row:vav#1:outlets:no:2|*']);
    expect(d.items[0].defaultChoice).toBeNull();

    const app2 = sampleBundle();
    const wb2 = exported(app2);
    unit(wb2, 'vav', 1).tables!.outlets[1].finalVel = 215; // changed in Excel ...
    app2.rows = app2.rows.filter((r) => r.data.no !== '2'); // ... deleted in the app
    expect(reimportDiff({ base: exported(sampleBundle()), app: app2, wb: wb2 }).items.map(brief)).toEqual([
      'collision:restored:row:vav#1:outlets:no:2|*',
    ]);
  });
});

describe('reimportDiff: without a baseline (marker missing, no revision)', () => {
  it('two-way: every difference is an incoming change (the app side is the base)', () => {
    const app = sampleBundle();
    const wb = exported(app);
    rtuOf(app).data.serial = 'NEW-IN-APP';
    unit(wb, 'rtu', 1).fields!.volts1 = 470;
    const d = reimportDiff({ base: null, app, wb });
    expect(d.mode).toBe('two-way');
    expect(d.items.map(brief).sort()).toEqual(['incoming:field:unit:rtu#1|serial', 'incoming:field:unit:rtu#1|volts1']);
    expect(d.items.find((i) => i.cell === 'serial')).toMatchObject({ app: 'NEW-IN-APP', wb: '4719G' });
    expect(d.counts.collisions).toBe(0);
  });
});
