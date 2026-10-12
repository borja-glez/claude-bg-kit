import { availableTasks, nextTask, notIntegratedDep, statusOf } from './deps.js';
import { overlappingZones } from './zones.js';
import type { MessageDoc, PlanTask, PlanView, SessionDoc, States, TaskState } from './types.js';

export interface Conflict { taskId: string; owner: string; zones: [string, string][]; ownerIdle?: boolean }
type Sessions = Record<string, SessionDoc | undefined>;
export const IDLE_MINUTES = 15;
/** A `busyUntil` lease counts only up to this many minutes after its heartbeat; a longer one is ignored. */
export const LEASE_CAP_MINUTES = 90;
/** A lease is renewed for this long at each step or heartbeat. */
export const LEASE_MINUTES = 10;
/** After a lease ends it reads as silent for this long, then as stopped. */
export const SILENT_MINUTES = 5;
export type Liveness = 'alive' | 'silent' | 'stopped';
const ACTIVE = ['claimed', 'in_progress'];

export function zonesOf(task: PlanTask, state?: TaskState): string[] {
  const touched = Array.isArray(state?.zonesTouched) ? state!.zonesTouched! : [];
  return [...task.zones, ...touched].filter((z): z is string => typeof z === 'string');
}

/** With `sessions`, each conflict also says whether its owner is idle (see isIdle). */
export function conflictsFor(plan: PlanView, states: States, taskId: string, sessionId: string, sessions?: Sessions, now = Date.now()): Conflict[] {
  const task = plan.tasks.find(t => t.id === taskId);
  if (!task) return [];
  const mine = zonesOf(task, states[taskId]);
  const out: Conflict[] = [];
  for (const other of plan.tasks) {
    const st = states[other.id];
    if (other.id === taskId || !st?.owner || st.owner === sessionId || !ACTIVE.includes(statusOf(states, other.id))) continue;
    const zones = overlappingZones(mine, zonesOf(other, st));
    if (zones.length) out.push({ taskId: other.id, owner: st.owner, zones, ...(sessions ? { ownerIdle: isIdle(sessions[st.owner], now) } : {}) });
  }
  return out;
}

/**
 * With `integrated` (the shas already in a swarm's base branch), a task whose dependency in another track is done
 * but not integrated yet is skipped: its code is not in the base the session works from.
 */
export function pickTask(plan: PlanView, states: States, opts: { sessionId: string; track?: string; sessions?: Sessions; now?: number; integrated?: ReadonlySet<string> }) {
  const conflicts = (id: string) => conflictsFor(plan, states, id, opts.sessionId, opts.sessions, opts.now);
  const own = nextTask(plan, states, opts);
  if (own.resumed && own.task) {
    return { task: own.task, resumed: true, unblock: false, conflicts: conflicts(own.task.id) };
  }
  const candidates = availableTasks(plan, states, opts).filter(t => {
    const owner = states[t.id]?.owner;
    return (!owner || owner === opts.sessionId) && (!opts.integrated || !notIntegratedDep(plan, states, t, opts.integrated));
  });
  const result = (task: PlanTask, conflicts: Conflict[]) => ({ task, resumed: false, unblock: statusOf(states, task.id) === 'blocked', conflicts });
  // Conflicts with an idle owner do not steer the choice (that owner is not working), but are still reported.
  for (const c of candidates) {
    const cs = conflicts(c.id);
    if (!cs.some(x => !x.ownerIdle)) return result(c, cs);
  }
  const first = candidates[0];
  return first ? result(first, conflicts(first.id)) : { task: null, resumed: false, unblock: false, conflicts: [] };
}

export function isIdle(s: SessionDoc | undefined, now: number, minutes = IDLE_MINUTES): boolean {
  if (s && s.status !== 'idle' && typeof s.leaseUntil === 'string') return liveness(now, s.leaseUntil) === 'stopped';
  return legacyIdle(s, now, minutes);
}

/** Derived by whoever reads it: nothing ever writes «stopped», a lease that is not renewed becomes it. */
export function liveness(now: number, leaseUntil: string | null | undefined): Liveness {
  const until = typeof leaseUntil === 'string' ? Date.parse(leaseUntil) : NaN;
  if (!Number.isFinite(until)) return 'stopped';
  if (now < until) return 'alive';
  return now - until < SILENT_MINUTES * 60000 ? 'silent' : 'stopped';
}

/** A session with a lease is read by it; one without (older waypoint) by the heartbeat window, as before. */
export function sessionLiveness(s: SessionDoc | undefined, now: number): Liveness {
  if (!s || s.status === 'idle') return 'stopped';
  if (typeof s.leaseUntil === 'string') return liveness(now, s.leaseUntil);
  return legacyIdle(s, now) ? 'stopped' : 'alive';
}

function legacyIdle(s: SessionDoc | undefined, now: number, minutes = IDLE_MINUTES): boolean {
  if (!s || s.status === 'idle') return true;
  const hb = Date.parse(s.heartbeatAt);
  if (!Number.isFinite(hb)) return true;
  // A lease (busyUntil) keeps a session busy on a long step past the heartbeat window, within the cap.
  const lease = typeof s.busyUntil === 'string' ? Date.parse(s.busyUntil) : NaN;
  if (Number.isFinite(lease) && lease - hb <= LEASE_CAP_MINUTES * 60000 && now < lease) return false;
  return now - hb > minutes * 60000;
}

export function recoverableTasks(
  plan: PlanView,
  states: States,
  sessions: Record<string, SessionDoc | undefined>,
  now: number,
  minutes = IDLE_MINUTES,
): { taskId: string; owner: string }[] {
  return plan.tasks
    .filter(t => ACTIVE.includes(statusOf(states, t.id)) && states[t.id]?.owner && isIdle(sessions[states[t.id]!.owner!], now, minutes))
    .map(t => ({ taskId: t.id, owner: states[t.id]!.owner! }));
}

export function inboxFor(messages: Record<string, MessageDoc | undefined>, sessionId: string): (MessageDoc & { id: string })[] {
  return Object.entries(messages)
    .filter((e): e is [string, MessageDoc] => !!e[1])
    .filter(([, m]) => m.status === 'open' && m.from !== sessionId && (m.to === sessionId || m.to === '*'))
    .map(([id, m]) => ({ ...m, id }))
    .sort((a, b) => {
      const ta = String(a.ts ?? ''), tb = String(b.ts ?? '');
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
}

export function threadKey(m: MessageDoc): string {
  return `${m.taskId ?? '-'}|${[String(m.from), String(m.to)].sort().join('|')}`;
}

export function escalationCandidates(messages: Record<string, MessageDoc | undefined>) {
  const threads = new Map<string, MessageDoc[]>();
  for (const m of Object.values(messages)) {
    // delegates are information (proposals can stay open), never a disagreement
    if (!m || m.type === 'delegate' || m.to === '*' || m.from === '*') continue;
    const k = threadKey(m);
    threads.set(k, [...(threads.get(k) ?? []), m]);
  }
  const out: { key: string; taskId: string; sessions: [string, string]; count: number }[] = [];
  for (const [key, list] of threads) {
    if (list.some(m => m.type === 'escalation')) continue;
    const open = list.filter(m => m.status === 'open');
    if (open.length < 4) continue;
    const [a, b] = [String(list[0].from), String(list[0].to)].sort() as [string, string];
    out.push({ key, taskId: list[0].taskId ?? '', sessions: [a, b], count: open.length });
  }
  return out;
}
