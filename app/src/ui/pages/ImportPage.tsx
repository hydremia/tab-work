/**
 * Import a workbook. Two separate paths:
 *  - re-import of an issued workbook into a project on this device: a review of the changes (three-way diff) that
 *    the user accepts / declines. Taken when the page is opened from a project ("?into=") or when the picked
 *    workbook carries the revision marker of a project on this device;
 *  - a workbook for a project that was never in the app here: "Create new project", or "Compare with project…"
 *    (a two-way review against a project the user picks).
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { db } from '../../data/db';
import { useProject, useProjects } from '../../data/hooks';
import { EQUIPMENT_TYPES } from '../../domain/equipmentTypes';
import type { ParsedImport, Review } from '../../workbook/importProject';
import type { Choice } from '../../workbook/reimportDiff';
import { IconFile } from '../components/Icons';
import { LockBanner } from '../components/LockBanner';
import { ReimportReview } from '../components/ReimportReview';
import { Screen } from '../components/Screen';

const engine = () => import('../../workbook/importProject');

type Step =
  | { step: 'pick' }
  | { step: 'choose' }
  | { step: 'review'; review: Review; projectName: string }
  /** The target project is locked (issued): unlock it first, then continue to the review. */
  | { step: 'locked'; projectId: string; twoWay: boolean };

/** A locked target: the lock banner (with Unlock) and, once unlocked, "Continue to the review". */
function LockedTarget({ projectId, onContinue }: { projectId: string; onContinue: () => void }) {
  const project = useProject(projectId);
  if (!project) return null;
  return (
    <section className="card card-pad stack" data-testid="import-locked">
      <h2>{project.name}</h2>
      {project.lock ? (
        <>
          <LockBanner project={project} />
          <p className="small muted" style={{ margin: 0 }}>
            The report was issued and the project is locked, so nothing can be re-imported into it. Unlock it for
            follow-up to review the workbook's changes.
          </p>
        </>
      ) : (
        <button type="button" className="btn btn-primary" data-testid="import-continue" onClick={onContinue}>
          Continue to the review
        </button>
      )}
    </section>
  );
}

