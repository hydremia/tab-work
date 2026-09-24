/**
 * Review of a re-imported issued workbook (decision F2): incoming changes (accept / decline) and collisions (use app /
 * use workbook), grouped by project info, narrative, issues, calibration and unit. Apply is enabled once every
 * collision is resolved; Cancel leaves everything untouched.
 */
import { useMemo, useState } from 'react';
import { projectStatus, usePhotoMeta } from '../../data/hooks';
import type { StatusColor } from '../../domain/completion';
import { STATUS_LABEL } from '../../domain/completion';
import type { ApplySummary, ParsedImport, Review } from '../../workbook/importProject';
import { choiceOf, planApply, previewBundle } from '../../workbook/reimportApply';
import { showVal, type Choice, type DiffItem } from '../../workbook/reimportDiff';
import { StatusIcon } from './Status';

interface Group {
  key: string;
  title: string;
  sections: { title: string; items: DiffItem[] }[];
  items: DiffItem[];
}

function groupsOf(items: DiffItem[]): Group[] {
  const out: Group[] = [];
  for (const it of items) {
    let g = out.find((x) => x.key === it.group);
    if (!g) {
      g = { key: it.group, title: it.groupTitle, sections: [], items: [] };
      out.push(g);
    }
    g.items.push(it);
    let s = g.sections.find((x) => x.title === it.section);
    if (!s) {
      s = { title: it.section, items: [] };
      g.sections.push(s);
    }
    s.items.push(it);
  }
  return out;
}

