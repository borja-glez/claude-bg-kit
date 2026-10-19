import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './errors.js';
import type { Io } from './run.js';
import { checkPlanProject, commitInfo, integratedPublish } from './swarm.js';
import { pendingVerify } from './shared.js';
import { readExecution, executionTaskFile, runWorktree, taskBase, writePublicTask } from '../execution.js';
import { phaseToVerify } from '../flow.js';
import { takeStepLock } from '../jobs.js';
import { appendEvent, readEvents, withEventContext, type LedgerEvent } from '../ledger.js';
import { eventsOf, isTask, readWorkDir, taskLine, workRel } from '../task-ref.js';
import { publishFor, startedEvent } from '../roadmap-sources.js';
import { runDocOf } from '../run-doc.js';
import { LEASE_MINUTES } from '../../lib/coordination.js';
import { normalizePublicTask, type ExecTask, type ExecutionState, type PublicTask } from '../../lib/execution-state.js';
import { isPlanId, parsePlan } from '../../lib/plan.js';

// D-12: `FORGE swarm step`, one step of a plan execution in one process. It calls the CLI itself (deps.cli) for each
// command, so every one of them behaves as when the skill runs it alone (its --cwd, its events, the lock).

type Result = { code: number; stdout: string; stderr: string };
type Json = Record<string, unknown>;
/** `alive`: whether a pid lives, for step.lock (I4); pidAlive by default. */
export interface StepDeps { cli: (argv: string[]) => Result; gitAt: (dir: string) => (args: string[]) => string | null; alive?: (pid: number) => boolean }
export type StepAction = { type: string; task?: string; [k: string]: unknown };
type Versions = { state: Record<string, number>; sessions: Record<string, number> };
/** I1, M8: the person's answer for a task, given to a step with `--ruling <T>:<answer>`. */
type Ruling = { kind: 'fix' | 'out-of-model' | 'review' } | { kind: 'defer'; ids: string[] };
/** `after`: writes the step makes only as its last act, once every command ran (see reviewersBack). `iso` and
 *  `agentLease` are read from io.now() when they are used (M7): a step can wait for a slot and validate for minutes. */
interface Ctx {
  io: Io; deps: StepDeps; planArg: string; db: string; runBranch: string; locale: 'es' | 'en'; iso: () => string; agentLease: () => string;
  rulings: Map<string, Ruling>; actions: StepAction[]; after: (() => void)[];
  /** D-08: the project of the plan execution. */
  project: string;
  /** Carry 3: the execution's id, recorded in validators-head-<n>.json so another run's is never read as its own. */
  runId: string;
}
/** respawned.json of a review round: each reviewer respawned once, when, and the mtime of the file it was respawned on. */
type Respawned = Record<string, { at: string; mtimeMs: number }>;
/**
 * asked.json of a review round (I1): review-close put a question to the person (`ask`). It keeps what following «fix»
 * needs (`next`, `implementer`, `findingsFile`, `handover`, `revert`; `close` is that whole output), the ids asked
 * (`findings`, for «out-of-model»), and the person's `ruling` once a step was given it.
 */
interface Asked { at: string; findings: string[]; next: unknown; implementer: unknown; findingsFile: unknown; handover: unknown; revert: unknown; close: Json; reemitted?: boolean; ruling?: Ruling }
/** A review round as the step reads it: where it is, the entries it waits for and the reviewers it respawned. */
interface Round { work: string; abs: string; roundDir: string; plan: Json | null; entries: Json[]; respawnedFile: string; respawned: Respawned }

/** An agent the step hands out holds the task's lease this long (task-steps: at most 90 minutes). */
const AGENT_LEASE_MINUTES = 90;
/** A question nobody answered is put to the person once more this long after it was asked (a compaction may lose it). */
const ASK_AGAIN_MS = 24 * 3600_000;

const slash = (p: string) => p.split(path.sep).join('/');
const readText = (f: string): string | null => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const readJson = (f: string): unknown => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f: string, v: unknown) => writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
const mtimeOf = (f: string): number | null => { try { return statSync(f).mtimeMs; } catch { return null; } };
const asList = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
const keyOf = (s: Json) => String(s.role ?? '').replace(/^review-/, '');
const isObject = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x);
const stepError = (task: string, stderr: string): StepAction => ({ type: 'error', task, command: 'swarm step', code: 2, stderr });

/** --ruling <T>:<answer>, repeated or comma-separated: fix, out-of-model, defer:F3[+F5] or review. */
function readRulings(rest: string[]): Map<string, Ruling> {
  const out = new Map<string, Ruling>();
  rest.forEach((arg, i) => {
    if (arg !== '--ruling') return;
    const v = rest[i + 1];
    if (v === undefined || v.startsWith('--')) throw new UsageError('swarm step: --ruling needs <T>:fix|out-of-model|defer:F3[+F5]|review');
    for (const one of v.split(',').map(s => s.trim()).filter(Boolean)) {
      const m = /^([^:]+):(?:(fix|out-of-model|review)|defer:([Ff]\d+(?:\+[Ff]\d+)*))$/.exec(one);
      if (!m || !isPlanId(m[1])) throw new UsageError(`swarm step: --ruling ${one.slice(0, 80)} is not <T>:fix|out-of-model|defer:F3[+F5]|review`);
      out.set(m[1], m[3] ? { kind: 'defer', ids: m[3].toUpperCase().split('+') } : { kind: m[2] as 'fix' | 'out-of-model' | 'review' });
    }
  });
  return out;
}

function readAsked(file: string): Asked | null {
  const raw = readJson(file);
  if (!isObject(raw) || typeof raw.at !== 'string' || !isObject(raw.close)) return null;
  const r = raw.ruling;
  const ruling: Ruling | undefined = isObject(r) && r.kind === 'defer' && asList(r.ids).length ? { kind: 'defer', ids: asList(r.ids) }
    : isObject(r) && (r.kind === 'fix' || r.kind === 'out-of-model' || r.kind === 'review') ? { kind: r.kind } : undefined;
  return { ...(raw as unknown as Asked), findings: asList(raw.findings), ruling };
}

function readRespawned(file: string): Respawned {
  const raw = readJson(file);
  const out: Respawned = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Json)) {
    const x = v as Json | null;
    if (x && typeof x === 'object' && typeof x.at === 'string' && typeof x.mtimeMs === 'number') out[k] = { at: x.at, mtimeMs: x.mtimeMs };
  }
  return out;
}

/** --versions: the roadmap versions the skill read with `list` (`{state: {T: n}, sessions: {SID: n}}`). */
function readVersions(cwd: string, file: string | undefined): Versions {
  const out: Versions = { state: {}, sessions: {} };
  if (!file) return out;
  const raw = readJson(path.resolve(cwd, file));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError(`swarm step: cannot read --versions ${file}`);
  for (const k of ['state', 'sessions'] as const) {
    const m = (raw as Json)[k];
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    for (const [id, v] of Object.entries(m as Json)) if (typeof v === 'number' && Number.isInteger(v) && v >= 0) out[k][id] = v;
  }
  return out;
}

