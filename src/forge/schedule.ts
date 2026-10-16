import { commitShas, isAvailable, isUnlocked, statusOf } from '../lib/deps.js';
import { LEASE_MINUTES, sessionLiveness, zonesOf } from '../lib/coordination.js';
import { overlappingZones } from '../lib/zones.js';
import type { ExecutionState, ExecTask, PublicTask } from '../lib/execution-state.js';
import type { PlanTask, PlanView, SessionDoc, Stage, States } from '../lib/types.js';

/** A live session of a front that has not changed stage in this long, and sits idle, gets a nudge (once per window). */
export const NUDGE_MINUTES = 15;
/** Relaunches of a front's session; with attempts >= this, the next failure blocks the task. */
export const RELAUNCH_CAP = 2;
/** What ListAgents shows of a background session. */
export interface BgAgent { name: string; state: 'working' | 'idle' }
export type ScheduleAction =
  | { type: 'start'; task: string }
  | { type: 'integrate'; task: string; ref: string }
  | { type: 'relaunch'; task: string; attempt: number }
  | { type: 'nudge'; task: string; stage: Stage }
  | { type: 'block'; task: string; reason: string }
  | { type: 'wait'; seconds: number }
  | { type: 'finish' }
  | { type: 'stalled'; reason: string };
export interface ScheduleInput {
  plan: PlanView; states: States; sessions: Record<string, SessionDoc | undefined>;
  exec: ExecutionState; integrated: string[]; now: number;
  /** .forge/execution/<T>.json per task. */
  publicTasks?: Record<string, PublicTask>;
  /** null: unknown (ListAgents could not be read). */
  agents?: BgAgent[] | null;
  /** D-07: a merge of `swarm integrate` is in flight (merging.json): no integrate this tick. */
  merging?: boolean;
}
/** With agents running, the coordinator steps at least this often (it also renews its lease then). */
export const STEP_WAIT_SECONDS = 300;

/** The single rule for a front whose session died after `attempts` relaunches: relaunch it, or block it at the cap. */
export function relaunchOrBlock(task: string, attempts: number):
  { type: 'relaunch'; task: string; attempt: number } | { type: 'block'; task: string; reason: string } {
  if (attempts >= RELAUNCH_CAP) return { type: 'block', task, reason: `the session of ${task} stopped ${attempts + 1} times` };
  return { type: 'relaunch', task, attempt: attempts + 1 };
}
const HELD: ExecTask['status'][] = ['running', 'accepted', 'conflict', 'blocked'];
const ACTIVE = ['claimed', 'in_progress'];

function ranker(plan: PlanView) {
  const phaseAt = new Map(plan.phases.map((p, i) => [p.id, i]));
  const planAt = new Map(plan.tasks.map((t, i) => [t.id, i]));
  return (t: PlanTask) => (phaseAt.get(t.phase) ?? 0) * 1e6 + (planAt.get(t.id) ?? 0);
}

