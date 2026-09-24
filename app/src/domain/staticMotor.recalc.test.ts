// @vitest-environment node
/**
 * Generated cross-check against the real workbook: varied RTUs, MAUs, ERVs and fans (1- / 3-phase, blank and N/A
 * legs, every unit type, negative statics, notations in the static chain, values typed into absent components)
 * are exported with the app's exporter onto the revision 05 template, recalculated with LibreOffice, and every
 * static-profile and motor cell the workbook computes must equal the app's live calculation (numbers to 1e-6).
 * Skipped where LibreOffice (`soffice`) is not installed, e.g. in CI.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { anchorRow, exportWorkbookWithReport, TEMPLATE_FILE_NAME, TEMPLATE_LISTS, TEMPLATE_MAP } from '@a2b/workbook';
import { describe, expect, it } from 'vitest';
import { emptyNaState, type Equipment, type FieldValue, type Notation } from '../data/types';
import { sampleBundle } from '../test/fixtures';
import { hasSoffice, recalc, type SheetValue } from '../test/recalc';
import { toProjectData, unitCells, type ProjectBundle } from '../workbook/adapter';
import { computeCompletion } from './completion';
import { motorCalc, motorInputs } from './motorCalcs';
import { getSpec } from './specs';
import { staticInputs, staticProfile, type XCell } from './staticProfile';

const template = () =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../${TEMPLATE_FILE_NAME}`, import.meta.url))));

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Kind = 'rtu' | 'mau' | 'erv' | 'fan';
const SHEET: Record<Kind, string> = { rtu: 'RTUs', mau: 'MAUs', erv: 'ERVs', fan: 'Fans' };
/** Row of "Unit ESP actual" (L) from the anchor; ERVs have none. */
const ESP_ROW: Record<Kind, number | null> = { rtu: 8, mau: 6, erv: null, fan: 6 };
const NOTATIONS: Notation[] = ['N/A', 'Not Avail.', 'Not Acc.'];

function makeUnits(): Equipment[] {
  const r = rng(20260924);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const out: Equipment[] = [];
  const counts: Record<Kind, number> = { rtu: 16, mau: 10, erv: 10, fan: 16 };
  const sheetType: Record<Kind, string> = { rtu: 'RTU', mau: 'MAU', erv: 'ERV', fan: 'EF' };
  let n = 0;
  for (const kind of ['rtu', 'mau', 'erv', 'fan'] as Kind[]) {
    for (let slot = 1; slot <= counts[kind]; slot++) {
      const data: Record<string, FieldValue> = {};
      const na = emptyNaState();
      const mark = (k: string) => (na.fields[k] = { notation: pick(NOTATIONS) });
      /** value | blank | notation, with the given odds */
      const put = (k: string, v: number, pBlank = 0.12, pMark = 0.12) => {
        const x = r();
        if (x < pBlank) return;
        if (x < pBlank + pMark) mark(k);
        else data[k] = v;
      };
      // unit type: mostly the sheet's own, every type somewhere
      data.unitType =
        slot <= 5
          ? TEMPLATE_LISTS['Unit.Type'][(slot + n) % 5]
          : r() < 0.7
            ? sheetType[kind]
            : pick(TEMPLATE_LISTS['Unit.Type']);
      if (slot === 6) delete data.unitType; // template preset stays
      data.hasFilters = r() < 0.8 ? 'Yes' : 'No';
      // schedule
      const phase = r();
      if (phase < 0.4) data.phase = '1-phase';
      else if (phase < 0.85) data.phase = '3-phase';
      else if (phase < 0.93) mark('phase'); // blank / N/A phase: the 3-phase formula
      put('voltage', pick([115, 208, 230, 460, 480]), 0.08, 0.08);
      put('hp', pick([0.5, 1, 1.5, 2, 3, 5]), 0.05, 0.05);
      put('unitEsp', round2(0.3 + r()), 0.1, 0.1);
      // motor
      const vBase = typeof data.voltage === 'number' ? data.voltage : 208;
      put('fla', round2(1 + r() * 20), 0.1, 0.12);
      for (const leg of [1, 2, 3]) put(`volts${leg}`, round2(vBase * (0.95 + r() * 0.1)), 0.15, 0.15);
      for (const leg of [1, 2, 3]) put(`amps${leg}`, round2(0.5 + r() * 15), 0.15, 0.15);
      data.serviceFactor = pick(TEMPLATE_LISTS['Service.Factors2']);
      // static profile: negative suction side, positive discharge; notations; values in absent components
      let s = round2(-0.05 - r() * 0.5);
      put('spEntering', s, 0.08, 0.08);
      for (const k of [1, 2, 3, 4]) {
        s = round2(s - r() * 0.4);
        put(`spLeaving${k}`, s, 0.3, 0.1);
      }
      put('spLeaving5', round2(r() * 1.5 - 0.2), 0.08, 0.08);
      const designation = `${sheetType[kind]}-G${slot}`;
      n++;
      out.push({
        id: `gen-${kind}-${slot}`,
        projectId: 'p',
        type: kind,
        designation,
        slot,
        isExisting: false,
        data,
        naState: na,
        createdAt: 0,
        updatedAt: 0,
      });
    }
  }
  return out;
}

