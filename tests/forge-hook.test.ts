import { describe, it, expect } from 'vitest';
import { startRun, recordCycle } from '../src/forge/run.js';
import { decideStop, decideSwarmStop } from '../src/forge/hook.js';
import { emptyFront, type SwarmState } from '../src/lib/swarm-state.js';

const T0 = new Date('2026-10-11T10:00:00.000Z');
const ctx = (over: Partial<{ now: Date; stopFile: boolean; approvedPending: number; pendingProposals: number; ledgerEvents: number }> = {}) =>
  ({ now: T0, stopFile: false, approvedPending: 0, pendingProposals: 0, ledgerEvents: 5, ...over });

describe('decideStop', () => {
  it('does not block without a run or with an inactive one', () => {
    expect(decideStop({}, null, ctx())).toEqual({ block: false, run: null });
    const off = { ...startRun(T0, {}), active: false };
    expect(decideStop({}, off, ctx())).toEqual({ block: false, run: off });
  });
  it('blocks an active run and records the ledger event count', () => {
    const d = decideStop({ stop_hook_active: false }, startRun(T0, { cycles: 3 }), ctx());
    expect(d.block).toBe(true);
    if (!d.block) return;
    expect(d.run.lastBlockEvents).toBe(5);
    expect(d.reason).toContain('forge infinite mode is active (cycle 1 of 3)');
    expect(d.reason).toContain('.forge/stop');
    expect(d.reason).toContain('/forge:stop');
  });
  it('names the end time for an hours budget', () => {
    const d = decideStop({}, startRun(T0, { hours: 2 }), ctx());
    expect(d.block && d.reason).toContain('until 12:00 UTC');
  });
  it('lets the stop through with stop_hook_active when the ledger has no new events', () => {
    const run = { ...startRun(T0, {}), lastBlockEvents: 5 };
    expect(decideStop({ stop_hook_active: true }, run, ctx())).toEqual({ block: false, run });
  });
  it('blocks again with stop_hook_active when the ledger has new events', () => {
    const run = { ...startRun(T0, {}), lastBlockEvents: 5 };
    const d = decideStop({ stop_hook_active: true }, run, ctx({ ledgerEvents: 7 }));
    expect(d.block).toBe(true);
    expect(d.run?.lastBlockEvents).toBe(7);
  });
  it('a stop reason marks the run inactive and blocks once to close it', () => {
    const d = decideStop({}, startRun(T0, {}), ctx({ stopFile: true }));
    expect(d.block).toBe(true);
    if (!d.block) return;
    expect(d.ended).toBe('stop-file');
    expect(d.reason).toBe('the forge infinite run ended (stop-file): do step 4 of /forge:infinite (turn off meta/infinite and report), then stop');
    expect(d.run).toMatchObject({ active: false, stoppedReason: 'stop-file' });
    // Once inactive it never blocks again, whatever the context.
    expect(decideStop({}, d.run, ctx({ stopFile: true }))).toEqual({ block: false, run: d.run });
    expect(decideStop({ stop_hook_active: true }, d.run, ctx({ ledgerEvents: 99 }))).toEqual({ block: false, run: d.run });
  });
  it('blocks once even with stop_hook_active and an unchanged ledger when the run ends', () => {
    const run = { ...startRun(T0, { cycles: 2 }), cycle: 2, lastBlockEvents: 5 };
    const d = decideStop({ stop_hook_active: true }, run, ctx());
    expect(d.block && d.ended).toBe('budget-cycles');
  });
  it('counts blocks since the last cycle and ends the run with no-cycle after 2', () => {
    let run = startRun(T0, {});
    const first = decideStop({}, run, ctx());
    expect(first.block && first.run.blocksSinceCycle).toBe(1);
    const second = decideStop({ stop_hook_active: true }, first.run!, ctx({ ledgerEvents: 6 }));
    expect(second.block && second.ended).toBeFalsy();
    expect(second.run?.blocksSinceCycle).toBe(2);
    const third = decideStop({ stop_hook_active: true }, second.run!, ctx({ ledgerEvents: 7 }));
    expect(third.block && third.ended).toBe('no-cycle');
    // A recorded cycle resets the count.
    run = recordCycle(second.run!, { progress: true });
    expect(run.blocksSinceCycle).toBe(0);
    const next = decideStop({}, run, ctx({ ledgerEvents: 8 }));
    expect(next.block).toBe(true);
    expect(next.run).toMatchObject({ active: true, blocksSinceCycle: 1 });
  });
  it('binds the run to the session of its first block', () => {
    const d = decideStop({ session_id: 'a' }, startRun(T0, {}), ctx());
    expect(d.block).toBe(true);
    expect(d.run?.sessionId).toBe('a');
  });
  it('never blocks another session or a call without a session id once bound', () => {
    const run = startRun(T0, {}, 10, 'a');
    expect(decideStop({ session_id: 'b' }, run, ctx())).toEqual({ block: false, run });
    expect(decideStop({}, run, ctx())).toEqual({ block: false, run });
    expect(decideStop({ session_id: 'b' }, run, ctx({ stopFile: true }))).toEqual({ block: false, run });
  });
  it('the bound session still follows the usual rules', () => {
    const run = startRun(T0, {}, 10, 'a');
    const d = decideStop({ session_id: 'a' }, run, ctx());
    expect(d.block).toBe(true);
    expect(decideStop({ session_id: 'a', stop_hook_active: true }, d.run!, ctx())).toEqual({ block: false, run: d.run });
    const ended = decideStop({ session_id: 'a' }, run, ctx({ stopFile: true }));
    expect(ended.block).toBe(true);
    expect(ended.run).toMatchObject({ active: false, stoppedReason: 'stop-file', sessionId: 'a' });
  });
});

