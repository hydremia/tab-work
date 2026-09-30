/**
 * The engineer's building air balance table (pure): the "AIR BALANCE" / "VENTILATION CALCULATION" table on the
 * mechanical schedules that lists every unit's outside air and every exhaust, with the totals and the net
 * pressurization. It is the design side of the Building Balance sheet, so the prepped project should match it.
 *
 *   tableKind()         'airBalance' (unit / OA CFM / unit / exhaust CFM columns), 'spaces' (a space-by-space
 *                       ventilation table: room / zone / occupancy / area; not needed for TAB) or null (a unit schedule)
 *   readAirBalance()    grid -> OA and exhaust entries, stated totals and net
 *   airBalanceChecks()  entries vs the project's units: design CFM matches / differs / blank, units the table lists
 *                       that the project does not have (and the type their tag suggests), units the table leaves out
 *   unitDesignBalance() design OA and exhaust totals from the units' design fields (the prep-time Building Balance)
 * The table's totals are kept on the project (info.abOaDesign, info.abExhaustDesign, info.abNet, info.abSource).
 */
import type { FieldValue } from '../data/types';
import type { EquipmentTypeKey } from './equipmentTypes';
import { designationKey, normalizeHeader, parseNumber, type Grid } from './scheduleImport';

export type BalanceSide = 'oa' | 'exhaust';

export interface AirBalanceEntry {
  side: BalanceSide;
  designation: string;
  cfm: number;
  /** A note mark after the value ("1000 (1)" -> "1"). */
  note?: string;
}

export interface AirBalanceTable {
  entries: AirBalanceEntry[];
  /** Totals as stated on the table (null: none). */
  totalOa: number | null;
  totalExhaust: number | null;
  /** Net: OA - exhaust (positive: the building is pressurized). */
  net: number | null;
  /**
   * Entries the stated totals leave out: the rows with a note mark ("1000 (1)", e.g. "serve mechanical spaces, not
   * part of the air balance") when leaving them out is exactly what makes the rows add up to the stated total.
   */
  excluded: string[];
}

export const AIR_BALANCE_KEYS = {
  oa: 'abOaDesign',
  exhaust: 'abExhaustDesign',
  net: 'abNet',
  source: 'abSource',
  /** The designations the table's totals leave out (comma-separated). */
  excluded: 'abExcluded',
} as const;

const SPACE_WORDS =
  /\b(room|rooms|space|spaces|zone|occupancy|occupants|people|population|area sf|sq ft|sf|floor area|rp|ra|vbz|voz|ez|az|pz)\b/;
const UNIT_HEADER = /^(unit|units|unit no|unit tag|equipment|equip|tag|mark|system|source|fan|unit id)$/;
const OA_HEADER = /\b(osa|oa|outside|outdoor|ventilation|make up|makeup|intake)\b/;
const EX_HEADER = /\b(exhaust|exh|ea|relief)\b/;

type ColRole = { role: 'unit' } | { role: 'value'; side: BalanceSide } | null;

function roleOf(header: string | number | null): ColRole {
  if (header === null || typeof header === 'number') return null;
  const h = normalizeHeader(header);
  if (!h) return null;
  if (UNIT_HEADER.test(h)) return { role: 'unit' };
  const cfm = /\bcfm\b/.test(h) || /\bair\b/.test(h);
  if (EX_HEADER.test(h) && (cfm || /^(exhaust|exh|ea|relief)$/.test(h))) return { role: 'value', side: 'exhaust' };
  if (OA_HEADER.test(h) && (cfm || /^(osa|oa|outside air|outdoor air|ventilation)$/.test(h)))
    return { role: 'value', side: 'oa' };
  return null;
}

interface Layout {
  header: number;
  pairs: { unit: number; value: number; side: BalanceSide }[];
}

function layoutOf(rows: Grid): Layout | null {
  for (let h = 0; h < Math.min(4, rows.length); h++) {
    const roles = rows[h].map(roleOf);
    const units = roles.flatMap((r, i) => (r?.role === 'unit' ? [i] : []));
    if (!units.length) continue;
    const pairs: Layout['pairs'] = [];
    roles.forEach((r, i) => {
      if (r?.role !== 'value') return;
      const unit = [...units].reverse().find((u) => u < i) ?? units[0];
      pairs.push({ unit, value: i, side: r.side });
    });
    // a unit schedule also has a unit and an OA CFM column, among many others: an air balance is (nearly) only
    // unit and CFM columns
    const filled = rows[h].filter((c) => c !== null && String(c).trim()).length;
    if (pairs.length && units.length + pairs.length >= filled * 0.6) return { header: h, pairs };
  }
  return null;
}