/** Runs one FORGE command; its JSON, or null after recording an `error` action (for `task`) when it failed. `stderr`
 *  gets what a command that succeeded said on its stderr (the tick's warnings); else that is dropped. */
function call(c: Ctx, task: string | null, argv: string[], stderr?: (text: string) => void): Json | null {
  const r = c.deps.cli(argv);
  if (r.code === 0) {
    try {
      const v = JSON.parse(r.stdout) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) { stderr?.(r.stderr); return v as Json; }
    } catch { /* not JSON: an error below */ }
  }
  c.actions.push({ type: 'error', ...(task ? { task } : {}), command: argv.slice(0, argv[0] === 'swarm' ? 2 : 1).join(' '), code: r.code, stderr: (r.stderr || r.stdout).trim().slice(0, 500) });
  return null;
}

/** D-08: the ledger events of `task` (itself and its briefs) of the execution's project: ids repeat between plans. */
const ledgerOf = (c: Ctx, task: string): LedgerEvent[] => eventsOf(readEvents(c.io.cwd), { project: c.project, task });

/** The brief a task is on and its BASE: its last phase `implement` with a base (prep logs it); brief 1 without one. `head`:
 *  the commit the brief's work started on, which prep logs only when BASE is below it (D-02: a task resumed on its branch). */
function briefOf(events: LedgerEvent[], task: string): { n: number; base: string | null; head: string | null } {
  const e = events.filter(x => x.kind === 'phase' && isTask(x, task) && x.phase === 'implement' && typeof x.base === 'string' && x.base).at(-1);
  return { n: typeof e?.brief === 'number' && e.brief >= 1 ? e.brief : 1, base: e ? String(e.base) : null, head: typeof e?.head === 'string' && e.head ? e.head : null };
}

/** D-08: a task's work folder, relative to the main checkout: the project's, or the older .forge/work/<T> of a task the
 *  execution started before this version, whichever holds its brief (readWorkDir). Every file the step reads or writes
 *  for the task goes there, and so does the --dir of each command it runs for it. */
const workOf = (c: Ctx, task: string, events: readonly LedgerEvent[]): string =>
  path.relative(c.io.cwd, readWorkDir(c.io.cwd, { project: c.project, task }, events));

/** The last review round review-prep prepared for brief `n` in the work dir; 0 when none. */
function latestRound(work: string, n: number): number {
  let round = 0;
  let names: string[] = [];
  try { names = readdirSync(work); } catch { return 0; }
  for (const d of names) {
    const m = new RegExp(`^reviews-${n}-(\\d+)$`).exec(d);
    if (m && existsSync(path.join(work, d, 'review-plan.json'))) round = Math.max(round, Number(m[1]));
  }
  return round;
}

/**
 * The commit the implementer of brief `n` was last handed back on, so one back without a new commit only has its report:
 * the HEAD the step recorded in validators-head-<n>.json for round k (its last validators round, since review-prep keeps
 * no plan of that round; or the commit of a verification's learned notes after review k-1, closeVerify) when k comes
 * after the last review round prepared, else the HEAD that review saw, else `start`, the commit the brief's work started
 * on (BASE, or the HEAD above it of a task resumed on its branch). Whatever the step records for round k always precedes
 * the review of round k, so only a later round number makes it the newer one. Carry 3: only this execution's (`runId`):
 * a new execution of the same plan task starts brief n again, and prep sets an earlier run's rounds aside.
 */
function seenOf(work: string, n: number, round: number, start: string | null, runId: string): string | null {
  const v = readJson(path.join(work, `validators-head-${n}.json`)) as Json | null;
  if (v && typeof v === 'object' && typeof v.head === 'string' && v.head && typeof v.round === 'number' && v.round > round
    && (v.runId === undefined || v.runId === runId)) return v.head;
  return (round ? readText(path.join(work, `reviews-${n}-${round}`, 'head.txt'))?.trim() : null) || start;
}

/** The implementer last logged for `<T>-<n>`; null when none was. */
function lastAgent(c: Ctx, taskN: string): string | null {
  const e = ledgerOf(c, taskN).filter(x => x.kind === 'agent' && isTask(x, taskN) && typeof x.agent === 'string' && x.agent).at(-1);
  return e ? String(e.agent) : null;
}

/** Logs the implementer handed out for `<T>-<n>` (review-close reads its rung), once: a hand-out a later step retries,
 *  with the same agent and role as the last one logged for that brief, adds nothing. */
function logAgent(c: Ctx, taskN: string, agent: string, role: string): void {
  const last = ledgerOf(c, taskN).filter(e => e.kind === 'agent' && isTask(e, taskN)).at(-1);
  if (last?.agent === agent && last.role === role) return;
  appendEvent(c.io.cwd, { ts: c.iso(), kind: 'agent', task: taskN, agent, role });
}

/** A reviewer's file that is there and is not a draft (`"complete": false`); one that is not JSON is review-close's to judge. */
function finished(file: string): boolean {
  const text = readText(file);
  if (text === null) return false;
  try {
    const o = JSON.parse(text) as Json;
    return !(o && typeof o === 'object' && (o.complete === false || o.complete === 'false'));
  } catch { return true; }
}

/** The local lease of a subagents task the coordinator drives: renewed to NOW + LEASE_MINUTES, never shortened. */
function renewLease(io: Io, e: ExecutionState, task: string, t: ExecTask, now: Date): void {
  let prev: PublicTask | null = null;
  try { prev = normalizePublicTask(JSON.parse(readFileSync(executionTaskFile(io.cwd, task), 'utf8'))); } catch { prev = null; }
  const mine = prev && prev.runId === e.runId ? prev : null;
  const want = now.getTime() + LEASE_MINUTES * 60000;
  const leaseUntil = mine && Date.parse(mine.leaseUntil) > want ? mine.leaseUntil : new Date(want).toISOString();
  const base: PublicTask = mine ?? {
    task, runId: e.runId, stage: t.stage, status: t.status, agent: t.agent, round: t.round, since: t.stageSince, updatedAt: now.toISOString(),
    leaseUntil, by: e.coordinator, mode: 'subagents',
  };
  writePublicTask(io.cwd, { ...base, leaseUntil, updatedAt: now.toISOString() });
}

/** prep's output for brief 1 that a resumed start can use again: the one the step kept (prep-1.json) when the ledger's
 *  last phase implement with a base is brief 1 on that same BASE (the worktree's HEAD, or `resumedBase` below it for a
 *  task resumed on its branch, D-02), it started on the worktree's HEAD as it is now, and its baseline is there (a resumed
 *  task has none until its first review: reviewBase takes it). `work`: the task's work folder, absolute. */
