/**
 * The shared unit configuration library on /library (data/types.ts LibraryUnit): per product line, the supply-air
 * component order the static pressure profile follows, how that order is known, and the line's manuals, product
 * data, submittals and drawings. Matched to units by make and model pattern (domain/unitLibrary.ts); the unit page
 * shows the match (UnitLibraryMatch). Starts from the researched product lines (domain/unitLibrarySeed.ts).
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { db } from '../../data/db';
import { useLibraryUnits } from '../../data/hooks';
import { addLibraryUnit, deleteLibraryUnit, setField } from '../../data/repo';
import type {
  Equipment,
  LibraryConfidence,
  LibraryUnit,
  UnitComponent,
  UnitComponentKind,
  UnitDocument,
} from '../../data/types';
import {
  COMPONENT_KINDS,
  COMPONENT_LABEL,
  compareWithTemplate,
  matchLibraryUnit,
  orderText,
} from '../../domain/unitLibrary';
import { UNIT_LIBRARY_SEED } from '../../domain/unitLibrarySeed';
import { IconPlus, IconTrash } from './Icons';
import { TextArea, TextInput } from './inputs';

const UNIT_TYPES = ['RTU', 'DOAS', 'DHU', 'MAU', 'ERV', 'EF'];
const CONFIDENCE: Record<LibraryConfidence, string> = {
  stated: 'Stated by the manufacturer',
  inferred: 'Inferred from the documents',
  unconfirmed: 'Not confirmed',
};
const DOC_KINDS: Record<UnitDocument['kind'], string> = {
  manual: 'Manual',
  productData: 'Product data',
  submittal: 'Submittal',
  drawing: 'Drawing',
  other: 'Other',
};

export function ConfidenceChip({ c }: { c: LibraryConfidence }) {
  return (
    <span className={c === 'stated' ? 'chip' : 'chip chip-warn'} title={CONFIDENCE[c]} data-testid={`confidence-${c}`}>
      {c === 'stated' ? 'Stated' : c === 'inferred' ? 'Inferred' : 'Not confirmed'}
    </span>
  );
}

/** A document as a line: title (a link when it has an address), kind, reference. */
export function DocumentLine({ d }: { d: UnitDocument }) {
  const meta = [DOC_KINDS[d.kind], d.ref].filter(Boolean).join(' · ');
  return (
    <span>
      {d.url ? (
        <a href={d.url} target="_blank" rel="noopener noreferrer">
          {d.title}
        </a>
      ) : (
        d.title
      )}
      {meta && <span className="small muted"> · {meta}</span>}
    </span>
  );
}

function OrderEditor({ u, idp }: { u: LibraryUnit; idp: string }) {
  const list: UnitComponent[] = u.components ?? [];
  const save = (next: UnitComponent[]) => void setField('libraryUnits', u.id, 'components', next.length ? next : null);
  const move = (i: number, d: -1 | 1) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    save(next);
  };
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="unit-order">
      <span className="field-label">Supply-air order (inlet to discharge)</span>
      {list.map((c, i) => (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }} key={`${i}-${c.kind}`}>
          <span className="small muted" style={{ width: 18 }}>
            {i + 1}
          </span>
          <select
            className="select"
            aria-label={`Component ${i + 1}`}
            value={c.kind}
            style={{ width: 'auto' }}
            onChange={(e) =>
              save(list.map((x, k) => (k === i ? { ...x, kind: e.target.value as UnitComponentKind } : x)))
            }
          >
            {COMPONENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {COMPONENT_LABEL[k]}
              </option>
            ))}
          </select>
          <span style={{ flex: '1 1 160px' }}>
            <TextInput
              id={`${idp}-lbl-${i}`}
              aria-label={`Component ${i + 1} label`}
              placeholder="Label (optional)"
              value={c.label ?? ''}
              onCommit={(x) =>
                save(
                  list.map((y, k) =>
                    k === i
                      ? {
                          kind: y.kind,
                          ...(x.trim() ? { label: x.trim() } : {}),
                          ...(y.optional ? { optional: true } : {}),
                        }
                      : y,
                  ),
                )
              }
            />
          </span>
          <label className="small" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={Boolean(c.optional)}
              onChange={(e) =>
                save(
                  list.map((y, k) =>
                    k === i
                      ? {
                          kind: y.kind,
                          ...(y.label ? { label: y.label } : {}),
                          ...(e.target.checked ? { optional: true } : {}),
                        }
                      : y,
                  ),
                )
              }
            />
            option
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Move up"
            disabled={i === 0}
            onClick={() => move(i, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Move down"
            disabled={i === list.length - 1}
            onClick={() => move(i, 1)}
          >
            ↓
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={`Remove component ${i + 1}`}
            onClick={() => save(list.filter((_, k) => k !== i))}
          >
            <IconTrash size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => save([...list, { kind: 'filter' }])}
      >
        <IconPlus size={16} /> Add component
      </button>
    </div>
  );
}

