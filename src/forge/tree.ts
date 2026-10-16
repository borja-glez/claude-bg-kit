import path from 'node:path';
import { workDir } from './task-ref.js';

// What a task found in the work tree when it started, and what changed since that it did not do: the session asks the
// person before it touches a file the task did not create (a config they wrote by hand mid-task, for one).

/** `root`: the work tree's resolved top level, so a check in another tree never compares against it. */
export interface TreeSnapshot { task: string; root: string; at: string; head: string | null; untracked: string[]; modified: string[] }
export interface TreeCheck {
  snapshot: { at: string; head: string | null } | null;
  task: string[]; appeared: string[]; changed: string[];
  more?: Partial<Record<'task' | 'appeared' | 'changed', number>>;
  warning?: string;
}

export const TREE_CAP = 200;
/** D-08: the snapshot lives in the task's work folder (.forge/work/<project>/<T> for a plan task). */
export const treeStartFile = (root: string, task: string, project: string | null = null) => path.join(workDir(root, { project, task }), 'tree-start.json');

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
    // A rename or a copy, in the index or in the work tree, is followed by its source path.
    if ('RC'.includes(xy[0]) || 'RC'.includes(xy[1])) i++;
  }
  return { untracked, modified };
}

/** A snapshot read back; null when it is not one. */
export function parseSnapshot(text: string | null): TreeSnapshot | null {
  if (text === null) return null;
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const strs = (x: unknown) => Array.isArray(x) && x.every(s => typeof s === 'string');
    if (!o || typeof o !== 'object' || typeof o.task !== 'string' || typeof o.root !== 'string' || typeof o.at !== 'string') return null;
    if ((o.head !== null && typeof o.head !== 'string') || !strs(o.untracked) || !strs(o.modified)) return null;
    return o as unknown as TreeSnapshot;
  } catch { return null; }
}

/**
 * The task's files (added or changed by its commits since the base), the untracked files that appeared since the
 * snapshot and the tracked files with uncommitted changes made since it: those are never the commits' work, even on a
 * file the task committed (a hand edit hidden behind a task file would be lost on a cleanup). Without a snapshot every
 * untracked and changed path is listed (fail safe: the session asks). Each list is capped, `more` counts the rest.
 */
export function treeCheck(snapshot: TreeSnapshot | null, now: { untracked: string[]; modified: string[] }, taskFiles: string[], cap = TREE_CAP): TreeCheck {
  const task = [...new Set(taskFiles)].sort();
  const before = { untracked: new Set(snapshot?.untracked ?? []), modified: new Set(snapshot?.modified ?? []) };
  const appeared = snapshot ? now.untracked.filter(f => !before.untracked.has(f)) : now.untracked;
  const changed = snapshot ? now.modified.filter(f => !before.modified.has(f)) : now.modified;
  const lists = { task, appeared: [...new Set(appeared)].sort(), changed: [...new Set(changed)].sort() };
  const more: TreeCheck['more'] = {};
  for (const k of ['task', 'appeared', 'changed'] as const) {
    if (lists[k].length > cap) { more[k] = lists[k].length - cap; lists[k] = lists[k].slice(0, cap); }
  }
  return { snapshot: snapshot ? { at: snapshot.at, head: snapshot.head } : null, ...lists, ...(Object.keys(more).length ? { more } : {}) };
}
