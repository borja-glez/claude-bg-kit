import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './errors.js';
import type { Io } from './run.js';
import { readExecution, executionTaskFile, runWorktree, writePublicTask } from '../execution.js';
import { takeStepLock } from '../jobs.js';
import { appendEvent, readEvents, type LedgerEvent } from '../ledger.js';
import { reviewsOf } from '../loop.js';
import { LEASE_MINUTES } from '../../lib/coordination.js';
import { normalizePublicTask, type ExecTask, type ExecutionState, type PublicTask } from '../../lib/execution-state.js';
import { isPlanId } from '../../lib/plan.js';

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
/** `after`: writes the step makes only as its last act, once every command ran (see reviewersBack). */
interface Ctx { io: Io; deps: StepDeps; planArg: string; db: string; runBranch: string; locale: 'es' | 'en'; iso: string; agentLease: string; rulings: Map<string, Ruling>; actions: StepAction[]; after: (() => void)[] }
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

/** Runs one FORGE command; its JSON, or null after recording an `error` action (for `task`) when it failed. */
function call(c: Ctx, task: string | null, argv: string[]): Json | null {
  const r = c.deps.cli(argv);
  if (r.code === 0) {
    try {
      const v = JSON.parse(r.stdout) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Json;
    } catch { /* not JSON: an error below */ }
  }
  c.actions.push({ type: 'error', ...(task ? { task } : {}), command: argv.slice(0, argv[0] === 'swarm' ? 2 : 1).join(' '), code: r.code, stderr: (r.stderr || r.stdout).trim().slice(0, 500) });
  return null;
}

/** The brief a task is on and its BASE: its last phase `implement` with a base (prep logs it); brief 1 without one. */
function briefOf(events: LedgerEvent[], task: string): { n: number; base: string | null } {
  const e = events.filter(x => x.kind === 'phase' && x.task === task && x.phase === 'implement' && typeof x.base === 'string' && x.base).at(-1);
  return { n: typeof e?.brief === 'number' && e.brief >= 1 ? e.brief : 1, base: e ? String(e.base) : null };
}

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
 * after the last review round prepared, else the HEAD that review saw, else BASE. Whatever the step records for round k
 * always precedes the review of round k, so only a later round number makes it the newer one.
 */
function seenOf(work: string, n: number, round: number, base: string | null): string | null {
  const v = readJson(path.join(work, `validators-head-${n}.json`)) as Json | null;
  if (v && typeof v === 'object' && typeof v.head === 'string' && v.head && typeof v.round === 'number' && v.round > round) return v.head;
  return (round ? readText(path.join(work, `reviews-${n}-${round}`, 'head.txt'))?.trim() : null) || base;
}

/** Logs the implementer handed out for `<T>-<n>` (review-close reads its rung), once: a hand-out a later step retries,
 *  with the same agent and role as the last one logged for that brief, adds nothing. */
function logAgent(c: Ctx, taskN: string, agent: string, role: string): void {
  const last = readEvents(c.io.cwd).filter(e => e.kind === 'agent' && e.task === taskN).at(-1);
  if (last?.agent === agent && last.role === role) return;
  appendEvent(c.io.cwd, { ts: c.iso, kind: 'agent', task: taskN, agent, role });
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
  const base: PublicTask = mine ?? { task, runId: e.runId, stage: t.stage, status: t.status, agent: t.agent, round: t.round, since: t.stageSince, updatedAt: now.toISOString(), leaseUntil, by: e.coordinator, mode: 'subagents' };
  writePublicTask(io.cwd, { ...base, leaseUntil, updatedAt: now.toISOString() });
}

/** prep's output for brief 1 that a resumed start can use again: the one the step kept (prep-1.json) when the ledger's
 *  last phase implement with a base is brief 1 on that same BASE, which is still the worktree's HEAD, and its baseline is there. */
function keptPrep(c: Ctx, task: string, worktree: string): Json | null {
  const work = path.join(c.io.cwd, '.forge', 'work', task);
  const kept = readJson(path.join(work, 'prep-1.json')) as Json | null;
  const head = c.deps.gitAt(worktree)(['rev-parse', 'HEAD'])?.trim();
  const { n, base } = briefOf(readEvents(c.io.cwd), task);
  const ok = !!kept && typeof kept === 'object' && typeof kept.validate === 'string' && !!head && kept.base === head && base === head && n === 1
    && existsSync(path.join(work, 'baseline-1.json'));
  return ok ? kept : null;
}

