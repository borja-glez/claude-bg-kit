import { describe, it, expect } from 'vitest';
import { executionView, signalLiveness } from '../src/lib/execution-view.js';
import type { ExecutionState, PublicTask, LiveDoc } from '../src/lib/execution-state.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const at = (min: number) => new Date(NOW + min * 60000).toISOString();
const task = (status: 'running' | 'accepted' | 'integrated' | 'conflict' | 'blocked', startedMin = -10) => ({
  status, stage: 'implement' as const, round: 1, worktree: '/w', branch: 'task/x', executor: 'subagents' as const, attempts: 0, agent: 'forge-impl',
  startedAt: at(startedMin), updatedAt: at(-1), stageSince: at(-3), detail: null,
});
const exec = (over: Partial<ExecutionState> = {}): ExecutionState => ({
  runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
  coordinator: 'main', hookSession: 's1', active: true, stopReason: null, stallReason: null, startedAt: at(-60), lastStepAt: at(-2), lastBlockStep: null, sleepUntil: null,
  tasks: { T1: task('running', -20), T2: task('running', -5), T3: task('accepted'), T4: task('integrated'), T5: task('conflict') }, ...over,
});
const pub = (taskId: string, leaseMin: number, stage: PublicTask['stage'] = 'review'): PublicTask =>
  ({ task: taskId, runId: 'r1', stage, status: 'running', agent: 'forge-review-correctness', round: 2, since: at(-4), updatedAt: at(-1), leaseUntil: at(leaseMin), by: 'main', mode: 'subagents' });
const live = (tsMin: number, ended = false): LiveDoc => ({ sessionId: 's1', role: 'coordinator', runId: 'r1', task: null, event: 'Stop', ts: at(tsMin), agents: [{ id: 'a1', type: 'forge:forge-impl', since: at(-6) }], ended });

describe('executionView', () => {
  it('lists slots in start order with stage and agent from the public task, plus queue, conflicts and counts', () => {
    const v = executionView({ exec: exec(), tasks: { T1: pub('T1', 5) }, live: [live(-1)], titles: { T1: 'Login' }, now: NOW })!;
    expect(v.slots.map(s => s.task)).toEqual(['T1', 'T2']);
    expect(v.slots[0]).toMatchObject({ title: 'Login', stage: 'review', agent: 'forge-review-correctness', round: 2, liveness: 'alive' });
    expect(v.slots[1]).toMatchObject({ stage: 'implement', since: at(-3), liveness: 'alive' });
    expect(v).toMatchObject({ queued: ['T3'], conflicts: ['T5'], integrated: 1, total: 5, coordinator: { liveness: 'alive' } });
    expect(v.agents).toHaveLength(1);
  });
  it('a coordinator without SessionEnd goes silent, then stopped, by the age of its signal and steps', () => {
    expect(executionView({ exec: exec({ lastStepAt: at(-8) }), tasks: {}, live: [live(-8)], now: NOW })!.coordinator.liveness).toBe('silent');
    const v = executionView({ exec: exec({ lastStepAt: at(-13) }), tasks: {}, live: [live(-13)], now: NOW })!;
    expect(v.coordinator.liveness).toBe('stopped');
    expect(v.orphans).toEqual(['T1', 'T2']);
  });
  it('an ended signal is stopped at once; a 25-hour-old one is ignored', () => {
    expect(executionView({ exec: exec({ lastStepAt: null }), tasks: {}, live: [live(-1, true)], now: NOW })!.coordinator.liveness).toBe('stopped');
    expect(executionView({ exec: exec({ lastStepAt: null }), tasks: {}, live: [live(-25 * 60)], now: NOW })!.coordinator.lastSeen).toBeNull();
  });
  it('a task whose own lease stopped is an orphan even with a live coordinator', () => {
    const v = executionView({ exec: exec(), tasks: { T1: pub('T1', -6) }, live: [live(-1)], now: NOW })!;
    expect(v.slots[0].liveness).toBe('stopped');
    expect(v.orphans).toEqual(['T1']);
  });
  it('null without an execution or for a finished one; a stalled one stays to say why', () => {
    expect(executionView({ exec: null, tasks: {}, live: [], now: NOW })).toBeNull();
    expect(executionView({ exec: exec({ active: false, stopReason: 'finished' }), tasks: {}, live: [], now: NOW })).toBeNull();
    expect(executionView({ exec: exec({ active: false, stopReason: 'stalled', stallReason: 'blocked: T1' }), tasks: {}, live: [], now: NOW })).toMatchObject({ active: false, stallReason: 'blocked: T1', coordinator: { liveness: 'stopped' } });
  });
  it('signalLiveness thresholds', () => {
    expect(signalLiveness(at(-6.9), false, NOW)).toBe('alive');
    expect(signalLiveness(at(-7), false, NOW)).toBe('silent');
    expect(signalLiveness(at(-12), false, NOW)).toBe('stopped');
    expect(signalLiveness(null, false, NOW)).toBe('stopped');
  });
});
