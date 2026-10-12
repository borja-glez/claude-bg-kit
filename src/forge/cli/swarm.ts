import { existsSync, statSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './errors.js';
import type { ExecResult, Io } from './run.js';
import { detectValidators, selectValidators, runValidators, markPreexisting, blocking, type RepoReader, type ValidatorResult } from '../validators.js';
import { loadConfig } from '../config.js';
import { stopFile } from '../run.js';
import { appendEvent } from '../ledger.js';
import { readExecution, saveExecution, writePublicTask, executionTaskFile, runBranch, taskBranch, runWorktree, taskWorktree } from '../execution.js';
import { schedule, widthOf, relaunchOrBlock, RELAUNCH_CAP, type BgAgent } from '../schedule.js';
import { LEASE_MINUTES } from '../../lib/coordination.js';
import { planLocale } from '../../lib/locale.js';
import { STAGES, normalizePublicTask, type ExecutionState, type ExecTask, type PublicTask } from '../../lib/execution-state.js';
import { parsePlan, PlanError, isPlanId } from '../../lib/plan.js';
import type { SessionDoc, Stage, TaskState } from '../../lib/types.js';
import { mainWorktreeFrom, samePath } from '../../lib/worktree.js';

export interface GitDeps { git: (args: string[]) => string | null; exec: (cmd: string, timeoutSec: number) => ExecResult; repo: RepoReader }
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

const VENV_HINT = 'python project: set swarm.setup in .forge/config.yaml to create the venv in each worktree';
export type SetupPlan = { cmd: string } | { cmd: null; hint: string } | null;
export type SetupResult = { cmd: string | null; ok: boolean; tail: string[] } | null;

/** What prepares a new worktree: swarm.setup, else the install command of the main checkout's lockfile. */
export function setupFor(repo: RepoReader, configured: string | undefined): SetupPlan {
  if (configured) return { cmd: configured };
  if (repo.exists('.venv')) return { cmd: null, hint: VENV_HINT };
  if (repo.exists('package-lock.json')) return { cmd: 'npm ci' };
  if (repo.exists('pnpm-lock.yaml')) return { cmd: 'pnpm install --frozen-lockfile' };
  if (repo.exists('yarn.lock')) return { cmd: 'yarn install --frozen-lockfile' };
  return null;
}

/** Runs the setup in a worktree just created; a failure is reported, never thrown. */
function runSetup(deps: SwarmDeps, dir: string, root: string): SetupResult {
  const config = loadConfig(root);
  const plan = setupFor(deps.repo, config.swarm.setup);
  if (!plan) return null;
  if (plan.cmd === null) return { cmd: null, ok: false, tail: [plan.hint] };
  const r = deps.at(dir).exec(plan.cmd, config.validatorTimeoutSec);
  return { cmd: plan.cmd, ok: r.code === 0 && !r.timedOut, tail: r.output.split(/\r?\n/).filter(l => l.trim()).slice(-20) };
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

// Blocks the process for ms without spinning; the coordinator runs `swarm sleep` in the background.
const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function loadPlanArg(io: Io, planArg: string | undefined, sub: string) {
  if (!planArg) throw new UsageError(`swarm ${sub}: --plan is required`);
  try { return parsePlan(readFileSync(path.resolve(io.cwd, planArg), 'utf8')); } catch (e) {
    throw new UsageError(e instanceof PlanError ? `${planArg}: ${e.issues.join('; ')}` : `swarm ${sub}: cannot read ${planArg}`);
  }
}

const LOCAL_STATE = [':!.forge', ':!.waypoint', ':!.claude'];

type MergeOutcome = { result: 'merged'; sha: string; preexisting: string[] } | { result: 'dirty' | 'conflict'; detail: string };

// A baseline is only valid for the same scope and target (worktree, config and environment differ between them).
const baselineFile = (cacheDir: string, key: string, sha: string) => path.join(cacheDir, 'baseline', `${key}-${sha}.json`);
function readBaseline(cacheDir: string, key: string, sha: string): unknown {
  try { return JSON.parse(readFileSync(baselineFile(cacheDir, key, sha), 'utf8')); } catch { return null; }
}
const timedOut = (results: unknown) => Array.isArray(results) && results.some(r => Array.isArray(r?.failures) && r.failures.some((f: unknown) => typeof f === 'string' && f.startsWith('timeout after')));
function writeBaseline(cacheDir: string, key: string, sha: string, results: unknown): void {
  if (timedOut(results)) return; // a timeout says nothing about the tip: never cache it
  try { mkdirSync(path.join(cacheDir, 'baseline'), { recursive: true }); writeFileSync(baselineFile(cacheDir, key, sha), JSON.stringify(results)); } catch { /* a missing cache only costs a rerun */ }
}

/**
 * Merges `ref` into the branch checked out at `at` with --no-ff, runs the validators there and commits `message`.
 * A conflict or a red validator is rolled back to the pre-merge sha; a merge left half-done is never touched.
 */
function mergeIn(at: GitDeps, ref: string, message: string, scope: 'heavy' | 'final', timeoutSec: number, configRoot: string, cacheDir: string, target: 'run' | 'main'): MergeOutcome {
  const key = `${scope}-${target}`;
  const merging = () => at.git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']) !== null;
  if (merging()) return { result: 'dirty', detail: 'an unfinished merge is in progress there (git merge --abort to clear it)' };
  const dirty = at.git(['status', '--porcelain', '--', '.', ...LOCAL_STATE]);
  if (dirty === null || dirty.trim() !== '') return { result: 'dirty', detail: 'it has uncommitted changes' };
  if (at.git(['rev-parse', '--verify', '-q', `${ref}^{commit}`]) === null) return { result: 'conflict', detail: `unknown ref ${ref}` };
  const pre = at.git(['rev-parse', 'HEAD'])?.trim();
  if (!pre) return { result: 'conflict', detail: 'cannot read HEAD' };
  const rollback = (detail: string): MergeOutcome => {
    const undone = at.git(['merge', '--abort']) !== null;
    const clean = undone && at.git(['rev-parse', 'HEAD'])?.trim() === pre && !merging();
    return { result: 'conflict', detail: clean ? detail : `rollback failed: needs manual attention (${detail})` };
  };
  // What the target's tip already fails is not caused by this merge: validators red there are "preexisting".
  let baseline: unknown = readBaseline(cacheDir, key, pre);
  if (baseline === null) {
    try {
      const config0 = loadConfig(configRoot);
      baseline = runValidators(selectValidators(detectValidators(at.repo, config0), scope === 'final' ? { mode: 'final' } : { mode: 'heavy', changed: null }), at.exec, timeoutSec);
      writeBaseline(cacheDir, key, pre, baseline);
    } catch { baseline = []; }
    const left = at.git(['status', '--porcelain', '--', '.', ...LOCAL_STATE]);
    if (left === null || left.trim() !== '') return { result: 'dirty', detail: `the validators left changes in the worktree: ${(left ?? '').split(/\r?\n/).filter(Boolean).slice(0, 5).join(', ')}` };
  }
  if (at.git(['merge', '--no-ff', '--no-commit', ref]) === null) {
    if (!merging()) return { result: 'conflict', detail: `git refused to merge ${ref}` };
    return rollback(`merge conflict with ${ref}`);
  }
  if (!merging()) return { result: 'merged', sha: pre, preexisting: [] };
  let results: ValidatorResult[];
  try {
    const config = loadConfig(configRoot);
    results = markPreexisting(runValidators(selectValidators(detectValidators(at.repo, config), scope === 'final' ? { mode: 'final' } : { mode: 'heavy', changed: null }), at.exec, timeoutSec), baseline);
  } catch (err) {
    return rollback(`validators could not run: ${(err as Error).message}`);
  }
  const failed = results.filter(blocking);
  if (failed.length) return rollback(`validators failed after merging ${ref}: ${failed.map(r => r.validator).join(', ')}`);
  if (at.git(['commit', '--no-edit', '-m', message]) === null || merging()) return rollback(`could not commit the merge of ${ref}`);
  const sha = at.git(['rev-parse', 'HEAD'])?.trim() ?? '';
  if (!sha || sha === pre) return rollback(`could not commit the merge of ${ref}`);
  writeBaseline(cacheDir, key, sha, results);
  return { result: 'merged', sha, preexisting: results.filter(r => r.preexisting).map(r => r.validator) };
}

function integrate(rest: string[], io: Io, deps: SwarmDeps): Result {
  const task = rest[0];
  if (!task || !isPlanId(task)) throw new UsageError('swarm integrate: a task id is required');
  const e = readExecution(io.cwd);
  if (!e) throw new UsageError('swarm integrate: no execution (forge swarm start)');
  const t = e.tasks[task];
  if (!t || t.status !== 'accepted') throw new UsageError(`swarm integrate: ${task} is not accepted`);
  const at = io.now().toISOString();
  const out = (v: unknown): Result => ({ code: 0, stdout: JSON.stringify(v) + '\n', stderr: '' });
  const wt = e.kind === 'plan' ? runWorktree(io.cwd) : io.cwd;
  const target = deps.at(wt);
  if (e.kind === 'plan') {
    const head = target.git(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
    if (head !== e.branch) return out({ result: 'run-dirty', detail: `${wt} is on ${head ?? '?'}, not ${e.branch}` });
  }
  const config = loadConfig(io.cwd);
  const r = mergeIn(target, t.branch, `forge: integrate ${task}`, 'heavy', config.validatorTimeoutSec, wt, path.join(io.cwd, '.forge', 'execution'), 'run');
  const cur = readExecution(io.cwd)!;
  if (r.result === 'dirty') return out({ result: 'run-dirty', detail: r.detail });
  const next: ExecTask = r.result === 'merged'
    ? { ...cur.tasks[task], status: 'integrated', stage: 'integrate', updatedAt: at, detail: null }
    : { ...cur.tasks[task], status: 'conflict', detail: r.detail, updatedAt: at };
  saveExecution(io.cwd, { ...cur, tasks: { ...cur.tasks, [task]: next } });
  return out(r.result === 'merged' ? { result: 'integrated', sha: r.sha, preexisting: r.preexisting } : { result: 'conflict', detail: r.detail });
}

function mergeFinal(rest: string[], io: Io, deps: SwarmDeps): Result {
  const e = readExecution(io.cwd);
  if (!e) throw new UsageError('swarm merge: no execution (forge swarm start)');
  const out = (v: unknown): Result => ({ code: 0, stdout: JSON.stringify(v) + '\n', stderr: '' });
  if (e.kind !== 'plan') return out({ result: 'merged', sha: deps.git(['rev-parse', 'HEAD'])?.trim() ?? '' });
  if (!e.mergeOnFinish && !rest.includes('--yes')) return out({ result: 'needs-authorization' });
  const branch = deps.git(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
  if (branch !== e.base) return out({ result: 'main-dirty', detail: `the main checkout is on ${branch ?? '?'}, not ${e.base}` });
  const config = loadConfig(io.cwd);
  const r = mergeIn(deps, e.branch, `forge: merge ${e.branch}`, 'final', config.validatorTimeoutSec, io.cwd, path.join(io.cwd, '.forge', 'execution'), 'main');
  if (r.result === 'dirty') return out({ result: 'main-dirty', detail: `the main checkout ${r.detail}` });
  return out(r.result === 'merged' ? { result: 'merged', sha: r.sha, preexisting: r.preexisting } : { result: 'conflict', detail: r.detail });
}

export function swarmCommand(args: string[], io: Io, deps: SwarmDeps): Result {
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
  if (['start', 'tick', 'integrate', 'merge', 'sleep', 'worktree', 'retry', 'relaunch', 'nudge'].includes(sub ?? '')) {
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

  switch (sub) {
    case 'start': {
      const project = flag('project');
      const session = flag('session');
      if (!project || !ID.test(project) || !session || !ID.test(session)) throw new UsageError('swarm start: --project and --session are required');
      const config = loadConfig(io.cwd);
      let parallel = config.swarm.parallel;
      if (has('parallel')) {
        const v = Number(flag('parallel'));
        if (!Number.isInteger(v) || v < 1 || v > 10) throw new UsageError('swarm start: --parallel must be an integer from 1 to 10');
        parallel = v;
      }
      const mode = flag('mode') ?? config.swarm.mode ?? 'subagents';
      if (mode !== 'subagents' && mode !== 'sessions') throw new UsageError('swarm start: --mode must be subagents or sessions');
      const kind = flag('kind') ?? 'plan';
      if (kind !== 'plan' && kind !== 'ephemeral') throw new UsageError('swarm start: --kind must be plan or ephemeral');
      const base = deps.git(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
      if (!base || base === 'HEAD') throw new UsageError('swarm start: the main checkout must be on a branch');
      const prev = readExecution(io.cwd);
      if (prev?.active && prev.coordinator !== session) {
        const last = Date.parse(prev.lastStepAt ?? prev.startedAt);
        if (now.getTime() - last < TAKEOVER_MIN * 60000) throw new UsageError(`swarm start: coordinator ${prev.coordinator} is active (last step ${prev.lastStepAt ?? prev.startedAt})`);
      }
      const branch = flag('branch') ?? runBranch(project);
      if (!/^[A-Za-z0-9_./][A-Za-z0-9_\-./]{0,119}$/.test(branch) || branch.includes('..')) throw new UsageError('swarm start: --branch is not a valid branch name');
      let setup: SetupResult = null;
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
        if (deps.git(['rev-parse', '--verify', '-q', `refs/heads/${branch}`]) === null && deps.git(['branch', branch, base]) === null) {
          throw new UsageError(`swarm start: cannot create ${branch} from ${base}`);
        }
        if (!existsSync(wt)) {
          if (deps.git(['worktree', 'add', wt, branch]) === null) throw new UsageError(`swarm start: cannot add the worktree ${wt}`);
          setup = runSetup(deps, wt, io.cwd);
        }
      }
      const resume = prev && prev.active && prev.project === project && prev.branch === (kind === 'plan' ? branch : base);
      const state: ExecutionState = resume
        ? { ...prev, parallel, mode, mergeOnFinish: prev.mergeOnFinish || has('merge-on-finish'), coordinator: session, hookSession: null, sleepUntil: null }
        : {
            runId: `${project}-${iso.replace(/[:.]/g, '')}`, kind, mode, parallel, project, base, branch: kind === 'plan' ? branch : base,
            mergeOnFinish: has('merge-on-finish'), coordinator: session, hookSession: null, active: true, stopReason: null, stallReason: null,
            startedAt: iso, lastStepAt: null, lastBlockStep: null, sleepUntil: null, tasks: {},
          };
      rmSync(stopFile(io.cwd), { force: true });
      saveExecution(io.cwd, state);
      return json({ ...state, setup });
    }
    case 'status': {
      const state = readExecution(io.cwd);
      return json({ present: state !== null, state });
    }
    case 'propose': {
      const plan = loadPlanArg(io, flag('plan'), 'propose');
      const width = widthOf(plan);
      const config = loadConfig(io.cwd);
      const configured = config.swarm.mode ?? null;
      const parallel = width < 2 ? 1 : Math.min(config.swarm.parallel, width);
      const reasons = [`${plan.tasks.length} tasks`, `up to ${width} at once (dependencies and zones)`];
      return json({ width, configured, recommended: { mode: 'subagents', parallel }, reasons });
    }
    case 'worktree': {
      const task = taskArg();
      const e = current();
      const dir = taskWorktree(io.cwd, task);
      const branch = taskBranch(task);
      let setup: SetupResult = null;
      if (!existsSync(dir)) {
        const exists = deps.git(['rev-parse', '--verify', '-q', `refs/heads/${branch}`]) !== null;
        const added = exists ? deps.git(['worktree', 'add', dir, branch]) : deps.git(['worktree', 'add', '-b', branch, dir, e.branch]);
        if (added === null) throw new UsageError(`swarm worktree: cannot add ${dir} for ${branch}`);
        setup = runSetup(deps, dir, io.cwd);
      }
      const base = deps.at(dir).git(['rev-parse', 'HEAD'])?.trim() ?? null;
      const t: ExecTask = e.tasks[task] ?? { status: 'running', stage: 'brief', round: 0, worktree: dir, branch, executor: e.mode, attempts: 0, agent: null, startedAt: iso, stageSince: iso, updatedAt: iso, detail: null };
      saveExecution(io.cwd, { ...e, tasks: { ...e.tasks, [task]: { ...t, worktree: dir, branch, updatedAt: iso } } });
      return json({ worktree: dir, branch, base, setup });
    }
    case 'task': {
      const task = taskArg();
      const e = current();
      const prev = e.tasks[task];
      if (!prev) throw new UsageError(`swarm task: ${task} is not part of this execution`);
      if (has('drop')) {
        // A claim race lost to another session: forget the task so the next tick sees that session's claim.
        const { [task]: _dropped, ...tasks } = e.tasks;
        saveExecution(io.cwd, { ...e, tasks });
        rmSync(executionTaskFile(io.cwd, task), { force: true });
        return ok();
      }
      const stage = (flag('stage') ?? prev.stage) as Stage;
      if (!STAGES.includes(stage)) throw new UsageError(`swarm task: --stage must be one of ${STAGES.join('|')}`);
      const status = (flag('status') ?? prev.status) as ExecTask['status'];
      if (!['running', 'accepted', 'blocked'].includes(status) && status !== prev.status) throw new UsageError('swarm task: --status must be running, accepted or blocked');
      let detail = prev.detail;
      if (flag('detail-file')) {
        try { detail = readFileSync(path.resolve(io.cwd, flag('detail-file')!), 'utf8').trim().slice(0, 500) || null; } catch { throw new UsageError('swarm task: cannot read --detail-file'); }
      }
      const round = has('round') ? Number(flag('round')) : prev.round;
      if (!Number.isInteger(round) || round < 0 || round > 99) throw new UsageError('swarm task: --round must be an integer from 0 to 99');
      const agent = has('no-agent') ? null : (flag('agent') ?? prev.agent);
      const stageSince = prev.stage !== stage ? iso : prev.stageSince;
      const next: ExecTask = { ...prev, stage, status, round, agent, detail, updatedAt: iso, stageSince };
      saveExecution(io.cwd, { ...e, tasks: { ...e.tasks, [task]: next } });
      const lease = flag('lease') && !Number.isNaN(Date.parse(flag('lease')!)) ? flag('lease')! : new Date(now.getTime() + LEASE_MINUTES * 60000).toISOString();
      writePublicTask(io.cwd, { task, runId: e.runId, stage, status, agent, round, since: stageSince, updatedAt: iso, leaseUntil: lease, by: e.coordinator, mode: prev.executor });
      if (prev.stage !== stage) appendEvent(io.cwd, { ts: iso, kind: 'phase', task, phase: stage });
      return json(next);
    }
    case 'tick': {
      const e = current();
      if (!e.active) throw new UsageError('swarm tick: the execution is not active');
      const plan = loadPlanArg(io, flag('plan'), 'tick');
      const db = flag('db');
      if (!db) throw new UsageError('swarm tick: --plan and --db are required');
      const stateDir = path.resolve(io.cwd, db, 'state');
      const sessionsDir = path.resolve(io.cwd, db, 'sessions');
      // Missing listings would make every task look free: refuse instead.
      if (!existsSync(stateDir) || !existsSync(sessionsDir)) throw new UsageError('swarm tick: --db must hold the state and sessions listings');
      const states = readDocs<TaskState>(stateDir);
      const sessions = readDocs<SessionDoc>(sessionsDir);
      const integrated: string[] = [];
      for (const t of plan.tasks) {
        if (states[t.id]?.status !== 'done') continue;
        for (const c of states[t.id]?.commits ?? []) {
          if (typeof c?.sha === 'string' && ID.test(c.sha) && deps.git(['merge-base', '--is-ancestor', c.sha, e.branch]) !== null) integrated.push(c.sha);
        }
      }
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
      const d = schedule({ plan, states, sessions, exec: e, integrated, now: now.getTime(), publicTasks, agents });
      saveExecution(io.cwd, d.next);
      return json({ actions: d.actions, running: Object.values(d.next.tasks).filter(t => t.status === 'running').length, parallel: e.parallel });
    }
    case 'retry': {
      const task = taskArg();
      const e = current();
      const t = e.tasks[task];
      if (!t || (t.status !== 'conflict' && t.status !== 'blocked')) throw new UsageError(`swarm retry: ${task} is not in conflict or blocked`);
      const revive = !e.active && e.stopReason === 'stalled';
      saveExecution(io.cwd, {
        ...e, ...(revive ? { active: true, stopReason: null, stallReason: null } : {}),
        tasks: { ...e.tasks, [task]: { ...t, status: 'running', stage: 'implement', attempts: t.attempts + 1, detail: null, updatedAt: iso, stageSince: iso } },
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
        saveExecution(io.cwd, { ...e, tasks: { ...e.tasks, [task]: { ...t, nudgedAt: iso } } });
        return json({ task, name: `wp-${e.project}-${task}`, text });
      }
      const planPath = planArg;
      if (!planPath) throw new UsageError('swarm relaunch: --plan is required');
      // The cap and the reason live in schedule.ts: one rule for the scheduler and this command.
      const verdict = relaunchOrBlock(task, t.attempts);
      if (verdict.type === 'block') {
        saveExecution(io.cwd, { ...e, tasks: { ...e.tasks, [task]: { ...t, status: 'blocked', detail: verdict.reason, updatedAt: iso } } });
        return json({ task, blocked: true, reason: verdict.reason });
      }
      const attempt = verdict.attempt;
      const log = deps.git(['log', '--oneline', '-n', '20', `${e.branch}..${t.branch}`])?.trim();
      const commits = log ? log.split(/\r?\n/).map(l => `  - ${l}`).join('\n') : '  - none';
      const note = path.join(io.cwd, '.forge', 'work', task, 'handover.md');
      mkdirSync(path.dirname(note), { recursive: true });
      writeFileSync(note, [
        `# Handover: ${task} (attempt ${attempt} of ${RELAUNCH_CAP + 1})`, '',
        `- Run: ${e.runId} · coordinator ${e.coordinator} · run branch ${e.branch}`,
        `- Last stage: ${t.stage} · round ${t.round} · agent ${t.agent ?? 'none'} · since ${t.stageSince}`,
        `- Detail: ${t.detail ?? 'none'}`,
        `- Commits on ${t.branch} not yet on ${e.branch}:`, commits, '',
        `Resume from ${t.branch} in this worktree: read .forge/work/${task}/task.json if it exists, do not redo a step whose output file is already written, and continue from the last stage.`, '',
      ].join('\n'));
      saveExecution(io.cwd, { ...e, tasks: { ...e.tasks, [task]: { ...t, attempts: attempt, startedAt: iso, nudgedAt: null, updatedAt: iso } } });
      return json({ task, attempt, note, launch: ['launch', planPath, task, '--task', '--run', e.runId, '--coordinator', e.coordinator, '--base', e.branch] });
    }
    case 'sleep': {
      const seconds = Number(rest[0]);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SLEEP_S) throw new UsageError(`swarm sleep: seconds must be an integer from 1 to ${MAX_SLEEP_S}`);
      const e = current();
      const until = new Date(now.getTime() + seconds * 1000).toISOString();
      saveExecution(io.cwd, { ...e, sleepUntil: until });
      if (has('mark')) return ok();
      (io.sleep ?? sleepSync)(seconds * 1000);
      // A newer sleep (or a --mark) may have replaced it meanwhile: only clear the value this call set.
      const after = readExecution(io.cwd);
      if (after && after.sleepUntil === until) saveExecution(io.cwd, { ...after, sleepUntil: null });
      return ok();
    }
    case 'stop': {
      const reason = flag('reason') ?? 'stopped';
      if (reason !== 'stopped' && reason !== 'budget') throw new UsageError('swarm stop: --reason must be stopped or budget');
      const e = readExecution(io.cwd);
      if (e?.active) saveExecution(io.cwd, { ...e, active: false, stopReason: reason, sleepUntil: null });
      return ok();
    }
    case 'integrate':
      return integrate(rest, io, deps);
    case 'merge':
      return mergeFinal(rest, io, deps);
    default:
      throw new UsageError('usage: forge swarm <start --project P --session SID [--mode M] [--parallel N] [--merge-on-finish] [--branch B] [--kind plan|ephemeral]|status|propose --plan P|worktree <T>|task <T> --stage S [--agent A|--no-agent] [--round N] [--status S] [--detail-file F] [--lease ISO]|task <T> --drop|tick --plan P --db DIR [--agents F]|relaunch <T> --plan P|nudge <T> [--plan P]|integrate <T>|merge|retry <T>|sleep <seconds> [--mark]|stop [--reason stopped|budget]>');
  }
}