function keptPrep(c: Ctx, task: string, work: string, worktree: string, resumedBase: string | null): Json | null {
  const kept = readJson(path.join(work, 'prep-1.json')) as Json | null;
  const head = c.deps.gitAt(worktree)(['rev-parse', 'HEAD'])?.trim();
  const { n, base } = briefOf(ledgerOf(c, task), task);
  const want = resumedBase ?? head;
  const ok = !!kept && typeof kept === 'object' && typeof kept.validate === 'string' && !!head && kept.base === want && (kept.head ?? kept.base) === head
    && base === want && n === 1 && (resumedBase !== null || existsSync(path.join(work, 'baseline-1.json')));
  return ok ? kept : null;
}

/**
 * A start in mode subagents: worktree, brief, triage --plan and prep (from the tree cache when it can), then the
 * implementer, handed out only once its stage is recorded. A start a previous step left half done (`resume`: the task
 * is still at stage brief, a command failed or the step died) runs again from what it lacks: swarm worktree returns
 * the worktree already there, the brief and the triage are cheap and run again (the triage names the implementer), and
 * prep is skipped when it already recorded this BASE (keptPrep). Every failure is an error action again. A task resumed
 * on its branch (D-02: swarm worktree printed `resumed`, its BASE below the commits of an earlier attempt) is briefed with
 * those commits (prior.json), and prep records that BASE, the one the review diffs from, with no baseline on the
 * worktree's tree: its first review takes it where BASE is (reviewBase).
 */
function startTask(c: Ctx, task: string, resume: boolean): boolean {
  const w = call(c, task, ['swarm', 'worktree', task]);
  if (!w || typeof w.worktree !== 'string') return false;
  const worktree = w.worktree;
  const resumedBase = w.resumed === true && typeof w.base === 'string' && w.base ? w.base : null;
  // D-08: a task that starts always uses its project's folder; from then on workOf finds it there.
  const work = workRel({ project: c.project, task });
  mkdirSync(path.join(c.io.cwd, work), { recursive: true });
  // D-02: a task resumed on its branch is briefed with its earlier attempt's commits, which are reviewed with it.
  const prior = Array.isArray(w.prior) && w.prior.length ? path.join(work, 'prior.json') : null;
  if (prior) writeFileSync(path.join(c.io.cwd, prior), JSON.stringify(w.prior, null, 2) + '\n');
  // An attempt longer than the list says how many commits it has (carry 3).
  const total = prior && typeof w.priorTotal === 'number' ? ['--prior-total', String(w.priorTotal)] : [];
  const b = c.deps.cli(['brief', '--plan', c.planArg, '--task', task, ...(prior ? ['--prior-file', slash(prior), ...total] : [])]);
  if (b.code !== 0) { c.actions.push({ type: 'error', task, command: 'brief', code: b.code, stderr: b.stderr.trim().slice(0, 500) }); return false; }
  const brief = path.join(work, 'brief-1.md');
  mkdirSync(path.join(c.io.cwd, work), { recursive: true });
  writeFileSync(path.join(c.io.cwd, brief), `${b.stdout.trimEnd()}\n\nWorktree: ${slash(worktree)} (work only inside this directory).\n`);
  const tri = call(c, task, ['triage', '--plan', c.planArg, '--task', task, '--cwd', worktree, '--locale', c.locale]);
  if (!tri) return false;
  const kept = resume ? keptPrep(c, task, path.join(c.io.cwd, work), worktree, resumedBase) : null;
  const pr = kept ?? call(c, task, ['prep', '--task', `${task}-1`, '--path', 'large', '--dir', work, '--cwd', worktree, ...(resumedBase ? ['--base', resumedBase, '--no-baseline'] : [])]);
  if (!pr) return false;
  if (!kept) writeFileSync(path.join(c.io.cwd, work, 'prep-1.json'), JSON.stringify(pr, null, 2) + '\n');
  const impl = (tri.implementer && typeof tri.implementer === 'object' ? tri.implementer : {}) as Json;
  const agent = typeof impl.agent === 'string' ? impl.agent : 'forge-impl';
  // The skill spawns it from this action: the step logs it, as task-steps step 2 says (review-close reads the rung).
  logAgent(c, `${task}-1`, agent, typeof impl.role === 'string' ? impl.role : 'impl');
  if (!call(c, task, ['swarm', 'task', task, '--stage', 'implement', '--agent', agent, '--round', '0', '--lease', c.agentLease()])) return false;
  c.actions.push({
    type: 'spawnImplementer', task, agent, taskLine: taskLine(`${task}-1`, c.project), role: impl.role ?? null, brief: slash(brief), report: slash(path.join(work, 'report-1.txt')),
    validate: pr.validate ?? null, worktree, base: pr.base ?? null, ...(w.setup ? { setup: w.setup } : {}), ...(tri.announce ? { announce: tri.announce } : {}),
  });
  return true;
}

/**
 * The BASE a task's review diffs from. A retried task (a conflict sent it back and its implementer merged the run branch
 * into it) forks from the run branch where it merged it: its taskBase, `git merge-base HEAD <run branch>` in its worktree, so the
 * diff holds only its own work, not the tasks integrated meanwhile. When that moved from prep's BASE, the baseline runs
 * again in the run worktree (at that tip, or the closest tree there once another task was integrated since) into
 * baseline-<n>.json, once: base-<n>.json records the BASE it ran on (`from`: the BASE it replaced, null when it is the
 * same). The ledger keeps prep's phase (forge stats counts a brief from its last phase implement). `rebaseline`: the
 * brief has no baseline on its BASE, so it runs there even when BASE did not move: an adopted task (I3: its member
 * prepared it in its own worktree and ledger, so `base` is already that merge-base and there is no baseline here) and a
 * task resumed on its branch (D-02: prep logged its BASE below the commits of the earlier attempt and took none). Null
 * after an error action. `work`: the task's work folder (workOf), absolute.
 */
