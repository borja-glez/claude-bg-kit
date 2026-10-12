import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './errors.js';
import type { ExecResult, Io } from './run.js';
import { detectValidators, selectValidators, runValidators, type RepoReader } from '../validators.js';
import { loadConfig } from '../config.js';
import { readSwarm, saveSwarm } from '../swarm.js';
import { stopFile } from '../run.js';
import { appendEvent } from '../ledger.js';
import { readExecution, saveExecution, writePublicTask, runBranch, taskBranch, runWorktree, taskWorktree } from '../execution.js';
import { schedule, widthOf } from '../schedule.js';
import { LEASE_MINUTES } from '../../lib/coordination.js';
import { STAGES, type ExecutionState, type ExecTask } from '../../lib/execution-state.js';
import { emptyFront } from '../../lib/swarm-state.js';
import { parsePlan, PlanError } from '../../lib/plan.js';
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

// Blocks the process for ms without spinning; the coordinator runs `swarm sleep` in the background.
const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function loadPlanArg(io: Io, planArg: string | undefined, sub: string) {
  if (!planArg) throw new UsageError(`swarm ${sub}: --plan is required`);
  try { return parsePlan(readFileSync(path.resolve(io.cwd, planArg), 'utf8')); } catch (e) {
    throw new UsageError(e instanceof PlanError ? `${planArg}: ${e.issues.join('; ')}` : `swarm ${sub}: cannot read ${planArg}`);
  }
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
  if (['start', 'tick', 'integrate', 'merge', 'sleep', 'worktree', 'retry'].includes(sub ?? '')) {
    const top = deps.git(['rev-parse', '--show-toplevel'])?.trim();
    const main = mainWorktreeFrom(deps.git(['worktree', 'list', '--porcelain']));
    if (!top || !main || !samePath(top, main)) {
      throw new UsageError(`swarm ${sub}: run it from the main checkout${main ? ` (${main})` : ''}, not from a worktree`);
    }
  }
  const taskArg = () => {
    const t = rest[0];
    if (!t || !ID.test(t)) throw new UsageError(`swarm ${sub}: a task id is required`);
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
      if (!/^[A-Za-z0-9_\-./]{1,120}$/.test(branch) || branch.includes('..')) throw new UsageError('swarm start: --branch is not a valid branch name');
      if (kind === 'plan') {
        if (deps.git(['rev-parse', '--verify', '-q', `refs/heads/${branch}`]) === null && deps.git(['branch', branch, base]) === null) {
          throw new UsageError(`swarm start: cannot create ${branch} from ${base}`);
        }
        const wt = runWorktree(io.cwd);
        if (!existsSync(wt) && deps.git(['worktree', 'add', wt, branch]) === null) throw new UsageError(`swarm start: cannot add the worktree ${wt}`);
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
      return json(state);
    }
    case 'status': {
      const state = readExecution(io.cwd);
      return json({ present: state !== null, state });
    }
    case 'propose': {
      const plan = loadPlanArg(io, flag('plan'), 'propose');
      const width = widthOf(plan);
      const configured = loadConfig(io.cwd).swarm.mode ?? null;
      const parallel = width < 2 ? 1 : Math.min(3, width);
      const reasons = [`${plan.tasks.length} tasks`, `up to ${width} at once (dependencies and zones)`];
      return json({ width, configured, recommended: { mode: 'subagents', parallel }, reasons });
    }
    case 'worktree': {
      const task = taskArg();
      const e = current();
      const dir = taskWorktree(io.cwd, task);
      const branch = taskBranch(task);
      if (!existsSync(dir)) {
        const exists = deps.git(['rev-parse', '--verify', '-q', `refs/heads/${branch}`]) !== null;
        const added = exists ? deps.git(['worktree', 'add', dir, branch]) : deps.git(['worktree', 'add', '-b', branch, dir, e.branch]);
        if (added === null) throw new UsageError(`swarm worktree: cannot add ${dir} for ${branch}`);
      }
      const base = deps.at(dir).git(['rev-parse', 'HEAD'])?.trim() ?? null;
      const t: ExecTask = e.tasks[task] ?? { status: 'running', stage: 'brief', round: 0, worktree: dir, branch, executor: e.mode, attempts: 0, agent: null, startedAt: iso, updatedAt: iso, detail: null };
      saveExecution(io.cwd, { ...e, tasks: { ...e.tasks, [task]: { ...t, worktree: dir, branch, updatedAt: iso } } });
      return json({ worktree: dir, branch, base });
    }
    case 'task': {
      const task = taskArg();
      const e = current();
      const prev = e.tasks[task];
      if (!prev) throw new UsageError(`swarm task: ${task} is not part of this execution`);
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
      const next: ExecTask = { ...prev, stage, status, round, agent, detail, updatedAt: iso, ...(prev.stage !== stage ? { startedAt: prev.startedAt } : {}) };
      saveExecution(io.cwd, { ...e, tasks: { ...e.tasks, [task]: next } });
      const lease = flag('lease') && !Number.isNaN(Date.parse(flag('lease')!)) ? flag('lease')! : new Date(now.getTime() + LEASE_MINUTES * 60000).toISOString();
      writePublicTask(io.cwd, { task, runId: e.runId, stage, status, agent, round, since: prev.stage === stage ? prev.updatedAt : iso, updatedAt: iso, leaseUntil: lease, by: e.coordinator, mode: prev.executor });
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
      const d = schedule({ plan, states, sessions, exec: e, integrated, now: now.getTime() });
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
        tasks: { ...e.tasks, [task]: { ...t, status: 'running', stage: 'implement', attempts: t.attempts + 1, detail: null, updatedAt: iso } },
      });
      return ok();
    }
    case 'sleep': {
      const seconds = Number(rest[0]);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SLEEP_S) throw new UsageError(`swarm sleep: seconds must be an integer from 1 to ${MAX_SLEEP_S}`);
      const e = current();
      saveExecution(io.cwd, { ...e, sleepUntil: new Date(now.getTime() + seconds * 1000).toISOString() });
      if (has('mark')) return ok();
      (io.sleep ?? sleepSync)(seconds * 1000);
      const after = readExecution(io.cwd);
      if (after) saveExecution(io.cwd, { ...after, sleepUntil: null });
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
      throw new UsageError('usage: forge swarm <start --project P --session SID [--mode M] [--parallel N] [--merge-on-finish] [--branch B] [--kind plan|ephemeral]|status|propose --plan P|worktree <T>|task <T> --stage S [--agent A|--no-agent] [--round N] [--status S] [--detail-file F] [--lease ISO]|tick --plan P --db DIR|integrate <T>|merge|retry <T>|sleep <seconds> [--mark]|stop [--reason stopped|budget]>');
  }
}

