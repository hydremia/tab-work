/**
 * Chillers, cooling towers, boilers and heat exchangers (hydronic workbook, Plant Equipment sheet): NEBB 5.3.18 -
 * 5.3.24 ask for water flow and ΔP only (design and actual), per water circuit. A unit takes two rows on the sheet:
 * circuit 1 and circuit 2 (water-cooled chiller: evaporator + condenser; heat exchanger: primary + secondary).
 */
import { HYDRONIC_LISTS } from '@a2b/workbook/map';
import { remarksSection } from './common';
import type { AutoNa, Cond, EquipmentSpec } from './types';
import { photosSection, UNIT_TAG_PHOTOS } from './unitSections';

const TWO_CIRCUITS: Cond = {
  field: 'plantType',
  in: ['Chiller (water-cooled)', 'Heat exchanger (water-water)'],
};
const ONE_CIRCUIT: AutoNa = { when: { not: TWO_CIRCUITS }, reason: 'one water circuit' };
const circuit = (n: 1 | 2) => {
  const extra = n === 2 ? { autoNa: [ONE_CIRCUIT] } : {};
  return [
    { key: `circuit${n}`, label: 'Circuit', input: 'select' as const, options: HYDRONIC_LISTS.Circuit, ...extra },
    { key: `designGpm${n}`, label: 'Design flow', input: 'number' as const, unit: 'GPM', ...extra },
    { key: `designDp${n}`, label: 'Design ΔP', input: 'number' as const, ...extra },
    { key: `actualGpm${n}`, label: 'Actual flow', input: 'number' as const, unit: 'GPM', ...extra },
    { key: `actualDp${n}`, label: 'Actual ΔP', input: 'number' as const, ...extra },
    {
      key: `method${n}`,
      label: 'Flow measured by',
      input: 'select' as const,
      options: HYDRONIC_LISTS['Flow.Method'],
      ...extra,
    },
  ];
};

export const PLANT_SPEC: EquipmentSpec = {
  type: 'plant',
  totalCheck: { calc: 'plant', label: 'Water flow' },
  sections: [
    {
      key: 'identity',
      label: 'Identity',
      airflow: true,
      locked: true,
      fields: [
        { key: 'designation', label: 'Designation', input: 'text', recordField: 'designation' },
        { key: 'plantType', label: 'Type', input: 'select', options: HYDRONIC_LISTS['Plant.Type'] },
        { key: 'service', label: 'Service', input: 'text', required: false },
        { key: 'manufacturer', label: 'Manufacturer', input: 'text' },
        { key: 'model', label: 'Model', input: 'text' },
        { key: 'serial', label: 'Serial number', input: 'text' },
      ],
    },
    {
      key: 'circuit1',
      label: 'Water circuit 1',
      airflow: true,
      hint: 'Evaporator / primary / the only water circuit',
      fields: circuit(1),
    },
    {
      key: 'circuit2',
      label: 'Water circuit 2',
      airflow: true,
      hint: 'Condenser / secondary',
      fields: circuit(2),
    },
    photosSection(UNIT_TAG_PHOTOS),
    remarksSection,
  ],
};
