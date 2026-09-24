/** Live-calculation panels at the end of a section (they mirror the workbook formulas, domain/equipmentCalcs.ts). */
import type { AirflowRow, Equipment } from '../../data/types';
import { formatNumber, formatPercent } from '../../domain/calc';
import type { Completion } from '../../domain/completion';
import { ervTotals, filterGridCfm, hoodTotals, mauTotals, traverseTotals } from '../../domain/equipmentCalcs';
import { motorCalc, motorInputs, motorWarnings } from '../../domain/motorCalcs';
import type { CalcPanel as PanelKey } from '../../domain/specs';
import {
  espDiscrepancy,
  staticInputs,
  staticProfile,
  type StaticProfile,
  type XCell,
} from '../../domain/staticProfile';
import { unitCells } from '../../workbook/adapter';
import { Pct } from './AirflowTable';

/** [label, value, workbook cell it prints in (marks the value "report")?, test id?] */
type KvItem = [string, string, string?, string?];

function Kv({ items }: { items: KvItem[] }) {
  return (
    <dl className="calc-kv">
      {items.map(([k, v, cell, testId]) => (
        <div key={k} data-report={cell ? 'true' : undefined}>
          <dt>
            {k}
            {cell && (
              <span className="report-tag" title={`Printed in the report (${cell}), same formula as the workbook`}>
                report
              </span>
            )}
          </dt>
          <dd data-testid={testId}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const ReportNote = ({ children }: { children?: React.ReactNode }) => (
  <p className="small muted calc-note">
    <span className="report-tag">report</span> = the value the workbook prints (same formula and N/A rules).
    {children}
  </p>
);

const wg = (x: number | null, digits = 2) => (x === null ? '—' : `${formatNumber(x, digits)} in. w.g.`);
const showStatic = (v: XCell) =>
  v === null || v === undefined || v === '' ? '' : typeof v === 'number' ? formatNumber(v, 2) : String(v);

/** The workbook's schematic strip: inlet static → component (ΔP) → leaving static → … → fan → discharge. */
function StaticStrip({ p }: { p: StaticProfile }) {
  const stat = (v: XCell, i: number) => (
    <span className="sp-static" data-testid={`sp-static-${i}`}>
      {showStatic(v) || '·'}
    </span>
  );
  return (
    <ol className="sp-strip" aria-label="Static pressure profile, airflow left to right">
      <li className="sp-step">
        <span className="sp-node sp-inlet">{p.inlet || 'Inlet'}</span>
        <span className="sp-arrow" aria-hidden="true">
          →
        </span>
        {stat(p.strip[0], 0)}
      </li>
      {p.labels.map((label, k) => (
        <li key={k} className="sp-step" data-absent={p.absent[k] || undefined}>
          <span className="sp-arrow" aria-hidden="true">
            →
          </span>
          <span className="sp-node">
            <b>{label || `Component ${k + 1}`}</b>
            <span className="sp-dp" data-testid={`sp-dp-${k + 1}`}>
              {p.absent[k] ? 'absent' : (p.dpText[k] ?? 'Δ —')}
            </span>
          </span>
          {!p.absent[k] && (
            <>
              <span className="sp-arrow" aria-hidden="true">
                →
              </span>
              {stat(p.strip[k + 1], k + 1)}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

function unitLive(equipment: Equipment, completion: Completion) {
  const cells = unitCells(equipment, completion);
  return { cells, sp: staticProfile(staticInputs(cells)) };
}

/** ESP discrepancy for the unit summary (R8-style callout); null when fine or not applicable (ERVs). */
export function unitEspCheck(equipment: Equipment, completion: Completion, tolerance: number) {
  if (!completion.fields.unitEsp) return null;
  const { cells, sp } = unitLive(equipment, completion);
  return espDiscrepancy(cells.unitEsp, sp.esp, tolerance);
}

export const espText = (d: { design: number; actual: number; ratio: number }) =>
  `Unit ESP: design ${formatNumber(d.design, 2)} vs. actual ${formatNumber(d.actual, 2)} in. w.g. (${formatPercent(d.ratio)}).`;

const cfm = (x: number | null) => (x === null ? '—' : `${formatNumber(x)} CFM`);

export function CalcPanel({
  panel,
  equipment,
  rows,
  tolerance,
  completion,
}: {
  panel: PanelKey;
  equipment: Equipment;
  rows: AirflowRow[];
  tolerance: number;
  /** Needed by the static / motor / unit ESP panels (they calculate on the values the export writes). */
  completion?: Completion;
}) {
  const d = equipment.data;
  let body: React.ReactNode = null;
  if ((panel === 'staticProfile' || panel === 'motor' || panel === 'unitEsp') && !completion) return null;
  if (panel === 'staticProfile') {
    const { cells, sp } = unitLive(equipment, completion!);
    const esp = completion!.fields.unitEsp ? espDiscrepancy(cells.unitEsp, sp.esp, tolerance) : null;
    body = (
      <>
        <StaticStrip p={sp} />
        <Kv
          items={[
            ['Fan TSP', wg(sp.tsp), 'E29', 'sp-tsp'],
            ['ESP', wg(sp.esp), 'I29', 'sp-esp'],
            ['Unit ΔP (inlet → fan)', wg(sp.unitDp), 'M29', 'sp-unitdp'],
          ]}
        />
        {esp && (
          <div className="callout" data-tone="amber" role="status" data-testid="esp-warning">
            {espText(esp)} Outside ±{Math.round(tolerance * 100)} %.
          </div>
        )}
        <ReportNote>
          {' '}
          A blank leaving static skips the component; a notation (N/A, Not Acc.) is passed on and blanks what depends on
          it.
        </ReportNote>
      </>
    );
  } else if (panel === 'motor') {
    const { cells } = unitLive(equipment, completion!);
    const inp = motorInputs(cells);
    const m = motorCalc(inp);
    const warnings = motorWarnings(m, inp, cells.serviceFactor, cells.hp);
    const legs = (n: number) => (n ? ` (${n} leg${n > 1 ? 's' : ''})` : '');
    body = (
      <>
        <Kv
          items={[
            [
              'Average volts',
              m.avgVolts === null ? '—' : `${formatNumber(m.avgVolts, 1)} V${legs(m.voltsLegs)}`,
              undefined,
              'motor-avg-volts',
            ],
            [
              'Average amps',
              m.avgAmps === null ? '—' : `${formatNumber(m.avgAmps, 2)} A${legs(m.ampsLegs)}`,
              undefined,
              'motor-avg-amps',
            ],
            [
              'Corrected FLA',
              m.correctedFla === null ? '—' : `${formatNumber(m.correctedFla, 2)} A`,
              'D18',
              'motor-fla',
            ],
            [
              `BHP (${m.onePhase ? '1-phase' : '3-phase'})`,
              m.bhp === null ? '—' : formatNumber(m.bhp, 2),
              'G18',
              'motor-bhp',
            ],
          ]}
        />
        {warnings.map((w) => (
          <div className="callout" data-tone="amber" role="status" key={w.key} data-testid={`motor-warning-${w.key}`}>
            {w.text}
          </div>
        ))}
        <ReportNote>
          {' '}
          Corrected FLA = rated V ÷ average measured V × FLA (needs volts L1). BHP ={' '}
          {m.onePhase ? 'V1 × A1 × 0.8 × 0.9 ÷ 746' : 'avg V × avg A × 0.8 × 0.9 × 1.732 ÷ 746'}.
        </ReportNote>
      </>
    );
  } else if (panel === 'unitEsp') {
    const { cells, sp } = unitLive(equipment, completion!);
    const design = typeof cells.unitEsp === 'number' ? cells.unitEsp : null;
    const esp = espDiscrepancy(cells.unitEsp, sp.esp, tolerance);
    body = (
      <>
        <div className="totals" aria-label="Unit ESP (design / actual)">
          <span>
            Unit ESP design <b>{design === null ? '—' : formatNumber(design, 2)}</b>
          </span>
          <span>
            Actual <b data-testid="unit-esp-actual">{sp.esp === null ? '—' : formatNumber(sp.esp, 2)}</b>
            <span className="report-tag" title="Printed in the report as Unit ESP actual (from the static profile)">
              report
            </span>
          </span>
          <span>{design && sp.esp !== null ? formatPercent(sp.esp / design) : '— %'}</span>
        </div>
        {esp && (
          <div className="callout" data-tone="amber" role="status">
            {espText(esp)} Outside ±{Math.round(tolerance * 100)} %.
          </div>
        )}
        <p className="small muted calc-note">
          Actual = ESP of the static pressure profile (fan leaving − unit entering).
        </p>
      </>
    );
  } else if (panel === 'psp' || panel === 'profile' || panel === 'mauTotal') {
    const t = mauTotals(d, rows);
    if (panel === 'psp') {
      body = (
        <Kv
          items={[
            ['K-factor', t.psp.k === null ? '—' : String(t.psp.k)],
            ['Readings', String(t.psp.readings)],
            ['Average VEL', t.psp.average === null ? '—' : `${formatNumber(t.psp.average, 1)} fpm`],
            ['PSP CFM', cfm(t.psp.cfm)],
            ['CFM / ft', t.psp.cfmPerFt === null ? '—' : formatNumber(t.psp.cfmPerFt, 1)],
          ]}
        />
      );
    } else if (panel === 'profile') {
      body = (
        <>
          <Kv items={[['Derived CFM', cfm(t.profile.cfm)]]} />
          {t.profile.warning && (
            <div className="callout" data-tone="amber" role="status">
              Pressure {t.profile.warning}: the curve covers 0.15–0.65 in. w.g.
            </div>
          )}
        </>
      );
    } else {
      body = (
        <div className="totals" aria-label="Unit totals">
          <span>
            Method <b>{t.method ?? '—'}</b>
          </span>
          {t.method && t.method !== 'Outlets' && (
            <span>
              Method total <b data-testid="mau-method-total">{formatNumber(t.methodTotal)}</b>
            </span>
          )}
          <span>
            Design <b data-testid="unit-design">{formatNumber(t.design)}</b>
          </span>
          <span>
            Actual <b data-testid="unit-actual">{formatNumber(t.actual)}</b>
          </span>
          <Pct ratio={t.ratio} tolerance={tolerance} />
        </div>
      );
    }
  } else if (panel === 'filterGrid') {
    const g = filterGridCfm(rows);
    body = <Kv items={[['Filter grid total', cfm(g.total)]]} />;
  } else if (panel === 'ervTotals') {
    const t = ervTotals(rows);
    const line = (label: string, x: { design: number | null; actual: number | null }, id: string) => (
      <span data-testid={`erv-${id}`}>
        {label} <b>{formatNumber(x.design)}</b> / <b>{formatNumber(x.actual)}</b>{' '}
        <Pct ratio={x.design && x.actual !== null ? x.actual / x.design : null} tolerance={tolerance} />
      </span>
    );
    body = (
      <div className="totals" aria-label="ERV totals (design / actual)">
        {line('Supply', t.supply, 'supply')}
        {line('Exhaust', t.exhaust, 'exhaust')}
      </div>
    );
  } else if (panel === 'hoodTotals') {
    const t = hoodTotals(d, rows);
    body = (
      <div className="totals" aria-label="Hood totals">
        <span>
          Design <b>{formatNumber(t.design)}</b>
        </span>
        <span>
          Initial <b>{formatNumber(t.initial)}</b>
        </span>
        <span>
          Final <b data-testid="hood-final">{formatNumber(t.final, 2)}</b>
        </span>
        <Pct ratio={t.ratio} tolerance={tolerance} />
        <span>
          CFM/ft <b>{formatNumber(t.finalPerFt ?? t.initialPerFt, 1)}</b>
        </span>
      </div>
    );
  } else if (panel === 'traverse') {
    const t = traverseTotals(d);
    body = (
      <>
        <Kv
          items={[
            ['Size', t.sizeText ?? '—'],
            ['Ak', t.ak === null ? '—' : `${t.ak} ft²`],
            ['Points', t.layoutText ? `${t.layoutText} = ${t.points}` : '—'],
            ['Positions across', t.positions.length ? t.positions.map((p) => `${p}"`).join(' · ') : '—'],
            ...(t.depths.length
              ? ([['Depths down', t.depths.map((p) => `${p}"`).join(' · ')]] as [string, string][])
              : []),
          ]}
        />
        <div className="totals" aria-label="Traverse results">
          <span>
            Final VEL <b data-testid="traverse-vel">{formatNumber(t.finalVel)}</b>
          </span>
          <span>
            Final CFM <b data-testid="traverse-cfm">{formatNumber(t.finalCfm)}</b>
          </span>
          <span>
            Initial CFM <b>{formatNumber(t.initialCfm)}</b>
          </span>
          <Pct ratio={t.ratio} tolerance={tolerance} />
        </div>
        {t.points !== null && t.entered > 0 && t.entered < t.points && (
          <div className="callout" data-tone="amber" role="status">
            {t.entered} of {t.points} points entered.
          </div>
        )}
        {t.points !== null && t.entered > t.points && (
          <div className="callout" data-tone="amber" role="status">
            {t.entered - t.points} reading(s) past the {t.points} grid points are not averaged by the workbook.
          </div>
        )}
      </>
    );
  }
  return (
    <div className="calc-panel" data-testid={`calc-${panel}`}>
      {body}
    </div>
  );
}
