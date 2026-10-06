/**
 * Live calculations for MAUs, ERVs, hoods, traverses and the Building Balance. Each one mirrors the revision 07
 * workbook formula it is named after (the workbook stays authoritative: the export writes inputs only), including
 * its edge cases: text / N/A inputs are skipped, a total of 0 shows blank, an unknown filter type | size pair
 * gives 0 CFM, and Excel's ROUND (half away from zero) is used where the sheet rounds.
 * Constants come from @a2b/workbook (copies of {Dropdowns}, checked against the template by lists.test.ts).
 */
import { FILTER_CONSTANTS, MAU_FILTER_GRID_TYPE, PROFILE_CURVE, PSP_K } from '@a2b/workbook/map';
import type { FieldValue } from '../data/types';
import { num, ratio, rowCfm, type RowLike } from './calc';
import { plantCircuits, pumpTest } from './hydronicCalcs';
import { xlNum } from './staticProfile';
import { seqKey, type TotalCalc } from './specs/types';

type Values = Readonly<Record<string, FieldValue | undefined>>;
interface Row {
  table: string;
  order: number;
  data: Readonly<Record<string, FieldValue>>;
}

/** Excel ROUND: half away from zero, decimal-exact for values like 2.25 or 1.005. */
export function roundXL(x: number, digits = 0): number {
  const s = Math.abs(x);
  const r = Number(`${Math.round(Number(`${s}e${digits}`))}e-${digits}`);
  return x < 0 ? -r : r;
}

const sum = (xs: readonly (number | null)[]): number => xs.reduce<number>((t, x) => t + (x ?? 0), 0);
const avg = (xs: readonly (number | null)[]): number | null => {
  const n = xs.filter((x): x is number => x !== null);
  return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
};
/** Workbook totals show blank when the sum is 0. */
const blankZero = (x: number): number | null => (x === 0 ? null : x);
const rowsOf = (rows: readonly Row[], table: string) =>
  rows.filter((r) => r.table === table).sort((a, b) => a.order - b.order);

/** Readings 1..count of a sequence (null where blank or text / N/A). */
export function sequenceValues(values: Values, key: string, count: number): (number | null)[] {
  return Array.from({ length: count }, (_, i) => num(values[seqKey(key, i + 1)] ?? null));
}

// ------------------------------------------------------------------------------------------ outlet tables
/** Workbook outlet-table totals: design = sum of H, actual = sum of the Final CFM column L (VEL x Ak). */
export function outletSheetTotals(rows: readonly RowLike[]): { design: number | null; actual: number | null } {
  return {
    design: blankZero(sum(rows.map((r) => num(r.data.designCfm ?? null)))),
    actual: blankZero(sum(rows.map((r) => rowCfm(r, 'final')))),
  };
}

// ------------------------------------------------------------------------------------------ MAU: PSP
/** PSP K-factor by width ({Dropdowns} R:S): 0.88 up to 12", 0.95 from 14". null when the width is not listed. */
export function pspK(width: number | null): number | null {
  return PSP_K.find(([w]) => w === width)?.[1] ?? null;
}

export interface PspReadings {
  readings: number;
  average: number | null;
  /** avg VEL x (L - 2 - 2 x blanks) x W x K / 144 */
  cfm: number | null;
}

export interface PspResult extends PspReadings {
  k: number | null;
  /** MAUs!E(Q+8) / K(Q+8) (rev 07): the initial and final readings (`pspVelocitiesInitial`, `pspVelocities`). */
  initial: PspReadings;
  final: PspReadings;
  /** The readings the Method Total uses: the final ones, else the initial ones (top-level readings / average / cfm). */
  using: 'initial' | 'final';
  /** CFM / (L / 12) */
  cfmPerFt: number | null;
}

