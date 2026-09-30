/**
 * Graphics appendix (ROADMAP §7.1): the figures the app can draw from a project's data, next to the workbook it does
 * not replace. Pure (no PDF, no database): reports/graphics.ts draws them.
 *
 *   profile   a unit's static pressure profile: inlet → components → fan, statics at each station, ΔP per
 *             component, TSP / ESP against the design ESP (the Static Pressure Profile of the unit sheets)
 *   traverse  a duct traverse cross-section: every point shaded by velocity, the average, points far from it, and
 *             the spread of the readings (coefficient of variation: how uniform the profile is)
 *   outlets   design vs. actual airflow of each outlet / inlet of a table, with the ± tolerance band
 *   valves    design vs. final GPM of a valve system's valves (same chart)
 *   pump      a pump's design point and operating point (flow vs head), with the shut-off head, and its curve
 *             (at the impeller the shut-off head gives) when the pump is picked from the pump-curve library
 */
import type { AirflowRow, Equipment, Issue, LibraryPump, Project, PumpCurvePoint } from '../data/types';
import { AIR_BALANCE_KEYS } from '../domain/airBalance';
import { PRESSURE_KEYS } from '../domain/projectCompletion';
import { spareOaTotals } from '../domain/spareOa';
import { rowCfm } from '../domain/calc';
import type { Completion } from '../domain/completion';
import { EQUIPMENT_TYPES, equipmentType } from '../domain/equipmentTypes';
import { buildingBalance, sequenceValues, traverseLayout, type BuildingBalance } from '../domain/equipmentCalcs';
import { pumpTest } from '../domain/hydronicCalcs';
import { pumpCurveResult, pumpName } from '../domain/pumpCurves';
import { staticInputs, staticProfile, xlNum, type StaticProfile } from '../domain/staticProfile';
import { getSpec } from '../domain/specs';
import { unitCells } from '../workbook/adapter';

export interface ProfileFigure {
  kind: 'profile';
  unit: string;
  typeLabel: string;
  profile: StaticProfile;
  designEsp: number | null;
}

export interface TraverseFigure {
  kind: 'traverse';
  unit: string;
  round: boolean;
  sizeText: string;
  /** readings[row][col]: rows = depths (rectangular) or the 2 axes (round), cols = positions across. */
  readings: (number | null)[][];
  positions: number[];
  depths: number[];
  average: number | null;
  /** standard deviation / average of the readings */
  cov: number | null;
  cfm: number | null;
  design: number | null;
}

export interface BarRow {
  label: string;
  design: number | null;
  actual: number | null;
}

export interface BarsFigure {
  kind: 'outlets' | 'valves';
  unit: string;
  table: string;
  unitLabel: 'CFM' | 'GPM';
  rows: BarRow[];
  tolerance: number;
}

export interface PumpFigure {
  kind: 'pump';
  unit: string;
  designGpm: number | null;
  designHead: number | null;
  actualGpm: number | null;
  finalHead: number | null;
  shutoffHead: number | null;
  /** the library curve at the estimated impeller (and the measured speed) */
  curve: PumpCurvePoint[] | null;
  curveName: string | null;
  impeller: number | null;
  curveNote: string | null;
}

export type Figure = ProfileFigure | TraverseFigure | BarsFigure | PumpFigure;

export interface SummaryTypeRow {
  label: string;
  units: number;
  complete: number;
  /** airflow / water lines with a design and a measured value, and those within the tolerance */
  lines: number;
  within: number;
}

/** The appendix's first page: where the project stands, in numbers. */
export interface Summary {
  units: number;
  complete: number;
  lines: number;
  within: number;
  tolerance: number;
  types: SummaryTypeRow[];
  openIssues: { new: number; existing: number };
  closedIssues: number;
  profiles: { count: number; espWithin: number; espWithDesign: number };
  traverses: { count: number; uneven: number };
  balance: BuildingBalance;
  /** the engineer's air balance table (Info → Design air balance) */
  airBalance: { oa: number | null; exhaust: number | null; net: number | null };
  pressures: { label: string; dp: number | string | null }[];
}