function reviewBase(c: Ctx, task: string, t: ExecTask, n: number, base: string, rebaseline: boolean, work: string): string | null {
  if (t.attempts < 1 && !rebaseline) return base;
  const moved = taskBase(c.deps.gitAt(t.worktree), c.runBranch);
  if (!moved || (moved === base && !rebaseline)) return base;
  const mark = path.join(work, `base-${n}.json`);
  const kept = readJson(mark) as Json | null;
  if (kept && typeof kept === 'object' && kept.base === moved && existsSync(path.join(work, `baseline-${n}.json`))) return moved;
  const argv = ['validate', '--all', '--path', 'large', '--base-run', '--task', `${task}-${n}`, '--cwd', runWorktree(c.io.cwd)];
  const r = c.deps.cli(argv);
  let results: unknown = null;
  try { results = JSON.parse(r.stdout); } catch { results = null; }
  // A baseline that fails validators exits 1 with its results: that is what it records.
  if ((r.code !== 0 && r.code !== 1) || !Array.isArray(results)) {
    c.actions.push({ type: 'error', task, command: 'validate', code: r.code, stderr: (r.stderr || r.stdout).trim().slice(0, 500) });
    return null;
  }
  // An adopted task (I3) may have no work folder in the main checkout yet.
  mkdirSync(work, { recursive: true });
  writeFileSync(path.join(work, `baseline-${n}.json`), JSON.stringify(results, null, 2) + '\n');
  writeFileSync(mark, JSON.stringify({ base: moved, from: moved === base ? null : base, at: c.iso() }, null, 2) + '\n');
  return moved;
}

/**
 * An implementer that may be back: with a commit newer than the one it was handed back on (seenOf), its review is
 * prepared; without one, its report is handed over. At stage validate it is back with a commit already (a step moved it
 * there for one and could not finish its review): each step goes on from there, told or not. review-prep then prepares
 * the same round again (with no verdict since, it is the same reviews-<n>-<k>, its validators from the tree cache), so
 * the round a step prepared on this HEAD is reused, never added. Reviewers are handed out only once their stage is recorded.
 * The person's answer after its report (--ruling): `review` (M8: the finding was already fixed, or is wrong) prepares the
 * next review on the same HEAD; `defer:F3` («keep the architecture», convergence.md) closes its last round again with
 * those ids and follows that. A task adopted after a conflict (I3) has no phase implement with a base in this ledger
 * (its member prepared it in its own): its BASE is where it forks from the run branch (taskBase), as reviewBase moves it.
 * A task resumed on its branch (D-02) has its BASE below the commits of the earlier attempt: the commit its brief's work
 * started on (briefOf's `head`) is what it was handed, so one back without a commit of its own only has its report.
 */
function implementerBack(c: Ctx, task: string, t: ExecTask, told: boolean): void {
  const events = readEvents(c.io.cwd);
  const brief = briefOf(eventsOf(events, { project: c.project, task }), task);
  const { n } = brief;
  const adopted = !brief.base && t.attempts > 0;
  const base = brief.base ?? (adopted ? taskBase(c.deps.gitAt(t.worktree), c.runBranch) : null);
  const work = workOf(c, task, events);
  const abs = path.join(c.io.cwd, work);
  const report = path.join(work, `report-${n}.txt`);
  const round = latestRound(abs, n);
  const given = c.rulings.get(task);
  if (given?.kind === 'defer' && round) { closeRound(c, task, t, n, round, roundOf(c, task, work, n, round), ['--defer', given.ids.join(',')]); return; }
  if (given && given.kind !== 'review') { c.actions.push(stepError(task, `--ruling ${task}:${given.kind}: no question of ${task} waits for that answer`)); return; }
  const head = c.deps.gitAt(t.worktree)(['rev-parse', 'HEAD'])?.trim() || null;
  if (t.stage !== 'validate' && !given) {
    const seen = seenOf(abs, n, round, brief.head ?? base, c.runId);
    const committed = !!head && !!seen && head !== seen;
    let fresh = false;
    try { fresh = statSync(path.join(c.io.cwd, report)).mtimeMs > Date.parse(t.stageSince); } catch { fresh = false; }
    if (!told && !(fresh && committed)) return;
    if (!committed) { c.actions.push({ type: 'readReport', task, report: slash(report) }); return; }
  }
  if (!base) { c.actions.push(stepError(task, `no phase implement with a base for ${task}: run FORGE prep first`)); return; }
  const loc = ['--locale', c.locale];
  if (!call(c, task, ['swarm', 'task', task, '--stage', 'validate', '--no-agent'])) return;
  const at = reviewBase(c, task, t, n, base, adopted || brief.head !== null, abs);
  if (!at) return;
  const tri = call(c, task, ['triage', '--plan', c.planArg, '--task', task, '--cwd', t.worktree, '--base', at, ...loc]);
  if (!tri) return;
  const rp = call(c, task, ['review-prep', '--task', `${task}-${n}`, '--path', 'large', '--base', at, '--baseline', slash(path.join(work, `baseline-${n}.json`)),
    '--dir', slash(work), '--cwd', t.worktree, ...loc]);
  if (!rp) return;
  const say = typeof rp.say === 'string' ? { say: rp.say } : {};
  const r = typeof rp.round === 'number' ? rp.round : round + 1;
  if (rp.validatorsRound && typeof rp.validatorsRound === 'object') {
    // The commit this validators round sends back (seenOf): back without a newer one, the implementer only has its report.
    if (head) writeFileSync(path.join(abs, `validators-head-${n}.json`), JSON.stringify({ round: r, head, runId: c.runId }) + '\n');
    // M1: taken up at stage validate (recorded with no agent), the implementer is the last one logged for this brief.
    const agent = t.agent ?? lastAgent(c, `${task}-${n}`);
    if (!call(c, task, ['swarm', 'task', task, '--stage', 'implement', ...(agent ? ['--agent', agent] : ['--no-agent']), '--lease', c.agentLease()])) return;
    c.actions.push({ type: 'validatorsRound', task, implementer: agent, findings: (rp.validatorsRound as Json).findings ?? null, ...say });
    return;
  }
  const spawn = Array.isArray(rp.spawn) ? rp.spawn as Json[] : [];
  const first = spawn.find(s => s.twin !== true);
  if (!call(c, task, ['swarm', 'task', task, '--stage', 'review', '--agent', String(first?.agent ?? 'forge-review-correctness'), '--round', String(r), '--lease', c.agentLease()])) return;
  if (rp.express === true) {
    c.actions.push({ type: 'express', task, round: r, validate: (rp.validators as Json | undefined)?.cmd ?? null, spawn, ...say });
    return;
  }
  c.actions.push({ type: 'spawnReviewers', task, round: r, path: tri.path ?? null, base: at, spawn, ...(rp.carried ? { carried: rp.carried } : {}), ...say });
}

/** Round `round` of brief `n` in the task's work folder `work` (workOf, relative to the main checkout). */
function roundOf(c: Ctx, task: string, work: string, n: number, round: number): Round {
  const abs = path.join(c.io.cwd, work);
  const roundDir = path.join(abs, `reviews-${n}-${round}`);
  const plan = readJson(path.join(roundDir, 'review-plan.json'));
  // I2: the verify agent the round waits for while verify-pending.json names a surface nobody skipped (pendingVerify).
  const verify = pendingVerify(roundDir, ledgerOf(c, `${task}-${n}`), `${task}-${n}`) ?? null;
  const entries = [...(isObject(plan) && Array.isArray(plan.spawn) ? plan.spawn as Json[] : []).filter(s => s.twin !== true), ...(verify ? [verify] : [])];
  const respawnedFile = path.join(roundDir, 'respawned.json');
  return { work, abs, roundDir, plan: isObject(plan) ? plan : null, entries, respawnedFile, respawned: readRespawned(respawnedFile) };
}

