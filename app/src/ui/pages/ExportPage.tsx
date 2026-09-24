import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useBaseWorkbook, useRevisions } from '../../data/hooks';
import type { Revision } from '../../data/types';
import type { ExportResult } from '../../workbook/exportProject';
import { KEEP_REVISION_FILES, suggestLabel } from '../../workbook/revisions';
import { IconDownload, IconUpload } from '../components/Icons';
import { ProgressBar, RollupCounts } from '../components/Status';
import { useProjectContext } from './ProjectLayout';

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function ExportPage() {
  const { project, equipment, issues, status } = useProjectContext();
  const revisions = useRevisions(project.id);
  const base = useBaseWorkbook(project.id);
  const [params] = useSearchParams();
  const applied = params.get('applied');
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const smallFans = equipment.filter((e) => e.type === 'smallFan').length;
  const suggested = revisions ? suggestLabel(revisions) : '';
  const label = typed ?? suggested;

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // the workbook engine (JSZip) loads on demand; it is precached, so this also works offline
      const { exportProject, downloadBytes } = await import('../../workbook/exportProject');
      const r = await exportProject(project.id, { label: label.trim() || suggested });
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
            <RollupCounts rollup={status.total} />
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

      <section className="card card-pad stack" aria-labelledby="im-h">
        <h2 id="im-h">Re-import the issued workbook</h2>
        <p className="small muted" style={{ margin: 0 }}>
          After the report was edited in Excel (remarks polished, readings corrected): pick the file, then accept or
          decline each changed value. A value changed both in Excel and in the app since the export is a collision you
          resolve. Photos stay as they are.
        </p>
        <Link to={`/import?into=${project.id}`} className="btn" data-testid="reimport-link">
          <IconUpload size={18} /> Re-import workbook
        </Link>
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
