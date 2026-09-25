/**
 * Certification (Certification sheet) and the Building Balance spare OA rows: export, import (automatic prelim N/A),
 * the re-import diff, project-level completion and the Building Balance totals. The real-template round trip is in
 * exportProject.test.ts style (export -> importWorkbook) at the end.
 */
import { describe, expect, it } from 'vitest';
import type { ProjectData } from '@a2b/workbook/map';
import { exportWorkbook, importWorkbook } from '@a2b/workbook';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CERT_KEYS, certificationExpired, certificationStates } from '../domain/certification';
import { buildingBalance } from '../domain/equipmentCalcs';
import { computeProjectCompletion } from '../domain/projectCompletion';
import { spareOaKey, spareOaTotals, spareOaUsedCount } from '../domain/spareOa';
import { sampleBundle } from '../test/fixtures';
import { fromProjectData, toProjectData, type ProjectBundle } from './adapter';
import { reimportDiff } from './reimportDiff';

const exported = (b: ProjectBundle): ProjectData => structuredClone(toProjectData(b).data);

function signed(kind: 'prelim' | 'final' = 'final'): ProjectBundle {
  const b = sampleBundle();
  b.project.reportKind = kind;
  Object.assign(b.project.info, {
    [CERT_KEYS.cpName]: 'Dana Smith',
    [CERT_KEYS.number]: '31337',
    [CERT_KEYS.expiration]: '2027-06-30',
    [CERT_KEYS.signature]: 'Dana Smith',
    [CERT_KEYS.date]: '2026-10-02',
  });
  return b;
}

describe('Certification', () => {
  it('export: every line; the template CP when never set; prelim signature / date automatically N/A', () => {
    expect(toProjectData(signed()).data.sections.certification?.fields).toEqual({
      cpName: 'Dana Smith',
      certNumber: '31337',
      expiration: '2027-06-30',
      signature: 'Dana Smith',
      date: '2026-10-02',
    });
    const b = sampleBundle(); // prelim, never set
    for (const k of Object.values(CERT_KEYS)) delete b.project.info[k];
    expect(toProjectData(b).data.sections.certification?.fields).toEqual({
      cpName: 'Isaac Rochester',
      certNumber: '24053',
      expiration: '2026-12-31',
      signature: 'N/A',
      date: 'N/A',
    });
    // final, not signed yet: blank lines (required, so the project shows them as missing)
    b.project.reportKind = 'final';
    b.project.info[CERT_KEYS.cpName] = '';
    expect(toProjectData(b).data.sections.certification?.fields).toMatchObject({
      cpName: null,
      signature: null,
      date: null,
    });
  });

  it('import: values back; the prelim "N/A" is automatic, not a mark; a blank CP line is blank, not the default', () => {
    const back = fromProjectData(exported(signed()));
    expect(back.project.info).toMatchObject({
      certCpName: 'Dana Smith',
      certNumber: '31337',
      certExpiration: '2027-06-30',
      certSignature: 'Dana Smith',
      certDate: '2026-10-02',
    });
    const pre = sampleBundle();
    const back2 = fromProjectData(exported(pre));
    expect(back2.project.naState.fields[CERT_KEYS.signature]).toBeUndefined();
    expect(back2.project.info[CERT_KEYS.signature]).toBeUndefined();
    const cleared = exported(pre);
    cleared.sections.certification!.fields!.cpName = null;
    delete cleared.sections.certification!.fields!.cpName;
    expect(fromProjectData(cleared).project.info[CERT_KEYS.cpName]).toBeNull();
  });

  it('re-import diff: a signature added in Excel is incoming in the Certification group; untouched = nothing', () => {
    const app = signed();
    app.project.info[CERT_KEYS.signature] = null;
    const base = exported(app);
    const wb = exported(app);
    wb.sections.certification!.fields!.signature = 'Dana Smith';
    wb.sections.certification!.fields!.expiration = '2027-12-31';
    const d = reimportDiff({ base, app, wb });
    expect(d.items.map((i) => [i.kind, i.cell, i.group, i.section, i.wb])).toEqual([
      ['incoming', 'info.certExpiration', 'certification', 'Certification', '2027-12-31'],
      ['incoming', 'info.certSignature', 'certification', 'Certification', 'Dana Smith'],
    ]);
    const pre = sampleBundle();
    expect(reimportDiff({ base: exported(pre), app: pre, wb: exported(pre) }).items).toEqual([]);
    expect(reimportDiff({ base: null, app: pre, wb: exported(pre) }).items).toEqual([]);
  });

  it('completion: signature and date required on a final report only; expiry before the report date flagged', () => {
    const input = (b: ProjectBundle) => ({
      project: b.project,
      hasHoods: true,
      hasCover: true,
      instruments: b.instruments,
    });
    const pre = sampleBundle();
    expect(computeProjectCompletion(input(pre)).missing.filter((m) => m.section === 'certification')).toEqual([]);
    expect(certificationStates(pre.project)[CERT_KEYS.signature]).toMatchObject({ state: 'auto-na' });
    const fin = sampleBundle();
    fin.project.reportKind = 'final';
    expect(
      computeProjectCompletion(input(fin))
        .missing.filter((m) => m.section === 'certification')
        .map((m) => m.key),
    ).toEqual([CERT_KEYS.signature, CERT_KEYS.date]);
    expect(computeProjectCompletion(input(signed())).missing.filter((m) => m.section === 'certification')).toEqual([]);
    const old = signed();
    old.project.info[CERT_KEYS.expiration] = '2026-01-31';
    old.project.info.reportDate = '2026-09-24';
    expect(certificationExpired(old.project)).toBe(true);
    expect(certificationExpired(signed().project)).toBe(false);
  });
});

