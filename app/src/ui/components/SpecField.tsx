import type { ItemResult } from '../../domain/completion';
import type { FieldSpec } from '../../domain/specs';
import type { FieldValue, NaMark } from '../../data/types';
import { DateInput, NaSelect, NumberInput, SelectInput, TextArea, TextInput, YesNo } from './inputs';

export interface SpecFieldProps {
  idPrefix: string;
  field: FieldSpec;
  label?: string;
  value: FieldValue | undefined;
  state?: ItemResult;
  mark?: NaMark | null;
  onChange: (v: FieldValue) => void;
  onNa?: (m: NaMark | null) => void;
  wide?: boolean;
}

const NA_TEXT: Record<string, string> = {
  'auto-na': 'Auto N/A',
  'section-na': 'Section N/A',
  'equipment-na': 'Unit N/A',
  'scope-na': 'N/A for this scope',
};

/** One form field driven by a FieldSpec: label, input, quick N/A menu, and its completion state. */
export function SpecField({
  idPrefix,
  field,
  label = field.label,
  value,
  state,
  mark,
  onChange,
  onNa,
  wide,
}: SpecFieldProps) {
  const id = `${idPrefix}-${field.key}`;
  const st = state?.state;
  const blank = value === undefined || value === null || value === '';
  const className = `field${wide || field.input === 'textarea' ? ' span-2' : ''}`;

  // explicit N/A: show the notation instead of the input
  if (mark && blank) {
    return (
      <div className={className} data-state="na" data-field={field.key}>
        <span className="field-label" id={`${id}-label`}>
          {label}
        </span>
        <div className="field-control">
          <span className="na-value" aria-labelledby={`${id}-label`} data-testid={`na-${field.key}`}>
            {mark.notation}
            {mark.reason && <span className="muted small">· {mark.reason}</span>}
          </span>
          {onNa && <NaSelect label={label} mark={mark} onChange={onNa} />}
        </div>
      </div>
    );
  }
  // automatic / section / scope N/A with no value: a compact line
  if (blank && st && NA_TEXT[st]) {
    return (
      <div className={className} data-state={st} data-field={field.key}>
        <div className="na-auto">
          <strong>{label}</strong>
          <span>
            {NA_TEXT[st]}
            {state?.reason ? ` · ${state.reason}` : ''}
          </span>
        </div>
      </div>
    );
  }

  const common = { id, 'aria-describedby': field.hint ? `${id}-hint` : undefined };
  let input;
  switch (field.input) {
    case 'number':
      input = (
        <NumberInput
          {...common}
          value={typeof value === 'number' ? value : null}
          unit={field.unit}
          onCommit={onChange}
        />
      );
      break;
    case 'select':
      input = <SelectInput {...common} value={value ?? null} options={field.options ?? []} onCommit={onChange} />;
      break;
    case 'date':
      input = <DateInput {...common} value={typeof value === 'string' ? value : ''} onCommit={onChange} />;
      break;
    case 'textarea':
      input = (
        <TextArea {...common} value={value === null || value === undefined ? '' : String(value)} onCommit={onChange} />
      );
      break;
    case 'yesno':
      input = <YesNo id={id} label={label} value={value ?? null} onCommit={onChange} />;
      break;
    default:
      input = (
        <TextInput
          {...common}
          value={value === null || value === undefined ? '' : String(value)}
          onCommit={onChange}
          list={field.suggestions ? `${id}-list` : undefined}
        />
      );
  }
  const required = st === 'missing' || (st === 'value' && field.required !== false);
  return (
    <div className={className} data-state={st ?? 'none'} data-field={field.key}>
      <label className="field-label" htmlFor={id}>
        {label}
        {required && (
          <span className="req" aria-hidden>
            *
          </span>
        )}
      </label>
      <div className="field-control">
        {input}
        {onNa && field.input !== 'yesno' && <NaSelect label={label} mark={mark} onChange={onNa} />}
      </div>
      {field.suggestions && (
        <datalist id={`${id}-list`}>
          {field.suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      {field.hint && (
        <span className="field-hint" id={`${id}-hint`}>
          {field.hint}
        </span>
      )}
    </div>
  );
}