/**
 * Reviewers that may be back: when every entry that is not a twin (and the verify agent while its marker stands, I2)
 * left a finished file, review-close decides. An invalid or incomplete reviewer is respawned once (respawned.json of the
 * round, with the mtime of the file it was respawned on): it is back only once its file is newer than that one (or with
 * --returned), so the review never closes on the file it was respawned for; once its agent's lease (AGENT_LEASE_MINUTES)
 * has passed since the respawn, its result stands. respawned.json is written as the step's last act (Ctx.after): a step
 * that dies before its end records no respawn whose action nobody saw, and the next step finds the same file and
 * respawns that reviewer again. A round whose close asked the person (asked.json, I1) is closed again only with their answer.
 */
function reviewersBack(c: Ctx, task: string, t: ExecTask, told: boolean): void {
  const events = readEvents(c.io.cwd);
  const { n } = briefOf(eventsOf(events, { project: c.project, task }), task);
  const work = workOf(c, task, events);
  const round = latestRound(path.join(c.io.cwd, work), n);
  if (!round) return;
  const r = roundOf(c, task, work, n, round);
  const asked = readAsked(path.join(r.roundDir, 'asked.json'));
  const given = c.rulings.get(task);
  if (asked) { answer(c, task, t, n, round, r, asked, given); return; }
  if (given) { c.actions.push(stepError(task, `--ruling ${task}:${given.kind}: no question of ${task} waits for an answer`)); return; }
  const pending = r.plan?.validatorsPending === true && !existsSync(path.join(r.abs, `validators-${n}.json`));
  const isBack = (s: Json) => {
    const file = path.join(r.roundDir, `${keyOf(s)}.json`);
    if (!finished(file)) return false;
    const was = r.respawned[keyOf(s)];
    return !was || (mtimeOf(file) ?? 0) > was.mtimeMs || Date.parse(c.iso()) - Date.parse(was.at) > AGENT_LEASE_MINUTES * 60000;
  };
  const back = r.entries.every(isBack) && !pending;
  if (!told && !back) return;
  // --returned forces the close, but review-close knows no verify agent: one that left no file is missing here.
  if (r.entries.some(s => keyOf(s) === 'verify' && !existsSync(path.join(r.roundDir, 'verify.json')))) {
    const missing = r.entries.filter(s => !existsSync(path.join(r.roundDir, `${keyOf(s)}.json`))).map(s => slash(path.join(r.work, `reviews-${n}-${round}`, `${keyOf(s)}.json`)));
    c.actions.push({ type: 'reviewMissing', task, missing });
    return;
  }
  closeRound(c, task, t, n, round, r, []);
}

/**
 * I1: the person's answer to a round's question (asked.json). It is kept there as soon as a step is given it, so a step
 * that could not follow it follows it again. «fix» follows the `next` review-close printed with the question; «out-of-model»
 * and «defer:F3» close the round again with those ids and follow that, as the normal close does. Without an answer
 * nothing is closed and nothing emitted, except the question once more after ASK_AGAIN_MS.
 */
function answer(c: Ctx, task: string, t: ExecTask, n: number, round: number, r: Round, asked: Asked, given: Ruling | undefined): void {
  const file = path.join(r.roundDir, 'asked.json');
  const ruling = given ?? asked.ruling;
  if (!ruling) {
    if (!asked.reemitted && Date.parse(c.iso()) - Date.parse(asked.at) > ASK_AGAIN_MS) {
      c.after.push(() => writeJson(file, { ...asked, reemitted: true }));
      c.actions.push({ type: 'ask', task, close: asked.close });
    }
    return;
  }
  // An answer that does not fit is refused, and never kept.
  if (ruling.kind === 'review') { c.actions.push(stepError(task, `--ruling ${task}:review is for an implementer back without a commit; ${task} waits for an answer to its question`)); return; }
  const ids = ruling.kind === 'defer' ? ruling.ids : ruling.kind === 'out-of-model' ? asked.findings : [];
  if (ruling.kind === 'out-of-model' && !ids.length) { c.actions.push(stepError(task, `the question of ${task} names no finding id: answer with --ruling ${task}:defer:<id> or ${task}:fix`)); return; }
  if (given && JSON.stringify(given) !== JSON.stringify(asked.ruling)) writeJson(file, { ...asked, ruling: given });
  if (ruling.kind === 'fix') { follow(c, task, t, n, round, r, asked.close); return; }
  closeRound(c, task, t, n, round, r, [ruling.kind === 'defer' ? '--defer' : '--out-of-model', ids.join(',')]);
}

/** review-close of a round (with `extra`: the ids of a ruling) and what it decides: a respawn, a question (asked.json) or follow. */
function closeRound(c: Ctx, task: string, t: ExecTask, n: number, round: number, r: Round, extra: string[]): void {
  const res = c.deps.cli(['review-close', '--task', `${task}-${n}`, '--dir', slash(r.work), '--path', 'large', '--cwd', t.worktree, '--locale', c.locale, ...extra]);
  if (res.code === 3) {
    const m = (() => { try { return JSON.parse(res.stdout) as Json; } catch { return {} as Json; } })();
    c.actions.push({ type: 'reviewMissing', task, missing: m.missing ?? [] });
    return;
  }
  let out: Json | null = null;
  try { out = res.code === 0 ? JSON.parse(res.stdout) as Json : null; } catch { out = null; }
  if (!isObject(out)) { c.actions.push({ type: 'error', task, command: 'review-close', code: res.code, stderr: (res.stderr || res.stdout).trim().slice(0, 500) }); return; }
  const again = [...new Set([...asList(out.invalid), ...asList(out.incomplete)])];
  const fresh = again.filter(k => !Object.hasOwn(r.respawned, k));
  if (fresh.length) {
    const next: Respawned = { ...r.respawned };
    for (const k of fresh) next[k] = { at: c.iso(), mtimeMs: mtimeOf(path.join(r.roundDir, `${k}.json`)) ?? 0 };
    c.after.push(() => writeJson(r.respawnedFile, next));
    c.actions.push({ type: 'respawnReviewers', task, reviewers: fresh, spawn: r.entries.filter(s => fresh.includes(keyOf(s))) });
    return;
  }
  if (out.ask) {
    // I1: the person answers it (the skill steps again with --ruling); until then the next steps close nothing here.
    // asked.json is written as the step's last act (Ctx.after): a step that dies before its output leaves none, so the
    // next step closes again and asks again instead of keeping a question nobody saw until the re-ask.
    const asked = isObject(out.ask) && Array.isArray(out.ask.findings) ? out.ask.findings : [];
    const findings = asked.map(f => (typeof f === 'string' ? f : isObject(f) && typeof f.id === 'string' ? f.id : null)).filter((x): x is string => !!x);
    const doc = {
      at: c.iso(), findings, next: out.next ?? null, implementer: out.implementer ?? null, findingsFile: out.findings ?? null,
      handover: out.handover ?? null, revert: out.revert ?? null, close: out,
    };
    c.after.push(() => writeJson(path.join(r.roundDir, 'asked.json'), doc));
    c.actions.push({ type: 'ask', task, close: out });
    return;
  }
  follow(c, task, t, n, round, r, out);
}

