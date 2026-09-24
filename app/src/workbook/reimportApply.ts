/**
 * Turning the reviewed re-import decisions into record operations (pure), and a preview of the result in memory.
 * The operations are executed by importProject.applyReimport() through the repository (setField / createRecord /
 * deleteRecord), so every accepted value becomes a field change in the sync outbox.
 *
 * Only items resolved to the workbook ('wb') produce operations; 'app' (declined / use app) leaves the app as is.
 */
import type { ProjectData } from '@a2b/workbook/map';
import { isBlank } from '../domain/conditions';
import {
  NOTATIONS,
  type AirflowRow,
  type Equipment,
  type FieldValue,
  type Instrument,
  type Issue,
  type Notation,
  type TableName,
} from '../data/types';
import { getPath, setPath } from '../data/paths';
import { uuid } from '../data/uuid';
import { toProjectData, type ProjectBundle } from './adapter';
import type { Choice, DiffItem, FlatRec, FullDiff, Val } from './reimportDiff';

type AnyRecord = { id: string; projectId?: string; updatedAt: number };

export type Op =
  | { op: 'set'; table: TableName; id: string; field: string; value: unknown }
  | { op: 'create'; table: TableName; record: AnyRecord }
  | { op: 'delete'; table: TableName; id: string };

export interface ApplyPlan {
  ops: Op[];
  warnings: string[];
  accepted: number;
  declined: number;
}

const isNotation = (v: unknown): v is Notation => typeof v === 'string' && (NOTATIONS as readonly string[]).includes(v);

/** The decision in effect for an item: the user's pick, else the default. */
export function choiceOf(item: DiffItem, decisions: Readonly<Record<string, Choice | undefined>>): Choice | null {
  return decisions[item.id] ?? item.defaultChoice;
}

/** The app's rows of a table that the export writes as non-empty rows, in order (= the diff's app-side rows). */
function keptRows(real: ProjectBundle, pd: ProjectData, e: Equipment, table: string): AirflowRow[] | null {
  const rows = real.rows.filter((r) => r.equipmentId === e.id && r.table === table).sort((a, b) => a.order - b.order);
  const unit = pd.equipment[e.type]?.find((u) => u.slot === e.slot);
  const recs = unit?.tables?.[table] ?? unit?.columnTables?.[table];
  if (!recs || recs.length !== rows.length) return recs ? null : [];
  return rows.filter((_r, i) => Object.keys(recs[i]).length > 0);
}

