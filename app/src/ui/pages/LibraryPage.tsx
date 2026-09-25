/**
 * /library: the shared calibration library. Instruments are stored once (for the organization when signed in; on
 * this device in local mode) and picked into a project's 8 calibration slots from the project's Info tab. A project
 * keeps its own copy of the details, so editing an instrument here never changes an issued report; projects whose
 * copy differs offer "Update from library".
 */
import { DEFAULT_INSTRUMENTS } from '@a2b/workbook/map';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../../data/db';
import { addLibraryInstrument, deleteLibraryInstrument, differsFromLibrary, setField } from '../../data/repo';
import { INSTRUMENT_DETAIL_KEYS, type LibraryInstrument } from '../../data/types';
import { calibrationExpired } from '../../domain/instruments';
import { IconPlus, IconTrash } from '../components/Icons';
import { DateInput, TextArea, TextInput } from '../components/inputs';
import { Screen } from '../components/Screen';

const LABEL: Record<(typeof INSTRUMENT_DETAIL_KEYS)[number], string> = {
  type: 'Instrument',
  manufacturer: 'Manufacturer',
  model: 'Model',
  serial: 'Serial',
  calibrationDate: 'Calibration date',
};

const today = () => new Date().toISOString().slice(0, 10);

function LibraryItem({ lib, usedIn, outdated }: { lib: LibraryInstrument; usedIn: string[]; outdated: number }) {
  const expired = lib.calibrationDate ? calibrationExpired(lib.calibrationDate, today()) : false;
  const title = [lib.type, lib.manufacturer, lib.model].filter(Boolean).join(' ') || 'New instrument';
  return (
    // collapsed to one summary line per instrument; a new (empty) instrument opens for editing
    <details className="lib-item" data-testid="lib-item" open={!lib.type || undefined}>
      <summary className="lib-summary">
        <span className="lib-summary-text">
          <b>{title}</b>
          <span className="small muted">
            {[
              lib.serial && `SN ${lib.serial}`,
              lib.calibrationDate ? `calibrated ${lib.calibrationDate}` : 'no calibration date',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span className="small muted">
            {usedIn.length
              ? `In ${usedIn.length} project${usedIn.length > 1 ? 's' : ''}: ${usedIn.slice(0, 3).join(', ')}${usedIn.length > 3 ? ' …' : ''}`
              : 'Not in a project yet'}
          </span>
          {(expired || outdated > 0) && (
            <span className="lib-summary-chips">
              {expired && (
                <span className="chip chip-warn" data-testid="lib-expired">
                  Calibration over 12 months old
                </span>
              )}
              {outdated > 0 && (
                <span className="chip" data-testid="lib-outdated">
                  {outdated} project cop{outdated > 1 ? 'ies differ' : 'y differs'}
                </span>
              )}
            </span>
          )}
        </span>
      </summary>
      <div className="stack" style={{ gap: 12, paddingTop: 8 }}>
        <div className="form-grid">
          {(['type', 'manufacturer', 'model', 'serial'] as const).map((k) => (
            <div className="field" key={k}>
              <label className="field-label" htmlFor={`lib-${lib.id}-${k}`}>
                {LABEL[k]}
              </label>
              <TextInput
                id={`lib-${lib.id}-${k}`}
                value={lib[k]}
                onCommit={(v) => void setField('libraryInstruments', lib.id, k, v)}
              />
            </div>
          ))}
          <div className="field">
            <label className="field-label" htmlFor={`lib-${lib.id}-cal`}>
              Calibration date
            </label>
            <DateInput
              id={`lib-${lib.id}-cal`}
              value={lib.calibrationDate}
              onCommit={(v) => void setField('libraryInstruments', lib.id, 'calibrationDate', v ?? '')}
            />
            {expired && <span className="field-warning">Calibrated more than 12 months ago</span>}
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`lib-${lib.id}-notes`}>
              Notes
            </label>
            <TextArea
              id={`lib-${lib.id}-notes`}
              value={lib.notes ?? ''}
              onCommit={(v) => void setField('libraryInstruments', lib.id, 'notes', v)}
            />
          </div>
        </div>
        {outdated > 0 && (
          <p className="small" style={{ margin: 0 }}>
            Projects keep their own copy: open a project&apos;s Info tab and tap <b>Update from library</b> to take
            these details.
          </p>
        )}
        <button
          type="button"
          className="btn btn-danger"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            if (
              window.confirm(
                `Remove "${title}" from the library?${usedIn.length ? ' Projects keep their own copy of it.' : ''}`,
              )
            )
              void deleteLibraryInstrument(lib.id);
          }}
        >
          <IconTrash size={16} /> Remove
        </button>
      </div>
    </details>
  );
}

export function LibraryPage() {
  const data = useLiveQuery(async () => {
    const [library, instruments, projects] = await Promise.all([
      db.libraryInstruments.toArray(),
      db.instruments.toArray(),
      db.projects.toArray(),
    ]);
    return { library, instruments, names: new Map(projects.map((p) => [p.id, p.name])) };
  }, []);
  const [busy, setBusy] = useState(false);
  const library = [...(data?.library ?? [])].sort(
    (a, b) => a.type.localeCompare(b.type) || a.serial.localeCompare(b.serial) || a.createdAt - b.createdAt,
  );
  async function seed() {
    setBusy(true);
    try {
      for (const ins of DEFAULT_INSTRUMENTS) await addLibraryInstrument(ins);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen title="Instrument library" back="/">
      <section className="card card-pad stack" aria-labelledby="lib-h" data-testid="library">
        <h2 id="lib-h">Calibration library</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Your meters, entered once and picked into a project on its Info tab. A project keeps its own copy: a new
          calibration date here never changes an issued report; the project offers <b>Update from library</b>. Shared
          with the team when you are signed in.
        </p>
        {data && !library.length && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="muted">The library is empty.</span>
            <button type="button" className="btn" disabled={busy} onClick={() => void seed()}>
              Add the template&apos;s 7 a2b instruments
            </button>
          </div>
        )}
        {library.map((lib) => {
          const copies = (data?.instruments ?? []).filter((i) => i.libraryId === lib.id);
          const usedIn = [...new Set(copies.map((i) => data?.names.get(i.projectId) ?? 'a project'))];
          return (
            <LibraryItem
              key={lib.id}
              lib={lib}
              usedIn={usedIn}
              outdated={copies.filter((i) => differsFromLibrary(i, lib)).length}
            />
          );
        })}
        <button type="button" className="btn btn-ghost" onClick={() => void addLibraryInstrument()}>
          <IconPlus size={18} /> Add instrument
        </button>
      </section>
    </Screen>
  );
}