export function schedule(i: ScheduleInput): { actions: ScheduleAction[]; next: ExecutionState } {
  const { plan, states, sessions, exec, now } = i;
  const integrated = new Set(i.integrated);
  const rank = ranker(plan);
  const byId = new Map(plan.tasks.map(t => [t.id, t]));
  const nowIso = new Date(now).toISOString();
  const tasks = { ...exec.tasks };
  const held = (id: string) => HELD.includes(tasks[id]?.status as ExecTask['status']);
  // A done dependency with no recorded commits counts as integrated (nothing to merge).
  const depIntegrated = (d: string) => statusOf(states, d) === 'done' && commitShas(states, d).every(s => integrated.has(s));
  const owner = (id: string) => states[id]?.owner ?? null;
  // A claim by someone else stands while that session is alive or silent; a stopped owner leaves the task orphaned.
  const claimedByOther = (id: string) => {
    const o = owner(id);
    return !!o && o !== exec.coordinator && ACTIVE.includes(statusOf(states, id)) && sessionLiveness(sessions[o], now) !== 'stopped';
  };
  const orphan = (id: string) => ACTIVE.includes(statusOf(states, id)) && !!owner(id) && owner(id) !== exec.coordinator && !claimedByOther(id);
  // The coordinator's own active task missing from the execution (state lost after a crash) is re-adopted.
  const readopt = (id: string) => ACTIVE.includes(statusOf(states, id)) && owner(id) === exec.coordinator && !tasks[id];

  // Members (sessions or manual) write their own stage publicly; the execution mirrors it.
  const pub = i.publicTasks ?? {};
  const agents = i.agents ?? null;
  for (const [id, t] of Object.entries(tasks)) {
    const p = pub[id];
    if (t.executor === 'subagents' || !p || p.runId !== exec.runId || p.by === exec.coordinator) continue;
    tasks[id] = { ...t, stage: p.stage, round: p.round, agent: p.agent, stageSince: p.since, updatedAt: p.updatedAt };
  }
  // A member's task marked done on the roadmap is accepted and goes to integration; one its session marked blocked
  // (publicly or on the roadmap) is blocked here too: it frees its slot and is never nudged nor relaunched.
  for (const [id, t] of Object.entries(tasks)) {
    if (t.status !== 'running' || t.executor === 'subagents') continue;
    if (statusOf(states, id) === 'done') { tasks[id] = { ...t, status: 'accepted', stage: 'integrate', updatedAt: nowIso }; continue; }
    const p = pub[id];
    const own = !!p && p.runId === exec.runId && p.by !== exec.coordinator;
    if ((own && p.status === 'blocked') || statusOf(states, id) === 'blocked') {
      // A public task carries no detail of its own (swarm report has no such flag), so the reason is generic.
      tasks[id] = { ...t, status: 'blocked', detail: 'blocked by its session', updatedAt: nowIso, finishedAt: nowIso };
    }
  }
  // Work a manual session finished, with commits not yet on the run branch, is adopted for integration.
  for (const t of plan.tasks) {
    const o = owner(t.id);
    const shas = commitShas(states, t.id);
    if (tasks[t.id] || statusOf(states, t.id) !== 'done' || !o || o === exec.coordinator || !shas.length || shas.every(s => integrated.has(s))) continue;
    tasks[t.id] = { status: 'accepted', stage: 'integrate', round: 0, worktree: '', branch: `task/${t.id}`, executor: 'manual', attempts: 0, agent: null, startedAt: nowIso, stageSince: nowIso, updatedAt: nowIso, detail: null, title: t.title };
  }
  // A task started before titles were recorded gets its title from the plan.
  for (const [id, t] of Object.entries(tasks)) if (!t.title && byId.get(id)?.title) tasks[id] = { ...t, title: byId.get(id)!.title };
  const startable =(t: PlanTask) => !held(t.id)
    && ((isAvailable(t, states) && isUnlocked(t, states)) || orphan(t.id) || readopt(t.id))
    && t.depends_on.every(depIntegrated)
    && !claimedByOther(t.id);

  const actions: ScheduleAction[] = [];
  const accepted = Object.keys(tasks).filter(id => tasks[id].status === 'accepted' && byId.has(id))
    .sort((a, b) => rank(byId.get(a)!) - rank(byId.get(b)!));
  if (accepted.length && !i.merging) actions.push({ type: 'integrate', task: accepted[0], ref: tasks[accepted[0]].branch });

  // Session fronts: relaunch a dead session (block it at the cap), nudge a live one that sits idle. Before counting
  // runningIds, so a task blocked here frees its slot.
  const listed = (id: string) => agents?.find(a => a.name === `wp-${exec.project}-${id}`) ?? null;
  for (const id of Object.keys(tasks)) {
    const t = tasks[id];
    if (t.status !== 'running' || t.executor !== 'sessions') continue;
    const o = owner(id);
    // After a relaunch the old, stopped owner stays on the roadmap until the new session claims, so a (re)started
    // front always gets a full lease window before it can be relaunched again (swarm relaunch resets startedAt).
    const pastLease = now - Date.parse(t.startedAt) > LEASE_MINUTES * 60000;
    const ownerStopped = !!o && o !== exec.coordinator && sessionLiveness(sessions[o], now) === 'stopped';
    const neverClaimed = !o;
    if (pastLease && (ownerStopped || neverClaimed) && !listed(id)) {
      const a = relaunchOrBlock(id, t.attempts);
      if (a.type === 'block') tasks[id] = { ...t, status: 'blocked', detail: a.reason, updatedAt: nowIso, finishedAt: nowIso };
      actions.push(a);
      continue;
    }
    const quiet = now - Date.parse(t.stageSince) >= NUDGE_MINUTES * 60000;
    const nudgedLately = !!t.nudgedAt && now - Date.parse(t.nudgedAt) < NUDGE_MINUTES * 60000;
    if (quiet && !nudgedLately && listed(id)?.state === 'idle') actions.push({ type: 'nudge', task: id, stage: t.stage });
  }

  const runningIds = Object.keys(tasks).filter(id => tasks[id].status === 'running');
  const busy: PlanTask[] = runningIds.map(id => byId.get(id)).filter((t): t is PlanTask => !!t);
  let slots = exec.parallel - runningIds.length;
  for (const t of [...plan.tasks].sort((a, b) => rank(a) - rank(b))) {
    if (slots <= 0) break;
    if (!startable(t)) continue;
    const clash = busy.some(b => overlappingZones(zonesOf(t, states[t.id]), zonesOf(b, states[b.id])).length > 0);
    if (clash) continue;
    tasks[t.id] = { status: 'running', stage: 'brief', round: 0, worktree: '', branch: `task/${t.id}`, executor: exec.mode, attempts: 0, agent: null, startedAt: nowIso, stageSince: nowIso, updatedAt: nowIso, detail: null, title: t.title };
    busy.push(t);
    slots--;
    actions.push({ type: 'start', task: t.id });
  }

  let { active, stopReason, stallReason } = exec;
  // An accepted task waiting for a merge in flight is movement, not a stall.
  const moving = actions.length > 0 || runningIds.length > 0 || (!!i.merging && accepted.length > 0);
  const allDone = plan.tasks.every(t => statusOf(states, t.id) === 'done');
  if (!moving && allDone) {
    actions.push({ type: 'finish' });
    active = false; stopReason = 'finished'; stallReason = null;
  } else if (!moving && plan.tasks.some(t => statusOf(states, t.id) !== 'done' && claimedByOther(t.id))) {
    // Another live or silent session holds an unfinished task: the run waits for it instead of stopping.
    actions.push({ type: 'wait', seconds: STEP_WAIT_SECONDS });
  } else if (!moving) {
    stallReason = describeStall(plan, states, tasks, depIntegrated);
    actions.push({ type: 'stalled', reason: stallReason });
    active = false; stopReason = 'stalled';
  } else {
    actions.push({ type: 'wait', seconds: actions.some(a => a.type === 'integrate') ? 0 : STEP_WAIT_SECONDS });
  }
  return { actions, next: { ...exec, tasks, active, stopReason, stallReason, lastStepAt: nowIso, planned: plan.tasks.length } };
}

