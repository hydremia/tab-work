/** Kitchen hoods (Evergreen filter method): docs/REQUIRED_FIELDS.md "Kitchen hoods (Hoods sheet)", §4.7. */
import { filterSizesFor, TEMPLATE_LISTS } from '@a2b/workbook/map';
import { identitySection, remarksSection } from './common';
import type { AutoNa, EquipmentSpec, RowColumnSpec } from './types';
import { photosSection } from './unitSections';

const NO_FILTER: AutoNa = { when: { field: 'size', eq: 'No Filter' }, reason: 'no filter' };
const VELGRID: AutoNa = { when: { field: 'filterType', matches: 'VelGrid' }, reason: 'VelGrid: one reading' };
const reading = (key: string, label: string, extra: AutoNa[] = []): RowColumnSpec => ({
  key,
  label,
  input: 'number',
  unit: 'fpm',
  naMenu: true,
  autoNa: [NO_FILTER, ...extra],
});
const FILTER_TYPES = TEMPLATE_LISTS['Hood.FilterType'];
const IDENTITY = identitySection();

export const HOOD_SPEC: EquipmentSpec = {
  type: 'hood',
  formComplete: true,
  totalCheck: { calc: 'hood', label: 'Hood total' },
  sections: [
    // the schedule's location column is not printed on the hood page: optional
    { ...IDENTITY, fields: IDENTITY.fields.map((f) => (f.key === 'location' ? { ...f, required: false } : f)) },
    {
      key: 'design',
      label: 'Design information',
      airflow: false,
      fields: [
        { key: 'manufacturer', label: 'Hood manufacturer', input: 'text' },
        { key: 'designCfm', label: 'Design CFM', input: 'number', unit: 'CFM', airflow: true },
        { key: 'lengthFt', label: 'Hood length', input: 'number', unit: 'ft', airflow: true },
        { key: 'associatedFan', label: 'Associated exhaust fan', input: 'text', hint: 'e.g. KEF-1' },
      ],
    },
    {
      key: 'hoodData',
      label: 'Hood data',
      airflow: false,
      fields: [
        { key: 'model', label: 'Model', input: 'text' },
        { key: 'serial', label: 'Serial number', input: 'text' },
        { key: 'hoodType', label: 'Hood type', input: 'text', suggestions: ['Type I', 'Type II'] },
        { key: 'filterManufacturer', label: 'Filter manufacturer', input: 'text' },
        {
          key: 'filterType',
          label: 'Filter type',
          input: 'select',
          options: FILTER_TYPES,
          airflow: true,
          hint: 'Sets the free area and K-factor, and 1 (VelGrid) or 3 (Airfoil) readings per filter',
        },
        {
          key: 'instrument',
          label: 'Instrument',
          input: 'select',
          options: TEMPLATE_LISTS['Hood.Instrument'],
          airflow: true,
        },
      ],
    },
    {
      key: 'filters',
      label: 'Filter readings',
      airflow: true,
      calc: 'hoodTotals',
      fields: [],
      tables: [
        {
          key: 'filters',
          label: 'Filters',
          required: true,
          minRows: 1,
          tolerance: false,
          calc: 'hoodFilter',
          noun: 'filter',
          fillDown: ['size'],
          columns: [
            {
              key: 'size',
              label: 'Filter size',
              input: 'select',
              options: TEMPLATE_LISTS['Hood.FilterSize'],
              optionsBy: {
                field: 'filterType',
                map: Object.fromEntries(FILTER_TYPES.map((t) => [t, filterSizesFor(t)])),
              },
            },
            reading('init1', 'Initial 1'),
            reading('init2', 'Initial 2', [VELGRID]),
            reading('init3', 'Initial 3', [VELGRID]),
            reading('final1', 'Final 1'),
            reading('final2', 'Final 2', [VELGRID]),
            reading('final3', 'Final 3', [VELGRID]),
          ],
          readingGroups: [
            ['init1', 'init2', 'init3'],
            ['final1', 'final2', 'final3'],
          ],
        },
      ],
    },
    photosSection([
      { category: 'unit', label: 'Hood' },
      { category: 'tag', label: 'Hood tag' },
    ]),
    {
      ...remarksSection,
      fields: [
        ...remarksSection.fields,
        {
          key: 'technicianNotes',
          label: 'Technician notes (off-print)',
          input: 'textarea',
          required: false,
          hint: 'Up to 3 lines, beside the hood (not printed)',
        },
      ],
    },
  ],
};
