/**
 * Quick entry for a run of readings typed in order (PSP velocities, traverse points). Each reading is its own
 * field (`data.<key>_<i>`), so it autosaves and syncs like any other field. Enter jumps to the next reading.
 * A reading can be marked N/A ("Next reading…" marks the first empty one; tap a marked reading to clear it), and
 * the whole run can be marked N/A from the header menu.
 */
import { useState } from 'react';
import { setField, setFields } from '../../data/repo';
import { NOTATIONS, type Equipment, type Notation } from '../../data/types';
import { seqNaKey, type SequenceResult } from '../../domain/completion';
import { isBlank } from '../../domain/conditions';
import { seqKey, type SequenceSpec } from '../../domain/specs';
import { NaSelect, NumberInput } from './inputs';

const NA_TEXT: Record<string, string> = {
  'auto-na': 'Auto N/A',
  'section-na': 'Section N/A',
  'equipment-na': 'Unit N/A',
  'scope-na': 'N/A for this scope',
};

export interface GridShape {
  /** Readings per grid row (points across). */
  across: number;
  /** Readings to show (the point count); more can be revealed up to spec.count. */
  shown: number;
  /** Label of grid row r (0-based), e.g. `2"` depth or `Axis 1`. */
  rowLabel?: (r: number) => string;
  /** Label of position c (0-based), e.g. `3"`. */
  colLabel?: (c: number) => string;
}

export function SequenceGrid({
  equipment,
  spec,
  result,
  shape,
}: {
  equipment: Equipment;
  spec: SequenceSpec;
  result: SequenceResult | undefined;
  shape: GridShape;
}) {
  const data = equipment.data;
  const marks = equipment.naState.fields;
  const lastUsed = Array.from({ length: spec.count }, (_, i) => i + 1)
    .filter((i) => !isBlank(data[seqKey(spec.key, i)]) || marks[seqKey(spec.key, i)])
    .pop();
  const [extra, setExtra] = useState(0);
  const shown = Math.min(spec.count, Math.max(shape.shown, lastUsed ?? 0) + extra);
  const st = result?.state;
  const wholeMark = marks[seqNaKey(spec.key)];
  const id = (i: number) => `${spec.key}-${i}`;
  const focusNext = (i: number) => document.getElementById(id(i + 1))?.focus();
  const rows = Math.ceil(shown / shape.across);

  if (st && (st === 'na' || NA_TEXT[st]) && (result?.entered ?? 0) === 0) {
    return (
      <div className="seq" data-testid={`seq-${spec.key}`}>
        <div className="airflow-head">
          <h3>{spec.label}</h3>
          <span className="spacer" />
          <NaSelect
            label={spec.label}
            mark={wholeMark}
            onChange={(m) => void setField('equipment', equipment.id, `naState.fields.${seqNaKey(spec.key)}`, m)}
          />
        </div>
        <div className="na-auto">
          <strong>{spec.label}</strong>
          <span>
            {st === 'na' ? wholeMark?.notation : NA_TEXT[st]}
            {result?.reason ? ` · ${result.reason}` : ''}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="seq" data-testid={`seq-${spec.key}`}>
      <div className="airflow-head">
        <h3>{spec.label}</h3>
        <span className="chip">
          {result?.entered ?? 0} / {shape.shown}
        </span>
        <span className="spacer" />
        <NaSelect
          label={spec.label}
          mark={wholeMark}
          onChange={(m) => void setField('equipment', equipment.id, `naState.fields.${seqNaKey(spec.key)}`, m)}
        />
      </div>
      <div className="seq-grid" style={{ gridTemplateColumns: `repeat(${Math.min(shape.across, 5)}, minmax(0, 1fr))` }}>
        {Array.from({ length: rows }, (_, r) => renderRow(r))}
      </div>
      <div className="row" style={{ gap: 8 }}>
        {shown < spec.count && (
          <button type="button" className="btn" onClick={() => setExtra(extra + shape.across)}>
            More readings
          </button>
        )}
        <select
          className="row-menu"
          aria-label={`${spec.label}: mark the next reading`}
          value=""
          onChange={(e) => {
            const n = e.target.value as Notation;
            const next = Array.from({ length: spec.count }, (_, i) => i + 1).find(
              (i) => isBlank(data[seqKey(spec.key, i)]) && !marks[seqKey(spec.key, i)],
            );
            if (next && n)
              void setFields('equipment', equipment.id, {
                [`data.${seqKey(spec.key, next)}`]: null,
                [`naState.fields.${seqKey(spec.key, next)}`]: { notation: n },
              });
          }}
        >
          <option value="">Next reading…</option>
          {NOTATIONS.map((n) => (
            <option key={n} value={n}>
              Mark next reading {n}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  function renderRow(r: number) {
    const cells = Array.from({ length: shape.across }, (_, c) => r * shape.across + c + 1).filter((i) => i <= shown);
    const out = [];
    if (shape.rowLabel) {
      out.push(
        <div key={`label-${r}`} className="seq-row-label">
          {shape.rowLabel(r)}
        </div>,
      );
    }
    cells.forEach((i, c) => {
      const k = seqKey(spec.key, i);
      const mark = marks[k];
      const v = data[k];
      const label = shape.colLabel ? `#${i} · ${shape.colLabel(c)}` : `#${i}`;
      out.push(
        <div className="cell" key={i}>
          <label htmlFor={id(i)}>{label}</label>
          {mark && isBlank(v) ? (
            <button
              type="button"
              id={id(i)}
              className="na-value seq-na"
              title="Clear the N/A mark"
              onClick={() => void setField('equipment', equipment.id, `naState.fields.${k}`, null)}
            >
              {mark.notation}
            </button>
          ) : (
            <NumberInput
              id={id(i)}
              aria-label={`${spec.label} ${i}`}
              value={typeof v === 'number' ? v : null}
              onCommit={(n) => void setField('equipment', equipment.id, `data.${k}`, n)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  focusNext(i);
                }
              }}
            />
          )}
        </div>,
      );
    });
    return out;
  }
}
