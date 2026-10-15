import { describe, it, expect } from 'vitest';
import { startRun, recordCycle } from '../src/forge/run.js';
import { decideStop, decideExecutionStop } from '../src/forge/hook.js';
import type { ExecutionState } from '../src/lib/execution-state.js';

const T0 = new Date('2026-10-11T10:00:00.000Z');
const ctx = (over: Partial<{ now: Date; stopFile: boolean; approvedPending: number; pendingProposals: number; ledgerEvents: number }> = {}) =>
  ({ now: T0, stopFile: false, approvedPending: 0, pendingProposals: 0, ledgerEvents: 5, ...over });

// A run is bound to its session when it starts (C1, K5-03): that session's Stop hook input carries its id.
const A = { session_id: 'a' };
const bound = (budget: Parameters<typeof startRun>[1] = {}) => startRun(T0, budget, 10, 'a');

describe('decideStop', () => {
  it('does not block without a run or with an inactive one', () => {
    expect(decideStop(A, null, ctx())).toEqual({ block: false, run: null });
    const off = { ...bound(), active: false };
    expect(decideStop(A, off, ctx())).toEqual({ block: false, run: off });
  });
  it('blocks an active run and records the ledger event count', () => {
    const d = decideStop({ ...A, stop_hook_active: false }, bound({ cycles: 3 }), ctx());
    expect(d.block).toBe(true);
    if (!d.block) return;
    expect(d.run.lastBlockEvents).toBe(5);
    expect(d.reason).toContain('forge infinite mode is active (cycle 1 of 3)');
    expect(d.reason).toContain('.forge/stop');
    expect(d.reason).toContain('/forge:stop');
  });
  it('names the end time for an hours budget', () => {
    const d = decideStop(A, bound({ hours: 2 }), ctx());
    expect(d.block && d.reason).toContain('until 12:00 UTC');
  });
  it('lets the stop through with stop_hook_active when the ledger has no new events', () => {
    const run = { ...bound(), lastBlockEvents: 5 };
    expect(decideStop({ ...A, stop_hook_active: true }, run, ctx())).toEqual({ block: false, run });
  });
  it('blocks again with stop_hook_active when the ledger has new events', () => {
    const run = { ...bound(), lastBlockEvents: 5 };
    const d = decideStop({ ...A, stop_hook_active: true }, run, ctx({ ledgerEvents: 7 }));
    expect(d.block).toBe(true);
    expect(d.run?.lastBlockEvents).toBe(7);
  });
  it('a stop reason marks the run inactive and blocks once to close it', () => {
    const d = decideStop(A, bound(), ctx({ stopFile: true }));
    expect(d.block).toBe(true);
    if (!d.block) return;
    expect(d.ended).toBe('stop-file');
    expect(d.reason).toBe('the forge infinite run ended (stop-file): do step 4 of /forge:infinite (turn off meta/infinite and report), then stop.');
    expect(d.run).toMatchObject({ active: false, stoppedReason: 'stop-file', sessionId: 'a' });
    // Once inactive it never blocks again, whatever the context.
    expect(decideStop(A, d.run, ctx({ stopFile: true }))).toEqual({ block: false, run: d.run });
    expect(decideStop({ ...A, stop_hook_active: true }, d.run, ctx({ ledgerEvents: 99 }))).toEqual({ block: false, run: d.run });
  });
  it('blocks once even with stop_hook_active and an unchanged ledger when the run ends', () => {
    const run = { ...bound({ cycles: 2 }), cycle: 2, lastBlockEvents: 5 };
    const d = decideStop({ ...A, stop_hook_active: true }, run, ctx());
    expect(d.block && d.ended).toBe('budget-cycles');
  });
  it('counts blocks since the last cycle and ends the run with no-cycle after 2', () => {
    let run = bound();
    const first = decideStop(A, run, ctx());
    expect(first.block && first.run.blocksSinceCycle).toBe(1);
    const second = decideStop({ ...A, stop_hook_active: true }, first.run!, ctx({ ledgerEvents: 6 }));
    expect(second.block && second.ended).toBeFalsy();
    expect(second.run?.blocksSinceCycle).toBe(2);
    const third = decideStop({ ...A, stop_hook_active: true }, second.run!, ctx({ ledgerEvents: 7 }));
    expect(third.block && third.ended).toBe('no-cycle');
    // A recorded cycle resets the count.
    run = recordCycle(second.run!, { progress: true });
    expect(run.blocksSinceCycle).toBe(0);
    const next = decideStop(A, run, ctx({ ledgerEvents: 8 }));
    expect(next.block).toBe(true);
    expect(next.run).toMatchObject({ active: true, blocksSinceCycle: 1 });
  });
  it('never blocks another session or a call without a session id', () => {
    const run = bound();
    expect(decideStop({ session_id: 'b' }, run, ctx())).toEqual({ block: false, run });
    expect(decideStop({}, run, ctx())).toEqual({ block: false, run });
    expect(decideStop({ session_id: 'b' }, run, ctx({ stopFile: true }))).toEqual({ block: false, run });
  });
  it('a run without a session (started by forge 0.15) blocks no one and is never bound (K5-03)', () => {
    const run = startRun(T0, { cycles: 3 });
    for (const input of [{}, A, { session_id: 'b', stop_hook_active: true }]) {
      expect(decideStop(input, run, ctx())).toEqual({ block: false, run });
      expect(decideStop(input, run, ctx({ stopFile: true }))).toEqual({ block: false, run });
    }
  });
  it('the bound session still follows the usual rules', () => {
    const run = bound();
    const d = decideStop(A, run, ctx());
    expect(d.block).toBe(true);
    expect(decideStop({ ...A, stop_hook_active: true }, d.run!, ctx())).toEqual({ block: false, run: d.run });
    const ended = decideStop(A, run, ctx({ stopFile: true }));
    expect(ended.block).toBe(true);
    expect(ended.run).toMatchObject({ active: false, stoppedReason: 'stop-file', sessionId: 'a' });
  });
});

