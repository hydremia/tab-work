/**
 * /check: the report check on a workbook file, without importing it: another tech's or firm's TAB report (airside
 * revision 05 layout) is read in memory and checked with the same rules as a project on the Export tab. Nothing is
 * saved. Photos are not in a workbook, so unit completeness and photo items are left out.
 */
import { useState } from 'react';
import { needsAttention } from '../../domain/attention';
import { computeCompletion } from '../../domain/completion';
import { reviewProject, type ReviewResult } from '../../domain/review';
import { getSpec } from '../../domain/specs';
import { ReportCheck } from '../components/ReportCheck';
import { Screen } from '../components/Screen';
import { hoodLinks } from '../../domain/equipmentCalcs';
import { openDeficiencies } from '../../domain/issues';

export function CheckWorkbookPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; units: number; review: ReviewResult } | null>(null);

  async function check(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { readWorkbookFile, parseWorkbook } = await import('../../workbook/importProject');
      const parsed = await parseWorkbook(await readWorkbookFile(file), file.name);
      const b = parsed.bundle;
      const linked = hoodLinks(b.equipment);
      const completions = new Map(
        b.equipment.map((e) => [
          e.id,
          computeCompletion({
            spec: getSpec(e.type),
            unit: e,
            rows: b.rows.filter((r) => r.equipmentId === e.id),
            photos: [],
            project: b.project,
            openIssues: openDeficiencies(b.issues.filter((i) => i.equipmentId === e.id)).length,
            hoodLinked: linked.has(e.id),
          }),
        ]),
      );
      const attention = needsAttention({ ...b, photos: [], completions });
      const review = reviewProject({ ...b, completions, attention, fromFile: true });
      setResult({ name: b.project.name || file.name, units: b.equipment.length, review });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Check a workbook" back="/">
      <section className="card card-pad stack">
        <p className="small muted" style={{ margin: 0 }}>
          Run the report check on a TAB workbook (.xlsm, the a2b revision 05 layout) without importing it: another
          tech&apos;s report before it goes out, or a report to review. Nothing is saved on this device.
        </p>
        <label className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
          {busy ? 'Checking…' : 'Choose workbook…'}
          <input
            type="file"
            accept=".xlsm,.xlsx"
            aria-label="Workbook to check"
            hidden
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void check(f);
            }}
          />
        </label>
        {error && (
          <div className="callout" data-tone="red" role="alert">
            {error}
          </div>
        )}
        {result && (
          <p className="small" style={{ margin: 0 }} data-testid="check-file-name">
            <b>{result.name}</b> · {result.units} units read. Links are not active here (the file is not a project on
            this device).
          </p>
        )}
      </section>
      {result && <ReportCheck result={result.review} />}
    </Screen>
  );
}
