/**
 * Export tab: the hydronic workbook (H01), shown when the project has hydronic units (pumps, valve systems, plant,
 * flow readings). It writes the blank hydronic template every time (no base workbook, no revision, no re-import yet);
 * the issue / lock workflow stays on the airside workbook card.
 */
import { useState } from 'react';
import type { Equipment, Project } from '../../data/types';
import { equipmentType } from '../../domain/equipmentTypes';
import type { HydronicExportResult } from '../../workbook/exportProject';
import { IconDownload } from './Icons';
import { ShareFile } from './ShareFile';

const XLSM_MIME = 'application/vnd.ms-excel.sheet.macroEnabled.12';
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function HydronicExport({
  project,
  equipment,
  label,
}: {
  project: Project;
  equipment: Equipment[];
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HydronicExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const units = equipment.filter((e) => equipmentType(e.type).discipline === 'hydronic');
  if (!units.length) return null;
  const count = (t: string) => units.filter((e) => e.type === t).length;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const { exportHydronic, downloadBytes } = await import('../../workbook/exportProject');
      const r = await exportHydronic(project.id, { label });
      downloadBytes(r.bytes, r.fileName);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card card-pad stack" aria-labelledby="hx-h" data-testid="hydronic-export">
      <h2 id="hx-h">Hydronic workbook (.xlsm)</h2>
      <p className="small muted" style={{ margin: 0 }}>
        {count('pump')} pump(s), {count('valveSystem')} valve system(s), {count('plant')} plant unit(s),{' '}
        {count('flowMeasurement')} flow reading(s), with the shared project information, remarks, calibration and
        certification pages. A separate report from the airside workbook above.
      </p>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={() => void run()}
        data-testid="export-hydronic"
      >
        <IconDownload size={18} /> {busy ? 'Exporting…' : 'Export hydronic workbook'}
      </button>
      {error && (
        <div className="callout" data-tone="red" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div className="callout" data-tone="info" role="status" data-testid="hydronic-export-result">
          <div className="grow">
            <b>{result.fileName}</b> downloaded ({mb(result.bytes.length)}). Save it to the project&apos;s Dropbox
            folder.
            {result.warnings.length > 0 && (
              <ul className="warn-list">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <ShareFile
              bytes={result.bytes}
              fileName={result.fileName}
              mime={XLSM_MIME}
              testId="share-hydronic"
              onDownload={() =>
                void import('../../workbook/exportProject').then(({ downloadBytes }) =>
                  downloadBytes(result.bytes, result.fileName),
                )
              }
            />
          </div>
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        Written into the blank hydronic template each time; only input cells are written, Excel recalculates the rest.
      </p>
    </section>
  );
}
