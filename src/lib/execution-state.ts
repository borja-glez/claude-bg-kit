import { STAGES, type Stage } from './types.js';
import type { SwarmState } from './swarm-state.js';
import { isPlanId } from './plan.js';
import { isLocale } from './forge-run.js';

/**
 * The one rule for a session or run id that names a file or reaches the model's context: no `:` (an NTFS stream),
 * `/`, `..`, spaces or control characters, at most 120 characters.
 */
const SAFE_ID = /^[A-Za-z0-9_\-.]{1,120}$/;
export const isSafeId = (s: unknown): s is string => typeof s === 'string' && SAFE_ID.test(s) && s !== '.' && s !== '..';
/** The run branch rule of `swarm start`: at most 120 characters, no leading dash, no `..`. */
const RUN_BRANCH = /^[A-Za-z0-9_./][A-Za-z0-9_\-./]{0,119}$/;
export const isRunBranch = (s: unknown): s is string => typeof s === 'string' && RUN_BRANCH.test(s) && !s.includes('..');

export type ExecMode = 'subagents' | 'sessions';
/** stopped (D3): forge stop stopped the task while it ran; swarm close and the end of a run release it like a running one. */
export type ExecTaskStatus = 'running' | 'accepted' | 'integrated' | 'conflict' | 'blocked' | 'stopped';
export interface ExecTask {
  status: ExecTaskStatus; stage: Stage; round: number; worktree: string; branch: string;
  executor: 'subagents' | 'sessions' | 'manual'; attempts: number; agent: string | null;
  startedAt: string; stageSince: string; updatedAt: string; detail: string | null;
  nudgedAt?: string | null;
  /** When the task last finished (integrated, blocked, or handed over by `retry --adopt`); null or absent before. */
  finishedAt?: string | null;
  title?: string | null;
}
export type ExecStopReason = 'finished' | 'stalled' | 'stopped' | 'budget' | 'migrated';
export interface ExecutionState {
  runId: string; kind: 'plan' | 'ephemeral'; mode: ExecMode; parallel: number; project: string;
  base: string; branch: string; mergeOnFinish: boolean; coordinator: string; hookSession: string | null;
  active: boolean; stopReason: ExecStopReason | null; stallReason: string | null;
  startedAt: string; lastStepAt: string | null; lastBlockStep: string | null; sleepUntil: string | null;
  tasks: Record<string, ExecTask>;
  /** How many tasks the run plans in all (the plan's, or the loose file's), so the total is not just those started. */
  planned?: number;
  /** Started in auto mode (spec §5.5): the coordinator keeps deciding alone when it resumes. */
  autonomy?: 'auto';
  /** The language the person writes in (`swarm start --locale`), repeated to the coordinator at each wake. */
  locale?: string;
  /** C2: when `swarm merge` or `swarm close` closed it; a closed execution is drawn nowhere. Null or absent while open. */
  closedAt?: string | null;
  /** C2: what closed it; null without a closedAt. */
  closedBy?: 'merge' | 'close' | null;
}

// STAGES lives in types.ts (pure, so the roadmap page can bundle it without this file's yaml/zod imports); re-exported here.
export { STAGES };
const TASK_STATUSES: readonly ExecTaskStatus[] = ['running', 'accepted', 'integrated', 'conflict', 'blocked', 'stopped'];
const STOPS: readonly ExecStopReason[] = ['finished', 'stalled', 'stopped', 'budget', 'migrated'];
const MAX_TASKS = 500;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === 'string' && x ? x : null);
const iso = (x: unknown): string | null => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? x : null);
/** A finishedAt more than this ahead of the reader's clock is dropped. */
export const FUTURE_SKEW_MS = 120_000;
// An ISO finishedAt; with the reader's clock, not more than FUTURE_SKEW_MS ahead of it.
const finishedOf = (x: unknown, now?: number): string | null => {
  const v = iso(x);
  if (!v) return null;
  return now !== undefined && Number.isFinite(now) && Date.parse(v) - now > FUTURE_SKEW_MS ? null : v;
};
const int = (x: unknown, min: number, max: number, dflt: number): number =>
  typeof x === 'number' && Number.isInteger(x) ? Math.min(max, Math.max(min, x)) : dflt;
