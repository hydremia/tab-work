/**
 * Sections shared by the big unit sheets (RTUs, MAUs, ERVs, Fans): they all use the same data block (rows +2 ... +26,
 * docs/WORKBOOK_ANALYSIS.md §4.1), so the unit data, motor, drive, misc., RPM and static-profile sections are the
 * same data for every one of them; only the unit type (and so the static-profile components) differs.
 */
import { PHASES, TEMPLATE_LISTS } from '@a2b/workbook/map';
import type { AutoNa, FieldSpec, PhotoSpec, SectionSpec } from './types';

export const ONE_PHASE: AutoNa = { when: { field: 'phase', eq: '1-phase' }, reason: '1-phase' };
export const NOT_BELT: AutoNa = { when: { field: 'driveType', in: ['Direct', 'ECM'] }, reason: 'direct / ECM drive' };
export const NO_VFD: AutoNa = { when: { field: 'hasVfd', notIn: ['Yes'] }, reason: 'no VFD' };
export const NO_FILTERS: AutoNa = { when: { field: 'hasFilters', eq: 'No' }, reason: 'no filters' };
const absent = (n: number): AutoNa => ({ when: { componentAbsent: n }, reason: 'not on this unit type' });

const leaving = (n: number, extra: AutoNa[] = []): FieldSpec => ({
  key: `spLeaving${n}`,
  label: `Leaving component ${n}`,
  input: 'number',
  unit: 'in. w.g.',
  component: n,
  autoNa: [absent(n), ...extra],
});

/** Schedule fields every unit sheet shares (EDE columns E-O). */
export const SCHEDULE_FIELDS = {
  manufacturer: { key: 'manufacturer', label: 'Manufacturer', input: 'text' },
  model: { key: 'model', label: 'Model', input: 'text' },
  hp: { key: 'hp', label: 'HP', input: 'number', unit: 'hp' },
  unitEsp: { key: 'unitEsp', label: 'Unit ESP', input: 'number', unit: 'in. w.g.' },
  fanRpm: { key: 'fanRpm', label: 'Fan RPM', input: 'number', unit: 'rpm' },
  voltage: { key: 'voltage', label: 'Voltage', input: 'number', unit: 'V' },
  phase: { key: 'phase', label: 'Phase', input: 'select', options: PHASES },
  designTotalCfm: { key: 'designTotalCfm', label: 'Design total CFM', input: 'number', unit: 'CFM', airflow: true },
} as const satisfies Record<string, FieldSpec>;

export function designSection(fields: readonly FieldSpec[]): SectionSpec {
  return { key: 'design', label: 'Design data (schedule)', airflow: false, fields };
}

/** Unit type (sets the static-profile components) + serial number. */
export function unitDataSection(unitTypes: readonly string[]): SectionSpec {
  return {
    key: 'unit',
    label: 'Unit data',
    airflow: false,
    fields: [
      {
        key: 'unitType',
        label: 'Unit type',
        input: 'select',
        options: unitTypes,
        preset: unitTypes[0],
        hint: 'Sets which static-profile components apply',
      },
      { key: 'serial', label: 'Serial number', input: 'text' },
    ],
  };
}

export const motorSection: SectionSpec = {
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
};

export const driveSection: SectionSpec = {
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
};

export const miscSection: SectionSpec = {
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
};

export const rpmSection: SectionSpec = {
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
};

export function staticSection(enteringLabel = 'Entering static (first component)'): SectionSpec {
  return {
    key: 'static',
    label: 'Static pressure profile',
    airflow: false,
    fields: [
      { key: 'spEntering', label: enteringLabel, input: 'number', unit: 'in. w.g.' },
      leaving(1, [NO_FILTERS]),
      leaving(2),
      leaving(3),
      leaving(4),
      leaving(5),
    ],
  };
}

export const UNIT_TAG_PHOTOS: readonly PhotoSpec[] = [
  { category: 'unit', label: 'Unit' },
  { category: 'tag', label: 'Unit label / tag' },
];

export const photosSection = (photos: readonly PhotoSpec[]): SectionSpec => ({
  key: 'photos',
  label: 'Photos',
  airflow: false,
  fields: [],
  photos,
});

export const instrumentField: FieldSpec = {
  key: 'instrument',
  label: 'Instrument',
  input: 'select',
  options: TEMPLATE_LISTS['Airflow.Instrument'],
};
export const akNotesField: FieldSpec = { key: 'akNotes', label: 'Ak basis / notes', input: 'text', required: false };
