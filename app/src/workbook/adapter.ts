/**
 * Adapter between the app's records and the workbook library's ProjectData (the shape exportWorkbook writes
 * and importWorkbook returns). Pure functions: no database, no DOM.
 *
 * What goes into the workbook:
 *  - values as entered;
 *  - every N/A as the notation text ("N/A", "Not Avail.", "Not Acc."), which revision 05's formulas treat as
 *    blank: explicit marks (field, section, equipment level) AND automatic / scope-profile N/A (written as "N/A").
 *    A blank cell never means N/A (user decision 2026-09-24);
 *  - app-only fields (Has VFD?, Has filters?) are not written; import derives them from the data.
 *
 * Two layouts: revision 07 (TEMPLATE_MAP) and revision 05 / 06 (TEMPLATE_MAP_06, for re-issuing onto an issued rev
 * 05 / 06 workbook). toProjectData writes for the map it is given; what only revision 07 has a place for (the bores
 * apart, nameplate HP, observations, exclusions, the hood line, intake screens, initial PSP / filter readings, flat
 * oval traverses) goes into a rev 05 / 06 workbook the way it did before revision 07, or is left out with a warning.
 * fromProjectData reads both layouts (pd.templateRevision).
 */
import { AIR_BALANCE_KEYS } from '../domain/airBalance';
import {
  atLeastRevision,
  blockLayout,
  mapForRevision,
  NOTATIONS as WB_NOTATIONS,
  tableRows,
  type Cell,
  type EquipmentDef,
  type FieldDef,
  type ProjectData,
  type TemplateMap,
  type UnitData,
} from '@a2b/workbook/map';
import { computeCompletion, isNaState, seqNaKey, tableNaKey, type Completion } from '../domain/completion';
import { isBlank, tapSkipped, THREE_POINT } from '../domain/conditions';
import { equipmentType, mapOf, workbookDef, type Discipline, type EquipmentTypeKey } from '../domain/equipmentTypes';
import { CERT_KEYS, CERT_PRELIM_REASON, certValue } from '../domain/certification';
import { PRESSURE_KEYS, PRESSURE_ROWS } from '../domain/projectCompletion';
import { findRow, rowNames } from '../domain/rowLabels';
import { joinSheaveBore, splitSheaveBore } from '../domain/sheaveBore';
import { fanAtHood, fanHoodIgnoredReadings, hoodLinks, hoodsAirflow, hoodTotals } from '../domain/equipmentCalcs';
import { isObservation } from '../domain/issues';
import { SPARE_OA_ROWS, spareOaKey, type SpareOaColumn } from '../domain/spareOa';
import { getSpec, seqKey, tableColumns, type EquipmentSpec, type RowTableSpec } from '../domain/specs';
import {
  emptyNaState,
  type AirflowRow,
  type Equipment,
  type FieldValue,
  type Instrument,
  type Issue,
  type NaMark,
  type Notation,
  type Project,
} from '../data/types';
import { uuid } from '../data/uuid';

export interface ProjectBundle {
  project: Project;
  equipment: Equipment[];
  rows: AirflowRow[];
  issues: Issue[];
  instruments: Instrument[];
}

export const PROJECT_INFO_KEYS = [
  'address',
  'architect',
  'mechanicalEngineer',
  'electricalEngineer',
  'generalContractor',
  'mechanicalContractor',
  'tabDate',
  'technicians',
  'projectManager',
  'reportDate',
] as const;

/** Sections of the workbook the app writes (and so resets when exporting onto a previously issued workbook). */
export const APP_SECTIONS = [
  'projectInfo',
  'narrative',
  'issuesNew',
  'issuesExisting',
  'calibration',
  'buildingBalance',
  'equipmentSummary',
  'certification',
] as const;

const isNotation = (v: unknown): v is Notation =>
  typeof v === 'string' && (WB_NOTATIONS as readonly string[]).includes(v);

/** Value to write: the value, else an explicit N/A notation, else nothing (the cell is left as in the template). */
function out(v: FieldValue | undefined, mark: NaMark | null | undefined): Cell | undefined {
  if (!isBlank(v)) return typeof v === 'string' ? v.trim() : (v as number);
  if (mark) return mark.notation;
  return undefined;
}

function coerce(def: Pick<FieldDef, 'type'> | undefined, v: Cell, path: string, warnings: string[]): Cell | undefined {
  if (!def || v === null || isNotation(v)) return v;
  if (def.type === 'number' && typeof v === 'string') {
    const n = Number(v.replace(/,/g, ''));
    if (v.trim() !== '' && Number.isFinite(n)) return n;
    warnings.push(`${path}: "${v}" is not a number; left blank in the workbook`);
    return undefined;
  }
  if (def.type === 'text' && typeof v === 'number') return String(v);
  return v;
}

const splitLines = (text: string, room: number): string[] => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length > room && room > 0) lines.splice(room - 1, lines.length, lines.slice(room - 1).join(' '));
  return lines;
};

/** Project-level hydronic values (project.info keys): the Plant Equipment and Flow Measurements page headers. */
export const HYDRONIC_INFO_KEYS = {
  plantDpUnits: 'hydPlantDpUnits',
  plantInstrument: 'hydPlantInstrument',
  flowInstrument: 'hydFlowInstrument',
} as const;

/** Sections of the hydronic workbook the app writes (reset when exporting onto an issued hydronic workbook). */
export const HYDRONIC_APP_SECTIONS = [
  'projectInfo',
  'narrative',
  'issuesNew',
  'issuesExisting',
  'calibration',
  'certification',
  'systemSummary',
  'plant',
  'flowMeasurements',
] as const;

/**
 * Building Balance rows (7-86, index 0-79) a unit feeds: outside air (RTUs 1-40, MAUs 1-10, ERVs 1-10) and exhaust
 * (fans 1-40, small fans 21-30, ERVs 1-10, small fans 1-20).
 */
export function balanceRow(type: string, slot: number): { oa?: number; exhaust?: number } {
  if (type === 'rtu' && slot <= 40) return { oa: slot - 1 };
  if (type === 'mau' && slot <= 10) return { oa: 40 + slot - 1 };
  if (type === 'erv' && slot <= 10) return { oa: 50 + slot - 1, exhaust: 50 + slot - 1 };
  if (type === 'fan' && slot <= 40) return { exhaust: slot - 1 };
  if (type === 'smallFan' && slot >= 21 && slot <= 30) return { exhaust: 40 + slot - 21 };
  if (type === 'smallFan' && slot <= 20) return { exhaust: 60 + slot - 1 };
  return {};
}

