/** ERV / heat recovery: docs/REQUIRED_FIELDS.md "ERV / heat recovery (ERVs sheet)", WORKBOOK_ANALYSIS §4.3. */
import { TEMPLATE_LISTS } from '@a2b/workbook/map';
import { identitySection, remarksSection } from './common';
import type { EquipmentSpec } from './types';
import {
  akNotesField,
  designSection,
  driveSection,
  instrumentField,
  miscSection,
  motorSection,
  photosSection,
  rpmSection,
  SCHEDULE_FIELDS as F,
  staticSection,
  UNIT_TAG_PHOTOS,
  unitDataSection,
} from './unitSections';

export const ERV_SPEC: EquipmentSpec = {
  type: 'erv',
  designCheck: [
    { field: 'designSupplyCfm', table: 'supply', label: 'supply outlets' },
    { field: 'designExhaustCfm', table: 'exhaust', label: 'exhaust inlets' },
  ],
  sections: [
    identitySection(),
    // no unit ESP line on the ERV page
    designSection([
      F.manufacturer,
      F.model,
      F.hp,
      F.fanRpm,
      F.voltage,
      F.phase,
      { key: 'designSupplyCfm', label: 'Design supply CFM', input: 'number', unit: 'CFM', airflow: true },
      { key: 'designExhaustCfm', label: 'Design exhaust CFM', input: 'number', unit: 'CFM', airflow: true },
      { key: 'designSupplyDp', label: 'Design supply ΔP', input: 'number', unit: 'in. w.g.' },
      { key: 'designExhaustDp', label: 'Design exhaust ΔP', input: 'number', unit: 'in. w.g.' },
    ]),
    unitDataSection(['ERV']),
    motorSection,
    driveSection,
    miscSection,
    rpmSection,
    staticSection(),
    {
      key: 'pressure',
      label: 'Pressure drops (actual)',
      airflow: false,
      fields: [
        { key: 'supplyDpActual', label: 'Supply ΔP (actual)', input: 'number', unit: 'in. w.g.' },
        { key: 'exhaustDpActual', label: 'Exhaust ΔP (actual)', input: 'number', unit: 'in. w.g.' },
      ],
    },
    {
      key: 'airflow',
      label: 'Primary (supply) airflow',
      airflow: true,
      fields: [{ ...instrumentField, label: 'Supply instrument' }, akNotesField],
      tables: [{ key: 'supply', label: 'Supply outlets', required: true, minRows: 1, tolerance: true }],
    },
    {
      key: 'exhaustAirflow',
      label: 'Secondary (exhaust) airflow',
      airflow: true,
      calc: 'ervTotals',
      fields: [
        {
          key: 'exhaustInstrument',
          label: 'Exhaust instrument',
          input: 'select',
          options: TEMPLATE_LISTS['Airflow.Instrument'],
        },
        { key: 'exhaustAkNotes', label: 'Ak basis / notes', input: 'text', required: false },
      ],
      tables: [{ key: 'exhaust', label: 'Exhaust inlets', required: true, minRows: 1, tolerance: true, noun: 'inlet' }],
    },
    photosSection(UNIT_TAG_PHOTOS),
    remarksSection,
  ],
};
