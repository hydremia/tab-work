/**
 * The shared pump-curve library on /library (data/types.ts LibraryPump): pump models with their published head /
 * flow curve per impeller, entered once from the manufacturer's curve sheet and picked on a pump, where the shut-off
 * head gives the impeller and the final head the flow (domain/pumpCurves.ts). Only published data: every entry
 * names its curve sheet.
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import { useLibraryPumps } from '../../data/hooks';
import { addLibraryPump, deleteLibraryPump, setField } from '../../data/repo';
import type { LibraryPump } from '../../data/types';
import { formatCurvePoints, parseCurvePoints, pumpName } from '../../domain/pumpCurves';
import { IconPlus, IconTrash } from './Icons';
import { NumberInput, TextArea, TextInput } from './inputs';

type Curves = NonNullable<LibraryPump['curves']>;

function CurveEditor({ p, idp }: { p: LibraryPump; idp: string }) {
  const curves: Curves = p.curves ?? [];
  const [texts, setTexts] = useState(() => curves.map((c) => formatCurvePoints(c.points)));
  const save = (next: Curves) => void setField('libraryPumps', p.id, 'curves', next.length ? next : null);
  return (
    <div className="stack" style={{ gap: 8 }}>
      {curves.map((c, i) => (
        <div className="pump-curve-edit" key={i} data-testid="pump-curve">
          <div className="field">
            <label className="field-label" htmlFor={`${idp}-imp-${i}`}>
              Impeller
            </label>
            <NumberInput
              id={`${idp}-imp-${i}`}
              unit="in."
              value={c.impeller}
              onCommit={(x) => save(curves.map((y, k) => (k === i ? { ...y, impeller: x ?? 0 } : y)))}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${idp}-pts-${i}`}>
              Points (GPM ft)
            </label>
            <textarea
              id={`${idp}-pts-${i}`}
              className="textarea"
              rows={5}
              value={texts[i] ?? ''}
              placeholder={'0 80\n100 76\n200 68\n…'}
              onChange={(e) => setTexts((t) => t.map((x, k) => (k === i ? e.target.value : x)))}
              onBlur={() => {
                const pts = parseCurvePoints(texts[i] ?? '');
                setTexts((t) => t.map((x, k) => (k === i ? formatCurvePoints(pts) : x)));
                save(curves.map((y, k) => (k === i ? { ...y, points: pts } : y)));
              }}
            />
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={`Remove the ${c.impeller}″ curve`}
            onClick={() => {
              setTexts((t) => t.filter((_, k) => k !== i));
              save(curves.filter((_, k) => k !== i));
            }}
          >
            <IconTrash size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ alignSelf: 'flex-start' }}
        data-testid="add-pump-curve"
        onClick={() => {
          setTexts((t) => [...t, '']);
          save([...curves, { impeller: 0, points: [] }]);
        }}
      >
        <IconPlus size={16} /> Add impeller curve
      </button>
      <span className="field-hint">
        One curve per impeller diameter, read off the manufacturer&apos;s curve at the catalogue speed: one line per
        point, <i>GPM head (ft)</i>, starting at shut-off (0 GPM). The app interpolates between points and impellers and
        never extrapolates.
      </span>
    </div>
  );
}

function PumpItem({ p, used }: { p: LibraryPump; used: number }) {
  const [startOpen] = useState(!p.make);
  const name = pumpName(p) || 'New pump';
  const set = (k: keyof LibraryPump, x: unknown) => void setField('libraryPumps', p.id, k, x);
  const idp = `lp-${p.id}`;
  const curves = (p.curves ?? []).filter((c) => c.points.length >= 2);
  return (
    <details className="lib-item" data-testid="pump-lib-item" open={startOpen || undefined}>
      <summary className="lib-summary">
        <span className="lib-summary-text">
          <b>{name}</b>
          <span className="small muted">
            {[
              curves.length
                ? `${curves.length} impeller${curves.length > 1 ? 's' : ''} (${curves.map((c) => `${c.impeller}″`).join(', ')})`
                : '',
              p.rpm ? `${p.rpm} rpm` : '',
              p.source && `from ${p.source}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span className="small muted">{used ? `On ${used} pump${used > 1 ? 's' : ''}` : 'Not used yet'}</span>
          {!curves.length && (
            <span className="lib-summary-chips">
              <span className="chip chip-warn">No curves</span>
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
              <TextInput id={`${idp}-${k}`} value={p[k]} onCommit={(x) => set(k, x)} />
            </div>
          ))}
          <div className="field">
            <label className="field-label" htmlFor={`${idp}-rpm`}>
              Curve speed
            </label>
            <NumberInput id={`${idp}-rpm`} unit="rpm" value={p.rpm} onCommit={(x) => set('rpm', x)} />
          </div>
        </div>
        <CurveEditor p={p} idp={idp} />
        <div className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor={`${idp}-src`}>
              Curve sheet
            </label>
            <TextInput
              id={`${idp}-src`}
              value={p.source}
              placeholder="e.g. B&G e-1510 curve booklet, 2024"
              onCommit={(x) => set('source', x)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${idp}-notes`}>
              Notes
            </label>
            <TextArea id={`${idp}-notes`} value={p.notes} onCommit={(x) => set('notes', x)} />
          </div>
        </div>
        <button
          type="button"
          className="btn btn-danger"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            if (window.confirm(`Remove "${name}" from the pump library? Pumps keep their readings.`))
              void deleteLibraryPump(p.id);
          }}
        >
          <IconTrash size={16} /> Remove
        </button>
      </div>
    </details>
  );
}

export function PumpLibrary() {
  const pumps = useLibraryPumps();
  const usage = useLiveQuery(async () => {
    const m = new Map<string, number>();
    for (const e of await db.equipment.filter((x) => x.type === 'pump').toArray()) {
      const id = e.data.pumpCurveId;
      if (typeof id === 'string') m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, []);
  return (
    <section className="card card-pad stack" aria-labelledby="plib-h" data-testid="pump-library">
      <h2 id="plib-h">Pump curve library</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Pump curves from the manufacturers&apos; curve sheets (B&amp;G, Armstrong, Taco, Grundfos …), added as pumps
        turn up on jobs. Pick one on a pump and the app estimates the impeller from the shut-off head and the flow from
        the final head. Enter published curves only, and name the curve sheet. Shared with the team when you are signed
        in.
      </p>
      {pumps && !pumps.length && <span className="muted">No pumps yet.</span>}
      {(pumps ?? []).map((p) => (
        <PumpItem key={p.id} p={p} used={usage?.get(p.id) ?? 0} />
      ))}
      <button type="button" className="btn btn-ghost" onClick={() => void addLibraryPump()} data-testid="add-lib-pump">
        <IconPlus size={18} /> Add pump
      </button>
    </section>
  );
}
