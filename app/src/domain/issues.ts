/**
 * Issues are deficiencies (they turn their unit red and are listed on the Summary pages) or observations (recorded
 * without flagging the unit; their own numbering, "Obs. N-1"). An issue without a type (every issue before this) is
 * a deficiency.
 */
import type { Issue } from '../data/types';

export type IssueType = 'deficiency' | 'observation';

export const isObservation = (i: Pick<Issue, 'issueType'>): boolean => i.issueType === 'observation';
export const isDeficiency = (i: Pick<Issue, 'issueType'>): boolean => !isObservation(i);

/** Open deficiencies (what turns a unit red and counts as an open issue). */
export const openDeficiencies = <T extends Pick<Issue, 'status' | 'issueType'>>(issues: readonly T[]): T[] =>
  issues.filter((i) => i.status === 'Open' && isDeficiency(i));
