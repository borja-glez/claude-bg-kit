// Which Claude Code session belongs to an autonomous run, which roots it may write in and which branches it must not move.
// The guard rules of an autonomous run apply only to the sessions this module names; an attended session gets null.
// Only files are read here (run.json and, when it has an autonomous block, the execution and its members): never git.
// Each read that fails says in a comment which way it errs (M17): roots toward fewer, ids and dirs toward more sessions under the rules.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseRun, runFile, type RunState } from './run.js';
import { executionFile, runWorktree } from './execution.js';
import { listMembers } from './members.js';
import { autonomousDir, readResources, runTmp, type Resource } from './resources.js';
import { isInside, evaluateGuard, TRUST_RULES, type GuardCtx, type GuardInput, type GuardRule, type GuardVerdict } from './guard.js';
import { AUTONOMY_RULES } from './autonomy-rules.js';
import { parseExecution, type ExecutionState } from '../lib/execution-state.js';
import { samePath } from '../lib/worktree.js';

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

/**
 * The checkouts whose .forge/run.json may hold an autonomous run, found without git (H1, CARRY-5): from each start point,
 * every folder up to the root that has one, the nearest first, each once. Only existsSync: a worktree of a run lives in
 * <main>/.claude/worktrees/<p>-<n>, so the walk reaches <main>/.forge/run.json, and an old run.json in a worktree hides
 * nothing, since the folders above it are listed too.
 */
export function runMainsOf(starts: readonly string[]): string[] {
  const found: string[] = [];
  for (const start of starts) {
    for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
      if (existsSync(runFile(dir)) && !found.some(f => samePath(f, dir))) found.push(dir);
      if (path.dirname(dir) === dir) break;
    }
  }
  return found;
}

export const GUARD_ERROR = 'guard-error';

/** The denial of a call the guard could not judge in an autonomous run: nothing was done, and the model is told what to try. */
export function guardError(message: string): GuardVerdict {
  return {
    decision: 'deny', rule: GUARD_ERROR,
    reason: `forge autonomy · ${GUARD_ERROR}: the guard could not judge this call (${message}); nothing was done. Instead: try a simpler form, or record it as not done`,
  };
}

/** evaluateGuard; a rule that throws denies in an autonomous run (fail closed) and throws otherwise. Reads only ctx.autonomous. */
export function judgeGuard(input: GuardInput, ctx: GuardCtx, rules: readonly GuardRule[]): GuardVerdict {
  try {
    return evaluateGuard(input, ctx, rules);
  } catch (e) {
    if (ctx.autonomous === null) throw e;
    return guardError(e instanceof Error ? e.message : String(e));
  }
}

/** The rules for a context: the trust rules of 6a, and the autonomy rules only for an autonomous run. Reads only ctx.autonomous. */
export function guardRulesFor(ctx: GuardCtx): readonly GuardRule[] {
  return ctx.autonomous ? [...TRUST_RULES, ...AUTONOMY_RULES] : TRUST_RULES;
}

const VALUE = String.raw`(?:"[^"\n]*"|'[^'\n]*'|[^\s;|&"']+)`;
const SECRETS: readonly [RegExp, string][] = [
  [/\b(Authorization|Cookie)(\s*:\s*)[^"'\n]*/gi, '$1$2***'],
  [new RegExp(String.raw`(--password(?:=|\s+))${VALUE}`, 'gi'), '$1***'],
  [/(^|\s)-p(?=[^\s;|&"'])[^\s;|&"']+/g, '$1-p***'],
  [new RegExp(String.raw`\b(PGPASSWORD|MYSQL_PWD|[A-Za-z0-9_]*_(?:TOKEN|KEY|SECRET))(=)${VALUE}`, 'g'), '$1$2***'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, '$1***@'],
  [/\b(?:sk-|ghp_|github_pat_|xox[a-zA-Z]-|AKIA)[A-Za-z0-9_-]*/g, '***'],
];

/** M7: what a record of a denial must not keep: header values, passwords, secret assignments, URL credentials and well-known token shapes. */
export function redactSecrets(s: string): string {
  return SECRETS.reduce((text, [re, to]) => text.replace(re, to), s);
}

export interface BlockedRecord { ts: string; rule: string; tool: string; target: string; reason: string; session: string | null }

export const blockedFile = (main: string, runId: string): string => path.join(autonomousDir(main, runId), 'blocked.jsonl');

/** Appends a denial, without its secrets, to blocked.jsonl. Null, or the error's message when it could not (M17); never throws. */
export function appendBlocked(main: string, runId: string, r: BlockedRecord): string | null {
  try {
    mkdirSync(autonomousDir(main, runId), { recursive: true });
    appendFileSync(blockedFile(main, runId), JSON.stringify({ ...r, target: redactSecrets(r.target), reason: redactSecrets(r.reason) }) + '\n');
    return null;
  } catch (e) { return e instanceof Error ? e.message : String(e); }
}

/** The last `limit` records that read, in order (Infinity: all); lines that do not parse are skipped. */
export function readBlocked(main: string, runId: string, limit = 1000): BlockedRecord[] {
  let text: string;
  try { text = readFileSync(blockedFile(main, runId), 'utf8'); } catch { return []; }
  const records: BlockedRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r: unknown = JSON.parse(line);
      if (r && typeof r === 'object' && typeof (r as BlockedRecord).rule === 'string') records.push(r as BlockedRecord);
    } catch { /* a torn line: skipped */ }
  }
  return Number.isFinite(limit) ? records.slice(Math.max(0, records.length - limit)) : records;
}