/**
 * What review-close decided, followed. Every outcome that moves the task is reported only once its stage is recorded;
 * otherwise the next step closes again. The round's verification is closed first (I2), and its output goes with the
 * action. A question the outcome answered (asked.json) goes once the outcome is recorded.
 */
function follow(c: Ctx, task: string, t: ExecTask, n: number, round: number, r: Round, out: Json): void {
  const verify = closeVerify(c, task, t, n, round, r);
  const v = verify ? { verify } : {};
  const answered = () => rmSync(path.join(r.roundDir, 'asked.json'), { force: true });
  const next = out.next;
  const impl = isObject(out.implementer) ? out.implementer : null;
  if (next === 'done') {
    const deferred = Array.isArray(out.deferred) && out.deferred.length ? path.join(r.work, 'deferred.json') : null;
    if (deferred) writeJson(path.join(c.io.cwd, deferred), out.deferred);
    if (!call(c, task, ['swarm', 'task', task, '--stage', 'verdict', '--status', 'accepted', '--no-agent'])) return;
    answered();
    c.actions.push({ type: 'accepted', task, score: out.score ?? null, deferred: deferred && slash(deferred), ...v });
    return;
  }
  if (next === 'resume' || next === 'fresh-stronger' || next === 'redo') {
    const agent = typeof impl?.agent === 'string' ? impl.agent : null;
    if (agent) logAgent(c, `${task}-${n}`, agent, typeof impl?.role === 'string' ? impl.role : 'impl');
    if (!call(c, task, ['swarm', 'task', task, '--stage', 'implement', ...(agent ? ['--agent', agent] : ['--no-agent']), '--round', String(round + 1), '--lease', c.agentLease()])) return;
    answered();
    c.actions.push({
      type: next === 'resume' ? 'resumeImplementer' : next === 'fresh-stronger' ? 'freshImplementer' : 'redo', task, implementer: impl, findings: out.findings ?? null,
      ...(out.handover ? { handover: out.handover } : {}), ...(next === 'redo' ? { revert: out.revert ?? null } : {}),
      // E-02: a new implementer's prompt starts with its task line, as spawnImplementer's; a resumed one keeps its prompt.
      ...(next !== 'resume' ? { taskLine: taskLine(`${task}-${n}`, c.project) } : {}), ...v,
    });
    return;
  }
  // breaker or stalled: the task blocks with its reasons (task-steps step 5).
  const detail = path.join(r.work, 'blocked.txt');
  writeFileSync(path.join(c.io.cwd, detail), `${String(next)}: ${asList(out.reasons).join('; ')}`.slice(0, 500) + '\n');
  if (!call(c, task, ['swarm', 'task', task, '--status', 'blocked', '--detail-file', slash(detail)])) return;
  answered();
  c.actions.push({ type: 'blocked', task, next: next ?? null, reasons: asList(out.reasons), ...v });
}

/**
 * I2: the verification of a round (verify.json), closed once with verify-close (references/verify.md `## After the
 * verdict`): its learned notes into the task's worktree, the processes its agent left stopped, its result recorded.
 * Its output is kept in verify-close.json, so a step that runs again reads it instead of adding the notes twice. The
 * notes are committed in the worktree with the task's work (the tick of this same step may integrate it), and a fix
 * round is handed back on that commit (validators-head-<n>.json, seenOf). The skill does the rest from the output
 * (proposals, the evidence upload). Null without verify.json, or after an error action when verify-close failed.
 */
function closeVerify(c: Ctx, task: string, t: ExecTask, n: number, round: number, r: Round): Json | null {
  if (!existsSync(path.join(r.roundDir, 'verify.json'))) return null;
  const keptFile = path.join(r.roundDir, 'verify-close.json');
  const kept = readJson(keptFile);
  let out: Json | null = isObject(kept) ? kept : null;
  if (!out) {
    out = call(c, task, ['verify-close', '--task', `${task}-${n}`, '--dir', slash(path.join(r.work, `reviews-${n}-${round}`)), '--evidence', slash(path.join(r.work, 'evidence', `${n}-${round}`)),
      '--db', c.db, '--cwd', t.worktree, '--locale', c.locale]);
    if (!out) return null;
    writeJson(keptFile, out);
  }
  const files = asList(out.commit);
  const git = c.deps.gitAt(t.worktree);
  if (files.length && git(['status', '--porcelain', '--', ...files])?.trim()) {
    // `git add` exits 1 for a tracked file under an ignored directory (as .forge/ may be) while it stages it all the
    // same: only the commit says whether they went in.
    git(['add', '--', ...files]);
    const committed = git(['commit', '-q', '-m', `${task}: learned notes of its verification`, '--', ...files]) !== null;
    const head = committed ? git(['rev-parse', 'HEAD'])?.trim() : null;
    if (head) writeJson(path.join(r.abs, `validators-head-${n}.json`), { round: round + 1, head, runId: c.runId });
    else c.actions.push({ type: 'error', task, command: 'git commit', code: 1, stderr: `could not commit ${files.join(', ')} in ${slash(t.worktree)}: commit them with the task's work` });
  }
  const { result, learned, cleanup, evidence, commit, proposals, defects, say } = out;
  return { result, learned, cleanup, evidence, commit, proposals, defects, say };
}

/** With verify.flow phase, an integration that finished the last task of its phase carries `flow: {phase}` (K2-13). */
const flowOf = (c: Ctx, task: string): { flow?: { phase: string } } => {
  const phase = phaseToVerify(c.io.cwd, c.planArg, c.db, task);
  return phase ? { flow: { phase } } : {};
};

/** The integrate the tick emitted (one at most; none while a merge is in flight): its result is the action's type. */
function integrateTask(c: Ctx, task: string): void {
  // `swarm integrate` prints the phase it finished (`flow`) itself, from the plan and the roadmap it is given.
  const r = call(c, task, ['swarm', 'integrate', task, '--plan', c.planArg, '--db', c.db, '--locale', c.locale]);
  if (!r) return;
  const { result, ...rest } = r;
  c.actions.push({ ...rest, type: String(result), task });
}

