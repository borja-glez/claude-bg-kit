import { liveness, type Liveness } from './coordination.js';
import { LIVE_MAX_AGE_HOURS, LIVE_SILENT_MINUTES, LIVE_STOPPED_MINUTES, type ExecutionState, type LiveDoc, type PublicTask } from './execution-state.js';
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
}

/** A timestamp more than this far ahead of now is clock skew or corruption: it is invalid, not a sign of life. */
const FUTURE_TOLERANCE_MS = 2 * 60000;
/** An agent listed in a coordinator's signal keeps it alive for this long after it started (the hook prunes it then). */
const AGENT_ALIVE_MS = 3 * 3600000;

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

export function executionView(i: { exec: ExecutionState | null; tasks: Record<string, PublicTask>; live: LiveDoc[]; titles?: Record<string, string>; now: number }): ExecView | null {
  const e = i.exec;
  if (!e || (!e.active && e.stopReason !== 'stalled')) return null;
  const fresh = (d: LiveDoc) => {
    const t = usable(d.ts, i.now);
    return t !== null && i.now - t < LIVE_MAX_AGE_HOURS * 3600000;
  };
  // Of the matching coordinator signals, the one with the most recent valid ts.
  const signal = i.live
    .filter(d => fresh(d) && d.role === 'coordinator' && d.runId === e.runId && (!e.hookSession || d.sessionId === e.hookSession))
    .reduce<LiveDoc | null>((best, d) => (!best || Date.parse(d.ts) > Date.parse(best.ts) ? d : best), null);
  const candidates = [signal?.ts ?? null, e.lastStepAt].map(ts => ({ ts, t: usable(ts, i.now) })).filter((c): c is { ts: string; t: number } => c.t !== null);
  const lastSeen = candidates.length ? candidates.reduce((a, b) => (b.t > a.t ? b : a)).ts : null;
  // A coordinator waiting on a long agent does not step: it stays alive while its signal (not ended) lists an agent
  // started within AGENT_ALIVE_MS. SessionEnd and that bound cap how long a dead coordinator can read alive.
  const waiting = !!e.active && !!signal && !signal.ended && signal.agents.some(a => {
    const t = usable(a.since, i.now);
    return t !== null && i.now - t < AGENT_ALIVE_MS;
  });
  const coord: Liveness = !e.active ? 'stopped' : signal?.ended ? 'stopped' : waiting ? 'alive' : signalLiveness(lastSeen, false, i.now);
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
    startedAt: e.startedAt, finished,
  };
}
