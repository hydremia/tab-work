/** RTU / AHU / DOAS: docs/REQUIRED_FIELDS.md "RTU / AHU / DOAS (RTUs sheet)". */
import { identitySection, NO_OA, remarksSection } from './common';
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

export const RTU_SPEC: EquipmentSpec = {
  type: 'rtu',
  designCheck: { field: 'designTotalCfm', table: 'supply' },
  sections: [
    identitySection(),
    designSection([
      F.manufacturer,
      F.model,
      F.hp,
      F.unitEsp,
      F.fanRpm,
      F.voltage,
      F.phase,
      F.designTotalCfm,
      {
        key: 'designOaCfm',
        label: 'Design OA CFM',
        input: 'number',
        unit: 'CFM',
        airflow: true,
        hint: 'Enter 0 when the unit has no outside air',
      },
    ]),
    unitDataSection(['RTU', 'DOAS']),
    motorSection,
    driveSection,
    miscSection,
    rpmSection,
    {
      key: 'oa',
      label: 'OA damper',
      airflow: true,
      fields: [
        { key: 'oaDamper', label: 'OA damper position', input: 'text', autoNa: [NO_OA], hint: 'e.g. 35 % open' },
      ],
    },
    staticSection(),
    {
      key: 'airflow',
      label: 'Airflow',
      airflow: true,
      fields: [instrumentField, akNotesField],
      tables: [
        { key: 'supply', label: 'Supply outlets', required: true, minRows: 1, tolerance: true },
        { key: 'return', label: 'Return inlets', required: false, tolerance: true, firstRowDesignComputed: true },
        { key: 'oa', label: 'Outside air', required: true, minRows: 1, tolerance: true, autoNa: [NO_OA] },
      ],
    },
    photosSection([...UNIT_TAG_PHOTOS, { category: 'oa_damper', label: 'OA damper', autoNa: [NO_OA] }]),
    remarksSection,
  ],
};
