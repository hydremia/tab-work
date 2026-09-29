/**
 * Balancing valves of one system (hydronic workbook, Valves sheet: one page per system, 38 valves): NEBB 5.3.15
 * (fixed / adjustable orifice: setting, ΔP, calculated flow) and 5.3.16 (self-adjusting: tag flow, ΔP in range).
 * The page's designation is the system name.
 */
import { HYDRONIC_LISTS } from '@a2b/workbook/map';
import { remarksSection } from './common';
import type { EquipmentSpec, RowColumnSpec } from './types';

export const VALVE_COLUMNS: readonly RowColumnSpec[] = [
  { key: 'no', label: 'No.', input: 'text', required: false },
  { key: 'tag', label: 'Valve', input: 'text' },
  { key: 'serves', label: 'Serves', input: 'text', wide: true },
  { key: 'makeModel', label: 'Make / model', input: 'text', wide: true },
  { key: 'size', label: 'Size', input: 'text' },
  { key: 'type', label: 'Type', input: 'select', options: HYDRONIC_LISTS['Valve.Type'] },
  { key: 'designGpm', label: 'Design', input: 'number', unit: 'GPM' },
  { key: 'initialGpm', label: 'Initial', input: 'number', unit: 'GPM', naMenu: true },
  { key: 'setting', label: 'Setting', input: 'number', required: false, naMenu: true },
  { key: 'dp', label: 'ΔP', input: 'number', required: false, naMenu: true },
  { key: 'finalGpm', label: 'Final', input: 'number', unit: 'GPM', naMenu: true },
  { key: 'wideOpen', label: 'Wide open', input: 'select', options: HYDRONIC_LISTS['Wide.Open'], required: false },
];

export const VALVE_SYSTEM_SPEC: EquipmentSpec = {
  type: 'valveSystem',
  sections: [
    {
      key: 'identity',
      label: 'System',
      airflow: true,
      locked: true,
      fields: [
        {
          key: 'designation',
          label: 'System name',
          input: 'text',
          recordField: 'designation',
          hint: 'Same name on its pumps (CHW, HW …)',
        },
        {
          key: 'service',
          label: 'Service',
          input: 'text',
          suggestions: ['Chilled Water', 'Hot Water', 'Condenser Water'],
        },
        { key: 'pumps', label: 'Pump(s)', input: 'text', required: false },
        { key: 'instrument', label: 'Instrument', input: 'text' },
        { key: 'dpUnits', label: 'ΔP measured in', input: 'select', options: HYDRONIC_LISTS['DP.Units'] },
        { key: 'method', label: 'Balancing method', input: 'select', options: HYDRONIC_LISTS['Balance.Method'] },
        {
          key: 'vfdSetpoint',
          label: 'VFD / ΔP setpoint',
          input: 'text',
          required: false,
          hint: 'For the System Summary (NEBB 9.5.3: give it to the controls contractor)',
        },
      ],
    },
    {
      key: 'valves',
      label: 'Balancing valves',
      airflow: true,
      fields: [],
      tables: [
        {
          key: 'valves',
          label: 'Valves',
          required: true,
          minRows: 1,
          tolerance: true,
          columns: VALVE_COLUMNS,
          readingGroups: [['initialGpm'], ['finalGpm']],
          calc: 'valve',
          fillDown: ['serves', 'makeModel', 'size', 'type'],
          noun: 'valve',
        },
      ],
    },
    {
      key: 'final',
      label: 'Balancing and final settings',
      airflow: true,
      calc: 'balancing',
      fields: [
        {
          key: 'memoryStops',
          label: 'Memory stops set / valves marked',
          input: 'select',
          options: HYDRONIC_LISTS['Yes.No'],
          hint: 'NEBB 9.5.1 u: at the final settings',
        },
      ],
    },
    remarksSection,
  ],
};