/**
 * M2: a task the execution has integrated while its roadmap state (DB/state/<T>.json, as the skill listed it) is not
 * `done`: the step that integrated it may have died before its output, or the `done` batch failed. Its `integrated`
 * action comes again with the commit of the run branch's merge of task/<T> (the merge whose second parent is its tip,
 * else the one titled `forge: integrate <T>`). A state the list did not bring says nothing: no action.
 */
function integratedAgain(c: Ctx, task: string, t: ExecTask): void {
  const state = readJson(path.resolve(c.io.cwd, c.db, 'state', `${task}.json`));
  if (!isObject(state) || state.status === 'done') return;
  const git = c.deps.gitAt(c.io.cwd);
  const tip = git(['rev-parse', '--verify', '-q', `refs/heads/${t.branch}^{commit}`])?.trim() || null;
  const merges = (git(['log', '--merges', '--format=%H %P', c.runBranch]) ?? '').split('\n').map(l => l.trim().split(' ')).filter(p => p.length >= 3);
  // By its exact subject: a grep for «forge: integrate T1» would also find T10's.
  const titled = () => (git(['log', '--merges', '--format=%H%x09%s', c.runBranch]) ?? '').split('\n')
    .map(l => l.trim().split('\t')).find(([, subject]) => subject === `forge: integrate ${task}`)?.[0];
  const sha = (tip ? merges.find(p => p.slice(2).includes(tip))?.[0] : undefined) ?? titled();
  if (!sha) return;
  // The same publish and metrics as the integrate that was lost (I3): the skill never composes the done state itself.
  const commit = commitInfo(git, sha);
  c.actions.push({ type: 'integrated', task, sha, commit, again: true, ...integratedPublish(c.io, c.project, task, t, commit, t.finishedAt ?? c.iso()), ...flowOf(c, task) });
}

/**
 * J-15: the roadmap batch of this step, built by the CLI: for each task the coordinator drives, the state/T write of
 * roadmap-doc (with the claim of a task the tick just started, and its started event); the coordinator's lease; meta/run.
 * `read` is the one read of the ledger every task's write shares (a seam: tests count it).
 */
export function publishOf(io: Io, e: ExecutionState, started: Set<string>, versions: Versions, now: Date, read: (root: string) => LedgerEvent[] = readEvents): Json {
  const iso = now.toISOString();
  const own = new Date(now.getTime() + LEASE_MINUTES * 60000).toISOString();
  const lease = (task: string) => {
    try {
      const p = normalizePublicTask(JSON.parse(readFileSync(executionTaskFile(io.cwd, task), 'utf8')));
      if (p && p.runId === e.runId) return p.leaseUntil;
    } catch { /* none yet */ }
    return own;
  };
  // One read of the ledger for every task of the step.
  const docIo = { ...io, events: read(io.cwd) };
  const mine = Object.entries(e.tasks).filter(([, t]) => t.executor === 'subagents' && (t.status === 'running' || t.status === 'accepted')).map(([task]) => task);
  const tasks = mine.map(task => {
    const claim = started.has(task);
    const pub = publishFor(docIo, task, { project: e.project, ...(claim ? { extra: { status: 'in_progress', owner: e.coordinator, claimedAt: iso, startedAt: iso } } : {}) });
    return {
      task, version: versions.state[task] ?? null, ...(claim ? { claim: true } : {}),
      write: pub.publish, ...(pub.publishError ? { publishError: pub.publishError } : {}),
      ...(claim ? { event: startedEvent(e.coordinator, task, now, io.rand) } : {}),
    };
  });
  // The coordinator's own lease is never shorter than one it set for an agent that is still running.
  const leaseUntil = mine.map(lease).reduce((max, l) => (l > max ? l : max), own);
  return { tasks, session: { version: versions.sessions[e.coordinator] ?? null, leaseUntil }, metaRun: runDocOf(io.cwd, e) };
}

const SAY: Record<string, [string, string]> = {
  spawnImplementer: ['{t} empieza con {x}', '{t} starts with {x}'],
  spawnReviewers: ['{t} a revisión', '{t} to review'],
  express: ['{t} a revisión exprés', '{t} to an express review'],
  validatorsRound: ['{t} vuelve a su implementador (validadores en rojo)', '{t} back to its implementer (red validators)'],
  readReport: ['{t}: el implementador volvió sin commit', '{t}: the implementer came back without a commit'],
  reviewMissing: ['{t}: falta el fichero de un revisor', '{t}: a reviewer left no file'],
  respawnReviewers: ['{t}: se relanza un revisor', '{t}: a reviewer runs again'],
  accepted: ['{t} aceptada', '{t} accepted'],
  resumeImplementer: ['{t} a una ronda de arreglo', '{t} to a fix round'],
  freshImplementer: ['{t} a una ronda de arreglo con otro implementador', '{t} to a fix round with a new implementer'],
  redo: ['{t} se rehace', '{t} is redone'],
  ask: ['{t}: hay una pregunta para ti', '{t}: a question for you'],
  blocked: ['{t} bloqueada', '{t} blocked'],
  integrated: ['{t} integrada', '{t} integrated'],
  conflict: ['{t} en conflicto', '{t} in conflict'],
  'run-dirty': ['{t} espera: el worktree de la ejecución no está listo para integrar', '{t} waits: the run worktree is not ready to integrate'],
  'run-deps': ['{t} espera: las dependencias del worktree de la ejecución no se instalaron', '{t} waits: the run worktree dependencies did not install'],
  error: ['{t}: falló {x}', '{t}: {x} failed'],
  // What the tick emits and the step passes through.
  start: ['{t} arranca en su sesión', '{t} starts in its session'],
  relaunch: ['{t}: se relanza su sesión', '{t}: its session is relaunched'],
  nudge: ['{t}: se avisa a su sesión, parada', '{t}: its idle session is nudged'],
  block: ['{t} bloqueada: {x}', '{t} blocked: {x}'],
  finish: ['la ejecución terminó', 'the execution finished'],
  stalled: ['la ejecución se detuvo: {x}', 'the execution stalled: {x}'],
};

/** One line for the person: what this step did, task by task, or that it waits. */
export function stepSay(actions: StepAction[], wait: number | null, locale: 'es' | 'en'): string {
  const i = locale === 'es' ? 0 : 1;
  const parts = actions.flatMap(a => {
    const s = SAY[a.type];
    if (!s) return [];
    const x = a.type === 'spawnImplementer' ? a.agent : a.type === 'error' ? a.command : a.type === 'block' || a.type === 'stalled' ? a.reason : '';
    return [s[i].replace('{t}', String(a.task ?? 'swarm step')).replace('{x}', String(x ?? ''))];
  });
  const head = locale === 'es' ? 'Paso' : 'Step';
  if (parts.length) return `${head}: ${parts.join('; ')}.`;
  return locale === 'es' ? `${head}: nada nuevo${wait ? `; espero ${wait} s` : ''}.` : `${head}: nothing new${wait ? `; waiting ${wait} s` : ''}.`;
}

