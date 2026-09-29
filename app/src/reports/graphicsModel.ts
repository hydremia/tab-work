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
 *   pump      a pump's design point and operating point (flow vs head), with the shut-off head; the curve itself
 *             comes with the pump-curve library
 */
import type { AirflowRow, Equipment, Project } from '../data/types';
import { rowCfm } from '../domain/calc';
import type { Completion } from '../domain/completion';
import { EQUIPMENT_TYPES, equipmentType } from '../domain/equipmentTypes';
import { sequenceValues, traverseLayout } from '../domain/equipmentCalcs';
import { pumpTest } from '../domain/hydronicCalcs';
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
}

export type Figure = ProfileFigure | TraverseFigure | BarsFigure | PumpFigure;

export interface GraphicsModel {
  projectName: string;
  figures: Figure[];
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
      if (p.finalHead !== null || p.actualGpm !== null)
        figures.push({
          kind: 'pump',
          unit: e.designation,
          designGpm: p.designGpm,
          designHead: p.designHead,
          actualGpm: p.actualGpm,
          finalHead: p.finalHead,
          shutoffHead: p.shutoffHead,
        });
    }
  }
  return { projectName: project.name, figures };
}