// Temporary until Task 8 rewrites the final merge.
function mergeFinal(_rest: string[], _io: Io, _deps: SwarmDeps): Result {
  throw new UsageError('swarm merge: not implemented yet');
}

// Integration runs only in the main checkout, never in a track worktree, so it works while the front keeps working.
const LOCAL_STATE = [':!.forge', ':!.waypoint', ':!.claude'];
const REF = /^(track\/[A-Za-z0-9_\-.~:@+]{1,80}|[0-9a-f]{7,64})$/;

function integrate(rest: string[], io: Io, deps: GitDeps): Result {
  const track = rest[0];
  const i = rest.indexOf('--ref');
  const ref = i >= 0 ? rest[i + 1] : undefined;
  if (!track || !ID.test(track) || !ref || !REF.test(ref)) throw new UsageError('swarm integrate: <track> and --ref track/<id>|<sha> are required');
  const s = readSwarm(io.cwd);
  if (!s) throw new UsageError('swarm integrate: no swarm (forge swarm start)');
  if (!s.mergeAuthorized) throw new UsageError('swarm integrate: integrating needs the user\'s authorization (swarm start --merge)');
  const at = io.now().toISOString();
  const out = (v: unknown): Result => ({ code: 0, stdout: JSON.stringify(v) + '\n', stderr: '' });
  const conflict = (detail: string): Result => {
    const cur = readSwarm(io.cwd)!;
    saveSwarm(io.cwd, {
      ...cur,
      fronts: { ...cur.fronts, [track]: { ...(cur.fronts[track] ?? emptyFront()), status: 'conflict', detail } },
      notice: { kind: 'conflict', track, at },
    });
    return out({ result: 'conflict', detail });
  };
  const integrated = (): Result => {
    const cur = readSwarm(io.cwd)!;
    saveSwarm(io.cwd, { ...cur, notice: cur.notice?.kind === 'main-dirty' ? null : cur.notice });
    return out({ result: 'integrated', detail: null });
  };
  const merging = () => deps.git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']) !== null;
  // A merge left half-done (a killed integrate, or one started by hand) must be cleared by the user first.
  if (merging()) return conflict('rollback failed: an unfinished integration is in progress in the main checkout (run git merge --abort to clear it)');
  const branch = deps.git(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
  const dirty = deps.git(['status', '--porcelain', '--', '.', ...LOCAL_STATE]);
  if (branch !== s.base || dirty === null || dirty.trim() !== '') {
    const first = s.notice?.kind !== 'main-dirty';
    if (first) saveSwarm(io.cwd, { ...s, notice: { kind: 'main-dirty', track, at } });
    return out({ result: 'main-dirty', detail: branch !== s.base ? `the main checkout is on ${branch ?? '?'}, not ${s.base}` : 'the main checkout has uncommitted changes', first });
  }
  if (deps.git(['rev-parse', '--verify', '-q', `${ref}^{commit}`]) === null) return conflict(`unknown ref ${ref}`);
  // Roll back to this sha, never to the mutable ORIG_HEAD.
  const preMergeSha = deps.git(['rev-parse', 'HEAD'])?.trim();
  if (!preMergeSha) throw new UsageError('swarm integrate: cannot read HEAD');
  // The merge is committed only after the validators pass, so a kill midway leaves MERGE_HEAD (caught above on the
  // next call), never an unvalidated commit. `merge --abort` keeps local changes the merge did not touch; the checks
  // make a failed rollback visible.
  const rollback = (detail: string): Result => {
    const undone = deps.git(['merge', '--abort']) !== null;
    const clean = undone && deps.git(['rev-parse', 'HEAD'])?.trim() === preMergeSha && !merging();
    return conflict(clean ? detail : `rollback failed: the main checkout needs manual attention (${detail})`);
  };
  if (deps.git(['merge', '--no-ff', '--no-commit', ref]) === null) {
    // No merge started (git refused it, e.g. local changes it would overwrite): nothing to roll back.
    if (!merging()) return conflict(`git refused to merge ${ref} into ${s.base} (local changes it would overwrite?)`);
    return rollback(`merge conflict integrating ${ref} into ${s.base}`);
  }
  // Already in the base branch: nothing to commit.
  if (!merging()) return integrated();
  const config = loadConfig(io.cwd);
  const failed = runValidators(selectValidators(detectValidators(deps.repo, config), { mode: 'heavy', changed: null }), deps.exec, config.validatorTimeoutSec).filter(r => !r.ok);
  if (failed.length) return rollback(`validators failed after integrating ${ref}: ${failed.map(r => r.validator).join(', ')}`);
  const committed = deps.git(['commit', '--no-edit', '-m', `swarm: integrate ${track}`]) !== null;
  if (!committed || merging() || deps.git(['rev-parse', 'HEAD'])?.trim() === preMergeSha) {
    return rollback(`could not commit the integration of ${ref}`);
  }
  return integrated();
}
