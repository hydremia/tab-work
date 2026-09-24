/** Project Information fields (Info tab), shared by the form and the change history's labels. */
import type { FieldSpec } from './specs';

export const INFO_FIELDS: readonly FieldSpec[] = [
  { key: 'name', label: 'Project name', input: 'text' },
  { key: 'address', label: 'Physical address', input: 'text' },
  { key: 'architect', label: 'Architect', input: 'text', required: false },
  { key: 'mechanicalEngineer', label: 'Mechanical engineer', input: 'text' },
  { key: 'electricalEngineer', label: 'Electrical engineer', input: 'text', required: false },
  { key: 'generalContractor', label: 'General contractor', input: 'text', required: false },
  { key: 'mechanicalContractor', label: 'Mechanical contractor', input: 'text' },
  { key: 'tabDate', label: 'TAB date', input: 'date' },
  { key: 'technicians', label: 'Technician(s)', input: 'text' },
  { key: 'projectManager', label: 'Project manager', input: 'text' },
  { key: 'reportDate', label: 'Report date', input: 'date' },
  { key: 'narrative', label: 'Narrative: system set-up description', input: 'textarea' },
];
