import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { createProject } from '../../data/repo';
import type { ScopeProfile } from '../../data/types';
import { Screen } from '../components/Screen';

export const SCOPE_OPTIONS: { value: ScopeProfile; label: string; hint: string }[] = [
  { value: 'full', label: 'Full TAB', hint: 'Everything required' },
  { value: 'airflow', label: 'Airflow Only', hint: 'Identity, design CFM, airflow readings, instrument' },
  { value: 'custom', label: 'Custom', hint: 'Turn sections on or off per equipment type' },
];

export function NewProjectPage() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [tabDate, setTabDate] = useState('');
  const [scope, setScope] = useState<ScopeProfile>('full');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const p = await createProject({ name, address, tabDate, scopeProfile: scope });
    nav(`/p/${p.id}/info`, { replace: true });
  }

  return (
    <Screen title="New project" back="/">
      <form className="card card-pad stack" onSubmit={submit}>
        <div className="field">
          <label className="field-label" htmlFor="np-name">
            Project name<span className="req">*</span>
          </label>
          <input
            id="np-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="np-address">
            Physical address
          </label>
          <input
            id="np-address"
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoComplete="street-address"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="np-date">
            TAB date
          </label>
          <input
            id="np-date"
            className="input"
            type="date"
            value={tabDate}
            onChange={(e) => setTabDate(e.target.value)}
          />
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label" style={{ marginBottom: 6 }}>
            Scope profile
          </legend>
          <div className="stack" style={{ gap: 8 }}>
            {SCOPE_OPTIONS.map((o) => (
              <button
                type="button"
                key={o.value}
                className="type-option"
                aria-pressed={scope === o.value}
                onClick={() => setScope(o.value)}
              >
                <b>{o.label}</b>
                <small>{o.hint}</small>
              </button>
            ))}
          </div>
        </fieldset>
        <button className="btn btn-primary btn-lg" type="submit" disabled={busy || !name.trim()}>
          Create project
        </button>
      </form>
    </Screen>
  );
}