const COLS = ['C', 'D', 'E', 'F', 'G'];
const STRIP_COLS = ['C', 'E', 'G', 'I', 'K', 'M'];
const DP_COLS = ['D', 'F', 'H', 'J', 'L'];

describe.skipIf(!hasSoffice())(
  'static profile + motor calcs = LibreOffice-recalculated export (generated units)',
  () => {
    it('matches every computed cell', { timeout: 600_000 }, async () => {
      const base = sampleBundle();
      const equipment = makeUnits();
      const bundle: ProjectBundle = { project: base.project, equipment, rows: [], issues: [], instruments: [] };
      const { data } = toProjectData(bundle);
      const { bytes } = await exportWorkbookWithReport(template(), data);
      const read = await recalc(bytes);

      let compared = 0;
      let maxDev = 0;
      const mismatches: string[] = [];
      const cmp = (label: string, got: SheetValue, want: XCell) => {
        compared++;
        const blank = (v: unknown) => v === null || v === undefined || v === '';
        let ok: boolean;
        if (blank(want)) ok = blank(got);
        else if (typeof want === 'number') {
          ok = typeof got === 'number' && Math.abs(got - want) <= 1e-6;
          if (typeof got === 'number') maxDev = Math.max(maxDev, Math.abs(got - want));
        } else ok = got === want;
        if (!ok) mismatches.push(`${label}: workbook ${JSON.stringify(got)}, app ${JSON.stringify(want)}`);
      };

      let oneWithTsp = 0;
      for (const e of equipment) {
        const kind = e.type as Kind;
        const sheet = SHEET[kind];
        const P = anchorRow(TEMPLATE_MAP.equipment.find((x) => x.key === kind)!.block.anchor, e.slot);
        const c = computeCompletion({
          spec: getSpec(kind),
          unit: e,
          rows: [],
          photos: [],
          project: base.project,
          openIssues: 0,
        });
        const cells = unitCells(e, c);
        const sp = staticProfile(staticInputs(cells));
        const mc = motorCalc(motorInputs(cells));
        const at = (col: string, off: number) => `${col}${P + off}`;
        const id = `${sheet} ${e.designation}`;
        for (let k = 0; k < 5; k++) {
          cmp(`${id} label ${k + 1}`, await read(sheet, at(COLS[k], 19)), sp.labels[k]);
          cmp(`${id} entering ${k + 1}`, await read(sheet, at(COLS[k], 20)), sp.entering[k]);
          cmp(`${id} ΔP ${k + 1}`, await read(sheet, at(DP_COLS[k], 24)), sp.dpText[k]);
        }
        for (let k = 0; k < 6; k++) cmp(`${id} strip ${k}`, await read(sheet, at(STRIP_COLS[k], 24)), sp.strip[k]);
        cmp(`${id} inlet label`, await read(sheet, at('B', 23)), sp.inlet);
        cmp(`${id} TSP`, await read(sheet, at('E', 25)), sp.tsp);
        cmp(`${id} ESP`, await read(sheet, at('I', 25)), sp.esp);
        cmp(`${id} unit ΔP`, await read(sheet, at('M', 25)), sp.unitDp);
        const espRow = ESP_ROW[kind];
        if (espRow !== null) cmp(`${id} unit ESP actual`, await read(sheet, at('L', espRow)), sp.esp);
        cmp(`${id} corrected FLA`, await read(sheet, at('D', 14)), mc.correctedFla);
        cmp(`${id} BHP`, await read(sheet, at('G', 14)), mc.bhp);
        if (sp.tsp !== null) oneWithTsp++;
      }
      console.log(
        `static/motor recalc cross-check: ${equipment.length} units, ${compared} cells, max deviation ${maxDev.toExponential(2)}, ${oneWithTsp} units with a TSP`,
      );
      expect(mismatches).toEqual([]);
      expect(compared).toBeGreaterThan(1000);
      expect(oneWithTsp).toBeGreaterThan(10); // the generator reaches the interesting cases
    });
  },
);