/** The Building Balance's excluded designations (info.abExcluded, comma-separated). */
export const excludedDesignations = (v: FieldValue | undefined): string[] =>
  typeof v === 'string'
    ? v
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : [];

/** Revision 07's Building Balance exclusion line: "Excluded from the totals: EF-22, EF-23. <reason>". */
const EXCLUDED_PREFIX = 'Excluded from the totals: ';

/**
 * The project as ProjectData for one workbook: the airside TAB workbook (revision 07, or `map` = TEMPLATE_MAP_06 for
 * an issued rev 05 / 06 workbook) or the hydronic one (H01). Both carry the shared report pages (project information,
 * narrative, remarks, calibration, certification); each gets its own discipline's equipment.
 */
export function toProjectData(
  b: ProjectBundle,
  discipline: Discipline = 'air',
  mapOverride?: TemplateMap,
): { data: ProjectData; warnings: string[] } {
  const warnings: string[] = [];
  const { project } = b;
  const map = mapOverride ?? mapOf(discipline);
  const pd: ProjectData = { templateRevision: map.revision, name: project.name, sections: {}, equipment: {} };
  // the engineer's air balance totals are not on the sheets: a custom document property
  const appInfo: Record<string, string | number> = {};
  for (const k of Object.values(AIR_BALANCE_KEYS)) {
    const v = project.info[k];
    if (typeof v === 'number' || (typeof v === 'string' && v))
      // the property holds 255 characters: the free texts are capped
      appInfo[k] =
        k === AIR_BALANCE_KEYS.source
          ? String(v).slice(0, 80)
          : k === AIR_BALANCE_KEYS.excludedNote
            ? String(v).slice(0, 90)
            : v;
  }
  if (Object.keys(appInfo).length) pd.appInfo = appInfo;
  const pn = project.naState.fields;

  // ---- {Project Information}
  const info: Record<string, Cell> = {};
  const put = (target: Record<string, Cell>, key: string, v: Cell | undefined) => {
    if (v !== undefined) target[key] = v;
  };
  put(info, 'projectName', out(project.name, pn.projectName));
  for (const k of PROJECT_INFO_KEYS) put(info, k, out(project.info[k], pn[k]));
  const blueprints = project.blueprints
    .filter((bp) => !isBlank(bp.sheet) || !isBlank(bp.revisionDate))
    .map((bp) => {
      const row: Record<string, Cell> = {};
      put(row, 'sheet', out(bp.sheet, null));
      put(row, 'revisionDate', out(bp.revisionDate, null));
      return row;
    });
  if (blueprints.length > 9)
    warnings.push(`Blueprints: ${blueprints.length} sheets, the workbook lists 9; the rest are left out`);
  pd.sections.projectInfo = {
    fields: info,
    ...(blueprints.length ? { tables: { blueprints: blueprints.slice(0, 9) } } : {}),
  };

  const narrative = out(project.info.narrative, pn.narrative);
  if (narrative !== undefined) pd.sections.narrative = { fields: { text: narrative } };
  pd.sections.equipmentSummary = { fields: { tolerance: project.tolerance } };

  // ---- Building Balance: measured building pressures (rows 97-99) and notes (B102-B104)
  const hasHoods = b.equipment.some((e) => e.type === 'hood');
  const pv = (k: string, auto?: boolean): Cell | undefined =>
    out(project.info[k], pn[k] ?? (auto ? { notation: 'N/A' } : null));
  const pressures: Record<string, Cell>[] = PRESSURE_ROWS.map((r, i) => {
    const row: Record<string, Cell> = { testSpace: r.test, referenceSpace: r.ref };
    put(row, 'dp', pv(r.dp, i === 1 && !hasHoods));
    put(row, 'remarks', pv(r.remarks));
    return row;
  });
  const spare: Record<string, Cell> = {};
  put(spare, 'testSpace', pv(PRESSURE_KEYS.spareTest));
  put(spare, 'referenceSpace', pv(PRESSURE_KEYS.spareRef));
  put(spare, 'dp', pv(PRESSURE_KEYS.spareDp));
  put(spare, 'remarks', pv(PRESSURE_KEYS.spareRemarks));
  if (Object.keys(spare).length) pressures.push(spare);
  for (const r of pressures)
    if (typeof r.dp === 'string' && !isNotation(r.dp))
      r.dp = coerce({ type: 'number' }, r.dp, 'Building pressures ΔP', warnings) ?? null;
  const notes = project.info[PRESSURE_KEYS.notes];
  // spare manual OA rows 67-86 (kept at their positions; a row with nothing is left as the template has it)
  const spareOa: Record<string, Cell>[] = [];
  const SPARE_COLS: [SpareOaColumn, string, 'text' | 'number'][] = [
    ['Unit', 'unit', 'text'],
    ['Design', 'design', 'number'],
    ['Actual', 'actual', 'number'],
  ];
  for (let n = 1; n <= SPARE_OA_ROWS; n++) {
    const row: Record<string, Cell> = {};
    for (const [col, key, type] of SPARE_COLS) {
      const raw = pv(spareOaKey(n, col));
      const v = raw === undefined ? undefined : coerce({ type }, raw, `Other OA row ${n}`, warnings);
      if (v !== undefined) row[key] = v;
    }
    spareOa.push(row);
  }
  while (spareOa.length && !Object.keys(spareOa[spareOa.length - 1]).length) spareOa.pop();
  // units left out of the building balance (rev 07: an Excl. flag on their rows and the reason under the notes; rev
  // 05 / 06 count them, the app keeps the list in the appInfo property)
  const excludedTables: Record<string, Record<string, Cell>[]> = {};
  const excludedFields: Record<string, Cell> = {};
  const excluded = excludedDesignations(project.info[AIR_BALANCE_KEYS.excluded]);
  if (excluded.length && map.sections.some((sec) => sec.tables?.some((t) => t.key === 'excluded'))) {
    const flags: Record<string, Cell>[] = Array.from({ length: 80 }, () => ({}));
    const named: string[] = [];
    for (const e of b.equipment) {
      if (!excluded.some((x) => x.toLowerCase() === e.designation.trim().toLowerCase())) continue;
      const at = balanceRow(e.type, e.slot);
      if (at.oa !== undefined) flags[at.oa].oa = 'Excl.';
      if (at.exhaust !== undefined) flags[at.exhaust].exhaust = 'Excl.';
      if (at.oa !== undefined || at.exhaust !== undefined) named.push(e.designation);
    }
    while (flags.length && !Object.keys(flags[flags.length - 1]).length) flags.pop();
    if (flags.length) excludedTables.excluded = flags;
    const why = project.info[AIR_BALANCE_KEYS.excludedNote];
    if (named.length)
      excludedFields.excludedNote = `${EXCLUDED_PREFIX}${named.join(', ')}.${typeof why === 'string' && why.trim() ? ` ${why.trim()}` : ''}`;
  }
  pd.sections.buildingBalance = {
    tables: { pressures, ...(spareOa.length ? { spareOa } : {}), ...excludedTables },
    ...(typeof notes === 'string' && notes.trim() ? { lines: { notes: splitLines(notes, 3) } } : {}),
    ...(Object.keys(excludedFields).length ? { fields: excludedFields } : {}),
  };

  // ---- Certification: the certified professional's lines (template defaults when never set), signature and date
  // (required on a final report, automatic N/A on a prelim: exported "N/A", read back as automatic)
  const cert: Record<string, Cell> = {};
  const final = project.reportKind === 'final';
  const certOut = (k: string, signed = false): Cell => {
    const v = out(
      certValue(project, k),
      pn[k] ?? (signed && !final ? { notation: 'N/A', reason: CERT_PRELIM_REASON } : null),
    );
    return v === undefined ? null : v;
  };
  cert.cpName = certOut(CERT_KEYS.cpName);
  cert.certNumber = certOut(CERT_KEYS.number);
  cert.expiration = certOut(CERT_KEYS.expiration);
  cert.signature = certOut(CERT_KEYS.signature, true);
  cert.date = certOut(CERT_KEYS.date, true);
  pd.sections.certification = { fields: cert };

  // ---- Calibration
  const instruments = [...b.instruments]
    .sort((a, c) => a.order - c.order)
    .filter((i) => [i.type, i.manufacturer, i.model, i.serial, i.calibrationDate].some((x) => !isBlank(x)))
    .map((i) => {
      const row: Record<string, Cell> = {};
      for (const k of ['type', 'manufacturer', 'model', 'serial', 'calibrationDate'] as const)
        put(row, k, out(i[k], null));
      return row;
    });
  if (instruments.length > 8) warnings.push(`Calibration: ${instruments.length} instruments, the workbook lists 8`);
  pd.sections.calibration = { tables: { instruments: instruments.slice(0, 8) } };

  // ---- Summary - New / Summary - (E)
  const byId = new Map(b.equipment.map((e) => [e.id, e]));
  const lines = rowNames(b.equipment, b.rows);
  for (const kind of ['new', 'existing'] as const) {
    // a unit's issues go to its own workbook; general issues (no unit) to both
    const ofReport = (i: Issue) => {
      const eq = i.equipmentId ? byId.get(i.equipmentId) : undefined;
      return !eq || equipmentType(eq.type).discipline === discipline;
    };
    const page = kind === 'new' ? 'Summary - New' : 'Summary - (E)';
    const sectionKey = kind === 'new' ? 'issuesNew' : 'issuesExisting';
    // "RTU-1: …", or with the line: "RTU-1 · Supply outlets #12: …" (a re-import links both back)
    const remarkOf = (i: Issue) => {
      const eq = i.equipmentId ? byId.get(i.equipmentId) : undefined;
      const line = eq && i.airflowRowId ? lines.get(i.airflowRowId) : undefined;
      const owner = eq ? (line?.equipmentId === eq.id ? `${eq.designation} · ${line.short}` : eq.designation) : '';
      return owner && !i.remark.startsWith(`${owner}:`) ? `${owner}: ${i.remark}` : i.remark;
    };
    const tables: Record<string, Record<string, Cell>[]> = {};
    // observations: their own list on the Summary pages (revision 07; a rev 05 / 06 workbook has no place for them,
    // they stay in the app and the Issues report)
    const obs = b.issues
      .filter((i) => i.kind === kind && ofReport(i) && isObservation(i))
      .sort((a, c) => a.number - c.number);
    const obsRoom = map.sections.find((sec) => sec.key === sectionKey)?.tables?.find((t) => t.key === 'observations');
    if (obs.length && !obsRoom)
      warnings.push(
        `${page}: ${obs.length} observation${obs.length === 1 ? '' : 's'} not in this revision ${map.revision} workbook (revision 07 lists them; they are in the Issues report)`,
      );
    else if (obs.length && obsRoom) {
      const room = tableRows(obsRoom).length;
      if (obs.length > room) warnings.push(`${page}: ${obs.length} observations, room for ${room}`);
      tables.observations = obs.slice(0, room).map((i) => {
        const row: Record<string, Cell> = { no: i.number };
        put(row, 'remark', out(remarkOf(i), null));
        put(row, 'comments', out(i.comments, null));
        return row;
      });
    }
    const list = b.issues
      .filter((i) => i.kind === kind && ofReport(i) && !isObservation(i))
      .sort((a, c) => a.number - c.number);
    if (list.length > 50) warnings.push(`${page}: ${list.length} issues, room for 50`);
    if (list.length)
      tables.issues = list.slice(0, 50).map((i) => {
        const row: Record<string, Cell> = { no: i.number, status: i.status };
        put(row, 'remark', out(remarkOf(i), null));
        put(row, 'comments', out(i.comments, null));
        return row;
      });
    if (Object.keys(tables).length) pd.sections[sectionKey] = { tables };
  }

  // ---- equipment (two units in one slot, which sync resolves when the type has a free slot: the earlier one is
  // exported, the later one left out with a warning; the Attention tab lists it)
  const hoodLinked = hoodLinks(b.equipment);
  const slotOwner = new Map<string, Equipment>();
  for (const e of [...b.equipment].sort((x, y) => x.createdAt - y.createdAt || (x.id < y.id ? -1 : 1))) {
    const k = `${e.type}:${e.slot}`;
    if (!slotOwner.has(k)) slotOwner.set(k, e);
  }
  for (const e of b.equipment) {
    const owner = slotOwner.get(`${e.type}:${e.slot}`);
    if (owner && owner.id !== e.id) {
      warnings.push(`${e.designation} is not exported: slot ${e.slot} is also used by ${owner.designation}`);
      continue;
    }
    const def = map.equipment.find((d) => d.key === e.type);
    if (!def) continue;
    const spec = getSpec(e.type);
    const layout = blockLayout(def, e.slot);
    const unitRows = b.rows.filter((r) => r.equipmentId === e.id);
    const c = computeCompletion({
      spec,
      unit: e,
      rows: unitRows,
      photos: [],
      project,
      hoodLinked: hoodLinked.has(e.id),
      openIssues: 0,
    });
    const path = `${e.designation} (${e.type} slot ${e.slot})`;
    const unit: UnitData = { slot: e.slot, ...(e.isExisting ? { existing: true } : {}) };
    const schedule: Record<string, Cell> = {};
    const fields: Record<string, Cell> = {};
    if (def.ede) schedule.designation = e.designation;
    else if (layout.fields?.some((f) => f.key === 'designation')) fields.designation = e.designation;
    const cells = unitFieldCells(e, c, warnings, path, map);
    Object.assign(schedule, cells.schedule);
    Object.assign(fields, cells.fields);
    if (Object.keys(schedule).length) unit.schedule = schedule;
    if (Object.keys(fields).length) unit.fields = fields;

    // airflow / filter tables (template tables and column tables)
    for (const t of specTables(spec)) {
      const td = layout.tables?.find((x) => x.key === t.key);
      const cd = layout.columnTables?.find((x) => x.key === t.key);
      if (!td && !cd) {
        if (t.key === 'intake' && unitRows.some((r) => r.table === 'intake'))
          warnings.push(
            `${path}: intake screen readings need template revision 07; not in this revision ${map.revision} workbook (the app keeps them)`,
          );
        continue;
      }
      const tr = c.tables[t.key];
      // a fan measured at its hood(s): revision 07 has a "measured at hood" line (the hoods and their CFMs, in the
      // fan's totals); in a rev 05 / 06 workbook each hood is one grille row, Ak 1 with the hood's CFM as VEL, so the
      // Fans sheet and the Building Balance get the right CFM
      const hoods = e.type === 'fan' && t.key === 'outlets' ? (hoodLinked.get(e.id) ?? []) : [];
      const ignored = td && hoods.length && fanAtHood(e, true) ? fanHoodIgnoredReadings(unitRows) : 0;
      if (ignored)
        warnings.push(
          `${path}: measured at hood ${hoods.map((h) => h.designation).join(', ')}, so its ${ignored} grille reading${ignored === 1 ? ' is' : 's are'} not exported (set Measured at to Grilles to use them)`,
        );
      if (td && hoods.length && fanAtHood(e, true) && layout.fields?.some((f) => f.key === 'hoodLine')) {
        const air = hoodsAirflow(
          hoods,
          b.rows.filter((r) => hoods.some((h) => h.id === r.equipmentId)),
        );
        const f: Record<string, Cell> = { hoodLine: `Measured at hood ${hoods.map((h) => h.designation).join(', ')}` };
        if (air.design !== null) f.hoodDesignCfm = Math.round(air.design);
        if (air.initial !== null) f.hoodInitialCfm = Math.round(air.initial);
        if (air.final !== null) f.hoodFinalCfm = Math.round(air.final);
        Object.assign((unit.fields ??= {}), f);
        continue;
      }
      if (td && hoods.length && fanAtHood(e, true)) {
        const recs = hoods.map((h) => {
          const ht = hoodTotals(
            h.data,
            b.rows.filter((r) => r.equipmentId === h.id),
          );
          const rec: Record<string, Cell> = {
            no: h.designation,
            area: `Hood ${h.designation} (measured at hood)`,
            type: 'Hood',
            ak: 1,
          };
          if (ht.design !== null) rec.designCfm = Math.round(ht.design);
          if (ht.initial !== null) rec.initialVel = Math.round(ht.initial);
          if (ht.final !== null) rec.finalVel = Math.round(ht.final);
          return rec;
        });
        (unit.tables ??= {})[t.key] = recs;
        if (!e.data.akNotes && layout.fields?.some((f) => f.key === 'akNotes'))
          (unit.fields ??= {}).akNotes =
            `Measured at hood ${hoods.map((h) => h.designation).join(', ')} (VEL = hood CFM, Ak 1)`;
        continue;
      }
      const rows = unitRows.filter((r) => r.table === t.key).sort((a, c2) => a.order - c2.order);
      const naNotation = tr && isNaState(tr.state) ? (tr.notation ?? 'N/A') : undefined;
      const colDefs = td?.columns ?? cd!.fields;
      let recs: Record<string, Cell>[];
      if (naNotation && (!rows.length || tr.forced)) {
        // an N/A table is written as its notation in the first row's first column (a blank never means N/A)
        recs = [{ [colDefs[0].key]: naNotation }];
      } else {
        recs = rows.map((r, i) => {
          const rec: Record<string, Cell> = {};
          const autoCols = tr?.rows[r.id]?.auto ?? {};
          for (const col of tableColumns(t)) {
            const cdef = colDefs.find((x) => x.key === col.key);
            if (!cdef) continue;
            if (td && i === 0 && col.key === 'designCfm' && td.segments[0].omit?.[0]?.includes('H')) continue; // formula
            const raw = out(r.data[col.key], r.na[col.key] ?? (col.key in autoCols ? { notation: 'N/A' } : null));
            if (raw === undefined) continue;
            const v = coerce(cdef, raw, `${path}.${t.key}[${i}].${col.key}`, warnings);
            if (v !== undefined) rec[col.key] = v;
          }
          return rec;
        });
      }
      if (!recs.length) continue;
      // revision 07 has fewer rows in some tables (MAU outlets 28, fan outlets 55): the rest is left out, with a warning
      const room = td ? tableRows(td).length : cd!.cols.length;
      if (recs.length > room) {
        warnings.push(
          `${path}: ${recs.length} ${t.label.toLowerCase()} rows, the revision ${map.revision} workbook has room for ${room}; the last ${recs.length - room} are left out`,
        );
        recs = recs.slice(0, room);
      }
      if (td) (unit.tables ??= {})[t.key] = recs;
      else (unit.columnTables ??= {})[t.key] = recs;
    }

    // reading sequences (PSP velocities, traverse quick entry)
    for (const q of spec.sections.flatMap((sec) => sec.sequences ?? [])) {
      const sd = layout.sequences?.find((x) => x.key === q.key);
      if (!sd) continue;
      const sr = c.sequences[q.key];
      let vals: Cell[] = [];
      if (sr && isNaState(sr.state) && (sr.entered === 0 || sr.state === 'auto-na')) vals = [sr.notation ?? 'N/A'];
      else {
        for (let i = 1; i <= q.count; i++) {
          const k = seqKey(q.key, i);
          const raw = out(e.data[k], e.naState.fields[k]);
          vals.push(
            raw === undefined ? null : (coerce({ type: sd.type }, raw, `${path}.${q.key}[${i}]`, warnings) ?? null),
          );
        }
        while (vals.length && vals[vals.length - 1] === null) vals.pop();
      }
      if (vals.length) (unit.sequences ??= {})[q.key] = vals;
    }

    // remarks and other free-text lines (hoods: technician notes)
    for (const ld of layout.lines ?? []) {
      const text = e.data[ld.key];
      if (typeof text === 'string' && text.trim()) (unit.lines ??= {})[ld.key] = splitLines(text, ld.cells.length);
    }
    (pd.equipment[e.type] ??= []).push(unit);
  }
  for (const k of Object.keys(pd.equipment)) pd.equipment[k].sort((a, c) => a.slot - c.slot);
  if (discipline === 'hydronic') hydronicSections(b, pd, warnings);
  // keep only the sections the workbook has (the airside-only pages are not in the hydronic workbook)
  for (const k of Object.keys(pd.sections)) if (!map.sections.some((sec) => sec.key === k)) delete pd.sections[k];
  return { data: pd, warnings };
}

