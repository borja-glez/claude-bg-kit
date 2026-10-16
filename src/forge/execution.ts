import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from './ledger.js';
import { UsageError } from './cli/errors.js';
import { pidAlive, sleepSync } from './pid.js';
import { readSwarm, swarmFile } from './swarm.js';
import { fromSwarm, parseExecution, type ExecutionState, type PublicTask } from '../lib/execution-state.js';

export const executionFile = (root: string) => path.join(root, '.forge', 'execution.json');
export const executionTaskFile = (root: string, task: string) => path.join(root, '.forge', 'execution', `${task}.json`);
export const runBranch = (project: string) => `forge/run-${project}`;
export const taskBranch = (task: string) => `task/${task}`;
export const runWorktree = (root: string) => path.join(root, '.claude', 'worktrees', 'run');
export const taskWorktree = (root: string, task: string) => path.join(root, '.claude', 'worktrees', `task-${task}`);

export type { PublicTask } from '../lib/execution-state.js';

function writeAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try { writeFileSync(tmp, text); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
}

export function saveExecution(root: string, e: ExecutionState): void {
  forgeDir(root);
  writeAtomic(executionFile(root), JSON.stringify(e, null, 2) + '\n');
}

export const executionLock = (root: string) => path.join(root, '.forge', 'execution.lock');
/** A lock older than this, or whose pid died, is taken over (I-15). */
export const LOCK_STALE_MS = 30_000;
export const LOCK_RETRY_MS = 50;
export const LOCK_WAIT_MS = 10_000;
/** How updateExecution waits: the CLI passes io.now and io.sleep, so a test never waits for real. */
export interface LockDeps { now?: () => Date; sleep?: (ms: number) => void; alive?: (pid: number) => boolean }
type Holder = { pid: number; at: string };

function lockHolder(file: string): Holder | null {
  try {
    const o = JSON.parse(readFileSync(file, 'utf8')) as { pid?: unknown; at?: unknown };
    return typeof o.pid === 'number' && Number.isInteger(o.pid) && typeof o.at === 'string' ? { pid: o.pid, at: o.at } : null;
  } catch { return null; }
}

/**
 * Takes .forge/execution.lock (created with 'wx', holding this pid and the time) or throws the UsageError
 * `execution.json is locked by <pid>` after LOCK_WAIT_MS. A holder whose pid died or that holds it past
 * LOCK_STALE_MS left it behind: it is taken over, unless the file changed since it was read (another process took
 * it over first). A file not written yet (its writer is between open and write) is waited for, and taken over once
 * its mtime is that old.
 */
function acquireLock(root: string, d: Required<LockDeps>): Holder {
  forgeDir(root);
  const file = executionLock(root);
  const attempts = Math.ceil(LOCK_WAIT_MS / LOCK_RETRY_MS);
  let holder: number | null = null;
  for (let i = 0; ; i++) {
    const mine = { pid: process.pid, at: d.now().toISOString() };
    try {
      const fd = openSync(file, 'wx');
      try { writeSync(fd, JSON.stringify(mine)); } finally { closeSync(fd); }
      return mine;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const h = lockHolder(file);
    if (h) holder = h.pid;
    let stale = false;
    if (h) stale = !d.alive(h.pid) || !(d.now().getTime() - Date.parse(h.at) < LOCK_STALE_MS);
    else { try { stale = d.now().getTime() - statSync(file).mtimeMs >= LOCK_STALE_MS; } catch { stale = false; } }
    if (stale && JSON.stringify(lockHolder(file)) === JSON.stringify(h)) {
      rmSync(file, { force: true });
      if (i < attempts) continue;
    }
    if (i >= attempts) break;
    d.sleep(LOCK_RETRY_MS);
  }
  throw new UsageError(`execution.json is locked by ${holder ?? 'another process'}`);
}

/** Removes the lock only while it is still the one this call took (a takeover after LOCK_STALE_MS is someone else's). */
function releaseLock(root: string, mine: Holder): void {
  const h = lockHolder(executionLock(root));
  if (h && h.pid === mine.pid && h.at === mine.at) rmSync(executionLock(root), { force: true });
}

/**
 * I-15: every write of execution.json that depends on what it holds goes through here. Under .forge/execution.lock it
 * reads the execution as it is now, applies `fn` and writes what `fn` returns (null: nothing) atomically; the lock is
 * released in a finally. A lock a live process holds for less than LOCK_STALE_MS is waited for, every LOCK_RETRY_MS
 * for LOCK_WAIT_MS; then it throws the UsageError `execution.json is locked by <pid>` (exit 2). A read alone never
 * takes it: the atomic write already gives a whole file.
 */
export function updateExecution(root: string, fn: (cur: ExecutionState | null) => ExecutionState | null, deps: LockDeps = {}): ExecutionState | null {
  const d: Required<LockDeps> = { now: deps.now ?? (() => new Date()), sleep: deps.sleep ?? sleepSync, alive: deps.alive ?? pidAlive };
  const mine = acquireLock(root, d);
  try {
    const next = fn(readExecution(root));
    if (next) saveExecution(root, next);
    return next;
  } finally { releaseLock(root, mine); }
}

/** The execution, migrating an older swarm.json once (as a stopped execution; its file is kept as swarm.json.migrated). */
export function readExecution(root: string): ExecutionState | null {
  const file = executionFile(root);
  if (existsSync(file)) {
    try { return parseExecution(readFileSync(file, 'utf8')); } catch { return null; }
  }
  const old = readSwarm(root);
  if (!old) return null;
  const migrated = fromSwarm(old);
  saveExecution(root, migrated);
  renameSync(swarmFile(root), `${swarmFile(root)}.migrated`);
  return migrated;
}

export function writePublicTask(root: string, p: PublicTask): void {
  writeAtomic(executionTaskFile(root, p.task), JSON.stringify(p, null, 2) + '\n');
}
