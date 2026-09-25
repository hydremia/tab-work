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

export interface SlotBlocked {
  type: EquipmentTypeKey;
  slot: number;
  /** The units sharing the slot (keeper first when planned by sync/slots.ts). */
  ids: string[];
}

/** Units that share a workbook slot with another unit of their type (two devices added them; sync/slots.ts). */
export function slotCollisions(units: readonly { id: string; type: EquipmentTypeKey; slot: number }[]): SlotBlocked[] {
  const groups = new Map<string, { id: string; type: EquipmentTypeKey; slot: number }[]>();
  for (const u of units) groups.set(`${u.type}:${u.slot}`, [...(groups.get(`${u.type}:${u.slot}`) ?? []), u]);
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({ type: g[0].type, slot: g[0].slot, ids: g.map((u) => u.id) }));
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

/**
 * Designation for a copy of a unit: the trailing number incremented to the next one not used by the type
 * (VAV-12 -> VAV-13, or VAV-14 when VAV-13 exists; EF-S3 -> EF-S4). Without a trailing number: "<name> 2", "<name> 3" ….
 */
export function nextDesignation(designation: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((d) => d.trim().toLowerCase()));
  const m = /^(.*?)(\d+)(\D*)$/.exec(designation.trim());
  if (m) {
    const [, head, digits, tail] = m;
    for (let n = Number(digits) + 1; n < Number(digits) + 1000; n++) {
      const num = String(n).padStart(digits.length, '0');
      const d = `${head}${num}${tail}`;
      if (!taken.has(d.toLowerCase())) return d;
    }
  }
  for (let n = 2; ; n++) {
    const d = `${designation.trim()} ${n}`;
    if (!taken.has(d.toLowerCase())) return d;
  }
}
