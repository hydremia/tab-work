/**
 * Photo grouping, ordering, numbering and file names (pure; shared by the Photos tab, the issue editor, the PDF
 * reports and the zip export).
 *
 * Numbering (decision Q6 "deficiency photos numbered to their issue"):
 *  - issues are numbered separately for New (Summary - New) and Existing (Summary - (E)); in reports and labels an
 *    issue is "N-<number>" or "E-<number>" (e.g. Issue N-3, Issue E-3), so the two lists can never be confused;
 *  - the k-th deficiency photo of an issue (in its photo order) is "Photo N-3.1", "Photo N-3.2", "Photo E-1.1".
 *    Labels are computed, never stored: reordering an issue's photos or renumbering issues relabels them.
 *  - equipment photos are labelled by unit and category: "RTU-1 · Unit", "RTU-1 · Tag / label", "RTU-1 · Other 2".
 */
import type { Equipment, Issue, IssueKind, Photo, PhotoCategory } from '../data/types';

export const CATEGORY_LABEL: Record<PhotoCategory, string> = {
  cover: 'Cover',
  unit: 'Unit',
  tag: 'Tag / label',
  oa_damper: 'OA damper',
  deficiency: 'Deficiency',
  other: 'Other',
};

/** Short names for zip file names. */
const CATEGORY_FILE: Record<PhotoCategory, string> = {
  cover: 'Cover',
  unit: 'Unit',
  tag: 'Tag',
  oa_damper: 'OA Damper',
  deficiency: 'Deficiency',
  other: 'Other',
};

/** Report / list order of categories inside an equipment group when photos have the same sort key. */
export const CATEGORY_RANK: Record<PhotoCategory, number> = {
  cover: 0,
  unit: 1,
  tag: 2,
  oa_damper: 3,
  other: 4,
  deficiency: 5,
};

export type PhotoMeta = Pick<
  Photo,
  'id' | 'equipmentId' | 'issueId' | 'category' | 'caption' | 'createdAt' | 'order' | 'projectId'
>;

/** The group a photo is ordered in: cover | issue:<id> | eq:<id> | general. */
export function groupKeyOf(p: Pick<Photo, 'category' | 'issueId' | 'equipmentId'>): string {
  if (p.category === 'cover') return 'cover';
  if (p.category === 'deficiency') return `issue:${p.issueId ?? 'none'}`;
  return p.equipmentId ? `eq:${p.equipmentId}` : 'general';
}

export const sortKey = (p: Pick<Photo, 'order' | 'createdAt'>) => p.order ?? p.createdAt;

/** Stable photo order inside a group: order, then category, then creation time. */
export function comparePhotos(a: PhotoMeta, b: PhotoMeta): number {
  return sortKey(a) - sortKey(b) || CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] || a.createdAt - b.createdAt;
}

export const kindPrefix = (kind: IssueKind) => (kind === 'new' ? 'N' : 'E');

/** "N-3" / "E-3". */
export function issueLabel(issue: Pick<Issue, 'kind' | 'number'>): string {
  return `${kindPrefix(issue.kind)}-${issue.number}`;
}

/** Deficiency photos of one issue in order. */
export function issuePhotos<T extends PhotoMeta>(photos: readonly T[], issueId: string): T[] {
  return photos.filter((p) => p.category === 'deficiency' && p.issueId === issueId).sort(comparePhotos);
}

/** "Photo N-3.1" labels of every deficiency photo, by photo id. */
export function deficiencyLabels(
  photos: readonly PhotoMeta[],
  issues: readonly Pick<Issue, 'id' | 'kind' | 'number'>[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const i of issues) {
    issuePhotos(photos, i.id).forEach((p, k) => out.set(p.id, `Photo ${issueLabel(i)}.${k + 1}`));
  }
  return out;
}

/** Equipment in report order: equipment type order, then designation (numeric aware). */
export function sortEquipment<T extends Pick<Equipment, 'type' | 'designation'>>(
  equipment: readonly T[],
  typeOrder: readonly string[],
): T[] {
  return [...equipment].sort(
    (a, b) =>
      typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) ||
      a.designation.localeCompare(b.designation, undefined, { numeric: true }),
  );
}

/** Issues in report order: New first, then Existing, each by number. */
export function sortIssues<T extends Pick<Issue, 'kind' | 'number'>>(issues: readonly T[]): T[] {
  return [...issues].sort((a, b) => (a.kind === b.kind ? a.number - b.number : a.kind === 'new' ? -1 : 1));
}

/**
 * Labels of the non-deficiency photos of one group: "RTU-1 · Unit"; a category with several photos is numbered
 * ("RTU-1 · Other 1", "RTU-1 · Other 2"). General photos: "General 1", "General 2".
 */
