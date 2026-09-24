/** Live-calculation panels at the end of a section (they mirror the workbook formulas, domain/equipmentCalcs.ts). */
import type { AirflowRow, Equipment } from '../../data/types';
import { formatNumber } from '../../domain/calc';
import { ervTotals, filterGridCfm, hoodTotals, mauTotals, traverseTotals } from '../../domain/equipmentCalcs';
import type { CalcPanel as PanelKey } from '../../domain/specs';
import { Pct } from './AirflowTable';

function Kv({ items }: { items: [string, string][] }) {
  return (
    <dl className="calc-kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const cfm = (x: number | null) => (x === null ? '—' : `${formatNumber(x)} CFM`);

export function CalcPanel({
  panel,
  equipment,
  rows,
  tolerance,
}: {
  panel: PanelKey;
  equipment: Equipment;
  rows: AirflowRow[];
  tolerance: number;
}) {
  const d = equipment.data;
  let body: React.ReactNode = null;
  if (panel === 'psp' || panel === 'profile' || panel === 'mauTotal') {
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
