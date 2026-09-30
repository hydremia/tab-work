// @vitest-environment node
import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { emptyNaState, type Equipment, type LibraryPump } from '../data/types';
import { computeCompletion } from '../domain/completion';
import { seqKey } from '../domain/specs';
import { getSpec } from '../domain/specs';
import { sampleBundle } from '../test/fixtures';
import { renderGraphicsPdf, paginateFigures } from './graphics';
import { buildGraphicsModel } from './graphicsModel';

function bundle() {
  const b = sampleBundle();
  const pid = b.project.id;
  const mk = (type: Equipment['type'], designation: string, data: Equipment['data']): Equipment => ({
    id: `00000000-0000-4000-9000-${String(b.equipment.length + 1).padStart(12, '0')}`,
    projectId: pid,
    type,
    designation,
    slot: 30,
    isExisting: false,
    data,
    naState: emptyNaState(),
    createdAt: 0,
    updatedAt: 0,
  });
  const readings: Record<string, number> = {};
  [900, 950, 1010, 980, 1200, 1250, 1180, 1100, 700, 820, 860, 900].forEach(
    (v, i) => (readings[seqKey('readings', i + 1)] = v),
  );
  const roundReadings: Record<string, number> = {};
  [820, 900, 960, 1010, 1040, 1050, 1020, 980, 910, 780, 760, 880, 950, 1000, 1030, 1060, 1040, 990, 930, 850].forEach(
    (v, i) => (roundReadings[seqKey('readings', i + 1)] = v),
  );
  b.equipment.push(
    mk('traverse', 'T-20', { shape: 'Round', width: 20, designCfm: 2200, ...roundReadings }),
    mk('traverse', 'T-9', { shape: 'Rectangular', width: 24, height: 12, designCfm: 2000, ...readings }),
    mk('pump', 'P-1', {
      designGpm: 200,
      designHead: 60,
      actualGpm: 190,
      finalSuction: 9,
      finalDischarge: 35,
      shutoffSuction: 10,
      shutoffDischarge: 40,
      pumpCurveId: 'lib-p',
    }),
  );
  return b;
}
const completions = (b: ReturnType<typeof bundle>) =>
  new Map(
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

// test data (not a real pump)
const PUMP_LIB: LibraryPump[] = [
  {
    id: 'lib-p',
    make: 'Test',
    model: 'TP',
    size: '2x2x9',
    rpm: 1750,
    curves: [
      {
        impeller: 8,
        points: [
          { gpm: 0, head: 60 },
          { gpm: 150, head: 52 },
          { gpm: 250, head: 37 },
        ],
      },
      {
        impeller: 9,
        points: [
          { gpm: 0, head: 76 },
          { gpm: 150, head: 66 },
          { gpm: 250, head: 52 },
        ],
      },
    ],
    source: 'test data',
    notes: '',
    createdAt: 0,
    updatedAt: 0,
  },
];

describe('graphics appendix', () => {
  it('builds profile, traverse, outlet and pump figures from a project', () => {
    const b = bundle();
    const m = buildGraphicsModel({ ...b, completions: completions(b) });
    const kinds = new Set(m.figures.map((f) => f.kind));
    expect(kinds).toEqual(new Set(['profile', 'outlets', 'traverse', 'pump']));
    const t = m.figures.find((f) => f.kind === 'traverse' && f.unit === 'T-9');
    expect(t && t.kind === 'traverse' && t.readings.length).toBe(3); // 24" x 12": 4 across x 3 down
    expect(t && t.kind === 'traverse' && t.readings[0].length).toBe(4);
    const p = m.figures.find((f) => f.kind === 'pump');
    expect(p && p.kind === 'pump' && p.finalHead).toBeCloseTo(60.06, 2);
    expect(p && p.kind === 'pump' && p.curve).toBeNull();
  });

  it('a pump picked from the pump-curve library carries its curve at the estimated impeller', () => {
    const b = bundle();
    const m = buildGraphicsModel({ ...b, completions: completions(b), libraryPumps: PUMP_LIB });
    const p = m.figures.find((f) => f.kind === 'pump');
    if (p?.kind !== 'pump') throw new Error('no pump figure');
    // shut-off (40 − 10) × 2.31 = 69.3 ft: between the 8″ (60) and 9″ (76) curves
    expect(p.impeller).toBeCloseTo(8 + 9.3 / 16, 3);
    expect(p.curve?.[0].head).toBeCloseTo(69.3, 3);
    expect(p.curveName).toBe('Test TP 2x2x9');
  });

  it('the summary counts units, lines within tolerance, deficiencies and the building balance', () => {
    const b = bundle();
    const m = buildGraphicsModel({ ...b, completions: completions(b) });
    const sm = m.summary!;
    expect(sm.units).toBe(b.equipment.length);
    expect(sm.lines).toBeGreaterThan(0);
    expect(sm.within).toBeLessThanOrEqual(sm.lines);
    expect(sm.types.map((t) => t.units).reduce((a, x) => a + x, 0)).toBe(sm.units);
    expect(sm.openIssues.new + sm.openIssues.existing).toBe(b.issues.filter((i) => i.status === 'Open').length);
    expect(sm.traverses.count).toBe(m.figures.filter((f) => f.kind === 'traverse').length);
    expect(sm.balance.oaDesign).not.toBeNull();
    const round = m.figures.find((f) => f.kind === 'traverse' && f.unit === 'T-20');
    expect(round?.kind === 'traverse' && round.round && round.readings[0].length).toBe(10);
  });

  it('long tables split into page-sized figures', () => {
    const rows = Array.from({ length: 90 }, (_, i) => ({ label: `S-${i + 1}`, design: 100, actual: 100 }));
    const parts = paginateFigures([
      { kind: 'outlets', unit: 'RTU-1', table: 'Supply outlets', unitLabel: 'CFM', rows, tolerance: 0.1 },
    ]);
    expect(parts.map((f) => (f.kind === 'outlets' ? f.rows.length : 0))).toEqual([38, 38, 14]);
  });

  it('renders a PDF with a page per few figures', async () => {
    const b = bundle();
    const m = buildGraphicsModel({ ...b, completions: completions(b), libraryPumps: PUMP_LIB });
    const { bytes, pages } = await renderGraphicsPdf(m, {
      firm: 'a2b accurate air balancing, llc',
      label: 'Prelim',
      reportDate: '2026-09-29',
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(pages);
    expect(pages).toBeGreaterThanOrEqual(2);
    if (process.env.GRAPHICS_OUT) writeFileSync(process.env.GRAPHICS_OUT, bytes);
  });
});
