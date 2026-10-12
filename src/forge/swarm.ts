import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from './ledger.js';
import { availableTasks, commitShas, notIntegratedDep, statusOf } from '../lib/deps.js';
import { conflictsFor, isIdle, recoverableTasks, zonesOf } from '../lib/coordination.js';
import { overlappingZones } from '../lib/zones.js';
import { emptyFront, parseSwarm, type FrontState, type SwarmState } from '../lib/swarm-state.js';
import type { PlanTask, PlanView, SessionDoc, States } from '../lib/types.js';

/** A front launched this recently counts as live: its new session may not have registered yet. */
export const LAUNCH_GRACE_MIN = 10;
export const WAIT_SECONDS = 240;

export type SwarmAction =
  | { type: 'integrate'; track: string; ref: string }
  | { type: 'launch'; track: string }
  | { type: 'wait'; seconds: number }
  | { type: 'finish' }
  | { type: 'stalled'; reason: string };

export interface DecideInput {
  plan: PlanView; states: States; sessions: Record<string, SessionDoc | undefined>; agents: string[];
  /** Commits of track/<id> not in the base branch (0 when the branch does not exist). */
  ahead: Record<string, number>;
  /** Shas of done tasks' commits that are already in the base branch. */
  integrated: string[];
  swarm: SwarmState; now: number;
}

export const agentNameFor = (project: string, track: string) => `wp-${project}-${track}`;

