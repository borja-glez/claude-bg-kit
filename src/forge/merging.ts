// D-07: .forge/execution/merging.json, the merge `swarm integrate` (or `swarm merge`) has in flight. It is written right
// before `git merge --no-ff --no-commit` and removed after the commit or the rollback. A process that dies in between
// leaves it with MERGE_HEAD: the next attempt in that same worktree aborts that merge, and only that one.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pidAlive } from './pid.js';

export interface MergingDoc {
  task: string | null; pre: string; ref: string; pid: number; startedAt: string;
  /** When it stops counting as alive whatever its pid says: validatorTimeoutSec × validators + 10 min after it started. */
  staleAt: string;
  /** The worktree it merges in, as git gives it (`rev-parse --show-toplevel` and its prefix). */
  dir: string;
}
export const mergingFile = (main: string) => path.join(main, '.forge', 'execution', 'merging.json');

/** The marker, or null when there is none or it cannot be trusted (then a MERGE_HEAD is someone else's). */
export function readMerging(main: string): MergingDoc | null {
  try {
    const o = JSON.parse(readFileSync(mergingFile(main), 'utf8')) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    if (typeof o.pre !== 'string' || !/^[0-9a-f]{7,64}$/.test(o.pre) || typeof o.ref !== 'string' || typeof o.dir !== 'string' || !o.dir) return null;
    if (typeof o.pid !== 'number' || !Number.isInteger(o.pid) || o.pid <= 0) return null;
    if (typeof o.startedAt !== 'string' || typeof o.staleAt !== 'string' || !Number.isFinite(Date.parse(o.staleAt))) return null;
    return { task: typeof o.task === 'string' ? o.task : null, pre: o.pre, ref: o.ref, pid: o.pid, startedAt: o.startedAt, staleAt: o.staleAt, dir: o.dir };
  } catch { return null; }
}

export function writeMerging(main: string, m: MergingDoc): void {
  const file = mergingFile(main);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(m) + '\n'); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
}

/** Removes the marker when this process wrote it. */
export function clearMerging(main: string): void {
  const m = readMerging(main);
  if (m && m.pid === process.pid) rmSync(mergingFile(main), { force: true });
}

/** A merge in flight: the marker of another process that lives, before its staleAt. */
export function mergingLive(m: MergingDoc | null, now: number, alive: (pid: number) => boolean = pidAlive): boolean {
  return !!m && m.pid !== process.pid && alive(m.pid) && Date.parse(m.staleAt) > now;
}