function describeStall(plan: PlanView, states: States, tasks: Record<string, ExecTask>,
  depIntegrated: (d: string) => boolean): string {
  // A task claimed by another live or silent session never reaches here: the schedule waits for it instead.
  const groups = new Map<string, string[]>();
  const add = (key: string, id: string) => groups.set(key, [...(groups.get(key) ?? []), id]);
  for (const t of plan.tasks) {
    if (statusOf(states, t.id) === 'done') continue;
    const ex = tasks[t.id];
    if (ex?.status === 'conflict') add('conflict', t.id);
    else if (ex?.status === 'blocked' || statusOf(states, t.id) === 'blocked') add('blocked', t.id);
    else {
      const dep = t.depends_on.find(d => !depIntegrated(d));
      if (dep) add(`waits for ${dep} (${statusOf(states, dep) === 'done' ? 'not integrated' : 'not done'})`, t.id);
    }
  }
  return [...groups].map(([k, ids]) => `${k}: ${ids.join(', ')}`).join('; ') || 'nothing can move';
}

/**
 * D-19: the plan wave by wave (start every startable task whose zones do not overlap, mark them done, repeat), the
 * longest chain of depends_on, the zones three tasks or more share (most shared first) and whether the plan is mostly
 * serial: 6 tasks or more and at least half of its waves one task wide.
 */
export interface WidthProfile {
  waves: string[][]; profile: number[]; chain: { length: number; tasks: string[] };
  serializing: { zone: string; tasks: string[] }[]; mostlySerial: boolean;
}

export function widthProfile(plan: PlanView): WidthProfile {
  const done = new Set<string>();
  const waves: string[][] = [];
  for (let guard = 0; guard < plan.tasks.length + 1 && done.size < plan.tasks.length; guard++) {
    const wave: PlanTask[] = [];
    for (const t of plan.tasks) {
      if (done.has(t.id) || !t.depends_on.every(d => done.has(d))) continue;
      if (wave.some(w => overlappingZones(t.zones, w.zones).length > 0)) continue;
      wave.push(t);
    }
    if (!wave.length) break;
    waves.push(wave.map(t => t.id));
    for (const t of wave) done.add(t.id);
  }
  // The longest chain that ends in each task, memoized; a cycle (never in a parsed plan) is cut where it closes.
  const byId = new Map(plan.tasks.map(t => [t.id, t]));
  const memo = new Map<string, string[]>();
  const longest = (id: string, seen: Set<string>): string[] => {
    const known = memo.get(id);
    if (known) return known;
    if (seen.has(id)) return [];
    seen.add(id);
    let best: string[] = [];
    for (const d of byId.get(id)?.depends_on ?? []) {
      if (!byId.has(d)) continue;
      const c = longest(d, seen);
      if (c.length > best.length) best = c;
    }
    seen.delete(id);
    const chain = [...best, id];
    memo.set(id, chain);
    return chain;
  };
  let chain: string[] = [];
  for (const t of plan.tasks) {
    const c = longest(t.id, new Set());
    if (c.length > chain.length) chain = c;
  }
  const byZone = new Map<string, string[]>();
  for (const t of plan.tasks) for (const z of new Set(t.zones)) byZone.set(z, [...(byZone.get(z) ?? []), t.id]);
  const serializing = [...byZone].filter(([, ids]) => ids.length >= 3)
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([zone, tasks]) => ({ zone, tasks }));
  const profile = waves.map(w => w.length);
  const mostlySerial = plan.tasks.length >= 6 && profile.filter(n => n === 1).length * 2 >= profile.length;
  return { waves, profile, chain: { length: chain.length, tasks: chain }, serializing, mostlySerial };
}

/** The most tasks that can run at once: the widest wave of widthProfile (0 without tasks). */
export function widthOf(plan: PlanView): number {
  return widthProfile(plan).profile.reduce((a, b) => Math.max(a, b), 0);
}
