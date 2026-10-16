import { describe, it, expect } from 'vitest';
import { executionView, isVisibleRun, signalLiveness, STALE_RUN_TTL_MS, lastMovedAt } from '../src/lib/execution-view.js';
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
const live = (tsMin: number, ended = false, agents: LiveDoc['agents'] = [{ id: 'a1', type: 'forge:forge-impl', since: at(-6) }]): LiveDoc =>
  ({ sessionId: 's1', role: 'coordinator', runId: 'r1', task: null, event: 'Stop', ts: at(tsMin), agents, ended });
/** A signal that lists no agent: its age alone decides. */
const idle = (tsMin: number, ended = false) => live(tsMin, ended, []);

describe('executionView timings', () => {
  it('gives each slot its task start, the run start, and the 3 newest finished tasks that are not running', () => {
    const fin = (status: 'integrated' | 'blocked' | 'running', startedMin: number, finishedMin: number) => ({ ...task(status, startedMin), finishedAt: at(finishedMin) });
    const e = exec({ tasks: {
      T1: task('running', -20), T2: fin('integrated', -50, -40), T3: fin('blocked', -45, -30), T4: fin('integrated', -40, -20),
      T5: fin('integrated', -35, -10), T6: fin('running', -30, -5), T7: task('integrated'),
    } });
    const v = executionView({ exec: e, tasks: {}, live: [live(-1)], now: NOW })!;
    expect(v.startedAt).toBe(at(-60));
    expect(v.slots.find(s => s.task === 'T1')!.startedAt).toBe(at(-20));
    expect(v.finished).toEqual([
      { task: 'T5', startedAt: at(-35), finishedAt: at(-10) },
      { task: 'T4', startedAt: at(-40), finishedAt: at(-20) },
      { task: 'T3', startedAt: at(-45), finishedAt: at(-30) },
    ]);
  });
  it('lists only integrated or blocked tasks as finished: never a running, accepted or conflict one with a stale finishedAt', () => {
    const fin = (status: 'accepted' | 'conflict' | 'running' | 'integrated', finishedMin: number) => ({ ...task(status, -40), finishedAt: at(finishedMin) });
    const e = exec({ tasks: { A: fin('accepted', -1), B: fin('running', -2), C: fin('conflict', -3), D: fin('integrated', -4) } });
    const v = executionView({ exec: e, tasks: {}, live: [live(-1)], now: NOW })!;
    expect(v.finished.map(f => f.task)).toEqual(['D']);
  });
  it('a manual slot has no task start', () => {
    const p: PublicTask = { task: 'T9', runId: 'r1', stage: 'implement', status: 'running', agent: null, round: 1, since: at(-5), updatedAt: at(-1), leaseUntil: at(5), by: 'M1', mode: 'manual' };
    expect(executionView({ exec: exec(), tasks: { T9: p }, live: [live(-1)], now: NOW })!.manual[0].startedAt).toBeNull();
  });
});