export function pspCfm(values: Values): PspResult {
  const L = num(values.pspLength ?? null);
  const W = num(values.pspWidth ?? null);
  const blanks = num(values.pspBlanks ?? null) ?? 0; // N(J): blank or text counts as 0
  const k = pspK(W);
  const of = (key: string): PspReadings => {
    const vels = sequenceValues(values, key, 20);
    const average = avg(vels);
    const cfm =
      L === null || W === null || average === null ? null : (average * (L - 2 - 2 * blanks) * W * (k ?? 0)) / 144;
    return { readings: vels.filter((v) => v !== null).length, average, cfm };
  };
  const initial = of('pspVelocitiesInitial');
  const final = of('pspVelocities');
  const using = final.cfm === null && initial.cfm !== null ? 'initial' : 'final';
  const use = using === 'final' ? final : initial;
  return { k, initial, final, using, ...use, cfmPerFt: use.cfm === null || !L ? null : use.cfm / (L / 12) };
}

// ------------------------------------------------------------------------------------------ filters
export function filterConstant(type: FieldValue | undefined, size: FieldValue | undefined) {
  return FILTER_CONSTANTS.find((c) => c.type === type && c.size === size);
}

/** CFM of one filter: velocity x free area x K ("type|size" lookup; an unknown pair gives 0 like the workbook). */
export function filterCfm(type: FieldValue | undefined, size: FieldValue | undefined, velocity: number | null) {
  // a blank size or a notation (N/A, Not Avail., Not Acc.) shows blank in the workbook
  if (
    velocity === null ||
    typeof size !== 'string' ||
    size.trim() === '' ||
    /^(N\/A|Not Avail\.|Not Acc\.|N\/L)$/.test(size)
  )
    return null;
  const c = filterConstant(type, size);
  return velocity * (c?.area ?? 0) * (c?.k ?? 0);
}

export interface FilterGridResult {
  /** CFM per filter of the readings the total uses */
  perFilter: (number | null)[];
  /** MAUs!E(Q+16) / K(Q+16) (rev 07): the final total, else the initial total (the Method Total) */
  total: number | null;
  initial: { perFilter: (number | null)[]; total: number | null };
  final: { perFilter: (number | null)[]; total: number | null };
}

/**
 * MAU filter grid (Supply Filter (VelGrid), K 1.35): CFM per filter from the initial (`initialVelocity`) and final
 * (`velocity`) velocity, and the grid totals.
 */
export function filterGridCfm(rows: readonly Row[]): FilterGridResult {
  const grid = rowsOf(rows, 'filterGrid');
  const of = (key: string) => {
    const perFilter = grid.map((r) => filterCfm(MAU_FILTER_GRID_TYPE, r.data.size, num(r.data[key] ?? null)));
    return { perFilter, total: blankZero(sum(perFilter)) };
  };
  const initial = of('initialVelocity');
  const final = of('velocity');
  const use = final.total === null && initial.total !== null ? initial : final;
  return { perFilter: use.perFilter, total: use.total, initial, final };
}

// ------------------------------------------------------------------------------------------ MAU: profile pressure
export type ProfileWarning = 'too low' | 'too high';
/**
 * Direct-fired burner profile pressure -> CFM (MAUs!K(Q+15)): the curve row at or below the pressure, plus linear
 * interpolation over the 0.05 step to the next row. Outside 0.15-0.65 in. w.g. the sheet shows a text warning.
 */
export function profileCfm(
  housing: FieldValue | undefined,
  pressure: FieldValue | undefined,
): { cfm: number | null; warning?: ProfileWarning } {
  const p = num(pressure ?? null);
  const h = num(housing ?? null);
  if (p === null || h === null) return { cfm: null };
  if (p < 0.15) return { cfm: null, warning: 'too low' };
  if (p > 0.65) return { cfm: null, warning: 'too high' };
  const col = PROFILE_CURVE.cfm[Math.trunc(h) - 1];
  if (!col) return { cfm: null };
  const ps = PROFILE_CURVE.pressures;
  let i = 0;
  while (i + 1 < ps.length && ps[i + 1] <= p + 1e-12) i++; // MATCH(p, U2:U12, 1)
  const next = Math.min(i + 1, ps.length - 1);
  return { cfm: col[i] + ((p - ps[i]) * (col[next] - col[i])) / 0.05 };
}

