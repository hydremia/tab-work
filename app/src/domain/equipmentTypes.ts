import { TEMPLATE_MAP } from '@a2b/workbook/map';

export type EquipmentTypeKey = 'rtu' | 'mau' | 'erv' | 'fan' | 'smallFan' | 'vav' | 'hood' | 'traverse';

export interface EquipmentTypeInfo {
  key: EquipmentTypeKey;
  /** Short plural label for lists ("RTUs"). */
  plural: string;
  /** One-line description (from the template map). */
  label: string;
  /** Designation prefix suggested for new units ("RTU-" -> RTU-3, "EF-S" -> EF-S4). */
  prefix: string;
  /** Template capacity (slots on the sheet). */
  capacity: number;
  /** Soft limit with a warning (Building Balance lists small fans 1-30 only). */
  warnAbove?: number;
}

const META: Record<EquipmentTypeKey, { plural: string; prefix: string; warnAbove?: number }> = {
  rtu: { plural: 'RTUs', prefix: 'RTU-' },
  mau: { plural: 'MAUs', prefix: 'MAU-' },
  erv: { plural: 'ERVs', prefix: 'ERV-' },
  fan: { plural: 'Fans', prefix: 'EF-' },
  smallFan: { plural: 'Small fans', prefix: 'EF-S', warnAbove: 30 },
  vav: { plural: 'VAVs', prefix: 'VAV-' },
  hood: { plural: 'Hoods', prefix: 'H-' },
  traverse: { plural: 'Traverses', prefix: 'T-' },
};

/** Equipment types in workbook order, capacities taken from the template map. */
export const EQUIPMENT_TYPES: readonly EquipmentTypeInfo[] = TEMPLATE_MAP.equipment.map((e) => {
  const key = e.key as EquipmentTypeKey;
  return { key, label: e.label, capacity: e.capacity, ...META[key] };
});

export function equipmentType(key: EquipmentTypeKey): EquipmentTypeInfo {
  const t = EQUIPMENT_TYPES.find((x) => x.key === key);
  if (!t) throw new Error(`unknown equipment type ${key}`);
  return t;
}

/** Lowest free slot (1-based), or null when the type is at capacity. */
export function nextFreeSlot(used: readonly number[], capacity: number): number | null {
  const taken = new Set(used);
  for (let s = 1; s <= capacity; s++) if (!taken.has(s)) return s;
  return null;
}

/** Suggested designation: prefix + the next number not already used (RTU-1, RTU-2 -> RTU-3). */
export function suggestDesignation(prefix: string, existing: readonly string[]): string {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`, 'i');
  let max = 0;
  for (const d of existing) {
    const m = re.exec(d.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}