/**
 * A start in mode subagents: worktree, brief, triage --plan and prep (from the tree cache when it can), then the
 * implementer, handed out only once its stage is recorded. A start a previous step left half done (`resume`: the task
 * is still at stage brief, a command failed or the step died) runs again from what it lacks: swarm worktree returns
 * the worktree already there, the brief and the triage are cheap and run again (the triage names the implementer), and
 * prep is skipped when it already recorded this BASE (keptPrep). Every failure is an error action again.
 */
function startTask(c: Ctx, task: string, resume: boolean): boolean {
  const w = call(c, task, ['swarm', 'worktree', task]);
  if (!w || typeof w.worktree !== 'string') return false;
  const worktree = w.worktree;
  const work = path.join('.forge', 'work', task);
  const b = c.deps.cli(['brief', '--plan', c.planArg, '--task', task]);
  if (b.code !== 0) { c.actions.push({ type: 'error', task, command: 'brief', code: b.code, stderr: b.stderr.trim().slice(0, 500) }); return false; }
  const brief = path.join(work, 'brief-1.md');
  mkdirSync(path.join(c.io.cwd, work), { recursive: true });
  writeFileSync(path.join(c.io.cwd, brief), `${b.stdout.trimEnd()}\n\nWorktree: ${slash(worktree)} (work only inside this directory).\n`);
  const tri = call(c, task, ['triage', '--plan', c.planArg, '--task', task, '--cwd', worktree, '--locale', c.locale]);
  if (!tri) return false;
  const kept = resume ? keptPrep(c, task, worktree) : null;
  const pr = kept ?? call(c, task, ['prep', '--task', `${task}-1`, '--path', 'large', '--cwd', worktree]);
  if (!pr) return false;
  if (!kept) writeFileSync(path.join(c.io.cwd, work, 'prep-1.json'), JSON.stringify(pr, null, 2) + '\n');
  const impl = (tri.implementer && typeof tri.implementer === 'object' ? tri.implementer : {}) as Json;
  const agent = typeof impl.agent === 'string' ? impl.agent : 'forge-impl';
  // The skill spawns it from this action: the step logs it, as task-steps step 2 says (review-close reads the rung).
  logAgent(c, `${task}-1`, agent, typeof impl.role === 'string' ? impl.role : 'impl');
  if (!call(c, task, ['swarm', 'task', task, '--stage', 'implement', '--agent', agent, '--round', '0', '--lease', c.agentLease])) return false;
  c.actions.push({
    type: 'spawnImplementer', task, agent, role: impl.role ?? null, brief: slash(brief), report: slash(path.join(work, 'report-1.txt')),
    validate: pr.validate ?? null, worktree, base: pr.base ?? null, ...(w.setup ? { setup: w.setup } : {}), ...(tri.announce ? { announce: tri.announce } : {}),
  });
  return true;
}

/**
 * The BASE a task's review diffs from. A retried task (a conflict sent it back and its implementer merged the run branch
 * into it) forks from the run branch where it merged it: `git merge-base HEAD <run branch>` in its worktree, so the
 * diff holds only its own work, not the tasks integrated meanwhile. When that moved from prep's BASE, the baseline runs
 * again in the run worktree (at that tip, or the closest tree there once another task was integrated since) into
 * baseline-<n>.json, once: base-<n>.json records the BASE it ran on. The ledger keeps prep's phase (forge stats counts a
 * brief from its last phase implement). An adopted task (I3: its member prepared it in its own worktree and ledger, so
 * `base` is already that merge-base and there is no baseline here) gets its baseline the same way. Null after an error action.
 */
