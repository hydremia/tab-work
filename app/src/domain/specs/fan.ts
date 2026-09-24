/** Exhaust / transfer / kitchen exhaust fans: docs/REQUIRED_FIELDS.md "Fans: EF, TF, KEF (Fans sheet)". */
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

export const FAN_SPEC: EquipmentSpec = {
  type: 'fan',
  formComplete: true,
  designCheck: { field: 'designTotalCfm', table: 'outlets' },
  sections: [
    identitySection(),
    // no design OA CFM (N/A for fans; the schedule column is info only)
    designSection([F.manufacturer, F.model, F.hp, F.unitEsp, F.fanRpm, F.voltage, F.phase, F.designTotalCfm]),
    // unit type EF: only the fan is on the static profile (filter, wheel, coil and heat are automatically N/A)
    unitDataSection(['EF']),
    motorSection,
    driveSection,
    miscSection,
    rpmSection,
    staticSection('Entering static (fan inlet)'),
    {
      key: 'airflow',
      label: 'Airflow',
      airflow: true,
      fields: [instrumentField, akNotesField],
      tables: [{ key: 'outlets', label: 'Registers / grilles', required: true, minRows: 1, tolerance: true }],
    },
    photosSection(UNIT_TAG_PHOTOS),
    remarksSection,
  ],
};
