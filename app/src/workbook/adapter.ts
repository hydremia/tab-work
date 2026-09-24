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
 */
import {
  NOTATIONS as WB_NOTATIONS,
  TEMPLATE_MAP,
  TEMPLATE_REVISION,
  type Cell,
  type FieldDef,
  type ProjectData,
  type UnitData,
} from '@a2b/workbook/map';
import { computeCompletion, isNaState } from '../domain/completion';
import { isBlank } from '../domain/conditions';
import { equipmentType, type EquipmentTypeKey } from '../domain/equipmentTypes';
import { getSpec, ROW_COLUMNS } from '../domain/specs';
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

export function toProjectData(b: ProjectBundle): { data: ProjectData; warnings: string[] } {
  const warnings: string[] = [];
  const { project } = b;
  const pd: ProjectData = { templateRevision: TEMPLATE_REVISION, name: project.name, sections: {}, equipment: {} };
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
  for (const kind of ['new', 'existing'] as const) {
    const list = b.issues.filter((i) => i.kind === kind).sort((a, c) => a.number - c.number);
    if (!list.length) continue;
    if (list.length > 50)
      warnings.push(`${kind === 'new' ? 'Summary - New' : 'Summary - (E)'}: ${list.length} issues, room for 50`);
    const rows = list.slice(0, 50).map((i) => {
      const eq = i.equipmentId ? byId.get(i.equipmentId) : undefined;
      const remark = eq && !i.remark.startsWith(`${eq.designation}:`) ? `${eq.designation}: ${i.remark}` : i.remark;
      const row: Record<string, Cell> = { no: i.number, status: i.status };
      put(row, 'remark', out(remark, null));
      put(row, 'comments', out(i.comments, null));
      return row;
    });
    pd.sections[kind === 'new' ? 'issuesNew' : 'issuesExisting'] = { tables: { issues: rows } };
  }

  // ---- equipment
  for (const e of b.equipment) {
    const def = TEMPLATE_MAP.equipment.find((d) => d.key === e.type);
    if (!def) continue;
    const spec = getSpec(e.type);
    const unitRows = b.rows.filter((r) => r.equipmentId === e.id);
    const c = computeCompletion({
      spec,
      unit: e,
      rows: unitRows,
      photos: [],
      project,
      openIssues: 0,
    });
    const path = `${e.designation} (${e.type} slot ${e.slot})`;
    const unit: UnitData = { slot: e.slot };
    const schedule: Record<string, Cell> = {};
    const fields: Record<string, Cell> = {};
    if (def.ede) schedule.designation = e.designation;
    const keys = new Set([...Object.keys(e.data), ...Object.keys(e.naState.fields), ...Object.keys(c.fields)]);
    for (const key of keys) {
      if (key === 'designation' || key === 'remarks') continue;
      const edeDef = def.ede?.fields.find((f) => f.key === key);
      const blockDef = def.block.fields?.find((f) => f.key === key);
      if (!edeDef && !blockDef) continue; // app-only (hasVfd, photo:/table: marks)
      const st = c.fields[key];
      const levelMark: NaMark | null =
        st && isNaState(st.state) && st.state !== 'na' && st.notation ? { notation: st.notation } : null;
      const raw = out(e.data[key], e.naState.fields[key] ?? levelMark);
      if (raw === undefined) continue;
      const v = coerce(edeDef ?? blockDef, raw, `${path}.${key}`, warnings);
      if (v === undefined) continue;
      if (edeDef) schedule[key] = v;
      else fields[key] = v;
    }
    if (Object.keys(schedule).length) unit.schedule = schedule;
    if (Object.keys(fields).length) unit.fields = fields;

    // airflow tables
    for (const td of def.block.tables ?? []) {
      const rows = unitRows.filter((r) => r.table === td.key).sort((a, c2) => a.order - c2.order);
      if (!rows.length) continue;
      unit.tables ??= {};
      unit.tables[td.key] = rows.map((r, i) => {
        const rec: Record<string, Cell> = {};
        for (const col of ROW_COLUMNS) {
          if (!td.columns.some((cd) => cd.key === col.key)) continue;
          if (i === 0 && col.key === 'designCfm' && td.segments[0].omit?.[0]?.includes('H')) continue; // formula
          const raw = out(r.data[col.key], r.na[col.key]);
          if (raw === undefined) continue;
          const v = coerce(
            td.columns.find((cd) => cd.key === col.key),
            raw,
            `${path}.${td.key}[${i}].${col.key}`,
            warnings,
          );
          if (v !== undefined) rec[col.key] = v;
        }
        return rec;
      });
    }

    // remarks
    const remarksDef = def.block.lines?.find((l) => l.key === 'remarks');
    const remarks = e.data.remarks;
    if (remarksDef && typeof remarks === 'string' && remarks.trim()) {
      const lines = splitLines(remarks, remarksDef.cells.length);
      unit.lines = { remarks: lines };
    }
    (pd.equipment[e.type] ??= []).push(unit);
  }
  for (const k of Object.keys(pd.equipment)) pd.equipment[k].sort((a, c) => a.slot - c.slot);
  return { data: pd, warnings };
}

