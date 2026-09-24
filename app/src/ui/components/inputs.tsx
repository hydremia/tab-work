/**
 * Inputs that save as you type: they keep a local draft while focused and commit through `onCommit`
 * (which calls setField) after a short pause and on blur, so every keystroke is not a database write.
 */
import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { NOTATIONS, type FieldValue, type NaMark, type Notation } from '../../data/types';

function useDraft<T>(value: T, onCommit: (v: T) => void, delay = 350) {
  const [draft, setDraft] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<{ v: T } | null>(null);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });
  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current) {
      const { v } = pending.current;
      pending.current = null;
      commitRef.current(v);
    }
  };
  useEffect(() => () => flush(), []); // flush a pending edit on unmount
  return {
    shown: draft !== null ? draft : value,
    change(v: T, validForCommit = true) {
      setDraft(v);
      clearTimeout(timer.current);
      if (validForCommit) {
        pending.current = { v };
        timer.current = setTimeout(flush, delay);
      } else pending.current = null;
    },
    blur() {
      flush();
      setDraft(null);
    },
  };
}

type BaseProps = { id: string; 'aria-label'?: string; placeholder?: string; invalid?: boolean };

export function TextInput({
  value,
  onCommit,
  list,
  ...rest
}: BaseProps & { value: string; onCommit: (v: string) => void; list?: string }) {
  const d = useDraft(value, onCommit);
  return (
    <input
      className="input"
      type="text"
      autoComplete="off"
      value={d.shown}
      list={list}
      onChange={(e) => d.change(e.target.value)}
      onBlur={d.blur}
      {...rest}
    />
  );
}

export function TextArea({ value, onCommit, ...rest }: BaseProps & { value: string; onCommit: (v: string) => void }) {
  const d = useDraft(value, onCommit);
  return (
    <textarea
      className="textarea"
      value={d.shown}
      onChange={(e) => d.change(e.target.value)}
      onBlur={d.blur}
      {...rest}
    />
  );
}

const NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)$/;
export function parseNumber(s: string): number | null | undefined {
  const t = s.trim().replace(/,/g, '');
  if (t === '') return null;
  return NUM_RE.test(t) ? Number(t) : undefined;
}

/** Numeric field with the decimal keypad on phones. Commits a number, or null when cleared. */
export function NumberInput({
  value,
  onCommit,
  unit,
  ...rest
}: BaseProps & { value: number | null; onCommit: (v: number | null) => void; unit?: string } & Pick<
    InputHTMLAttributes<HTMLInputElement>,
    'onKeyDown'
  >) {
  const d = useDraft<string>(value === null ? '' : String(value), (s) => {
    const n = parseNumber(s);
    if (n !== undefined) onCommit(n);
  });
  const invalid = parseNumber(d.shown) === undefined;
  const input = (
    <input
      className="input"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      enterKeyHint="next"
      value={d.shown}
      aria-invalid={invalid || undefined}
      onChange={(e) => d.change(e.target.value, parseNumber(e.target.value) !== undefined)}
      onBlur={d.blur}
      {...rest}
    />
  );
  if (!unit) return input;
  return (
    <span className="input-unit">
      {input}
      <span className="unit">{unit}</span>
    </span>
  );
}

export function SelectInput({
  id,
  value,
  options,
  onCommit,
  ...rest
}: BaseProps & {
  value: string | number | null;
  options: readonly (string | number)[];
  onCommit: (v: string | number | null) => void;
}) {
  return (
    <select
      id={id}
      className="select"
      value={value === null ? '' : String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        const hit = options.find((o) => String(o) === raw);
        onCommit(raw === '' ? null : (hit ?? raw));
      }}
      {...rest}
    >
      <option value="">Select…</option>
      {options.map((o) => (
        <option key={String(o)} value={String(o)}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function DateInput({
  id,
  value,
  onCommit,
  ...rest
}: BaseProps & { value: string; onCommit: (v: string | null) => void }) {
  return (
    <input
      id={id}
      className="input"
      type="date"
      value={value}
      onChange={(e) => onCommit(e.target.value || null)}
      {...rest}
    />
  );
}

export function YesNo({
  id,
  value,
  onCommit,
  label,
}: {
  id: string;
  value: FieldValue;
  onCommit: (v: string | null) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label} id={id}>
      {(['Yes', 'No'] as const).map((v) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onCommit(value === v ? null : v)}>
          {v}
        </button>
      ))}
    </div>
  );
}

/**
 * Quick N/A menu: a native select (the phone's own picker) with N/A / Not Avail. / Not Acc., or Clear.
 */
export function NaSelect({
  label,
  mark,
  onChange,
}: {
  label: string;
  mark: NaMark | null | undefined;
  onChange: (m: NaMark | null) => void;
}) {
  return (
    <select
      className="na-select"
      aria-label={`${label}: mark N/A`}
      title="Mark N/A"
      value=""
      onChange={(e) => {
        const v = e.target.value;
        if (v === 'clear') onChange(null);
        else if ((NOTATIONS as readonly string[]).includes(v)) onChange({ notation: v as Notation });
      }}
    >
      <option value="">N/A…</option>
      {NOTATIONS.map((n) => (
        <option key={n} value={n}>
          Mark {n}
        </option>
      ))}
      {mark && <option value="clear">Clear N/A</option>}
    </select>
  );
}