export function planApply(
  real: ProjectBundle,
  diff: FullDiff,
  decisions: Readonly<Record<string, Choice | undefined>>,
  opts: { newId?: () => string; now?: number } = {},
): ApplyPlan {
  const newId = opts.newId ?? uuid;
  const now = opts.now ?? Date.now();
  const projectId = real.project.id;
  const ops: Op[] = [];
  const warnings: string[] = [];
  let accepted = 0;
  let declined = 0;
  const { data: pd } = toProjectData(real);
  const W = diff.flats.wb;
  const A = diff.flats.app;
  const wbSide = diff.sides.wb;

  const set = (table: TableName, id: string, field: string, value: unknown) =>
    ops.push({ op: 'set', table, id, field, value });
  /** A value or an N/A notation, into the value path and the mark path. */
  const valueOps = (table: TableName, rec: object, id: string, dataPath: string, markPath: string, v: Val) => {
    const cur = getPath(rec, dataPath) as unknown;
    const mark = getPath(rec, markPath) as unknown;
    if (v === null || isNotation(v)) {
      if (!isBlank(cur as FieldValue)) set(table, id, dataPath, null);
      if (v === null ? mark : (mark as { notation?: string } | null)?.notation !== v)
        set(table, id, markPath, v === null ? null : { notation: v });
    } else {
      set(table, id, dataPath, v);
      if (mark) set(table, id, markPath, null);
    }
  };

  const unitOf = (type: string, slot: number) => real.equipment.find((e) => e.type === type && e.slot === slot);
  const createdUnits = new Map<string, string>(); // `${type}#${slot}` -> new id
  const unitIdFor = (type: string, slot: number) =>
    createdUnits.get(`${type}#${slot}`) ?? unitOf(type, slot)?.id ?? null;
  /** The workbook's designation of an issue's unit -> the app unit (matched by type + slot). */
  const unitIdByWbDesignation = (d: Val): string | null => {
    if (d === null) return null;
    const e = wbSide.equipment.find((x) => x.designation.toLowerCase() === String(d).toLowerCase());
    return e ? unitIdFor(e.type, e.slot) : null;
  };
  const wbRec = (key: string): FlatRec | undefined => W.get(key);
  const wbUnit = (type: string, slot: number) => wbSide.equipment.find((e) => e.type === type && e.slot === slot);

  const chosen = diff.items.filter((it) => {
    const c = choiceOf(it, decisions);
    if (c === 'wb') accepted++;
    else declined++;
    return c === 'wb';
  });
  // units first (issues may link to a unit created here), then everything else in list order
  const order = (it: DiffItem) => (it.ref.kind === 'unit' && it.change !== 'field' ? 0 : 1);
  const blueprintEdits: DiffItem[] = [];
  const unitDataTouched = new Map<string, Set<string>>();

  for (const it of [...chosen].sort((a, b) => order(a) - order(b))) {
    const ref = it.ref;
    switch (ref.kind) {
      case 'project': {
        const cell = it.cell!;
        const p = real.project;
        if (cell === 'name') {
          if (typeof it.wb === 'string' && it.wb.trim()) set('projects', projectId, 'name', it.wb.trim());
          else warnings.push('Project name: the workbook has none; kept the app name.');
        } else if (cell === 'tolerance') {
          if (typeof it.wb === 'number' && it.wb > 0 && it.wb < 1) set('projects', projectId, 'tolerance', it.wb);
          else warnings.push(`Tolerance "${String(it.wb)}" is not a fraction between 0 and 1; kept ${p.tolerance}.`);
        } else {
          const k = cell.replace(/^info\./, '');
          valueOps('projects', p, projectId, `info.${k}`, `naState.fields.${k}`, it.wb);
        }
        break;
      }
      case 'blueprint':
        blueprintEdits.push(it);
        break;
      case 'instrument': {
        const real2 = [...real.instruments]
          .sort((a, b) => a.order - b.order)
          .filter((i) => [i.type, i.manufacturer, i.model, i.serial, i.calibrationDate].some((x) => !isBlank(x)));
        const target = A.has(it.recKey) ? real2[ref.index] : undefined;
        if (it.change === 'field' && target)
          set('instruments', target.id, it.cell!, it.wb === null ? '' : String(it.wb));
        else if (it.change === 'removed' && target) ops.push({ op: 'delete', table: 'instruments', id: target.id });
        else if (it.change === 'added' || it.change === 'restored') {
          const w = wbRec(it.recKey)!.cells;
          const maxOrder = real.instruments.reduce((m, i) => Math.max(m, i.order), -1);
          const rec: Instrument = {
            id: newId(),
            projectId,
            order: maxOrder + 1 + ref.index,
            type: String(w.type ?? ''),
            manufacturer: String(w.manufacturer ?? ''),
            model: String(w.model ?? ''),
            serial: String(w.serial ?? ''),
            calibrationDate: String(w.calibrationDate ?? ''),
            createdAt: now,
            updatedAt: now,
          };
          ops.push({ op: 'create', table: 'instruments', record: rec });
        }
        break;
      }
      case 'issue': {
        const target = real.issues.find((i) => i.kind === ref.issueKind && i.number === ref.number);
        if (it.change === 'field' && target) {
          if (it.cell === 'unit') set('issues', target.id, 'equipmentId', unitIdByWbDesignation(it.wb));
          else if (it.cell === 'status') set('issues', target.id, 'status', it.wb === 'Closed' ? 'Closed' : 'Open');
          else set('issues', target.id, it.cell!, it.wb === null ? '' : String(it.wb));
        } else if (it.change === 'removed' && target) ops.push({ op: 'delete', table: 'issues', id: target.id });
        else if (it.change === 'added' || it.change === 'restored') {
          const w = wbRec(it.recKey)!.cells;
          const rec: Issue = {
            id: newId(),
            projectId,
            kind: ref.issueKind,
            number: ref.number,
            remark: String(w.remark ?? ''),
            status: w.status === 'Closed' ? 'Closed' : 'Open',
            comments: String(w.comments ?? ''),
            equipmentId: unitIdByWbDesignation(w.unit ?? null),
            createdAt: now,
            updatedAt: now,
          };
          ops.push({ op: 'create', table: 'issues', record: rec });
        }
        break;
      }
      case 'unit': {
        const target = unitOf(ref.type, ref.slot);
        if (it.change === 'field' && target) {
          const cell = it.cell!;
          if (cell === 'designation') {
            if (typeof it.wb === 'string' && it.wb.trim()) set('equipment', target.id, 'designation', it.wb.trim());
          } else if (cell.startsWith('table:') || cell.startsWith('seq:')) {
            set('equipment', target.id, `naState.fields.${cell}`, it.wb === null ? null : { notation: String(it.wb) });
          } else {
            valueOps('equipment', target, target.id, `data.${cell}`, `naState.fields.${cell}`, it.wb);
            if (!unitDataTouched.has(target.id)) unitDataTouched.set(target.id, new Set());
            unitDataTouched.get(target.id)!.add(cell);
          }
        } else if (it.change === 'removed' && target) {
          ops.push({ op: 'delete', table: 'equipment', id: target.id });
        } else if (it.change === 'added' || it.change === 'restored') {
          const src = wbUnit(ref.type, ref.slot);
          if (!src) break;
          const id = newId();
          createdUnits.set(`${ref.type}#${ref.slot}`, id);
          const unit: Equipment = {
            ...structuredClone(src),
            id,
            projectId,
            createdAt: now,
            updatedAt: now,
          };
          ops.push({ op: 'create', table: 'equipment', record: unit });
          for (const r of wbSide.rows.filter((x) => x.equipmentId === src.id)) {
            const row: AirflowRow = {
              ...structuredClone(r),
              id: newId(),
              projectId,
              equipmentId: id,
              createdAt: now,
              updatedAt: now,
            };
            ops.push({ op: 'create', table: 'airflowRows', record: row });
          }
        }
        break;
      }
      case 'row': {
        const unit = unitOf(ref.type, ref.slot);
        const kept = unit ? keptRows(real, pd, unit, ref.table) : null;
        const aRec = A.get(it.recKey);
        const target = aRec && kept ? kept[aRec.ref.kind === 'row' ? aRec.ref.index : -1] : undefined;
        if ((it.change === 'field' || it.change === 'removed') && !target) {
          warnings.push(`${it.groupTitle} ${it.label}: the row could not be matched in the app; skipped.`);
          break;
        }
        if (it.change === 'field' && target) {
          valueOps('airflowRows', target, target.id, `data.${it.cell}`, `na.${it.cell}`, it.wb);
        } else if (it.change === 'removed' && target) {
          ops.push({ op: 'delete', table: 'airflowRows', id: target.id });
        } else if (it.change === 'added' || it.change === 'restored') {
          const equipmentId = unitIdFor(ref.type, ref.slot);
          const src = wbSide.equipment.find((e) => e.type === ref.type && e.slot === ref.slot);
          const wRow = src
            ? wbSide.rows
                .filter((r) => r.equipmentId === src.id && r.table === ref.table)
                .sort((a, b) => a.order - b.order)[ref.index]
            : undefined;
          if (!equipmentId || !wRow) break;
          const list = kept ?? [];
          const prev = list[ref.index - 1];
          const next = list[ref.index];
          const orderVal =
            prev && next
              ? (prev.order + next.order) / 2
              : prev
                ? prev.order + 1
                : next
                  ? next.order - 1
                  : ref.index + 1;
          const row: AirflowRow = {
            id: newId(),
            projectId,
            equipmentId,
            table: ref.table,
            order: orderVal,
            data: { ...wRow.data },
            na: { ...wRow.na },
            createdAt: now,
            updatedAt: now,
          };
          ops.push({ op: 'create', table: 'airflowRows', record: row });
        }
        break;
      }
    }
  }

  // blueprints: one write of the whole list
  if (blueprintEdits.length) {
    const realIdx = real.project.blueprints
      .map((bp, i) => ({ bp, i }))
      .filter(({ bp }) => !isBlank(bp.sheet) || !isBlank(bp.revisionDate))
      .map(({ i }) => i);
    const next = real.project.blueprints.map((bp) => ({ ...bp }));
    const remove = new Set<number>();
    for (const it of blueprintEdits) {
      if (it.ref.kind !== 'blueprint') continue;
      const i = realIdx[it.ref.index];
      if (it.change === 'field' && i !== undefined)
        next[i] = { ...next[i], [it.cell!]: it.wb === null ? '' : String(it.wb) };
      else if (it.change === 'removed' && i !== undefined) remove.add(i);
      else if (it.change === 'added' || it.change === 'restored') {
        const w = wbRec(it.recKey)!.cells;
        next.push({ sheet: String(w.sheet ?? ''), revisionDate: String(w.revisionDate ?? '') });
      }
    }
    set(
      'projects',
      projectId,
      'blueprints',
      next.filter((_bp, i) => !remove.has(i)),
    );
  }

  // app-only answers follow accepted data (a VFD reading means "VFD on the unit? Yes"), as the importer derives them
  for (const [id, keys] of unitDataTouched) {
    const e = real.equipment.find((x) => x.id === id)!;
    const val = (k: string) => {
      const it = chosen.find((c) => c.ref.kind === 'unit' && unitOf(c.ref.type, c.ref.slot)?.id === id && c.cell === k);
      return it ? it.wb : (e.data[k] ?? null);
    };
    if (
      (keys.has('vsdFinal') || keys.has('vsdInitial')) &&
      (typeof val('vsdFinal') === 'number' || typeof val('vsdInitial') === 'number') &&
      e.data.hasVfd !== 'Yes'
    )
      set('equipment', id, 'data.hasVfd', 'Yes');
    const f = val('filters');
    if (keys.has('filters') && f !== null && !isNotation(f) && e.data.hasFilters !== 'Yes')
      set('equipment', id, 'data.hasFilters', 'Yes');
  }
  return { ops, warnings, accepted, declined };
}