const text = (c: string | number | null | undefined) => (c === null || c === undefined ? '' : String(c).trim());
const isTag = (t: string) => /^[A-Z]{1,5}[- ]?[A-Z]?\d+[A-Z]?$/i.test(t.replace(/\s+/g, '').replace(/^\([EN]\)/i, ''));

/** "1,000 (1)" -> 1000 and note "1"; "1,890" -> 1890. */
function cfmOf(c: string | number | null | undefined): { cfm: number; note?: string } | null {
  if (typeof c === 'number') return Number.isFinite(c) ? { cfm: c } : null;
  const t = text(c);
  const m = /^(.*?)\s*\((\w{1,3})\)\s*$/.exec(t);
  const n = parseNumber(m ? m[1] : t);
  if (n === null) return null;
  return m ? { cfm: n, note: m[2] } : { cfm: n };
}

/** The building air balance in a table, or null when the table is not one (fewer than 2 entries). */
export function readAirBalance(rows: Grid): AirBalanceTable | null {
  const layout = layoutOf(rows);
  if (!layout) return null;
  if (SPACE_WORDS.test(normalizeHeader(rows[layout.header].map(text).join(' ')))) return null;
  const out: AirBalanceTable = { entries: [], totalOa: null, totalExhaust: null, net: null, excluded: [] };
  for (const row of rows.slice(layout.header + 1)) {
    const all = normalizeHeader(row.map(text).join(' '));
    if (/\b(net|pressuri[sz]ation|building balance)\b/.test(all)) {
      const nums = row.map(cfmOf).filter((x): x is { cfm: number } => x !== null);
      const last = nums[nums.length - 1];
      if (last) out.net = /\bnegative\b/.test(all) ? -Math.abs(last.cfm) : last.cfm;
      continue;
    }
    const isTotalRow = /\btotals?\b/.test(all);
    for (const p of layout.pairs) {
      const tag = text(row[p.unit]);
      const v = cfmOf(row[p.value]);
      if (!v) continue;
      if (isTotalRow && (!tag || /\btotal/i.test(tag))) {
        if (p.side === 'oa') out.totalOa ??= v.cfm;
        else out.totalExhaust ??= v.cfm;
        continue;
      }
      if (!tag || !isTag(tag)) continue;
      out.entries.push({
        side: p.side,
        designation: tag.replace(/^\([EN]\)\s*/i, ''),
        cfm: v.cfm,
        ...(v.note ? { note: v.note } : {}),
      });
    }
  }
  // noted entries that the stated total leaves out
  for (const side of ['oa', 'exhaust'] as const) {
    const total = side === 'oa' ? out.totalOa : out.totalExhaust;
    const rows = out.entries.filter((e) => e.side === side);
    const noted = rows.filter((e) => e.note);
    const sum = (es: AirBalanceEntry[]) => es.reduce((t, e) => t + e.cfm, 0);
    if (
      total !== null &&
      noted.length &&
      Math.abs(sum(rows) - total) >= 1 &&
      Math.abs(sum(rows) - sum(noted) - total) < 1
    )
      out.excluded.push(...noted.map((e) => e.designation));
  }
  if (out.net === null && out.totalOa !== null && out.totalExhaust !== null) out.net = out.totalOa - out.totalExhaust;
  return out.entries.length >= 2 ? out : null;
}

/** What a schedule table is when it is not a unit schedule. */
export function tableKind(rows: Grid, title = ''): 'airBalance' | 'spaces' | null {
  if (readAirBalance(rows)) return 'airBalance';
  const head = normalizeHeader(rows.slice(0, 3).flat().map(text).join(' '));
  const t = normalizeHeader(title);
  if (
    (/\b(room|space|zone)\b/.test(head) && /\b(occupan|people|area|sf|rp|ra|voz|vbz)\w*\b/.test(head)) ||
    (/\bventilation\b/.test(t) && /\b(room|space|zone)\b/.test(head))
  )
    return 'spaces';
  return null;
}

// ------------------------------------------------------------------------------------------ checks
export interface BalanceUnitRef {
  id?: string;
  type: EquipmentTypeKey;
  designation: string;
  data: Readonly<Record<string, FieldValue>>;
}

/** The unit field that holds a side's design CFM. */
export function designFieldOf(
  type: EquipmentTypeKey,
  side: BalanceSide,
  data: Readonly<Record<string, FieldValue>> = {},
): string | null {
  if (side === 'oa') {
    if (type === 'rtu') return 'designOaCfm';
    if (type === 'mau') return typeof data.designOaCfm === 'number' ? 'designOaCfm' : 'designTotalCfm';
    if (type === 'erv') return 'designSupplyCfm';
    return null;
  }
  if (type === 'erv') return 'designExhaustCfm';
  if (type === 'fan' || type === 'smallFan') return 'designTotalCfm';
  if (type === 'hood') return 'designCfm';
  return null;
}

