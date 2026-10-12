import { commitShas, isAvailable, isUnlocked, statusOf } from '../lib/deps.js';
import { sessionLiveness, zonesOf } from '../lib/coordination.js';
import { overlappingZones } from '../lib/zones.js';
import type { ExecutionState, ExecTask } from '../lib/execution-state.js';
import type { PlanTask, PlanView, SessionDoc, States } from '../lib/types.js';

export type ScheduleAction =
  | { type: 'start'; task: string }
  | { type: 'integrate'; task: string; ref: string }
  | { type: 'wait'; seconds: number }
  | { type: 'finish' }
  | { type: 'stalled'; reason: string };
export interface ScheduleInput {
  plan: PlanView; states: States; sessions: Record<string, SessionDoc | undefined>;
  exec: ExecutionState; integrated: string[]; now: number;
}
/** With agents running, the coordinator steps at least this often (it also renews its lease then). */
export const STEP_WAIT_SECONDS = 300;
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
  const startable =(t: PlanTask) => !held(t.id)
    && ((isAvailable(t, states) && isUnlocked(t, states)) || orphan(t.id) || readopt(t.id))
    && t.depends_on.every(depIntegrated)
    && !claimedByOther(t.id);

  const actions: ScheduleAction[] = [];
  const accepted = Object.keys(tasks).filter(id => tasks[id].status === 'accepted' && byId.has(id))
    .sort((a, b) => rank(byId.get(a)!) - rank(byId.get(b)!));
  if (accepted.length) actions.push({ type: 'integrate', task: accepted[0], ref: tasks[accepted[0]].branch });

  const runningIds = Object.keys(tasks).filter(id => tasks[id].status === 'running');
  const busy: PlanTask[] = runningIds.map(id => byId.get(id)).filter((t): t is PlanTask => !!t);
  let slots = exec.parallel - runningIds.length;
  for (const t of [...plan.tasks].sort((a, b) => rank(a) - rank(b))) {
    if (slots <= 0) break;
    if (!startable(t)) continue;
    const clash = busy.some(b => overlappingZones(zonesOf(t, states[t.id]), zonesOf(b, states[b.id])).length > 0);
    if (clash) continue;
    tasks[t.id] = { status: 'running', stage: 'brief', round: 0, worktree: '', branch: `task/${t.id}`, executor: exec.mode, attempts: 0, agent: null, startedAt: nowIso, stageSince: nowIso, updatedAt: nowIso, detail: null };
    busy.push(t);
    slots--;
    actions.push({ type: 'start', task: t.id });
  }

  let { active, stopReason, stallReason } = exec;
  const moving = actions.length > 0 || runningIds.length > 0;
  const allDone = plan.tasks.every(t => statusOf(states, t.id) === 'done');
  if (!moving && allDone) {
    actions.push({ type: 'finish' });
    active = false; stopReason = 'finished'; stallReason = null;
  } else if (!moving) {
    stallReason = describeStall(plan, states, tasks, depIntegrated, claimedByOther);
    actions.push({ type: 'stalled', reason: stallReason });
    active = false; stopReason = 'stalled';
  } else {
    actions.push({ type: 'wait', seconds: accepted.length ? 0 : STEP_WAIT_SECONDS });
  }
  return { actions, next: { ...exec, tasks, active, stopReason, stallReason, lastStepAt: nowIso } };
}

function describeStall(plan: PlanView, states: States, tasks: Record<string, ExecTask>,
  depIntegrated: (d: string) => boolean, claimedByOther: (id: string) => boolean): string {
  const groups = new Map<string, string[]>();
  const add = (key: string, id: string) => groups.set(key, [...(groups.get(key) ?? []), id]);
  for (const t of plan.tasks) {
    if (statusOf(states, t.id) === 'done') continue;
    const ex = tasks[t.id];
    if (ex?.status === 'conflict') add('conflict', t.id);
    else if (ex?.status === 'blocked' || statusOf(states, t.id) === 'blocked') add('blocked', t.id);
    else if (claimedByOther(t.id)) add(`claimed by ${states[t.id]!.owner}`, t.id);
    else {
      const dep = t.depends_on.find(d => !depIntegrated(d));
      if (dep) add(`waits for ${dep} (${statusOf(states, dep) === 'done' ? 'not integrated' : 'not done'})`, t.id);
    }
  }
  return [...groups].map(([k, ids]) => `${k}: ${ids.join(', ')}`).join('; ') || 'nothing can move';
}

/** The most tasks that can run at once: start every startable non-overlapping task, mark them done, repeat. */
export function widthOf(plan: PlanView): number {
  const done = new Set<string>();
  let width = 0;
  for (let guard = 0; guard < plan.tasks.length + 1 && done.size < plan.tasks.length; guard++) {
    const wave: PlanTask[] = [];
    for (const t of plan.tasks) {
      if (done.has(t.id) || !t.depends_on.every(d => done.has(d))) continue;
      if (wave.some(w => overlappingZones(t.zones, w.zones).length > 0)) continue;
      wave.push(t);
    }
    if (!wave.length) break;
    width = Math.max(width, wave.length);
    for (const t of wave) done.add(t.id);
  }
  return width;
}
