import { useState } from 'react';
import type { IssueKind } from '../../data/types';
import type { PerPage } from '../../reports/layout';
import type { ReportRequest, ReportResult } from '../../reports/generate';
import { Link, useSearchParams } from 'react-router';
import { useBaseWorkbook, useRevisions } from '../../data/hooks';
import type { Revision } from '../../data/types';
import type { ExportResult } from '../../workbook/exportProject';
import { KEEP_REVISION_FILES, suggestLabel } from '../../workbook/revisions';
import { IconDownload, IconLock, IconUpload } from '../components/Icons';
import { issuedText, useUnlock } from '../components/LockBanner';
import { ProgressBar, RollupCounts } from '../components/Status';
import { useProjectContext } from './ProjectLayout';

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
type IssueScope = 'all' | IssueKind;
const SCOPE_KINDS: Record<IssueScope, IssueKind[]> = { all: ['new', 'existing'], new: ['new'], existing: ['existing'] };
const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function ExportPage() {
  const { project, equipment, issues, status, locked } = useProjectContext();
  const { unlock } = useUnlock(project);
  const revisions = useRevisions(project.id);
  const base = useBaseWorkbook(project.id);
  const [params] = useSearchParams();
  const applied = params.get('applied');
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportTyped, setReportTyped] = useState<string | null>(null);
  const [perPage, setPerPage] = useState<PerPage>(4);
  const [withDeficiency, setWithDeficiency] = useState(true);
  const [scope, setScope] = useState<IssueScope>('all');
  const [reportBusy, setReportBusy] = useState<string | null>(null);
  const [reportResult, setReportResult] = useState<ReportResult | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const smallFans = equipment.filter((e) => e.type === 'smallFan').length;
  const suggested = revisions ? suggestLabel(revisions) : '';
  const label = typed ?? suggested;
  // reports carry the label of the workbook just exported (or the last export), editable
  const lastExport = revisions?.find((r) => r.kind === 'export');
  const reportLabel = reportTyped ?? result?.revision.label ?? lastExport?.label ?? suggested;

  async function makeReport(req: Omit<ReportRequest, 'label'> | 'zip') {
    setReportBusy('Preparing…');
    setReportError(null);
    setReportResult(null);
    try {
      const gen = await import('../../reports/generate');
      const progress = (done: number, total: number) =>
        setReportBusy(total ? `${req === 'zip' ? 'Adding' : 'Placing'} photo ${done} of ${total}…` : 'Preparing…');
      const l = reportLabel.trim();
      const r =
        req === 'zip'
          ? await gen.generatePhotoZip(project.id, l, progress)
          : await gen.generateReport(project.id, { ...req, label: l }, progress);
      gen.downloadFile(r.bytes, r.fileName, req === 'zip' ? 'application/zip' : 'application/pdf');
      setReportResult(r);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : String(e));
    } finally {
      setReportBusy(null);
    }
  }

  async function run(issue = false) {
    const l = label.trim() || suggested;
    if (
      issue &&
      !window.confirm(
        `Issue the report as ${l}?\n\nThe workbook is exported as revision ${l} and the project is locked: nothing can be edited or imported until someone unlocks it for follow-up.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // the workbook engine (JSZip) loads on demand; it is precached, so this also works offline
      const { exportProject, downloadBytes } = await import('../../workbook/exportProject');
      const r = await exportProject(project.id, { label: l, issue });
      downloadBytes(r.bytes, r.fileName);
      setResult(r);
      setTyped(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function download(r: Revision) {
    if (!r.bytes) return;
    const { downloadBytes } = await import('../../workbook/exportProject');
    downloadBytes(r.bytes, r.fileName);
  }

  async function switchToTemplate() {
    if (
      !window.confirm(
        'Export onto the blank template from now on? Formatting fixed in Excel is then not carried forward.',
      )
    )
      return;
    const { clearBaseWorkbook } = await import('../../workbook/revisions');
    await clearBaseWorkbook(project.id);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Export</h1>
          <p>Fills the revision 05 TAB workbook with this project's data. Runs on this device, also offline.</p>
        </div>
      </div>

      {applied !== null && (
        <div className="callout" data-tone="info" role="status" data-testid="reimport-applied">
          Re-import applied ({applied} change{applied === '1' ? '' : 's'} accepted). The workbook is now the base of the
          next export.
        </div>
      )}

      <section className="card card-pad stack" aria-labelledby="ex-h">
        <h2 id="ex-h">TAB workbook (.xlsm)</h2>
        <dl className="kv">
          <dt>Equipment</dt>
          <dd>{equipment.length} units</dd>
          <dt>Issues</dt>
          <dd>
            {issues.filter((i) => i.kind === 'new').length} new · {issues.filter((i) => i.kind === 'existing').length}{' '}
            existing
          </dd>
          <dt>Template</dt>
          <dd>Revision {project.templateRevision}</dd>
          <dt>Written into</dt>
          <dd data-testid="export-base">
            {base ? (
              <>
                {base.fileName} <span className="muted small">(re-imported {when(base.importedAt)})</span>
              </>
            ) : (
              'Blank template'
            )}
          </dd>
        </dl>
        {base && (
          <p className="small muted" style={{ margin: 0 }}>
            The previously issued workbook is the base, so formatting fixed in Excel carries forward; the app's values
            replace its input cells.{' '}
            <button type="button" className="link-btn" onClick={() => void switchToTemplate()}>
              Use the blank template instead
            </button>
          </p>
        )}
        {status && status.total.total > 0 && (
          <>
            <ProgressBar rollup={status.total} />
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <RollupCounts rollup={status.total} />
              <span className="small muted" data-testid="review-summary">
                Reviewed: {status.total.reviewed} of {status.total.total} units
                {status.total.green > status.total.reviewed
                  ? ` (${status.total.green - status.total.reviewed} complete, not reviewed)`
                  : ''}
              </span>
            </div>
          </>
        )}
        {status && status.total.total > status.total.green && (
          <div className="callout" data-tone="amber">
            {status.total.total - status.total.green} unit(s) are not complete yet. You can still export a preliminary
            workbook.
          </div>
        )}
        {smallFans > 30 && (
          <div className="callout" data-tone="amber">
            Building Balance lists small fans 1–30 only; {smallFans - 30} will be missing from the exhaust total.
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor="rev-label">
            Revision
          </label>
          <input
            id="rev-label"
            className="input"
            value={label}
            maxLength={40}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={suggested}
            data-testid="revision-label"
          />
          <span className="field-hint">Prelim, Rev 1, Final … The export is kept as this revision on this device.</span>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          onClick={() => void run()}
          disabled={busy}
          data-testid="export-xlsm"
        >
          <IconDownload size={20} /> {busy ? 'Exporting…' : `Export ${label.trim() || suggested || 'workbook'} (.xlsm)`}
        </button>
        {project.lock ? (
          <div className="callout" data-tone="info" data-testid="issued-state">
            <IconLock size={18} />
            <span className="grow">
              {issuedText(project.lock)}
              {project.lock.name ? ` by ${project.lock.name}` : ''}. The project is locked; exports still work (e.g. a
              copy), edits and imports don't.{' '}
              <button type="button" className="link-btn" data-testid="unlock-export" onClick={() => void unlock()}>
                Unlock for follow-up
              </button>
            </span>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-lg btn-block"
              onClick={() => void run(true)}
              disabled={busy}
              data-testid="issue-report"
            >
              <IconLock size={20} /> Issue report as {label.trim() || suggested}
            </button>
            <p className="small muted" style={{ margin: 0 }}>
              <b>Issue report</b> exports this revision and locks the project, so the issued data can't change by
              accident. Anyone can unlock it for follow-up work; the lock and unlock are recorded in the History.
            </p>
          </>
        )}
        {error && (
          <div className="callout" data-tone="red" role="alert">
            Export failed: {error}
          </div>
        )}
        {result && (
          <div className="callout" data-tone="info" role="status" data-testid="export-result">
            <div>
              <b>{result.fileName}</b> downloaded ({mb(result.bytes.length)}, {result.report.cellsWritten} cells written
              {result.baseFileName ? `, into ${result.baseFileName}` : ''}). Save it to the project's Dropbox folder.
              {[...result.warnings, ...result.report.warnings].length > 0 && (
                <ul className="warn-list">
                  {[...result.warnings, ...result.report.warnings].map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Only input cells are written; the workbook's formulas, macros, formatting and print setup stay as they are.
          Open it in Excel and let it recalculate.
        </p>
      </section>

      <section className="card card-pad stack" aria-labelledby="rp-h" data-testid="reports">
        <h2 id="rp-h">Photo and Issues reports (PDF)</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Made on this device, also offline. Equipment and deficiency photos are not in the workbook; they go to these
          reports. New and Existing issues go to different parties, so each can be exported alone.
        </p>
        <div className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor="rp-label">
              Report label
            </label>
            <input
              id="rp-label"
              className="input"
              value={reportLabel}
              maxLength={40}
              onChange={(e) => setReportTyped(e.target.value)}
              data-testid="report-label"
            />
            <span className="field-hint">Same as the workbook revision by default.</span>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="rp-per">
              Photos per page
            </label>
            <select
              id="rp-per"
              className="select"
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value) as PerPage)}
              data-testid="report-per-page"
            >
              <option value={2}>2 per page (large)</option>
              <option value={4}>4 per page (2 × 2)</option>
              <option value={6}>6 per page (2 × 3)</option>
            </select>
          </div>
        </div>
        <div className="field">
          <span className="field-label">Issues to include</span>
          <div className="segmented" role="group" aria-label="Issues to include">
            {(['all', 'new', 'existing'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={scope === k}
                onClick={() => setScope(k)}
                data-testid={`issue-scope-${k}`}
              >
                {k === 'all' ? 'All' : k === 'new' ? 'New only' : 'Existing only'}
              </button>
            ))}
          </div>
        </div>
        <label className="row small" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={withDeficiency}
            onChange={(e) => setWithDeficiency(e.target.checked)}
            data-testid="report-with-deficiency"
          />
          Include deficiency photos in the Photo Report
        </label>
        <div className="report-grid">
          <button
            type="button"
            className="btn"
            disabled={Boolean(reportBusy)}
            data-testid="report-photos"
            onClick={() => void makeReport({ kind: 'photos', perPage, includeDeficiency: withDeficiency })}
          >
            <IconDownload size={18} /> Photo Report
          </button>
          <button
            type="button"
            className="btn"
            disabled={Boolean(reportBusy)}
            data-testid="report-issues"
            onClick={() => void makeReport({ kind: 'issues', perPage, issueKinds: SCOPE_KINDS[scope] })}
          >
            <IconDownload size={18} /> Issues Report{scope === 'all' ? '' : scope === 'new' ? ' (New)' : ' (Existing)'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={Boolean(reportBusy)}
            data-testid="report-combined"
            onClick={() => void makeReport({ kind: 'combined', perPage, issueKinds: SCOPE_KINDS[scope] })}
          >
            <IconDownload size={18} /> Issues + Photos
            {scope === 'all' ? '' : scope === 'new' ? ' (New)' : ' (Existing)'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={Boolean(reportBusy)}
            data-testid="report-zip"
            onClick={() => void makeReport('zip')}
          >
            <IconDownload size={18} /> Photos (.zip)
          </button>
        </div>
        {reportBusy && (
          <div className="small muted" role="status" data-testid="report-busy">
            {reportBusy}
          </div>
        )}
        {reportError && (
          <div className="callout" data-tone="red" role="alert">
            Report failed: {reportError}
          </div>
        )}
        {reportResult && (
          <div className="callout" data-tone="info" role="status" data-testid="report-result">
            <div>
              <b>{reportResult.fileName}</b> downloaded ({mb(reportResult.bytes.length)}
              {reportResult.pages ? `, ${reportResult.pages} page${reportResult.pages === 1 ? '' : 's'}` : ''},{' '}
              {reportResult.photos} photo{reportResult.photos === 1 ? '' : 's'}).
            </div>
          </div>
        )}
      </section>

      <section className="card card-pad stack" aria-labelledby="im-h">
        <h2 id="im-h">Re-import the issued workbook</h2>
        <p className="small muted" style={{ margin: 0 }}>
          After the report was edited in Excel (remarks polished, readings corrected): pick the file, then accept or
          decline each changed value. A value changed both in Excel and in the app since the export is a collision you
          resolve. Photos stay as they are.
        </p>
        {locked ? (
          <p className="small muted" style={{ margin: 0 }} data-testid="reimport-locked">
            Blocked while the report is issued (locked). Unlock it for follow-up first.
          </p>
        ) : (
          <Link to={`/import?into=${project.id}`} className="btn" data-testid="reimport-link">
            <IconUpload size={18} /> Re-import workbook
          </Link>
        )}
      </section>

      <section className="card card-pad stack" aria-labelledby="rev-h" data-testid="revisions">
        <h2 id="rev-h">Revisions</h2>
        {!revisions?.length ? (
          <p className="small muted" style={{ margin: 0 }}>
            No export yet. Each export is kept here as a revision.
          </p>
        ) : (
          <ul className="rev-list">
            {revisions.map((r) => (
              <li key={r.id} className="rev-item" data-testid="revision" data-kind={r.kind}>
                <div className="rev-main">
                  <div className="rev-title">
                    <b>{r.label}</b>
                    <span className="chip" data-kind={r.kind}>
                      {r.kind === 'export' ? 'Exported' : 'Imported'}
                    </span>
                    {r.issued && (
                      <span className="chip chip-issued" data-testid="revision-issued">
                        <IconLock size={12} /> Issued
                      </span>
                    )}
                    {base && r.id === revisions.find((x) => x.kind === 'import')?.id && (
                      <span className="chip" data-kind="export" title="The next export is written into this file">
                        Base
                      </span>
                    )}
                  </div>
                  <div className="small muted">
                    {when(r.createdAt)} · {mb(r.size)}
                    {r.kind === 'export' && r.onBase ? ' · into the issued workbook' : ''}
                    {r.kind === 'import' && r.applied
                      ? ` · ${r.applied.accepted} accepted, ${r.applied.declined} declined${r.applied.collisions ? `, ${r.applied.collisions} collision${r.applied.collisions === 1 ? '' : 's'}` : ''}`
                      : ''}
                  </div>
                  <div className="small rev-file">{r.fileName}</div>
                </div>
                {r.bytes ? (
                  <button
                    type="button"
                    className="icon-btn rev-dl"
                    onClick={() => void download(r)}
                    aria-label={`Download ${r.label}`}
                    title="Download"
                  >
                    <IconDownload size={20} />
                  </button>
                ) : (
                  <span className="small muted rev-nofile">{r.kind === 'export' ? 'file not kept' : ''}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          On this device the newest {KEEP_REVISION_FILES} exports keep their file (about 4 MB each) for re-download;
          older ones keep their values only, which is all a re-import needs. The copy you saved to Dropbox is the
          record.
        </p>
      </section>
    </>
  );
}
