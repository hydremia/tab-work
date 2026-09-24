/**
 * What "Duplicate unit" copies (pure): the design / schedule data and the unit's configuration (unit type, drive,
 * motor nameplate, filters, instrument, MAU method, hood filter type, traverse duct …), never readings, serial
 * numbers, remarks or photos. Outlet rows can be copied too, without their readings.
 */
import type { AirflowRow, Equipment, FieldValue, NaMark } from '../data/types';
import type { EquipmentTypeKey } from './equipmentTypes';
import { scheduleTargets } from './scheduleImport';
import { allFields, DEFAULT_READING_GROUPS, getSpec, type RowTableSpec } from './specs';

/** Configuration fields (besides the schedule) a copy keeps: same model of unit, same set-up. */
const CONFIG_KEYS = [
  'unitType',
  'driveType',
  'hasFilters',
  'filters',
  'hasVfd',
  'motorManufacturer',
  'motorRpm',
  'serviceFactor',
  'fla',
  'frame',
  'rotationDesign',
  'instrument',
  'exhaustInstrument',
  'akNotes',
  'exhaustAkNotes',
  'method',
  'designCfmOverride',
  'pspLength',
  'pspWidth',
  'pspBlanks',
  'profileHousing',
  'hoodType',
  'filterManufacturer',
  'filterType',
  'associatedFan',
  'espDesign',
  'fanRpmDesign',
  'speedDesign',
];

export function duplicableKeys(type: EquipmentTypeKey): string[] {
  const inSpec = new Set(allFields(getSpec(type)).map((f) => f.field.key));
  const keys = [...scheduleTargets(type).map((t) => t.key), ...CONFIG_KEYS];
  return [...new Set(keys)].filter((k) => k !== 'designation' && inSpec.has(k));
}

/** Data and N/A marks of the copy. */
export function duplicateData(src: Pick<Equipment, 'type' | 'data' | 'naState'>): {
  data: Record<string, FieldValue>;
  fieldMarks: Record<string, NaMark | null>;
} {
  const data: Record<string, FieldValue> = {};
  const fieldMarks: Record<string, NaMark | null> = {};
  for (const k of duplicableKeys(src.type)) {
    const v = src.data[k];
    if (v !== undefined && v !== null && v !== '') data[k] = v;
    const m = src.naState.fields[k];
    if (m) fieldMarks[k] = m;
  }
  return { data, fieldMarks };
}

function readingColumns(t: RowTableSpec | undefined): Set<string> {
  return new Set((t?.readingGroups ?? DEFAULT_READING_GROUPS).flat());
}

/** A row of the copy: every column but the readings (and their N/A marks). */
export function duplicateRow(
  type: EquipmentTypeKey,
  row: Pick<AirflowRow, 'table' | 'data' | 'na'>,
): { data: Record<string, FieldValue>; na: Record<string, NaMark | null> } {
  const t = getSpec(type)
    .sections.flatMap((s) => s.tables ?? [])
    .find((x) => x.key === row.table);
  const readings = readingColumns(t);
  const data: Record<string, FieldValue> = {};
  const na: Record<string, NaMark | null> = {};
  for (const [k, v] of Object.entries(row.data)) if (!readings.has(k)) data[k] = v;
  for (const [k, v] of Object.entries(row.na)) if (!readings.has(k) && v) na[k] = v;
  return { data, na };
}
