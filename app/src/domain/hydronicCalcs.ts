/**
 * Hydronic calculations, replicating the H01 workbook formulas (tools/build_hydronic.py) so the app shows what the
 * report will print:
 *
 *   Pumps  M(row) head ft = IF(OR(K="",L=""),"", IF(OR(ISTEXT(K),ISTEXT(L)),"",
 *                             (L-K)*2.31/IF(AND(ISNUMBER(SG),SG>0),SG,1) + IF(ISNUMBER(dz),dz,0)))
 *          (K = suction psi, L = discharge psi, SG = specific gravity, dz = gauge elevation difference in ft)
 *          actual head = the Final row's head; % = actual / design
 *   Valves M = IF(design blank or 0, "", IF(final="", initial/design, final/design))   (text reads as blank)
 *   Plant / flow readings: actual / design per circuit
 */
import type { FieldValue } from '../data/types';
import { xlBlank, xlNum, xlText, type XCell } from './staticProfile';

type Values = Readonly<Record<string, FieldValue | undefined>>;

/** psi of water column per ft: 1 psi = 2.31 ft w.g. (water, SG 1). */
export const FT_PER_PSI = 2.31;

export function pumpHead(suction: XCell, discharge: XCell, sg: XCell, elevation: XCell): number | null {
  if (xlBlank(suction) || xlBlank(discharge) || xlText(suction) || xlText(discharge)) return null;
  const s = xlNum(sg);
  const g = s !== null && s > 0 ? s : 1;
  return ((xlNum(discharge)! - xlNum(suction)!) * FT_PER_PSI) / g + (xlNum(elevation) ?? 0);
}

export interface PumpTest {
  shutoffHead: number | null;
  wideOpenHead: number | null;
  finalHead: number | null;
  designHead: number | null;
  designGpm: number | null;
  actualGpm: number | null;
  /** actual head / design head */
  headRatio: number | null;
  /** actual flow / design flow */
  flowRatio: number | null;
  /** Final head more than 5 % above design: the flow will be below design (NEBB 9.5.1 m). */
  headAboveDesign: boolean;
}

const ratio = (a: number | null, d: number | null) => (a === null || d === null || d === 0 ? null : a / d);

export function pumpTest(v: Values): PumpTest {
  const head = (k: 'shutoff' | 'wideOpen' | 'final') =>
    pumpHead(v[`${k}Suction`], v[`${k}Discharge`], v.specificGravity, v.gaugeElevation);
  const finalHead = head('final');
  const designHead = xlNum(v.designHead);
  const designGpm = xlNum(v.designGpm);
  const actualGpm = xlNum(v.actualGpm);
  return {
    shutoffHead: head('shutoff'),
    wideOpenHead: head('wideOpen'),
    finalHead,
    designHead,
    designGpm,
    actualGpm,
    headRatio: ratio(finalHead, designHead),
    flowRatio: ratio(actualGpm, designGpm),
    headAboveDesign: finalHead !== null && designHead !== null && finalHead > designHead * 1.05,
  };
}

/** A valve row's actual / design (final, else initial), as the Valves sheet's % column. */
export function valveRatio(data: Values): number | null {
  const design = xlNum(data.designGpm);
  if (design === null || design === 0) return null;
  const fin = data.finalGpm;
  if (xlBlank(fin)) {
    const ini = xlNum(data.initialGpm);
    return ini === null ? null : ini / design;
  }
  const f = xlNum(fin);
  return f === null ? null : f / design;
}

export interface FlowTotals {
  design: number | null;
  initial: number | null;
  final: number | null;
  ratio: number | null;
}

/** Sums of a valve table (the Valves sheet's Total row: SUM skips text). */
export function valveTotals(rows: readonly { data: Values }[]): FlowTotals {
  const sum = (k: string) => {
    const xs = rows.map((r) => xlNum(r.data[k])).filter((x): x is number => x !== null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
  };
  const design = sum('designGpm');
  const initial = sum('initialGpm');
  const final = sum('finalGpm');
  return { design, initial, final, ratio: ratio(final ?? initial, design) };
}

/** Plant unit: one check per water circuit that has a design flow. */
export function plantCircuits(v: Values): { label: string; design: number | null; actual: number | null }[] {
  return ([1, 2] as const)
    .map((n) => ({
      label:
        typeof v[`circuit${n}`] === 'string' && v[`circuit${n}`] ? `${v[`circuit${n}`]} flow` : `Circuit ${n} flow`,
      design: xlNum(v[`designGpm${n}`]),
      actual: xlNum(v[`actualGpm${n}`]),
    }))
    .filter((c) => c.design !== null);
}
