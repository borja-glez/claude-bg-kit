import { liveness, type Liveness } from './coordination.js';
import { bindingLive, type BoundDoc } from './bound.js';
import { LIVE_MAX_AGE_HOURS, LIVE_SILENT_MINUTES, LIVE_STOPPED_MINUTES, type ExecStopReason, type ExecutionState, type LiveDoc, type PublicTask } from './execution-state.js';
import type { ViewerRole } from './viewer-role.js';
import type { Stage } from './types.js';

export interface ExecSlot { task: string; title: string | null; stage: Stage; agent: string | null; round: number; since: string; liveness: Liveness; mode: 'subagents' | 'sessions' | 'manual'; by: string | null; startedAt: string | null }
export interface ExecView {
  runId: string; mode: 'subagents' | 'sessions'; parallel: number; branch: string; active: boolean;
  stopReason: string | null; stallReason: string | null;
  coordinator: { liveness: Liveness; lastSeen: string | null };
  integrated: number; total: number;
  slots: ExecSlot[]; manual: ExecSlot[]; queued: string[]; conflicts: string[]; blocked: string[]; orphans: string[];
  agents: { id: string; type: string; since: string }[];
  startedAt: string;
  finished: { task: string; startedAt: string; finishedAt: string }[];
  /** C2: the instant the clock of an ended run stops (its last movement); null while it is active. */
  frozenAt: string | null;
}

/** A timestamp more than this far ahead of now is clock skew or corruption: it is invalid, not a sign of life. */
const FUTURE_TOLERANCE_MS = 2 * 60000;
/** An agent listed in a coordinator's signal keeps it alive for this long after it started (the hook prunes it then). */
const AGENT_ALIVE_MS = 3 * 3600000;
/** C2: an inactive execution that was not closed is drawn at most this long after its last movement. */
export const STALE_RUN_TTL_MS = 24 * 3600_000;
/** C2: the last movement: the last step, else the start. */
export const lastMovedAt = (e: ExecutionState): string => e.lastStepAt ?? e.startedAt;

/** C2: the stop reasons of an ended run that is still drawn until it is closed (a merge closes a finished one). */
export const VISIBLE_STOPS: readonly ExecStopReason[] = ['stalled', 'stopped', 'budget', 'finished'];

/**
 * C2, the one visibility rule of an execution: a closed run is drawn nowhere and an active one for everyone. An ended
 * one is drawn only for a reason of VISIBLE_STOPS: for its owner (the coordinator or a member of its run) until it is
 * closed, without a time limit; for anyone else while less than STALE_RUN_TTL_MS passed since its last movement, and an
 * unreadable date draws nothing.
 */
export function isVisibleRun(e: ExecutionState | null, now: number, role: ViewerRole): boolean {
  if (!e || e.closedAt) return false;
  if (e.active) return true;
  if (!e.stopReason || !VISIBLE_STOPS.includes(e.stopReason)) return false;
  if (role === 'owner') return true;
  const moved = usable(lastMovedAt(e), now);
  return moved !== null && now < moved + STALE_RUN_TTL_MS;
}

/** The time in ms of a usable timestamp, or null: unparseable, or more than FUTURE_TOLERANCE_MS ahead of now. */
function usable(ts: string | null | undefined, now: number): number | null {
  const t = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(t) && t - now <= FUTURE_TOLERANCE_MS ? t : null;
}

/** The liveness of a local signal: by its age (no lease to read), stopped at once when its session ended. */
export function signalLiveness(ts: string | null, ended: boolean, now: number): Liveness {
  const t = usable(ts, now);
  if (ended || t === null) return 'stopped';
  const age = Math.max(0, now - t);
  return age < LIVE_SILENT_MINUTES * 60000 ? 'alive' : age < LIVE_STOPPED_MINUTES * 60000 ? 'silent' : 'stopped';
}

/** A signal with a usable ts less than LIVE_MAX_AGE_HOURS old; an older one is a leftover of a past session. */
const freshSignal = (d: LiveDoc, now: number): boolean => {
  const t = usable(d.ts, now);
  return t !== null && now - t < LIVE_MAX_AGE_HOURS * 3600000;
};

/**
 * The coordinator of run `e` as the run band draws it: its freshest valid signal of this run (and of its hook session)
 * among `live`, its last sign of life (that signal or `stepAt`), whether it waits on an agent, and its liveness.
 */
