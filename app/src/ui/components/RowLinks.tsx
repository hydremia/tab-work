/**
 * Issues and photos of one airflow line (0011): the chips on a row ("⚑ N-4", "📷 2") and the row-menu actions that
 * add an issue for the line (then open it on the Issues tab) or a photo of it (camera / file picker).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import { db } from '../../data/db';
import { addIssue } from '../../data/repo';
import type { AirflowRow, Equipment, Issue } from '../../data/types';
import { rowNames, type RowName } from '../../domain/rowLabels';
import { issueLabel } from '../../photos/labels';
import { SaverStatus, usePhotoSaver } from './PhotoPicker';

export interface LineLinks {
  issues: Issue[];
  photos: number;
}

/** The unit's issues and (non-deficiency) photos by airflow line. */
export function useRowLinks(equipmentId: string): Map<string, LineLinks> | undefined {
  return useLiveQuery(async () => {
    const out = new Map<string, LineLinks>();
    const at = (id: string) => out.get(id) ?? (out.set(id, { issues: [], photos: 0 }).get(id) as LineLinks);
    for (const i of await db.issues.where('equipmentId').equals(equipmentId).toArray())
      if (i.airflowRowId) at(i.airflowRowId).issues.push(i);
    for (const p of await db.photos.where('equipmentId').equals(equipmentId).toArray())
      if (p.airflowRowId) at(p.airflowRowId).photos++;
    for (const l of out.values()) l.issues.sort((a, b) => a.kind.localeCompare(b.kind) || a.number - b.number);
    return out;
  }, [equipmentId]);
}

export function RowLinkChips({ links, projectId }: { links: LineLinks | undefined; projectId: string }) {
  if (!links || (!links.issues.length && !links.photos)) return null;
  return (
    <span className="row-links" data-testid="row-links">
      {links.issues.map((i) => (
        <Link
          key={i.id}
          className="chip"
          data-status={i.status}
          to={`/p/${projectId}/issues#issue-${i.id}`}
          title={i.remark || `Issue ${issueLabel(i)}`}
        >
          ⚑ {issueLabel(i)}
        </Link>
      ))}
      {links.photos > 0 && (
        <Link className="chip" to={`/p/${projectId}/photos`} title="Photos of this line">
          📷 {links.photos}
        </Link>
      )}
    </span>
  );
}

/** Row-menu options (values 'line-issue' / 'line-photo'). */
export const LINE_OPTIONS = (
  <>
    <option value="line-issue">Add issue for this line</option>
    <option value="line-photo">Add photo of this line…</option>
  </>
);

/** The actions behind LINE_OPTIONS, with the hidden photo input they need (render `input` once per table). */
export function useLineActions(equipment: Equipment) {
  const nav = useNavigate();
  const saver = usePhotoSaver(equipment.projectId);
  const fileRef = useRef<HTMLInputElement>(null);
  const forRow = useRef<string | null>(null);
  const run = async (action: string, row: AirflowRow): Promise<boolean> => {
    if (action === 'line-issue') {
      const issue = await addIssue(equipment.projectId, {
        kind: equipment.isExisting ? 'existing' : 'new',
        equipmentId: equipment.id,
        airflowRowId: row.id,
      });
      void nav(`/p/${equipment.projectId}/issues#issue-${issue.id}`);
      return true;
    }
    if (action === 'line-photo') {
      forRow.current = row.id;
      fileRef.current?.click();
      return true;
    }
    return false;
  };
  const input = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label={`${equipment.designation} line photo`}
        data-testid="line-photo-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (forRow.current)
            void saver.save(files, { category: 'other', equipmentId: equipment.id, airflowRowId: forRow.current });
        }}
      />
      <SaverStatus busy={saver.busy} error={saver.error} onDismiss={saver.clearError} />
    </>
  );
  return { run, input };
}

/** Names of every airflow line of a project's units (for photo / issue labels). */
export function useLineNames(
  projectId: string | undefined,
  equipment: readonly Pick<Equipment, 'id' | 'type'>[] | undefined,
): Map<string, RowName> | undefined {
  const rows = useLiveQuery(
    async () => (projectId ? db.airflowRows.where('projectId').equals(projectId).toArray() : []),
    [projectId],
  );
  return rows && equipment ? rowNames(equipment, rows) : undefined;
}