const oneOf = <T extends string>(list: readonly T[], x: unknown): T | null => ((list as readonly unknown[]).includes(x) ? (x as T) : null);

/** Free text that reaches lens, the band and the terminal: no control characters, trimmed, at most 200 characters. */
// eslint-disable-next-line no-control-regex
const cleanTitle = (x: unknown): string => (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 200) : '');

function normalizeTask(x: unknown, now?: number): ExecTask | null {
  if (!isObj(x)) return null;
  const status = oneOf(TASK_STATUSES, x.status);
  const stage = oneOf(STAGES, x.stage);
  const executor = oneOf(['subagents', 'sessions', 'manual'] as const, x.executor);
  // An empty worktree is valid: the scheduler creates the task before its worktree exists.
  const worktree = typeof x.worktree === 'string' ? x.worktree : null;
  const branch = str(x.branch);
  const startedAt = iso(x.startedAt);
  if (!status || !stage || !executor || worktree === null || !branch || !startedAt) return null;
  const title = cleanTitle(x.title);
  return {
    status, stage, executor, worktree, branch, startedAt, stageSince: iso(x.stageSince) ?? startedAt,
    round: int(x.round, 0, 99, 0), attempts: int(x.attempts, 0, 99, 0),
    agent: str(x.agent), updatedAt: iso(x.updatedAt) ?? startedAt, detail: typeof x.detail === 'string' ? x.detail.slice(0, 500) : null,
    ...(iso(x.nudgedAt) ? { nudgedAt: iso(x.nudgedAt) } : {}),
    ...(finishedOf(x.finishedAt, now) ? { finishedAt: finishedOf(x.finishedAt, now) } : {}),
    ...(title ? { title } : {}),
  };
}

export function normalizeExecution(x: unknown, now?: number): ExecutionState | null {
  if (!isObj(x)) return null;
  const mode = oneOf(['subagents', 'sessions'] as const, x.mode);
  const kind = oneOf(['plan', 'ephemeral'] as const, x.kind) ?? 'plan';
  const runId = str(x.runId), project = str(x.project), base = str(x.base), branch = str(x.branch), coordinator = str(x.coordinator);
  const startedAt = iso(x.startedAt);
  if (!mode || !runId || !project || !base || !branch || !coordinator || !startedAt) return null;
  // These reach the model's context (SessionStart) and name files: a crafted value makes the whole execution invalid.
  if (!isSafeId(runId) || !isSafeId(coordinator) || !isRunBranch(branch)) return null;
  const tasks: Record<string, ExecTask> = {};
  if (isObj(x.tasks)) {
    for (const [id, t] of Object.entries(x.tasks).slice(0, MAX_TASKS)) {
      const n = isPlanId(id) ? normalizeTask(t, now) : null;
      if (n) tasks[id] = n;
    }
  }
  return {
    runId, kind, mode, project, base, branch, coordinator, startedAt, tasks,
    parallel: int(x.parallel, 1, 10, 3),
    mergeOnFinish: x.mergeOnFinish === true,
    hookSession: isSafeId(x.hookSession) ? x.hookSession : null,
    active: x.active === true,
    stopReason: oneOf(STOPS, x.stopReason),
    stallReason: typeof x.stallReason === 'string' ? x.stallReason.slice(0, 1000) : null,
    lastStepAt: iso(x.lastStepAt), lastBlockStep: iso(x.lastBlockStep), sleepUntil: iso(x.sleepUntil),
    // C2: closedBy only means something with a closedAt; an older file has neither.
    closedAt: iso(x.closedAt), closedBy: iso(x.closedAt) ? oneOf(['merge', 'close'] as const, x.closedBy) : null,
    ...(typeof x.planned === 'number' && Number.isInteger(x.planned) ? { planned: Math.min(MAX_TASKS, Math.max(0, x.planned)) } : {}),
    ...(x.autonomy === 'auto' ? { autonomy: 'auto' as const } : {}),
    ...(isLocale(x.locale) ? { locale: x.locale } : {}),
  };
}

