/** RTU / AHU / DOAS: docs/REQUIRED_FIELDS.md "RTU / AHU / DOAS (RTUs sheet)". */
import { PHASES, TEMPLATE_LISTS } from '@a2b/workbook/map';
import { identitySection, NO_OA, remarksSection } from './common';
import type { AutoNa, EquipmentSpec, FieldSpec } from './types';

const ONE_PHASE: AutoNa = { when: { field: 'phase', eq: '1-phase' }, reason: '1-phase' };
const NOT_BELT: AutoNa = { when: { field: 'driveType', in: ['Direct', 'ECM'] }, reason: 'direct / ECM drive' };
const NO_VFD: AutoNa = { when: { field: 'hasVfd', notIn: ['Yes'] }, reason: 'no VFD' };
const NO_FILTERS: AutoNa = { when: { field: 'hasFilters', eq: 'No' }, reason: 'no filters' };
const absent = (n: number): AutoNa => ({ when: { componentAbsent: n }, reason: 'not on this unit type' });

const leaving = (n: number, extra: AutoNa[] = []): FieldSpec => ({
  key: `spLeaving${n}`,
  label: `Leaving component ${n}`,
  input: 'number',
  unit: 'in. w.g.',
  component: n,
  autoNa: [absent(n), ...extra],
});

