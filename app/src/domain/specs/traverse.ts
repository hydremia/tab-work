/** Duct traverses: docs/REQUIRED_FIELDS.md "Traverses (Traverses sheet)", WORKBOOK_ANALYSIS §4.8. R7. */
import { TEMPLATE_LISTS } from '@a2b/workbook/map';
import { remarksSection } from './common';
import type { EquipmentSpec } from './types';

export const TRAVERSE_SPEC: EquipmentSpec = {
  type: 'traverse',
  totalCheck: { calc: 'traverse', label: 'Traverse CFM' },
  sections: [
    {
      key: 'identity',
      label: 'Identity',
      airflow: true,
      locked: true,
      fields: [
        {
          key: 'designation',
          label: 'Point',
          input: 'text',
          recordField: 'designation',
          hint: 'Printed as the point label, e.g. T-1',
        },
        { key: 'areaServed', label: 'Area served', input: 'text' },
        { key: 'designCfm', label: 'Design CFM', input: 'number', unit: 'CFM' },
      ],
    },
    {
      key: 'duct',
      label: 'Duct',
      airflow: true,
      fields: [
        {
          key: 'shape',
          label: 'Duct shape',
          input: 'select',
          options: TEMPLATE_LISTS['Duct.Shape'],
          hint: 'Flat oval (NEBB 6.3.3h): the flat part read as a rectangle, the two ends as one round of diameter H on the horizontal axis; CFM per part, added',
        },
        {
          key: 'width',
          label: 'Width / diameter',
          input: 'number',
          unit: 'in.',
          hint: 'Flat oval: the major (long) axis',
        },
        {
          key: 'height',
          label: 'Height',
          input: 'number',
          unit: 'in.',
          autoNa: [{ when: { field: 'shape', eq: 'Round' }, reason: 'round duct' }],
          hint: 'Flat oval: the minor (short) axis',
        },
        {
          key: 'liner',
          label: 'Liner thickness',
          input: 'number',
          unit: 'in.',
          required: false,
          hint: 'Blank = no liner',
        },
      ],
    },
    {
      key: 'readings',
      label: 'Readings',
      airflow: true,
      calc: 'traverse',
      hint: 'Complete with an initial average velocity or the final point grid',
      fields: [
        {
          key: 'initialVel',
          label: 'Initial average velocity',
          input: 'number',
          unit: 'fpm',
          required: false,
          hint: 'Prelim: one average reading',
        },
      ],
      sequences: [
        {
          key: 'readings',
          label: 'Final point readings',
          // a flat oval: the rectangle readings first (row by row), then the end points (left end, then right end)
          count: 80,
          unit: 'fpm',
          requiredWhen: { field: 'initialVel', blank: true },
        },
      ],
    },
    {
      key: 'conditions',
      label: 'Conditions',
      airflow: true,
      fields: [
        { key: 'instrument', label: 'Instrument', input: 'select', options: TEMPLATE_LISTS['Traverse.Instrument'] },
        { key: 'ductStatic', label: 'Duct static pressure', input: 'number', unit: 'in. w.g.' },
        { key: 'temperature', label: 'Temperature', input: 'number', unit: '°F' },
      ],
    },
    remarksSection,
  ],
};