// ------------------------------------------------------------------------------------------ MAU totals
export interface MauTotals {
  method: string | null;
  /** MAUs!E(Q+31) */
  methodTotal: number | null;
  /** MAUs!K+5: design CFM override, else the outlet design total */
  design: number | null;
  /** MAUs!L+5: outlet final total for Outlets (or no method), else the method total */
  actual: number | null;
  ratio: number | null;
  psp: PspResult;
  filterGrid: ReturnType<typeof filterGridCfm>;
  profile: ReturnType<typeof profileCfm>;
  outlets: ReturnType<typeof outletSheetTotals>;
  /** Intake screens (MAUs Q+23..Q+27): the method total when Intake is chosen, else a check */
  intake: ReturnType<typeof outletSheetTotals> & { total: number | null };
}

export function mauTotals(values: Values, rows: readonly Row[]): MauTotals {
  const method = typeof values.method === 'string' && values.method ? values.method : null;
  const psp = pspCfm(values);
  const filterGrid = filterGridCfm(rows);
  const profile = profileCfm(values.profileHousing, values.profilePressure);
  const outlets = outletSheetTotals(rowsOf(rows, 'supply'));
  const intakeRows = rowsOf(rows, 'intake');
  const intake = outletSheetTotals(intakeRows);
  // screens read once (initial only) still give the total
  const intakeTotal = intake.actual ?? blankZero(sum(intakeRows.map((r) => rowCfm(r, 'initial'))));
  const methodTotal =
    method === 'Intake'
      ? intakeTotal
      : method === 'PSP'
        ? psp.cfm
        : method === 'Filter Grid'
          ? filterGrid.total
          : method === 'Profile Pressure'
            ? profile.cfm
            : null;
  const override = num(values.designCfmOverride ?? null);
  const design = override ?? outlets.design;
  const actual = method === null || method === 'Outlets' ? outlets.actual : methodTotal;
  return {
    method,
    methodTotal,
    design,
    actual,
    ratio: ratio(actual, design),
    psp,
    filterGrid,
    profile,
    outlets,
    intake: { ...intake, total: intakeTotal },
  };
}

// ------------------------------------------------------------------------------------------ ERV
export function ervTotals(rows: readonly Row[]) {
  return { supply: outletSheetTotals(rowsOf(rows, 'supply')), exhaust: outletSheetTotals(rowsOf(rows, 'exhaust')) };
}

// ------------------------------------------------------------------------------------------ hoods
export const isAirfoil = (filterType: FieldValue | undefined) =>
  typeof filterType === 'string' && /airfoil/i.test(filterType);

export interface HoodRowCalc {
  initialVel: number | null;
  initialCfm: number | null;
  finalVel: number | null;
  finalCfm: number | null;
}

/** One filter row: J/L = average of the P:R / S:U readings, K/M = VEL x free area x K. */
export function hoodRow(filterType: FieldValue | undefined, data: Readonly<Record<string, FieldValue>>): HoodRowCalc {
  const initialVel = avg([num(data.init1 ?? null), num(data.init2 ?? null), num(data.init3 ?? null)]);
  const finalVel = avg([num(data.final1 ?? null), num(data.final2 ?? null), num(data.final3 ?? null)]);
  return {
    initialVel,
    initialCfm: filterCfm(filterType, data.size, initialVel),
    finalVel,
    finalCfm: filterCfm(filterType, data.size, finalVel),
  };
}

export interface HoodTotals {
  rows: HoodRowCalc[];
  design: number | null;
  initial: number | null;
  final: number | null;
  /** Hoods!H+18: Final total / design, or Initial when there is no Final */
  ratio: number | null;
  initialPerFt: number | null;
  finalPerFt: number | null;
}

export function hoodTotals(values: Values, rows: readonly Row[]): HoodTotals {
  const calc = rowsOf(rows, 'filters').map((r) => hoodRow(values.filterType, r.data));
  const initial = blankZero(sum(calc.map((c) => c.initialCfm)));
  const final = blankZero(sum(calc.map((c) => c.finalCfm)));
  const design = num(values.designCfm ?? null) || null;
  const len = num(values.lengthFt ?? null) || null;
  return {
    rows: calc,
    design,
    initial,
    final,
    ratio: ratio(final ?? initial, design),
    initialPerFt: initial === null || len === null ? null : initial / len,
    finalPerFt: final === null || len === null ? null : final / len,
  };
}