export interface GraphicsModel {
  projectName: string;
  figures: Figure[];
  summary?: Summary;
}

const TABLE_LABEL: Record<string, string> = {
  supply: 'Supply outlets',
  return: 'Return inlets',
  oa: 'Outside air',
  outlets: 'Outlets',
  exhaust: 'Exhaust inlets',
  valves: 'Balancing valves',
};

export function buildGraphicsModel(input: {
  project: Project;
  equipment: readonly Equipment[];
  rows: readonly AirflowRow[];
  completions: ReadonlyMap<string, Completion>;
  libraryPumps?: readonly LibraryPump[];
  issues?: readonly Pick<Issue, 'kind' | 'status'>[];
}): GraphicsModel {
  const { project, rows, completions } = input;
  const order = (e: Equipment) => EQUIPMENT_TYPES.findIndex((t) => t.key === e.type);
  const units = [...input.equipment].sort((a, b) => order(a) - order(b) || a.slot - b.slot);
  const figures: Figure[] = [];
  for (const e of units) {
    const spec = getSpec(e.type);
    const unitRows = rows.filter((r) => r.equipmentId === e.id).sort((a, b) => a.order - b.order);
    const c = completions.get(e.id);
    // static profile (units with the profile strip)
    if (c && spec.sections.some((s) => s.calc === 'staticProfile')) {
      const cells = unitCells(e, c);
      const profile = staticProfile(staticInputs(cells));
      if (profile.known && profile.strip.some((v) => xlNum(v) !== null))
        figures.push({
          kind: 'profile',
          unit: e.designation,
          typeLabel: equipmentType(e.type).label,
          profile,
          designEsp: xlNum(cells.unitEsp),
        });
    }
    // traverse cross-section
    if (e.type === 'traverse') {
      const layout = traverseLayout(e.data);
      if (layout.nW && layout.nH) {
        const all = sequenceValues(e.data, 'readings', 80).slice(0, layout.nW * layout.nH);
        if (all.some((v) => v !== null)) {
          const grid = Array.from({ length: layout.nH }, (_, r) =>
            Array.from({ length: layout.nW! }, (_, k) => all[r * layout.nW! + k] ?? null),
          );
          const nums = all.filter((v): v is number => v !== null);
          const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
          const sd =
            avg !== null && nums.length > 1
              ? Math.sqrt(nums.reduce((a, b) => a + (b - avg) ** 2, 0) / (nums.length - 1))
              : null;
          figures.push({
            kind: 'traverse',
            unit: e.designation,
            round: e.data.shape === 'Round',
            sizeText: layout.sizeText ?? '',
            readings: grid,
            positions: layout.positions,
            depths: layout.depths,
            average: avg,
            cov: avg && sd !== null ? sd / avg : null,
            cfm: avg !== null && layout.ak ? avg * layout.ak : null,
            design: xlNum(e.data.designCfm),
          });
        }
      }
    }
    // outlet / valve tables
    for (const t of spec.sections.flatMap((s) => s.tables ?? [])) {
      const tr = unitRows.filter((r) => r.table === t.key);
      const valve = t.calc === 'valve';
      if (!tr.length || !(valve || (t.calc ?? 'outlet') === 'outlet')) continue;
      const bars: BarRow[] = tr.map((r, i) => ({
        label: String(r.data.tag ?? r.data.no ?? '') || `${i + 1}`,
        design: xlNum(valve ? r.data.designGpm : r.data.designCfm),
        actual: valve
          ? (xlNum(r.data.finalGpm) ?? xlNum(r.data.initialGpm))
          : (rowCfm(r, 'final') ?? rowCfm(r, 'initial')),
      }));
      if (bars.some((b) => b.design !== null || b.actual !== null))
        figures.push({
          kind: valve ? 'valves' : 'outlets',
          unit: e.designation,
          table: TABLE_LABEL[t.key] ?? t.label,
          unitLabel: valve ? 'GPM' : 'CFM',
          rows: bars,
          tolerance: project.tolerance,
        });
    }
    // pump operating point
    if (e.type === 'pump') {
      const p = pumpTest(e.data);
      const lib = input.libraryPumps?.find((x) => x.id === e.data.pumpCurveId);
      const r = lib
        ? pumpCurveResult(lib, { shutoffHead: p.shutoffHead, finalHead: p.finalHead, rpm: xlNum(e.data.actualRpm) })
        : null;
      if (p.finalHead !== null || p.actualGpm !== null)
        figures.push({
          kind: 'pump',
          unit: e.designation,
          designGpm: p.designGpm,
          designHead: p.designHead,
          actualGpm: p.actualGpm,
          finalHead: p.finalHead,
          shutoffHead: p.shutoffHead,
          curve: r?.curve ?? null,
          curveName: lib ? pumpName(lib) : null,
          impeller: r?.impeller ?? null,
          curveNote: r?.note ?? null,
        });
    }
  }
  return { projectName: project.name, figures, summary: buildSummary(input, units, figures) };
}

