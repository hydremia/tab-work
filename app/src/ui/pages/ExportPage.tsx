import { useState } from 'react';
import { Link } from 'react-router';
import type { ExportResult } from '../../workbook/exportProject';
import { IconDownload, IconUpload } from '../components/Icons';
import { ProgressBar, RollupCounts } from '../components/Status';
import { useProjectContext } from './ProjectLayout';

export function ExportPage() {
  const { project, equipment, issues, status } = useProjectContext();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const smallFans = equipment.filter((e) => e.type === 'smallFan').length;

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // the workbook engine (JSZip) loads on demand; it is precached, so this also works offline
      const { exportProject, downloadBytes } = await import('../../workbook/exportProject');
      const r = await exportProject(project.id);
      downloadBytes(r.bytes, r.fileName);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Export</h1>
          <p>Fills the revision 05 TAB workbook with this project's data. Runs on this device, also offline.</p>
        </div>
      </div>

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
        </dl>
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
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          onClick={() => void run()}
          disabled={busy}
          data-testid="export-xlsm"
        >
          <IconDownload size={20} /> {busy ? 'Exporting…' : 'Export TAB workbook (.xlsm)'}
        </button>
        {error && (
          <div className="callout" data-tone="red" role="alert">
            Export failed: {error}
          </div>
        )}
        {result && (
          <div className="callout" data-tone="info" role="status" data-testid="export-result">
            <div>
              <b>{result.fileName}</b> downloaded ({(result.bytes.length / 1024 / 1024).toFixed(1)} MB,{' '}
              {result.report.cellsWritten} cells written). Save it to the project's Dropbox folder.
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
          Only input cells are written; the workbook's formulas, macros, formatting and print setup stay as in the
          template. Open it in Excel and let it recalculate.
        </p>
      </section>

      <section className="card card-pad stack" aria-labelledby="im-h">
        <h2 id="im-h">Import a workbook</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Read a filled or issued revision 05 workbook back into this project. Changed values are applied field by field
          (the full accept / decline review is coming in Phase 3).
        </p>
        <Link to={`/import?into=${project.id}`} className="btn">
          <IconUpload size={18} /> Import workbook into this project
        </Link>
      </section>
    </>
  );
}