/**
 * Hydronic page headers and the System Summary: one line per system, from the valve systems (their designation is
 * the system name) and the systems named on the pumps; the workbook's formulas add the flows up by that name.
 */
function hydronicSections(b: ProjectBundle, pd: ProjectData, warnings: string[]): void {
  const info = b.project.info;
  const text = (v: FieldValue | undefined): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
  const bySlot = (x: Equipment, y: Equipment) => x.slot - y.slot;
  const valveSystems = b.equipment.filter((e) => e.type === 'valveSystem').sort(bySlot);
  const pumps = b.equipment.filter((e) => e.type === 'pump').sort(bySlot);
  const names: string[] = [];
  const add = (n: string) => {
    if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
  };
  for (const v of valveSystems) add(v.designation.trim());
  for (const p of pumps) add(text(p.data.system));
  if (names.length > 30) warnings.push(`System Summary: ${names.length} systems, the workbook lists 30`);
  const systems = names.slice(0, 30).map((name) => {
    const same = (v: FieldValue | undefined) => text(v).toLowerCase() === name.toLowerCase();
    const vs = valveSystems.find((v) => same(v.designation));
    const ps = pumps.filter((p) => same(p.data.system));
    const row: Record<string, Cell> = { system: name };
    const service = text(vs?.data.service) || text(ps[0]?.data.service);
    const pumpNames = text(vs?.data.pumps) || ps.map((p) => p.designation).join(', ');
    if (service) row.service = service;
    if (pumpNames) row.pumps = pumpNames;
    if (text(vs?.data.vfdSetpoint)) row.vfdSetpoint = text(vs?.data.vfdSetpoint);
    return row;
  });
  if (systems.length) pd.sections.systemSummary = { tables: { systems } };
  const field = (k: string) => text(info[k]);
  const plant: Record<string, Cell> = {};
  if (field(HYDRONIC_INFO_KEYS.plantDpUnits)) plant.dpUnits = field(HYDRONIC_INFO_KEYS.plantDpUnits);
  if (field(HYDRONIC_INFO_KEYS.plantInstrument)) plant.instrument = field(HYDRONIC_INFO_KEYS.plantInstrument);
  if (Object.keys(plant).length) pd.sections.plant = { fields: plant };
  if (field(HYDRONIC_INFO_KEYS.flowInstrument))
    pd.sections.flowMeasurements = { fields: { instrument: field(HYDRONIC_INFO_KEYS.flowInstrument) } };
}