// ------------------------------------------------------------------------------------------ traverses
export interface TraverseLayout {
  /** Traverses!F+2, e.g. 24" x 12", 10" dia or 30" x 12" oval */
  sizeText: string | null;
  /** Traverses!H+2 (ft², 3 decimals), inside the liner */
  ak: number | null;
  /** Points across (width / per axis), N+4 */
  nW: number | null;
  /** Points down (depth rows), or 2 axes for round; N+5 */
  nH: number | null;
  points: number | null;
  /** Traverses!M+4, e.g. "4 x 3", "8 x 2 axes" */
  layoutText: string | null;
  /** Insertion positions across (in), D+5 ... M+5 */
  positions: number[];
  /** Depths down (in) for rectangular ducts; empty for round */
  depths: number[];
  /**
   * Flat oval (NEBB 6.3.3h; Traverses!O+4..O+8): the flat part (W - H) x H is the rectangle above (positions across
   * it, from where it starts), the two ends one round of diameter H read on the horizontal axis, half the points at
   * each end; positions across that diameter (in, from the left end). Null for other shapes.
   */
  ends: { points: number; positions: number[]; rectAk: number; circleAk: number } | null;
}

const isFlatOval = (shape: FieldValue | undefined) => shape === 'Flat Oval';

/** Equal-area positions across a round duct of diameter d (in, from the wall), n points per diameter. */
function roundPositions(d: number, n: number): number[] {
  return Array.from({ length: n }, (_, k) => {
    const i = k + 1;
    const p =
      i <= n / 2
        ? (d / 2) * (1 - Math.sqrt((n - 2 * i + 1) / n))
        : d - (d / 2) * (1 - Math.sqrt((n - 2 * (n - i + 1) + 1) / n));
    return roundXL(p, 1);
  });
}

/** Round duct points per diameter (NEBB): up to 9" 6, up to 12" 8, else 10. */
const roundPoints = (d: number) => (d <= 9 ? 6 : d <= 12 ? 8 : 10);

/** NEBB equal-area traverse layout, replicating the Traverses sheet formulas (tools/build_rev03.py). */
export function traverseLayout(values: Values): TraverseLayout {
  const shape = values.shape;
  const W = num(values.width ?? null);
  const H = num(values.height ?? null);
  const liner = num(values.liner ?? null) ?? 0;
  const round = shape === 'Round';
  const empty: TraverseLayout = {
    sizeText: null,
    ak: null,
    nW: null,
    nH: null,
    points: null,
    layoutText: null,
    positions: [],
    depths: [],
    ends: null,
  };
  if (isFlatOval(shape)) {
    if (W === null || H === null) return empty;
    const Wi = W - 2 * liner;
    const Hi = H - 2 * liner;
    const flat = W - H;
    const nW = flat < 12 ? 2 : Math.min(10, Math.max(3, Math.ceil(flat / 6)));
    const nH = H < 12 ? 2 : Math.min(7, Math.max(3, Math.ceil(H / 6)));
    const endPoints = roundPoints(H);
    const rectAk = ((Wi - Hi) * Hi) / 144;
    const circleAk = (Math.PI * (Hi / 2) ** 2) / 144;
    return {
      sizeText: `${W}" x ${H}" oval`,
      ak: roundXL(((Wi - Hi) * Hi + Math.PI * (Hi / 2) ** 2) / 144, 3),
      nW,
      nH,
      points: nW * nH + endPoints,
      layoutText: `${nW}x${nH}+${endPoints} ends`,
      positions: Array.from({ length: nW }, (_, k) => roundXL(((k + 0.5) * flat) / nW, 1)),
      depths: Array.from({ length: nH }, (_, j) => roundXL(((j + 0.5) * H) / nH, 1)),
      ends: { points: endPoints, positions: roundPositions(H, endPoints), rectAk, circleAk },
    };
  }
  if (typeof shape !== 'string' || !shape || W === null) {
    return { ...empty, sizeText: W === null ? null : round ? `${W}" dia` : `${W}" x ${H ?? ''}"` };
  }
  const sizeText = round ? `${W}" dia` : `${W}" x ${H ?? ''}"`;
  const ak = round
    ? roundXL((Math.PI * ((W - 2 * liner) / 2) ** 2) / 144, 3)
    : H === null
      ? null
      : roundXL(((W - 2 * liner) * (H - 2 * liner)) / 144, 3);
  const nW = round ? roundPoints(W) : W < 12 ? 2 : Math.min(10, Math.max(3, Math.ceil(W / 6)));
  const nH = round ? 2 : H === null ? null : H < 12 ? 2 : Math.min(8, Math.max(3, Math.ceil(H / 6)));
  const positions = round
    ? roundPositions(W, nW)
    : Array.from({ length: nW }, (_, k) => roundXL(((k + 0.5) * W) / nW, 1));
  const depths =
    !round && nH !== null && H !== null ? Array.from({ length: nH }, (_, j) => roundXL(((j + 0.5) * H) / nH, 1)) : [];
  return {
    sizeText,
    ak,
    nW,
    nH,
    points: nH === null ? null : nW * nH,
    layoutText: nH === null ? null : round ? `${nW} x 2 axes` : `${nW} x ${nH}`,
    positions,
    depths,
    ends: null,
  };
}