function DocumentsEditor({ u, idp }: { u: LibraryUnit; idp: string }) {
  const docs = u.documents ?? [];
  const save = (next: UnitDocument[]) => void setField('libraryUnits', u.id, 'documents', next.length ? next : null);
  const [draft, setDraft] = useState<UnitDocument>({ title: '', kind: 'manual' });
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="unit-docs">
      <span className="field-label">Documents</span>
      {docs.length === 0 && <span className="small muted">None yet.</span>}
      {docs.map((d, i) => (
        <div className="row" style={{ gap: 6, alignItems: 'baseline' }} key={`${i}-${d.title}`}>
          <span style={{ flex: 1 }}>
            <DocumentLine d={d} />
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={`Remove ${d.title}`}
            onClick={() => save(docs.filter((_, k) => k !== i))}
          >
            <IconTrash size={16} />
          </button>
        </div>
      ))}
      <div className="form-grid">
        <div className="field">
          <label className="field-label" htmlFor={`${idp}-dt`}>
            Title
          </label>
          <input
            id={`${idp}-dt`}
            className="input"
            value={draft.title}
            placeholder="e.g. 48GE installation instructions"
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${idp}-dk`}>
            Kind
          </label>
          <select
            id={`${idp}-dk`}
            className="select"
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as UnitDocument['kind'] })}
          >
            {Object.entries(DOC_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${idp}-dr`}>
            Form / revision
          </label>
          <input
            id={`${idp}-dr`}
            className="input"
            value={draft.ref ?? ''}
            onChange={(e) => setDraft({ ...draft, ref: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${idp}-du`}>
            Link
          </label>
          <input
            id={`${idp}-du`}
            className="input"
            type="url"
            value={draft.url ?? ''}
            placeholder="https://…"
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          />
        </div>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ alignSelf: 'flex-start' }}
        disabled={!draft.title.trim()}
        data-testid="add-unit-doc"
        onClick={() => {
          const d: UnitDocument = { title: draft.title.trim(), kind: draft.kind };
          if (draft.ref?.trim()) d.ref = draft.ref.trim();
          if (draft.url?.trim()) d.url = draft.url.trim();
          save([...docs, d]);
          setDraft({ title: '', kind: draft.kind });
        }}
      >
        <IconPlus size={16} /> Add document
      </button>
    </div>
  );
}

function UnitItem({ u, used }: { u: LibraryUnit; used: number }) {
  const [startOpen] = useState(!u.make);
  const name = [u.make.split(',')[0], u.line].filter(Boolean).join(' ') || 'New unit configuration';
  const set = (k: keyof LibraryUnit, x: unknown) => void setField('libraryUnits', u.id, k, x);
  const idp = `lu-${u.id}`;
  return (
    <details className="lib-item" id={`lib-unit-${u.id}`} data-testid="unit-lib-item" open={startOpen || undefined}>
      <summary className="lib-summary">
        <span className="lib-summary-text">
          <b>{name}</b>
          <span className="small muted">
            {[u.unitType, u.modelPatterns && `models ${u.modelPatterns}`, `${(u.documents ?? []).length} documents`]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span className="small">{orderText(u.components) || <span className="muted">No order yet</span>}</span>
          <span className="small muted">
            {used ? `Matches ${used} unit${used > 1 ? 's' : ''}` : 'No matching units yet'}
          </span>
          <span className="lib-summary-chips">
            <ConfidenceChip c={u.confidence} />
          </span>
        </span>
      </summary>
      <div className="stack" style={{ gap: 12, paddingTop: 8 }}>
        <div className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor={`${idp}-make`}>
              Make
            </label>
            <TextInput
              id={`${idp}-make`}
              value={u.make}
              placeholder="Carrier, Bryant"
              onCommit={(x) => set('make', x)}
            />
            <span className="field-hint">Other names after commas.</span>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${idp}-line`}>
              Product line
            </label>
            <TextInput id={`${idp}-line`} value={u.line} onCommit={(x) => set('line', x)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${idp}-pat`}>
              Model patterns
            </label>
            <TextInput
              id={`${idp}-pat`}
              value={u.modelPatterns}
              placeholder="48GE*, 50GE*"
              onCommit={(x) => set('modelPatterns', x)}
            />
            <span className="field-hint">* any characters, ? one; spaces and dashes are ignored.</span>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${idp}-type`}>
              Unit type
            </label>
            <select
              id={`${idp}-type`}
              className="select"
              value={u.unitType}
              onChange={(e) => set('unitType', e.target.value)}
            >
              <option value="">Select…</option>
              {UNIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === 'DHU' ? 'DHU (desiccant dehumidifier)' : t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${idp}-conf`}>
              Order is
            </label>
            <select
              id={`${idp}-conf`}
              className="select"
              value={u.confidence}
              onChange={(e) => set('confidence', e.target.value)}
            >
              {Object.entries(CONFIDENCE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
        <OrderEditor u={u} idp={idp} />
        <div className="field">
          <label className="field-label" htmlFor={`${idp}-ev`}>
            Evidence
          </label>
          <TextArea id={`${idp}-ev`} value={u.evidence} onCommit={(x) => set('evidence', x)} />
          <span className="field-hint">The sentence or figure that shows the order, and which document it is in.</span>
        </div>
        <DocumentsEditor u={u} idp={idp} />
        <div className="field">
          <label className="field-label" htmlFor={`${idp}-notes`}>
            Notes
          </label>
          <TextArea id={`${idp}-notes`} value={u.notes} onCommit={(x) => set('notes', x)} />
        </div>
        <button
          type="button"
          className="btn btn-danger"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            if (window.confirm(`Remove "${name}" from the unit library? Units keep their readings.`))
              void deleteLibraryUnit(u.id);
          }}
        >
          <IconTrash size={16} /> Remove
        </button>
      </div>
    </details>
  );
}

const seedKey = (make: string, line: string) =>
  `${make.split(',')[0].trim().toLowerCase()}|${line.trim().toLowerCase()}`;

export function UnitLibrary() {
  const units = useLibraryUnits();
  const equipment = useLiveQuery(() => db.equipment.toArray(), []);
  const [busy, setBusy] = useState(false);
  const usage = new Map<string, number>();
  for (const e of equipment ?? []) {
    const m = matchLibraryUnit(units, e.data.manufacturer, e.data.model);
    if (m) usage.set(m.id, (usage.get(m.id) ?? 0) + 1);
  }
  const have = new Set((units ?? []).map((u) => seedKey(u.make, u.line)));
  const missing = UNIT_LIBRARY_SEED.filter((s) => !have.has(seedKey(s.make, s.line)));
  async function seed() {
    setBusy(true);
    try {
      for (const s of missing) await addLibraryUnit(s);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card card-pad stack" aria-labelledby="ulib-h" data-testid="unit-library">
      <h2 id="ulib-h">Unit configuration library</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Per product line: the order of the components in the supply air (the static pressure profile follows it), how
        that order is known, and the line&apos;s manuals, product data, submittals and drawings. A unit matches by make
        and model, and its page shows the entry. Shared with the team when you are signed in.
      </p>
      {units && missing.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <button type="button" className="btn" disabled={busy} onClick={() => void seed()} data-testid="seed-unit-lib">
            Add the {missing.length} researched product line{missing.length > 1 ? 's' : ''}
          </button>
          <span className="small muted">
            Carrier, York, Lennox, Trane, Addison, Munters, CaptiveAire and Seasons-4 (October 2026 research; check the
            inferred orders against the drawings).
          </span>
        </div>
      )}
      {units && !units.length && <span className="muted">No unit configurations yet.</span>}
      {(units ?? []).map((u) => (
        <UnitItem key={u.id} u={u} used={usage.get(u.id) ?? 0} />
      ))}
      <button type="button" className="btn btn-ghost" onClick={() => void addLibraryUnit()} data-testid="add-lib-unit">
        <IconPlus size={18} /> Add unit configuration
      </button>
    </section>
  );
}

/**
 * On a unit page (static pressure profile section): the library entry the unit's make and model match, its order
 * against the template's for the unit type, and its documents; or a pointer to the library when nothing matches.
 */
export function UnitLibraryMatch({ equipment }: { equipment: Equipment }) {
  const units = useLibraryUnits();
  if (!units) return null;
  const make = equipment.data.manufacturer;
  const model = equipment.data.model;
  const m = matchLibraryUnit(units, make, model);
  if (!m) {
    if (!make || !model) return null;
    return (
      <p className="small muted" style={{ margin: 0 }} data-testid="unit-lib-none">
        No unit configuration for {String(make)} {String(model)} yet:{' '}
        <Link to="/library#ulib-h">add one to the library</Link> with its component order and documents.
      </p>
    );
  }
  const cmp = compareWithTemplate(equipment.data.unitType, m.components);
  return (
    <div className="calc-panel stack" style={{ gap: 6 }} data-testid="unit-lib-match">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <b>
          {m.make.split(',')[0]} {m.line}
        </b>
        <ConfidenceChip c={m.confidence} />
        <Link className="small" to={`/library#lib-unit-${m.id}`}>
          Library entry
        </Link>
      </div>
      {m.components?.length ? (
        <span className="small">Order: {orderText(m.components)}</span>
      ) : (
        <span className="small muted">No component order in the library entry yet.</span>
      )}
      {cmp && cmp.notes.length > 0 && (
        <div className="small" style={{ color: 'var(--amber)' }} data-testid="unit-lib-mismatch">
          {cmp.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
          <div>Note on the report which tap each reading was taken at until the template follows this order.</div>
        </div>
      )}
      {(m.documents ?? []).length > 0 && (
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {(m.documents ?? []).map((d, i) => (
            <li key={`${i}-${d.title}`}>
              <DocumentLine d={d} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
