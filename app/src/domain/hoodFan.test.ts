/** Kitchen hoods and their exhaust fan: the fan's airflow is measured at the hood(s) that name it. */
import { describe, expect, it } from 'vitest';
import { sampleBundle } from '../test/fixtures';
import { fromProjectData, toProjectData } from '../workbook/adapter';
import { TEMPLATE_MAP_06 } from '@a2b/workbook/map';
import { computeCompletion } from './completion';
import { balanceLines, fanAtHood, hoodFanTags, hoodLinks, hoodsAirflow, hoodTotals } from './equipmentCalcs';
import { getSpec } from './specs';

/** The sample project with EF-1 renamed KEF-1: the fan both sample hoods name. */
function linked() {
  const b = sampleBundle();
  const fan = b.equipment.find((e) => e.designation === 'EF-1')!;
  fan.designation = 'KEF-1';
  return { b, fan };
}

describe('hood ↔ exhaust fan', () => {
  it('a hood names one fan or several', () => {
    expect(hoodFanTags('KEF-1')).toEqual(['KEF-1']);
    expect(hoodFanTags('EF-1 & EF-2')).toEqual(['EF-1', 'EF-2']);
    expect(hoodFanTags('EF-1, EF-2 / EF-3')).toEqual(['EF-1', 'EF-2', 'EF-3']);
    expect(hoodFanTags(null)).toEqual([]);
  });

  it('links by designation (case and spaces ignored); both hoods on one fan', () => {
    const { b, fan } = linked();
    const links = hoodLinks(b.equipment);
    expect(links.get(fan.id)?.map((h) => h.designation)).toEqual(['H-1', 'H-2']);
    fan.designation = 'KEF-2';
    expect(hoodLinks(b.equipment).has(fan.id)).toBe(false); // a different tag
    fan.designation = ' kef-1 ';
    expect(hoodLinks(b.equipment).has(fan.id)).toBe(true);
  });

  it('measured at the hood: the grilles and the instrument are automatically N/A; "Grilles" keeps them', () => {
    const { b, fan } = linked();
    const input = {
      spec: getSpec('fan'),
      unit: fan,
      rows: [],
      photos: [],
      project: b.project,
      openIssues: 0,
    };
    const at = computeCompletion({ ...input, hoodLinked: true });
    expect(at.tables.outlets).toMatchObject({ state: 'auto-na', reason: 'measured at the hood' });
    expect(at.fields.instrument.state).toBe('auto-na');
    const notLinked = computeCompletion({ ...input, hoodLinked: false });
    expect(notLinked.missing.map((m) => m.key)).toContain('outlets');
    const grilles = computeCompletion({
      ...input,
      unit: { ...fan, data: { ...fan.data, measuredAt: 'Grilles' } },
      hoodLinked: true,
    });
    expect(grilles.missing.map((m) => m.key)).toContain('outlets');
    expect(at.missing.map((m) => m.key)).not.toContain('outlets');
    expect(fanAtHood({ data: { measuredAt: 'Hood' } }, false)).toBe(true);
  });

  it("the hoods' totals are the fan's airflow on the Building Balance", () => {
    const { b, fan } = linked();
    const hoods = b.equipment.filter((e) => e.type === 'hood');
    const a = hoodsAirflow(hoods, b.rows);
    const sum = (k: 'final' | 'initial' | 'design') =>
      hoods.reduce(
        (s, h) =>
          s +
          (hoodTotals(
            h.data,
            b.rows.filter((r) => r.equipmentId === h.id),
          )[k] ?? 0),
        0,
      );
    expect(a.final).toBeCloseTo(sum('final'), 6);
    expect(a.design).toBe(sum('design'));
    const line = balanceLines(b.equipment, b.rows).find((l) => l.id === fan.id)!;
    expect(line.exhaustActual).toBeCloseTo(a.actual!, 6);
    expect(line.exhaustDesign).toBe(a.design);
  });

  it('export (rev 07): the "measured at hood" line with the hoods and their CFMs, no grille rows', () => {
    const { b, fan } = linked();
    const u = toProjectData(b).data.equipment.fan.find((x) => x.slot === fan.slot)!;
    const hoods = b.equipment.filter((e) => e.type === 'hood');
    const air = hoodsAirflow(hoods, b.rows);
    expect(u.fields).toMatchObject({
      hoodLine: 'Measured at hood H-1, H-2',
      hoodDesignCfm: Math.round(air.design!),
      hoodFinalCfm: Math.round(air.final!),
    });
    expect(u.tables?.outlets).toBeUndefined();
    const back = fromProjectData(toProjectData(b).data).equipment.find((e) => e.type === 'fan' && e.slot === fan.slot)!;
    expect(back.data.measuredAt).toBe('Hood');
    expect(back.data).not.toHaveProperty('hoodLine');
  });

  it('export onto a rev 05 / 06 workbook: one grille row per hood, Ak 1 with the hood CFM as VEL, and an Ak note', () => {
    const { b, fan } = linked();
    const { data } = toProjectData(b, 'air', TEMPLATE_MAP_06);
    const u = data.equipment.fan.find((x) => x.slot === fan.slot)!;
    const hoods = b.equipment.filter((e) => e.type === 'hood');
    const t1 = hoodTotals(
      hoods[0].data,
      b.rows.filter((r) => r.equipmentId === hoods[0].id),
    );
    expect(u.tables?.outlets).toHaveLength(2);
    expect(u.tables?.outlets?.[0]).toMatchObject({
      no: 'H-1',
      type: 'Hood',
      ak: 1,
      finalVel: Math.round(t1.final!),
      designCfm: Math.round(t1.design!),
    });
    expect(String(u.fields?.akNotes)).toMatch(/^Measured at hood H-1, H-2/);
  });

  it('re-import of a rev 05 / 06 workbook: the hood lines come back as "measured at hood", not as grilles', () => {
    const { b, fan } = linked();
    const back = fromProjectData(toProjectData(b, 'air', TEMPLATE_MAP_06).data);
    const f = back.equipment.find((e) => e.type === 'fan' && e.slot === fan.slot)!;
    expect(f.data.measuredAt).toBe('Hood');
    expect(f.data.akNotes).toBeUndefined();
    expect(back.rows.filter((r) => r.equipmentId === f.id && r.table === 'outlets')).toEqual([]);
  });
});