export interface TraverseTotals extends TraverseLayout {
  /** Readings entered (numbers) and readings inside the point grid (the ones the sheet averages). */
  entered: number;
  used: number;
  /**
   * Traverses!L+2: ROUND(AVERAGE(grid), 0); a flat oval: ROUND((rectangle average x its area + ends average x circle
   * area) / (rectangle + circle area), 0), so VEL x Ak is the two parts' CFMs added
   */
  finalVel: number | null;
  /** Flat oval: the averages of the rectangle readings and of the end readings. */
  rectAverage?: number | null;
  endsAverage?: number | null;
  /** Traverses!M+2: ROUND(VEL x Ak, 0) */
  finalCfm: number | null;
  /** Traverses!K+2 */
  initialCfm: number | null;
  design: number | null;
  /** Final CFM (or Initial) / design */
  ratio: number | null;
}

export function traverseTotals(values: Values): TraverseTotals {
  const layout = traverseLayout(values);
  const all = sequenceValues(values, 'readings', 80);
  // the grid (10 across x 8 down) shows reading k = (row - 1) x nW + col, for k <= nW x nH (a flat oval: then the
  // end points, on the row below the rectangle)
  const inGrid = layout.points === null ? [] : all.slice(0, layout.points);
  let finalVel: number | null;
  let rectAverage: number | null | undefined;
  let endsAverage: number | null | undefined;
  if (layout.ends && layout.nW && layout.nH) {
    const nRect = layout.nW * layout.nH;
    rectAverage = avg(inGrid.slice(0, nRect));
    endsAverage = avg(inGrid.slice(nRect));
    const { rectAk, circleAk } = layout.ends;
    finalVel =
      rectAverage === null || endsAverage === null || rectAk + circleAk === 0
        ? null
        : roundXL((rectAverage * rectAk + endsAverage * circleAk) / (rectAk + circleAk), 0);
  } else {
    const average = avg(inGrid);
    finalVel = average === null ? null : roundXL(average, 0);
  }
  const cfmOf = (vel: number | null) => (vel === null || !layout.ak || vel === 0 ? null : roundXL(vel * layout.ak, 0)); // IF(N(v)*N(Ak)=0, "")
  const finalCfm = cfmOf(finalVel);
  const initialCfm = cfmOf(num(values.initialVel ?? null));
  const design = num(values.designCfm ?? null);
  return {
    ...layout,
    entered: all.filter((v) => v !== null).length,
    used: inGrid.filter((v) => v !== null).length,
    finalVel,
    ...(layout.ends ? { rectAverage, endsAverage } : {}),
    finalCfm,
    initialCfm,
    design,
    ratio: ratio(finalCfm ?? initialCfm, design),
  };
}

