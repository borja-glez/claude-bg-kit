// Which Claude Code session belongs to an autonomous run, which roots it may write in and which branches it must not move.
// The guard rules of an autonomous run apply only to the sessions this module names; an attended session gets null.
// Only files are read here (run.json and, when it has an autonomous block, the execution and its members): never git.
// Each read that fails says in a comment which way it errs (M17): roots toward fewer, ids and dirs toward more sessions under the rules.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseRun, runFile, type RunState } from './run.js';
import { executionFile, runWorktree } from './execution.js';
import { listMembers } from './members.js';
import { readResources, runTmp, type Resource } from './resources.js';
import { isInside } from './guard.js';
import { parseExecution, type ExecutionState } from '../lib/execution-state.js';

export interface AutonomousCtx {
  runId: string; main: string; worktree: string; roots: string[]; tmp: string;
  branch: string; protectedBranches: string[]; branches: string[]; resources: Resource[];
}

/** The runId of a context that fails closed: whatever has a destination is denied. */
export const INVALID_RUN = 'invalid';

interface SessionInput { session_id?: unknown; cwd?: unknown; scratchpad_dir?: unknown }

const closedCtx = (main: string): AutonomousCtx =>
  ({ runId: INVALID_RUN, main, worktree: '', roots: [], tmp: '', branch: '', protectedBranches: ['main'], branches: [], resources: [] });

const str = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);
const worktreesDir = (main: string): string => path.join(main, '.claude', 'worktrees');

type Loaded =
  | { kind: 'none' }
  // Does not read: `ids` are the session ids that may be the run's (the raw sessionId, the execution's, the members').
  | { kind: 'invalid'; ids: string[] }
  | { kind: 'ok'; run: RunState & { autonomous: NonNullable<RunState['autonomous']> }; exec: ExecutionState | null; execUnreadable: boolean; ids: string[] };

/** run.json as text: null when missing; `unread` when it exists and cannot be read even twice (the rename of saveRun on Windows). */
function readRun(main: string): string | null | 'unread' {
  const file = runFile(main);
  if (!existsSync(file)) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    // The second read waits first, so it can outlast the Windows rename window it exists for.
    if (attempt > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    try { return readFileSync(file, 'utf8'); } catch { /* try once more */ }
  }
  return 'unread';
}

/** execution.json as the file says, without ever writing (readExecution migrates a legacy swarm.json): a missing file is no execution; one that does not read or parse is `unreadable`. */
function readExec(main: string): { exec: ExecutionState | null; unreadable: boolean } {
  const file = executionFile(main);
  if (!existsSync(file)) return { exec: null, unreadable: false };
  try {
    const exec = parseExecution(readFileSync(file, 'utf8'));
    return { exec, unreadable: exec === null };
  } catch { return { exec: null, unreadable: true }; }
}

/** The run.json text said to hold an autonomous key: its parsed form when JSON, else the raw text (a key written with an escape still parses). */
function mentionsAutonomous(text: string): boolean {
  try {
    const o: unknown = JSON.parse(text);
    return !!o && typeof o === 'object' && (o as { autonomous?: unknown }).autonomous !== undefined;
  } catch { return text.includes('"autonomous"'); }
}

/** The execution of forge when the autonomous run started it (its hookSession is the run's sessionId) and it is not closed. */
const ownedBy = (exec: ExecutionState | null, sessionId: string | null): ExecutionState | null =>
  exec && sessionId !== null && exec.hookSession === sessionId && !exec.closedAt ? exec : null;

function membersOf(main: string, runId: string): string[] {
  try { return listMembers(main, runId).map(m => m.hookSession).filter((s): s is string => !!s); } catch { return []; } // errs toward fewer ids: members unknown
}

function load(main: string): Loaded {
  const text = readRun(main);
  if (text === null) return { kind: 'none' };
  if (text === 'unread') return { kind: 'invalid', ids: [] };
  const run = parseRun(text);
  // The text was read and holds no autonomous key (parsed, or as text when it is no JSON): it cannot be an autonomous run.
  if (!run && !mentionsAutonomous(text)) return { kind: 'none' };
  if (run) {
    if (!run.autonomous) return { kind: 'none' };
    const a = run.autonomous;
    const { exec, unreadable: execUnreadable } = readExec(main);
    const own = ownedBy(exec, run.sessionId);
    const ids = [run.sessionId, own?.hookSession ?? null, ...(own ? membersOf(main, own.runId) : [])]
      .filter((s, i, all): s is string => !!s && all.indexOf(s) === i);
    return { kind: 'ok', run: { ...run, autonomous: a }, exec: own, execUnreadable, ids };
  }
  // A block parseRun refuses: the raw sessionId, the execution's hookSession (when it is that session's) and its members fail closed.
  let raw: string | null = null;
  try { raw = str((JSON.parse(text) as { sessionId?: unknown }).sessionId); } catch { /* not JSON: only the cwd rule applies */ }
  // An execution that does not read errs toward fewer ids: it is unknown.
  const own = ownedBy(readExec(main).exec, raw);
  const ids = [raw, own?.hookSession ?? null, ...(own ? membersOf(main, own.runId) : [])]
    .filter((s, i, all): s is string => !!s && all.indexOf(s) === i);
  return { kind: 'invalid', ids };
}

