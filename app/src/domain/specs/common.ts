import type { AutoNa, FieldSpec, SectionSpec } from './types';

/** No outside air: a design OA of 0 (a blank design OA is "not entered yet": the OA row stays to be filled). */
export const NO_OA: AutoNa = { when: { field: 'designOaCfm', in: [0, '0'] }, reason: 'design OA is 0' };

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
    {
      key: 'fieldNotes',
      label: 'Field notes (not in the report)',
      input: 'textarea',
      required: false,
      appOnly: true,
      hint: 'Working math, sizes, readings to re-check: stays in the app, never exported',
    },
  ],
};