describe('executionView', () => {
  it('takes slot titles from the execution and counts the planned tasks in the total', () => {
    const e = exec({ planned: 12, tasks: { T1: { ...task('running', -20), title: 'Login' }, T2: task('running', -5) } });
    const v = executionView({ exec: e, tasks: {}, live: [live(-1)], now: NOW })!;
    expect(v.slots.map(s => s.title)).toEqual(['Login', null]);
    expect(v.total).toBe(12);
    // A titles map, when given, still wins; planned never lowers the total below the tasks known.
    expect(executionView({ exec: e, tasks: {}, live: [live(-1)], titles: { T1: 'Other' }, now: NOW })!.slots[0].title).toBe('Other');
    expect(executionView({ exec: exec({ planned: 1 }), tasks: {}, live: [live(-1)], now: NOW })!.total).toBe(5);
  });
  it('lists slots in start order with stage and agent from the public task, plus queue, conflicts and counts', () => {
    const v = executionView({ exec: exec(), tasks: { T1: pub('T1', 5) }, live: [live(-1)], titles: { T1: 'Login' }, now: NOW })!;
    expect(v.slots.map(s => s.task)).toEqual(['T1', 'T2']);
    expect(v.slots[0]).toMatchObject({ title: 'Login', stage: 'review', agent: 'forge-review-correctness', round: 2, liveness: 'alive' });
    expect(v.slots[1]).toMatchObject({ stage: 'implement', since: at(-3), liveness: 'alive' });
    expect(v).toMatchObject({ queued: ['T3'], conflicts: ['T5'], integrated: 1, total: 5, coordinator: { liveness: 'alive' } });
    expect(v.agents).toHaveLength(1);
  });
  it('a coordinator without SessionEnd goes silent, then stopped, by the age of its signal and steps', () => {
    expect(executionView({ exec: exec({ lastStepAt: at(-8) }), tasks: {}, live: [idle(-8)], now: NOW })!.coordinator.liveness).toBe('silent');
    const v = executionView({ exec: exec({ lastStepAt: at(-13) }), tasks: {}, live: [idle(-13)], now: NOW })!;
    expect(v.coordinator.liveness).toBe('stopped');
    expect(v.orphans).toEqual(['T1', 'T2']);
  });
  it('an ended signal is stopped at once; a 25-hour-old one is ignored', () => {
    expect(executionView({ exec: exec({ lastStepAt: null }), tasks: {}, live: [live(-1, true)], now: NOW })!.coordinator.liveness).toBe('stopped');
    expect(executionView({ exec: exec({ lastStepAt: null }), tasks: {}, live: [live(-25 * 60)], now: NOW })!.coordinator.lastSeen).toBeNull();
  });
  it('a task whose own lease stopped is an orphan even with a live coordinator', () => {
    // With no agent in the signal: a listed agent would keep an agent task alive (see the long-agent case).
    const v = executionView({ exec: exec(), tasks: { T1: pub('T1', -6) }, live: [idle(-1)], now: NOW })!;
    expect(v.slots[0].liveness).toBe('stopped');
    expect(v.orphans).toEqual(['T1']);
  });
  it('null without an execution or for a finished one; a stalled one stays to say why', () => {
    expect(executionView({ exec: null, tasks: {}, live: [], now: NOW })).toBeNull();
    expect(executionView({ exec: exec({ active: false, stopReason: 'migrated' }), tasks: {}, live: [], now: NOW })).toBeNull();
    expect(executionView({ exec: exec({ active: false, stopReason: 'stalled', stallReason: 'blocked: T1' }), tasks: {}, live: [], now: NOW })).toMatchObject({ active: false, stallReason: 'blocked: T1', coordinator: { liveness: 'stopped' } });
  });
  it('a coordinator waiting on a long agent stays alive, and so does the slot of an agent task', () => {
    const waiting = exec({ lastStepAt: at(-20), tasks: { T1: { ...task('running', -25), updatedAt: at(-20) } } });
    const agent = [{ id: 'a1', type: 'forge:forge-impl', since: at(-20) }];
    // The task's own lease went stale with the steps; the agent in the signal still keeps it alive.
    const stale = { T1: { ...pub('T1', -10, 'implement'), agent: 'forge-impl' } };
    const v = executionView({ exec: waiting, tasks: stale, live: [live(-20, false, agent)], now: NOW })!;
    expect(v.coordinator.liveness).toBe('alive');
    expect(v.slots[0].liveness).toBe('alive');
    expect(v.orphans).toEqual([]);
    const ended = executionView({ exec: waiting, tasks: stale, live: [live(-20, true, agent)], now: NOW })!;
    expect(ended.coordinator.liveness).toBe('stopped');
    expect(ended.orphans).toEqual(['T1']);
    const none = executionView({ exec: waiting, tasks: {}, live: [idle(-20)], now: NOW })!;
    expect(none.coordinator.liveness).toBe('stopped');
    expect(none.orphans).toEqual(['T1']);
  });
  it('an agent listed for 3 hours or more no longer keeps the coordinator alive', () => {
    const v = executionView({ exec: exec({ lastStepAt: at(-20) }), tasks: {}, live: [live(-20, false, [{ id: 'a1', type: 't', since: at(-180) }])], now: NOW })!;
    expect(v.coordinator.liveness).toBe('stopped');
  });
  it('signalLiveness thresholds', () => {
    expect(signalLiveness(at(-6.9), false, NOW)).toBe('alive');
    expect(signalLiveness(at(-7), false, NOW)).toBe('silent');
    expect(signalLiveness(at(-12), false, NOW)).toBe('stopped');
    expect(signalLiveness(null, false, NOW)).toBe('stopped');
  });
  it('a signal more than 2 minutes in the future is invalid and never keeps the coordinator alive', () => {
    expect(executionView({ exec: exec({ lastStepAt: null }), tasks: {}, live: [live(10)], now: NOW })!.coordinator.liveness).toBe('stopped');
    expect(executionView({ exec: exec({ lastStepAt: at(30) }), tasks: {}, live: [idle(-13)], now: NOW })!.coordinator.liveness).toBe('stopped');
    expect(executionView({ exec: exec({ lastStepAt: null }), tasks: {}, live: [live(1)], now: NOW })!.coordinator.liveness).toBe('alive');
    expect(executionView({ exec: exec({ lastStepAt: null }), tasks: {}, live: [{ ...live(-1), ts: 'not a date' }], now: NOW })!.coordinator.lastSeen).toBeNull();
    expect(signalLiveness(at(3), false, NOW)).toBe('stopped');
  });
  it('the most recent valid signal of the run and hook session wins; another session is ignored', () => {
    const v = executionView({ exec: exec({ lastStepAt: null }), tasks: {}, live: [live(-13), live(-2), { ...live(-1), sessionId: 's2' }], now: NOW })!;
    expect(v.coordinator).toEqual({ liveness: 'alive', lastSeen: at(-2) });
    const other = executionView({ exec: exec({ lastStepAt: at(-13) }), tasks: {}, live: [{ ...live(-1), sessionId: 's2' }], now: NOW })!;
    expect(other.coordinator.liveness).toBe('stopped');
  });
  it('a stalled execution lists its running tasks without a public task as stopped orphans', () => {
    const v = executionView({ exec: exec({ active: false, stopReason: 'stalled', stallReason: 'x' }), tasks: {}, live: [live(-1)], now: NOW })!;
    expect(v.slots.map(s => s.liveness)).toEqual(['stopped', 'stopped']);
    expect(v.orphans).toEqual(['T1', 'T2']);
  });
  it('a public task of another run falls back to the coordinator liveness and the execution task', () => {
    const other = { ...pub('T1', 5), runId: 'r2', stage: 'verify' as const, agent: 'someone-else' };
    const v = executionView({ exec: exec(), tasks: { T1: other }, live: [live(-1)], now: NOW })!;
    expect(v.slots[0]).toMatchObject({ stage: 'implement', agent: 'forge-impl', round: 1, since: at(-3), liveness: 'alive' });
  });
  const memberPub = (taskId: string, by: string, mode: 'sessions' | 'manual', leaseMin: number): PublicTask =>
    ({ ...pub(taskId, leaseMin, 'implement'), by, mode, agent: 'forge-impl' });
  const memberLive = (sessionId: string, role: LiveDoc['role'], tsMin: number, ended = false): LiveDoc =>
    ({ sessionId, role, runId: 'r1', task: null, event: 'Stop', ts: at(tsMin), agents: [], ended });
  it('a sessions slot lives by its own session, not by the coordinator', () => {
    const e = exec({ mode: 'sessions', tasks: { T1: { ...task('running'), executor: 'sessions' } } });
    const alive = executionView({ exec: e, tasks: { T1: memberPub('T1', 'S2', 'sessions', -30) }, live: [live(-1), memberLive('S2', 'executor', -1)], now: NOW })!;
    expect(alive.slots[0]).toMatchObject({ liveness: 'alive', by: 'S2', mode: 'sessions' });
    const dead = executionView({ exec: e, tasks: { T1: memberPub('T1', 'S2', 'sessions', -30) }, live: [live(-1), memberLive('S2', 'executor', -1, true)], now: NOW })!;
    expect(dead.slots[0].liveness).toBe('stopped');
    expect(dead.orphans).toEqual(['T1']);
  });
  it('a sessions slot ignores the coordinator signal; its lease alone keeps it alive when it has no signal', () => {
    const e = exec({ mode: 'sessions', tasks: { T1: { ...task('running'), executor: 'sessions' } } });
    expect(executionView({ exec: e, tasks: { T1: memberPub('T1', 'S2', 'sessions', -30) }, live: [live(-1)], now: NOW })!.slots[0].liveness).toBe('stopped');
    expect(executionView({ exec: e, tasks: { T1: memberPub('T1', 'S2', 'sessions', 5) }, live: [], now: NOW })!.slots[0].liveness).toBe('alive');
  });
  it('lists manual work outside the execution tasks, without taking slots', () => {
    const v = executionView({ exec: exec(), tasks: { T9: memberPub('T9', 'M1', 'manual', 5) }, live: [live(-1)], titles: { T9: 'Docs' }, now: NOW })!;
    expect(v.manual).toEqual([expect.objectContaining({ task: 'T9', title: 'Docs', by: 'M1', mode: 'manual', liveness: 'alive' })]);
    expect(v.slots.map(s => s.task)).toEqual(['T1', 'T2']);
    const gone = executionView({ exec: exec(), tasks: { T9: memberPub('T9', 'M1', 'manual', -30) }, live: [live(-1)], now: NOW })!;
    expect(gone.orphans).toContain('T9');
  });
  it('a member signal of another run, or of another session, never keeps a member row alive', () => {
    const e = exec({ mode: 'sessions', tasks: { T1: { ...task('running'), executor: 'sessions' } } });
    const lapsed = { T1: memberPub('T1', 'S2', 'sessions', -30) };
    const otherRun = { ...memberLive('S2', 'executor', -1), runId: 'r0' };
    const otherSession = memberLive('S3', 'executor', -1);
    expect(executionView({ exec: e, tasks: lapsed, live: [live(-1), otherRun], now: NOW })!.slots[0].liveness).toBe('stopped');
    expect(executionView({ exec: e, tasks: lapsed, live: [live(-1), otherSession], now: NOW })!.slots[0].liveness).toBe('stopped');
    const manual = { T9: memberPub('T9', 'M1', 'manual', -30) };
    expect(executionView({ exec: exec(), tasks: manual, live: [live(-1), { ...memberLive('M1', 'manual', -1), runId: 'r0' }], now: NOW })!.manual[0].liveness).toBe('stopped');
    expect(executionView({ exec: exec(), tasks: manual, live: [live(-1), memberLive('M2', 'manual', -1)], now: NOW })!.manual[0].liveness).toBe('stopped');
    // The matching signal does keep it alive.
    expect(executionView({ exec: exec(), tasks: manual, live: [live(-1), memberLive('M1', 'manual', -1)], now: NOW })!.manual[0].liveness).toBe('alive');
  });
  it('an ended member signal makes the manual row stopped even with its lease running', () => {
    const v = executionView({ exec: exec(), tasks: { T9: memberPub('T9', 'M1', 'manual', 5) }, live: [live(-1), memberLive('M1', 'manual', -1, true)], now: NOW })!;
    expect(v.manual[0]).toMatchObject({ task: 'T9', liveness: 'stopped' });
    expect(v.orphans).toContain('T9');
  });
});