const sw = (over: Partial<SwarmState> = {}): SwarmState => ({
  active: true, parallel: 5, mergeAuthorized: true, project: 'shop', base: 'main', coordinator: 'main', hookSession: null,
  startedAt: T0.toISOString(), lastTickAt: '2026-10-11T10:05:00.000Z', lastBlockTick: null, sleepUntil: null,
  stopReason: null, stallReason: null, notice: null, fronts: { a: { ...emptyFront(), status: 'running' } }, ...over,
});
const sctx = (over: Partial<{ now: Date; stopFile: boolean }> = {}) => ({ now: T0, stopFile: false, ...over });

describe('decideSwarmStop', () => {
  it('does not block without an active swarm', () => {
    expect(decideSwarmStop({}, null, sctx()).block).toBe(false);
    expect(decideSwarmStop({}, sw({ active: false }), sctx()).block).toBe(false);
  });
  it('blocks, binds the session and records the tick it blocked on', () => {
    const d = decideSwarmStop({ session_id: 's1' }, sw(), sctx());
    expect(d.block).toBe(true);
    if (!d.block) return;
    expect(d.reason).toContain('forge swarm is active (1/5 slots)');
    expect(d.swarm).toMatchObject({ hookSession: 's1', lastBlockTick: '2026-10-11T10:05:00.000Z' });
  });
  it('leaves other sessions alone once bound', () => {
    expect(decideSwarmStop({ session_id: 's2' }, sw({ hookSession: 's1' }), sctx()).block).toBe(false);
  });
  it('does not block while sleeping', () => {
    expect(decideSwarmStop({ session_id: 's1' }, sw({ sleepUntil: '2026-10-11T10:03:00.000Z' }), sctx()).block).toBe(false);
    expect(decideSwarmStop({ session_id: 's1' }, sw({ sleepUntil: '2026-10-11T09:59:00.000Z' }), sctx()).block).toBe(true);
  });
  it('with stop_hook_active blocks again only after a new tick', () => {
    const blocked = sw({ lastBlockTick: '2026-10-11T10:05:00.000Z' });
    expect(decideSwarmStop({ stop_hook_active: true }, blocked, sctx()).block).toBe(false);
    expect(decideSwarmStop({ stop_hook_active: true }, { ...blocked, lastTickAt: '2026-10-11T10:09:00.000Z' }, sctx()).block).toBe(true);
  });
  it('the stop file ends the swarm and blocks once to report', () => {
    const d = decideSwarmStop({}, sw(), sctx({ stopFile: true }));
    expect(d.block && d.ended).toBe('stopped');
    expect(d.swarm).toMatchObject({ active: false, stopReason: 'stopped' });
  });
});

describe('decideStop with a sleeping swarm', () => {
  it('does not block the infinite run while the swarm sleeps', () => {
    const run = startRun(T0, { cycles: 3 });
    expect(decideStop({}, run, { ...ctx(), swarmSleeping: true }).block).toBe(false);
    expect(decideStop({}, run, { ...ctx(), swarmSleeping: false }).block).toBe(true);
  });
});