// ------------------------------------------------------------------------------------------ unit totals (tolerance)
export interface UnitTotal {
  design: number | null;
  actual: number | null;
  /** A unit with several checks (plant: one per water circuit) labels each. */
  label?: string;
}
/** Unit-level actual vs. design used for the tolerance check of types without per-outlet rows. */
export const TOTAL_CALCS: Record<TotalCalc, (values: Values, rows: readonly Row[]) => UnitTotal | UnitTotal[]> = {
  mau: (v, rows) => {
    const t = mauTotals(v, rows);
    // with Outlets the rows are checked one by one; the method total is checked for PSP / grid / profile
    return t.method && t.method !== 'Outlets' ? { design: t.design, actual: t.actual } : { design: null, actual: null };
  },
  hood: (v, rows) => {
    const t = hoodTotals(v, rows);
    return { design: t.design, actual: t.final ?? t.initial };
  },
  traverse: (v) => {
    const t = traverseTotals(v);
    return { design: t.design, actual: t.finalCfm ?? t.initialCfm };
  },
  pump: (v) => {
    const t = pumpTest(v);
    return { design: t.designGpm, actual: t.actualGpm };
  },
  plant: (v) => plantCircuits(v),
  flow: (v) => ({ design: xlNum(v.designGpm), actual: xlNum(v.measuredGpm) }),
};

// ------------------------------------------------------------------------------------------ Building Balance
export interface BalanceUnit {
  id: string;
  type: string;
  slot: number;
  data: Readonly<Record<string, FieldValue>>;
  designation?: string;
}
export interface BuildingBalance {
  oaDesign: number | null;
  oaActual: number | null;
  exhaustDesign: number | null;
  exhaustActual: number | null;
  /** H89: OA design - exhaust design */
  designBalance: number | null;
  /** H91: OA actual - exhaust actual */
  actualBalance: number | null;
}

/** One unit's share of the Building Balance (null: nothing on that side yet). */
export interface BalanceLine {
  id: string;
  type: string;
  designation: string;
  oaDesign: number | null;
  oaActual: number | null;
  exhaustDesign: number | null;
  exhaustActual: number | null;
}

// ------------------------------------------------------------------------------------------ hood ↔ exhaust fan
const tagKey = (d: string) => d.trim().toLowerCase().replace(/\s+/g, '');

/** The fans a hood names in "Associated exhaust fan": one or several ("EF-1", "EF-1 & EF-2", "EF-1, EF-2"). */
export function hoodFanTags(v: FieldValue | undefined): string[] {
  if (typeof v !== 'string') return [];
  return v
    .split(/\s*(?:,|&|\/|;|\band\b)\s*/i)
    .map((x) => x.trim())
    .filter(Boolean);
}

interface LinkUnit {
  id: string;
  type: string;
  designation?: string;
  data: Readonly<Record<string, FieldValue>>;
}

/** Fan id -> the hoods that name it (by designation, case and spaces ignored). */
export function hoodLinks<T extends LinkUnit>(units: readonly T[]): Map<string, T[]> {
  const fans = new Map<string, string>();
  for (const u of units)
    if ((u.type === 'fan' || u.type === 'smallFan') && u.designation) fans.set(tagKey(u.designation), u.id);
  const out = new Map<string, T[]>();
  for (const h of units) {
    if (h.type !== 'hood') continue;
    for (const tag of hoodFanTags(h.data.associatedFan)) {
      const fan = fans.get(tagKey(tag));
      if (fan) out.set(fan, [...(out.get(fan) ?? []), h]);
    }
  }
  return out;
}

/**
 * A fan whose airflow is measured at its hood(s): "Measured at" Hood, or left blank while a hood names the fan
 * ("Grilles" keeps the grille readings even when a hood names it).
 */
export function fanAtHood(fan: { data: Readonly<Record<string, FieldValue>> }, linked: boolean): boolean {
  const m = fan.data.measuredAt;
  return m === 'Hood' || ((m === null || m === undefined || m === '') && linked);
}

/**
 * A fan measured at its hood(s) whose own grille table still has readings: those readings are not the fan's airflow
 * (the hoods are), so the export leaves them out. The count of such rows, to warn about (0: nothing to say).
 */
export function fanHoodIgnoredReadings(rows: readonly Row[]): number {
  return rows.filter(
    (r) => r.table === 'outlets' && [r.data.initialVel, r.data.finalVel].some((v) => typeof v === 'number'),
  ).length;
}

