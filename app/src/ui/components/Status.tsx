import type { Rollup, StatusColor } from '../../domain/completion';
import { STATUS_LABEL } from '../../domain/completion';
import { IconStatusAmber, IconStatusGray, IconStatusGreen, IconStatusRed } from './Icons';

const ICONS = { gray: IconStatusGray, amber: IconStatusAmber, green: IconStatusGreen, red: IconStatusRed };

export function StatusIcon({ color, size = 20 }: { color: StatusColor; size?: number }) {
  const I = ICONS[color];
  return (
    <span className="status-icon" data-color={color} style={{ display: 'inline-flex' }}>
      <I size={size} />
    </span>
  );
}

export function StatusBadge({ color, label }: { color: StatusColor; label?: string }) {
  return (
    <span className="status" data-color={color} data-testid="status-badge">
      <StatusIcon color={color} size={16} />
      {label ?? STATUS_LABEL[color]}
    </span>
  );
}

export function ProgressBar({ rollup }: { rollup: Rollup }) {
  const pct = (n: number) => (rollup.total ? `${(n / rollup.total) * 100}%` : '0%');
  return (
    <div
      className="progress"
      role="img"
      aria-label={`${rollup.green} of ${rollup.total} complete, ${rollup.amber} in progress, ${rollup.red} need attention, ${rollup.gray} not started`}
    >
      <span className="seg-green" style={{ width: pct(rollup.green) }} />
      <span className="seg-red" style={{ width: pct(rollup.red) }} />
      <span className="seg-amber" style={{ width: pct(rollup.amber) }} />
      <span className="seg-gray" style={{ width: pct(rollup.gray) }} />
    </div>
  );
}

export function RollupCounts({ rollup }: { rollup: Rollup }) {
  return (
    <div className="counts">
      {(['green', 'red', 'amber', 'gray'] as const).map((c) => (
        <span key={c} title={STATUS_LABEL[c]}>
          <StatusIcon color={c} size={16} />
          {rollup[c]} <span className="visually-hidden">{STATUS_LABEL[c]}</span>
        </span>
      ))}
    </div>
  );
}
