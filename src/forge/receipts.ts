import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Git } from './validate-cache.js';
import { eventsOf } from './task-ref.js';
import type { LedgerEvent } from './ledger.js';
import type { ExecutionState } from '../lib/execution-state.js';
import { OBJECT_ID } from './local.js';

/** Forge's learned notes, the one change a receipt allows. */
export const NOTES_PATH = /^\.forge\/verify\/[^/]+\.md$/;
export const TASK_TREE_CHANGED = 'tree changed since its review';
export const TASK_NO_RECEIPT = 'no review receipt';
export const FINAL_TREE_CHANGED = 'tree changed since the final review';
export const FINAL_NO_RECEIPT = 'no receipt from the final review: its run worktree had uncommitted changes';

function objectOf(git: Git, rev: string, type: 'tree' | 'commit'): string | null {
  const out = git(['rev-parse', '--verify', '-q', `${rev}^{${type}}`])?.trim();
  return out && OBJECT_ID.test(out) ? out : null;
}

/** `git rev-parse --verify -q <rev>^{tree}`: an object id, or null. */
export function treeOf(git: Git, rev: string): string | null {
  return objectOf(git, rev, 'tree');
}

/** The same with `^{commit}`. */
export function commitOf(git: Git, rev: string): string | null {
  return objectOf(git, rev, 'commit');
}

export type TreeMatch = { ok: true } | { ok: false; changed: string[] };

/** Whether tree `now` is the reviewed tree, a change only in .forge/verify/*.md aside (and in the exact paths of `extraPassive`); `changed`: the other paths.
 * Both must be object ids, else no match: git diff would read a `-s` as an option, print nothing and say no change. */
export function sameReviewedTree(git: Git, reviewed: string, now: string, extraPassive: readonly string[] = []): TreeMatch {
  if (!OBJECT_ID.test(reviewed) || !OBJECT_ID.test(now)) return { ok: false, changed: [] };
  if (reviewed === now) return { ok: true };
  const out = git(['diff', '--name-only', '-z', '--no-renames', reviewed, now]);
  if (out === null) return { ok: false, changed: [] };
  const changed = out.split('\0').filter(p => p !== '' && !NOTES_PATH.test(p) && !extraPassive.includes(p));
  return changed.length === 0 ? { ok: true } : { ok: false, changed };
}

/** At most CHANGED_MAX paths go into an output, with `changedTotal` when there are more (a receipt far from the tip). */
export const CHANGED_MAX = 20;
export function changedOut(changed: readonly string[]): { changed: string[]; changedTotal?: number } {
  return { changed: changed.slice(0, CHANGED_MAX), ...(changed.length > CHANGED_MAX ? { changedTotal: changed.length } : {}) };
}

export type TaskReceipt = { tree: string } | 'none' | 'unknown';

/** The tree the last accept of `task` in run `e` reviewed (Precisiones: its `tree`, else its round's head.txt under one of `roots`). */
export function taskReceipt(events: readonly LedgerEvent[], e: ExecutionState, task: string, roots: readonly string[], git: Git): TaskReceipt {
  const started = Date.parse(e.startedAt);
  const accepts = eventsOf(events, { project: e.kind === 'plan' ? e.project : null, task })
    .filter(v => v.kind === 'verdict' && v.action === 'accept' && Date.parse(v.ts) >= started);
  const accept = accepts[accepts.length - 1];
  if (!accept) return 'none';
  if (typeof accept.tree === 'string' && OBJECT_ID.test(accept.tree)) return { tree: accept.tree };
  if (typeof accept.dir === 'string') {
    for (const root of roots) {
      if (!root) continue;
      let head: string;
      try { head = readFileSync(path.join(path.resolve(root, accept.dir), 'head.txt'), 'utf8').trim(); } catch { continue; }
      if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)) continue;
      const tree = treeOf(git, head);
      if (tree !== null) return { tree };
    }
  }
  return 'unknown';
}
