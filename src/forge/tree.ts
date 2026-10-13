import path from 'node:path';

// What a task found in the work tree when it started, and what changed since that it did not do: the session asks the
// person before it touches a file the task did not create (a config they wrote by hand mid-task, for one).

export interface TreeSnapshot { task: string; at: string; head: string | null; untracked: string[]; modified: string[] }
export interface TreeCheck {
  snapshot: { at: string; head: string | null } | null;
  task: string[]; appeared: string[]; changed: string[];
  more?: Partial<Record<'task' | 'appeared' | 'changed', number>>;
}

export const TREE_CAP = 200;
export const treeStartFile = (root: string, task: string) => path.join(root, '.forge', 'work', task, 'tree-start.json');

/** `git status --porcelain -z -uall` split into untracked paths and tracked ones changed (staged or not); ignored never appear. */
export function parseStatus(z: string): { untracked: string[]; modified: string[] } {
  const untracked: string[] = [];
  const modified: string[] = [];
  const parts = z.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const file = entry.slice(3);
    if (xy === '??') untracked.push(file);
    else if (xy !== '!!') modified.push(file);
    // A rename or a copy is followed by its source path.
    if (xy[0] === 'R' || xy[0] === 'C') i++;
  }
  return { untracked, modified };
}

/** A snapshot read back; null when it is not one. */
export function parseSnapshot(text: string | null): TreeSnapshot | null {
  if (text === null) return null;
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const strs = (x: unknown) => Array.isArray(x) && x.every(s => typeof s === 'string');
    if (!o || typeof o !== 'object' || typeof o.task !== 'string' || typeof o.at !== 'string') return null;
    if ((o.head !== null && typeof o.head !== 'string') || !strs(o.untracked) || !strs(o.modified)) return null;
    return o as unknown as TreeSnapshot;
  } catch { return null; }
}

/**
 * The task's files (its commits since the base), the untracked files that appeared since the snapshot and the tracked
 * files changed since it that the task's commits do not account for. Without a snapshot every untracked and changed
 * path is listed (fail safe: the session asks). Each list is capped, `more` counts the rest.
 */
export function treeCheck(snapshot: TreeSnapshot | null, now: { untracked: string[]; modified: string[] }, taskFiles: string[], cap = TREE_CAP): TreeCheck {
  const task = [...new Set(taskFiles)].sort();
  const inTask = new Set(task);
  const before = { untracked: new Set(snapshot?.untracked ?? []), modified: new Set(snapshot?.modified ?? []) };
  const appeared = snapshot ? now.untracked.filter(f => !before.untracked.has(f)) : now.untracked;
  const changed = snapshot ? now.modified.filter(f => !inTask.has(f) && !before.modified.has(f)) : now.modified;
  const lists = { task, appeared: [...new Set(appeared)].sort(), changed: [...new Set(changed)].sort() };
  const more: TreeCheck['more'] = {};
  for (const k of ['task', 'appeared', 'changed'] as const) {
    if (lists[k].length > cap) { more[k] = lists[k].length - cap; lists[k] = lists[k].slice(0, cap); }
  }
  return { snapshot: snapshot ? { at: snapshot.at, head: snapshot.head } : null, ...lists, ...(Object.keys(more).length ? { more } : {}) };
}
