import { existsSync, statSync, lstatSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync, type Stats } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { UsageError } from './errors.js';
import type { ExecResult, Io } from './run.js';
import { runWithCache, cleanTree, indexTree, untrackedPaths, cacheGit, checkoutPrefix } from '../validate-cache.js';
import { detectValidators, selectValidators, runValidators, markPreexisting, blocking, globMatch, runOptions, validateEvent, failingLabel, type ExecMany, type RepoReader, type RunOptions, type Scope, type Validator, type ValidatorResult } from '../validators.js';
import { loadConfig } from '../config.js';
import { stopFile, parseRun, readRunText } from '../run.js';
import { isLocale } from '../../lib/forge-run.js';
import { appendEvent, appendPhase, readEvents } from '../ledger.js';
import { readExecution, updateExecution, writePublicTask, executionTaskFile, runBranch, taskBranch, runWorktree, taskWorktree, type LockDeps } from '../execution.js';
import { sleepSync } from '../pid.js';
import { noSlot, type Slot } from '../jobs.js';
import { readMergingFile, takeMerging, removeMergingIf, mergingLive, mergingStaleAt, mergeInFlight, type MergingDoc, type MergingHold } from '../merging.js';
import { schedule, widthOf, widthProfile, relaunchOrBlock, RELAUNCH_CAP, type BgAgent } from '../schedule.js';
import { LEASE_MINUTES, sessionLiveness } from '../../lib/coordination.js';
import { planLocale, sessionReply } from '../../lib/locale.js';
import { signalLiveness } from '../../lib/execution-view.js';
import { liveFile } from '../live.js';
import { STAGES, normalizePublicTask, normalizeLive, normalizeExecution, isSafeId, isRunBranch, type ExecutionState, type ExecTask, type PublicTask } from '../../lib/execution-state.js';
import { claudeSessionId, noClaudeSession } from '../../lib/claude-session.js';
import { parsePlan, PlanError, isPlanId } from '../../lib/plan.js';
import type { SessionDoc, Stage, TaskState } from '../../lib/types.js';
import { mainWorktreeFrom, samePath } from '../../lib/worktree.js';
import { appendOnce, excludeWorktrees, gitToplevel, hasLine, infoFile } from '../../lib/git-info.js';
import { mainCheckout, updateLocal } from '../local.js';
import { readMember, writeMember, isMemberId, listMembers, memberFile } from '../members.js';
import { parseLooseTasks, planOfLoose, statesOfLoose, writeLoose, readLoose, type LooseTask } from '../loose.js';
import { startAnnounce, integratedSay, rejectedDepsSay, keptFilesSay, proposeSay, VENV_HINT } from '../swarm.js';

export interface GitDeps { git: (args: string[]) => string | null; exec: (cmd: string, timeoutSec: number) => ExecResult; execMany?: ExecMany; repo: RepoReader }
export interface SwarmDeps extends GitDeps { at: (dir: string) => GitDeps }
type Result = { code: number; stdout: string; stderr: string };

const ID = /^[A-Za-z0-9_\-.~:@+]{1,80}$/;
const TAKEOVER_MIN = 15;
const MAX_SLEEP_S = 900;

function readDocs<T>(dir: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const f of readdirSync(dir).filter(x => x.endsWith('.json'))) {
    try { out[f.slice(0, -5)] = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as T; } catch { /* a corrupt doc is skipped */ }
  }
  return out;
}

export type SetupPlan = { cmd: string } | { cmd: null; hint: string } | null;
export type SetupResult = { cmd: string | null; ok: boolean; tail: string[] } | null;

/** What prepares a worktree: swarm.setup, else the install command of its lockfile, else npm for a bare package.json. */
export function setupFor(repo: RepoReader, configured: string | undefined): SetupPlan {
  if (configured) return { cmd: configured };
  if (repo.exists('.venv')) return { cmd: null, hint: VENV_HINT.en };
  if (repo.exists('package-lock.json') || repo.exists('npm-shrinkwrap.json')) return { cmd: 'npm ci' };
  if (repo.exists('pnpm-lock.yaml')) return { cmd: 'pnpm install --frozen-lockfile' };
  if (repo.exists('yarn.lock')) return { cmd: 'yarn install --frozen-lockfile' };
  if (repo.exists('bun.lock') || repo.exists('bun.lockb')) return { cmd: 'bun install --frozen-lockfile' };
  // No lockfile: an install that writes none, so no untracked lockfile appears in the worktree.
  if (repo.exists('package.json')) return { cmd: 'npm install --no-package-lock' };
  return null;
}

/** The setup's outcome: its last 20 output lines, a timeout said as the last one. */
function setupResult(cmd: string, r: ExecResult, timeoutSec: number): NonNullable<SetupResult> {
  const tail = r.output.split(/\r?\n/).filter(l => l.trim());
  if (r.timedOut) tail.push(`timeout after ${timeoutSec} s`);
  return { cmd, ok: r.code === 0 && !r.timedOut, tail: tail.slice(-20) };
}

/** Runs the setup in a worktree just created; a failure is reported, never thrown. */
export function runSetup(deps: SwarmDeps, dir: string, root: string): SetupResult {
  const config = loadConfig(root);
  // Lockfiles are read in the new worktree itself, never in the caller's. A .venv is untracked, so a fresh worktree
  // never has one: that hint looks at the main checkout.
  const wt = deps.at(dir).repo;
  const mainRepo = deps.at(root).repo;
  const repo: RepoReader = { ...wt, exists: rel => rel === '.venv' ? mainRepo.exists(rel) : wt.exists(rel) };
  const plan = setupFor(repo, config.swarm.setup);
  if (!plan) return null;
  if (plan.cmd === null) return { cmd: null, ok: false, tail: [plan.hint] };
  return setupResult(plan.cmd, deps.at(dir).exec(plan.cmd, config.validatorTimeoutSec), config.validatorTimeoutSec);
}

const DEPS_DIR = 'node_modules';
// The manifests and lockfiles whose change in a merge means the dependencies are installed again.
const DEP_FILES = [':(glob)**/package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock*'];
const MANIFESTS = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];
const LEARNED_UNION = '/.forge/verify/*.md merge=union';

/** The top level of the worktree `at` runs in; null when git cannot say. */
const toplevel = (at: GitDeps) => gitToplevel(at.git);

/** The directory `at` runs in: its top level plus the prefix git reports there. */
function workdirOf(at: GitDeps): string | null {
  const [top, prefix] = (at.git(['rev-parse', '--show-toplevel', '--show-prefix']) ?? '').split(/\r?\n/).map(l => l.trim());
  return top ? path.join(top, prefix ?? '') : null;
}

/**
 * node_modules/ goes to info/exclude when nothing ignores it in `at` (a greenfield tree, or a rollback that took the
 * .gitignore away): once, shared by every worktree. A failure leaves it untracked, which the next status reports.
 */
function excludeDeps(at: GitDeps): void {
  if (at.git(['check-ignore', '-q', DEPS_DIR]) !== null) return;
  try {
    const file = infoFile(at.git, 'exclude');
    if (file) appendOnce(file, `${DEPS_DIR}/`);
  } catch { /* reported as untracked by the next status */ }
}

/**
 * git's union driver for the surfaces (both sides' learned notes stay), in info/attributes: no commit. A merge attribute
 * the person already set for them (.gitattributes, info/attributes, their global file) is theirs: then nothing is
 * written and `skipped` names it.
 */
function unionLearned(deps: GitDeps): { attributesError?: string; attributesSkipped?: string } {
  try {
    const top = toplevel(deps);
    const file = infoFile(deps.git, 'attributes');
    if (!top || !file) return { attributesError: 'cannot find the git directory' };
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (hasLine(text, LEARNED_UNION)) return {};
    // The surfaces there are now and a name none of them has: a rule for some of them, or for all of them.
    let names: string[] = [];
    try { names = readdirSync(path.join(top, '.forge', 'verify')).filter(f => f.endsWith('.md')).slice(0, 200); } catch { /* none yet */ }
    const attrs = deps.git(['-C', top, 'check-attr', 'merge', '--', ...[...names, 'forge-union-probe.md'].map(n => `.forge/verify/${n}`)]);
    if (attrs === null) return { attributesError: 'git check-attr failed' };
    const chosen = attrs.split(/\r?\n/).map(l => l.trim()).find(l => l && !l.endsWith(': merge: unspecified'));
    if (chosen) return { attributesSkipped: chosen };
    appendOnce(file, LEARNED_UNION);
    return {};
  } catch (e) { return { attributesError: (e as Error).message }; }
}

// Yarn Plug'n'Play installs without node_modules: its loader says the dependencies are there.
const hasDeps = (at: GitDeps) => at.repo.exists(DEPS_DIR) || at.repo.exists('.pnp.cjs');
const needsDeps = (at: GitDeps) => at.repo.exists('package.json') && !hasDeps(at);

/** What the root manifests and lockfiles say, as one hash. */
function manifestHash(at: GitDeps): string {
  const h = createHash('sha1');
  for (const f of MANIFESTS) { const t = at.repo.read(f); if (t !== null) h.update(`${f}\0${t}\0`); }
  return h.digest('hex');
}

/** The install command for the package.json at the root of `at` (swarm.setup wins); null without one. */
function depsCmd(at: GitDeps, configured: string | undefined): string | null {
  // A .venv says nothing about a node manifest: swarm.setup or the node lockfiles choose.
  const plan = setupFor({ ...at.repo, exists: rel => rel !== '.venv' && at.repo.exists(rel) }, configured);
  return plan && plan.cmd !== null ? plan.cmd : null;
}

/** Runs the install in `at`; a node_modules/ it creates is excluded when nothing ignores it. Reported, never thrown. */
function runInstall(at: GitDeps, cmd: string, timeoutSec: number): { setup: NonNullable<SetupResult>; created: boolean } {
  const had = at.repo.exists(DEPS_DIR);
  const setup = setupResult(cmd, at.exec(cmd, timeoutSec), timeoutSec);
  const created = !had && at.repo.exists(DEPS_DIR);
  if (created) excludeDeps(at);
  return { setup, created };
}

// What forge last learned installing in one directory (.forge/execution/deps/<hash of the directory>.json): the
// manifests its last successful install was for, and whether that left dependencies (a manifest without any installs
// nothing, and is not installed again); lastFailed when its last install failed instead (what that left matches no
// manifests); and a failed install before a merge, with the HEAD it failed at.
interface DepsMemo {
  ok?: { manifests: string; cmd: string; deps: boolean };
  lastFailed?: true;
  failed?: { head: string; manifests: string; cmd: string; setup: NonNullable<SetupResult> };
}
const memoFile = (cacheDir: string, dir: string) => path.join(cacheDir, 'deps', `${createHash('sha1').update(path.resolve(dir)).digest('hex').slice(0, 16)}.json`);
function readMemo(file: string): DepsMemo {
  try {
    const o = JSON.parse(readFileSync(file, 'utf8')) as DepsMemo;
    if (!o || typeof o !== 'object') return {};
    const s = o.failed?.setup;
    // A remembered failure is shown again: only a well-formed one.
    const failedOk = !!s && typeof s.cmd === 'string' && typeof s.ok === 'boolean' && Array.isArray(s.tail) && s.tail.every(l => typeof l === 'string');
    return { ...(o.ok ? { ok: o.ok } : {}), ...(o.lastFailed === true ? { lastFailed: true } : {}), ...(o.failed && failedOk ? { failed: o.failed } : {}) };
  } catch { return {}; }
}
function writeMemo(file: string, m: DepsMemo): void {
  try { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(m)); } catch { /* only costs a rerun */ }
}

const lastLine = (s: NonNullable<SetupResult>) => s.tail[s.tail.length - 1] ?? 'no output';

// A NUL-separated (-z) list of paths: git writes each name as it is, so a name it would quote (a quote, a backslash, a
// control character) stays the exact literal path.
const nulList = (s: string | null) => (s ?? '').split('\0').filter(Boolean);

// Changed tracked files, forge's own state aside; paths from the top level.
const trackedChanges = (at: Pick<GitDeps, 'git'>) => nulList(at.git(['diff', '--name-only', '-z', '--', '.', ...LOCAL_STATE]));