const ex = (over: Partial<ExecutionState> = {}): ExecutionState => ({
  runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
  coordinator: 'main', hookSession: 's1', active: true, stopReason: null, stallReason: null, startedAt: '2026-10-12T11:00:00.000Z',
  lastStepAt: '2026-10-12T11:59:00.000Z', lastBlockStep: null, sleepUntil: null, tasks: {}, ...over,
});
const xnow = new Date('2026-10-12T12:00:00.000Z');
const xtask = (agent: string | null, updatedAt: string) => ({ T1: { status: 'running' as const, stage: 'implement' as const, round: 1, worktree: '/w', branch: 'task/T1', executor: 'subagents' as const, attempts: 0, agent, startedAt: updatedAt, stageSince: updatedAt, updatedAt, detail: null } });

describe('decideExecutionStop', () => {
  it('blocks the bound session of an active execution once per step, and no other session', () => {
    const d = decideExecutionStop({ session_id: 's1' }, ex(), { now: xnow, stopFile: false });
    expect(d.block).toBe(true);
    if (d.block) expect(d.reason).toContain('forge execution is active (0/3 running)');
    expect(decideExecutionStop({ session_id: 's2' }, ex(), { now: xnow, stopFile: false }).block).toBe(false);
    expect(decideExecutionStop({}, ex(), { now: xnow, stopFile: false }).block).toBe(false);
    expect(decideExecutionStop({ session_id: 's1', stop_hook_active: true }, ex({ lastBlockStep: '2026-10-12T11:59:00.000Z' }), { now: xnow, stopFile: false }).block).toBe(false);
  });
  it('never blocks while an agent of a task is running (it wakes the session)', () => {
    expect(decideExecutionStop({ session_id: 's1' }, ex({ tasks: xtask('forge-impl', '2026-10-12T11:58:00.000Z') }), { now: xnow, stopFile: false }).block).toBe(false);
    // An agent that has not reported for longer than a lease does not hold the block back.
    expect(decideExecutionStop({ session_id: 's1' }, ex({ tasks: xtask('forge-impl', '2026-10-12T11:40:00.000Z') }), { now: xnow, stopFile: false }).block).toBe(true);
  });
  it('an unbound execution (started by forge 0.15) blocks no session and comes back unchanged (D-01)', () => {
    const unbound = ex({ hookSession: null });
    for (const input of [{}, { session_id: 's1' }, { session_id: 's1', stop_hook_active: true }]) {
      expect(decideExecutionStop(input, unbound, { now: xnow, stopFile: false })).toEqual({ block: false, exec: unbound });
      expect(decideExecutionStop(input, unbound, { now: xnow, stopFile: true })).toEqual({ block: false, exec: unbound });
    }
  });
  it('does not block while sleeping, and ends with one block when the stop file appears', () => {
    expect(decideExecutionStop({ session_id: 's1' }, ex({ sleepUntil: '2026-10-12T12:03:00.000Z' }), { now: xnow, stopFile: false }).block).toBe(false);
    const d = decideExecutionStop({ session_id: 's1' }, ex(), { now: xnow, stopFile: true });
    expect(d).toMatchObject({ block: true, ended: 'stopped', exec: { active: false, stopReason: 'stopped' } });
  });
});

describe('decideStop with a sleeping swarm', () => {
  it('does not block the infinite run while the swarm sleeps', () => {
    const run = bound({ cycles: 3 });
    expect(decideStop(A, run, { ...ctx(), swarmSleeping: true }).block).toBe(false);
    expect(decideStop(A, run, { ...ctx(), swarmSleeping: false }).block).toBe(true);
  });
});