// ------------------------------------------------------------------------------------------ import
export interface FromOptions {
  now?: number;
  newId?: () => string;
  fallbackName?: string;
}

export function fromProjectData(pd: ProjectData, opts: FromOptions = {}): ProjectBundle {
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
      // app-only answers, derived from the data
      if (typeof data.vsdFinal === 'number' || typeof data.vsdInitial === 'number') data.hasVfd = 'Yes';
      if (!isBlank(data.filters)) data.hasFilters = 'Yes';
      // Export writes automatic N/A as "N/A", so an "N/A" there also answers the app-only questions.
      const naOnly = (k: string) => na.fields[k]?.notation === 'N/A' && isBlank(data[k]);
      if (data.hasVfd === undefined && naOnly('vsdFinal')) data.hasVfd = 'No';
      if (data.hasFilters === undefined && naOnly('filters')) data.hasFilters = 'No';
      const designation = u.schedule?.designation;
      equipment.push({
        id,
        projectId,
        type: type as EquipmentTypeKey,
        designation: typeof designation === 'string' && designation.trim() ? designation : `${info.prefix}${u.slot}`,
        slot: u.slot,
        isExisting: false,
        data,
        naState: na,
        createdAt: now,
        updatedAt: now,
      });
      for (const [table, trs] of Object.entries(u.tables ?? {})) {
        let order = 0;
        for (const tr of trs) {
          const rd: Record<string, FieldValue> = {};
          const rna: Record<string, NaMark | null> = {};
          for (const [k, v] of Object.entries(tr)) take(k, v, rd, rna);
          if (!Object.keys(rd).length && !Object.keys(rna).length) continue;
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
  for (const e of equipment) {
    const spec = getSpec(e.type);
    const unitRows = rows.filter((r) => r.equipmentId === e.id);
    for (const [k, mark] of Object.entries(e.naState.fields)) {
      if (mark?.notation !== 'N/A') continue;
      const fields = { ...e.naState.fields };
      delete fields[k];
      const trial = { ...e, naState: { ...e.naState, fields } };
      const st = computeCompletion({ spec, unit: trial, rows: unitRows, photos: [], project, openIssues: 0 })
        .fields[k]?.state;
      if (st === 'auto-na' || st === 'scope-na') e.naState.fields = fields;
    }
  }

  const issues: Issue[] = [];
  const designations = new Map(equipment.map((e) => [e.designation.toLowerCase(), e.id]));
  for (const [key, kind] of [
    ['issuesNew', 'new'],
    ['issuesExisting', 'existing'],
  ] as const) {
    (pd.sections[key]?.tables?.issues ?? []).forEach((r, i) => {
      if (Object.values(r).every((v) => v === null || v === undefined || v === '')) return;
      let remark = r.remark === null || r.remark === undefined ? '' : String(r.remark);
      let equipmentId: string | null = null;
      const m = /^([^:\n]{1,30}):\s*([\s\S]*)$/.exec(remark);
      if (m && designations.has(m[1].trim().toLowerCase())) {
        equipmentId = designations.get(m[1].trim().toLowerCase()) ?? null;
        remark = m[2];
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
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  return { project, equipment, rows, issues, instruments };
}
