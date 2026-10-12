import { liveness, type Liveness } from './coordination.js';
import { LIVE_MAX_AGE_HOURS, LIVE_SILENT_MINUTES, LIVE_STOPPED_MINUTES, type ExecutionState, type LiveDoc, type PublicTask } from './execution-state.js';
import type { Stage } from './types.js';

export interface ExecSlot { task: string; title: string | null; stage: Stage; agent: string | null; round: number; since: string; liveness: Liveness; mode: 'subagents' | 'sessions' | 'manual' }
export interface ExecView {
  runId: string; mode: 'subagents' | 'sessions'; parallel: number; branch: string; active: boolean;
  stopReason: string | null; stallReason: string | null;
  coordinator: { liveness: Liveness; lastSeen: string | null };
  integrated: number; total: number;
  slots: ExecSlot[]; queued: string[]; conflicts: string[]; blocked: string[]; orphans: string[];
  agents: { id: string; type: string; since: string }[];
}

/** The liveness of a local signal: by its age (no lease to read), stopped at once when its session ended. */
export function signalLiveness(ts: string | null, ended: boolean, now: number): Liveness {
  const t = ts ? Date.parse(ts) : NaN;
  if (ended || !Number.isFinite(t)) return 'stopped';
  const age = now - t;
  return age < LIVE_SILENT_MINUTES * 60000 ? 'alive' : age < LIVE_STOPPED_MINUTES * 60000 ? 'silent' : 'stopped';
}

export function executionView(i: { exec: ExecutionState | null; tasks: Record<string, PublicTask>; live: LiveDoc[]; titles?: Record<string, string>; now: number }): ExecView | null {
  const e = i.exec;
  if (!e || (!e.active && e.stopReason !== 'stalled')) return null;
  const fresh = (d: LiveDoc) => i.now - Date.parse(d.ts) < LIVE_MAX_AGE_HOURS * 3600000;
  const signal = i.live.find(d => fresh(d) && d.role === 'coordinator' && d.runId === e.runId && (!e.hookSession || d.sessionId === e.hookSession)) ?? null;
  const times = [signal?.ts, e.lastStepAt].filter((x): x is string => !!x && Number.isFinite(Date.parse(x)));
  const lastSeen = times.length ? times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) : null;
  const coord: Liveness = !e.active ? 'stopped' : signal?.ended ? 'stopped' : signalLiveness(lastSeen, false, i.now);
  const ids = (status: string) => Object.keys(e.tasks).filter(id => e.tasks[id].status === status);
  const slots: ExecSlot[] = ids('running')
    .sort((a, b) => Date.parse(e.tasks[a].startedAt) - Date.parse(e.tasks[b].startedAt))
    .map(id => {
      const t = e.tasks[id];
      const p = i.tasks[id] && i.tasks[id].runId === e.runId ? i.tasks[id] : null;
      return {
        task: id, title: i.titles?.[id] ?? null, stage: p?.stage ?? t.stage, agent: p ? p.agent : t.agent, round: p?.round ?? t.round,
        since: p?.since ?? t.stageSince, liveness: p ? liveness(i.now, p.leaseUntil) : coord, mode: p?.mode ?? t.executor,
      };
    });
  return {
    runId: e.runId, mode: e.mode, parallel: e.parallel, branch: e.branch, active: e.active, stopReason: e.stopReason, stallReason: e.stallReason,
    coordinator: { liveness: coord, lastSeen }, integrated: ids('integrated').length, total: Object.keys(e.tasks).length,
    slots, queued: ids('accepted'), conflicts: ids('conflict'), blocked: ids('blocked'),
    orphans: slots.filter(s => s.liveness === 'stopped').map(s => s.task), agents: signal?.agents ?? [],
  };
}