export function ImportPage() {
  const [params] = useSearchParams();
  const intoId = params.get('into') ?? undefined;
  const into = useProject(intoId);
  const projects = useProjects();
  const nav = useNavigate();
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [state, setState] = useState<Step>({ step: 'pick' });
  const [compareWith, setCompareWith] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openReview(p: ParsedImport, projectId: string, twoWay: boolean) {
    const e = await engine();
    const target = await db.projects.get(projectId);
    if (target?.lock) {
      setState({ step: 'locked', projectId, twoWay });
      return;
    }
    const review = await e.prepareReview(projectId, p, twoWay);
    setState({ step: 'review', review, projectName: review.bundle.project.name });
    window.scrollTo(0, 0);
  }

  async function pick(file: File) {
    setBusy(true);
    setError(null);
    setParsed(null);
    setState({ step: 'pick' });
    try {
      const e = await engine();
      const p = await e.parseWorkbook(await e.readWorkbookFile(file), file.name);
      setParsed(p);
      const own = await e.markerProject(p);
      if (intoId) {
        // from a project's Export page: its own workbook (marker) or, without one, the latest export as the base;
        // a workbook of another project is compared two-way
        await openReview(p, intoId, Boolean(p.marker) && p.marker!.projectId !== intoId);
      } else if (own) await openReview(p, own.id, false);
      else setState({ step: 'choose' });
    } catch (e) {
      setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function createNew() {
    if (!parsed) return;
    setBusy(true);
    const id = await (await engine()).saveAsNewProject(parsed);
    nav(`/p/${id}/equipment`, { replace: true });
  }

  async function compare() {
    if (!parsed || !compareWith) return;
    setBusy(true);
    try {
      await openReview(parsed, compareWith, true);
    } finally {
      setBusy(false);
    }
  }

  async function apply(review: Review, decisions: Record<string, Choice | undefined>) {
    const s = await (await engine()).applyReimport(review, parsed!, decisions);
    nav(`/p/${review.projectId}/export?applied=${s.accepted}`, { replace: true });
    return s;
  }

  const b = parsed?.bundle;
  const back = into ? `/p/${into.id}/export` : '/';
  if (state.step === 'review' && parsed) {
    return (
      <Screen title="Re-import" subtitle={state.projectName} back={back}>
        <ReimportReview
          review={state.review}
          parsed={parsed}
          projectName={state.projectName}
          onCancel={() => nav(`/p/${state.review.projectId}/export`, { replace: true })}
          onApply={(d) => apply(state.review, d)}
        />
      </Screen>
    );
  }
  if (into?.lock && state.step !== 'locked') {
    return (
      <Screen title="Import workbook" subtitle={`into ${into.name}`} back={back}>
        <LockBanner project={into} />
        <p className="small muted" data-testid="import-blocked">
          The report was issued and the project is locked: re-importing is blocked until it is unlocked for follow-up.
        </p>
      </Screen>
    );
  }
  if (state.step === 'locked' && parsed) {
    const { projectId, twoWay } = state;
    return (
      <Screen title="Import workbook" subtitle={parsed.fileName} back={back}>
        <LockedTarget
          projectId={projectId}
          onContinue={() => void openReview(parsed, projectId, twoWay).catch((e: unknown) => setError(String(e)))}
        />
        {error && (
          <div className="callout" data-tone="red" role="alert">
            {error}
          </div>
        )}
      </Screen>
    );
  }
  return (
    <Screen title="Import workbook" subtitle={into ? `into ${into.name}` : undefined} back={back}>
      <section className="card card-pad stack">
        <h2>{into ? 'Pick the issued workbook' : 'Pick a TAB workbook'}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          {into
            ? 'The report exported from this project (and edited in Excel since). You review every changed value before anything is saved.'
            : 'A revision 05 workbook (.xlsm) exported by this app or filled in by hand. On a phone, pick it from Files / Dropbox.'}
        </p>
        <label className="btn btn-primary btn-lg file-btn">
          <IconFile size={20} /> {busy ? 'Reading…' : 'Choose .xlsm file'}
          <input
            type="file"
            accept=".xlsm,.xlsx,application/vnd.ms-excel.sheet.macroEnabled.12"
            aria-label="Workbook file"
            onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])}
          />
        </label>
        {error && (
          <div className="callout" data-tone="red" role="alert">
            {error}
          </div>
        )}
      </section>

      {state.step === 'choose' && b && parsed && (
        <section className="card card-pad stack" aria-labelledby="imp-h" data-testid="import-summary">
          <h2 id="imp-h">{b.project.name}</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {parsed.marker
              ? 'Exported from a project that is not on this device.'
              : 'Not exported by this app (no revision marker).'}
          </p>
          <dl className="kv">
            <dt>File</dt>
            <dd>{parsed.fileName}</dd>
            <dt>Address</dt>
            <dd>{String(b.project.info.address ?? '—')}</dd>
            <dt>TAB date</dt>
            <dd>{String(b.project.info.tabDate ?? '—')}</dd>
            {EQUIPMENT_TYPES.map((t) => {
              const n = b.equipment.filter((e) => e.type === t.key).length;
              return n ? (
                <FragmentRow
                  key={t.key}
                  label={t.plural}
                  value={`${n}: ${b.equipment
                    .filter((e) => e.type === t.key)
                    .map((e) => e.designation)
                    .join(', ')}`}
                />
              ) : null;
            })}
            <dt>Airflow rows</dt>
            <dd>{b.rows.length}</dd>
            <dt>Issues</dt>
            <dd>
              {b.issues.filter((i) => i.kind === 'new').length} new ·{' '}
              {b.issues.filter((i) => i.kind === 'existing').length} existing
            </dd>
            <dt>Instruments</dt>
            <dd>{b.instruments.length}</dd>
          </dl>
          {parsed.warnings.length > 0 && (
            <ul className="warn-list">
              {parsed.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <button
            className="btn btn-primary btn-lg"
            onClick={() => void createNew()}
            disabled={busy}
            data-testid="import-create"
          >
            Create new project
          </button>
          <p className="small muted" style={{ margin: 0 }}>
            Photos are not in the workbook: the units of a new project stay amber until their photos are added.
          </p>
          {projects && projects.length > 0 && (
            <div className="stack compare-with">
              <label className="field-label" htmlFor="cmp">
                Or compare with a project on this device
              </label>
              <div className="row">
                <select
                  id="cmp"
                  className="input select"
                  value={compareWith}
                  onChange={(e) => setCompareWith(e.target.value)}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <option value="">Choose a project…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn"
                  disabled={!compareWith || busy}
                  onClick={() => void compare()}
                  data-testid="import-compare"
                >
                  Compare…
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </Screen>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