export const RTU_SPEC: EquipmentSpec = {
  type: 'rtu',
  formComplete: true,
  designCheck: { field: 'designTotalCfm', table: 'supply' },
  sections: [
    identitySection(),
    {
      key: 'design',
      label: 'Design data (schedule)',
      airflow: false,
      fields: [
        { key: 'manufacturer', label: 'Manufacturer', input: 'text' },
        { key: 'model', label: 'Model', input: 'text' },
        { key: 'hp', label: 'HP', input: 'number', unit: 'hp' },
        { key: 'unitEsp', label: 'Unit ESP', input: 'number', unit: 'in. w.g.' },
        { key: 'fanRpm', label: 'Fan RPM', input: 'number', unit: 'rpm' },
        { key: 'voltage', label: 'Voltage', input: 'number', unit: 'V' },
        { key: 'phase', label: 'Phase', input: 'select', options: PHASES },
        { key: 'designTotalCfm', label: 'Design total CFM', input: 'number', unit: 'CFM', airflow: true },
        {
          key: 'designOaCfm',
          label: 'Design OA CFM',
          input: 'number',
          unit: 'CFM',
          airflow: true,
          hint: 'Enter 0 when the unit has no outside air',
        },
      ],
    },
    {
      key: 'unit',
      label: 'Unit data',
      airflow: false,
      fields: [
        {
          key: 'unitType',
          label: 'Unit type',
          input: 'select',
          options: ['RTU', 'DOAS'],
          preset: 'RTU',
          hint: 'Sets which static-profile components apply',
        },
        { key: 'serial', label: 'Serial number', input: 'text' },
      ],
    },
    {
      key: 'motor',
      label: 'Motor data',
      airflow: false,
      fields: [
        { key: 'motorManufacturer', label: 'Motor manufacturer', input: 'text' },
        { key: 'motorRpm', label: 'Motor RPM', input: 'number', unit: 'rpm' },
        { key: 'serviceFactor', label: 'Service factor', input: 'select', options: TEMPLATE_LISTS['Service.Factors2'] },
        { key: 'fla', label: 'FLA', input: 'number', unit: 'A' },
        { key: 'frame', label: 'Frame', input: 'text' },
        { key: 'volts1', label: 'Voltage L1', input: 'number', unit: 'V' },
        { key: 'volts2', label: 'Voltage L2', input: 'number', unit: 'V', autoNa: [ONE_PHASE] },
        { key: 'volts3', label: 'Voltage L3', input: 'number', unit: 'V', autoNa: [ONE_PHASE] },
        { key: 'amps1', label: 'Amperage L1', input: 'number', unit: 'A' },
        { key: 'amps2', label: 'Amperage L2', input: 'number', unit: 'A', autoNa: [ONE_PHASE] },
        { key: 'amps3', label: 'Amperage L3', input: 'number', unit: 'A', autoNa: [ONE_PHASE] },
      ],
    },
    {
      key: 'drive',
      label: 'Drive data',
      airflow: false,
      fields: [
        { key: 'driveType', label: 'Drive type', input: 'select', options: TEMPLATE_LISTS['Drive.Type'] },
        { key: 'motorSheave', label: 'Motor sheave', input: 'text', autoNa: [NOT_BELT] },
        { key: 'fanPulley', label: 'Fan pulley', input: 'text', autoNa: [NOT_BELT] },
        { key: 'belts', label: 'Belt(s)', input: 'text', autoNa: [NOT_BELT] },
        { key: 'cToC', label: 'C to C', input: 'text', autoNa: [NOT_BELT] },
        { key: 'sheaveBore', label: 'Sheave bore M/F', input: 'text', autoNa: [NOT_BELT] },
      ],
    },
    {
      key: 'misc',
      label: 'Misc. unit info',
      airflow: false,
      fields: [
        { key: 'rotationDesign', label: 'Fan rotation (design)', input: 'text', suggestions: ['CW', 'CCW'] },
        { key: 'rotationActual', label: 'Fan rotation (actual)', input: 'text', suggestions: ['CW', 'CCW'] },
        { key: 'hasFilters', label: 'Unit has filters?', input: 'yesno', appOnly: true },
        { key: 'filters', label: 'Filter type / size / qty', input: 'text', autoNa: [NO_FILTERS] },
        { key: 'finalSettings', label: 'Final settings', input: 'text', hint: 'e.g. VFD 48 Hz, sheave 2.5 turns open' },
      ],
    },
    {
      key: 'rpm',
      label: 'RPM data',
      airflow: false,
      fields: [
        { key: 'motorRpmInitial', label: 'Motor RPM (initial)', input: 'number', unit: 'rpm', required: false },
        { key: 'motorRpmFinal', label: 'Motor RPM (final)', input: 'number', unit: 'rpm' },
        { key: 'fanRpmInitial', label: 'Fan RPM (initial)', input: 'number', unit: 'rpm', required: false },
        { key: 'fanRpmFinal', label: 'Fan RPM (final)', input: 'number', unit: 'rpm' },
        { key: 'hasVfd', label: 'VFD on the unit?', input: 'yesno', appOnly: true },
        {
          key: 'vsdInitial',
          label: 'VSD frequency (initial)',
          input: 'number',
          unit: 'Hz',
          required: false,
          autoNa: [NO_VFD],
        },
        { key: 'vsdFinal', label: 'VSD frequency (final)', input: 'number', unit: 'Hz', autoNa: [NO_VFD] },
      ],
    },
    {
      key: 'oa',
      label: 'OA damper',
      airflow: true,
      fields: [
        { key: 'oaDamper', label: 'OA damper position', input: 'text', autoNa: [NO_OA], hint: 'e.g. 35 % open' },
      ],
    },
    {
      key: 'static',
      label: 'Static pressure profile',
      airflow: false,
      fields: [
        { key: 'spEntering', label: 'Entering static (first component)', input: 'number', unit: 'in. w.g.' },
        leaving(1, [NO_FILTERS]),
        leaving(2),
        leaving(3),
        leaving(4),
        leaving(5),
      ],
    },
    {
      key: 'airflow',
      label: 'Airflow',
      airflow: true,
      fields: [
        { key: 'instrument', label: 'Instrument', input: 'select', options: TEMPLATE_LISTS['Airflow.Instrument'] },
        { key: 'akNotes', label: 'Ak basis / notes', input: 'text', required: false },
      ],
      tables: [
        { key: 'supply', label: 'Supply outlets', required: true, minRows: 1, tolerance: true },
        { key: 'return', label: 'Return inlets', required: false, tolerance: true, firstRowDesignComputed: true },
        { key: 'oa', label: 'Outside air', required: true, minRows: 1, tolerance: true, autoNa: [NO_OA] },
      ],
    },
    {
      key: 'photos',
      label: 'Photos',
      airflow: false,
      fields: [],
      photos: [
        { category: 'unit', label: 'Unit' },
        { category: 'tag', label: 'Unit label / tag' },
        { category: 'oa_damper', label: 'OA damper', autoNa: [NO_OA] },
      ],
    },
    remarksSection,
  ],
};
