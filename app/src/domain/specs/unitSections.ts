/**
 * Sections shared by the big unit sheets (RTUs, MAUs, ERVs, Fans): they all use the same data block (rows +2 ... +26,
 * docs/WORKBOOK_ANALYSIS.md §4.1), so the unit data, motor, drive, misc., RPM and static-profile sections are the
 * same data for every one of them; only the unit type (and so the static-profile components) differs.
 */
import { PHASES, TEMPLATE_LISTS } from '@a2b/workbook/map';
import type { AutoNa, FieldSpec, PhotoSpec, SectionSpec } from './types';
import { SP_COMPONENTS, spKey, type SpComponent } from '../staticSlots';

export const ONE_PHASE: AutoNa = { when: { field: 'phase', eq: '1-phase' }, reason: '1-phase' };
export const NOT_BELT: AutoNa = { when: { field: 'driveType', in: ['Direct', 'ECM'] }, reason: 'direct / ECM drive' };
export const DIRECT_RPM: AutoNa = {
  when: { field: 'driveType', in: ['Direct', 'ECM'] },
  reason: 'direct / ECM drive: the fan RPM is the motor RPM',
};
export const NO_VFD: AutoNa = { when: { field: 'hasVfd', notIn: ['Yes'] }, reason: 'no VFD' };
export const NO_FILTERS: AutoNa = { when: { field: 'hasFilters', eq: 'No' }, reason: 'no filters' };
/**
 * A component the unit type does not have: no field on the form and nothing in the workbook (the revision 08 strip has
 * "—" there and skips it).
 */
const absent = (c: string): AutoNa => ({
  when: { componentAbsent: c },
  reason: 'not on this unit type',
  exportBlank: true,
  hide: true,
});
const NO_FILTERS_STATIC: AutoNa = { ...NO_FILTERS, exportBlank: true, hide: true };
const NO_REHEAT: AutoNa = {
  when: { field: 'hasReheat', notIn: ['Yes'] },
  reason: 'no reheat coil',
  exportBlank: true,
  hide: true,
};

/** A 3-point profile: the component's leaving static is not measured (blank in the workbook). */
const NOT_TAPPED = (c: string): AutoNa => ({
  when: { tapSkipped: c },
  reason: '3-point profile: not measured',
  exportBlank: true,
});

const LEAVING_LABEL: Record<SpComponent, string> = {
  Filter: 'Leaving filter',
  Wheel: 'Leaving energy recovery wheel',
  Core: 'Leaving core',
  Coil: 'Leaving cooling coil',
  Desiccant: 'Leaving desiccant wheel',
  Reheat: 'Leaving reheat coil',
  Burner: 'Leaving burner',
  Fan: 'Leaving fan',
  Heat: 'Leaving heat section',
};

const leaving = (c: SpComponent): FieldSpec => ({
  key: spKey(c),
  label: LEAVING_LABEL[c],
  input: 'number',
  unit: 'in. w.g.',
  component: c,
  autoNa: [absent(c), ...(c === 'Filter' ? [NO_FILTERS_STATIC] : c === 'Reheat' ? [NO_REHEAT] : []), NOT_TAPPED(c)],
  ...(c === 'Fan'
    ? {
        // before a heat section (blow-through) the discharge past it gives the TSP
        requiredWhen: { componentAbsent: 'Heat' },
        hint: 'On a blow-through unit (heat after the fan) the fan leaving static is usually not accessible: mark it Not Acc.; the discharge past the heat gives the TSP.',
      }
    : {}),
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
  // the unit ESP actual (from the static profile) is shown next to the design unit ESP
  const calc = fields.some((f) => f.key === 'unitEsp') ? ({ calc: 'unitEsp' } as const) : {};
  return { key: 'design', label: 'Design data (schedule)', airflow: false, fields, ...calc };
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
  calc: 'motor',
  fields: [
    { key: 'motorManufacturer', label: 'Motor manufacturer', input: 'text' },
    // the nameplate HP (rev 07 E P+17), checked against the scheduled HP (Design data) and used by the estimated BHP;
    // optional (units already complete stay green)
    { key: 'motorHp', label: 'Motor HP (nameplate)', input: 'number', unit: 'hp', required: false },
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
    { key: 'motorSheave', label: 'Motor sheave', input: 'text', autoNa: [NOT_BELT], hint: 'e.g. 2VP60' },
    { key: 'motorBore', label: 'Motor bore (shaft)', input: 'text', autoNa: [NOT_BELT], hint: 'e.g. 1-3/8' },
    { key: 'fanPulley', label: 'Fan pulley', input: 'text', autoNa: [NOT_BELT] },
    { key: 'fanBore', label: 'Fan bore (shaft)', input: 'text', autoNa: [NOT_BELT] },
    { key: 'belts', label: 'Belt(s)', input: 'text', autoNa: [NOT_BELT] },
    { key: 'cToC', label: 'C to C', input: 'text', autoNa: [NOT_BELT] },
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
    // initial and final both required (the same value when nothing was changed); on a direct / ECM drive the fan
    // turns at motor speed, so the fan RPM is recorded and the motor RPM row is N/A
    { key: 'motorRpmInitial', label: 'Motor RPM (initial)', input: 'number', unit: 'rpm', autoNa: [DIRECT_RPM] },
    { key: 'motorRpmFinal', label: 'Motor RPM (final)', input: 'number', unit: 'rpm', autoNa: [DIRECT_RPM] },
    { key: 'fanRpmInitial', label: 'Fan RPM (initial)', input: 'number', unit: 'rpm' },
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

export function staticSection(enteringLabel = 'Entering static (unit inlet)'): SectionSpec {
  return {
    key: 'static',
    label: 'Static pressure profile',
    airflow: false,
    calc: 'staticProfile',
    fields: [
      {
        key: 'spTaps',
        label: 'Static taps',
        input: 'select',
        options: ['Full profile', '3-point'],
        required: false,
        hint: '3-point: entering, fan inlet (the leaving static of the last component before the fan) and discharge (the last component)',
      },
      {
        key: 'hasReheat',
        label: 'Has reheat coil?',
        input: 'yesno',
        appOnly: true,
        required: false,
        autoNa: [{ when: { componentAbsent: 'Reheat' }, reason: 'not on this unit type', hide: true }],
        hint: 'Hot gas or hot water reheat after the cooling coil',
      },
      { key: 'spEntering', label: enteringLabel, input: 'number', unit: 'in. w.g.' },
      ...SP_COMPONENTS.map(leaving),
    ],
  };
}

export const UNIT_TAG_PHOTOS: readonly PhotoSpec[] = [
  { category: 'unit', label: 'Unit' },
  { category: 'tag', label: 'Unit label / tag' },
];

/** The motor nameplate / label (or the motor itself when it has no visible label, e.g. a direct-drive motor). */
export const MOTOR_PHOTO: PhotoSpec = { category: 'motor', label: 'Motor / nameplate', section: 'motor' };

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