/**
 * Runs `fn` (a validator run) in one of forge's own worktrees, then puts back to their index state the tracked files it
 * modified or deleted that had no unstaged change right before it, and adds their paths to `into`. Untracked files
 * are never touched. With `only` (globs, the config's `generated`), only those of the paths that match one of them are
 * put back: how a checkout that is not forge's (the person's) is restored.
 */
export function restoringRegenerated<T>(at: Pick<GitDeps, 'git'>, fn: () => T, into: string[], only?: string[]): T {
  // Generated, tracked build output (a bundle a `build` validator rewrites) must not leave forge's run worktree dirty.
  const listed = at.git(['diff', '--name-only', '-z', '--', '.', ...LOCAL_STATE]);
  const before = new Set(nulList(listed));
  try { return fn(); } finally {
    // Without the "before" list, a change of someone's could not be told from the validators': nothing is restored.
    const back = listed === null ? [] : trackedChanges(at).filter(p => !before.has(p) && (!only || only.some(g => globMatch(g, p))));
    if (back.length && at.git(['checkout', '--', ...back.map(p => `:(top,literal)${p}`)]) !== null) into.push(...back);
  }
}

/** The worktree that has `branch` checked out, from `git worktree list --porcelain`; null when none. */
function worktreeHolding(porcelain: string | null, branch: string): string | null {
  let at: string | null = null;
  for (const line of (porcelain ?? '').split(/\r?\n/)) {
    if (line.startsWith('worktree ')) at = line.slice('worktree '.length).trim();
    else if (line === `branch refs/heads/${branch}`) return at;
  }
  return null;
}

function loadPlanArg(io: Io, planArg: string | undefined, sub: string) {
  if (!planArg) throw new UsageError(`swarm ${sub}: --plan is required`);
  try { return parsePlan(readFileSync(path.resolve(io.cwd, planArg), 'utf8')); } catch (e) {
    throw new UsageError(e instanceof PlanError ? `${planArg}: ${e.issues.join('; ')}` : `swarm ${sub}: cannot read ${planArg}`);
  }
}

/** The loose tasks of an ephemeral run, from the JSON file `--tasks` names. */
function loadTasksArg(io: Io, file: string | undefined, sub: string): LooseTask[] {
  if (!file) throw new UsageError(`swarm ${sub}: --tasks is required for an ephemeral run`);
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path.resolve(io.cwd, file), 'utf8')); } catch { throw new UsageError(`swarm ${sub}: cannot read ${file}`); }
  const r = parseLooseTasks(raw);
  if ('error' in r) throw new UsageError(`swarm ${sub}: ${r.error}`);
  return r.tasks;
}

/**
 * The worktree `task-<T>` of the main checkout on `task/<T>` (created from `runBranch` when the branch is new), with
 * swarm.setup run when it is created. Shared by the coordinator's `swarm worktree` and a member's `--member`.
 */
function addTaskWorktree(deps: SwarmDeps, main: string, task: string, runBranch: string): { worktree: string; branch: string; base: string | null; setup: SetupResult } {
  const dir = taskWorktree(main, task);
  const branch = taskBranch(task);
  let setup: SetupResult = null;
  if (!existsSync(dir)) {
    const g = (args: string[]) => deps.git(['-C', main, ...args]);
    excludeWorktrees(g);
    const exists = g(['rev-parse', '--verify', '-q', `refs/heads/${branch}`]) !== null;
    const added = exists ? g(['worktree', 'add', dir, branch]) : g(['worktree', 'add', '-b', branch, dir, runBranch]);
    if (added === null) throw new UsageError(`swarm worktree: cannot add ${dir} for ${branch}`);
    setup = runSetup(deps, dir, main);
  }
  return { worktree: dir, branch, base: deps.at(dir).git(['rev-parse', 'HEAD'])?.trim() ?? null, setup };
}

/** The `waypoint launch` arguments of a sessions-mode member of task <T>, with its effort, model and launcher from the config. */
function memberLaunch(root: string, planPath: string, task: string, e: ExecutionState): string[] {
  const { swarm } = loadConfig(root);
  return ['launch', planPath, task, '--task', '--run', e.runId, '--coordinator', e.coordinator, '--base', e.branch,
    '--effort', swarm.member.effort, ...(swarm.member.model ? ['--model', swarm.member.model] : []),
    ...(swarm.launcher === 'herdr' ? ['--launcher', 'herdr'] : [])];
}

/** What `tick` and `next` schedule from: the plan, the roadmap listings and the done commits already on the run branch. */
function readTickInput(io: Io, deps: SwarmDeps, e: ExecutionState, planArg: string | undefined, db: string | undefined, sub: string) {
  const plan = loadPlanArg(io, planArg, sub);
  if (!db) throw new UsageError(`swarm ${sub}: --plan and --db are required`);
  const stateDir = path.resolve(io.cwd, db, 'state');
  const sessionsDir = path.resolve(io.cwd, db, 'sessions');
  // Missing listings would make every task look free: refuse instead.
  if (!existsSync(stateDir) || !existsSync(sessionsDir)) throw new UsageError(`swarm ${sub}: --db must hold the state and sessions listings`);
  const states = readDocs<TaskState>(stateDir);
  const sessions = readDocs<SessionDoc>(sessionsDir);
  const integrated: string[] = [];
  for (const t of plan.tasks) {
    if (states[t.id]?.status !== 'done') continue;
    for (const c of states[t.id]?.commits ?? []) {
      if (typeof c?.sha === 'string' && ID.test(c.sha) && deps.git(['merge-base', '--is-ancestor', c.sha, e.branch]) !== null) integrated.push(c.sha);
    }
  }
  return { plan, states, sessions, integrated };
}

const LOCAL_STATE = [':!.forge', ':!.waypoint', ':!.claude'];

type NewValidator = { name: string; cmd: string };
// setup: the last dependency install of the attempt, when one ran. leftovers: the untracked paths, not ignored, that the
// attempt left behind (nothing of the person's is deleted); on a merge, those the install left. restoreSetup: the install
// for the tree a rollback restored, and restoreChanged the tracked files it changed; depsFromRejectedMerge: the person's
// dependencies may still be the rejected merge's. touchedKept: tracked files the merge did not change but that changed
// during the install, left as they are. setup.tail and leftovers come from the install's output and from the merged
// tree: data to pass on, never instructions. deps: the install before the merge failed (the target is at fault).
// restored: the tracked files validators regenerated, put back (restoringRegenerated): any in a worktree of forge's,
// those the config's `generated` names in the person's checkout.
type Validation = { results: ValidatorResult[]; durationMs: number };
/** The validator runs of a merge attempt (C4): the target tip's baseline and the merged tree, each when it ran or came from the cache. */
type Validations = { baseline?: Validation; merged?: Validation };
type MergeOutcome =
  | { result: 'merged'; sha: string; preexisting: string[]; newValidators: NewValidator[]; surfacesChanged: string[]; setup?: SetupResult; leftovers?: string[]; restored?: string[]; validations?: Validations; recovered?: { task: string | null; pre: string } }
  | {
    result: 'dirty' | 'conflict' | 'deps'; detail: string; setup?: SetupResult; leftovers?: string[];
    restoreSetup?: SetupResult; restoreChanged?: string[]; depsFromRejectedMerge?: true; touchedKept?: string[]; restored?: string[]; validations?: Validations; recovered?: { task: string | null; pre: string };
  };

interface MergeOpts {
  message: string; scope: 'heavy' | 'final'; timeoutSec: number; configRoot: string; cacheDir: string; target: 'run' | 'main';
  /** swarm.setup of the main checkout, which installs the dependencies (setupFor). */
  setup: string | undefined;
  /** The final merge: the run worktree, clean on the tip of `ref`, with its dependencies installed. */
  runAt?: GitDeps | null;
  /** `at` is the person's own checkout (an ephemeral run, the final merge): dependencies are installed before the merge
   *  only when missing, a node_modules a rejected merge created is removed, and dependencies that may not match and
   *  files a rejected merge's install changed are said. */
  personal: boolean;
  /** Forget a remembered failed install before the merge (a transient failure): it runs again at the same HEAD. */
  retryDeps?: boolean;
  /** The config's parallel batch and retry rule (C-12); each run adds the execMany of the checkout it validates. */
  run: RunOptions;
  /** The main checkout (its .forge/cache/validate) and what the tree cache may do (C6): integrate reads and writes it,
   *  the final merge only writes it. */
  main: string; cache: { read: boolean; write: boolean }; now: () => Date;
  /** C-03: the validation slot of a merge run with --out in the background (swarm.validateJobs). */
  slot?: Slot;
  /** D-07: the task the merge integrates, for merging.json (none for the final merge). */
  task?: string | null;
}

// The untracked paths git does not ignore, forge's own state aside (a directory collapsed into `dir/`).
const untracked = (at: GitDeps) => nulList(at.git(['ls-files', '-z', '--others', '--exclude-standard', '--directory', '--', '.', ...LOCAL_STATE]));

// The per-sha baseline forge 0.16 kept (.forge/execution/baseline/<scope>-<target>-<sha>.json): still read for one version, never written (the tree cache, C6, replaces it).
const baselineFile = (cacheDir: string, key: string, sha: string) => path.join(cacheDir, 'baseline', `${key}-${sha}.json`);
function readBaseline(cacheDir: string, key: string, sha: string): unknown {
  try { return JSON.parse(readFileSync(baselineFile(cacheDir, key, sha), 'utf8')); } catch { return null; }
}
/** D-07: what a merge attempt says when another one holds merging.json (null: one being written, not readable yet). */
function inFlightDetail(m: MergingDoc | null, place: string | null): string {
  if (!m) return 'another integration is starting (.forge/execution/merging.json)';
  return `another integration (${m.task ?? m.ref}, pid ${m.pid}) is merging ${place && samePath(m.dir, place) ? 'there' : `in ${m.dir}`}`;
}

/**
 * D-07, before a merge attempt in `at`. A marker of a live attempt merging in this same worktree: it waits (`dirty`).
 * A marker left here by an attempt that died (or ran out of time) in its baseline phase, or with no merge in progress,
 * is removed: it has nothing to undo. An unfinished merge (MERGE_HEAD) that forge left here in its merge phase, with
 * HEAD still at `pre` and MERGE_HEAD the tip of `ref`: its marker is taken off first (so of two attempts recovering it
 * only one aborts), then `git merge --abort`, checked, and the attempt goes on (`recovered`). Any other unfinished
 * merge is someone's: `dirty`, untouched. Null when there is nothing to do.
 */
function recoverMerge(at: GitDeps, o: MergeOpts): MergeOutcome | { recovered: { task: string | null; pre: string } } | null {
  const read = readMergingFile(o.main);
  const marker = read?.doc ?? null;
  const place = workdirOf(at);
  const here = !!marker && !!place && samePath(marker.dir, place);
  if (here && mergingLive(marker, o.now().getTime())) return { result: 'dirty', detail: inFlightDetail(marker, place) };
  const mergeHead = at.git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])?.trim() || null;
  if (here && (mergeHead === null || marker!.phase === 'baseline')) removeMergingIf(o.main, read!.text);
  if (mergeHead === null) return null;
  const tip = (rev: string) => at.git(['rev-parse', '--verify', '-q', `${rev}^{commit}`])?.trim() || null;
  const own = here && marker!.phase === 'merge' && tip('HEAD') === marker!.pre && mergeHead === tip(marker!.ref);
  if (!own) return { result: 'dirty', detail: 'an unfinished merge is in progress there (git merge --abort to clear it)' };
  if (!removeMergingIf(o.main, read!.text)) return { result: 'dirty', detail: 'another integration is recovering the unfinished merge there' };
  at.git(['merge', '--abort']);
  if (at.git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']) !== null || tip('HEAD') !== marker!.pre) {
    return { result: 'dirty', detail: 'an unfinished merge forge left there could not be aborted (git merge --abort by hand)' };
  }
  return { recovered: { task: marker!.task, pre: marker!.pre } };
}

/**
 * Merges `ref` into the branch checked out at `at` with --no-ff, runs the validators there and commits `message`.
 * A conflict or a red validator is rolled back to the pre-merge sha; a merge left half-done is never touched, unless
 * forge left it there and its process died (recoverMerge).
 * The validators get the dependencies of a package.json first (ensureDeps): before the baseline when `at` has none,
 * and after the merge when it changed a manifest or a lockfile or they are still missing.
 * Each validator run in a worktree of forge's (the run worktree) puts back the tracked files it regenerated, and in the
 * person's checkout those the config's `generated` names: `restored`.
 */
