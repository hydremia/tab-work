import { useCallback, useState } from 'react';
import { useBlocker, useNavigate, type Location } from 'react-router';
import type { ExportStatus } from '../../data/exportStatus';
import { reminderSnoozed, snoozeReminder } from '../../data/exportStatus';
import { useExportStatus } from '../../data/hooks';
import type { Project } from '../../data/types';
import { useSync } from '../../sync/SyncProvider';
import { IconDownload } from './Icons';

const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const changes = (n: number) => `${n} change${n === 1 ? '' : 's'}`;

/** "Last exported Sep 24, 2026, 3:10 PM (Prelim) · 12 changes since" / "Not exported yet · 9 changes". */
export function exportStateText(s: ExportStatus): string {
  if (s.lastExportAt === null) return `Not exported yet${s.changesSince ? ` · ${changes(s.changesSince)}` : ''}`;
  return `Last exported ${when(s.lastExportAt)}${s.lastLabel ? ` (${s.lastLabel})` : ''} · ${
    s.changesSince ? `${changes(s.changesSince)} since` : 'no changes since'
  }`;
}

/** One line for the project card and the Export tab; amber in local mode when there are unexported changes. */
export function ExportStateLine({ status, testId = 'export-state' }: { status: ExportStatus; testId?: string }) {
  const { status: mode } = useSync();
  const warn = mode === 'local' && status.changesSince > 0;
  return (
    <span className="small export-state" data-tone={warn ? 'amber' : undefined} data-testid={testId}>
      {exportStateText(status)}
    </span>
  );
}

/** Navigations that stay with the project (its pages, units, the re-import of its workbook) or follow a delete. */
function staysWithProject(projectId: string, next: Location): boolean {
  if (next.pathname.startsWith(`/p/${projectId}`)) return true;
  if (next.pathname === '/import' && new URLSearchParams(next.search).get('into') === projectId) return true;
  return Boolean((next.state as { projectDeleted?: boolean } | null)?.projectDeleted);
}

/**
 * Export reminder when leaving a project in local mode with changes since the last export: the exported workbook is
 * the only backup until sync is live. Export now / Leave / Don't remind me today (per project, on this device).
 * In-app navigation only: closing the tab or the installed app can't be intercepted reliably on phones.
 */
export function ExportReminderGuard({ project }: { project: Project }) {
  const sync = useSync();
  const status = useExportStatus(project.id);
  const nav = useNavigate();
  const [snoozed, setSnoozed] = useState(() => reminderSnoozed(project.id));
  const active = sync.status === 'local' && !snoozed && !project.lock && (status?.changesSince ?? 0) > 0;
  const blocker = useBlocker(
    useCallback(
      ({ nextLocation }: { nextLocation: Location }) => active && !staysWithProject(project.id, nextLocation),
      [active, project.id],
    ),
  );
  // (the marker lets tests wait until the export status is loaded and the reminder is armed)
  if (blocker.state !== 'blocked' || !status)
    return active ? <span hidden data-testid="export-reminder-armed" /> : null;
  return (
    <div className="sheet-backdrop" data-testid="export-reminder">
      <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="xr-h" aria-describedby="xr-p">
        <h2 id="xr-h">Export before you leave?</h2>
        <p id="xr-p" className="small">
          <b>{project.name}</b>: {exportStateText(status)}. In local mode the exported workbook (saved to Dropbox) is
          the only backup of this project.
        </p>
        <div className="sheet-actions">
          <button
            type="button"
            className="btn btn-primary btn-block"
            data-testid="export-reminder-export"
            onClick={() => {
              blocker.reset();
              nav(`/p/${project.id}/export`);
            }}
          >
            <IconDownload size={18} /> Go to Export
          </button>
          <button
            type="button"
            className="btn btn-block"
            data-testid="export-reminder-leave"
            onClick={() => blocker.proceed()}
          >
            Leave without exporting
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-block"
            data-testid="export-reminder-snooze"
            onClick={() => {
              snoozeReminder(project.id);
              setSnoozed(true);
              blocker.proceed();
            }}
          >
            Don't remind me again today
          </button>
        </div>
      </div>
    </div>
  );
}
