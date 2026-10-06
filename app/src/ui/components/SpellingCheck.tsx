/**
 * Spelling over the text that prints (domain/spelling.ts), on request: the Hunspell en-US dictionary (public/spell,
 * precached, so it works offline) loads on the first check. Each word links to where it is typed, with suggestions;
 * "Ignore" adds it to the project's word list (info.spellIgnore, synced with the project).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { db } from '../../data/db';
import { setField } from '../../data/repo';
import type { Equipment, Issue, Project } from '../../data/types';
import { checkSpelling, withIgnored } from '../../domain/spelling';

interface Speller {
  correct(word: string): boolean;
  suggest(word: string): string[];
}

let loading: Promise<Speller> | null = null;
function loadSpeller(): Promise<Speller> {
  loading ??= (async () => {
    const [{ default: nspell }, aff, dic] = await Promise.all([
      import('nspell'),
      fetch('/spell/en.aff').then((r) => (r.ok ? r.text() : Promise.reject(new Error(`dictionary: ${r.status}`)))),
      fetch('/spell/en.dic').then((r) => (r.ok ? r.text() : Promise.reject(new Error(`dictionary: ${r.status}`)))),
    ]);
    return nspell({ aff, dic });
  })().catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

export function SpellingCheck({
  project,
  equipment,
  issues,
  locked,
}: {
  project: Project;
  equipment: Equipment[];
  issues: Issue[];
  locked: boolean;
}) {
  const rows = useLiveQuery(() => db.airflowRows.where('projectId').equals(project.id).toArray(), [project.id]);
  const [speller, setSpeller] = useState<Speller | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const findings = useMemo(
    () =>
      speller && rows
        ? checkSpelling({ project, equipment, rows, issues }, (w) => speller.correct(w)).map((f) => ({
            ...f,
            suggestions: speller.suggest(f.word).slice(0, 3),
          }))
        : null,
    [speller, rows, project, equipment, issues],
  );
  const base = `/p/${project.id}`;
  const link = (to: string) => `${base}/${to}`;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setSpeller(await loadSpeller());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card card-pad stack" aria-labelledby="sp-h" data-testid="spelling-check">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h2 id="sp-h" style={{ margin: 0 }}>
          Spelling
        </h2>
        {findings && (
          <span className="small" data-testid="spelling-summary">
            {findings.length ? `${findings.length} word${findings.length === 1 ? '' : 's'} to check` : 'Nothing found'}
          </span>
        )}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        The text that prints: narrative, Building Balance notes, unit remarks, areas served, locations, airflow lines
        and issues. Acronyms, tags and trade words are skipped.
      </p>
      {!speller && (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn" disabled={busy} onClick={() => void run()} data-testid="spelling-run">
            {busy ? 'Loading the dictionary…' : 'Check spelling'}
          </button>
        </div>
      )}
      {error && (
        <p className="small" style={{ color: 'var(--red)', margin: 0 }}>
          The dictionary did not load ({error}). Open the app once online so it is cached.
        </p>
      )}
      {findings && findings.length > 0 && (
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {findings.map((f) => (
            <li key={f.word.toLowerCase()} data-testid={`spelling-${f.word.toLowerCase()}`}>
              <b>{f.word}</b>
              {f.suggestions.length > 0 && <> → {f.suggestions.join(', ')}</>}
              {' · '}
              {f.places.map((p, i) => (
                <span key={`${p.to}-${p.label}`}>
                  {i ? ', ' : ''}
                  <Link to={link(p.to)}>{p.label}</Link>
                </span>
              ))}
              {!locked && (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      void setField('projects', project.id, 'info.spellIgnore', withIgnored(project.info, f.word))
                    }
                  >
                    Ignore
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
