import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useProject } from '../../data/hooks';
import { EQUIPMENT_TYPES } from '../../domain/equipmentTypes';
import type { ParsedImport } from '../../workbook/importProject';

const engine = () => import('../../workbook/importProject');
import { IconFile } from '../components/Icons';
import { Screen } from '../components/Screen';

export function ImportPage() {
  const [params] = useSearchParams();
  const intoId = params.get('into') ?? undefined;
  const into = useProject(intoId);
  const nav = useNavigate();
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File) {
    setBusy(true);
    setError(null);
    setParsed(null);
    try {
      setParsed(await (await engine()).parseWorkbook(new Uint8Array(await file.arrayBuffer()), file.name));
    } catch (e) {
      setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function createNew() {
    if (!parsed) return;
    setBusy(true);
    const id = await (await engine()).saveAsNewProject(parsed.bundle);
    nav(`/p/${id}/equipment`, { replace: true });
  }
  async function update() {
    if (!parsed || !into) return;
    setBusy(true);
    const s = await (await engine()).updateProjectFromImport(into.id, parsed.bundle);
    window.alert(
      `Updated: ${s.fieldsChanged} field changes, ${s.equipmentAdded} units added, ${s.issuesAdded} issues added.`,
    );
    nav(`/p/${into.id}/equipment`, { replace: true });
  }

  const b = parsed?.bundle;
  return (
    <Screen
      title="Import workbook"
      subtitle={into ? `into ${into.name}` : undefined}
      back={into ? `/p/${into.id}/export` : '/'}
    >
      <section className="card card-pad stack">
        <h2>Pick a TAB workbook</h2>
        <p className="small muted" style={{ margin: 0 }}>
          A revision 05 workbook (.xlsm) exported by this app or filled in by hand. On a phone, pick it from Files /
          Dropbox.
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

      {b && parsed && (
        <section className="card card-pad stack" aria-labelledby="imp-h" data-testid="import-summary">
          <h2 id="imp-h">{b.project.name}</h2>
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
          <div className="row">
            {into ? (
              <button className="btn btn-primary btn-lg" onClick={() => void update()} disabled={busy}>
                Update {into.name}
              </button>
            ) : (
              <button
                className="btn btn-primary btn-lg"
                onClick={() => void createNew()}
                disabled={busy}
                data-testid="import-create"
              >
                Create project
              </button>
            )}
          </div>
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