/**
 * `FORGE swarm step --plan <plan> --db <DB> [--agents <f>] [--returned T1,T2] [--ruling T1:fix] [--versions <f>] [--locale es|en]`:
 * renews the local leases of the coordinator's subagents tasks; closes what came back (`--returned`, or found by its
 * files: an implementer's report newer than its stage and a new commit, every reviewer's finished file and the verify
 * agent's) and takes up what a previous step left half done (a start at stage brief, a review not prepared at stage
 * validate); follows the person's answers (`--ruling <T>:fix|out-of-model|defer:F3[+F5]|review`); ticks (a start in
 * mode subagents gets its worktree, brief, triage and prep; at most one integrate; the rest passes through); and
 * prints `{actions, publish, running, parallel, wait, say}`. A command that fails for one task is an `error` action of
 * that task, again at each step while it fails, and the others go on. Plan executions only. One step at a time (I4):
 * while another live step holds .forge/jobs/step.lock it prints `{busy: {pid, startedAt}}` and runs nothing.
 */
export function swarmStep(rest: string[], io: Io, deps: StepDeps): Result {
  const flag = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    const v = i >= 0 ? rest[i + 1] : undefined;
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  const planArg = flag('plan'), db = flag('db');
  if (!planArg || !db) throw new UsageError('swarm step: --plan and --db are required');
  const loc = flag('locale');
  if (rest.includes('--locale') && loc !== 'es' && loc !== 'en') throw new UsageError('swarm step: --locale must be es or en');
  const returned = new Set((flag('returned') ?? '').split(',').map(s => s.trim()).filter(Boolean));
  for (const task of returned) if (!isPlanId(task)) throw new UsageError(`swarm step: --returned ${task.slice(0, 80)} is not a task id`);
  const rulings = readRulings(rest);
  const versions = readVersions(io.cwd, flag('versions'));
  const e0 = readExecution(io.cwd);
  if (!e0) throw new UsageError('swarm step: no execution (forge swarm start)');
  if (!e0.active) throw new UsageError('swarm step: the execution is not active');
  if (e0.kind !== 'plan') throw new UsageError('swarm step: an ephemeral run steps with the single commands (references/ephemeral.md)');
  // D-08: the plan must be of the run's project, or its tasks' events would be another project's: refused before anything
  // runs. A plan that cannot be read is the tick's to report, as before.
  let planProject: string | null = null;
  try { planProject = parsePlan(readFileSync(path.resolve(io.cwd, planArg), 'utf8')).project; } catch { planProject = null; }
  if (planProject !== null) checkPlanProject('step', planArg, planProject, e0.project);
  const locale: 'es' | 'en' = loc === 'es' || loc === 'en' ? loc : (e0.locale ?? '').toLowerCase().split(/[-_]/)[0] === 'es' ? 'es' : 'en';
  const now = io.now();
  const lock = takeStepLock(io.cwd, now, deps.alive);
  if ('busy' in lock) return { code: 0, stdout: JSON.stringify({ busy: lock.busy }, null, 2) + '\n', stderr: '' };
  try {
    const c: Ctx = {
      io, deps, planArg, db, runBranch: e0.branch, project: e0.project, runId: e0.runId, locale, rulings, actions: [], after: [],
      iso: () => io.now().toISOString(), agentLease: () => new Date(io.now().getTime() + AGENT_LEASE_MINUTES * 60000).toISOString(),
    };
    // C4: every event of the step, its own and its commands' (those that name no project), is of the run's project, even
    // when another plan's triage of the same id came last in the ledger.
    return withEventContext({ project: c.project }, () => stepOnce(c, e0, returned, versions, flag('agents'), now));
  } finally { lock.release(); }
}

function stepOnce(c: Ctx, e0: ExecutionState, returned: Set<string>, versions: Versions, agents: string | undefined, now: Date): Result {
  const { io } = c;
  // 1. The local lease of each task the coordinator drives with subagents.
  for (const [task, t] of Object.entries(e0.tasks)) if (t.status === 'running' && t.executor === 'subagents') renewLease(io, e0, task, t, now);
  // 2. What came back, and what a previous step left half done.
  const started = new Set<string>();
  const ruled = new Set<string>();
  for (const [task, t] of Object.entries(e0.tasks)) {
    if (t.status !== 'running' || t.executor !== 'subagents') continue;
    if (t.stage === 'brief') { if (startTask(c, task, true)) started.add(task); }
    else if (t.stage === 'implement' || t.stage === 'validate') { ruled.add(task); implementerBack(c, task, t, returned.has(task)); }
    else if (t.stage === 'review') { ruled.add(task); reviewersBack(c, task, t, returned.has(task)); }
  }
  for (const [task, r] of c.rulings) {
    if (!ruled.has(task)) {
      c.actions.push(stepError(task, `--ruling ${task}:${r.kind}: ${task} is not a task of this execution back from its implementer or its reviewers`));
    }
  }
  for (const [task, t] of Object.entries(e0.tasks)) if (t.status === 'integrated') integratedAgain(c, task, t);
  // 3. The tick. Its warnings (listing documents it skipped, I-14) go on to the step's stderr, never into its JSON.
  let warnings = '';
  const tick = call(c, null, ['swarm', 'tick', '--plan', c.planArg, '--db', c.db, ...(agents ? ['--agents', agents] : [])], s => { warnings = s; });
  let wait: number | null = null;
  for (const a of (Array.isArray(tick?.actions) ? tick!.actions as StepAction[] : [])) {
    if (a.type === 'start' && e0.mode === 'subagents' && typeof a.task === 'string') { if (startTask(c, a.task, false)) started.add(a.task); }
    else if (a.type === 'integrate' && typeof a.task === 'string') integrateTask(c, a.task);
    else if (a.type === 'wait') wait = typeof a.seconds === 'number' ? a.seconds : null;
    else c.actions.push(a);
  }
  // 4. What the roadmap batch publishes.
  const after = readExecution(io.cwd) ?? e0;
  const out = {
    // The leases it publishes run from now, at the step's end (M7).
    actions: c.actions, publish: publishOf(io, after, started, versions, io.now()),
    running: Object.values(after.tasks).filter(t => t.status === 'running').length, parallel: after.parallel, wait, say: stepSay(c.actions, wait, c.locale),
  };
  // 5. Last, the writes that must not outlive a step that died before its output (respawned.json, asked.json's re-ask).
  for (const write of c.after) write();
  return { code: 0, stdout: JSON.stringify(out, null, 2) + '\n', stderr: warnings };
}
