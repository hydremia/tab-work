import { useState } from 'react';
import { useRevisions } from '../../data/hooks';
import { unlockProject } from '../../data/repo';
import type { Project } from '../../data/types';
import { suggestLabel } from '../../workbook/revisions';
import { IconLock } from './Icons';

export const whenDate = (t: number) => new Date(t).toLocaleDateString('en-US', { dateStyle: 'medium' });

/** "Issued as Rev 1 on Sep 24, 2026" */
export const issuedText = (lock: NonNullable<Project['lock']>) => `Issued as ${lock.label} on ${whenDate(lock.at)}`;

/**
 * Unlock for follow-up: a confirm dialog naming the issued revision and the label the next export will suggest.
 * Resolves true when unlocked.
 */
export function useUnlock(project: Project): { unlock: () => Promise<boolean>; next: string; error: string | null } {
  const revisions = useRevisions(project.id);
  const [error, setError] = useState<string | null>(null);
  const next = revisions ? suggestLabel(revisions) : 'the next revision';
  async function unlock() {
    const lock = project.lock;
    if (!lock) return true;
    const ok = window.confirm(
      `Unlock ${project.name} for follow-up?\n\n${issuedText(lock)}${lock.name ? ` by ${lock.name}` : ''}. ` +
        `Edits are allowed again and the next export will be suggested as ${next}. The unlock is recorded in the history.`,
    );
    if (!ok) return false;
    try {
      await unlockProject(project.id);
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }
  return { unlock, next, error };
}

/** Shown on every page of a locked (issued) project; edits are blocked in the UI and by the repository. */
export function LockBanner({ project, onUnlocked }: { project: Project; onUnlocked?: () => void }) {
  const { unlock, error } = useUnlock(project);
  if (!project.lock) return null;
  return (
    <div className="lock-banner" role="status" data-testid="lock-banner">
      <IconLock size={20} />
      <span className="grow">
        <b>{issuedText(project.lock)}</b> — unlock to edit
        {error && <span className="small lock-error"> ({error})</span>}
      </span>
      <button
        type="button"
        className="btn"
        data-testid="unlock"
        onClick={() => void unlock().then((ok) => ok && onUnlocked?.())}
      >
        Unlock
      </button>
    </div>
  );
}