function buildSummary(
  input: Parameters<typeof buildGraphicsModel>[0],
  units: readonly Equipment[],
  figures: readonly Figure[],
): Summary {
  const { project, completions } = input;
  const tol = project.tolerance;
  const inTol = (b: BarRow) =>
    b.design !== null && b.design > 0 && b.actual !== null && Math.abs(b.actual / b.design - 1) <= tol + 1e-9;
  const measured = (b: BarRow) => b.design !== null && b.design > 0 && b.actual !== null;
  const types: SummaryTypeRow[] = [];
  for (const t of EQUIPMENT_TYPES) {
    const us = units.filter((e) => e.type === t.key);
    if (!us.length) continue;
    const names = new Set(us.map((e) => e.designation));
    const bars = figures.flatMap((f) =>
      (f.kind === 'outlets' || f.kind === 'valves') && names.has(f.unit) ? f.rows : [],
    );
    types.push({
      label: t.plural,
      units: us.length,
      complete: us.filter((e) => ['green', 'blue'].includes(completions.get(e.id)?.color ?? '')).length,
      lines: bars.filter(measured).length,
      within: bars.filter(inTol).length,
    });
  }
  const profiles = figures.filter((f): f is ProfileFigure => f.kind === 'profile');
  const withDesign = profiles.filter((f) => f.designEsp && f.profile.esp !== null);
  const traverses = figures.filter((f): f is TraverseFigure => f.kind === 'traverse');
  const info = project.info;
  const numOrNull = (v: unknown) => (typeof v === 'number' ? v : null);
  const issues = input.issues ?? [];
  return {
    units: units.length,
    complete: types.reduce((n, t) => n + t.complete, 0),
    lines: types.reduce((n, t) => n + t.lines, 0),
    within: types.reduce((n, t) => n + t.within, 0),
    tolerance: tol,
    types,
    openIssues: {
      new: issues.filter((i) => i.status === 'Open' && i.kind === 'new').length,
      existing: issues.filter((i) => i.status === 'Open' && i.kind !== 'new').length,
    },
    closedIssues: issues.filter((i) => i.status !== 'Open').length,
    profiles: {
      count: profiles.length,
      espWithDesign: withDesign.length,
      espWithin: withDesign.filter((f) => Math.abs(f.profile.esp! / f.designEsp! - 1) <= 0.1).length,
    },
    traverses: { count: traverses.length, uneven: traverses.filter((t) => t.cov !== null && t.cov > 0.2).length },
    balance: buildingBalance(
      units.map((e) => ({ id: e.id, type: e.type, slot: e.slot, data: e.data })),
      input.rows,
      spareOaTotals(project),
    ),
    airBalance: {
      oa: numOrNull(info[AIR_BALANCE_KEYS.oa]),
      exhaust: numOrNull(info[AIR_BALANCE_KEYS.exhaust]),
      net: numOrNull(info[AIR_BALANCE_KEYS.net]),
    },
    pressures: [
      { label: 'Building vs outdoors', dp: (info[PRESSURE_KEYS.buildingDp] as number | string | null) ?? null },
      { label: 'Kitchen vs dining', dp: (info[PRESSURE_KEYS.kitchenDp] as number | string | null) ?? null },
    ].filter((p) => p.dp !== null && p.dp !== ''),
  };
}
