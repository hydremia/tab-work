/**
 * "Last exported … · N changes since": the export reminder for local mode, where the exported workbook is the only
 * backup of a project. Changes are counted from the change history (data/history.ts): edits, creates and deletes
 * after the newest *export* revision (events such as review, lock or the export itself don't count). The history
 * keeps every save, so N is the number of saved edits, not of distinct fields.
 */
import { db } from './db';
import type { HistoryKind } from './types';

export interface ExportStatus {
  /** Time of the newest export on this device, or null when the project was never exported here. */
  lastExportAt: number | null;
  lastLabel: string | null;
  /** Saved data changes since then (since the project was created when never exported). */
  changesSince: number;
}

const DATA_KINDS: ReadonlySet<HistoryKind> = new Set(['edit', 'create', 'delete']);

export async function exportStatus(projectId: string): Promise<ExportStatus> {
  const last = await db.revisions
    .where('[projectId+createdAt]')
    .between([projectId, -Infinity], [projectId, Infinity])
    .reverse()
    .filter((r) => r.kind === 'export')
    .first();
  // count back from the newest entry to the export's own history event ("revision"), which has a timestamp in the
  // same monotonic sequence as the edits
  let changesSince = 0;
  let found = false;
  await db.history
    .where('[projectId+ts]')
    .between([projectId, -Infinity], [projectId, Infinity])
    .reverse()
    .until((h) => (h.kind === 'revision' ? (found = true) : false))
    .each((h) => {
      if (DATA_KINDS.has(h.kind)) changesSince++;
    });
  if (!found && last) {
    // the export's event was pruned: fall back to the revision's time
    changesSince = await db.history
      .where('[projectId+ts]')
      .between([projectId, last.createdAt], [projectId, Infinity], false, true)
      .filter((h) => DATA_KINDS.has(h.kind))
      .count();
  }
  return { lastExportAt: last?.createdAt ?? null, lastLabel: last?.label ?? null, changesSince };
}

// ---------------------------------------------------------------- "don't remind me today" (per device, best effort)
const snoozeKey = (projectId: string) => `a2b-tab.export-reminder.${projectId}`;
const today = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

export function reminderSnoozed(projectId: string, now = new Date()): boolean {
  try {
    return localStorage.getItem(snoozeKey(projectId)) === today(now);
  } catch {
    return false;
  }
}

export function snoozeReminder(projectId: string, now = new Date()): void {
  try {
    localStorage.setItem(snoozeKey(projectId), today(now));
  } catch {
    /* storage blocked: the reminder simply shows again */
  }
}