/** The bundle after the operations (for the merge preview: unit colors). */
export function previewBundle(real: ProjectBundle, ops: readonly Op[]): ProjectBundle {
  const b: ProjectBundle = {
    project: real.project,
    equipment: [...real.equipment],
    rows: [...real.rows],
    issues: [...real.issues],
    instruments: [...real.instruments],
  };
  const listOf = (table: TableName): AnyRecord[] | null =>
    table === 'equipment'
      ? (b.equipment as unknown as AnyRecord[])
      : table === 'airflowRows'
        ? (b.rows as unknown as AnyRecord[])
        : table === 'issues'
          ? (b.issues as unknown as AnyRecord[])
          : table === 'instruments'
            ? (b.instruments as unknown as AnyRecord[])
            : null;
  for (const op of ops) {
    if (op.table === 'projects') {
      if (op.op === 'set') b.project = setPath(b.project, op.field, op.value);
      continue;
    }
    const list = listOf(op.table);
    if (!list) continue;
    if (op.op === 'create') list.push(op.record);
    else if (op.op === 'delete') {
      const i = list.findIndex((r) => r.id === op.id);
      if (i >= 0) list.splice(i, 1);
      if (op.table === 'equipment') {
        b.rows = b.rows.filter((r) => r.equipmentId !== op.id);
        b.issues = b.issues.map((x) => (x.equipmentId === op.id ? { ...x, equipmentId: null } : x));
      }
    } else {
      const i = list.findIndex((r) => r.id === op.id);
      if (i >= 0) list[i] = setPath(list[i], op.field, op.value);
    }
  }
  return b;
}
