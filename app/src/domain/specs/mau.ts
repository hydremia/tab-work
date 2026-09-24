/**
 * MAU / supply fan: docs/REQUIRED_FIELDS.md "MAU / supply fan (MAUs sheet)", WORKBOOK_ANALYSIS §4.2.
 * Supply airflow method: Outlets, PSP, Filter Grid or Profile Pressure. Only the chosen method's inputs are
 * required; the other methods' inputs are automatically N/A (even when values were entered before switching:
 * they are kept in the app and come back when the method is switched back, but are not exported). Outlet rows
 * are optional unless the method is Outlets.
 */
import { filterSizesFor, MAU_FILTER_GRID_TYPE, TEMPLATE_LISTS } from '@a2b/workbook/map';
import { identitySection, remarksSection } from './common';
import type { AutoNa, Cond, EquipmentSpec } from './types';
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

type Method = (typeof TEMPLATE_LISTS)['Airflow.Method'][number];
const is = (m: Method): Cond => ({ field: 'method', eq: m });
/** A method is chosen and it is not `m`. */
const otherThan = (m: Method): Cond => ({ all: [{ not: { field: 'method', blank: true } }, { not: is(m) }] });
const notChosen = (m: Method): AutoNa => ({ when: otherThan(m), reason: `method is not ${m}`, overridesValue: true });

export const MAU_SPEC: EquipmentSpec = {
  type: 'mau',
  formComplete: true,
  designCheck: { field: 'designTotalCfm', table: 'supply' },
  totalCheck: { calc: 'mau', label: 'Method total' },
  sections: [
    identitySection(),
    designSection([F.manufacturer, F.model, F.hp, F.unitEsp, F.fanRpm, F.voltage, F.phase, F.designTotalCfm]),
    unitDataSection(['MAU']),
    motorSection,
    driveSection,
    miscSection,
    rpmSection,
    staticSection(),
    {
      key: 'method',
      label: 'Supply airflow method',
      airflow: true,
      calc: 'mauTotal',
      fields: [
        {
          key: 'method',
          label: 'Method used',
          input: 'select',
          options: TEMPLATE_LISTS['Airflow.Method'],
          hint: 'Only the chosen method’s readings are needed',
        },
        {
          key: 'designCfmOverride',
          label: 'Design CFM override',
          input: 'number',
          unit: 'CFM',
          required: false,
          hint: 'Replaces the outlet design total when filled',
        },
        { key: 'methodRemarks', label: 'Method remarks', input: 'text', required: false },
      ],
    },
    {
      key: 'airflow',
      label: 'Outlets',
      airflow: true,
      foldWhen: otherThan('Outlets'),
      foldNote: 'Outlet rows are optional with this method (their design total is the unit design unless overridden).',
      fields: [{ ...instrumentField, requiredWhen: is('Outlets') }, akNotesField],
      tables: [
        {
          key: 'supply',
          label: 'Supply outlets',
          required: false,
          requiredWhen: is('Outlets'),
          minRows: 1,
          tolerance: true,
        },
      ],
    },
    {
      key: 'psp',
      label: 'PSP (perforated supply plenum)',
      airflow: true,
      showWhen: is('PSP'),
      calc: 'psp',
      hint: 'CFM = avg VEL × (L − 2 − 2 × blanks) × W × K ÷ 144 (Evergreen K: 0.88 up to 12", 0.95 from 14")',
      fields: [
        {
          key: 'pspLength',
          label: 'Length',
          input: 'number',
          unit: 'in.',
          requiredWhen: is('PSP'),
          autoNa: [notChosen('PSP')],
        },
        {
          key: 'pspWidth',
          label: 'Width',
          input: 'select',
          options: TEMPLATE_LISTS['PSP.Width'],
          unit: 'in.',
          requiredWhen: is('PSP'),
          autoNa: [notChosen('PSP')],
        },
        {
          key: 'pspBlanks',
          label: 'Number of blanks',
          input: 'number',
          requiredWhen: is('PSP'),
          autoNa: [notChosen('PSP')],
        },
      ],
      sequences: [
        {
          key: 'pspVelocities',
          label: 'Velocity readings',
          count: 20,
          unit: 'fpm',
          requiredWhen: is('PSP'),
          autoNa: [notChosen('PSP')],
        },
      ],
    },
    {
      key: 'filterGrid',
      label: 'Filter grid',
      airflow: true,
      showWhen: is('Filter Grid'),
      calc: 'filterGrid',
      hint: 'Supply Filter (VelGrid): CFM = velocity × free area × 1.35',
      fields: [],
      tables: [
        {
          key: 'filterGrid',
          label: 'Filters',
          required: false,
          requiredWhen: is('Filter Grid'),
          autoNa: [notChosen('Filter Grid')],
          minRows: 1,
          tolerance: false,
          calc: 'filterGrid',
          noun: 'filter',
          columns: [
            { key: 'size', label: 'Filter size', input: 'select', options: filterSizesFor(MAU_FILTER_GRID_TYPE) },
            { key: 'velocity', label: 'Velocity', input: 'number', unit: 'fpm', naMenu: true },
          ],
          readingGroups: [['velocity']],
          fillDown: ['size'],
        },
      ],
    },
    {
      key: 'profile',
      label: 'Burner profile pressure',
      airflow: true,
      showWhen: is('Profile Pressure'),
      calc: 'profile',
      hint: 'CFM from the manufacturer’s curve (0.15–0.65 in. w.g.), interpolated',
      fields: [
        {
          key: 'profileHousing',
          label: 'Housing size',
          input: 'select',
          options: [1, 2, 3, 4, 5],
          requiredWhen: is('Profile Pressure'),
          autoNa: [notChosen('Profile Pressure')],
        },
        {
          key: 'profilePressure',
          label: 'Burner profile pressure',
          input: 'number',
          unit: 'in. w.g.',
          requiredWhen: is('Profile Pressure'),
          autoNa: [notChosen('Profile Pressure')],
        },
      ],
    },
    photosSection(UNIT_TAG_PHOTOS),
    remarksSection,
  ],
};