/** The hoods' totals as one fan airflow: design, initial, final (sums of the hood totals). */
export function hoodsAirflow(
  hoods: readonly LinkUnit[],
  rows: readonly (Row & { equipmentId: string })[],
): { design: number | null; initial: number | null; final: number | null; actual: number | null } {
  let d = 0,
    i = 0,
    f = 0,
    anyI = false,
    anyF = false,
    anyD = false;
  for (const h of hoods) {
    const t = hoodTotals(
      h.data,
      rows.filter((r) => r.equipmentId === h.id),
    );
    if (t.design !== null) {
      d += t.design;
      anyD = true;
    }
    if (t.initial !== null) {
      i += t.initial;
      anyI = true;
    }
    if (t.final !== null) {
      f += t.final;
      anyF = true;
    }
  }
  const final = anyF ? f : null;
  const initial = anyI ? i : null;
  return { design: anyD ? d : null, initial, final, actual: final ?? initial };
}

/**
 * The units on the Building Balance (rows 7-66): RTU OA rows, MAU totals, ERV supply on the OA side; fans, ERV exhaust
 * and small fans 1-30 on the exhaust side. Design is the readings' design (as the sheet sums it).
 */
export function balanceLines(
  units: readonly BalanceUnit[],
  rows: readonly (Row & { equipmentId: string })[],
): BalanceLine[] {
  const out: BalanceLine[] = [];
  const links = hoodLinks(units);
  for (const u of units) {
    const ur = rows.filter((r) => r.equipmentId === u.id);
    const line: BalanceLine = {
      id: u.id,
      type: u.type,
      designation: u.designation ?? '',
      oaDesign: null,
      oaActual: null,
      exhaustDesign: null,
      exhaustActual: null,
    };
    if (u.type === 'rtu') {
      const oa = rowsOf(ur, 'oa')[0];
      if (!oa) continue;
      line.oaDesign = num(oa.data.designCfm ?? null);
      line.oaActual = rowCfm(oa, 'final');
    } else if (u.type === 'mau') {
      const t = mauTotals(u.data, ur);
      line.oaDesign = t.design;
      line.oaActual = t.actual;
    } else if (u.type === 'erv') {
      const t = ervTotals(ur);
      line.oaDesign = t.supply.design;
      line.oaActual = t.supply.actual;
      line.exhaustDesign = t.exhaust.design;
      line.exhaustActual = t.exhaust.actual;
    } else if (u.type === 'fan' || (u.type === 'smallFan' && u.slot <= 30)) {
      const hoods = links.get(u.id) ?? [];
      if (fanAtHood(u, hoods.length > 0)) {
        // measured at its hood(s): the hoods' totals are the fan's airflow
        const h = hoodsAirflow(hoods, rows);
        line.exhaustDesign = h.design;
        line.exhaustActual = h.actual;
      } else {
        const t = outletSheetTotals(rowsOf(ur, 'outlets'));
        line.exhaustDesign = t.design;
        line.exhaustActual = t.actual;
      }
    } else continue;
    out.push(line);
  }
  return out;
}

/**
 * Building Balance totals (rows 7-87, 89, 91) from the units the app manages (balanceLines), plus the sheet's 20 spare
 * manual OA rows (`spareOa`: their numeric sums, domain/spareOa.ts spareOaTotals). Units in `excluded` (designations:
 * isolated spaces the ventilation calculation leaves out, info.abExcluded) are not counted.
 */
export function buildingBalance(
  units: readonly BalanceUnit[],
  rows: readonly (Row & { equipmentId: string })[],
  spareOa: { design: number; actual: number } = { design: 0, actual: 0 },
  excluded: ReadonlySet<string> = new Set(),
): BuildingBalance {
  let oaD = spareOa.design,
    oaA = spareOa.actual,
    exD = 0,
    exA = 0;
  for (const l of balanceLines(units, rows)) {
    if (excluded.has(l.id)) continue;
    oaD += l.oaDesign ?? 0;
    oaA += l.oaActual ?? 0;
    exD += l.exhaustDesign ?? 0;
    exA += l.exhaustActual ?? 0;
  }
  const oaDesign = blankZero(oaD),
    oaActual = blankZero(oaA),
    exhaustDesign = blankZero(exD),
    exhaustActual = blankZero(exA);
  return {
    oaDesign,
    oaActual,
    exhaustDesign,
    exhaustActual,
    designBalance: oaDesign === null && exhaustDesign === null ? null : oaD - exD,
    actualBalance: oaActual === null && exhaustActual === null ? null : oaA - exA,
  };
}