describe('Building Balance: other outside air (spare OA rows)', () => {
  const withOa = (): ProjectBundle => {
    const b = sampleBundle();
    Object.assign(b.project.info, {
      [spareOaKey(1, 'Unit')]: 'Transfer grille',
      [spareOaKey(1, 'Design')]: 400,
      [spareOaKey(1, 'Actual')]: 380,
      [spareOaKey(3, 'Unit')]: 'Relief',
      [spareOaKey(3, 'Design')]: '250', // typed as text somewhere: coerced
    });
    b.project.naState.fields[spareOaKey(3, 'Actual')] = { notation: 'Not Acc.' };
    return b;
  };

  it('export keeps positions; import brings values and marks back; totals include the rows', () => {
    const b = withOa();
    expect(exported(b).sections.buildingBalance?.tables?.spareOa).toEqual([
      { unit: 'Transfer grille', design: 400, actual: 380 },
      {},
      { unit: 'Relief', design: 250, actual: 'Not Acc.' },
    ]);
    const back = fromProjectData(exported(b));
    expect(back.project.info).toMatchObject({ bbOa1Unit: 'Transfer grille', bbOa1Design: 400, bbOa3Design: 250 });
    expect(back.project.naState.fields[spareOaKey(3, 'Actual')]).toEqual({ notation: 'Not Acc.' });
    expect(spareOaUsedCount(back.project)).toBe(3);
    const t = spareOaTotals(b.project);
    expect(t).toEqual({ design: 400, actual: 380 }); // "250" is text in the app: the workbook gets 250 though
    const bb = buildingBalance([], [], spareOaTotals(back.project));
    expect(bb).toMatchObject({ oaDesign: 650, oaActual: 380 });
  });

  it('re-import diff: an actual CFM typed in Excel is incoming in the "Other outside air" group', () => {
    const app = withOa();
    const base = exported(app);
    const wb = exported(app);
    wb.sections.buildingBalance!.tables!.spareOa![0].actual = 395;
    wb.sections.buildingBalance!.tables!.spareOa!.push({}, { unit: 'Door', design: 50 });
    const d = reimportDiff({ base, app, wb });
    expect(d.items.map((i) => [i.kind, i.cell, i.group, i.wb])).toEqual([
      ['incoming', 'info.bbOa1Actual', 'spareOa', 395],
      ['incoming', 'info.bbOa5Unit', 'spareOa', 'Door'],
      ['incoming', 'info.bbOa5Design', 'spareOa', 50],
    ]);
  });

  it('round trip through the real template (Certification sheet texts, Building Balance rows 67-86)', async () => {
    const template = new Uint8Array(
      readFileSync(join(__dirname, '..', '..', '..', '05 - a2b_Blank_TAB_Workbook 9-23-26.xlsm')),
    );
    const b = signed();
    Object.assign(b.project.info, withOa().project.info);
    b.project.naState.fields = { ...b.project.naState.fields, ...withOa().project.naState.fields };
    const bytes = await exportWorkbook(template, toProjectData(b).data);
    const back = fromProjectData(await importWorkbook(bytes));
    for (const k of Object.values(CERT_KEYS)) expect(back.project.info[k], k).toEqual(b.project.info[k]);
    expect(back.project.info[spareOaKey(3, 'Design')]).toBe(250);
    expect(back.project.naState.fields[spareOaKey(3, 'Actual')]).toEqual({ notation: 'Not Acc.' });
  }, 60_000);
});
