/** Exhaust / transfer / kitchen exhaust fans: docs/REQUIRED_FIELDS.md "Fans: EF, TF, KEF (Fans sheet)". */
import { identitySection, remarksSection } from './common';
import type { AutoNa, EquipmentSpec } from './types';
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
  MOTOR_PHOTO,
  unitDataSection,
} from './unitSections';

/** Airflow measured at the hood(s) that name this fan (equipmentCalcs.fanAtHood): no grilles, the hood's instrument. */
const AT_HOOD: AutoNa = {
  when: {
    any: [
      { field: 'measuredAt', eq: 'Hood' },
      {
        all: [
          { field: 'measuredAt', blank: true },
          { field: '_hoodLinked', eq: 'Yes' },
        ],
      },
    ],
  },
  reason: 'measured at the hood',
};

export const FAN_SPEC: EquipmentSpec = {
  type: 'fan',
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
      calc: 'fanHood',
      fields: [
        {
          key: 'measuredAt',
          label: 'Measured at',
          input: 'select',
          options: ['Grilles', 'Hood'],
          required: false,
          appOnly: true,
          hint: 'Hood: the airflow is read at the kitchen hood(s) that name this fan (automatic when a hood names it)',
        },
        { ...instrumentField, autoNa: [AT_HOOD] },
        akNotesField,
      ],
      tables: [
        {
          key: 'outlets',
          label: 'Registers / grilles',
          required: true,
          minRows: 1,
          tolerance: true,
          autoNa: [AT_HOOD],
        },
      ],
    },
    photosSection([...UNIT_TAG_PHOTOS, MOTOR_PHOTO]),
    remarksSection,
  ],
};