/**
 * The values the export writes into a unit's {Equipment Data Entry} row (`schedule`) and unit block (`fields`),
 * by field key: entered values, N/A marks as their notation, automatic / scope N/A as "N/A" (except automatic N/A
 * marked exportBlank, which stays blank). Keys that are not written are absent. The live calcs use these, so they
 * see exactly what the workbook's formulas will see.
 */
export function unitFieldCells(
  e: Pick<Equipment, 'type' | 'designation' | 'data' | 'naState' | 'slot'>,
  c: Completion,
  warnings: string[] = [],
  path = e.designation,
  /** The workbook written (default: the current revision's layout). */
  map?: TemplateMap,
): { schedule: Record<string, Cell>; fields: Record<string, Cell> } {
  const schedule: Record<string, Cell> = {};
  const fields: Record<string, Cell> = {};
  const def = map ? map.equipment.find((d) => d.key === e.type) : workbookDef(e.type);
  if (!def) return { schedule, fields };
  const rev07 = map ? atLeastRevision(map, '07') : true;
  const layout = blockLayout(def, e.slot);
  const keys = new Set([...Object.keys(e.data), ...Object.keys(e.naState.fields), ...Object.keys(c.fields)]);
  for (const key of keys) {
    if (key === 'designation' || key === 'remarks') continue;
    const edeDef = def.ede?.fields.find((f) => f.key === key);
    const blockDef = layout.fields?.find((f) => f.key === key);
    if (!edeDef && !blockDef) continue; // app-only (hasVfd, photo:/table:/seq: marks, sequence readings)
    const st = c.fields[key];
    if (st?.state === 'auto-na' && st.exportBlank) continue; // blank on purpose (absent static-profile component)
    const levelMark: NaMark | null =
      st && isNaState(st.state) && st.state !== 'na' && st.notation ? { notation: st.notation } : null;
    // automatic N/A that overrides an entered value (MAU: a method that is not the chosen one) exports as N/A
    const raw = st?.state === 'auto-na' ? 'N/A' : out(e.data[key], e.naState.fields[key] ?? levelMark);
    if (raw === undefined) continue;
    // MAU method "Intake" and flat oval ducts: not in the revision 05 / 06 lists (no cells for the screens / the ends)
    if (key === 'method' && raw === 'Intake' && !layout.tables?.some((t) => t.key === 'intake')) {
      warnings.push(
        `${path}: the Intake method needs template revision 07; the method and its screens are not in this workbook (the app keeps them)`,
      );
      continue;
    }
    if (key === 'shape' && raw === 'Flat Oval' && !rev07) {
      warnings.push(
        `${path}: flat oval ducts need template revision 07; the shape is left blank in this workbook (Ak and CFM not calculated there; the app keeps the readings)`,
      );
      continue;
    }
    const v = coerce(edeDef ?? blockDef, raw, `${path}.${key}`, warnings);
    if (v === undefined) continue;
    if (edeDef) schedule[key] = v;
    else fields[key] = v;
  }
  // revisions 05 / 06 have one "Shv Bore M/F" cell: the motor and fan bores go there as "motor / fan"
  const boreCell = layout.fields?.find((f) => f.key === 'sheaveBore');
  if (boreCell && !layout.fields?.some((f) => f.key === 'motorBore')) {
    const side = (k: string): string | null => {
      const st = c.fields[k];
      if (st && isNaState(st.state)) return st.notation ?? 'N/A';
      const v = e.data[k];
      return v === null || v === undefined || v === '' ? null : String(v);
    };
    const joined = joinSheaveBore(side('motorBore'), side('fanBore'));
    if (joined !== null) {
      const v = coerce(boreCell, joined, `${path}.sheaveBore`, warnings);
      if (v !== undefined) fields.sheaveBore = v;
    }
  }
  return { schedule, fields };
}

