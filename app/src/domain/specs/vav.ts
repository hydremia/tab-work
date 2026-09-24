/** VAV / fan-powered terminals: docs/REQUIRED_FIELDS.md "VAV / fan-powered terminals (VAVs sheet)". */
import { TEMPLATE_LISTS } from '@a2b/workbook/map';
import { identitySection, remarksSection } from './common';
import type { AutoNa, EquipmentSpec } from './types';

const NOT_FAN_POWERED: AutoNa = { when: { field: 'terminalType', notMatches: 'fan' }, reason: 'not fan-powered' };
const NO_HEATING: AutoNa = { when: { field: 'heatingCfm', blank: true }, reason: 'no heating CFM scheduled' };

export const VAV_SPEC: EquipmentSpec = {
  type: 'vav',
  designCheck: { field: 'designMaxCfm', table: 'outlets' },
  sections: [
    identitySection(),
    {
      key: 'design',
      label: 'Design data (schedule)',
      airflow: false,
      fields: [
        { key: 'manufacturer', label: 'Manufacturer', input: 'text' },
        { key: 'model', label: 'Model', input: 'text' },
        { key: 'inletSize', label: 'Inlet size', input: 'number', unit: 'in.' },
        {
          key: 'terminalType',
          label: 'Terminal type',
          input: 'text',
          suggestions: [
            'Pressure Independent',
            'Pressure Dependent',
            'Series Fan Powered',
            'Parallel Fan Powered',
            'Dual Duct',
          ],
        },
        { key: 'designMaxCfm', label: 'Design max CFM', input: 'number', unit: 'CFM', airflow: true },
        { key: 'designMinCfm', label: 'Design min CFM', input: 'number', unit: 'CFM', airflow: true },
        {
          key: 'heatingCfm',
          label: 'Design heating CFM',
          input: 'number',
          unit: 'CFM',
          required: false,
          airflow: true,
          hint: 'Only if scheduled',
        },
        {
          key: 'fanCfm',
          label: 'Design fan CFM',
          input: 'number',
          unit: 'CFM',
          airflow: true,
          autoNa: [NOT_FAN_POWERED],
        },
        { key: 'ddcAddress', label: 'DDC address', input: 'text' },
      ],
    },
    {
      key: 'unit',
      label: 'Unit data',
      airflow: false,
      fields: [
        { key: 'serial', label: 'Serial number', input: 'text' },
        { key: 'calibrationFactor', label: 'Calibration factor', input: 'number' },
        { key: 'ddcMaxMin', label: 'DDC max / min', input: 'text', hint: 'e.g. 600 / 150' },
      ],
    },
    {
      key: 'performance',
      label: 'Performance (actual)',
      airflow: true,
      fields: [
        { key: 'minCfmActual', label: 'Actual min CFM', input: 'number', unit: 'CFM' },
        { key: 'heatingCfmActual', label: 'Actual heating CFM', input: 'number', unit: 'CFM', autoNa: [NO_HEATING] },
        { key: 'fanCfmActual', label: 'Actual fan CFM', input: 'number', unit: 'CFM', autoNa: [NOT_FAN_POWERED] },
      ],
    },
    {
      key: 'airflow',
      label: 'Airflow',
      airflow: true,
      fields: [
        { key: 'instrument', label: 'Instrument', input: 'select', options: TEMPLATE_LISTS['Airflow.Instrument'] },
      ],
      tables: [{ key: 'outlets', label: 'Outlets', required: true, minRows: 1, tolerance: true }],
    },
    { key: 'photos', label: 'Photos', airflow: false, fields: [], photos: [{ category: 'unit', label: 'Unit / tag' }] },
    remarksSection,
  ],
};