describe('executionView lifecycle (C2)', () => {
  const stalled = (over: Partial<ExecutionState> = {}) => exec({ active: false, stopReason: 'stalled', stallReason: 'x', ...over });
  const view = (e: ExecutionState) => executionView({ exec: e, tasks: {}, live: [], now: NOW });
  it('draws a stalled run for 24 h after its last step, with its clock frozen there', () => {
    expect(STALE_RUN_TTL_MS).toBe(24 * 3600_000);
    expect(view(stalled({ lastStepAt: at(-23 * 60) }))).toMatchObject({ active: false, frozenAt: at(-23 * 60) });
    expect(view(stalled({ lastStepAt: at(-25 * 60) }))).toBeNull();
  });
  it('counts from the start when the run never stepped', () => {
    expect(lastMovedAt(stalled({ lastStepAt: null, startedAt: at(-60) }))).toBe(at(-60));
    expect(view(stalled({ lastStepAt: null, startedAt: at(-23 * 60) }))).toMatchObject({ frozenAt: at(-23 * 60) });
    expect(view(stalled({ lastStepAt: null, startedAt: at(-25 * 60) }))).toBeNull();
  });
  it('never draws a closed run', () => {
    expect(view(stalled({ closedAt: at(-1), closedBy: 'close' }))).toBeNull();
    expect(view(exec({ closedAt: at(-1), closedBy: 'merge' }))).toBeNull();
  });
  it('an active run has no frozen clock', () => {
    expect(executionView({ exec: exec(), tasks: {}, live: [live(-1)], now: NOW })!.frozenAt).toBeNull();
  });
  it('a stalled run whose last step is a minute ahead of the reader (clock skew) is still drawn', () => {
    expect(view(stalled({ lastStepAt: at(1) }))).toMatchObject({ frozenAt: at(1) });
  });
});

