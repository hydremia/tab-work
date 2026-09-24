/**
 * Sync conflicts in the UI (sync/conflicts.ts): a card per conflict with both values and the resolve actions, used by
 * the Attention tab (all of a project's conflicts) and the unit page (that unit's). Field conflicts: *Keep current*
 * or *Use "<other value>"* (a normal edit through setField). Held changes (refused by a report lock): *Discard*.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router';
import { db } from '../../data/db';
import type { AirflowRow, ConflictSide, Equipment, HistoryEntry, Issue, Project, SyncConflict } from '../../data/types';
import { fieldLabel, makeContext, subjectText, valueText, type HistoryContext } from '../../domain/historyView';
import { discardHeld, resolveConflict } from '../../sync/conflicts';
import { IconConflict } from './Icons';

const when = (t: number) =>
  new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const who = (s: ConflictSide) => (s.local ? 'This device' : 'Another device');

function entryOf(c: SyncConflict): HistoryEntry {
  return {
    id: c.id,
    projectId: c.projectId,
    ts: c.detectedAt,
    kind: 'conflict',
    table: c.table,
    recordId: c.recordId,
    equipmentId: c.equipmentId,
    field: c.field,
    userId: '',
    deviceId: '',
  };
}

function FieldConflict({
  c,
  ctx,
  projectId,
  linkUnit,
}: {
  c: SyncConflict;
  ctx: HistoryContext;
  projectId: string;
  linkUnit: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const e = entryOf(c);
  const label = fieldLabel(e, ctx);
  const subject = subjectText(e, ctx);
  const current = c.current!;
  const other = c.other!;
  const otherText = valueText(e, other.value, ctx);
  const act = async (action: 'keep' | 'restore') => {
    setBusy(true);
    setError(null);
    try {
      await resolveConflict(c.id, action);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="conflict-card" data-testid="conflict" data-field={c.field}>
      <header>
        <IconConflict size={18} />
        <span className="grow">
          {linkUnit && c.equipmentId ? (
            <Link to={`/p/${projectId}/e/${c.equipmentId}`}>{subject}</Link>
          ) : (
            <b>{subject}</b>
          )}
          <span> · {label}</span>
        </span>
      </header>
      <p className="small muted">Edited on two devices before either had synced. The later edit is kept.</p>
      <div className="conflict-values">
        <div data-side="current">
          <span className="conflict-tag">Current</span>
          <b data-testid="conflict-current">{valueText(e, current.value, ctx)}</b>
          <span className="small muted">{who(current)}</span>
          <span className="small muted">{when(current.ts)}</span>
        </div>
        <div data-side="other">
          <span className="conflict-tag">Other value</span>
          <b data-testid="conflict-other">{otherText}</b>
          <span className="small muted">{who(other)}</span>
          <span className="small muted">{when(other.ts)}</span>
        </div>
      </div>
      <div className="row-actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void act('keep')}
          data-testid="conflict-keep"
        >
          Keep current
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void act('restore')}
          data-testid="conflict-restore"
        >
          Use “{otherText.length > 24 ? `${otherText.slice(0, 23)}…` : otherText}”
        </button>
      </div>
      {error && (
        <div className="callout" data-tone="red" role="alert">
          {error}
        </div>
      )}
    </article>
  );
}

function HeldConflict({ c }: { c: SyncConflict }) {
  const [busy, setBusy] = useState(false);
  const h = c.held!;
  const discard = async () => {
    const ok = window.confirm(
      `Discard ${h.count} change${h.count > 1 ? 's' : ''} made on this device?\n\n` +
        'They were not synced because the report was issued meanwhile. Discarding puts the values back to what the ' +
        'rest of the team has. This cannot be undone.',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await discardHeld(c.id);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="conflict-card" data-testid="conflict-held">
      <header>
        <IconConflict size={18} />
        <span className="grow">
          <b>
            {h.count} change{h.count > 1 ? 's' : ''} not synced
          </b>
        </span>
      </header>
      <p className="small">
        The report was issued as <b>{h.label}</b>
        {h.by ? ` by ${h.by}` : ''} on another device before these edits from this device reached the server. They are
        kept on this device and sync when the project is unlocked.
      </p>
      <div className="row-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void discard()}>
          Discard them
        </button>
      </div>
    </article>
  );
}

/** Conflict cards for a list of open conflicts (their rows / instruments are looked up for labels). */
export function ConflictList({
  conflicts,
  project,
  equipment,
  issues,
  linkUnit = true,
}: {
  conflicts: readonly SyncConflict[];
  project: Project;
  equipment: readonly Equipment[];
  issues: readonly Issue[];
  linkUnit?: boolean;
}) {
  const extra = useLiveQuery(async () => {
    const rowIds = conflicts.filter((c) => c.table === 'airflowRows' && c.recordId).map((c) => c.recordId!);
    const insIds = conflicts.filter((c) => c.table === 'instruments' && c.recordId).map((c) => c.recordId!);
    const [rows, instruments] = await Promise.all([db.airflowRows.bulkGet(rowIds), db.instruments.bulkGet(insIds)]);
    return {
      rows: rows.filter((r): r is AirflowRow => Boolean(r)),
      instruments: instruments.filter((r) => r !== undefined),
    };
  }, [conflicts]);
  const ctx = makeContext({ equipment, issues, rows: extra?.rows, instruments: extra?.instruments });
  return (
    <div className="stack">
      {conflicts.map((c) =>
        c.kind === 'held' ? (
          <HeldConflict key={c.id} c={c} />
        ) : (
          <FieldConflict key={c.id} c={c} ctx={ctx} projectId={project.id} linkUnit={linkUnit} />
        ),
      )}
    </div>
  );
}