/** A task folder by its name; without case on Windows, as isInside folds it there. */
const isTaskName = (name: string): boolean => (process.platform === 'win32' ? name.toLowerCase() : name).startsWith('task-');

const taskDirs =(exec: ExecutionState | null): { dirs: string[]; branches: string[] } => {
  const tasks = exec ? Object.values(exec.tasks) : [];
  return { dirs: tasks.map(t => t.worktree).filter(d => d !== ''), branches: tasks.map(t => t.branch) };
};
const unique = <T>(xs: T[]): T[] => xs.filter((x, i) => xs.indexOf(x) === i);

/** The directories whose sessions belong while the run is active: its worktree and those of its execution. */
function dirsOf(main: string, l: Extract<Loaded, { kind: 'ok' }>): string[] {
  if (l.exec) return unique([l.run.autonomous.worktree, runWorktree(main), ...taskDirs(l.exec).dirs]);
  return [l.run.autonomous.worktree];
}

function ctxOf(main: string, l: Extract<Loaded, { kind: 'ok' }>, scratchpad: string | null): AutonomousCtx {
  const a = l.run.autonomous;
  const tasks = taskDirs(l.exec);
  let resources: Resource[] = [];
  try { resources = readResources(main, a.runId); } catch { resources = []; } // errs toward fewer roots: the register is unknown
  return {
    runId: a.runId, main, worktree: a.worktree, tmp: runTmp(a.runId), branch: a.branch, protectedBranches: a.protectedBranches, resources,
    roots: unique([a.worktree, runTmp(a.runId), ...(scratchpad ? [scratchpad] : []), ...(l.exec ? [runWorktree(main), ...tasks.dirs] : [])]),
    branches: unique([a.branch, ...(l.exec ? [l.exec.branch, ...tasks.branches] : [])]),
  };
}

/** The active autonomous run of the checkout, with no session in mind: its context (no scratchpad), its ids and its dirs. */
export function autonomousRun(main: string): { ctx: AutonomousCtx; ids: string[]; dirs: string[] } | null {
  const l = load(main);
  if (l.kind !== 'ok' || !l.run.active) return null;
  const dirs = dirsOf(main, l);
  if (l.execUnreadable) {
    dirs.push(runWorktree(main));
    // errs toward more dirs: every task-… folder there is counts, by its fixed name
    try {
      for (const e of readdirSync(worktreesDir(main), { withFileTypes: true })) if (e.isDirectory() && isTaskName(e.name)) dirs.push(path.join(worktreesDir(main), e.name));
    } catch { /* no folder: no dirs to add */ }
  }
  return { ctx: ctxOf(main, l, null), ids: l.ids, dirs: unique(dirs) };
}

/** Whether cwd is one of the task-… folders of .claude/worktrees, by name (the paths of a run's tasks are fixed). */
function inTaskFolder(main: string, cwd: string): boolean {
  const base = worktreesDir(main);
  for (let q = cwd; ; q = path.dirname(q)) {
    const parent = path.dirname(q);
    if (isInside(parent, base) && isInside(base, parent) && isTaskName(path.basename(q))) return true;
    if (parent === q) return false;
  }
}

/** The autonomous run of run.json (active or not) when the session belongs to it, with its scratchpad; null for an attended session. */
export function autonomousFor(main: string, input: SessionInput): AutonomousCtx | null {
  const l = load(main);
  if (l.kind === 'none') return null;
  const id = str(input.session_id);
  const cwd = str(input.cwd);
  const underWorktrees = cwd !== null && isInside(cwd, worktreesDir(main));
  if (l.kind === 'invalid') return (id !== null && l.ids.includes(id)) || underWorktrees ? closedCtx(main) : null;
  if (id !== null && l.ids.includes(id)) return ctxOf(main, l, scratchpadOf(input));
  if (!l.run.active || cwd === null) return null;
  const inDirs = dirsOf(main, l).some(d => isInside(cwd, d));
  // errs toward more sessions: with the execution unread, its run worktree and every task-… folder count
  const inUnread = l.execUnreadable && (isInside(cwd, runWorktree(main)) || inTaskFolder(main, cwd));
  return inDirs || inUnread ? ctxOf(main, l, scratchpadOf(input)) : null;
}

const scratchpadOf = (input: SessionInput): string | null => {
  const s = str(input.scratchpad_dir);
  return s !== null && path.isAbsolute(s) ? s : null;
};