function reviewBase(c: Ctx, task: string, t: ExecTask, n: number, base: string, adopted: boolean): string | null {
  if (t.attempts < 1) return base;
  const moved = c.deps.gitAt(t.worktree)(['merge-base', 'HEAD', c.runBranch])?.trim();
  if (!moved || (moved === base && !adopted)) return base;
  const work = path.join(c.io.cwd, '.forge', 'work', task);
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
  writeFileSync(path.join(work, `baseline-${n}.json`), JSON.stringify(results, null, 2) + '\n');
  writeFileSync(mark, JSON.stringify({ base: moved, from: adopted ? null : base, at: c.iso }, null, 2) + '\n');
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
 * (its member prepared it in its own): its BASE is where it forks from the run branch, as reviewBase moves it.
 */
function implementerBack(c: Ctx, task: string, t: ExecTask, told: boolean): void {
  const brief = briefOf(readEvents(c.io.cwd), task);
  const { n } = brief;
  const adopted = !brief.base && t.attempts > 0;
  const base = brief.base ?? (adopted ? c.deps.gitAt(t.worktree)(['merge-base', 'HEAD', c.runBranch])?.trim() || null : null);
  const work = path.join('.forge', 'work', task);
  const abs = path.join(c.io.cwd, work);
  const report = path.join(work, `report-${n}.txt`);
  const round = latestRound(abs, n);
  const given = c.rulings.get(task);
  if (given?.kind === 'defer' && round) { closeRound(c, task, t, n, round, roundOf(c, task, n, round), ['--defer', given.ids.join(',')]); return; }
  if (given && given.kind !== 'review') { c.actions.push(stepError(task, `--ruling ${task}:${given.kind}: no question of ${task} waits for that answer`)); return; }
  const head = c.deps.gitAt(t.worktree)(['rev-parse', 'HEAD'])?.trim() || null;
  if (t.stage !== 'validate' && !given) {
    const seen = seenOf(abs, n, round, base);
    const committed = !!head && !!seen && head !== seen;
    let fresh = false;
    try { fresh = statSync(path.join(c.io.cwd, report)).mtimeMs > Date.parse(t.stageSince); } catch { fresh = false; }
    if (!told && !(fresh && committed)) return;
    if (!committed) { c.actions.push({ type: 'readReport', task, report: slash(report) }); return; }
  }
  if (!base) { c.actions.push(stepError(task, `no phase implement with a base for ${task}: run FORGE prep first`)); return; }
  const loc = ['--locale', c.locale];
  if (!call(c, task, ['swarm', 'task', task, '--stage', 'validate', '--no-agent'])) return;
  const at = reviewBase(c, task, t, n, base, adopted);
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
    if (head) writeFileSync(path.join(abs, `validators-head-${n}.json`), JSON.stringify({ round: r, head }) + '\n');
    if (!call(c, task, ['swarm', 'task', task, '--stage', 'implement', ...(t.agent ? ['--agent', t.agent] : ['--no-agent']), '--lease', c.agentLease])) return;
    c.actions.push({ type: 'validatorsRound', task, implementer: t.agent, findings: (rp.validatorsRound as Json).findings ?? null, ...say });
    return;
  }
  const spawn = Array.isArray(rp.spawn) ? rp.spawn as Json[] : [];
  const first = spawn.find(s => s.twin !== true);
  if (!call(c, task, ['swarm', 'task', task, '--stage', 'review', '--agent', String(first?.agent ?? 'forge-review-correctness'), '--round', String(r), '--lease', c.agentLease])) return;
  if (rp.express === true) {
    c.actions.push({ type: 'express', task, round: r, validate: (rp.validators as Json | undefined)?.cmd ?? null, spawn, ...say });
    return;
  }
  c.actions.push({ type: 'spawnReviewers', task, round: r, path: tri.path ?? null, base: at, spawn, ...(rp.carried ? { carried: rp.carried } : {}), ...say });
}

/**
 * I2: the verify agent a round waits for, as an entry like a reviewer's (its file is verify.json): verify-plan --dir
 * wrote verify-pending.json there when it chose surfaces, with what a respawned verify agent needs. A surface the
 * coordinator then chose not to verify is logged as a verify-skip of <T>-<n> (references/verify.md). Null without the
 * marker, or once every surface it names was skipped.
 */
function pendingVerify(c: Ctx, taskN: string, roundDir: string): Json | null {
  const m = readJson(path.join(roundDir, 'verify-pending.json'));
  if (!isObject(m) || typeof m.at !== 'string') return null;
  const at = m.at;
  const skipped = new Set(readEvents(c.io.cwd).filter(e => e.kind === 'verify-skip' && e.task === taskN && typeof e.ts === 'string' && e.ts >= at && typeof e.surface === 'string').map(e => String(e.surface)));
  const surfaces = (Array.isArray(m.surfaces) ? m.surfaces : []).filter((s): s is Json => isObject(s) && typeof s.name === 'string' && !skipped.has(s.name));
  if (!surfaces.length) return null;
  const { at: _at, task: _task, ...rest } = m;
  return { role: 'verify', ...rest, surfaces };
}