describe('isVisibleRun (C2, B-07, K5-02)', () => {
  const ended = (stopReason: ExecutionState['stopReason'], over: Partial<ExecutionState> = {}) => exec({ active: false, stopReason, lastStepAt: at(-60), ...over });
  it('an active run is drawn for anyone, an ended one only for a listed reason, a closed one for nobody', () => {
    for (const role of ['owner', 'other-live', 'previous', 'none'] as const) {
      expect(isVisibleRun(exec(), NOW, role)).toBe(true);
      for (const r of ['stalled', 'stopped', 'budget', 'finished'] as const) expect(isVisibleRun(ended(r), NOW, role), `${r} ${role}`).toBe(true);
      expect(isVisibleRun(ended('migrated'), NOW, role)).toBe(false);
      expect(isVisibleRun(ended('stopped', { closedAt: at(-1), closedBy: 'close' }), NOW, role)).toBe(false);
      expect(isVisibleRun(exec({ closedAt: at(-1), closedBy: 'merge' }), NOW, role)).toBe(false);
      expect(isVisibleRun(null, NOW, role)).toBe(false);
    }
  });
  it('its owner sees an ended run until it is closed; anyone else within 24 h of its last movement', () => {
    const old = ended('stopped', { lastStepAt: at(-30 * 60) });
    expect(isVisibleRun(old, NOW, 'owner')).toBe(true);
    expect(isVisibleRun(old, NOW, 'other-live')).toBe(false);
    const edge = (msBefore: number) => ended('budget', { lastStepAt: new Date(NOW - STALE_RUN_TTL_MS + msBefore).toISOString() });
    expect(isVisibleRun(edge(1000), NOW, 'previous')).toBe(true);
    expect(isVisibleRun(edge(-1000), NOW, 'previous')).toBe(false);
    expect(isVisibleRun(ended('stalled', { lastStepAt: 'nope', startedAt: 'nope' }), NOW, 'none')).toBe(false);
  });
  it('executionView draws exactly what isVisibleRun says, as someone who is not the owner unless told the role', () => {
    const cases = [exec(), ended('finished'), ended('migrated'), ended('stopped', { lastStepAt: at(-30 * 60) }), ended('stalled', { closedAt: at(-1), closedBy: 'close' })];
    for (const e of cases) {
      expect(executionView({ exec: e, tasks: {}, live: [], now: NOW }) !== null).toBe(isVisibleRun(e, NOW, 'none'));
      expect(executionView({ exec: e, tasks: {}, live: [], now: NOW, role: 'owner' }) !== null).toBe(isVisibleRun(e, NOW, 'owner'));
    }
  });
});
