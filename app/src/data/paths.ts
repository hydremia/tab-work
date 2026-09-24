/** Dotted-path helpers for field-level edits ("data.serial", "blueprints.2.sheet", "naState.fields.fla"). */

const FORBIDDEN = new Set(['id', 'projectId', 'createdAt', 'updatedAt', '__proto__', 'constructor', 'prototype']);

export function assertEditablePath(path: string): string[] {
  const segs = path.split('.');
  if (!path || segs.some((s) => s === '')) throw new Error(`invalid field path "${path}"`);
  if (FORBIDDEN.has(segs[0]) || segs.some((s) => s === '__proto__' || s === 'constructor' || s === 'prototype')) {
    throw new Error(`field "${path}" cannot be edited`);
  }
  return segs;
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * Returns a copy of `obj` with `path` set to `value` (undefined deletes the key). Only the objects along the
 * path are copied, so large leaves such as photo Blobs are shared, not cloned.
 */
export function setPath<T extends object>(obj: T, path: string, value: unknown): T {
  const segs = assertEditablePath(path);
  const copy = (x: unknown, nextSeg: string): Record<string, unknown> | unknown[] => {
    if (Array.isArray(x)) return [...x];
    if (x && typeof x === 'object') return { ...(x as Record<string, unknown>) };
    return /^\d+$/.test(nextSeg) ? [] : {};
  };
  const root = copy(obj, segs[0]) as Record<string, unknown>;
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const next = copy(cur[segs[i]], segs[i + 1]) as Record<string, unknown>;
    cur[segs[i]] = next;
    cur = next;
  }
  const last = segs[segs.length - 1];
  if (value === undefined) {
    if (Array.isArray(cur)) cur[Number(last)] = undefined;
    else delete cur[last];
  } else cur[last] = value;
  return root as T;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