function coordinatorOf(e: ExecutionState, live: readonly LiveDoc[], now: number, stepAt: string | null): { signal: LiveDoc | null; lastSeen: string | null; waiting: boolean; liveness: Liveness } {
  // Of the matching coordinator signals, the one with the most recent valid ts.
  const signal = live
    .filter(d => freshSignal(d, now) && d.role === 'coordinator' && d.runId === e.runId && (!e.hookSession || d.sessionId === e.hookSession))
    .reduce<LiveDoc | null>((best, d) => (!best || Date.parse(d.ts) > Date.parse(best.ts) ? d : best), null);
  const candidates = [signal?.ts ?? null, stepAt].map(ts => ({ ts, t: usable(ts, now) })).filter((c): c is { ts: string; t: number } => c.t !== null);
  const lastSeen = candidates.length ? candidates.reduce((a, b) => (b.t > a.t ? b : a)).ts : null;
  // A coordinator waiting on a long agent does not step: it stays alive while its signal (not ended) lists an agent
  // started within AGENT_ALIVE_MS. SessionEnd and that bound cap how long a dead coordinator can read alive.
  const waiting = !!e.active && !!signal && !signal.ended && signal.agents.some(a => {
    const t = usable(a.since, now);
    return t !== null && now - t < AGENT_ALIVE_MS;
  });
  const liveness: Liveness = !e.active ? 'stopped' : signal?.ended ? 'stopped' : waiting ? 'alive' : signalLiveness(lastSeen, false, now);
  return { signal, lastSeen, waiting, liveness };
}

/** What keeps a coordinator alive besides its steps and its signal (coordinatorLiveness). */
export interface CoordinatorActivity {
  /**
   * Bindings its Claude session may hold, of every seat of every project, any via (the caller need not filter them):
   * one of `claude === e.hookSession` live by its lease (bindingLive) means its conversation is open, e.g. waiting on the
   * person's answer, since the band's own tick renews it every minute. The band passes them raw; waypoint's hooks and
   * forge's CLI pass them settled by their pid (settleBinding), so there a crashed conversation's binding has ended.
   */
  bindings?: readonly BoundDoc[];
  /** Its session runs a background job (.forge/jobs/, C-03), which wakes it when it ends. Only forge's CLI can tell. */
  busy?: boolean;
}

/**
 * The liveness of run `e`'s coordinator by the rule coordinatorGone decides with, which `swarm takeover` and a resume
 * from another session report: stopped once its conversation ended (its own signal says so); alive while that
 * conversation is open (a live binding of its own) or waits on a background job (`activity`); else as the run band
 * draws it (coordinatorOf, counted from its last step or its start).
 */
export function coordinatorLiveness(e: ExecutionState, signal: LiveDoc | null, now: number, activity: CoordinatorActivity = {}): Liveness {
  const own = e.hookSession ? signal : null;
  if (own?.ended === true) return 'stopped';
  const open = !!e.hookSession && (activity.bindings ?? []).some(b => b.claude === e.hookSession && bindingLive(b, now));
  return e.active && (open || activity.busy === true) ? 'alive' : coordinatorOf(e, own ? [own] : [], now, lastMovedAt(e)).liveness;
}

/**
 * B-09, M4: run `e` has no coordinator when its conversation ended (its own signal says so), or when the run is active
 * and its coordinator went silent: the run band would draw it stopped (no step nor signal for LIVE_STOPPED_MINUTES, no
 * agent it started still running) and its conversation is not open (no live binding of its own). A run that never
 * stepped counts from its start, as `swarm takeover` does. `signal` is the coordinator's own live/<hookSession>.json and
 * `activity.bindings` its bindings, the files the band and waypoint's hooks both read, so describeViewer gets the same
 * answer from both (its rule 4 or 5), but for a dead pid the band cannot check (M6). `activity.busy` only forge's CLI
 * can tell: a job lives by its pid. The band passes none, and so do waypoint's hooks, to keep giving a session the
 * band's role: there a crashed coordinator (no SessionEnd) whose job still runs reads gone, and [Resume] finds it alive
 * (took: false) until the job ends.
 */
export function coordinatorGone(e: ExecutionState | null, signal: LiveDoc | null, now: number, activity: CoordinatorActivity = {}): boolean {
  if (!e) return false;
  if (e.hookSession && signal?.ended === true) return true;
  return e.active && coordinatorLiveness(e, signal, now, activity) === 'stopped';
}

