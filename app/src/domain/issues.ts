/**
 * Issues are deficiencies (they turn their unit red and are listed on the Summary pages) or observations (recorded
 * without flagging the unit; their own numbering, "Obs. N-1"). An issue without a type (every issue before this) is
 * a deficiency.
 */
import type { Equipment, Issue, IssueKind } from '../data/types';
import type { Completion } from './completion';

export type IssueType = 'deficiency' | 'observation';

export const isObservation = (i: Pick<Issue, 'issueType'>): boolean => i.issueType === 'observation';
export const isDeficiency = (i: Pick<Issue, 'issueType'>): boolean => !isObservation(i);

/** Open deficiencies (what turns a unit red and counts as an open issue). */
export const openDeficiencies = <T extends Pick<Issue, 'status' | 'issueType'>>(issues: readonly T[]): T[] =>
  issues.filter((i) => i.status === 'Open' && isDeficiency(i));

/** A unit with readings outside tolerance that no issue covers yet: offered as a deficiency, pre-filled. */
export interface SuggestedDeficiency {
  equipmentId: string;
  designation: string;
  kind: IssueKind;
  /** The issue's remark (the export puts "EF-12: " in front). */
  remark: string;
  /** The line, when the suggestion is about one line. */
  airflowRowId: string | null;
  /** The unit's remarks say something already (they may explain it). */
  hasRemark: boolean;
}

const pct = (r: number) => `${Math.round(r * 100)} %`;

/**
 * Units whose readings are out of tolerance with no issue linked to the unit (or, for an issue on a line, to every
 * flagged line), skipping the units dismissed for this project (`dismissed`: unit ids). Sorted by designation.
 */
export function suggestedDeficiencies(
  equipment: readonly Pick<Equipment, 'id' | 'designation' | 'isExisting' | 'data'>[],
  completions: ReadonlyMap<string, Pick<Completion, 'outOfTolerance'>> | undefined,
  issues: readonly Pick<Issue, 'equipmentId' | 'airflowRowId'>[],
  tolerance: number,
  dismissed: ReadonlySet<string> = new Set(),
): SuggestedDeficiency[] {
  const out: SuggestedDeficiency[] = [];
  for (const e of equipment) {
    if (dismissed.has(e.id)) continue;
    const flags = completions?.get(e.id)?.outOfTolerance ?? [];
    if (!flags.length) continue;
    const mine = issues.filter((i) => i.equipmentId === e.id);
    if (mine.some((i) => !i.airflowRowId)) continue; // an issue on the unit covers its lines
    const open = flags.filter((f) => !mine.some((i) => i.airflowRowId === f.rowId));
    if (!open.length) continue;
    const lines = open.map((f) => `${f.label} at ${pct(f.ratio)}`);
    const list = lines.length > 1 ? `${lines.slice(0, -1).join(', ')} and ${lines[lines.length - 1]}` : lines[0];
    out.push({
      equipmentId: e.id,
      designation: e.designation,
      kind: e.isExisting ? 'existing' : 'new',
      remark: `${list} of design, outside the ±${Math.round(tolerance * 100)} % tolerance.`,
      airflowRowId: open.length === 1 ? open[0].rowId : null,
      hasRemark: typeof e.data.remarks === 'string' && e.data.remarks.trim() !== '',
    });
  }
  return out.sort((a, b) => a.designation.localeCompare(b.designation, undefined, { numeric: true }));
}

/** The units dismissed from the suggestions (info.issueSuggestDismissed, one id per line). */
export function dismissedSuggestions(info: Readonly<Record<string, unknown>>): Set<string> {
  const v = info.issueSuggestDismissed;
  return new Set(typeof v === 'string' ? v.split('\n').filter(Boolean) : []);
}
