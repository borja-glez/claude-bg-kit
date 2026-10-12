import type { Stage } from './types.js';
import type { SwarmState } from './swarm-state.js';

export type ExecMode = 'subagents' | 'sessions';
export type ExecTaskStatus = 'running' | 'accepted' | 'integrated' | 'conflict' | 'blocked';
export interface ExecTask {
  status: ExecTaskStatus; stage: Stage; round: number; worktree: string; branch: string;
  executor: 'subagents' | 'sessions' | 'manual'; attempts: number; agent: string | null;
  startedAt: string; updatedAt: string; detail: string | null;
}
export type ExecStopReason = 'finished' | 'stalled' | 'stopped' | 'budget' | 'migrated';
export interface ExecutionState {
  runId: string; kind: 'plan' | 'ephemeral'; mode: ExecMode; parallel: number; project: string;
  base: string; branch: string; mergeOnFinish: boolean; coordinator: string; hookSession: string | null;
  active: boolean; stopReason: ExecStopReason | null; stallReason: string | null;
  startedAt: string; lastStepAt: string | null; lastBlockStep: string | null; sleepUntil: string | null;
  tasks: Record<string, ExecTask>;
}

export const STAGES: readonly Stage[] = ['brief', 'implement', 'validate', 'verify', 'review', 'verdict', 'integrate'];
const TASK_STATUSES: readonly ExecTaskStatus[] = ['running', 'accepted', 'integrated', 'conflict', 'blocked'];
const STOPS: readonly ExecStopReason[] = ['finished', 'stalled', 'stopped', 'budget', 'migrated'];
const ID = /^[A-Za-z0-9_\-.~:@+]{1,80}$/;
const MAX_TASKS = 500;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === 'string' && x ? x : null);
const iso = (x: unknown): string | null => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? x : null);
const int = (x: unknown, min: number, max: number, dflt: number): number =>
  typeof x === 'number' && Number.isInteger(x) ? Math.min(max, Math.max(min, x)) : dflt;
const oneOf = <T extends string>(list: readonly T[], x: unknown): T | null => ((list as readonly unknown[]).includes(x) ? (x as T) : null);

function normalizeTask(x: unknown): ExecTask | null {
  if (!isObj(x)) return null;
  const status = oneOf(TASK_STATUSES, x.status);
  const stage = oneOf(STAGES, x.stage);
  const executor = oneOf(['subagents', 'sessions', 'manual'] as const, x.executor);
  // An empty worktree is valid: the scheduler creates the task before its worktree exists.
  const worktree = typeof x.worktree === 'string' ? x.worktree : null;
  const branch = str(x.branch);
  const startedAt = iso(x.startedAt);
  if (!status || !stage || !executor || worktree === null || !branch || !startedAt) return null;
  return {
    status, stage, executor, worktree, branch, startedAt,
    round: int(x.round, 0, 99, 0), attempts: int(x.attempts, 0, 99, 0),
    agent: str(x.agent), updatedAt: iso(x.updatedAt) ?? startedAt, detail: typeof x.detail === 'string' ? x.detail.slice(0, 500) : null,
  };
}

export function normalizeExecution(x: unknown): ExecutionState | null {
  if (!isObj(x)) return null;
  const mode = oneOf(['subagents', 'sessions'] as const, x.mode);
  const kind = oneOf(['plan', 'ephemeral'] as const, x.kind) ?? 'plan';
  const runId = str(x.runId), project = str(x.project), base = str(x.base), branch = str(x.branch), coordinator = str(x.coordinator);
  const startedAt = iso(x.startedAt);
  if (!mode || !runId || !project || !base || !branch || !coordinator || !startedAt) return null;
  const tasks: Record<string, ExecTask> = {};
  if (isObj(x.tasks)) {
    for (const [id, t] of Object.entries(x.tasks).slice(0, MAX_TASKS)) {
      const n = ID.test(id) ? normalizeTask(t) : null;
      if (n) tasks[id] = n;
    }
  }
  return {
    runId, kind, mode, project, base, branch, coordinator, startedAt, tasks,
    parallel: int(x.parallel, 1, 10, 3),
    mergeOnFinish: x.mergeOnFinish === true,
    hookSession: str(x.hookSession),
    active: x.active === true,
    stopReason: oneOf(STOPS, x.stopReason),
    stallReason: typeof x.stallReason === 'string' ? x.stallReason.slice(0, 1000) : null,
    lastStepAt: iso(x.lastStepAt), lastBlockStep: iso(x.lastBlockStep), sleepUntil: iso(x.sleepUntil),
  };
}

export function parseExecution(text: string | null | undefined): ExecutionState | null {
  if (typeof text !== 'string') return null;
  try { return normalizeExecution(JSON.parse(text)); } catch { return null; }
}

/** An old swarm becomes a stopped execution: its fronts are not tasks, so nothing of it is resumed. */
export function fromSwarm(s: SwarmState): ExecutionState {
  return {
    runId: `swarm-${s.startedAt}`, kind: 'plan', mode: 'sessions', parallel: Math.min(10, Math.max(1, s.parallel)),
    project: s.project, base: s.base, branch: s.base, mergeOnFinish: s.mergeAuthorized, coordinator: s.coordinator,
    hookSession: s.hookSession, active: false, stopReason: 'migrated', stallReason: null, startedAt: s.startedAt,
    lastStepAt: s.lastTickAt, lastBlockStep: null, sleepUntil: null, tasks: {},
  };
}

export const runningTasks = (e: ExecutionState): string[] =>
  Object.entries(e.tasks).filter(([, t]) => t.status === 'running').map(([id]) => id);