/**
 * One unit's cells as its formulas see them (schedule + block merged by field key; null = blank). A field the export
 * does not write keeps the template's value, which for the unit type is the sheet's preset (RTU / MAU / ERV / EF).
 */
export function unitCells(
  e: Pick<Equipment, 'type' | 'designation' | 'data' | 'naState' | 'slot'>,
  c: Completion,
): Record<string, Cell> {
  const { schedule, fields } = unitFieldCells(e, c);
  const cells: Record<string, Cell> = { ...schedule, ...fields };
  if (!('unitType' in cells)) {
    const preset = getSpec(e.type)
      .sections.flatMap((s) => s.fields)
      .find((f) => f.key === 'unitType')?.preset;
    if (preset !== undefined) cells.unitType = preset;
  }
  return cells;
}

const specTables = (spec: EquipmentSpec): RowTableSpec[] => spec.sections.flatMap((sec) => sec.tables ?? []);

// ------------------------------------------------------------------------------------------ import
export interface FromOptions {
  now?: number;
  newId?: () => string;
  fallbackName?: string;
}

export function fromProjectData(pd: ProjectData, opts: FromOptions = {}): ProjectBundle {
  // the layout the values were read with (rev 05 / 06 or rev 07)
  const map = mapForRevision(pd.templateRevision);
  const now = opts.now ?? Date.now();
  const newId = opts.newId ?? uuid;
  const projectId = newId();
  const pi = pd.sections.projectInfo?.fields ?? {};
  const naState = emptyNaState();
  const info: Record<string, FieldValue> = {};
  const take = (
    key: string,
    v: Cell | undefined,
    into: Record<string, FieldValue>,
    marks: Record<string, NaMark | null>,
  ) => {
    if (v === undefined || v === null) return;
    if (isNotation(v)) marks[key] = { notation: v };
    else into[key] = v;
  };
  for (const k of PROJECT_INFO_KEYS) take(k, pi[k], info, naState.fields);
  take('narrative', pd.sections.narrative?.fields?.text, info, naState.fields);
  // Building Balance pressures: the fixed rows by position (their labels are the template's), the spare pair, notes.
  // A plain "N/A" in the kitchen row of a project without hoods is the automatic N/A, not a mark.
  const bb = pd.sections.buildingBalance;
  const pr = bb?.tables?.pressures ?? [];
  const hasHoods = Boolean(pd.equipment.hood?.length);
  PRESSURE_ROWS.forEach((r, i) => {
    const dpCell = pr[i]?.dp;
    if (!(i === 1 && !hasHoods && dpCell === 'N/A')) take(r.dp, dpCell, info, naState.fields);
    take(r.remarks, pr[i]?.remarks, info, naState.fields);
  });
  take(PRESSURE_KEYS.spareTest, pr[2]?.testSpace, info, naState.fields);
  take(PRESSURE_KEYS.spareRef, pr[2]?.referenceSpace, info, naState.fields);
  take(PRESSURE_KEYS.spareDp, pr[2]?.dp, info, naState.fields);
  take(PRESSURE_KEYS.spareRemarks, pr[2]?.remarks, info, naState.fields);
  (bb?.tables?.spareOa ?? []).forEach((r, i) => {
    take(spareOaKey(i + 1, 'Unit'), r.unit, info, naState.fields);
    take(spareOaKey(i + 1, 'Design'), r.design, info, naState.fields);
    take(spareOaKey(i + 1, 'Actual'), r.actual, info, naState.fields);
  });
  // Certification: a plain "N/A" on the signature / date line is the automatic prelim N/A, not a mark
  const cf = pd.sections.certification?.fields ?? {};
  take(CERT_KEYS.cpName, cf.cpName, info, naState.fields);
  take(CERT_KEYS.number, cf.certNumber, info, naState.fields);
  take(CERT_KEYS.expiration, cf.expiration, info, naState.fields);
  for (const [k, v] of [
    [CERT_KEYS.signature, cf.signature],
    [CERT_KEYS.date, cf.date],
  ] as const)
    if (v !== 'N/A') take(k, v, info, naState.fields);
  // the certified professional's lines are always there in a workbook: blank means cleared, not "template default"
  for (const k of [CERT_KEYS.cpName, CERT_KEYS.number, CERT_KEYS.expiration])
    if (!(k in info) && !naState.fields[k]) info[k] = null;
  for (const k of Object.values(AIR_BALANCE_KEYS)) {
    const v = pd.appInfo?.[k];
    if (v !== undefined) info[k] = v;
  }
  // rev 07: the Excl. flags on the Building Balance rows are the list (an Excel edit counts); the reason from the
  // exclusion line when the app's property does not have it
  if (map.sections.some((sec) => sec.tables?.some((t) => t.key === 'excluded'))) {
    const flags = bb?.tables?.excluded ?? [];
    const flagged = (side: 'oa' | 'exhaust', type: string, slot: number) => {
      const at = balanceRow(type, slot)[side];
      const v = at === undefined ? undefined : flags[at]?.[side];
      return v !== undefined && v !== null && String(v).trim() !== '';
    };
    const names: string[] = [];
    const onSheet = new Set<string>();
    for (const [type, units] of Object.entries(pd.equipment))
      for (const u of units) {
        const d = u.schedule?.designation ?? u.fields?.designation;
        const at = balanceRow(type, u.slot);
        if (typeof d !== 'string' || !d.trim() || (at.oa === undefined && at.exhaust === undefined)) continue;
        onSheet.add(d.trim().toLowerCase());
        if (flagged('oa', type, u.slot) || flagged('exhaust', type, u.slot)) names.push(d.trim());
      }
    // names the sheet can't flag (no unit of that designation on a Building Balance row yet) stay as the app had them
    for (const x of excludedDesignations(info[AIR_BALANCE_KEYS.excluded]))
      if (!onSheet.has(x.toLowerCase()) && !names.some((n) => n.toLowerCase() === x.toLowerCase())) names.push(x);
    if (names.length) info[AIR_BALANCE_KEYS.excluded] = names.join(', ');
    else delete info[AIR_BALANCE_KEYS.excluded];
    const line = bb?.fields?.excludedNote;
    if (names.length && info[AIR_BALANCE_KEYS.excludedNote] === undefined && typeof line === 'string') {
      const why = line.startsWith(EXCLUDED_PREFIX) ? line.replace(/^[^.]*\.\s*/, '') : line.trim();
      if (why) info[AIR_BALANCE_KEYS.excludedNote] = why;
    }
    if (!names.length) delete info[AIR_BALANCE_KEYS.excludedNote];
  }
  const noteLines = bb?.lines?.notes ?? [];
  if (noteLines.some((l) => l !== null && String(l).trim() !== ''))
    info[PRESSURE_KEYS.notes] = noteLines
      .map((l) => l ?? '')
      .join('\n')
      .replace(/\n+$/, '');
  const nameCell = pi.projectName;
  const name =
    typeof nameCell === 'string' && !isNotation(nameCell) ? nameCell : (opts.fallbackName ?? 'Imported project');
  const tol = pd.sections.equipmentSummary?.fields?.tolerance;

  const project: Project = {
    id: projectId,
    name,
    scopeProfile: 'full',
    customScope: {},
    tolerance: typeof tol === 'number' && tol > 0 && tol < 1 ? tol : 0.1,
    reportKind: 'prelim',
    info,
    blueprints: (pd.sections.projectInfo?.tables?.blueprints ?? []).map((r) => ({
      sheet: r.sheet === null || r.sheet === undefined ? '' : String(r.sheet),
      revisionDate: r.revisionDate === null || r.revisionDate === undefined ? '' : String(r.revisionDate),
    })),
    naState,
    templateRevision: pd.templateRevision,
    createdAt: now,
    updatedAt: now,
  };

  const instruments: Instrument[] = (pd.sections.calibration?.tables?.instruments ?? []).map((r, i) => ({
    id: newId(),
    projectId,
    order: i,
    type: String(r.type ?? ''),
    manufacturer: String(r.manufacturer ?? ''),
    model: String(r.model ?? ''),
    serial: String(r.serial ?? ''),
    calibrationDate: String(r.calibrationDate ?? ''),
    createdAt: now,
    updatedAt: now,
  }));

  const equipment: Equipment[] = [];
  const rows: AirflowRow[] = [];
  for (const [type, units] of Object.entries(pd.equipment)) {
    const info = equipmentType(type as EquipmentTypeKey);
    for (const u of units) {
      const id = newId();
      const data: Record<string, FieldValue> = {};
      const na = emptyNaState();
      for (const [k, v] of [...Object.entries(u.schedule ?? {}), ...Object.entries(u.fields ?? {})]) {
        if (k === 'designation') continue;
        take(k, v, data, na.fields);
      }
      const remarks = u.lines?.remarks;
      if (remarks?.length)
        data.remarks = remarks
          .map((l) => l ?? '')
          .join('\n')
          .replace(/\n+$/, '');
      // one "Shv Bore M/F" cell (revisions 05 / 06): the app keeps the motor and fan bores apart
      if ('sheaveBore' in data || na.fields.sheaveBore) {
        const mark = na.fields.sheaveBore;
        const split = splitSheaveBore(data.sheaveBore);
        if (mark) {
          na.fields.motorBore = mark;
          na.fields.fanBore = mark;
        } else if (split) {
          data.motorBore = split.motorBore;
          if (split.fanBore !== null) data.fanBore = split.fanBore;
        }
        delete data.sheaveBore;
        delete na.fields.sheaveBore;
      }
      // a fan measured at its hood(s) (rev 07 line): the hoods' CFMs are derived from the hoods, not stored
      if (typeof data.hoodLine === 'string' && data.hoodLine.trim()) data.measuredAt = 'Hood';
      for (const k of ['hoodLine', 'hoodDesignCfm', 'hoodInitialCfm', 'hoodFinalCfm']) {
        delete data[k];
        delete na.fields[k];
      }
      // app-only answers, derived from the data
      if (typeof data.vsdFinal === 'number' || typeof data.vsdInitial === 'number') data.hasVfd = 'Yes';
      if (!isBlank(data.filters)) data.hasFilters = 'Yes';
      // Export writes automatic N/A as "N/A", so an "N/A" there also answers the app-only questions.
      const naOnly = (k: string) => na.fields[k]?.notation === 'N/A' && isBlank(data[k]);
      if (data.hasVfd === undefined && naOnly('vsdFinal')) data.hasVfd = 'No';
      if (data.hasFilters === undefined && naOnly('filters')) data.hasFilters = 'No';
      // a 3-point static profile: entering, fan inlet and discharge only (the other leaving statics blank)
      if (typeof data.spEntering === 'number' && typeof data.spLeaving5 === 'number') {
        const skipped = [1, 2, 3, 4].filter((n) => tapSkipped(n, { ...data, spTaps: THREE_POINT }));
        const fanInlet = [1, 2, 3, 4].some((n) => !skipped.includes(n) && typeof data[`spLeaving${n}`] === 'number');
        if (
          fanInlet &&
          skipped.length &&
          skipped.every((n) => isBlank(data[`spLeaving${n}`]) && !na.fields[`spLeaving${n}`])
        )
          data.spTaps = THREE_POINT;
      }
      const designation = u.schedule?.designation ?? u.fields?.designation;
      equipment.push({
        id,
        projectId,
        type: type as EquipmentTypeKey,
        designation: typeof designation === 'string' && designation.trim() ? designation : `${info.prefix}${u.slot}`,
        slot: u.slot,
        isExisting: u.existing === true,
        data,
        naState: na,
        createdAt: now,
        updatedAt: now,
      });
      const def = map.equipment.find((d) => d.key === type) as EquipmentDef;
      const layout = blockLayout(def, u.slot);
      // other free-text lines (hood technician notes)
      for (const [k, lines] of Object.entries(u.lines ?? {})) {
        if (k === 'remarks' || !lines.length) continue;
        data[k] = lines
          .map((l) => l ?? '')
          .join('\n')
          .replace(/\n+$/, '');
      }
      // reading sequences: reading i -> data[key_i]; a lone notation in the first cell is the whole run's N/A
      for (const [k, vals] of Object.entries(u.sequences ?? {})) {
        if (vals.length === 1 && isNotation(vals[0])) {
          na.fields[seqNaKey(k)] = { notation: vals[0] };
          continue;
        }
        vals.forEach((v, i) => take(seqKey(k, i + 1), v ?? undefined, data, na.fields));
      }
      const tables: [string, Record<string, Cell>[]][] = [
        ...Object.entries(u.tables ?? {}),
        ...Object.entries(u.columnTables ?? {}),
      ];
      for (const [table, trs] of tables) {
        const firstCol =
          layout.tables?.find((t) => t.key === table)?.columns[0].key ??
          layout.columnTables?.find((t) => t.key === table)?.fields[0].key;
        // a table written as N/A: the notation alone in the first row's first column
        const only = trs.length === 1 ? Object.entries(trs[0]).filter(([, v]) => v !== null && v !== undefined) : [];
        if (only.length === 1 && only[0][0] === firstCol && isNotation(only[0][1])) {
          na.fields[tableNaKey(table)] = { notation: only[0][1] };
          continue;
        }
        let order = 0;
        for (const tr of trs) {
          const rd: Record<string, FieldValue> = {};
          const rna: Record<string, NaMark | null> = {};
          for (const [k, v] of Object.entries(tr)) take(k, v, rd, rna);
          if (!Object.keys(rd).length && !Object.keys(rna).length) continue;
          // a fan measured at its hood: the export's hood lines (rev 05 / 06) are the hood's readings, not grilles
          if (
            type === 'fan' &&
            table === 'outlets' &&
            rd.type === 'Hood' &&
            /^Hood .*\(measured at hood\)$/.test(String(rd.area ?? ''))
          ) {
            data.measuredAt = 'Hood';
            if (typeof data.akNotes === 'string' && data.akNotes.startsWith('Measured at hood ')) delete data.akNotes;
            continue;
          }
          rows.push({
            id: newId(),
            projectId,
            equipmentId: id,
            table,
            order: ++order,
            data: rd,
            na: rna,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }
  }

  // A plain "N/A" that the app would set by itself anyway (automatic rule or scope profile) is imported as
  // automatic, not as an explicit mark, so a re-import does not turn automatic N/A into manual marks.
  const importLinks = hoodLinks(equipment);
  for (const e of equipment) {
    const spec = getSpec(e.type);
    const unitRows = rows.filter((r) => r.equipmentId === e.id);
    const completion = (fields: Record<string, NaMark | null>): Completion =>
      computeCompletion({
        spec,
        unit: { ...e, naState: { ...e.naState, fields } },
        rows: unitRows,
        photos: [],
        project,
        openIssues: 0,
        hoodLinked: importLinks.has(e.id),
      });
    const automatic = (st: string | undefined) => st === 'auto-na' || st === 'scope-na';
    for (const [k, mark] of Object.entries(e.naState.fields)) {
      if (mark?.notation !== 'N/A') continue;
      const fields = { ...e.naState.fields };
      delete fields[k];
      const c = completion(fields);
      const st = k.startsWith('table:')
        ? c.tables[k.slice(6)]?.state
        : k.startsWith('seq:')
          ? c.sequences[k.slice(4)]?.state
          : c.fields[k]?.state;
      if (automatic(st)) e.naState.fields = fields;
    }
    // row columns (hood readings 2-3 on VelGrid filters, "No Filter" rows)
    const c = completion(e.naState.fields);
    for (const r of unitRows) {
      const auto = c.tables[r.table]?.rows[r.id]?.auto ?? {};
      for (const [k, mark] of Object.entries(r.na)) if (mark?.notation === 'N/A' && k in auto) delete r.na[k];
    }
  }

  const issues: Issue[] = [];
  const designations = new Map(equipment.map((e) => [e.designation.toLowerCase(), e.id]));
  const lines = rowNames(equipment, rows);
  for (const [key, kind, table] of [
    ['issuesNew', 'new', 'issues'],
    ['issuesExisting', 'existing', 'issues'],
    ['issuesNew', 'new', 'observations'],
    ['issuesExisting', 'existing', 'observations'],
  ] as const) {
    const observation = table === 'observations';
    (pd.sections[key]?.tables?.[table] ?? []).forEach((r, i) => {
      if (Object.values(r).every((v) => v === null || v === undefined || v === '')) return;
      let remark = r.remark === null || r.remark === undefined ? '' : String(r.remark);
      let equipmentId: string | null = null;
      let airflowRowId: string | null = null;
      // "RTU-1: …" or "RTU-1 · Supply outlets #12: …"
      const m = /^([^:\n]{1,80}):\s*([\s\S]*)$/.exec(remark);
      if (m) {
        const [unit, line] = m[1].split(' · ').map((x) => x.trim());
        const id = designations.get(unit.toLowerCase());
        if (id) {
          equipmentId = id;
          airflowRowId = line ? findRow(lines, id, line) : null;
          remark = line && !airflowRowId ? `${line}: ${m[2]}` : m[2];
        }
      }
      issues.push({
        id: newId(),
        projectId,
        kind,
        number: typeof r.no === 'number' ? r.no : i + 1,
        remark,
        status: r.status === 'Closed' ? 'Closed' : 'Open',
        comments: r.comments === null || r.comments === undefined ? '' : String(r.comments),
        equipmentId,
        ...(airflowRowId ? { airflowRowId } : {}),
        ...(observation ? { issueType: 'observation' as const } : {}),
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  return { project, equipment, rows, issues, instruments };
}
