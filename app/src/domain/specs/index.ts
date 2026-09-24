import { TEMPLATE_MAP } from '@a2b/workbook/map';
import type { EquipmentTypeKey } from '../equipmentTypes';
import { identitySection } from './common';
import { RTU_SPEC } from './rtu';
import type { EquipmentSpec, FieldSpec } from './types';
import { VAV_SPEC } from './vav';

export * from './types';

const FULL: Partial<Record<EquipmentTypeKey, EquipmentSpec>> = { rtu: RTU_SPEC, vav: VAV_SPEC };

/** Keys the template map has for a type (schedule + block fields). */
export function mapFieldKeys(type: EquipmentTypeKey): Set<string> {
  const def = TEMPLATE_MAP.equipment.find((e) => e.key === type);
  return new Set([...(def?.ede?.fields ?? []).map((f) => f.key), ...(def?.block.fields ?? []).map((f) => f.key)]);
}

/** Identity-only spec for types whose full form is still to come (Phase 2): they can't turn green yet. */
function genericSpec(type: EquipmentTypeKey): EquipmentSpec {
  const keys = mapFieldKeys(type);
  const base = identitySection();
  const fields: FieldSpec[] = base.fields.filter((f) => f.recordField || keys.has(f.key));
  return { type, formComplete: false, sections: [{ ...base, fields }] };
}

export function getSpec(type: EquipmentTypeKey): EquipmentSpec {
  return FULL[type] ?? genericSpec(type);
}

export function allFields(spec: EquipmentSpec): { field: FieldSpec; section: string }[] {
  return spec.sections.flatMap((s) => s.fields.map((field) => ({ field, section: s.key })));
}