export function groupPhotoLabels(ordered: readonly PhotoMeta[], owner: string | null): Map<string, string> {
  const out = new Map<string, string>();
  const counts = new Map<PhotoCategory, number>();
  for (const p of ordered) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const seen = new Map<PhotoCategory, number>();
  let general = 0;
  for (const p of ordered) {
    if (p.category === 'cover') {
      out.set(p.id, 'Cover photo');
      continue;
    }
    const k = (seen.get(p.category) ?? 0) + 1;
    seen.set(p.category, k);
    if (!owner) out.set(p.id, `General ${++general}`);
    else out.set(p.id, `${owner} · ${CATEGORY_LABEL[p.category]}${(counts.get(p.category) ?? 0) > 1 ? ` ${k}` : ''}`);
  }
  return out;
}

/** Characters not allowed in file names on Windows / macOS / Dropbox, and control characters. */
export function safeFileName(s: string): string {
  return (
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .trim() || 'photo'
  );
}

const ext = (p: Pick<Photo, 'mimeType'>) =>
  p.mimeType === 'image/png' ? 'png' : p.mimeType === 'image/webp' ? 'webp' : 'jpg';
const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Zip entry names for every photo of a project:
 *   "RTU-1 - Unit - 01.jpg", "RTU-1 - Tag - 01.jpg", "RTU-1 - OA Damper - 01.jpg", "RTU-1 - Other - 02.jpg",
 *   "Issue N-3 - 1.jpg", "Issue E-1 - 2.jpg", "General - 01.jpg", "Cover.jpg".
 * Names are unique (a clash gets " (2)").
 */
export function zipEntryNames(
  photos: readonly (PhotoMeta & Pick<Photo, 'mimeType'>)[],
  equipment: readonly Pick<Equipment, 'id' | 'designation'>[],
  issues: readonly Pick<Issue, 'id' | 'kind' | 'number'>[],
): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  const put = (id: string, base: string, extension: string) => {
    let name = `${safeFileName(base)}.${extension}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${safeFileName(base)} (${n}).${extension}`;
    used.add(name.toLowerCase());
    out.set(id, name);
  };
  const byGroup = new Map<string, PhotoMeta[]>();
  for (const p of photos) {
    const k = groupKeyOf(p);
    byGroup.set(k, [...(byGroup.get(k) ?? []), p]);
  }
  const eqName = new Map(equipment.map((e) => [e.id, e.designation || 'Unit']));
  const issueById = new Map(issues.map((i) => [i.id, i]));
  const byId = new Map(photos.map((p) => [p.id, p]));
  for (const [key, list] of byGroup) {
    list.sort(comparePhotos);
    if (key === 'cover') {
      list.forEach((p, k) => put(p.id, k ? `Cover - ${pad2(k + 1)}` : 'Cover', ext(byId.get(p.id)!)));
    } else if (key.startsWith('issue:')) {
      const issue = issueById.get(key.slice(6));
      list.forEach((p, k) =>
        put(p.id, issue ? `Issue ${issueLabel(issue)} - ${k + 1}` : `Deficiency - ${k + 1}`, ext(byId.get(p.id)!)),
      );
    } else {
      const owner = key === 'general' ? 'General' : (eqName.get(key.slice(3)) ?? 'Unit');
      const seen = new Map<PhotoCategory, number>();
      for (const p of list) {
        const k = (seen.get(p.category) ?? 0) + 1;
        seen.set(p.category, k);
        const base =
          key === 'general' && p.category === 'other'
            ? `General - ${pad2(k)}`
            : `${owner} - ${CATEGORY_FILE[p.category]} - ${pad2(k)}`;
        put(p.id, base, ext(byId.get(p.id)!));
      }
    }
  }
  return out;
}

/** Photos of a project split into their groups (each sorted): cover, eq:<id>, issue:<id>, general. */
export function groupPhotos<T extends PhotoMeta>(photos: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const p of photos) {
    const k = groupKeyOf(p);
    const list = out.get(k);
    if (list) list.push(p);
    else out.set(k, [p]);
  }
  for (const list of out.values()) list.sort(comparePhotos);
  return out;
}

/** Display label of every photo of a project (deficiency: "Photo N-3.1"; others: "RTU-1 · Unit", "General 2"). */
export function allPhotoLabels(
  photos: readonly PhotoMeta[],
  equipment: readonly Pick<Equipment, 'id' | 'designation'>[],
  issues: readonly Pick<Issue, 'id' | 'kind' | 'number'>[],
): Map<string, string> {
  const out = deficiencyLabels(photos, issues);
  const eqName = new Map(equipment.map((e) => [e.id, e.designation || 'Unit']));
  for (const [key, list] of groupPhotos(photos)) {
    if (key.startsWith('issue:')) {
      for (const p of list) if (!out.has(p.id)) out.set(p.id, 'Deficiency (no issue)');
      continue;
    }
    const owner = key === 'general' ? null : key === 'cover' ? 'Cover' : (eqName.get(key.slice(3)) ?? 'Unit');
    for (const [id, label] of groupPhotoLabels(list, owner)) out.set(id, label);
  }
  return out;
}
