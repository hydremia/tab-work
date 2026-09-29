/**
 * The shared balancing-valve library on /library (data/types.ts LibraryValve): valve models entered once from the
 * manufacturer's data sheet and picked on a valve row, where a setting and a ΔP give the flow (domain/valves.ts).
 * Only published data: every entry names its data sheet.
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import { useLibraryValves } from '../../data/hooks';
import { addLibraryValve, deleteLibraryValve, setField } from '../../data/repo';
import type { LibraryValve } from '../../data/types';
import { formatCvTable, parseCvTable, valveName } from '../../domain/valves';
import { IconPlus, IconTrash } from './Icons';
import { NumberInput, SelectInput, TextArea, TextInput } from './inputs';

const TYPES: Record<string, string> = {
  F: 'F — fixed orifice',
  A: 'A — adjustable orifice',
  S: 'S — self-adjusting (auto-flow / PICV)',
};

function ValveItem({ v, used }: { v: LibraryValve; used: number }) {
  const [cvText, setCvText] = useState(formatCvTable(v.cvTable));
  // a new (empty) valve opens for editing and stays open while it is filled in
  const [startOpen] = useState(!v.make);
  const name = valveName(v) || 'New valve';
  const set = (k: keyof LibraryValve, x: unknown) => void setField('libraryValves', v.id, k, x);
  const idp = `lv-${v.id}`;
  const missingData = v.valveType === 'S' ? v.ratedGpm === null : !(v.cvTable ?? []).length;
  return (
    <details className="lib-item" data-testid="valve-lib-item" open={startOpen || undefined}>
      <summary className="lib-summary">
        <span className="lib-summary-text">
          <b>{name}</b>
          <span className="small muted">
            {[TYPES[v.valveType] ?? 'type not set', v.source && `from ${v.source}`].filter(Boolean).join(' · ')}
          </span>
          <span className="small muted">{used ? `On ${used} valve row${used > 1 ? 's' : ''}` : 'Not used yet'}</span>
          {missingData && (
            <span className="lib-summary-chips">
              <span className="chip chip-warn">{v.valveType === 'S' ? 'No tag flow' : 'No Cv table'}</span>
            </span>
          )}
        </span>
      </summary>
      <div className="stack" style={{ gap: 12, paddingTop: 8 }}>
        <div className="form-grid">
          {(['make', 'model', 'size'] as const).map((k) => (
            <div className="field" key={k}>
              <label className="field-label" htmlFor={`${idp}-${k}`}>
                {k === 'make' ? 'Make' : k === 'model' ? 'Model' : 'Size'}
              </label>
              <TextInput id={`${idp}-${k}`} value={v[k]} onCommit={(x) => set(k, x)} />
            </div>
          ))}
          <div className="field">
            <label className="field-label" htmlFor={`${idp}-type`}>
              Type
            </label>
            <SelectInput
              id={`${idp}-type`}
              value={v.valveType || null}
              options={['F', 'A', 'S']}
              onCommit={(x) => set('valveType', x ?? '')}
            />
            {v.valveType && <span className="field-hint">{TYPES[v.valveType]}</span>}
          </div>
          {v.valveType !== 'S' && (
            <div className="field">
              <label className="field-label" htmlFor={`${idp}-cv`}>
                Cv table
              </label>
              <textarea
                id={`${idp}-cv`}
                className="textarea"
                rows={5}
                value={cvText}
                placeholder={'setting  Cv\n0.5  0.8\n1.0  1.4\n…'}
                onChange={(e) => setCvText(e.target.value)}
                onBlur={() => {
                  const t = parseCvTable(cvText);
                  set('cvTable', t.length ? t : null);
                  setCvText(formatCvTable(t));
                }}
              />
              <span className="field-hint">
                One line per setting: <i>setting Cv</i> (GPM at 1 psi). A fixed orifice: just its Cv. From the
                manufacturer&apos;s table; the app interpolates between settings and never extrapolates.
              </span>
            </div>
          )}
          {v.valveType === 'S' && (
            <>
              <div className="field">
                <label className="field-label" htmlFor={`${idp}-rated`}>
                  Tag flow
                </label>
                <NumberInput id={`${idp}-rated`} unit="GPM" value={v.ratedGpm} onCommit={(x) => set('ratedGpm', x)} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${idp}-dpmin`}>
                  Control range min
                </label>
                <NumberInput id={`${idp}-dpmin`} unit="psi" value={v.dpMin} onCommit={(x) => set('dpMin', x)} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${idp}-dpmax`}>
                  Control range max
                </label>
                <NumberInput id={`${idp}-dpmax`} unit="psi" value={v.dpMax} onCommit={(x) => set('dpMax', x)} />
              </div>
            </>
          )}
          <div className="field">
            <label className="field-label" htmlFor={`${idp}-src`}>
              Data sheet
            </label>
            <TextInput
              id={`${idp}-src`}
              value={v.source}
              placeholder="e.g. B&G Circuit Setter CB data, 2024"
              onCommit={(x) => set('source', x)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${idp}-notes`}>
              Notes
            </label>
            <TextArea id={`${idp}-notes`} value={v.notes} onCommit={(x) => set('notes', x)} />
          </div>
        </div>
        <button
          type="button"
          className="btn btn-danger"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            if (window.confirm(`Remove "${name}" from the valve library? Valve rows keep what they show.`))
              void deleteLibraryValve(v.id);
          }}
        >
          <IconTrash size={16} /> Remove
        </button>
      </div>
    </details>
  );
}

export function ValveLibrary() {
  const valves = useLibraryValves();
  const usage = useLiveQuery(async () => {
    const m = new Map<string, number>();
    for (const r of await db.airflowRows.filter((x) => x.table === 'valves').toArray()) {
      const id = r.data.valveId;
      if (typeof id === 'string') m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, []);
  return (
    <section className="card card-pad stack" aria-labelledby="vlib-h" data-testid="valve-library">
      <h2 id="vlib-h">Balancing valve library</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Valve models from the manufacturers&apos; data sheets (FDI, FlowCon, B&amp;G, Armstrong, Nexus …), added as they
        turn up on jobs. Pick one on a valve row and the app turns the setting and ΔP into a flow. Enter published data
        only, and name the data sheet. Shared with the team when you are signed in.
      </p>
      {valves && !valves.length && <span className="muted">No valves yet.</span>}
      {(valves ?? []).map((v) => (
        <ValveItem key={v.id} v={v} used={usage?.get(v.id) ?? 0} />
      ))}
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => void addLibraryValve()}
        data-testid="add-lib-valve"
      >
        <IconPlus size={18} /> Add valve
      </button>
    </section>
  );
}
