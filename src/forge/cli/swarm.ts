import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './errors.js';
import type { ExecResult, Io } from './run.js';
import { detectValidators, selectValidators, runValidators, type RepoReader } from '../validators.js';
import { loadConfig } from '../config.js';
import { decide, readSwarm, saveSwarm } from '../swarm.js';
import { stopFile } from '../run.js';
import { emptyFront, type SwarmState } from '../../lib/swarm-state.js';
import { parsePlan, PlanError } from '../../lib/plan.js';
import type { SessionDoc, TaskState } from '../../lib/types.js';
import { mainWorktreeFrom, samePath } from '../../lib/worktree.js';

export interface SwarmDeps { git: (args: string[]) => string | null; exec: (cmd: string, timeoutSec: number) => ExecResult; repo: RepoReader }
type Result = { code: number; stdout: string; stderr: string };

const ID = /^[A-Za-z0-9_\-.~:@+]{1,80}$/;
const TAKEOVER_MIN = 30;
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
    const s = readSwarm(io.cwd);
    if (!s) throw new UsageError(`swarm ${sub}: no swarm (forge swarm start)`);
    return s;
  };
  // Everything that changes the swarm or the base branch runs only in the main checkout: from a worktree it would
  // read another swarm.json, integrate into the wrong branch and nest new worktrees.
  if (['start', 'tick', 'integrate', 'sleep', 'mark', 'retry'].includes(sub ?? '')) {
    const top = deps.git(['rev-parse', '--show-toplevel'])?.trim();
    const main = mainWorktreeFrom(deps.git(['worktree', 'list', '--porcelain']));
    if (!top || !main || !samePath(top, main)) {
      throw new UsageError(`swarm ${sub}: run it from the main checkout${main ? ` (${main})` : ''}, not from a worktree`);
    }
  }
  const trackArg = () => {
    const t = rest[0];
    if (!t || !ID.test(t)) throw new UsageError(`swarm ${sub}: a track id is required`);
    return t;
  };

  switch (sub) {
    case 'start': {
      const project = flag('project');
      const session = flag('session');
      if (!project || !ID.test(project) || !session || !ID.test(session)) throw new UsageError('swarm start: --project and --session are required');
      let parallel = loadConfig(io.cwd).swarm.parallel;
      if (has('parallel')) {
        const v = Number(flag('parallel'));
        if (!Number.isInteger(v) || v < 1 || v > 10) throw new UsageError('swarm start: --parallel must be an integer from 1 to 10');
        parallel = v;
      }
      if (parallel < 2) throw new UsageError('swarm start: parallel is 1, so there is no swarm; work the plan sequentially');
      const base = deps.git(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
      if (!base || base === 'HEAD') throw new UsageError('swarm start: the main checkout must be on a branch');
      const prev = readSwarm(io.cwd);
      if (prev?.active && prev.coordinator !== session) {
        const last = Date.parse(prev.lastTickAt ?? prev.startedAt);
        if (now.getTime() - last < TAKEOVER_MIN * 60000) throw new UsageError(`swarm start: coordinator ${prev.coordinator} is active (last tick ${prev.lastTickAt ?? prev.startedAt})`);
      }
      const state: SwarmState = prev && prev.active && prev.project === project
        ? { ...prev, parallel, mergeAuthorized: prev.mergeAuthorized || has('merge'), coordinator: session, hookSession: null, sleepUntil: null }
        : {
            active: true, parallel, mergeAuthorized: has('merge'), project, base, coordinator: session, hookSession: null,
            startedAt: iso, lastTickAt: null, lastBlockTick: null, sleepUntil: null, stopReason: null, stallReason: null, notice: null, fronts: {},
          };
      rmSync(stopFile(io.cwd), { force: true });
      saveSwarm(io.cwd, state);
      return json(state);
    }
    case 'status': {
      const state = readSwarm(io.cwd);
      return json({ present: state !== null, state });
    }
    case 'tick': {
      const swarm = current();
      if (!swarm.active) throw new UsageError('swarm tick: the swarm is not active');
      const planArg = flag('plan');
      const db = flag('db');
      const agentsArg = flag('agents');
      if (!planArg || !db || !agentsArg) throw new UsageError('swarm tick: --plan, --db and --agents are required');
      const stateDir = path.resolve(io.cwd, db, 'state');
      const sessionsDir = path.resolve(io.cwd, db, 'sessions');
      // Missing listings would make every front look free and relaunch live ones: refuse instead.
      if (!existsSync(stateDir) || !existsSync(sessionsDir)) throw new UsageError('swarm tick: --db must hold the state and sessions listings');
      let plan;
      try { plan = parsePlan(readFileSync(path.resolve(io.cwd, planArg), 'utf8')); } catch (e) {
        throw new UsageError(e instanceof PlanError ? `${planArg}: ${e.issues.join('; ')}` : `swarm tick: cannot read ${planArg}`);
      }
      let agents: unknown;
      try { agents = JSON.parse(readFileSync(path.resolve(io.cwd, agentsArg), 'utf8')); } catch { throw new UsageError('swarm tick: --agents must be a JSON array of names'); }
      if (!Array.isArray(agents)) throw new UsageError('swarm tick: --agents must be a JSON array of names');
      const states = readDocs<TaskState>(stateDir);
      const sessions = readDocs<SessionDoc>(sessionsDir);
      const ahead: Record<string, number> = {};
      for (const t of plan.tracks) ahead[t.id] = Number.parseInt(deps.git(['rev-list', '--count', `${swarm.base}..track/${t.id}`]) ?? '0', 10) || 0;
      const integrated: string[] = [];
      for (const t of plan.tasks) {
        if (states[t.id]?.status !== 'done') continue;
        for (const c of states[t.id]?.commits ?? []) {
          if (typeof c?.sha === 'string' && ID.test(c.sha) && deps.git(['merge-base', '--is-ancestor', c.sha, swarm.base]) !== null) integrated.push(c.sha);
        }
      }
      const d = decide({ plan, states, sessions, agents: agents.filter((a): a is string => typeof a === 'string'), ahead, integrated, swarm, now: now.getTime() });
      saveSwarm(io.cwd, d.next);
      return json({ actions: d.actions, progress: d.progress, live: d.live, parallel: swarm.parallel });
    }
    case 'mark': {
      const track = trackArg();
      if (flag('status') !== 'launch-failed') throw new UsageError('swarm mark: --status launch-failed is the only status a skill sets');
      let detail: string | null = null;
      if (flag('detail-file')) {
        try { detail = readFileSync(path.resolve(io.cwd, flag('detail-file')!), 'utf8').trim().slice(0, 500) || null; } catch { throw new UsageError('swarm mark: cannot read --detail-file'); }
      }
      const s = current();
      saveSwarm(io.cwd, {
        ...s,
        fronts: { ...s.fronts, [track]: { ...(s.fronts[track] ?? emptyFront()), status: 'launch-failed', detail, launchedAt: null } },
        notice: { kind: 'launch-failed', track, at: iso },
      });
      return ok();
    }
    case 'retry': {
      const track = trackArg();
      const s = current();
      const f = s.fronts[track];
      if (!f || (f.status !== 'conflict' && f.status !== 'launch-failed')) throw new UsageError(`swarm retry: ${track} is not in conflict or launch-failed`);
      // A swarm that stalled waits for exactly this: retrying reactivates it with its fronts kept. One the user
      // stopped (or that ran out of budget or finished) stays stopped.
      const revive = !s.active && s.stopReason === 'stalled';
      saveSwarm(io.cwd, {
        ...s,
        ...(revive ? { active: true, stopReason: null, stallReason: null } : {}),
        fronts: { ...s.fronts, [track]: { ...f, status: 'queued', detail: null, launchedAt: null } },
        notice: s.notice?.track === track ? null : s.notice,
      });
      return ok();
    }
    case 'sleep': {
      const seconds = Number(rest[0]);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SLEEP_S) throw new UsageError(`swarm sleep: seconds must be an integer from 1 to ${MAX_SLEEP_S}`);
      const s = current();
      saveSwarm(io.cwd, { ...s, sleepUntil: new Date(now.getTime() + seconds * 1000).toISOString() });
      // --mark runs in the foreground before the background sleep, so the Stop hook already sees sleepUntil when the turn ends.
      if (has('mark')) return ok();
      (io.sleep ?? sleepSync)(seconds * 1000);
      // Re-read: a tick or a stop may have changed the file meanwhile.
      const after = readSwarm(io.cwd);
      if (after) saveSwarm(io.cwd, { ...after, sleepUntil: null });
      return ok();
    }
    case 'stop': {
      const reason = flag('reason') ?? 'stopped';
      if (reason !== 'stopped' && reason !== 'budget') throw new UsageError('swarm stop: --reason must be stopped or budget');
      const s = readSwarm(io.cwd);
      if (s?.active) saveSwarm(io.cwd, { ...s, active: false, stopReason: reason, sleepUntil: null });
      return ok();
    }
    case 'integrate':
      return integrate(rest, io, deps);
    default:
      throw new UsageError('usage: forge swarm <start --project P --session SID [--parallel N] [--merge]|status|tick --plan P --db DIR --agents FILE|integrate <track> --ref REF|mark <track> --status launch-failed [--detail-file F]|retry <track>|sleep <seconds> [--mark]|stop [--reason stopped|budget]>');
  }
}

// Integration runs only in the main checkout, never in a track worktree, so it works while the front keeps working.
const LOCAL_STATE = [':!.forge', ':!.waypoint', ':!.claude'];
const REF = /^(track\/[A-Za-z0-9_\-.~:@+]{1,80}|[0-9a-f]{7,64})$/;

function integrate(rest: string[], io: Io, deps: SwarmDeps): Result {
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