/** The type a tag suggests for a unit the project does not have yet. */
export function typeFromTag(designation: string, side: BalanceSide): EquipmentTypeKey | null {
  const p =
    designation
      .toUpperCase()
      .replace(/[^A-Z]/g, ' ')
      .trim()
      .split(' ')[0] ?? '';
  if (/^(RTU|AC|HP|PTAC|WSHP|FC|FCU|CU)$/.test(p)) return side === 'oa' ? 'rtu' : null;
  if (/^(MAU|MUA)$/.test(p)) return 'mau';
  if (/^(ERV|HRV|ERU)$/.test(p)) return 'erv';
  if (/^(EF|KEF|TF|GEF|DEF|BEF|SEF|RF|F)$/.test(p)) return side === 'exhaust' ? 'fan' : null;
  return null;
}

export interface AirBalanceCheck {
  entry: AirBalanceEntry;
  status: 'match' | 'differs' | 'blank' | 'missing' | 'noField';
  unit?: BalanceUnitRef;
  /** The unit's design CFM (differs). */
  unitCfm?: number;
  /** The field the design CFM goes in (blank / missing: filled from the table). */
  field?: string;
  /** missing: the type its tag suggests (null: not a unit type the app has; a spare OA row for OA). */
  suggestType?: EquipmentTypeKey | null;
}

export function airBalanceChecks(
  table: AirBalanceTable,
  units: readonly BalanceUnitRef[],
): { checks: AirBalanceCheck[]; notListed: BalanceUnitRef[] } {
  const byKey = new Map<string, BalanceUnitRef[]>();
  for (const u of units) {
    const k = designationKey(u.designation);
    byKey.set(k, [...(byKey.get(k) ?? []), u]);
  }
  const listed = new Set<BalanceUnitRef>();
  const checks = table.entries.map((entry): AirBalanceCheck => {
    const cands = byKey.get(designationKey(entry.designation)) ?? [];
    const unit = cands.find((u) => designFieldOf(u.type, entry.side, u.data)) ?? cands[0];
    if (!unit) return { entry, status: 'missing', suggestType: typeFromTag(entry.designation, entry.side) };
    listed.add(unit);
    const field = designFieldOf(unit.type, entry.side, unit.data);
    if (!field) return { entry, status: 'noField', unit };
    const v = unit.data[field];
    if (typeof v !== 'number') return { entry, status: 'blank', unit, field };
    return Math.abs(v - entry.cfm) < 1
      ? { entry, status: 'match', unit, field }
      : { entry, status: 'differs', unit, unitCfm: v, field };
  });
  const notListed = units.filter(
    (u) => !listed.has(u) && (['rtu', 'mau', 'erv', 'fan'] as EquipmentTypeKey[]).includes(u.type),
  );
  return { checks, notListed };
}

/** Sums of the table's entries per side, without the ones its totals leave out (to check the stated totals). */
export function entryTotals(table: AirBalanceTable): { oa: number; exhaust: number } {
  let oa = 0;
  let exhaust = 0;
  const left = new Set(table.excluded);
  for (const e of table.entries) {
    if (left.has(e.designation)) continue;
    if (e.side === 'oa') oa += e.cfm;
    else exhaust += e.cfm;
  }
  return { oa, exhaust };
}

/**
 * Design OA and exhaust from the units' design fields (before any airflow rows exist): RTU OA, MAU OA (else total),
 * ERV supply on the OA side; fans, small fans 1-30 and ERV exhaust on the exhaust side; plus the spare OA rows.
 * Hoods are not counted (their exhaust fans are).
 */
export function unitDesignBalance(
  units: readonly (BalanceUnitRef & { slot?: number })[],
  spareOaDesign = 0,
  /** Designations the engineer's air balance leaves out (info.abExcluded). */
  excluded: readonly string[] = [],
): { oa: number; exhaust: number; net: number } {
  let oa = spareOaDesign;
  let exhaust = 0;
  const skip = new Set(excluded.map(designationKey));
  for (const u of units) {
    if (skip.has(designationKey(u.designation))) continue;
    const f = designFieldOf(u.type, 'oa', u.data);
    const x =
      u.type === 'hood' || (u.type === 'smallFan' && (u.slot ?? 0) > 30)
        ? null
        : designFieldOf(u.type, 'exhaust', u.data);
    if (f && typeof u.data[f] === 'number') oa += u.data[f];
    if (x && typeof u.data[x] === 'number') exhaust += u.data[x];
  }
  return { oa, exhaust, net: oa - exhaust };
}
