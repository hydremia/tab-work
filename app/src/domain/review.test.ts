import { describe, expect, it } from 'vitest';
import { emptyNaState, type AirflowRow, type Equipment } from '../data/types';
import { sampleBundle } from '../test/fixtures';
import { computeCompletion } from './completion';
import { acceptanceKey, findingsFingerprint, reviewProject, type ReviewInput } from './review';
import { getSpec } from './specs';

let n = 700;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function input(mut?: (b: ReturnType<typeof sampleBundle>) => void): ReviewInput {
  const b = sampleBundle();
  mut?.(b);
  const completions = new Map(
    b.equipment.map((e) => [
      e.id,
      computeCompletion({
        spec: getSpec(e.type),
        unit: e,
        rows: b.rows.filter((r) => r.equipmentId === e.id),
        photos: [],
        project: b.project,
        openIssues: 0,
      }),
    ]),
  );
  return { ...b, completions };
}
const byKey = (r: ReturnType<typeof reviewProject>, k: string) => r.checks.find((c) => c.key === k)!;

describe('report check', () => {
  it('the sample project: dates, narrative, instruments pass; the units are not all complete (prelim: warn)', () => {
    const r = reviewProject(input());
    expect(byKey(r, 'narrative').status).toBe('pass');
    expect(byKey(r, 'dates').status).toBe('pass');
    expect(byKey(r, 'complete').status).toBe('warn');
    expect(r.checks.every((c) => ['pass', 'warn', 'accepted', 'fail', 'na'].includes(c.status))).toBe(true);
  });

  it('working math in a unit remark is flagged; the field notes are not looked at (they never print)', () => {
    const r = reviewProject(
      input((b) => {
        b.equipment[0].data.remarks = 'Belt replaced.\n516 = 1484';
        b.equipment[0].data.fieldNotes = '23x18 x2 = 2.875';
      }),
    );
    const s = byKey(r, 'scratch');
    expect(s.status).toBe('warn');
    expect(s.findings).toHaveLength(1);
    expect(s.findings[0].text).toMatch(/"516 = 1484"/);
    expect(s.findings[0].to).toMatch(/#sec-remarks$/);
    expect(byKey(reviewProject(input()), 'scratch').status).toBe('pass');
  });

  it('report date before the TAB date, empty narrative, expired certification on a final report', () => {
    const r = reviewProject(
      input((b) => {
        b.project.reportKind = 'final';
        b.project.info.reportDate = '2026-09-01';
        b.project.info.narrative = '';
        b.project.info.certExpiration = '2026-06-30';
      }),
    );
    expect(byKey(r, 'dates').findings[0].text).toMatch(/before the TAB date/);
    expect(byKey(r, 'narrative').status).toBe('warn');
    const cert = byKey(r, 'certification');
    expect(cert.status).toBe('fail');
    expect(cert.findings.map((f) => f.text).join(' ')).toMatch(/expired 2026-06-30/);
    expect(cert.findings.map((f) => f.text).join(' ')).toMatch(/signature line/);
    expect(byKey(r, 'complete').status).toBe('fail'); // final report
  });

  it('voltage outside ±10 % and imbalance over 2 %; implausible static pressure', () => {
    const r = reviewProject(
      input((b) => {
        const rtu = b.equipment.find((e) => e.type === 'rtu')!;
        Object.assign(rtu.data, { voltage: 460, volts1: 470, volts2: 455, volts3: 400, spEntering: 85 });
      }),
    );
    const v = byKey(r, 'voltage')
      .findings.map((f) => f.text)
      .join(' ');
    expect(v).toMatch(/400 V is outside ±10 %/);
    expect(v).toMatch(/voltage imbalance/);
    expect(byKey(r, 'values').findings[0].text).toMatch(/85\.00 in\. w\.g\. — check the value/);
  });

  it('duplicate designations and row numbers', () => {
    const r = reviewProject(
      input((b) => {
        const rtu = b.equipment.find((e) => e.type === 'rtu')!;
        b.equipment.push({ ...rtu, id: id(), slot: 9 });
        const row = b.rows.find((x) => x.equipmentId === rtu.id)!;
        b.rows.push({ ...row, id: id(), order: 99 } as AirflowRow);
      }),
    );
    const d = byKey(r, 'duplicates')
      .findings.map((f) => f.text)
      .join(' ');
    expect(d).toMatch(/Two RTUs/);
    expect(d).toMatch(/appears 2 times/);
  });

  it('out-of-tolerance readings need a remark or an issue', () => {
    const r = reviewProject(
      input((b) => {
        const rtu = b.equipment.find((e) => e.type === 'rtu')!;
        rtu.data.remarks = '';
        b.issues = b.issues.filter((i) => i.equipmentId !== rtu.id);
        const row = b.rows.find((x) => x.equipmentId === rtu.id && x.table === 'supply')!;
        row.data.finalVel = 5 * Number(row.data.finalVel ?? 500);
      }),
    );
    expect(byKey(r, 'explained').findings.some((f) => /no remark or issue/.test(f.text))).toBe(true);
  });

  it('hydronic: wide-open valve, memory stops, pump / system names, VFD setpoint', () => {
    const r = reviewProject(
      input((b) => {
        const pid = b.project.id;
        const mk = (type: Equipment['type'], designation: string, data: Equipment['data']): Equipment => ({
          id: id(),
          projectId: pid,
          type,
          designation,
          slot: 1,
          isExisting: false,
          data,
          naState: emptyNaState(),
          createdAt: 0,
          updatedAt: 0,
        });
        const sys = mk('valveSystem', 'CHW', {});
        b.equipment.push(
          sys,
          mk('pump', 'P-1', { system: 'CHW', pumpType: 'VFD' }),
          mk('pump', 'P-2', { system: 'HW' }),
        );
        b.rows.push({
          id: id(),
          projectId: pid,
          equipmentId: sys.id,
          table: 'valves',
          order: 1,
          data: { tag: 'CBV-1', designGpm: 10, finalGpm: 10 },
          na: {},
          createdAt: 0,
          updatedAt: 0,
        });
      }),
    );
    const h = byKey(r, 'hydronic')
      .findings.map((f) => f.text)
      .join(' | ');
    expect(h).toMatch(/CHW: no valve recorded wide open/);
    expect(h).toMatch(/CHW: memory stops/);
    expect(h).toMatch(/P-2: its system "HW" has no valve system page/);
    expect(h).toMatch(/VFD pump P-1, but no VFD/);
  });
});

describe('accepting a "Check" line', () => {
  it('holds while the findings are unchanged, shows Check again when they change; Must fix is never accepted', () => {
    const before = reviewProject(input());
    const complete = byKey(before, 'complete');
    expect(complete.status).toBe('warn');
    const accept = (fp: string) => (b: ReturnType<typeof sampleBundle>) => {
      b.project.info[acceptanceKey('complete')] = JSON.stringify({ name: 'Isaac', at: 1, fp });
    };
    const r = reviewProject(input(accept(findingsFingerprint(complete))));
    expect(byKey(r, 'complete')).toMatchObject({ status: 'accepted', accepted: { name: 'Isaac', at: 1 } });
    expect(r.accepted).toBe(1);
    expect(r.warn).toBe(before.warn - 1);
    // the findings changed since (another fingerprint): Check again
    expect(byKey(reviewProject(input(accept('0-0'))), 'complete').status).toBe('warn');
    // a final report makes it Must fix: not accepted
    const fin = reviewProject(
      input((b) => {
        accept(findingsFingerprint(complete))(b);
        b.project.reportKind = 'final';
      }),
    );
    expect(byKey(fin, 'complete').status).toBe('fail');
  });
});
