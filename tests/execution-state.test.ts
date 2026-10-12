import { describe, it, expect } from 'vitest';
import { parseExecution, normalizeExecution, normalizePublicTask, normalizeLive, fromSwarm, runningTasks, type ExecutionState } from '../src/lib/execution-state.js';
import type { SwarmState } from '../src/lib/swarm-state.js';

const T = '2026-10-12T12:00:00.000Z';
const base: ExecutionState = {
  runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop',
  mergeOnFinish: false, coordinator: 'main', hookSession: null, active: true, stopReason: null, stallReason: null,
  startedAt: T, lastStepAt: null, lastBlockStep: null, sleepUntil: null,
  tasks: {
    T1: { status: 'running', stage: 'implement', round: 1, worktree: '/r/.claude/worktrees/task-T1', branch: 'task/T1', executor: 'subagents', attempts: 0, agent: 'forge-impl', startedAt: T, stageSince: T, updatedAt: T, detail: null },
    T2: { status: 'integrated', stage: 'integrate', round: 1, worktree: '/r/.claude/worktrees/task-T2', branch: 'task/T2', executor: 'subagents', attempts: 0, agent: null, startedAt: T, stageSince: T, updatedAt: T, detail: null },
  },
};

describe('execution state', () => {
  it('round-trips and lists running tasks', () => {
    expect(parseExecution(JSON.stringify(base))).toEqual(base);
    expect(runningTasks(base)).toEqual(['T1']);
  });
  it('keeps stageSince, defaulting to startedAt', () => {
    const t = { ...base.tasks.T1 } as Record<string, unknown>; delete t.stageSince;
    expect(normalizeExecution({ ...base, tasks: { T1: t } })!.tasks.T1.stageSince).toBe(T);
  });
  it('normalizes public task and live docs, rejecting junk', () => {
    expect(normalizePublicTask({ task: 'T1', runId: 'r1', stage: 'review', status: 'running', agent: 'forge-impl', round: 2, since: T, updatedAt: T, leaseUntil: T, by: 'main', mode: 'subagents' })).toMatchObject({ task: 'T1', stage: 'review' });
    expect(normalizePublicTask({ task: 'T1', stage: 'nope' })).toBeNull();
    expect(normalizeLive({ sessionId: 's1', role: 'coordinator', runId: 'r1', task: null, event: 'Stop', ts: T, agents: [{ id: 'a1', type: 'forge:forge-impl', since: T }, { id: 5 }], ended: false }))
      .toEqual({ sessionId: 's1', role: 'coordinator', runId: 'r1', task: null, event: 'Stop', ts: T, agents: [{ id: 'a1', type: 'forge:forge-impl', since: T }], ended: false });
    expect(normalizeLive({ sessionId: 's1', role: 'boss', ts: T })).toBeNull();
  });
  it('rejects junk and drops invalid tasks instead of failing', () => {
    expect(parseExecution('{oops')).toBeNull();
    expect(parseExecution(null)).toBeNull();
    expect(normalizeExecution({ ...base, mode: 'nope' })).toBeNull();
    const e = normalizeExecution({ ...base, tasks: { T1: base.tasks.T1, bad: { status: 'zzz' }, 'x y': base.tasks.T1 } })!;
    expect(Object.keys(e.tasks)).toEqual(['T1']);
  });
  it('accepts a task whose worktree is still empty (filled in later by the scheduler)', () => {
    const e = normalizeExecution({ ...base, tasks: { T1: { ...base.tasks.T1, worktree: '' } } })!;
    expect(Object.keys(e.tasks)).toEqual(['T1']);
    expect(e.tasks.T1.worktree).toBe('');
  });
  it('clamps parallel to 1-10', () => {
    expect(normalizeExecution({ ...base, parallel: 50 })!.parallel).toBe(10);
    expect(normalizeExecution({ ...base, parallel: 0 })!.parallel).toBe(1);
  });
  it('migrates a swarm as stopped, keeping its project, base and coordinator', () => {
    const s: SwarmState = {
      active: true, parallel: 5, mergeAuthorized: true, project: 'shop', base: 'main', coordinator: 'main', hookSession: 'h1',
      startedAt: T, lastTickAt: T, lastBlockTick: null, sleepUntil: null, stopReason: null, stallReason: null, notice: null, fronts: {},
    };
    expect(fromSwarm(s)).toMatchObject({
      active: false, stopReason: 'migrated', project: 'shop', base: 'main', coordinator: 'main', mode: 'sessions',
      parallel: 5, mergeOnFinish: true, branch: 'main', tasks: {},
    });
  });
});
