/** The small "Conflict" flag (unit cards, field labels) and which fields of the open record have one. */
import { createContext, useContext } from 'react';
import type { SyncConflict } from '../../data/types';
import { IconConflict } from './Icons';

/** Field keys (as SpecField knows them) with an open conflict on the record being edited. */
export const ConflictKeysContext = createContext<ReadonlySet<string>>(new Set());
export const useConflictKey = (key: string) => useContext(ConflictKeysContext).has(key);

/** `data.serial` / `info.architect` / `designation` -> the form's field key. */
export function conflictKeys(conflicts: readonly SyncConflict[] | undefined, recordId: string): Set<string> {
  const out = new Set<string>();
  for (const c of conflicts ?? []) {
    if (c.kind !== 'field' || c.recordId !== recordId) continue;
    const [head, ...rest] = c.field.split('.');
    out.add(head === 'data' || head === 'info' ? rest.join('.') : c.field);
  }
  return out;
}

/** Small "Conflict" flag next to a field label or on a unit card. */
export function ConflictFlag({ title = 'Sync conflict: see the Attention tab' }: { title?: string }) {
  return (
    <span className="conflict-flag" title={title} data-testid="conflict-flag">
      <IconConflict size={12} />
      Conflict
    </span>
  );
}
