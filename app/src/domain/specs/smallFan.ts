/**
 * Small exhaust fans (direct drive under 1/6 hp, NEBB 5.3.6): docs/REQUIRED_FIELDS.md "Small exhaust fans".
 * R6: manufacturer, model, serial, measured amps, design CFM and the airflow are required; everything else is optional.
 */
import { PHASES } from '@a2b/workbook/map';
import { identitySection, remarksSection } from './common';
import type { EquipmentSpec } from './types';
import { instrumentField, photosSection } from './unitSections';

export const SMALL_FAN_SPEC: EquipmentSpec = {
  type: 'smallFan',
  designCheck: { field: 'designCfm', table: 'outlets' },
  sections: [
    identitySection(),
    {
      key: 'unit',
      label: 'Fan data',
      airflow: false,
      fields: [
        { key: 'manufacturer', label: 'Manufacturer', input: 'text' },
        { key: 'model', label: 'Model', input: 'text' },
        { key: 'serial', label: 'Serial number', input: 'text' },
        { key: 'amps', label: 'Measured amps', input: 'number', unit: 'A' },
      ],
    },
    {
      key: 'optional',
      label: 'Optional data',
      airflow: false,
      fields: [
        { key: 'hp', label: 'HP', input: 'number', unit: 'hp', required: false },
        { key: 'voltage', label: 'Voltage', input: 'number', unit: 'V', required: false },
        { key: 'phase', label: 'Phase', input: 'select', options: PHASES, required: false },
        { key: 'espDesign', label: 'Unit ESP (design)', input: 'number', unit: 'in. w.g.', required: false },
        { key: 'espActual', label: 'Unit ESP (actual)', input: 'number', unit: 'in. w.g.', required: false },
        { key: 'fanRpmDesign', label: 'Fan RPM (design)', input: 'number', unit: 'rpm', required: false },
        { key: 'fanRpmActual', label: 'Fan RPM (actual)', input: 'number', unit: 'rpm', required: false },
        { key: 'speedDesign', label: 'Speed setting (design)', input: 'text', required: false },
        { key: 'speedActual', label: 'Speed setting (actual)', input: 'text', required: false },
        { key: 'finalSettings', label: 'Final settings', input: 'text', required: false },
      ],
    },
    {
      key: 'airflow',
      label: 'Airflow',
      airflow: true,
      fields: [{ key: 'designCfm', label: 'Design CFM', input: 'number', unit: 'CFM' }, instrumentField],
      tables: [{ key: 'outlets', label: 'Outlets', required: true, minRows: 1, tolerance: true }],
    },
    photosSection([{ category: 'unit', label: 'Unit / tag' }]),
    remarksSection,
  ],
};
