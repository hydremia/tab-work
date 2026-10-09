import type { EquipmentTypeKey } from '../equipmentTypes';
import { ERV_SPEC } from './erv';
import { FAN_SPEC } from './fan';
import { FLOW_MEASUREMENT_SPEC } from './flowMeasurement';
import { HOOD_SPEC } from './hood';
import { MAU_SPEC } from './mau';
import { PLANT_SPEC } from './plant';
import { PUMP_SPEC } from './pump';
import { RTU_SPEC } from './rtu';
import { SMALL_FAN_SPEC } from './smallFan';
import { TRAVERSE_SPEC } from './traverse';
import type { EquipmentSpec, FieldSpec } from './types';
import { VALVE_SYSTEM_SPEC } from './valveSystem';
import { VAV_SPEC } from './vav';

export * from './types';

const SPECS: Record<EquipmentTypeKey, EquipmentSpec> = {
  rtu: RTU_SPEC,
  mau: MAU_SPEC,
  erv: ERV_SPEC,
  fan: FAN_SPEC,
  smallFan: SMALL_FAN_SPEC,
  vav: VAV_SPEC,
  hood: HOOD_SPEC,
  traverse: TRAVERSE_SPEC,
  pump: PUMP_SPEC,
  valveSystem: VALVE_SYSTEM_SPEC,
  plant: PLANT_SPEC,
  flowMeasurement: FLOW_MEASUREMENT_SPEC,
};

export function getSpec(type: EquipmentTypeKey): EquipmentSpec {
  return SPECS[type];
}

/** The unit type a unit sheet's blocks are preset to (RTU / MAU / ERV / EF), for units that leave it unchanged. */
export function presetUnitType(type: string): string | number | undefined {
  return SPECS[type as EquipmentTypeKey]?.sections.flatMap((s) => s.fields).find((f) => f.key === 'unitType')?.preset;
}

export function allFields(spec: EquipmentSpec): { field: FieldSpec; section: string }[] {
  return spec.sections.flatMap((s) => s.fields.map((field) => ({ field, section: s.key })));
}
