/**
 * Pumps (hydronic workbook, Pumps sheet + {Hydronic Data Entry}): NEBB 5.3.13 (constant speed / VFD) and 5.3.14
 * (integrated variable speed: shut-off test and gauge readings only "if available").
 * docs/HYDRONIC_REQUIREMENTS.md §1 and §3 (pump test sequence).
 */
import { HYDRONIC_LISTS, PHASES } from '@a2b/workbook/map';
import { remarksSection } from './common';
import type { AutoNa, Cond, EquipmentSpec } from './types';
import { MOTOR_PHOTO, motorSection, photosSection, UNIT_TAG_PHOTOS } from './unitSections';

const INTEGRATED: Cond = { field: 'pumpType', eq: 'Integrated variable speed' };
const NOT_INTEGRATED: Cond = { not: INTEGRATED };
const NO_SHUTOFF: AutoNa = { when: INTEGRATED, reason: 'integrated variable-speed pump (NEBB 5.3.14)' };
const CONSTANT: AutoNa = { when: { field: 'pumpType', eq: 'Constant speed' }, reason: 'constant speed' };

export const PUMP_SPEC: EquipmentSpec = {
  type: 'pump',
  totalCheck: { calc: 'pump', label: 'Pump flow' },
  sections: [
    {
      key: 'identity',
      label: 'Identity',
      airflow: true,
      locked: true,
      fields: [
        { key: 'designation', label: 'Designation', input: 'text', recordField: 'designation' },
        {
          key: 'service',
          label: 'Service',
          input: 'text',
          suggestions: ['Chilled Water', 'Hot Water', 'Condenser Water'],
        },
        {
          key: 'system',
          label: 'System',
          input: 'text',
          hint: 'Same name as the valve system it serves (CHW, HW …): the System Summary adds them up by it',
        },
        { key: 'location', label: 'Location', input: 'text' },
      ],
    },
    {
      key: 'design',
      label: 'Design data (schedule)',
      airflow: true,
      fields: [
        { key: 'manufacturer', label: 'Manufacturer', input: 'text' },
        { key: 'model', label: 'Model / size', input: 'text' },
        { key: 'pumpType', label: 'Pump type', input: 'select', options: HYDRONIC_LISTS['Pump.Type'] },
        { key: 'designGpm', label: 'Design flow', input: 'number', unit: 'GPM' },
        { key: 'designHead', label: 'Design head', input: 'number', unit: 'ft w.g.' },
        { key: 'connectedLoadGpm', label: 'Total connected load', input: 'number', unit: 'GPM', required: false },
        { key: 'hp', label: 'Motor HP', input: 'number', unit: 'hp' },
        { key: 'rpm', label: 'Pump / motor RPM', input: 'number', unit: 'rpm' },
        { key: 'impeller', label: 'Impeller', input: 'number', unit: 'in.', required: false },
        { key: 'voltage', label: 'Voltage', input: 'number', unit: 'V' },
        { key: 'phase', label: 'Phase', input: 'select', options: PHASES },
      ],
    },
    {
      key: 'unit',
      label: 'Unit data and final flow',
      airflow: true,
      fields: [
        { key: 'serial', label: 'Serial number', input: 'text' },
        { key: 'flowMethod', label: 'Flow measured by', input: 'select', options: HYDRONIC_LISTS['Flow.Method'] },
        {
          key: 'actualGpm',
          label: 'Final flow',
          input: 'number',
          unit: 'GPM',
          hint: 'From the pump curve at the final head, or a meter',
        },
        { key: 'actualRpm', label: 'Operating RPM', input: 'number', unit: 'rpm', requiredWhen: NOT_INTEGRATED },
        {
          key: 'actualImpeller',
          label: 'Impeller (verified)',
          input: 'number',
          unit: 'in.',
          required: false,
          hint: 'The curve the shut-off head lands on',
        },
        { key: 'meterGpm', label: 'Flow by meter / valves', input: 'number', unit: 'GPM', required: false },
      ],
    },
    {
      key: 'pumpTest',
      label: 'Pump test (psi at the gauges)',
      airflow: true,
      calc: 'pumpTest',
      hint: 'Head = (discharge − suction) × 2.31 / SG + gauge elevation difference',
      fields: [
        { key: 'standingPsi', label: 'Pump off (standing pressure)', input: 'number', unit: 'psi' },
        { key: 'shutoffSuction', label: 'Shut-off suction', input: 'number', unit: 'psi', autoNa: [NO_SHUTOFF] },
        { key: 'shutoffDischarge', label: 'Shut-off discharge', input: 'number', unit: 'psi', autoNa: [NO_SHUTOFF] },
        { key: 'wideOpenSuction', label: 'Wide-open suction', input: 'number', unit: 'psi', required: false },
        { key: 'wideOpenDischarge', label: 'Wide-open discharge', input: 'number', unit: 'psi', required: false },
        { key: 'finalSuction', label: 'Final suction', input: 'number', unit: 'psi', requiredWhen: NOT_INTEGRATED },
        { key: 'finalDischarge', label: 'Final discharge', input: 'number', unit: 'psi', requiredWhen: NOT_INTEGRATED },
        {
          key: 'specificGravity',
          label: 'Specific gravity',
          input: 'number',
          required: false,
          hint: 'Blank = water (1.00)',
        },
        {
          key: 'gaugeElevation',
          label: 'Gauge elevation difference',
          input: 'number',
          unit: 'ft',
          required: false,
          hint: 'Discharge gauge above suction gauge (+)',
        },
      ],
    },
    {
      ...motorSection,
      fields: [
        ...motorSection.fields,
        { key: 'vfd', label: 'VFD Hz / speed setting', input: 'text', autoNa: [CONSTANT] },
        {
          key: 'finalSetpoints',
          label: 'Final setpoints',
          input: 'text',
          required: false,
          hint: 'e.g. ΔP setpoint 12 psi',
        },
      ],
    },
    photosSection([...UNIT_TAG_PHOTOS, MOTOR_PHOTO]),
    remarksSection,
  ],
};