export function decide(input: DecideInput): { actions: SwarmAction[]; next: SwarmState; progress: boolean; live: number } {
  const { plan, states, sessions, swarm, now } = input;
  const integrated = new Set(input.integrated);
  const agents = new Set(input.agents);
  const byId = new Map(plan.tasks.map(t => [t.id, t]));
  const phaseAt = new Map(plan.phases.map((p, i) => [p.id, i]));
  const planAt = new Map(plan.tasks.map((t, i) => [t.id, i]));
  const rank = (t: PlanTask) => (phaseAt.get(t.phase) ?? 0) * 1e6 + (planAt.get(t.id) ?? 0);
  const done = (id: string) => statusOf(states, id) === 'done';
  const recoverable = new Set(recoverableTasks(plan, states, sessions, now).map(r => r.taskId));
  const ahead = (track: string) => input.ahead[track] ?? 0;

  const sessionOf = (track: string) => Object.values(sessions).find(s => !!s && s.track === track && !isIdle(s, now)) ?? null;
  const isLive = (track: string) => {
    if (sessionOf(track) || agents.has(agentNameFor(swarm.project, track))) return true;
    const launched = Date.parse(swarm.fronts[track]?.launchedAt ?? '');
    return Number.isFinite(launched) && now - launched < LAUNCH_GRACE_MIN * 60000;
  };
  const shasOf = (id: string) => commitShas(states, id);
  const notIntegrated = (task: PlanTask) => notIntegratedDep(plan, states, task, integrated);
  const nextOf = (track: string): PlanTask | null =>
    availableTasks(plan, states, { track })[0] ?? plan.tasks.find(t => t.track === track && recoverable.has(t.id)) ?? null;
  // The last commit of the most recently done task of a track: what a live front can integrate without half-done work.
  const doneTime = (id: string): number => {
    const at = Date.parse(states[id]?.doneAt ?? '');
    if (Number.isFinite(at)) return at;
    const ts = (states[id]?.commits ?? []).map(c => Date.parse(c.ts)).filter(Number.isFinite);
    return ts.length ? Math.max(...ts) : -Infinity;
  };
  const lastDoneSha = (track: string): string | null => {
    const doneTasks = plan.tasks.filter(t => t.track === track && done(t.id) && shasOf(t.id).length)
      .sort((a, b) => doneTime(b.id) - doneTime(a.id));
    return doneTasks.length ? shasOf(doneTasks[0].id).at(-1)! : null;
  };
  // What to integrate for a front: never half-done work, so with a task in course (live or not) only its last done commit.
  const refFor = (track: string): string | null => {
    const inCourse = plan.tasks.some(t => t.track === track && ['claimed', 'in_progress'].includes(statusOf(states, t.id)));
    if (inCourse) return lastDoneSha(track);
    return ahead(track) > 0 ? `track/${track}` : null;
  };

  const live = new Set(plan.tracks.map(t => t.id).filter(isLive));
  const fronts: Record<string, FrontState> = {};
  const needed: string[] = [];
  const candidates: { track: string; task: PlanTask }[] = [];
  for (const tr of plan.tracks) {
    const prev = swarm.fronts[tr.id] ?? emptyFront();
    const tasks = plan.tasks.filter(t => t.track === tr.id);
    const s = sessionOf(tr.id);
    const f: FrontState = {
      ...emptyFront(), session: prev.session, launchedAt: prev.launchedAt,
      currentTask: s?.currentTask ?? (live.has(tr.id) ? prev.currentTask : null), heartbeatAt: s?.heartbeatAt ?? null,
      done: tasks.filter(t => done(t.id)).length, total: tasks.length,
    };
    fronts[tr.id] = f;
    // conflict and launch-failed stay until `forge swarm retry`.
    if (prev.status === 'conflict' || prev.status === 'launch-failed') { f.status = prev.status; f.detail = prev.detail; continue; }
    const next = nextOf(tr.id);
    if (live.has(tr.id)) {
      // A live front stays running, but what its next task needs from other fronts gets integration priority:
      // its session skips that task (waypoint next --base) until the code is in the base branch.
      const missing = next ? notIntegrated(next) : null;
      const from = missing ? byId.get(missing)!.track : null;
      if (from && !needed.includes(from)) needed.push(from);
      f.status = 'running';
      continue;
    }
    if (next) {
      const missing = notIntegrated(next);
      if (missing) {
        const from = byId.get(missing)!.track;
        f.status = 'waiting';
        f.waitingFor = { task: missing, track: from, reason: 'not-integrated' };
        if (!needed.includes(from)) needed.push(from);
      } else {
        f.status = 'queued';
        candidates.push({ track: tr.id, task: next });
      }
      continue;
    }
    const pending = tasks.filter(t => !done(t.id)).sort((a, b) => rank(a) - rank(b));
    if (!pending.length) { f.status = ahead(tr.id) > 0 ? 'ready' : 'integrated'; continue; }
    const ext = pending.find(t => statusOf(states, t.id) === 'blocked' && (states[t.id]?.blockedBy ?? []).includes('external'));
    if (ext) { f.status = 'blocked'; f.detail = ext.id; continue; }
    const first = pending[0];
    const dep = first.depends_on.find(d => !done(d)) ?? (states[first.id]?.blockedBy ?? []).find(b => b !== 'external' && !done(b));
    f.status = 'waiting';
    f.waitingFor = dep ? { task: dep, track: byId.get(dep)?.track ?? tr.id, reason: 'not-done' } : null;
  }

  // Integration: the work a waiting front needs first, then finished fronts that are no longer live. One per tick.
  let integrate: { track: string; ref: string } | null = null;
  if (swarm.mergeAuthorized) {
    for (const track of needed) {
      if (fronts[track]?.status === 'conflict') continue;
      const ref = refFor(track);
      if (ref && !integrated.has(ref)) { integrate = { track, ref }; break; }
    }
    if (!integrate) {
      const firstRank = (track: string) => Math.min(...plan.tasks.filter(t => t.track === track).map(rank));
      const idle = plan.tracks.map(t => t.id)
        .filter(id => !live.has(id) && ahead(id) > 0 && fronts[id].status !== 'conflict')
        .map(id => ({ id, ref: refFor(id) }))
        .filter((x): x is { id: string; ref: string } => !!x.ref && !integrated.has(x.ref))
        .sort((a, b) => firstRank(a.id) - firstRank(b.id));
      if (idle.length) integrate = { track: idle[0].id, ref: idle[0].ref };
    }
  } else {
    for (const id of plan.tracks.map(t => t.id)) {
      if (!live.has(id) && ahead(id) > 0 && ['integrated', 'blocked', 'waiting'].includes(fronts[id].status)) fronts[id].status = 'ready';
    }
  }

  const actions: SwarmAction[] = integrate ? [{ type: 'integrate', ...integrate }] : [];
  // Tasks of fronts already running (this includes fronts launched in an earlier tick that have not claimed yet).
  const running = [...live].map(id => byId.get(fronts[id]?.currentTask ?? '')).filter((t): t is PlanTask => !!t);
  const chosen: PlanTask[] = [];
  let slots = swarm.parallel - live.size;
  for (const c of [...candidates].sort((a, b) => rank(a.task) - rank(b.task))) {
    if (slots <= 0) break;
    const busy = conflictsFor(plan, states, c.task.id, '', sessions, now).some(x => !x.ownerIdle);
    const clash = [...running, ...chosen].some(t => overlappingZones(zonesOf(c.task, states[c.task.id]), zonesOf(t, states[t.id])).length > 0);
    if (busy || clash) continue;
    chosen.push(c.task);
    slots--;
    actions.push({ type: 'launch', track: c.track });
    fronts[c.track] = { ...fronts[c.track], status: 'running', currentTask: c.task.id, session: agentNameFor(swarm.project, c.track), launchedAt: new Date(now).toISOString() };
  }

  let { active, stopReason } = swarm;
  let stallReason: string | null = null;
  const moved = !!integrate || chosen.length > 0;
  if (!moved && plan.tasks.every(t => done(t.id)) && plan.tracks.every(t => ahead(t.id) === 0)) {
    actions.push({ type: 'finish' });
    active = false;
    stopReason = 'finished';
  } else if (!moved && live.size === 0) {
    stallReason = describeStall(fronts, swarm.mergeAuthorized);
    actions.push({ type: 'stalled', reason: stallReason });
    active = false;
    stopReason = 'stalled';
  } else {
    actions.push({ type: 'wait', seconds: integrate ? 0 : WAIT_SECONDS });
  }
  return {
    actions,
    next: { ...swarm, active, stopReason, stallReason, fronts, lastTickAt: new Date(now).toISOString() },
    progress: moved || live.size > 0,
    live: live.size,
  };
}

function describeStall(fronts: Record<string, FrontState>, mergeAuthorized: boolean): string {
  const by = (status: string) => Object.entries(fronts).filter(([, f]) => f.status === status).map(([id]) => id);
  const parts: string[] = [];
  for (const status of ['blocked', 'conflict', 'launch-failed', 'waiting'] as const) {
    const ids = by(status);
    if (ids.length) parts.push(`${status}: ${ids.join(', ')}`);
  }
  const ready = by('ready');
  if (ready.length) parts.push(`ready${mergeAuthorized ? '' : ' (no merge authorization)'}: ${ready.join(', ')}`);
  return parts.join('; ') || 'nothing can move';
}

export const swarmFile = (root: string) => path.join(root, '.forge', 'swarm.json');

export function readSwarm(root: string): SwarmState | null {
  const file = swarmFile(root);
  if (!existsSync(file)) return null;
  try { return parseSwarm(readFileSync(file, 'utf8')); } catch { return null; }
}

export function saveSwarm(root: string, s: SwarmState): void {
  forgeDir(root);
  const file = swarmFile(root);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
    renameSync(tmp, file);
  } finally { rmSync(tmp, { force: true }); }
}