export function executionView(i: { exec: ExecutionState | null; tasks: Record<string, PublicTask>; live: LiveDoc[]; titles?: Record<string, string>; now: number; role?: ViewerRole }): ExecView | null {
  const e = i.exec;
  // C2: one rule, isVisibleRun. Without a role the reader is not the run's owner: the 24-hour limit applies.
  if (!e || !isVisibleRun(e, i.now, i.role ?? 'none')) return null;
  const fresh = (d: LiveDoc) => freshSignal(d, i.now);
  const { signal, lastSeen, waiting, liveness: coord } = coordinatorOf(e, i.live, i.now, e.lastStepAt);
  // A slot owned by a member session lives by that session: the more alive of its lease and its own fresh signal.
  // An ended signal is stopped at once, even with a lease still running.
  const rank = { stopped: 0, silent: 1, alive: 2 } as const;
  const memberLiveness = (p: PublicTask): Liveness => {
    const d = i.live.filter(x => fresh(x) && x.sessionId === p.by && x.runId === e.runId)
      .reduce<LiveDoc | null>((best, x) => (!best || Date.parse(x.ts) > Date.parse(best.ts) ? x : best), null);
    if (d?.ended) return 'stopped';
    const lease = liveness(i.now, p.leaseUntil);
    const sig = d ? signalLiveness(d.ts, false, i.now) : null;
    return sig && rank[sig] > rank[lease] ? sig : lease;
  };
  const isMember = (p: PublicTask): boolean => p.mode !== 'subagents' && p.by !== e.coordinator;
  const ids = (status: string) => Object.keys(e.tasks).filter(id => e.tasks[id].status === status);
  const slots: ExecSlot[] = ids('running')
    .sort((a, b) => Date.parse(e.tasks[a].startedAt) - Date.parse(e.tasks[b].startedAt))
    .map(id => {
      const t = e.tasks[id];
      const p = i.tasks[id] && i.tasks[id].runId === e.runId ? i.tasks[id] : null;
      const agent = p ? p.agent : t.agent;
      return {
        task: id, title: i.titles?.[id] ?? t.title ?? null, stage: p?.stage ?? t.stage, agent, round: p?.round ?? t.round,
        since: p?.since ?? t.stageSince,
        liveness: p && isMember(p) ? memberLiveness(p) : agent && waiting ? 'alive' : p ? liveness(i.now, p.leaseUntil) : coord,
        mode: p?.mode ?? t.executor, by: p?.by ?? null, startedAt: t.startedAt,
      };
    });
  // Manual work of this run outside the execution's tasks: listed apart, never a slot nor part of the occupation.
  const manual: ExecSlot[] = Object.values(i.tasks)
    .filter(p => p.runId === e.runId && p.mode === 'manual' && p.status === 'running' && !e.tasks[p.task])
    .sort((a, b) => Date.parse(a.since) - Date.parse(b.since)).slice(0, 10)
    .map(p => ({ task: p.task, title: i.titles?.[p.task] ?? null, stage: p.stage, agent: p.agent, round: p.round, since: p.since, liveness: memberLiveness(p), mode: 'manual' as const, by: p.by, startedAt: null }));
  // The newest tasks that ended (integrated or blocked) with a valid finish time: at most 3. A running or accepted
  // task can carry a finishedAt (an adopted one, a blocked task accepted again): it is not finished, so it is not listed.
  const finished = Object.entries(e.tasks)
    .filter(([, t]) => (t.status === 'integrated' || t.status === 'blocked') && !!t.finishedAt && Number.isFinite(Date.parse(t.finishedAt)))
    .sort((a, b) => Date.parse(b[1].finishedAt!) - Date.parse(a[1].finishedAt!))
    .slice(0, 3)
    .map(([task, t]) => ({ task, startedAt: t.startedAt, finishedAt: t.finishedAt! }));
  return {
    runId: e.runId, mode: e.mode, parallel: e.parallel, branch: e.branch, active: e.active, stopReason: e.stopReason, stallReason: e.stallReason,
    coordinator: { liveness: coord, lastSeen }, integrated: ids('integrated').length, total: Math.max(e.planned ?? 0, Object.keys(e.tasks).length),
    slots, queued: ids('accepted'), conflicts: ids('conflict'), blocked: ids('blocked'),
    manual, orphans: [...slots, ...manual].filter(s => s.liveness === 'stopped').map(s => s.task), agents: signal?.agents ?? [],
    startedAt: e.startedAt, finished, frozenAt: e.active ? null : lastMovedAt(e),
  };
}
