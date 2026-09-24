import type { AutoNa, FieldSpec, SectionSpec } from './types';

export const NO_OA: AutoNa = { when: { field: 'designOaCfm', blankOrZero: true }, reason: 'design OA is 0' };

export const identitySection = (extra: readonly FieldSpec[] = []): SectionSpec => ({
  key: 'identity',
  label: 'Identity',
  airflow: true,
  locked: true,
  fields: [
    { key: 'designation', label: 'Designation', input: 'text', recordField: 'designation' },
    { key: 'areaServed', label: 'Area served', input: 'text' },
    { key: 'location', label: 'Location', input: 'text' },
    ...extra,
  ],
});

export const remarksSection: SectionSpec = {
  key: 'remarks',
  label: 'Remarks',
  airflow: true,
  fields: [
    { key: 'remarks', label: 'Remarks', input: 'textarea', required: false, hint: 'One line per workbook remark line' },
  ],
};