const fmtDate = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function ReimportReview({
  review,
  parsed,
  projectName,
  onCancel,
  onApply,
}: {
  review: Review;
  parsed: ParsedImport;
  projectName: string;
  onCancel: () => void;
  onApply: (decisions: Record<string, Choice | undefined>) => Promise<ApplySummary>;
}) {
  const { diff, baseline } = review;
  const [decisions, setDecisions] = useState<Record<string, Choice | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photos = usePhotoMeta(review.projectId);
  const groups = useMemo(() => groupsOf(diff.items), [diff.items]);
  const openCollisions = diff.items.filter((i) => i.kind === 'collision' && !decisions[i.id]).length;

  // unit colors before and after the merge (preview of the accepted values)
  const colors = useMemo(() => {
    const out = new Map<string, { before: StatusColor; after: StatusColor | null }>();
    if (!photos) return out;
    const status = (b: typeof review.bundle) =>
      projectStatus({ project: b.project, equipment: b.equipment, rows: b.rows, photos, issues: b.issues });
    const before = status(review.bundle);
    const merged = previewBundle(review.bundle, planApply(review.bundle, diff, decisions).ops);
    const after = status(merged);
    const unitAt = (b: typeof review.bundle, key: string) =>
      b.equipment.find((e) => `unit:${e.type}#${e.slot}` === key);
    for (const g of groups) {
      if (!g.key.startsWith('unit:')) continue;
      const u0 = unitAt(review.bundle, g.key);
      const u1 = unitAt(merged, g.key);
      out.set(g.key, {
        before: u0 ? before.byEquipment.get(u0.id)!.color : 'gray',
        after: u1 ? (after.byEquipment.get(u1.id)?.color ?? 'gray') : null,
      });
    }
    return out;
  }, [photos, review, diff, decisions, groups]);

  const choose = (ids: string[], c: Choice) =>
    setDecisions((d) => ({ ...d, ...Object.fromEntries(ids.map((id) => [id, c])) }));
  const incomingIds = (items: DiffItem[]) => items.filter((i) => i.kind === 'incoming').map((i) => i.id);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await onApply(decisions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const rev = baseline.revision;
  return (
    <div className="stack review" data-testid="reimport-review">
      <section className="card card-pad stack" aria-labelledby="rv-h">
        <h2 id="rv-h">Review changes</h2>
        <p className="small muted" style={{ margin: 0 }}>
          <b>{parsed.fileName}</b> into <b>{projectName}</b>.{' '}
          {baseline.how === 'marker' && rev && (
            <>
              Compared with <b>{rev.label}</b>, exported {fmtDate(rev.createdAt)}: only values changed since then are
              shown.
            </>
          )}
          {baseline.how === 'latest' && rev && (
            <>
              The workbook has no revision marker from this project, so it is compared with the latest export,{' '}
              <b>{rev.label}</b> ({fmtDate(rev.createdAt)}).
            </>
          )}
          {baseline.how === 'none' && <>No export of this project to compare with: every difference is incoming.</>}
        </p>
        <div className="review-stats">
          <div data-testid="review-incoming">
            <b>{diff.counts.incoming}</b>
            <span>incoming change{diff.counts.incoming === 1 ? '' : 's'}</span>
          </div>
          <div data-testid="review-collisions" data-open={openCollisions > 0}>
            <b>{diff.counts.collisions}</b>
            <span>collision{diff.counts.collisions === 1 ? '' : 's'}</span>
          </div>
          <div data-testid="review-added">
            <b>{diff.counts.equipmentAdded}</b>
            <span>equipment added</span>
          </div>
        </div>
        {diff.items.length === 0 ? (
          <div className="callout" data-tone="info" data-testid="review-nothing">
            No value differs from the app. Applying keeps this file as the base of the next export.
          </div>
        ) : (
          <div className="row review-actions">
            <button
              type="button"
              className="btn"
              data-testid="accept-all"
              onClick={() => choose(incomingIds(diff.items), 'wb')}
            >
              Accept all incoming
            </button>
            {diff.counts.remarks > 0 && (
              <button
                type="button"
                className="btn"
                data-testid="accept-remarks"
                onClick={() => choose(incomingIds(diff.items.filter((i) => i.remark)), 'wb')}
              >
                Accept all remarks
              </button>
            )}
          </div>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Collisions (changed in Excel and in the app) are never resolved by a group action. Formatting is not compared:
          this file becomes the base of the next export, so fixes made in Excel carry forward.
        </p>
      </section>

      {groups.map((g) => {
        const c = colors.get(g.key);
        return (
          <section key={g.key} className="card review-group" data-testid={`review-group-${g.key}`} aria-label={g.title}>
            <header className="review-group-head">
              <h3>{g.title}</h3>
              {c && (
                <span className="review-colors" data-testid={`preview-${g.title}`} data-color={c.after ?? 'removed'}>
                  <StatusIcon color={c.before} size={16} />
                  <span aria-hidden="true">→</span>
                  {c.after ? (
                    <>
                      <StatusIcon color={c.after} size={16} />
                      {STATUS_LABEL[c.after]}
                    </>
                  ) : (
                    'removed'
                  )}
                </span>
              )}
              {g.key.startsWith('unit:') && incomingIds(g.items).length > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost review-unit-accept"
                  onClick={() => choose(incomingIds(g.items), 'wb')}
                >
                  Accept all in this unit
                </button>
              )}
            </header>
            {g.sections.map((s) => (
              <div key={s.title} className="review-section">
                {s.title && <h4>{s.title}</h4>}
                <ul className="diff-list">
                  {s.items.map((it) => (
                    <DiffRow
                      key={it.id}
                      item={it}
                      choice={choiceOf(it, decisions)}
                      onChoose={(ch) => choose([it.id], ch)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        );
      })}

      {error && (
        <div className="callout" data-tone="red" role="alert">
          {error}
        </div>
      )}
      <div className="review-bar">
        <div className="review-bar-inner">
          <button type="button" className="btn" onClick={onCancel} disabled={busy} data-testid="review-cancel">
            Cancel
          </button>
          <span className="review-bar-note small" data-testid="review-open">
            {openCollisions
              ? `${openCollisions} collision${openCollisions === 1 ? '' : 's'} to resolve`
              : 'Ready to apply'}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void apply()}
            disabled={busy || openCollisions > 0}
            data-testid="review-apply"
          >
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DiffRow({ item, choice, onChoose }: { item: DiffItem; choice: Choice | null; onChoose: (c: Choice) => void }) {
  const collision = item.kind === 'collision';
  const presence: Record<string, string> = {
    added: 'Added in the workbook',
    removed: 'Removed in the workbook',
    restored: 'Deleted in the app, changed in the workbook',
  };
  return (
    <li
      className="diff-item"
      data-testid="diff-item"
      data-kind={item.kind}
      data-change={item.change}
      data-cell={item.cell ?? ''}
      data-choice={choice ?? ''}
    >
      <div className="diff-label">
        <span>{item.change === 'field' ? item.label : `${presence[item.change]}: ${item.label}`}</span>
        {collision && <span className="chip chip-collision">Collision</span>}
        {item.remark && <span className="chip">Remark</span>}
      </div>
      {item.change === 'field' && !collision && (
        <div className="diff-change">
          <span className="diff-old">{showVal(item.app)}</span>
          <span className="diff-arrow" aria-label="changed to">
            →
          </span>
          <span className="diff-new">{showVal(item.wb)}</span>
        </div>
      )}
      {(collision || item.change !== 'field') && (
        <dl className="diff-three">
          {item.change === 'field' && (
            <>
              <dt>Exported</dt>
              <dd>{showVal(item.base)}</dd>
            </>
          )}
          {(item.change !== 'added' || item.app !== null) && (
            <>
              <dt>App</dt>
              <dd data-side="app">{showVal(item.app)}</dd>
            </>
          )}
          <dt>Workbook</dt>
          <dd data-side="wb">{item.change === 'removed' ? '(removed)' : showVal(item.wb)}</dd>
        </dl>
      )}
      {item.note && <p className="small muted diff-note">{item.note}</p>}
      <div className="segmented diff-choice" role="group" aria-label={`Keep ${item.label}`}>
        {collision ? (
          <>
            <button type="button" aria-pressed={choice === 'app'} onClick={() => onChoose('app')}>
              Use app
            </button>
            <button type="button" aria-pressed={choice === 'wb'} onClick={() => onChoose('wb')}>
              Use workbook
            </button>
          </>
        ) : (
          <>
            <button type="button" aria-pressed={choice === 'wb'} onClick={() => onChoose('wb')}>
              Accept
            </button>
            <button type="button" aria-pressed={choice === 'app'} onClick={() => onChoose('app')}>
              Decline
            </button>
          </>
        )}
      </div>
    </li>
  );
}