function roundOf(c: Ctx, task: string, n: number, round: number): Round {
  const work = path.join('.forge', 'work', task);
  const abs = path.join(c.io.cwd, work);
  const roundDir = path.join(abs, `reviews-${n}-${round}`);
  const plan = readJson(path.join(roundDir, 'review-plan.json'));
  const verify = pendingVerify(c, `${task}-${n}`, roundDir);
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
  const { n } = briefOf(readEvents(c.io.cwd), task);
  const round = latestRound(path.join(c.io.cwd, '.forge', 'work', task), n);
  if (!round) return;
  const r = roundOf(c, task, n, round);
  const asked = readAsked(path.join(r.roundDir, 'asked.json'));
  const given = c.rulings.get(task);
  if (asked) { answer(c, task, t, n, round, r, asked, given); return; }
  if (given) { c.actions.push(stepError(task, `--ruling ${task}:${given.kind}: no question of ${task} waits for an answer`)); return; }
  const pending = r.plan?.validatorsPending === true && !existsSync(path.join(r.abs, `validators-${n}.json`));
  const isBack = (s: Json) => {
    const file = path.join(r.roundDir, `${keyOf(s)}.json`);
    if (!finished(file)) return false;
    const was = r.respawned[keyOf(s)];
    return !was || (mtimeOf(file) ?? 0) > was.mtimeMs || Date.parse(c.iso) - Date.parse(was.at) > AGENT_LEASE_MINUTES * 60000;
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
    if (!asked.reemitted && Date.parse(c.iso) - Date.parse(asked.at) > ASK_AGAIN_MS) {
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
    for (const k of fresh) next[k] = { at: c.iso, mtimeMs: mtimeOf(path.join(r.roundDir, `${k}.json`)) ?? 0 };
    c.after.push(() => writeJson(r.respawnedFile, next));
    c.actions.push({ type: 'respawnReviewers', task, reviewers: fresh, spawn: r.entries.filter(s => fresh.includes(keyOf(s))) });
    return;
  }
  if (out.ask) {
    // I1: the person answers it (the skill steps again with --ruling); until then the next steps close nothing here.
    const asked = isObject(out.ask) && Array.isArray(out.ask.findings) ? out.ask.findings : [];
    const findings = asked.map(f => (typeof f === 'string' ? f : isObject(f) && typeof f.id === 'string' ? f.id : null)).filter((x): x is string => !!x);
    writeJson(path.join(r.roundDir, 'asked.json'), {
      at: c.iso, findings, next: out.next ?? null, implementer: out.implementer ?? null, findingsFile: out.findings ?? null,
      handover: out.handover ?? null, revert: out.revert ?? null, close: out,
    });
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
    if (!call(c, task, ['swarm', 'task', task, '--stage', 'implement', ...(agent ? ['--agent', agent] : ['--no-agent']), '--round', String(round + 1), '--lease', c.agentLease])) return;
    answered();
    c.actions.push({
      type: next === 'resume' ? 'resumeImplementer' : next === 'fresh-stronger' ? 'freshImplementer' : 'redo', task, implementer: impl, findings: out.findings ?? null,
      ...(out.handover ? { handover: out.handover } : {}), ...(next === 'redo' ? { revert: out.revert ?? null } : {}), ...v,
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
    if (head) writeJson(path.join(r.abs, `validators-head-${n}.json`), { round: round + 1, head });
    else c.actions.push({ type: 'error', task, command: 'git commit', code: 1, stderr: `could not commit ${files.join(', ')} in ${slash(t.worktree)}: commit them with the task's work` });
  }
  const { result, learned, cleanup, evidence, commit, proposals, say } = out;
  return { result, learned, cleanup, evidence, commit, proposals, say };
}

/** The integrate the tick emitted (one at most; none while a merge is in flight): its result is the action's type. */
function integrateTask(c: Ctx, task: string): void {
  const r = call(c, task, ['swarm', 'integrate', task, '--locale', c.locale]);
  if (!r) return;
  const { result, ...rest } = r;
  c.actions.push({ ...rest, type: String(result), task });
}

/** state/T.forge (C7, v1): the task's path, stage, agent, last validators, last verdict and its review count. */
function forgeOf(events: LedgerEvent[], task: string, t: ExecTask): Json {
  const mine = (x: LedgerEvent) => x.task === task || (typeof x.task === 'string' && x.task.startsWith(`${task}-`) && /^\d+$/.test(x.task.slice(task.length + 1)));
  const tri = events.filter(x => x.kind === 'triage' && mine(x) && typeof x.path === 'string').at(-1);
  const p = typeof tri?.path === 'string' ? tri.path : 'large';
  const val = events.filter(x => x.kind === 'validate' && mine(x) && x.baseline !== true && Array.isArray(x.results)).at(-1);
  const verdict = events.filter(x => x.kind === 'verdict' && mine(x)).at(-1);
  const reviews = reviewsOf(Math.max(1, t.round), p);
  return {
    path: p, phase: t.stage, ...(t.agent ? { agent: t.agent } : {}),
    validators: val ? (val.results as Json[]).map(r => ({ name: String(r.validator ?? ''), ok: r.ok === true })) : [],
    ...(verdict ? { verdict: { action: String(verdict.action ?? ''), score: typeof verdict.score === 'number' ? verdict.score : null } } : {}),
    round: reviews.n, cap: reviews.max,
  };
}

/** The data of the roadmap batch the skill writes (J-15, wave 4, prints the writes themselves in this same shape). */
function publishOf(io: Io, e: ExecutionState, started: Set<string>, versions: Versions, now: Date): Json {
  const events = readEvents(io.cwd);
  const own = new Date(now.getTime() + LEASE_MINUTES * 60000).toISOString();
  const lease = (task: string) => {
    try {
      const p = normalizePublicTask(JSON.parse(readFileSync(executionTaskFile(io.cwd, task), 'utf8')));
      if (p && p.runId === e.runId) return p.leaseUntil;
    } catch { /* none yet */ }
    return own;
  };
  const tasks = Object.entries(e.tasks).filter(([, t]) => t.executor === 'subagents' && (t.status === 'running' || t.status === 'accepted')).map(([task, t]) => ({
    task, version: versions.state[task] ?? null, ...(started.has(task) ? { claim: true } : {}),
    exec: { runId: e.runId, mode: 'subagents', by: e.coordinator, agent: t.agent, stage: t.stage, round: t.round, since: t.stageSince, leaseUntil: lease(task) },
    forge: forgeOf(events, task, t),
  }));
  // The coordinator's own lease is never shorter than one it set for an agent that is still running.
  const leaseUntil = tasks.reduce((max, x) => (x.exec.leaseUntil > max ? x.exec.leaseUntil : max), own);
  const slots = Object.entries(e.tasks).filter(([, t]) => t.status === 'running').map(([task, t]) => ({ task, stage: t.stage, agent: t.agent, by: e.coordinator, since: t.stageSince }));
  return {
    tasks, session: { version: versions.sessions[e.coordinator] ?? null, leaseUntil },
    metaRun: { runId: e.runId, kind: 'plan', loose: [], mode: e.mode, parallel: e.parallel, branch: e.branch, mergeOnFinish: e.mergeOnFinish, active: e.active, stopReason: e.stopReason, coordinator: e.coordinator, slots },
  };
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
  const locale: 'es' | 'en' = loc === 'es' || loc === 'en' ? loc : (e0.locale ?? '').toLowerCase().split(/[-_]/)[0] === 'es' ? 'es' : 'en';
  const now = io.now();
  const lock = takeStepLock(io.cwd, now, deps.alive);
  if ('busy' in lock) return { code: 0, stdout: JSON.stringify({ busy: lock.busy }, null, 2) + '\n', stderr: '' };
  try {
    return stepOnce({ io, deps, planArg, db, runBranch: e0.branch, locale, iso: now.toISOString(), agentLease: new Date(now.getTime() + AGENT_LEASE_MINUTES * 60000).toISOString(), rulings, actions: [], after: [] },
      e0, returned, versions, flag('agents'), now);
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
  for (const [task, r] of c.rulings) if (!ruled.has(task)) c.actions.push(stepError(task, `--ruling ${task}:${r.kind}: ${task} is not a task of this execution back from its implementer or its reviewers`));
  // 3. The tick.
  const tick = call(c, null, ['swarm', 'tick', '--plan', c.planArg, '--db', c.db, ...(agents ? ['--agents', agents] : [])]);
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
    actions: c.actions, publish: publishOf(io, after, started, versions, now),
    running: Object.values(after.tasks).filter(t => t.status === 'running').length, parallel: after.parallel, wait, say: stepSay(c.actions, wait, c.locale),
  };
  // 5. Last, the writes that must not outlive a step that died before its output (respawned.json, asked.json's re-ask).
  for (const write of c.after) write();
  return { code: 0, stdout: JSON.stringify(out, null, 2) + '\n', stderr: '' };
}
