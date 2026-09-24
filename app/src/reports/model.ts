/**
 * What goes into a report (pure): which photos, in which groups and order, with which labels and captions.
 *
 * Photo Report: one group per unit (equipment type order, then designation), then "General". Each unit group holds
 * its unit / tag / OA damper / other photos in their order and, when deficiency photos are included, the
 * deficiency photos of issues linked to that unit (Photo N-3.1 ...); deficiency photos of General issues go to
 * "General". The cover photo is in the workbook, not in the report.
 * Issues Report: a New equipment section (Summary - New) and an Existing equipment section (Summary - (E)), either
 * or both; each issue with its number (N-3 / E-3), unit or "General", status, remark, comments and its photos.
 * Combined: the Issues Report followed by the Photo Report without deficiency photos (they are with their issue).
 */
import type { Equipment, Issue, IssueKind, Photo } from '../data/types';
import {
  CATEGORY_LABEL,
  comparePhotos,
  deficiencyLabels,
  groupPhotoLabels,
  issueLabel,
  issuePhotos,
  sortEquipment,
  type PhotoMeta,
} from '../photos/labels';
import type { PerPage } from './layout';

export const FIRM_NAME = 'a2b accurate air balancing, llc';

export type ReportKind = 'photos' | 'issues' | 'combined';

export interface ReportOptions {
  kind: ReportKind;
  /** Issues / combined: which lists (default both). */
  issueKinds?: readonly IssueKind[];
  /** Photo grid density (default 4). */
  perPage?: PerPage;
  /** Photo Report: include deficiency photos (default true). */
  includeDeficiency?: boolean;
  /** Report label / revision (Prelim, Rev 1 ...). */
  label: string;
  /** Report date (default: the project's report date, else today). */
  date?: Date;
}

export type ReportPhotoMeta = PhotoMeta & Pick<Photo, 'width' | 'height' | 'mimeType'>;

export interface ReportPhoto {
  id: string;
  label: string;
  caption: string;
  width?: number;
  height?: number;
}

export interface PhotoGroup {
  title: string;
  subtitle: string;
  photos: ReportPhoto[];
}

export interface IssueEntry {
  id: string;
  label: string;
  kind: IssueKind;
  number: number;
  equipment: string;
  status: 'Open' | 'Closed';
  remark: string;
  comments: string;
  photos: ReportPhoto[];
}

export interface IssueSection {
  kind: IssueKind;
  title: string;
  sheet: string;
  issues: IssueEntry[];
}

export interface ReportModel {
  kind: ReportKind;
  title: string;
  firm: string;
  projectName: string;
  address: string;
  reportDate: string;
  label: string;
  perPage: PerPage;
  /** Short facts under the title ("12 photos · 5 units"). */
  summary: string[];
  issueSections: IssueSection[];
  photoGroups: PhotoGroup[];
}

export interface ReportInput {
  project: { name: string; info: Record<string, unknown> };
  equipment: readonly Pick<Equipment, 'id' | 'type' | 'designation' | 'isExisting'>[];
  issues: readonly Issue[];
  photos: readonly ReportPhotoMeta[];
  /** Equipment type keys in report order, and their labels. */
  typeOrder: readonly string[];
  typeLabel: (type: string) => string;
}