function mergeIn(at: GitDeps, ref: string, o: MergeOpts): MergeOutcome {
  // D-07: a merge forge left half-done here, whose process died, is aborted first; anyone else's stops the attempt.
  const recovery = recoverMerge(at, o);
  if (recovery && 'result' in recovery) return recovery;
  const regenerated: string[] = [];
  const validations: Validations = {};
  const marker: { hold: MergingHold | null } = { hold: null };
  try {
    const r = mergeAttempt(at, ref, o, regenerated, validations, marker);
    const withRestored = regenerated.length ? { ...r, restored: [...new Set(regenerated)] } : r;
    const out = validations.baseline || validations.merged ? { ...withRestored, validations } : withRestored;
    return recovery ? { ...out, recovered: recovery.recovered } : out;
  } finally {
    // The marker of this attempt goes after its commit, its rollback, a refusal or a throw.
    marker.hold?.release();
  }
}

function mergeAttempt(at: GitDeps, ref: string, o: MergeOpts, regenerated: string[], validations: Validations, marker: { hold: MergingHold | null }): MergeOutcome {
  // A validator run where `where` is forge's own worktree restores what it regenerated; the person's checkout only the
  // files the config's `generated` names (nothing when it names none). The list is read once, before the merge, on
  // purpose: a task cannot widen what is put back in the person's checkout.
  let generated: string[] = [];
  try { generated = loadConfig(o.configRoot).generated; } catch { generated = []; }
  const validating = <T>(where: GitDeps, owned: boolean, fn: () => T): T =>
    (owned ? restoringRegenerated(where, fn, regenerated) : generated.length ? restoringRegenerated(where, fn, regenerated, generated) : fn());
  // A validator run through the tree cache (C6), keyed by the tree `tree` gives and the directory `where` runs them in;
  // what it misses runs as before.
  const cachedRun = (where: GitDeps, owned: boolean, list: Validator[], tree: () => string | null): ValidatorResult[] =>
    runWithCache(list, misses => (misses.length ? (o.slot ?? noSlot) : noSlot)(() => validating(where, owned, () => runValidators(misses, where.exec, o.timeoutSec, { ...o.run, execMany: where.execMany }))), {
      main: o.main, git: cacheGit(where.git), dir: o.cache.read || o.cache.write ? checkoutPrefix(where.git) : null, repo: where.repo, generated,
      read: o.cache.read, write: o.cache.write, tree, now: o.now,
    });
  const key = `${o.scope}-${o.target}`;
  const selection: Scope = o.scope === 'final' ? { mode: 'final' } : { mode: 'heavy', changed: null };
  const merging = () => at.git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']) !== null;
  if (merging()) return { result: 'dirty', detail: 'an unfinished merge is in progress there (git merge --abort to clear it)' };
  const dirty = at.git(['status', '--porcelain', '--', '.', ...LOCAL_STATE]);
  if (dirty === null || dirty.trim() !== '') return { result: 'dirty', detail: 'it has uncommitted changes' };
  if (at.git(['rev-parse', '--verify', '-q', `${ref}^{commit}`]) === null) return { result: 'conflict', detail: `unknown ref ${ref}` };
  const pre = at.git(['rev-parse', 'HEAD'])?.trim();
  if (!pre) return { result: 'conflict', detail: 'cannot read HEAD' };
  const place = workdirOf(at);
  // D-07: one merge attempt at a time in this checkout, from here to its commit or rollback: merging.json, taken with
  // 'wx' (mergeIn releases it). Each stamp's staleAt bounds what the attempt has left until its next stamp
  // (mergingStaleAt): here the install before the baseline; then the baseline's validator run; at `git merge`, the
  // install after it and a rollback's reinstall; then the merged tree's validator run and a rollback's reinstall.
  // Its dir is the one git names, or the one it was asked to merge in (configRoot): never empty, so tick reads it.
  const until = (left: { installs: number; validators?: number }) => mergingStaleAt(o.now(), o.timeoutSec, left);
  let took: ReturnType<typeof takeMerging>;
  try {
    took = takeMerging(o.main, {
      task: o.task ?? null, pre, ref, pid: process.pid, startedAt: o.now().toISOString(), staleAt: until({ installs: 1 }),
      dir: place ?? path.resolve(o.configRoot), phase: 'baseline',
    }, o.now().getTime());
  } catch (err) {
    return { result: 'dirty', detail: `cannot write .forge/execution/merging.json (${(err as Error).message})` };
  }
  if ('busy' in took) return { result: 'dirty', detail: inFlightDetail(took.busy, place) };
  const hold = marker.hold = took.hold;
  // Checked again under the marker (mergeIn releases it): an attempt that committed, or a merge someone started, between
  // the checks above and the take would make `pre` wrong (a duplicate integrate reporting the old sha, a rollback that
  // could not reach it).
  if (at.git(['rev-parse', 'HEAD'])?.trim() !== pre || merging()) {
    return { result: 'dirty', detail: 'HEAD moved or a merge started there while this integration was starting' };
  }
  const before = new Set(untracked(at));
  // The same list indexTree compares against, taken before the merge (the cache assumes the work tree starts clean).
  const cacheBefore = new Set(untrackedPaths(cacheGit(at.git)));
  const entry = (): Stats | null => { try { return place ? lstatSync(path.join(place, DEPS_DIR)) : null; } catch { return null; } };
  // Anything at node_modules before the attempt (a directory, a file, a link, even dangling) is the person's. Unknown
  // when the directory is: then it counts as there.
  const hadEntry = !place || entry() !== null;
  const memoAt = place ? memoFile(o.cacheDir, place) : null;
  const memo = (): DepsMemo => (memoAt ? readMemo(memoAt) : {});
  const remember = (m: DepsMemo) => { if (memoAt) writeMemo(memoAt, m); };
  if (o.retryDeps && memo().failed) { const { failed: _gone, ...rest } = memo(); remember(rest); }
  let setup: NonNullable<SetupResult> | undefined;
  let created = false;
  let installs = 0;
  /**
   * Installs with `cmd`, remembering a success for these manifests; a failure (after the merge, or for the tree a
   * rollback restored) forgets the last success, so the next check before a baseline installs again.
   */
  const installWith = (cmd: string) => {
    const manifests = manifestHash(at);
    const d = runInstall(at, cmd, o.timeoutSec);
    created ||= d.created;
    const { ok: _was, lastFailed: _failed, ...rest } = memo();
    remember(d.setup.ok ? { ...rest, ok: { manifests, cmd, deps: hasDeps(at) } } : { ...rest, lastFailed: true });
    return d.setup;
  };
  const install = (): boolean => {
    const cmd = depsCmd(at, o.setup);
    if (!cmd) return true;
    // These manifests installed nothing here last time (no dependencies): there is nothing to install again.
    const ok = memo().ok;
    if (!hasDeps(at) && ok?.manifests === manifestHash(at) && ok.cmd === cmd && ok.deps === false) return true;
    installs++;
    setup = installWith(cmd);
    return setup.ok;
  };
  let afterMerge = false;
  type Restored = { restoreSetup?: SetupResult; restoreChanged?: string[]; depsFromRejectedMerge?: true };
  /**
   * After a rollback that followed an install of the merged manifests, the dependencies are put back for the restored
   * tree: installed again (any target; the tracked files that install changed are reported, never reset), or in the
   * person's checkout the node_modules directory this attempt created removed. Otherwise the person hears they may not
   * match.
   */
  const restoreDeps = (): Restored => {
    const flag = o.personal ? { depsFromRejectedMerge: true as const } : {};
    if (at.repo.exists('package.json')) {
      const cmd = depsCmd(at, o.setup);
      if (!cmd) return flag;
      const edited = new Set(trackedChanges(at));
      const s = installWith(cmd);
      const changed = trackedChanges(at).filter(p => !edited.has(p));
      return { restoreSetup: s, ...(changed.length ? { restoreChanged: changed } : {}), ...(!s.ok || changed.length ? flag : {}) };
    }
    if (!o.personal) return {};
    const now = entry();
    // Only a real directory where there was nothing: never a link, a file, or what the person had.
    if (!hadEntry && now?.isDirectory() && !now.isSymbolicLink()) {
      try {
        rmSync(path.join(place!, DEPS_DIR), { recursive: true, force: true });
        created = false;
        return {};
      } catch { return flag; }
    }
    return now || hasDeps(at) ? flag : {};
  };
  const leftovers = () => {
    // A node_modules/ this attempt created is not noise once the merge whose .gitignore covered it is undone.
    if (created) excludeDeps(at);
    return untracked(at).filter(p => !before.has(p));
  };
  const withSetup = () => (setup ? { setup } : {});
  const rollback = (detail: string, extra: { touchedKept?: string[] } = {}): MergeOutcome => {
    const undone = at.git(['merge', '--abort']) !== null;
    const clean = undone && at.git(['rev-parse', 'HEAD'])?.trim() === pre && !merging();
    const restored: Restored = afterMerge ? (clean ? restoreDeps() : o.personal ? { depsFromRejectedMerge: true } : {}) : {};
    return { result: 'conflict', detail: clean ? detail : `rollback failed: needs manual attention (${detail})`, ...withSetup(), leftovers: leftovers(), ...extra, ...restored };
  };
  // The final merge into a target that has not moved since the run branched: the merged tree is the run tip's, which
  // the run worktree validates with its own dependencies; nothing is installed in the person's checkout.
  const unmoved = !!o.runAt && at.git(['merge-base', '--is-ancestor', 'HEAD', ref]) !== null;
  // The tip's dependencies are missing: installed before the baseline. In the run worktree, which is forge's, also when
  // forge's last install there failed or was for other manifests (a manifest changed by hand). The person's checkout
  // only gets missing ones: dependencies they installed themselves for a change of their own are never reinstalled on
  // a guess.
  const stale = () => {
    if (!at.repo.exists('package.json')) return false;
    if (!hasDeps(at)) return true;
    if (o.personal) return false;
    const m = memo();
    return !!m.lastFailed || (!!m.ok && m.ok.manifests !== manifestHash(at));
  };
  if (!unmoved && stale()) {
    const cmd = depsCmd(at, o.setup);
    const manifests = manifestHash(at);
    // An install that failed at this HEAD with these manifests and this command fails again: it is not rerun each tick.
    const failed = memo().failed;
    if (cmd && failed && failed.head === pre && failed.manifests === manifests && failed.cmd === cmd) {
      return { result: 'deps', detail: `could not install its dependencies before merging ${ref}: ${lastLine(failed.setup)} (remembered from the install that failed at ${pre.slice(0, 12)}; it runs again with --retry-deps, or once HEAD, the manifests or swarm.setup change)`, setup: failed.setup };
    }
    if (!install()) {
      if (cmd) remember({ ...memo(), failed: { head: pre, manifests, cmd, setup: setup! } });
      return { result: 'deps', detail: `could not install its dependencies before merging ${ref}: ${lastLine(setup!)}`, ...withSetup(), leftovers: leftovers() };
    }
    if (failed) { const { failed: _gone, ...rest } = memo(); remember(rest); }
    const left = at.git(['status', '--porcelain', '--', '.', ...LOCAL_STATE]);
    if (left === null || left.trim() !== '') return { result: 'deps', detail: `the dependency install left changes in the worktree: ${(left ?? '').split(/\r?\n/).filter(Boolean).slice(0, 5).join(', ')}`, ...withSetup(), leftovers: leftovers() };
  }
  // What the target detects before the merge: the validators detected only after it are new.
  let detected0: Validator[] | null = null;
  try { detected0 = detectValidators(at.repo, loadConfig(o.configRoot)); } catch { detected0 = null; }
  // D-07: a stamp that finds merging.json no longer this attempt's (another took it, past its staleAt) stops it.
  const takenOver = (): MergeOutcome => ({ result: 'dirty', detail: 'another integration took over .forge/execution/merging.json', ...withSetup() });
  // What the target's tip already fails is not caused by this merge: validators red there are "preexisting". The tip is
  // usually the tree the previous integration validated after its merge, so the tree cache (C6) has it.
  let baseline: unknown = readBaseline(o.cacheDir, key, pre);
  if (baseline === null) {
    // Without its dependencies the tip would fail everything, which would excuse every failure after the merge.
    if (unmoved && needsDeps(at)) baseline = [];
    else {
      const chosen0 = detected0 ? selectValidators(detected0, selection) : [];
      if (!hold.stamp('baseline', until({ installs: 0, validators: chosen0.length }))) return takenOver();
      const t0 = Date.now();
      try {
        const results = detected0 ? cachedRun(at, !o.personal, chosen0, () => cleanTree(cacheGit(at.git), generated)) : [];
        if (detected0) validations.baseline = { results, durationMs: Date.now() - t0 };
        baseline = results;
      } catch { baseline = []; }
      const left = at.git(['status', '--porcelain', '--', '.', ...LOCAL_STATE]);
      if (left === null || left.trim() !== '') return { result: 'dirty', detail: `the validators left changes in the worktree: ${(left ?? '').split(/\r?\n/).filter(Boolean).slice(0, 5).join(', ')}`, ...withSetup() };
    }
  }
  // D-07: the merge phase, so a later attempt tells its own leftover (this ref, from this pre) from someone's.
  if (!hold.stamp('merge', until({ installs: 2 }))) return takenOver();
  if (at.git(['merge', '--no-ff', '--no-commit', ref]) === null) {
    if (!merging()) return { result: 'conflict', detail: `git refused to merge ${ref}`, ...withSetup() };
    return rollback(`merge conflict with ${ref}`);
  }
  if (!merging()) return { result: 'merged', sha: pre, preexisting: [], newValidators: [], surfacesChanged: [], ...withSetup() };
  // The index holds the merged tree (HEAD is still the pre-merge commit until the commit below).
  const merged = at.git(['write-tree'])?.trim() || null;
  const inRun = !!o.runAt && merged !== null && merged === (at.git(['rev-parse', '--verify', '-q', `${ref}^{tree}`])?.trim() || null);
  const v = inRun ? o.runAt! : at;
  if (!inRun && at.repo.exists('package.json')) {
    const changed = at.git(['diff', '--name-only', pre, '--', ...DEP_FILES]);
    // An unreadable diff counts as a change: installing again is safer than validating without dependencies.
    if (changed === null || changed.trim() !== '' || (installs === 0 && !hasDeps(at))) {
      const edited = new Set(trackedChanges(at));
      const ran = installs;
      const ok = install();
      afterMerge = installs > ran;
      const touched = trackedChanges(at).filter(p => !edited.has(p));
      // A file the merge changed and the install rewrote blocks `git merge --abort`: back to its merged version (the
      // install's own edit). Any other changed file may hold someone's edit: kept as it is, and said.
      const mergedPaths = new Set(nulList(at.git(['diff', '--cached', '--name-only', '-z', pre])));
      const reset = touched.filter(p => mergedPaths.has(p));
      const kept = touched.filter(p => !mergedPaths.has(p));
      if (reset.length) at.git(['checkout', '--', ...reset.map(p => `:(top,literal)${p}`)]);
      const keptOut = kept.length ? { touchedKept: kept } : {};
      if (!ok) return rollback(`dependencies could not be installed after merging ${ref}: ${lastLine(setup!)}`, keptOut);
      if (touched.length) return rollback(`the dependency install changed tracked files after merging ${ref}: ${touched.slice(0, 5).join(', ')}`, keptOut);
    }
  }
  // What the install after the merge left untracked: committed it is not, and the next integration finds it.
  const installLeft = afterMerge ? untracked(at).filter(p => !before.has(p)) : [];
  let results: ValidatorResult[];
  let detected: Validator[];
  try {
    detected = detectValidators(v.repo, loadConfig(o.configRoot));
    // The run worktree as the target (not the person's) or as the final merge's place to validate (inRun).
    const chosen = selectValidators(detected, selection);
    // D-07: in the middle of its own merge the attempt goes on even if the stamp fails (it can only fail past the bound).
    hold.stamp('merge', until({ installs: 1, validators: chosen.length }));
    // The merged tree is the index's (HEAD is still the pre-merge commit): when nothing was integrated since the task
    // branched, it is the tree its review-prep validated, and every result comes from the cache.
    const t0 = Date.now();
    const raw = cachedRun(v, inRun || !o.personal, chosen, () => (inRun ? cleanTree(cacheGit(v.git), generated) : indexTree(cacheGit(at.git), generated, cacheBefore)));
    results = markPreexisting(raw, baseline);
    validations.merged = { results, durationMs: Date.now() - t0 };
  } catch (err) {
    return rollback(`validators could not run: ${(err as Error).message}`);
  }
  const failed = results.filter(blocking);
  if (failed.length) return rollback(`validators failed after merging ${ref}: ${failed.map(r => failingLabel(r)).join(', ')}`);
  if (at.git(['commit', '--no-edit', '-m', o.message]) === null || merging()) return rollback(`could not commit the merge of ${ref}`);
  const sha = at.git(['rev-parse', 'HEAD'])?.trim() ?? '';
  if (!sha || sha === pre) return rollback(`could not commit the merge of ${ref}`);
  const newValidators = detected0 ? detected.filter(d => !detected0!.some(b => b.name === d.name)).map(d => ({ name: d.name, cmd: d.cmd })) : [];
  // The surfaces the merge changed: a changed surface is asked about again, and the person may want to see the diff.
  const surfacesChanged = (at.git(['-c', 'core.quotePath=false', 'diff', '--name-only', pre, sha, '--', ':(top).forge/verify']) ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return {
    result: 'merged', sha, preexisting: results.filter(r => r.preexisting).map(r => r.validator), newValidators, surfacesChanged, ...withSetup(),
    ...(installLeft.length ? { leftovers: installLeft } : {}),
  };
}

/** The run worktree when it is on the tip of `branch` with nothing uncommitted (its tree is the branch's); else null. */
function cleanRunWorktree(deps: SwarmDeps, wt: string, branch: string): GitDeps | null {
  if (!existsSync(wt)) return null;
  const at = deps.at(wt);
  const tip = deps.git(['rev-parse', '--verify', '-q', `refs/heads/${branch}`])?.trim();
  if (!tip || at.git(['rev-parse', 'HEAD'])?.trim() !== tip) return null;
  if (at.git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']) !== null) return null;
  const status = at.git(['status', '--porcelain', '--', '.', ...LOCAL_STATE]);
  return status !== null && status.trim() === '' ? at : null;
}

/** --locale es|en; null when not given. */
function localeArg(rest: string[], sub: string): 'es' | 'en' | null {
  const i = rest.indexOf('--locale');
  if (i < 0) return null;
  const v = rest[i + 1];
  if (v !== 'es' && v !== 'en') throw new UsageError(`swarm ${sub}: --locale must be es or en`);
  return v;
}

/** `start --locale`: the language the person writes in, any language code (es, pt, pt-BR…); null when not given. */
function personLocaleArg(rest: string[]): string | null {
  const i = rest.indexOf('--locale');
  if (i < 0) return null;
  const v = rest[i + 1];
  if (!isLocale(v)) throw new UsageError('swarm start: --locale must be a language code (es, en, pt-BR…)');
  return v;
}

const isSpanish = (locale: string | null | undefined) => (locale ?? '').toLowerCase().split(/[-_]/)[0] === 'es';
/** Spanish when the given locale's primary subtag is es, or without one when the plan's locale is Spanish; else English. */
const spanish = (given: string | null, root: string, project: string) =>
  given ? isSpanish(given) : isSpanish(planLocale(root, project));

// What the coordinator passes on of a merge attempt: the installs that ran, what a rollback left behind, whether the
// person's dependencies may be the rejected merge's and, in the person's checkout (`personal`), the files of theirs its
// install changed; with the lines to tell them.
function attemptExtras(r: MergeOutcome, es: boolean, ref: string, personal: boolean) {
  const failed = r.result === 'merged' ? null : r;
  const say = [
    ...(failed?.depsFromRejectedMerge ? [rejectedDepsSay(es, ref)] : []),
    ...(personal && failed?.touchedKept?.length ? [keptFilesSay(es, ref, failed.touchedKept)] : []),
  ];
  return {
    ...(r.setup ? { setup: r.setup } : {}),
    ...(r.recovered ? { recovered: r.recovered } : {}),
    ...(r.leftovers ? { leftovers: r.leftovers } : {}),
    ...(r.restored?.length ? { restored: r.restored } : {}),
    ...(failed?.touchedKept ? { touchedKept: failed.touchedKept } : {}),
    ...(failed?.restoreSetup ? { restoreSetup: failed.restoreSetup } : {}),
    ...(failed?.restoreChanged ? { restoreChanged: failed.restoreChanged } : {}),
    ...(failed?.depsFromRejectedMerge ? { depsFromRejectedMerge: true } : {}),
    ...(say.length ? { say } : {}),
  };
}

/**
 * H-16: an integrated commit as `waypoint commit-info` prints it, measured as what the task brings: the diff from the
 * merge's first parent (`git show --shortstat` prints nothing for a merge) and the subject of its second parent, the
 * task's last commit. Without a second parent (nothing was merged) the title is the commit's own and add/del are 0.
 */
export function commitInfo(git: (args: string[]) => string | null, sha: string): { sha: string; ts: string; title: string; add: number; del: number } {
  const [cI = '', ...subject] = (git(['show', '-s', '--format=%cI%x09%s', sha]) ?? '').trim().split('\t');
  const second = git(['rev-parse', '--verify', '-q', `${sha}^2`])?.trim() || null;
  const title = second ? (git(['show', '-s', '--format=%s', second]) ?? '').trim() : subject.join('\t');
  const stat = second ? (git(['diff', '--shortstat', `${sha}^1`, sha]) ?? '') : '';
  const num = (re: RegExp) => Number(stat.match(re)?.[1] ?? 0);
  const t = Date.parse(cI);
  return { sha, ts: Number.isFinite(t) ? new Date(t).toISOString() : '', title, add: num(/(\d+) insertion/), del: num(/(\d+) deletion/) };
}

/** The two `validate` events of an integration (C4): the run tip's baseline and the merged tree, both on the task. */
function logValidations(io: Io, task: string, v: Validations | undefined): void {
  const ts = io.now().toISOString();
  if (v?.baseline) appendEvent(io.cwd, validateEvent(ts, task, v.baseline.results, v.baseline.durationMs, 'heavy', { baseline: true, integrate: 'baseline' }));
  if (v?.merged) appendEvent(io.cwd, validateEvent(ts, task, v.merged.results, v.merged.durationMs, 'heavy', { integrate: 'merged' }));
}

function integrate(rest: string[], io: Io, deps: SwarmDeps): Result {
  const task = rest[0];
  if (!task || !isPlanId(task)) throw new UsageError('swarm integrate: a task id is required');
  const locale = localeArg(rest, 'integrate');
  const e = readExecution(io.cwd);
  if (!e) throw new UsageError('swarm integrate: no execution (forge swarm start)');
  const t = e.tasks[task];
  if (!t || t.status !== 'accepted') throw new UsageError(`swarm integrate: ${task} is not accepted`);
  const at = io.now().toISOString();
  const out = (v: unknown): Result => ({ code: 0, stdout: JSON.stringify(v) + '\n', stderr: '' });
  const wt = e.kind === 'plan' ? runWorktree(io.cwd) : io.cwd;
  const target = deps.at(wt);
  const head = target.git(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
  if (e.kind === 'plan') {
    if (head !== e.branch) return out({ result: 'run-dirty', detail: `${wt} is on ${head ?? '?'}, not ${e.branch}` });
  } else if (head !== e.branch) {
    // An ephemeral run integrates into the user's own branch: never into whatever the user switched to since.
    throw new UsageError(`swarm integrate: the main checkout is on ${head ?? '?'}, not ${e.branch} (the branch this ephemeral run started from); switch back to ${e.branch} to integrate ${task}`);
  }
  const config = loadConfig(io.cwd);
  const personal = e.kind !== 'plan';
  // --no-cache: neither read nor write the tree cache (a red result it holds may have been flaky).
  const cache = config.validate.cache && !rest.includes('--no-cache');
  const r = mergeIn(target, t.branch, {
    message: `forge: integrate ${task}`, task, scope: 'heavy', timeoutSec: config.validatorTimeoutSec, configRoot: wt,
    cacheDir: path.join(io.cwd, '.forge', 'execution'), target: 'run', setup: config.swarm.setup, personal,
    retryDeps: rest.includes('--retry-deps'),
    run: runOptions(config, readEvents(io.cwd), io.now()),
    main: io.cwd, cache: { read: cache, write: cache }, now: io.now, slot: io.slot,
  });
  logValidations(io, task, r.validations);
  const es = spanish(locale, io.cwd, e.project);
  const extras = attemptExtras(r, es, t.branch, personal);
  // Neither the target nor its dependencies are ready: the task stays accepted.
  if (r.result === 'dirty') return out({ result: 'run-dirty', detail: r.detail, ...extras });
  if (r.result === 'deps') return out({ result: 'run-deps', detail: r.detail, ...extras });
  // Under the lock, on the execution as it is now: a tick or a swarm task that ran during the merge is kept (I-15).
  updateExecution(io.cwd, cur => {
    if (!cur?.tasks[task]) return null;
    const next: ExecTask = r.result === 'merged'
      ? { ...cur.tasks[task], status: 'integrated', stage: 'integrate', updatedAt: at, detail: null, finishedAt: at }
      : { ...cur.tasks[task], status: 'conflict', detail: r.detail, updatedAt: at };
    return { ...cur, tasks: { ...cur.tasks, [task]: next } };
  }, { now: io.now, sleep: io.sleep });
  if (r.result !== 'merged') return out({ result: 'conflict', detail: r.detail, ...extras });
  // Announced here: a later triage must not announce them again.
  if (r.newValidators.length) {
    try { updateLocal(io.cwd, s => ({ ...s, known: [...new Set([...s.known, ...r.newValidators.map(v => v.name)])] })); } catch { /* a later triage announces them again */ }
  }
  const say = integratedSay(es, e.branch, r.newValidators, r.preexisting);
  return out({
    result: 'integrated', sha: r.sha, commit: commitInfo(target.git, r.sha), preexisting: r.preexisting, newValidators: r.newValidators, say,
    ...(r.surfacesChanged.length ? { surfacesChanged: r.surfacesChanged } : {}), ...extras,
  });
}

/** C2: closes the execution of `root` when it is inactive and still open; true when it did. */
function closeEnded(root: string, at: string, by: 'merge' | 'close', deps: LockDeps): boolean {
  let closed = false;
  updateExecution(root, cur => {
    if (!cur || cur.active || cur.closedAt) return null;
    closed = true;
    return { ...cur, closedAt: at, closedBy: by };
  }, deps);
  return closed;
}

function mergeFinal(rest: string[], io: Io, deps: SwarmDeps): Result {
  const e = readExecution(io.cwd);
  if (!e) throw new UsageError('swarm merge: no execution (forge swarm start)');
  const locale = localeArg(rest, 'merge');
  const out = (v: unknown): Result => ({ code: 0, stdout: JSON.stringify(v) + '\n', stderr: '' });
  // C2: a merged run that already ended is over: closed, so lens, the band and the roadmap stop drawing it.
  const merged = (v: Record<string, unknown>): Result => out({ ...v, ...(closeEnded(io.cwd, io.now().toISOString(), 'merge', { now: io.now, sleep: io.sleep }) ? { closed: true } : {}) });
  if (e.kind !== 'plan') return merged({ result: 'merged', sha: deps.git(['rev-parse', 'HEAD'])?.trim() ?? '' });
  // D-07: never while an integration is in flight, wherever it merges; its merging.json stays as it is. A result, as
  // main-dirty is: the coordinator waits for it and runs swarm merge again.
  const inFlight = mergeInFlight(io.cwd, io.now().getTime());
  if (inFlight) {
    const m = inFlight.doc;
    return out({ result: 'busy', detail: `${m ? `an integration (${m.task ?? m.ref}, pid ${m.pid}) is merging in ${m.dir}` : 'an integration is starting'}; run swarm merge again once it ends` });
  }
  if (!e.mergeOnFinish && !rest.includes('--yes')) return out({ result: 'needs-authorization' });
  const branch = deps.git(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
  if (branch !== e.base) return out({ result: 'main-dirty', detail: `the main checkout is on ${branch ?? '?'}, not ${e.base}` });
  const config = loadConfig(io.cwd);
  const r = mergeIn(deps, e.branch, {
    message: `forge: merge ${e.branch}`, scope: 'final', timeoutSec: config.validatorTimeoutSec, configRoot: io.cwd,
    cacheDir: path.join(io.cwd, '.forge', 'execution'), target: 'main', setup: config.swarm.setup,
    runAt: cleanRunWorktree(deps, runWorktree(io.cwd), e.branch), personal: true, retryDeps: rest.includes('--retry-deps'),
    run: runOptions(config, readEvents(io.cwd), io.now()),
    main: io.cwd, cache: { read: false, write: config.validate.cache }, now: io.now, slot: io.slot,
  });
  const extras = attemptExtras(r, spanish(locale, io.cwd, e.project), e.branch, true);
  if (r.result === 'dirty') return out({ result: 'main-dirty', detail: `the main checkout ${r.detail}`, ...extras });
  if (r.result === 'deps') return out({ result: 'main-deps', detail: `the main checkout ${r.detail}`, ...extras });
  return r.result === 'merged' ? merged({ result: 'merged', sha: r.sha, preexisting: r.preexisting, ...extras }) : out({ result: 'conflict', detail: r.detail, ...extras });
}

export function swarmCommand(args: string[], io: Io, deps: SwarmDeps, ext: { step?: (rest: string[]) => Result } = {}): Result {
  const [sub, ...rest] = args;
  const flag = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    const v = i >= 0 ? rest[i + 1] : undefined;
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  const has = (name: string) => rest.includes(`--${name}`);
  const json = (v: unknown): Result => ({ code: 0, stdout: JSON.stringify(v, null, 2) + '\n', stderr: '' });
  const ok = (): Result => ({ code: 0, stdout: 'ok\n', stderr: '' });
  const now = io.now();
  const iso = now.toISOString();
  const current = () => {
    const e = readExecution(io.cwd);
    if (!e) throw new UsageError(`swarm ${sub}: no execution (forge swarm start)`);
    return e;
  };
  // K2-02: an execution forge stop stopped, or one closed, stays as it is: a step or an agent still at work when the person
  // stopped it records nothing more. One that is only inactive (stalled) still moves: swarm retry revives it.
  const notEnded = (x: ExecutionState): ExecutionState => {
    if (x.closedAt) throw new UsageError(`swarm ${sub}: the execution ${x.runId} is closed; nothing of it moves any more`);
    if (!x.active && x.stopReason === 'stopped') throw new UsageError(`swarm ${sub}: the execution ${x.runId} is stopped (forge stop); nothing of it moves any more`);
    return x;
  };
  // I-15: every write of execution.json reads it again under its lock and changes only what this command changes.
  const lockDeps: LockDeps = { now: io.now, sleep: io.sleep };
  const update = (fn: (cur: ExecutionState | null) => ExecutionState | null) => updateExecution(io.cwd, fn, lockDeps);
  if (['start', 'tick', 'integrate', 'merge', 'sleep', 'worktree', 'retry', 'relaunch', 'nudge', 'takeover', 'step'].includes(sub ?? '') && !(sub === 'worktree' && has('member'))) {
    const top = deps.git(['rev-parse', '--show-toplevel'])?.trim();
    const main = mainWorktreeFrom(deps.git(['worktree', 'list', '--porcelain']));
    if (!top || !main || !samePath(top, main)) {
      throw new UsageError(`swarm ${sub}: run it from the main checkout${main ? ` (${main})` : ''}, not from a worktree`);
    }
  }
  const taskArg = () => {
    const t = rest[0];
    if (!t || !isPlanId(t)) throw new UsageError(`swarm ${sub}: a task id is required`);
    return t;
  };
  // Members read the execution of the main checkout from any worktree and never write execution.json.
  const memberCtx = (needMember: boolean) => {
    const main = mainCheckout(io.cwd);
    const e = readExecution(main);
    if (!e?.active) throw new UsageError(`swarm ${sub}: no active execution`);
    if (e.kind === 'ephemeral') throw new UsageError(`swarm ${sub}: an ephemeral run takes no members`);
    const session = flag('session') ?? flag('member');
    if (!session) throw new UsageError(`swarm ${sub}: --session is required`);
    if (!isMemberId(session)) throw new UsageError(`swarm ${sub}: --session ${session.slice(0, 130)} is not a valid session id (letters, digits, _ - .; max 120)`);
    const m = needMember ? readMember(main, session) : null;
    if (needMember && (!m || m.runId !== e.runId)) throw new UsageError(`swarm ${sub}: ${session} has not joined this execution`);
    return { main, e, session, m };
  };

  switch (sub) {
    case 'join': {
      const { main, e, session } = memberCtx(false);
      if (session === e.coordinator || session === e.hookSession) throw new UsageError(`swarm join: ${session} coordinates this execution`);
      const role = flag('role');
      if (role !== 'executor' && role !== 'manual') throw new UsageError('swarm join: --role must be executor or manual');
      const task = flag('task') ?? null;
      if (task !== null && !isPlanId(task)) throw new UsageError('swarm join: --task is not a task id');
      if (role === 'executor' && !task) throw new UsageError('swarm join: an executor needs --task');
      // Claude's own session id, the one its hooks receive: the hooks find the member by it (C1: the flag, else
      // CLAUDE_CODE_SESSION_ID). A flag without a value, or an unsubstituted `${CLAUDE_SESSION_ID}`, counts as absent.
      const given = flag('hook-session');
      const id = claudeSessionId(given, io.env ?? process.env);
      // A rejoin without one keeps the hook id this member recorded in the same run.
      const before = readMember(main, session);
      const hookSession = id ?? (before?.runId === e.runId ? before.hookSession : null);
      // No usable id does not stop the join: the member works without its own live signal, and the output says why.
      const warning = id !== null ? null
        : given ? `--hook-session ${given.slice(0, 130)} is not a usable session id (letters, digits, _ - .; max 120): joined without a live signal`
          : hookSession === null ? 'no Claude session id (--hook-session or CLAUDE_CODE_SESSION_ID): joined without a live signal' : null;
      if (hookSession !== null && hookSession === e.hookSession) throw new UsageError(`swarm join: ${hookSession} coordinates this execution`);
      writeMember(main, { sessionId: session, role, runId: e.runId, task, name: flag('name') ?? null, since: iso, hookSession });
      return json({ runId: e.runId, role, task, coordinator: e.coordinator, branch: e.branch, mode: e.mode, project: e.project, ...(warning ? { warning } : {}) });
    }
    case 'report': {
      const task = taskArg();
      const { main, e, session, m } = memberCtx(true);
      const member = m!;
      if (member.role === 'executor' && member.task !== task) throw new UsageError(`swarm report: ${session} executes ${member.task}, not ${task}`);
      const stage = flag('stage') as Stage | undefined;
      if (!stage || !STAGES.includes(stage)) throw new UsageError(`swarm report: --stage must be one of ${STAGES.join('|')}`);
      const status = (flag('status') ?? 'running') as ExecTask['status'];
      if (!['running', 'accepted', 'blocked'].includes(status)) throw new UsageError('swarm report: --status must be running, accepted or blocked');
      const round = has('round') ? Number(flag('round')) : 0;
      if (!Number.isInteger(round) || round < 0 || round > 99) throw new UsageError('swarm report: --round must be an integer from 0 to 99');
      let prev: PublicTask | null = null;
      try { prev = normalizePublicTask(JSON.parse(readFileSync(executionTaskFile(main, task), 'utf8'))); } catch { prev = null; }
      // Another session still holding the task's lease owns its public file: never overwrite it.
      if (prev && prev.runId === e.runId && prev.by !== session && Date.parse(prev.leaseUntil) > now.getTime()) {
        throw new UsageError(`swarm report: ${task} is reported by ${prev.by} until ${prev.leaseUntil}`);
      }
      if (member.role === 'manual' && member.task !== task) writeMember(main, { ...member, task });
      const since = prev && prev.by === session && prev.stage === stage && prev.runId === e.runId ? prev.since : iso;
      const lease = flag('lease') && !Number.isNaN(Date.parse(flag('lease')!)) ? flag('lease')! : new Date(now.getTime() + LEASE_MINUTES * 60000).toISOString();
      const p: PublicTask = { task, runId: e.runId, stage, status, agent: has('no-agent') ? null : (flag('agent') ?? null), round, since, updatedAt: iso, leaseUntil: lease, by: session, mode: member.role === 'executor' ? 'sessions' : 'manual' };
      writePublicTask(main, p);
      return json(p);
    }
    case 'next': {
      const { e, session } = memberCtx(true);
      const { plan, states, sessions, integrated } = readTickInput(io, deps, e, flag('plan'), flag('db'), 'next');
      const running = Object.values(e.tasks).filter(t => t.status === 'running').length;
      // The coordinator's own scheduler, seen from this session: its claims count as its own, the coordinator's as another's.
      const d = schedule({ plan, states, sessions, exec: { ...e, coordinator: session, parallel: Math.min(10, running + 1) }, integrated, now: now.getTime() });
      const start = d.actions.find((a): a is { type: 'start'; task: string } => a.type === 'start');
      return json(start ? { task: start.task, reason: null } : { task: null, reason: d.next.stallReason ?? 'nothing is ready' });
    }
    case 'start': {
      const project = flag('project');
      const session = flag('session');
      if (!project || !ID.test(project) || !session || !ID.test(session)) throw new UsageError('swarm start: --project and --session are required');
      // C1: Claude's id of the session that runs the start, checked before any branch or worktree moves. It becomes the
      // execution's hookSession, the one session its Stop hook steps (also on a resume, e.g. after a /clear).
      const hook = claudeSessionId(flag('hook-session'), io.env ?? process.env);
      if (!hook) throw new UsageError(noClaudeSession('swarm start', '--hook-session'));
      const config = loadConfig(io.cwd);
      let parallel = config.swarm.parallel;
      if (has('parallel')) {
        const v = Number(flag('parallel'));
        if (!Number.isInteger(v) || v < 1 || v > 10) throw new UsageError('swarm start: --parallel must be an integer from 1 to 10');
        parallel = v;
      }
      const kind = flag('kind') ?? 'plan';
      if (kind !== 'plan' && kind !== 'ephemeral') throw new UsageError('swarm start: --kind must be plan or ephemeral');
      if (kind === 'ephemeral' && flag('mode') === 'sessions') throw new UsageError('swarm start: an ephemeral run is always subagents (sessions need a plan)');
      // swarm.mode in the config chooses for plan runs only: an ephemeral run has no plan to launch sessions on.
      const mode = kind === 'ephemeral' ? (flag('mode') ?? 'subagents') : (flag('mode') ?? config.swarm.mode ?? 'subagents');
      if (mode !== 'subagents' && mode !== 'sessions') throw new UsageError('swarm start: --mode must be subagents or sessions');
      if (has('autonomy') && flag('autonomy') !== 'auto' && flag('autonomy') !== 'ask') throw new UsageError('swarm start: --autonomy must be auto or ask');
      const auto = flag('autonomy') === 'auto' ? { autonomy: 'auto' as const } : {};
      const locale = personLocaleArg(rest);
      const base = deps.git(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
      if (!base || base === 'HEAD') throw new UsageError('swarm start: the main checkout must be on a branch');
      const prev = readExecution(io.cwd);
      // D-14: a start never changes the coordinator of an active execution; taking it over is swarm takeover's call.
      if (prev?.active && prev.coordinator !== session) throw new UsageError(
        `swarm start: the execution ${prev.runId} is coordinated by ${prev.coordinator}; to go on with it from this session run ` +
        `swarm takeover --session ${session} --hook-session <id> (it checks that ${prev.coordinator} stopped), or join it as a manual member (/forge:run --join)`);
      const branch = flag('branch') ?? runBranch(project);
      if (!isRunBranch(branch)) throw new UsageError('swarm start: --branch is not a valid branch name');
      // execution.json is read back through the safe id rules: refuse here, before any branch or worktree exists.
      if (!isMemberId(session)) throw new UsageError('swarm start: --session must use letters, digits, _ - . (at most 120)');
      if (!isSafeId(`${project}-${iso.replace(/[:.]/g, '')}`)) throw new UsageError('swarm start: --project must use letters, digits, _ - .');
      if (kind === 'ephemeral' && !isRunBranch(base)) throw new UsageError(`swarm start: the base branch ${base} is outside the run branch rule (letters, digits, _ - . /)`);
      let setup: SetupResult = null;
      let baseSync: 'created' | 'up-to-date' | 'fast-forward' | 'merged' | null = null;
      const resume = !!prev && prev.active && prev.kind === kind && prev.project === project && prev.branch === (kind === 'plan' ? branch : base);
      let loose: LooseTask[] = [];
      let ignoredTasks = false;
      const moves: string[] = [];
      // Even from its own coordinator, of either kind: a new run would overwrite the execution.json of the run in progress.
      if (prev?.active && !resume) {
        throw new UsageError(`swarm start: the execution ${prev.runId} is active (kind ${prev.kind}); finish it or stop it (forge stop) first; a request during it goes to that run`);
      }
      if (kind === 'ephemeral') {
        if (resume && prev) {
          // The run keeps the batch it started with: new requests go to the next run.
          const doc = readLoose(io.cwd, prev.runId);
          if (!doc) throw new UsageError('swarm start: the ephemeral run lost .forge/loose.json');
          loose = doc.tasks;
          ignoredTasks = has('tasks');
        } else {
          loose = loadTasksArg(io, flag('tasks'), 'start');
          // Loose ids repeat between runs: a leftover worktree or a branch with unmerged work is refused, all checks
          // before anything moves.
          for (const t of loose) {
            const dir = taskWorktree(io.cwd, t.id);
            if (existsSync(dir)) throw new UsageError(`swarm start: ${dir} already exists; remove it (git worktree remove) or use another id`);
            const tb = taskBranch(t.id);
            if (deps.git(['rev-parse', '--verify', '-q', `refs/heads/${tb}`]) === null) continue;
            if (deps.git(['merge-base', '--is-ancestor', tb, base]) === null) throw new UsageError(`swarm start: ${tb} has work not on ${base}; use another id`);
            moves.push(tb);
          }
        }
        if (!has('parallel')) parallel = Math.min(parallel, Math.max(1, widthOf(planOfLoose(loose))));
      }
      if (kind === 'plan') {
        const wt = runWorktree(io.cwd);
        // The run branch gets its own worktree: it can be neither the base (checked out here) nor a branch
        // another worktree holds, or `git worktree add` refuses it.
        if (branch === base) throw new UsageError(`swarm start: ${branch} is the base branch (checked out in the main checkout); the run branch must be another one (omit --branch for ${runBranch(project)})`);
        const defaultBranch = (deps.git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.trim().replace(/^origin\//, ''))
          || (deps.git(['rev-parse', '--verify', '-q', 'refs/heads/main']) !== null ? 'main' : deps.git(['rev-parse', '--verify', '-q', 'refs/heads/master']) !== null ? 'master' : null);
        if (defaultBranch && branch === defaultBranch) throw new UsageError(`swarm start: ${branch} is the default branch; an execution never integrates into it directly`);
        const holder = worktreeHolding(deps.git(['worktree', 'list', '--porcelain']), branch);
        if (holder && !samePath(holder, wt)) throw new UsageError(`swarm start: ${branch} is checked out in another worktree (${holder}); pick another --branch`);
        if (existsSync(wt)) {
          const on = deps.at(wt).git(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
          if (on !== branch) throw new UsageError(`swarm start: ${wt} exists and is on ${on ?? '?'}, not ${branch}; switch it or remove it (git worktree remove)`);
        }
        const existed = deps.git(['rev-parse', '--verify', '-q', `refs/heads/${branch}`]) !== null;
        if (!existed && deps.git(['branch', branch, base]) === null) {
          throw new UsageError(`swarm start: cannot create ${branch} from ${base}`);
        }
        // A-08: the run and task worktrees never show as untracked, also without a .gitignore entry for them. Asked at
        // the main checkout, as addTaskWorktree does: the ignore rules are read from where git runs.
        const mainDir = mainWorktreeFrom(deps.git(['worktree', 'list', '--porcelain']));
        excludeWorktrees(mainDir ? args => deps.git(['-C', mainDir, ...args]) : deps.git);
        if (!existsSync(wt)) {
          if (deps.git(['worktree', 'add', wt, branch]) === null) throw new UsageError(`swarm start: cannot add the worktree ${wt}`);
          setup = runSetup(deps, wt, io.cwd);
        }
        // A run branch left by an earlier execution is brought up to its base before planning; a conflict is
        // refused (never a second run branch) and nothing is removed.
        if (!existed) baseSync = 'created';
        else if (!resume) {
          const at = deps.at(wt);
          // Read before any merge: once a merge stops on a conflict, the worktree always looks dirty.
          const status = at.git(['status', '--porcelain', '--', '.', ...LOCAL_STATE]);
          const dirty = status === null || status.trim() !== '';
          const dirtyMsg = `swarm start: the run worktree ${wt} has uncommitted changes; commit or clean them before ${branch} is brought up to ${base}`;
          if (deps.git(['merge-base', '--is-ancestor', base, branch]) !== null) baseSync = 'up-to-date';
          else if (deps.git(['merge-base', '--is-ancestor', branch, base]) !== null) {
            if (at.git(['merge', '--ff-only', base]) === null) throw new UsageError(dirty ? dirtyMsg : `swarm start: cannot fast-forward ${branch} to ${base}`);
            baseSync = 'fast-forward';
          } else if (at.git(['merge', '--no-ff', base, '-m', `forge: bring ${base} into ${branch}`]) !== null) baseSync = 'merged';
          else {
            at.git(['merge', '--abort']);
            // A refused merge in a dirty worktree is not a conflict: say what blocks it.
            if (dirty) throw new UsageError(dirtyMsg);
            throw new UsageError(`swarm start: ${branch} has diverged from ${base} and they conflict; merge them by hand or remove ${branch}`);
          }
        }
      }
      // The person's language (--locale): a resume keeps the recorded one unless a new flag is given.
      const lang = locale ? { locale } : {};
      const state: ExecutionState = resume && prev
        ? { ...prev, parallel, mode, mergeOnFinish: prev.mergeOnFinish || has('merge-on-finish'), coordinator: session, hookSession: hook, sleepUntil: null, ...auto, ...lang }
        : {
            runId: `${project}-${iso.replace(/[:.]/g, '')}`, kind, mode, parallel, project, base, branch: kind === 'plan' ? branch : base,
            mergeOnFinish: has('merge-on-finish'), coordinator: session, hookSession: hook, active: true, stopReason: null, stallReason: null,
            startedAt: iso, lastStepAt: null, lastBlockStep: null, sleepUntil: null, tasks: {}, closedAt: null, closedBy: null, ...auto, ...lang,
          };
      // An execution that would not read back (an id outside the safe rule) is refused rather than saved.
      if (!normalizeExecution(state)) throw new UsageError('swarm start: --project, --session and the run branch must use letters, digits, _ - . (and / in the branch), at most 120 characters');
      // A task branch already merged into the base is deleted (an ancestor of it: nothing is lost); `swarm worktree`
      // creates it again from the tip of the run's branch when its turn comes, so it sees the work integrated since.
      for (const tb of moves) {
        if (deps.git(['branch', '-D', tb]) === null) throw new UsageError(`swarm start: cannot delete ${tb}; if a worktree still holds it, run git worktree prune or remove that worktree (git worktree remove)`);
      }
      // Learned notes two tasks append to the same surface are merged by git's union driver, never left as a conflict.
      const attributes = unionLearned(deps);
      // C2: a new run over an ended one that nobody closed replaces it; say which (execution.json keeps one run).
      const replaced = prev && !prev.active && !prev.closedAt && !resume ? { runId: prev.runId, stopReason: prev.stopReason } : null;
      rmSync(stopFile(io.cwd), { force: true });
      // A resume keeps what changed meanwhile and takes only this start's fields.
      updateExecution(io.cwd, cur => (resume && cur && cur.runId === state.runId
        ? { ...cur, parallel: state.parallel, mode: state.mode, mergeOnFinish: state.mergeOnFinish, coordinator: state.coordinator, hookSession: state.hookSession, sleepUntil: null, ...auto, ...lang }
        : state), lockDeps);
      if (kind === 'ephemeral' && !resume) writeLoose(io.cwd, { runId: state.runId, tasks: loose });
      const looseOut = kind === 'ephemeral'
        ? { loose: loose.length, ...(ignoredTasks ? { ignoredTasks: true, message: `the ephemeral run ${state.runId} is resumed with its own ${loose.length} tasks; --tasks was ignored (start a new run for new requests once this one ends)` } : {}) }
        : {};
      const announce = startAnnounce({
        es: spanish(state.locale ?? null, io.cwd, project), kind, resume, runId: state.runId, mode: state.mode, parallel: state.parallel,
        branch: state.branch, base: state.base, mergeOnFinish: state.mergeOnFinish, loose: loose.length, setup,
      });
      return json({ ...state, setup, baseSync, ...looseOut, announce, ...attributes, ...(replaced ? { replaced } : {}) });
    }
    case 'status': {
      // K2-01: the execution of the main checkout, from any worktree.
      const state = readExecution(mainCheckout(io.cwd));
      return json({ present: state !== null, state });
    }
    case 'propose': {
      const plan = !flag('plan') && has('tasks') ? planOfLoose(loadTasksArg(io, flag('tasks'), 'propose')) : loadPlanArg(io, flag('plan'), 'propose');
      const locale = localeArg(rest, 'propose');
      const p = widthProfile(plan);
      const width = widthOf(plan);
      const config = loadConfig(io.cwd);
      const configured = config.swarm.mode ?? null;
      const parallel = width < 2 ? 1 : Math.min(config.swarm.parallel, width);
      const reasons = [`${plan.tasks.length} tasks`, `up to ${width} at once (dependencies and zones)`];
      // D-19: how wide the plan is wave by wave, its longest chain and the zones that serialize it, said in one line.
      const es = locale ? locale === 'es' : isSpanish((plan as { locale?: string }).locale);
      return json({
        width, configured, recommended: { mode: 'subagents', parallel }, reasons,
        profile: p.profile, chain: p.chain, serializing: p.serializing, mostlySerial: p.mostlySerial, say: proposeSay(es, plan.tasks.length, p),
      });
    }
    case 'worktree': {
      if (has('member')) {
        // A member gets its task worktree in the main checkout; execution.json stays the coordinator's.
        const task = taskArg();
        const { main, e, session, m } = memberCtx(true);
        if (m!.role === 'executor' && m!.task !== task) throw new UsageError(`swarm worktree: ${session} executes ${m!.task}, not ${task}`);
        return json(addTaskWorktree(deps, main, task, e.branch));
      }
      const task = taskArg();
      const e = notEnded(current());
      const { worktree: dir, branch, base, setup } = addTaskWorktree(deps, io.cwd, task, e.branch);
      const t: ExecTask = e.tasks[task] ?? { status: 'running', stage: 'brief', round: 0, worktree: dir, branch, executor: e.mode, attempts: 0, agent: null, startedAt: iso, stageSince: iso, updatedAt: iso, detail: null };
      update(cur => cur && { ...notEnded(cur), tasks: { ...cur.tasks, [task]: { ...(cur.tasks[task] ?? t), worktree: dir, branch, updatedAt: iso } } });
      return json({ worktree: dir, branch, base, setup });
    }
    case 'task': {
      const task = taskArg();
      const e = current();
      const prev = e.tasks[task];
      if (!prev) throw new UsageError(`swarm task: ${task} is not part of this execution`);
      if (has('drop')) {
        // A claim race lost to another session: forget the task so the next tick sees that session's claim.
        update(cur => { if (!cur) return null; const { [task]: _dropped, ...tasks } = cur.tasks; return { ...cur, tasks }; });
        rmSync(executionTaskFile(io.cwd, task), { force: true });
        return ok();
      }
      notEnded(e);
      const stageArg = flag('stage') as Stage | undefined;
      if (stageArg !== undefined && !STAGES.includes(stageArg)) throw new UsageError(`swarm task: --stage must be one of ${STAGES.join('|')}`);
      const statusArg = flag('status') as ExecTask['status'] | undefined;
      let detailArg: string | null | undefined;
      if (flag('detail-file')) {
        try { detailArg = readFileSync(path.resolve(io.cwd, flag('detail-file')!), 'utf8').trim().slice(0, 500) || null; } catch { throw new UsageError('swarm task: cannot read --detail-file'); }
      }
      const roundArg = has('round') ? Number(flag('round')) : undefined;
      if (roundArg !== undefined && (!Number.isInteger(roundArg) || roundArg < 0 || roundArg > 99)) throw new UsageError('swarm task: --round must be an integer from 0 to 99');
      const agentArg = has('no-agent') ? null : flag('agent');
      // Only the fields given here change; the rest keep what the task holds when the lock is taken (I-15).
      const build = (base: ExecTask): ExecTask => {
        const stage = stageArg ?? base.stage;
        const status = statusArg ?? base.status;
        // K2-02: a task forge stop stopped never runs again in this execution (a new swarm start makes a new one).
        if (base.status === 'stopped' && status !== 'stopped') throw new UsageError(`swarm task: ${task} is stopped (forge stop) and stays stopped`);
        if (!['running', 'accepted', 'blocked'].includes(status) && status !== base.status) throw new UsageError('swarm task: --status must be running, accepted or blocked');
        const stageSince = base.stage !== stage ? iso : base.stageSince;
        // Blocked now (it was not): the task's time ends here. Back to running: the next finish writes it again.
        const finishedAt = status === 'blocked' && base.status !== 'blocked' ? iso : status === 'running' && base.finishedAt ? null : base.finishedAt;
        return {
          ...base, stage, status, round: roundArg ?? base.round, agent: agentArg === undefined ? base.agent : agentArg,
          detail: detailArg === undefined ? base.detail : detailArg, updatedAt: iso, stageSince, ...(finishedAt !== undefined ? { finishedAt } : {}),
        };
      };
      let base = prev;
      let next = build(prev);
      update(cur => {
        if (!cur) return null;
        notEnded(cur);
        base = cur.tasks[task] ?? prev;
        next = build(base);
        return { ...cur, tasks: { ...cur.tasks, [task]: next } };
      });
      const lease = flag('lease') && !Number.isNaN(Date.parse(flag('lease')!)) ? flag('lease')! : new Date(now.getTime() + LEASE_MINUTES * 60000).toISOString();
      writePublicTask(io.cwd, { task, runId: e.runId, stage: next.stage, status: next.status, agent: next.agent, round: next.round, since: next.stageSince, updatedAt: iso, leaseUntil: lease, by: e.coordinator, mode: base.executor });
      if (base.stage !== next.stage) appendPhase(io.cwd, { ts: iso, kind: 'phase', task, phase: next.stage });
      return json(next);
    }
    case 'tick': {
      const e = current();
      if (!e.active) throw new UsageError('swarm tick: the execution is not active');
      // An ephemeral run schedules from its own loose.json and execution: no plan, no roadmap.
      const input = e.kind === 'ephemeral'
        ? (() => {
            const loose = readLoose(io.cwd, e.runId);
            if (!loose) throw new UsageError('swarm tick: the ephemeral run has no .forge/loose.json');
            return { plan: planOfLoose(loose.tasks), states: statesOfLoose(e), sessions: {}, integrated: [] as string[] };
          })()
        : readTickInput(io, deps, e, flag('plan'), flag('db'), 'tick');
      const { plan, states, sessions, integrated } = input;
      const publicTasks: Record<string, PublicTask> = {};
      try {
        for (const f of readdirSync(path.join(io.cwd, '.forge', 'execution')).filter(n => n.endsWith('.json')).slice(0, 500)) {
          try { const p = normalizePublicTask(JSON.parse(readFileSync(path.join(io.cwd, '.forge', 'execution', f), 'utf8'))); if (p && `${p.task}.json` === f) publicTasks[p.task] = p; } catch { /* skip */ }
        }
      } catch { /* none yet */ }
      let agents: BgAgent[] | null = null;
      if (flag('agents')) {
        let raw: unknown;
        try { raw = JSON.parse(readFileSync(path.resolve(io.cwd, flag('agents')!), 'utf8')); } catch { throw new UsageError('swarm tick: cannot read --agents'); }
        if (!Array.isArray(raw)) throw new UsageError('swarm tick: --agents must be a JSON array of {name, state}');
        agents = raw.filter((a): a is BgAgent => !!a && typeof a === 'object' && typeof a.name === 'string' && (a.state === 'working' || a.state === 'idle')).slice(0, 100);
      }
      // D-07: an integration is in flight (merging.json, from its baseline to its commit): this tick integrates nothing.
      const merging = mergeInFlight(io.cwd, now.getTime()) !== null;
      // The scheduler decides on the execution as it is under the lock, so a swarm task or an integrate that ran
      // meanwhile is never overwritten (I-15).
      let d!: ReturnType<typeof schedule>;
      update(cur => { d = schedule({ plan, states, sessions, exec: cur ?? e, integrated, now: now.getTime(), publicTasks, agents, merging }); return d.next; });
      // In sessions mode a start carries the whole `waypoint launch` argument list: the coordinator runs it as is.
      const planPath = flag('plan');
      const actions = e.mode === 'sessions' && planPath
        ? d.actions.map(a => a.type === 'start' ? { ...a, launch: memberLaunch(io.cwd, planPath, a.task, e) } : a)
        : d.actions;
      return json({ actions, running: Object.values(d.next.tasks).filter(t => t.status === 'running').length, parallel: e.parallel });
    }
    case 'retry': {
      const task = taskArg();
      const e = current();
      const t = e.tasks[task];
      if (e.closedAt) throw new UsageError(`swarm retry: the execution ${e.runId} is closed; start a new one`);
      // Checked on the read above and again under the lock, on the task as it is then: a write that landed since is
      // kept, and a task no longer in that state is left alone (I-15). Only an execution still stalled then is revived.
      const revived = (x: ExecutionState) => !x.active && x.stopReason === 'stalled';
      if (has('adopt')) {
        const adoptable = (x: ExecTask | undefined): x is ExecTask => !!x && x.status === 'conflict' && x.executor !== 'subagents';
        const notAdoptable = (x: ExecTask | undefined) =>
          new UsageError(`swarm retry: --adopt takes a member's task in conflict (${task} is ${x ? `${x.status}, ${x.executor}` : 'not in this execution'})`);
        if (!adoptable(t)) throw notAdoptable(t);
        if (deps.git(['rev-parse', '--verify', '-q', `refs/heads/${t.branch}`]) === null) throw new UsageError(`swarm retry: ${t.branch} does not exist`);
        // The fix round runs where the branch already is (a member's task-<T>, or the manual session's own worktree).
        const holder = worktreeHolding(deps.git(['worktree', 'list', '--porcelain']), t.branch);
        // Taking over a session's own worktree must not trample its uncommitted edits.
        if (holder !== null) {
          const status = deps.at(holder).git(['status', '--porcelain']);
          if (status === null) throw new UsageError(`swarm retry: could not read the worktree status of ${t.branch} (${holder}); check it by hand before --adopt`);
          if (status.trim() !== '') {
            throw new UsageError(`swarm retry: the worktree of ${t.branch} (${holder}) has uncommitted changes; commit or discard them before --adopt`);
          }
        }
        const worktree = holder ?? addTaskWorktree(deps, io.cwd, task, e.branch).worktree;
        let adopted = t;
        update(cur => {
          if (!cur) return null;
          const base = cur.tasks[task] ?? t;
          if (!adoptable(base)) throw notAdoptable(base);
          adopted = base;
          return {
            ...cur, ...(revived(cur) ? { active: true, stopReason: null, stallReason: null } : {}),
            tasks: { ...cur.tasks, [task]: { ...base, status: 'running', stage: 'implement', executor: 'subagents', worktree, attempts: base.attempts + 1, nudgedAt: null, finishedAt: iso, updatedAt: iso, stageSince: iso } },
          };
        });
        writePublicTask(io.cwd, { task, runId: e.runId, stage: 'implement', status: 'running', agent: null, round: adopted.round, since: iso, updatedAt: iso, leaseUntil: new Date(now.getTime() + LEASE_MINUTES * 60000).toISOString(), by: e.coordinator, mode: 'subagents' });
        return json({ task, adopted: true, previous: adopted.executor, worktree, branch: t.branch });
      }
      const retryable = (x: ExecTask | undefined): x is ExecTask => !!x && (x.status === 'conflict' || x.status === 'blocked');
      if (!retryable(t)) throw new UsageError(`swarm retry: ${task} is not in conflict or blocked`);
      update(cur => {
        if (!cur) return null;
        const base = cur.tasks[task] ?? t;
        if (!retryable(base)) throw new UsageError(`swarm retry: ${task} is not in conflict or blocked`);
        return {
          ...cur, ...(revived(cur) ? { active: true, stopReason: null, stallReason: null } : {}),
          tasks: { ...cur.tasks, [task]: { ...base, status: 'running', stage: 'implement', attempts: base.attempts + 1, detail: null, finishedAt: null, updatedAt: iso, stageSince: iso } },
        };
      });
      return ok();
    }
    case 'relaunch':
    case 'nudge': {
      const task = taskArg();
      const e = current();
      const t = e.tasks[task];
      if (!t || t.status !== 'running' || t.executor !== 'sessions') throw new UsageError(`swarm ${sub}: ${task} is not a running sessions task`);
      const planArg = flag('plan');
      if (has('plan') && (!planArg || planArg.startsWith('-'))) throw new UsageError(`swarm ${sub}: --plan needs a file`);
      if (planArg) {
        const isFile = (() => { try { return statSync(path.resolve(io.cwd, planArg)).isFile(); } catch { return false; } })();
        if (planArg.startsWith('-') || !isFile) throw new UsageError(`swarm ${sub}: --plan ${planArg} is not a plan file`);
      }
      if (sub === 'nudge') {
        // The text (and so the plan) is read before anything is saved.
        const es = (planArg ? loadPlanArg(io, planArg, 'nudge').locale : planLocale(io.cwd, e.project)) === 'es';
        const text = es ? `[forge run] ${task}: continúa con ${t.stage}; si estás bloqueado, márcalo como bloqueado`
          : `[forge run] ${task}: continue with ${t.stage}; if you are blocked, mark it blocked`;
        update(cur => cur && { ...cur, tasks: { ...cur.tasks, [task]: { ...(cur.tasks[task] ?? t), nudgedAt: iso } } });
        return json({ task, name: `wp-${e.project}-${task}`, text });
      }
      const planPath = planArg;
      if (!planPath) throw new UsageError('swarm relaunch: --plan is required');
      // The cap and the reason live in schedule.ts: one rule for the scheduler and this command.
      const verdict = relaunchOrBlock(task, t.attempts);
      if (verdict.type === 'block') {
        update(cur => cur && { ...cur, tasks: { ...cur.tasks, [task]: { ...(cur.tasks[task] ?? t), status: 'blocked', detail: verdict.reason, updatedAt: iso, finishedAt: iso } } });
        return json({ task, blocked: true, reason: verdict.reason });
      }
      const attempt = verdict.attempt;
      const log = deps.git(['log', '--oneline', '-n', '20', `${e.branch}..${t.branch}`])?.trim();
      const commits = log ? log.split(/\r?\n/).map(l => `  - ${l}`).join('\n') : '  - none';
      const note = path.join(io.cwd, '.forge', 'work', task, 'handover.md');
      // A run member keeps its work files (brief-<n>.md, report-<n>.txt, validators-<n>.json, reviews-<n>-<round>/)
      // in .forge/work/<T>/ of its own task worktree, where it runs; only this note lives in the main checkout.
      const memberWork = path.join(t.worktree || taskWorktree(io.cwd, task), '.forge', 'work', task);
      mkdirSync(path.dirname(note), { recursive: true });
      writeFileSync(note, [
        `# Handover: ${task} (attempt ${attempt} of ${RELAUNCH_CAP + 1})`, '',
        `- Run: ${e.runId} · coordinator ${e.coordinator} · run branch ${e.branch}`,
        `- Last stage: ${t.stage} · round ${t.round} · agent ${t.agent ?? 'none'} · since ${t.stageSince}`,
        `- Detail: ${t.detail ?? 'none'}`,
        `- Commits on ${t.branch} not yet on ${e.branch}:`, commits, '',
        `- This note: ${note} (main checkout ${io.cwd})`,
        `- Work files of the earlier attempts: ${memberWork} (the brief is brief-<n>.md there, with report-<n>.txt, validators-<n>.json and reviews-<n>-<round>/)`, '',
        `Resume from ${t.branch} in this worktree: read the brief in ${memberWork} if it exists (else write it as the brief stage says), do not redo a step whose output file is already written, and continue from the last stage.`, '',
      ].join('\n'));
      update(cur => cur && { ...cur, tasks: { ...cur.tasks, [task]: { ...(cur.tasks[task] ?? t), attempts: attempt, startedAt: iso, nudgedAt: null, updatedAt: iso } } });
      return json({ task, attempt, note, launch: memberLaunch(io.cwd, planPath, task, e) });
    }
    case 'sleep': {
      const seconds = Number(rest[0]);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SLEEP_S) throw new UsageError(`swarm sleep: seconds must be an integer from 1 to ${MAX_SLEEP_S}`);
      const e = current();
      const until = new Date(now.getTime() + seconds * 1000).toISOString();
      update(cur => cur && { ...cur, sleepUntil: until });
      if (has('mark')) return ok();
      (io.sleep ?? sleepSync)(seconds * 1000);
      // A newer sleep (or a --mark) may have replaced it meanwhile: only clear the value this call set.
      const after = readExecution(io.cwd);
      if (after && after.sleepUntil === until) update(cur => (cur && cur.sleepUntil === until ? { ...cur, sleepUntil: null } : null));
      // The coordinator wakes on this output: it repeats the language to answer in, when one is known.
      const run = parseRun(readRunText(io.cwd));
      const reply = sessionReply(run?.active ? run : null, after ?? e, () => planLocale(io.cwd, e.project));
      return reply ? { code: 0, stdout: `woke.${reply}\n`, stderr: '' } : ok();
    }
    case 'stop': {
      const reason = flag('reason') ?? 'stopped';
      if (reason !== 'stopped' && reason !== 'budget') throw new UsageError('swarm stop: --reason must be stopped or budget');
      const e = readExecution(io.cwd);
      if (e?.active) update(cur => (cur?.active ? { ...cur, active: false, stopReason: reason, sleepUntil: null } : null));
      return ok();
    }
    case 'close': {
      // C2: closes an ended execution of the main checkout, from any worktree. It never touches git, worktrees,
      // branches or live/: /forge:stop releases the tasks it lists and publishes meta/run. K2-02: like forge stop, it
      // removes the member files of the run and lists them in `sessions`, so /forge:stop messages a stalled run's members
      // too; after forge stop there are none left.
      const main = mainCheckout(io.cwd);
      const e = readExecution(main);
      if (!e) throw new UsageError('swarm close: no execution');
      if (e.active) throw new UsageError(`swarm close: the execution ${e.runId} is active; stop it first (/forge:stop)`);
      if (e.closedAt) return json({ closed: 'already', runId: e.runId, closedAt: e.closedAt, closedBy: e.closedBy ?? null });
      closeEnded(main, iso, 'close', lockDeps);
      // K2-02: forge stop leaves the tasks it stopped as stopped: they are released like running ones.
      const open = Object.entries(e.tasks).filter(([, t]) => t.status === 'running' || t.status === 'stopped');
      const sessions = listMembers(main, e.runId).map(m => ({ sessionId: m.sessionId, name: m.name, role: m.role, task: m.task }));
      for (const m of sessions) rmSync(memberFile(main, m.sessionId), { force: true });
      return json({
        closed: true, runId: e.runId, kind: e.kind, stopReason: e.stopReason, closedAt: iso,
        // The coordinator's own tasks go back to free on the roadmap; a member's task stays with its session.
        // A loose task has no state/T to free, so an ephemeral run releases nothing.
        release: e.kind !== 'plan' ? [] : open.filter(([, t]) => t.executor === 'subagents').map(([id]) => id),
        members: open.filter(([, t]) => t.executor !== 'subagents').map(([id]) => id),
        sessions,
      });
    }
    case 'takeover': {
      const hook = claudeSessionId(flag('hook-session'), io.env ?? process.env);
      if (!hook) throw new UsageError(noClaudeSession('swarm takeover', '--hook-session'));
      const session = flag('session');
      if (!session) throw new UsageError('swarm takeover: --session is required');
      if (!isMemberId(session)) throw new UsageError(`swarm takeover: --session ${session.slice(0, 130)} is not a valid session id (letters, digits, _ - .; max 120)`);
      const e = current();
      if (!e.active) throw new UsageError('swarm takeover: the execution is not active');
      // --session is the waypoint SID that becomes the coordinator; --hook-session is Claude's id of this session, bound
      // at once, so its Stop hook steps the execution from now on (C1).
      if (session === e.coordinator || hook === e.hookSession) {
        if (e.coordinator !== session || e.hookSession !== hook) update(cur => cur && { ...cur, coordinator: session, hookSession: hook });
        return json({ took: 'already', runId: e.runId });
      }
      // A run member keeps its role: it would otherwise coordinate the task it executes.
      if (readMember(io.cwd, session)?.runId === e.runId) throw new UsageError(`swarm takeover: ${session} is a member of the execution ${e.runId}; a run member cannot take over the coordinator`);
      const previous = e.hookSession ?? e.coordinator;
      // The liveliest of the local signal and the roadmap lease decides; with neither, the last step does.
      // A previous id outside the safe rule names no file: it counts as having no signal and no lease.
      const order = ['stopped', 'silent', 'alive'] as const;
      const seen: (typeof order)[number][] = [];
      if (isSafeId(previous)) try {
        const d = normalizeLive(JSON.parse(readFileSync(liveFile(io.cwd, previous), 'utf8')));
        if (d) seen.push(signalLiveness(d.ts, d.ended, now.getTime()));
      } catch { /* no signal */ }
      // The signal is keyed by the hook id; the roadmap lease by the coordinator's waypoint SID.
      if (flag('db') && isSafeId(e.coordinator)) {
        try { seen.push(sessionLiveness(JSON.parse(readFileSync(path.resolve(io.cwd, flag('db')!, 'sessions', `${e.coordinator}.json`), 'utf8')) as SessionDoc, now.getTime())); } catch { /* no lease */ }
      }
      if (!seen.length) seen.push(now.getTime() - Date.parse(e.lastStepAt ?? e.startedAt) >= TAKEOVER_MIN * 60000 ? 'stopped' : 'alive');
      const liveness = seen.reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a), 'stopped' as (typeof order)[number]);
      if (liveness !== 'stopped') return json({ took: false, previous, liveness, joinAs: 'manual' });
      update(cur => cur && { ...cur, coordinator: session, hookSession: hook, sleepUntil: null });
      // The user asked this session to go on: their decision, recorded in the decision format (by: user).
      appendEvent(io.cwd, { ts: iso, kind: 'decision', point: 'takeover', what: 'takeover', chosen: session, why: `the coordinator ${previous} stopped`, by: 'user', weight: 'minor', previous, session, runId: e.runId });
      return json({ took: true, previous, runId: e.runId, running: Object.entries(e.tasks).filter(([, t]) => t.status === 'running').map(([id]) => id) });
    }
    case 'step':
      // D-12: cli/step.ts, given by run.ts (it calls the CLI itself: no import of run.ts here).
      if (!ext.step) throw new UsageError('swarm step: not available here');
      return ext.step(rest);
    case 'integrate':
      return integrate(rest, io, deps);
    case 'merge':
      return mergeFinal(rest, io, deps);
    default:
      throw new UsageError('usage: forge swarm <start --project P --session SID --hook-session ID [--mode M] [--parallel N] [--merge-on-finish] [--branch B] [--kind plan|ephemeral] [--tasks F] [--locale CODE]|status|propose --plan P|--tasks F [--locale es|en]|worktree <T>|task <T> --stage S [--agent A|--no-agent] [--round N] [--status S] [--detail-file F] [--lease ISO]|task <T> --drop|tick [--plan P --db DIR] [--agents F]|step --plan P --db DIR [--agents F] [--returned T1,T2] [--versions F] [--locale es|en]|relaunch <T> --plan P|nudge <T> [--plan P]|integrate <T> [--locale es|en] [--retry-deps] [--no-cache]|merge [--yes] [--locale es|en] [--retry-deps]|retry <T> [--adopt]|sleep <seconds> [--mark]|stop [--reason stopped|budget]|close|join --session SID --role executor|manual [--task T] [--name N] [--hook-session ID]|report <T> --session SID --stage S [--agent A|--no-agent] [--round N] [--status S] [--lease ISO]|worktree <T> --member SID|next --plan P --db DIR --session SID|takeover --session SID --hook-session ID [--db DIR]>');
  }
}