export function parseExecution(text: string | null | undefined, now?: number): ExecutionState | null {
  if (typeof text !== 'string') return null;
  try { return normalizeExecution(JSON.parse(text), now); } catch { return null; }
}

/** An old swarm becomes a stopped execution: its fronts are not tasks, so nothing of it is resumed. */
export function fromSwarm(s: SwarmState): ExecutionState {
  return {
    runId: `swarm-${s.startedAt.replace(/[:.]/g, '')}`, kind: 'plan', mode: 'sessions', parallel: Math.min(10, Math.max(1, s.parallel)),
    project: s.project, base: s.base, branch: s.base, mergeOnFinish: s.mergeAuthorized, coordinator: s.coordinator,
    hookSession: s.hookSession, active: false, stopReason: 'migrated', stallReason: null, startedAt: s.startedAt,
    lastStepAt: s.lastTickAt, lastBlockStep: null, sleepUntil: null, tasks: {}, closedAt: null, closedBy: null,
  };
}

export const runningTasks = (e: ExecutionState): string[] =>
  Object.entries(e.tasks).filter(([, t]) => t.status === 'running').map(([id]) => id);

export interface PublicTask {
  task: string; runId: string; stage: Stage; status: ExecTaskStatus; agent: string | null; round: number;
  since: string; updatedAt: string; leaseUntil: string; by: string; mode: 'subagents' | 'sessions' | 'manual';
}
export function normalizePublicTask(x: unknown): PublicTask | null {
  if (!isObj(x)) return null;
  const task = str(x.task), runId = str(x.runId), by = str(x.by);
  const stage = oneOf(STAGES, x.stage), status = oneOf(TASK_STATUSES, x.status), mode = oneOf(['subagents', 'sessions', 'manual'] as const, x.mode);
  const since = iso(x.since), updatedAt = iso(x.updatedAt), leaseUntil = iso(x.leaseUntil);
  if (!task || !isPlanId(task) || !runId || !by || !stage || !status || !mode || !since || !updatedAt || !leaseUntil) return null;
  return { task, runId, stage, status, mode, by, since, updatedAt, leaseUntil, agent: str(x.agent), round: int(x.round, 0, 99, 0) };
}

export interface LiveDoc {
  sessionId: string; role: 'coordinator' | 'executor' | 'manual'; runId: string | null; task: string | null;
  event: string; ts: string; agents: { id: string; type: string; since: string }[]; ended: boolean;
}
/** A local signal older than this reads as silent, older than the next as stopped; one ended is stopped at once. */
export const LIVE_SILENT_MINUTES = 7;
export const LIVE_STOPPED_MINUTES = 12;
/** Signals older than this are leftovers of past sessions: readers ignore them. */
export const LIVE_MAX_AGE_HOURS = 24;
/** A live signal, a member file or a task file of the execution larger than this is not read (the band and waypoint's
 *  hooks alike). */
export const FORGE_DOC_MAX_BYTES = 8 * 1024;
export function normalizeLive(x: unknown): LiveDoc | null {
  if (!isObj(x)) return null;
  const sessionId = str(x.sessionId), ts = iso(x.ts);
  const role = oneOf(['coordinator', 'executor', 'manual'] as const, x.role);
  if (!sessionId || !ts || !role) return null;
  const agents = Array.isArray(x.agents)
    ? x.agents.filter(isObj).map(a => ({ id: str(a.id), type: str(a.type) ?? '', since: iso(a.since) }))
      .filter((a): a is { id: string; type: string; since: string } => !!a.id && !!a.since).slice(0, 20)
    : [];
  return { sessionId, role, ts, agents, runId: str(x.runId), task: str(x.task), event: (str(x.event) ?? '').slice(0, 40), ended: x.ended === true };
}