/** "2026-09-24" (or a Date) -> "September 24, 2026". */
export function formatReportDate(d: string | Date): string {
  const date =
    typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)
      ? new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
      : new Date(d);
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return Number.isFinite(date.getTime())
    ? `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
    : String(d);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function reportTitle(kind: ReportKind, issueKinds: readonly IssueKind[] = ['new', 'existing']): string {
  const which = issueKinds.length === 1 ? (issueKinds[0] === 'new' ? ' - New Equipment' : ' - Existing Equipment') : '';
  if (kind === 'photos') return 'Photo Report';
  if (kind === 'issues') return `Issues Report${which}`;
  return `Issues and Photo Report${which}`;
}

export function buildReportModel(input: ReportInput, opts: ReportOptions): ReportModel {
  const perPage = opts.perPage ?? 4;
  const issueKinds = opts.issueKinds?.length ? opts.issueKinds : (['new', 'existing'] as const);
  const eqById = new Map(input.equipment.map((e) => [e.id, e]));
  const photos = input.photos.filter((p) => p.category !== 'cover');
  const defLabels = deficiencyLabels(photos, input.issues);
  const issueById = new Map(input.issues.map((i) => [i.id, i]));
  const sortedIssues = [...input.issues].sort((a, b) =>
    a.kind === b.kind ? a.number - b.number : a.kind === 'new' ? -1 : 1,
  );
  const unitName = (e: Pick<Equipment, 'designation' | 'type' | 'isExisting'>) =>
    `${e.designation} – ${input.typeLabel(e.type)}${e.isExisting ? ' (existing)' : ''}`;

  const toReportPhoto = (p: ReportPhotoMeta, label: string): ReportPhoto => {
    let caption = p.caption.trim();
    if (!caption && p.category === 'deficiency') {
      const issue = p.issueId ? issueById.get(p.issueId) : undefined;
      if (issue?.remark) caption = `Issue ${issueLabel(issue)}: ${issue.remark}`;
    }
    return { id: p.id, label, caption, width: p.width, height: p.height };
  };
  const deficiencyOf = (issue: Issue) =>
    issuePhotos(photos, issue.id).map((p) => toReportPhoto(p, defLabels.get(p.id) ?? 'Photo'));

  // ---- issues
  const issueSections: IssueSection[] = [];
  if (opts.kind !== 'photos') {
    for (const kind of issueKinds) {
      issueSections.push({
        kind,
        title: kind === 'new' ? 'New Equipment' : 'Existing Equipment',
        sheet: kind === 'new' ? 'Summary - New' : 'Summary - (E)',
        issues: sortedIssues
          .filter((i) => i.kind === kind)
          .map((i) => {
            const e = i.equipmentId ? eqById.get(i.equipmentId) : undefined;
            return {
              id: i.id,
              label: issueLabel(i),
              kind: i.kind,
              number: i.number,
              equipment: e ? unitName(e) : 'General',
              status: i.status,
              remark: i.remark,
              comments: i.comments,
              photos: deficiencyOf(i),
            };
          }),
      });
    }
  }

  // ---- photo groups
  const photoGroups: PhotoGroup[] = [];
  if (opts.kind !== 'issues') {
    const withDeficiency = opts.kind === 'photos' && opts.includeDeficiency !== false;
    const deficiencyFor = (equipmentId: string | null) =>
      withDeficiency ? sortedIssues.filter((i) => (i.equipmentId ?? null) === equipmentId).flatMap(deficiencyOf) : [];
    for (const e of sortEquipment(input.equipment, input.typeOrder)) {
      const own = photos.filter((p) => p.category !== 'deficiency' && p.equipmentId === e.id).sort(comparePhotos);
      const labels = groupPhotoLabels(own, e.designation || 'Unit');
      const list = [
        ...own.map((p) => toReportPhoto(p, labels.get(p.id) ?? CATEGORY_LABEL[p.category])),
        ...deficiencyFor(e.id),
      ];
      if (list.length) photoGroups.push({ title: e.designation || 'Unit', subtitle: unitName(e), photos: list });
    }
    const general = photos.filter((p) => p.category !== 'deficiency' && !p.equipmentId).sort(comparePhotos);
    const gl = groupPhotoLabels(general, null);
    // deficiency photos of issues whose unit no longer exists count as General too
    const orphanIssues = withDeficiency
      ? sortedIssues.filter((i) => i.equipmentId && !eqById.has(i.equipmentId)).flatMap(deficiencyOf)
      : [];
    const gList = [
      ...general.map((p) => toReportPhoto(p, gl.get(p.id) ?? 'General')),
      ...deficiencyFor(null),
      ...orphanIssues,
    ];
    if (gList.length)
      photoGroups.push({ title: 'General', subtitle: 'General – not attached to a unit', photos: gList });
  }

  const summary: string[] = [];
  if (issueSections.length) {
    for (const s of issueSections) {
      const open = s.issues.filter((i) => i.status === 'Open').length;
      summary.push(`${s.title}: ${plural(s.issues.length, 'issue')} (${open} open)`);
    }
  }
  if (photoGroups.length || opts.kind === 'photos') {
    const n = photoGroups.reduce((m, g) => m + g.photos.length, 0);
    const units = photoGroups.filter((g) => g.title !== 'General').length;
    summary.push(
      `${plural(n, 'photo')} of ${plural(units, 'unit')}${photoGroups.some((g) => g.title === 'General') ? ' and general' : ''}`,
    );
  }

  const info = input.project.info;
  const reportDate =
    opts.date ?? (typeof info.reportDate === 'string' && info.reportDate ? info.reportDate : new Date());
  return {
    kind: opts.kind,
    title: reportTitle(opts.kind, issueKinds),
    firm: FIRM_NAME,
    projectName: input.project.name,
    address: typeof info.address === 'string' ? info.address : '',
    reportDate: formatReportDate(reportDate),
    label: opts.label.trim(),
    perPage,
    summary,
    issueSections,
    photoGroups,
  };
}

const clean = (s: string) =>
  s
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

/** "Riverside MOB - Photo Report Rev 1 2026-09-24.pdf" (same pattern as the workbook export). */
export function reportFileName(
  projectName: string,
  kind: ReportKind | 'zip',
  label: string,
  issueKinds: readonly IssueKind[] = ['new', 'existing'],
  date = new Date(),
): string {
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const which = issueKinds.length === 1 ? (issueKinds[0] === 'new' ? ' (New)' : ' (Existing)') : '';
  const name =
    kind === 'photos'
      ? 'Photo Report'
      : kind === 'issues'
        ? `Issues Report${which}`
        : kind === 'combined'
          ? `Issues and Photo Report${which}`
          : 'Photos';
  const l = clean(label);
  return `${clean(projectName) || 'Project'} - ${name} ${l ? `${l} ` : ''}${d}.${kind === 'zip' ? 'zip' : 'pdf'}`;
}
