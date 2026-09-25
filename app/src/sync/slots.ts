/**
 * Workbook slot collisions after a sync. A new unit takes the next free block of its type on the device that adds it
 * (repo.addEquipment), so two devices adding a unit of the same type while they don't see each other's (offline, or
 * simply before the next pull) can give both units the same slot; the export would then have two units for one block.
 * `equipment.slot` is not unique on the server on purpose (a push must never fail on it), so the devices resolve it
 * when they pull, deterministically:
 *
 *  - per project and type, units sharing a slot are ordered by the server-log position of their create (the unit
 *    whose create reached the server first keeps the slot; a create not on the server yet counts as last; ties by id);
 *  - every other unit of that slot moves to the lowest free slot of its type (free = no unit on this device uses it),
 *    as a normal synced edit of `slot` plus `slotMove` = { from, to, otherId } (a note shown on the unit page until
 *    dismissed) and a history entry "moved from slot 3 to slot 4: another device used slot 3";
 *  - no free slot (the type is at its workbook capacity): nothing moves; the Attention tab lists the collision
 *    (domain/attention.ts) and the export leaves the later unit out with a warning (workbook/adapter.ts).
 *
 * Two devices that resolve the same collision compute the same move from the same server state and write equal values,
 * so the field-level sync sees no conflict (equal values never conflict). A locked (issued) project is left alone
 * until it is unlocked. Reviews are kept (the move changes nothing the reviewer checked).
 */
import { db } from '../data/db';
import { setField, writeTables } from '../data/repo';
import type { SlotMove } from '../data/types';
import { equipmentType, nextFreeSlot, slotCollisions, type EquipmentTypeKey } from '../domain/equipmentTypes';

export interface SlotUnit {
  id: string;
  type: EquipmentTypeKey;
  slot: number;
  /** Server-log position of the unit's create; undefined: not on the server yet (counts as the latest). */
  createSeq?: number;
}

export interface SlotMovePlan {
  id: string;
  from: number;
  to: number;
  otherId: string;
}

export type { SlotBlocked } from '../domain/equipmentTypes';
import type { SlotBlocked } from '../domain/equipmentTypes';

const rank = (u: SlotUnit) => u.createSeq ?? Number.MAX_SAFE_INTEGER;

/** Pure: which units move where (see the file comment). */
export function planSlotMoves(units: readonly SlotUnit[]): { moves: SlotMovePlan[]; blocked: SlotBlocked[] } {
  const moves: SlotMovePlan[] = [];
  const blocked: SlotBlocked[] = [];
  const byType = new Map<EquipmentTypeKey, SlotUnit[]>();
  for (const u of units) byType.set(u.type, [...(byType.get(u.type) ?? []), u]);
  for (const [type, list] of byType) {
    const capacity = equipmentType(type).capacity;
    const taken = list.map((u) => u.slot);
    const bySlot = new Map<number, SlotUnit[]>();
    for (const u of list) bySlot.set(u.slot, [...(bySlot.get(u.slot) ?? []), u]);
    for (const slot of [...bySlot.keys()].sort((a, b) => a - b)) {
      const group = bySlot.get(slot)!;
      if (group.length < 2) continue;
      group.sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const [keeper, ...rest] = group;
      const stuck: string[] = [];
      for (const u of rest) {
        const to = nextFreeSlot(taken, capacity);
        if (to === null) {
          stuck.push(u.id);
          continue;
        }
        taken.push(to);
        moves.push({ id: u.id, from: slot, to, otherId: keeper.id });
      }
      if (stuck.length) blocked.push({ type, slot, ids: [keeper.id, ...stuck] });
    }
  }
  return { moves, blocked };
}

export interface SlotResolveResult {
  moved: number;
  blocked: number;
}

/**
 * Resolve slot collisions in the given projects (every project on the device when omitted), as this device. Called by
 * the sync engine after it pulled changes; the moves are ordinary edits, pushed in the same sync.
 */
export async function resolveSlotCollisions(projectIds?: Iterable<string>): Promise<SlotResolveResult> {
  const res: SlotResolveResult = { moved: 0, blocked: 0 };
  const ids = projectIds ? [...new Set(projectIds)] : ((await db.projects.toCollection().primaryKeys()) as string[]);
  for (const projectId of ids) {
    const project = await db.projects.get(projectId);
    if (!project || project.lock) continue;
    const units = await db.equipment.where('projectId').equals(projectId).toArray();
    if (!slotCollisions(units).length) continue;
    const seqs = new Map<string, number>();
    for (const u of units) {
      const create = await db.fieldChanges
        .where('[table+recordId+field]')
        .equals(['equipment', u.id, ''])
        .filter((c) => c.op === 'create' && c.serverSeq !== undefined)
        .first();
      if (create?.serverSeq !== undefined) seqs.set(u.id, create.serverSeq);
    }
    const { moves, blocked } = planSlotMoves(
      units.map((u) => ({ id: u.id, type: u.type, slot: u.slot, createSeq: seqs.get(u.id) })),
    );
    res.blocked += blocked.length;
    if (!moves.length) continue;
    const byId = new Map(units.map((u) => [u.id, u]));
    await db.transaction('rw', writeTables(), async () => {
      for (const m of moves) {
        const other = byId.get(m.otherId)?.designation ?? 'another unit';
        const note = `Moved from slot ${m.from} to slot ${m.to}: another device used slot ${m.from} (${other})`;
        const move: SlotMove = { from: m.from, to: m.to, otherId: m.otherId };
        await setField('equipment', m.id, 'slot', m.to, { source: 'auto', note, keepReview: true });
        await setField('equipment', m.id, 'slotMove', move, { source: 'auto', note, keepReview: true });
        res.moved++;
      }
    });
  }
  return res;
}
