import { HYDRONIC_MAP, TEMPLATE_MAP, type EquipmentDef, type TemplateMap } from '@a2b/workbook/map';

export type AirTypeKey = 'rtu' | 'mau' | 'erv' | 'fan' | 'smallFan' | 'vav' | 'hood' | 'traverse';
export type HydronicTypeKey = 'pump' | 'valveSystem' | 'plant' | 'flowMeasurement';
export type EquipmentTypeKey = AirTypeKey | HydronicTypeKey;
/** Which report (workbook) a type belongs to: the airside TAB workbook or the hydronic one. */
export type Discipline = 'air' | 'hydronic';

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
  discipline: Discipline;
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
  pump: { plural: 'Pumps', prefix: 'P-' },
  // a valve system's designation is the system name (CHW, HW-1 …): the System Summary sums pumps and valves by it
  valveSystem: { plural: 'Valve systems', prefix: 'SYS-' },
  plant: { plural: 'Plant equipment', prefix: 'CH-' },
  flowMeasurement: { plural: 'Flow readings', prefix: 'U-' },
};

const typesOf = (map: TemplateMap, discipline: Discipline): EquipmentTypeInfo[] =>
  map.equipment.map((e) => {
    const key = e.key as EquipmentTypeKey;
    return { key, label: e.label, capacity: e.capacity, discipline, ...META[key] };
  });

/** Equipment types in workbook order (airside, then hydronic), capacities taken from the template maps. */
export const EQUIPMENT_TYPES: readonly EquipmentTypeInfo[] = [
  ...typesOf(TEMPLATE_MAP, 'air'),
  ...typesOf(HYDRONIC_MAP, 'hydronic'),
];

export const isHydronic = (type: EquipmentTypeKey): boolean => equipmentType(type).discipline === 'hydronic';

/** The workbook map a discipline exports to. */
export const mapOf = (discipline: Discipline): TemplateMap => (discipline === 'air' ? TEMPLATE_MAP : HYDRONIC_MAP);

/** The template map's definition of a type (its sheet block, {Data Entry} row, tables), from either workbook. */
export function workbookDef(type: EquipmentTypeKey): EquipmentDef | undefined {
  return TEMPLATE_MAP.equipment.find((d) => d.key === type) ?? HYDRONIC_MAP.equipment.find((d) => d.key === type);
}

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
