import { describe, it, expect } from 'vitest';
import { decide, type DecideInput } from '../src/forge/swarm.js';
import { emptyFront, type SwarmState } from '../src/lib/swarm-state.js';
import type { PlanTask, PlanView, SessionDoc, States } from '../src/lib/types.js';

const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const ago = (min: number) => new Date(NOW - min * 60000).toISOString();
const task = (id: string, track: string, phase: string, over: Partial<PlanTask> = {}): PlanTask =>
  ({ id, title: id, track, phase, done_when: 'x', depends_on: [], zones: [`src/${track}/**`], ...over });
const plan = (tasks: PlanTask[]): PlanView => ({
  tracks: [...new Set(tasks.map(t => t.track))].map(id => ({ id, name: id, color: 'blue' as const })),
  phases: [{ id: 'p1', name: 'P1', plan_status: 'committed' }, { id: 'p2', name: 'P2', plan_status: 'committed' }],
  versions: [], tasks,
});
const swarm = (over: Partial<SwarmState> = {}): SwarmState => ({
  active: true, parallel: 2, mergeAuthorized: true, project: 'shop', base: 'main', coordinator: 'main', hookSession: null,
  startedAt: ago(60), lastTickAt: null, lastBlockTick: null, sleepUntil: null, stopReason: null, stallReason: null, notice: null,
  fronts: {}, ...over,
});
const live = (track: string, currentTask?: string): SessionDoc => ({ name: track, track, heartbeatAt: ago(1), status: 'active', ...(currentTask ? { currentTask } : {}) });
const input = (over: Partial<DecideInput>): DecideInput => ({
  plan: plan([]), states: {}, sessions: {}, agents: [], ahead: {}, integrated: [], swarm: swarm(), now: NOW, ...over,
});
const types = (r: ReturnType<typeof decide>) => r.actions.map(a => a.type === 'launch' || a.type === 'integrate' ? `${a.type}:${a.track}` : a.type);

describe('decide', () => {
  it('launches unblocked fronts up to parallel, by phase then plan order, and queues the rest', () => {
    const p = plan([task('C1', 'c', 'p2'), task('A1', 'a', 'p1'), task('B1', 'b', 'p1')]);
    const r = decide(input({ plan: p }));
    expect(types(r)).toEqual(['launch:a', 'launch:b', 'wait']);
    expect(r.next.fronts.a.status).toBe('running');
    expect(r.next.fronts.a.session).toBe('wp-shop-a');
    expect(r.next.fronts.c.status).toBe('queued');
    expect(r.progress).toBe(true);
  });
  it('never exceeds parallel and never launches a front that is live', () => {
    const p = plan([task('A1', 'a', 'p1'), task('B1', 'b', 'p1'), task('C1', 'c', 'p1')]);
    const r = decide(input({ plan: p, sessions: { a: live('a') }, agents: ['wp-shop-b'] }));
    expect(types(r)).toEqual(['wait']);
    expect(r.live).toBe(2);
    expect(r.next.fronts.c.status).toBe('queued');
  });
  it('counts a session with a suffixed SID as its front live (liveness goes by track)', () => {
    const p = plan([task('A1', 'a', 'p1')]);
    const r = decide(input({ plan: p, sessions: { 'a-2': { ...live('a'), name: 'a-2' } } }));
    expect(types(r)).toEqual(['wait']);
    expect(r.next.fronts.a.status).toBe('running');
  });
  it('treats a front launched less than 10 minutes ago as live', () => {
    const p = plan([task('A1', 'a', 'p1')]);
    const r = decide(input({ plan: p, swarm: swarm({ fronts: { a: { ...emptyFront(), status: 'running', launchedAt: ago(3) } } }) }));
    expect(types(r)).toEqual(['wait']);
  });
  it('relaunches a front whose session died, so the new one recovers its task', () => {
    const p = plan([task('A1', 'a', 'p1')]);
    const states: States = { A1: { status: 'in_progress', owner: 'a' } };
    const r = decide(input({ plan: p, states, sessions: { a: { ...live('a'), heartbeatAt: ago(30) } } }));
    expect(types(r)).toEqual(['launch:a', 'wait']);
  });
  it('waits for a dependency of another front that is done but not integrated, and integrates up to its done task', () => {
    const p = plan([task('A1', 'a', 'p1'), task('A2', 'a', 'p1', { depends_on: ['A1'] }), task('B1', 'b', 'p1', { depends_on: ['A1'] })]);
    const states: States = {
      A1: { status: 'done', doneAt: ago(5), commits: [{ sha: 'a1sha', ts: ago(5), title: 'A1', add: 1, del: 0 }] },
      A2: { status: 'in_progress', owner: 'a' },
    };
    const r = decide(input({ plan: p, states, sessions: { a: live('a', 'A2') }, ahead: { a: 2 } }));
    expect(r.actions[0]).toEqual({ type: 'integrate', track: 'a', ref: 'a1sha' });
    expect(r.next.fronts.b).toMatchObject({ status: 'waiting', waitingFor: { task: 'A1', track: 'a', reason: 'not-integrated' } });
    expect(r.actions.at(-1)).toEqual({ type: 'wait', seconds: 0 });
  });
  it('launches the dependent front once the dependency commit is integrated', () => {
    const p = plan([task('A1', 'a', 'p1'), task('B1', 'b', 'p1', { depends_on: ['A1'] })]);
    const states: States = { A1: { status: 'done', commits: [{ sha: 'a1sha', ts: ago(5), title: 'A1', add: 1, del: 0 }] } };
    const r = decide(input({ plan: p, states, integrated: ['a1sha'] }));
    expect(types(r)).toEqual(['launch:b', 'wait']);
  });
  it('integrates the branch tip of a finished front that is no longer live', () => {
    const p = plan([task('A1', 'a', 'p1')]);
    const states: States = { A1: { status: 'done', commits: [{ sha: 's', ts: ago(5), title: 'A1', add: 1, del: 0 }] } };
    const r = decide(input({ plan: p, states, ahead: { a: 1 } }));
    expect(r.actions[0]).toEqual({ type: 'integrate', track: 'a', ref: 'track/a' });
  });
  it('without merge authorization leaves finished work ready and stalls when nothing else can move', () => {
    const p = plan([task('A1', 'a', 'p1')]);
    const states: States = { A1: { status: 'done' } };
    const r = decide(input({ plan: p, states, ahead: { a: 1 }, swarm: swarm({ mergeAuthorized: false }) }));
    expect(r.next.fronts.a.status).toBe('ready');
    expect(r.actions).toEqual([{ type: 'stalled', reason: expect.stringContaining('ready') }]);
    expect(r.next.active).toBe(false);
    expect(r.next.stopReason).toBe('stalled');
  });
  it('does not launch a front whose next task overlaps the zones of a live task or of another launch', () => {
    const p = plan([
      task('A1', 'a', 'p1', { zones: ['src/shared/**'] }),
      task('B1', 'b', 'p1', { zones: ['src/shared/x.ts'] }),
      task('C1', 'c', 'p1', { zones: ['src/shared/y.ts'] }),
    ]);
    const r = decide(input({ plan: p, swarm: swarm({ parallel: 3 }) }));
    expect(types(r)).toEqual(['launch:a', 'wait']);
    expect(r.next.fronts.b.status).toBe('queued');
  });
  it('keeps conflict and launch-failed fronts out of launches and integrations', () => {
    const p = plan([task('A1', 'a', 'p1'), task('B1', 'b', 'p1')]);
    const r = decide(input({ plan: p, ahead: { b: 1 }, swarm: swarm({ fronts: {
      a: { ...emptyFront(), status: 'launch-failed', detail: 'not trusted' },
      b: { ...emptyFront(), status: 'conflict', detail: 'merge conflict' },
    } }) }));
    expect(r.actions).toEqual([{ type: 'stalled', reason: expect.stringMatching(/launch-failed.*a|conflict.*b/) }]);
    expect(r.next.fronts.a).toMatchObject({ status: 'launch-failed', detail: 'not trusted' });
  });
  it('marks a front blocked when what it has left is blocked externally', () => {
    const p = plan([task('A1', 'a', 'p1')]);
    const r = decide(input({ plan: p, states: { A1: { status: 'blocked', blockedBy: ['external'] } } }));
    expect(r.next.fronts.a).toMatchObject({ status: 'blocked', detail: 'A1' });
    expect(r.actions[0]).toMatchObject({ type: 'stalled' });
  });
  it('finishes when every task is done and nothing is left to integrate', () => {
    const p = plan([task('A1', 'a', 'p1')]);
    const r = decide(input({ plan: p, states: { A1: { status: 'done' } } }));
    expect(r.actions).toEqual([{ type: 'finish' }]);
    expect(r.next).toMatchObject({ active: false, stopReason: 'finished' });
    expect(r.next.fronts.a.status).toBe('integrated');
  });
  it('reports progress only when it launched, integrated or has live fronts', () => {
    const p = plan([task('A1', 'a', 'p1'), task('B1', 'b', 'p1', { depends_on: ['A1'] })]);
    const r = decide(input({ plan: p, sessions: { a: live('a', 'A1') }, states: { A1: { status: 'in_progress', owner: 'a' } } }));
    expect(types(r)).toEqual(['wait']);
    expect(r.progress).toBe(true);
    expect(r.next.fronts.b).toMatchObject({ status: 'waiting', waitingFor: { task: 'A1', reason: 'not-done' } });
    expect(r.next.lastTickAt).toBe(new Date(NOW).toISOString());
  });
  it('keeps the zone guard across ticks: a front launched last tick that has not claimed yet still blocks overlapping launches', () => {
    const p = plan([
      task('X1', 'x', 'p1'),
      task('A1', 'a', 'p1', { zones: ['src/shared/**'] }),
      task('B1', 'b', 'p1', { zones: ['src/shared/x.ts'] }),
    ]);
    const states: States = { X1: { status: 'done', commits: [{ sha: 'xs', ts: ago(5), title: 'X1', add: 1, del: 0 }] } };
    const sw = swarm({ parallel: 3 });
    const r1 = decide(input({ plan: p, states, ahead: { x: 1 }, swarm: sw }));
    expect(types(r1)).toEqual(['integrate:x', 'launch:a', 'wait']);
    const r2 = decide(input({ plan: p, states, integrated: ['xs'], swarm: r1.next, now: NOW + 5000 }));
    expect(types(r2)).toEqual(['wait']);
    expect(r2.next.fronts.b.status).toBe('queued');
  });
  it('never integrates the half-done work of a dead front: only its last done commit', () => {
    const p = plan([task('A1', 'a', 'p1'), task('A2', 'a', 'p1', { depends_on: ['A1'] })]);
    const states: States = {
      A1: { status: 'done', doneAt: ago(20), commits: [{ sha: 'a1', ts: ago(20), title: 'A1', add: 1, del: 0 }] },
      A2: { status: 'in_progress', owner: 'a' },
    };
    const r = decide(input({ plan: p, states, sessions: { a: { ...live('a', 'A2'), heartbeatAt: ago(30) } }, ahead: { a: 2 } }));
    expect(r.actions[0]).toEqual({ type: 'integrate', track: 'a', ref: 'a1' });
  });
});

describe('decide: live fronts and cross-front dependencies', () => {
  it('asks to integrate the not-integrated dependency of a live front\'s next task, and keeps it running', () => {
    const p = plan([task('A1', 'a', 'p1'), task('B1', 'b', 'p1'), task('B2', 'b', 'p1', { depends_on: ['B1', 'A1'] })]);
    const states: States = {
      A1: { status: 'done', doneAt: ago(5), commits: [{ sha: 'a1sha', ts: ago(5), title: 'A1', add: 1, del: 0 }] },
      B1: { status: 'done', doneAt: ago(2), commits: [{ sha: 'b1sha', ts: ago(2), title: 'B1', add: 1, del: 0 }] },
    };
    // a finished and is no longer live but ranks after nothing else; b is live and its next task B2 needs A1 integrated.
    const r = decide(input({ plan: p, states, sessions: { b: live('b') }, ahead: { a: 1, b: 1 } }));
    expect(r.actions[0]).toEqual({ type: 'integrate', track: 'a', ref: 'track/a' });
    expect(r.next.fronts.b.status).toBe('running');
  });
  it('gives the dependency of a live front priority over an earlier idle front', () => {
    const p = plan([task('C1', 'c', 'p1'), task('A1', 'a', 'p2'), task('B1', 'b', 'p2'), task('B2', 'b', 'p2', { depends_on: ['B1', 'A1'] })]);
    const states: States = {
      C1: { status: 'done', doneAt: ago(9), commits: [{ sha: 'c1sha', ts: ago(9), title: 'C1', add: 1, del: 0 }] },
      A1: { status: 'done', doneAt: ago(5), commits: [{ sha: 'a1sha', ts: ago(5), title: 'A1', add: 1, del: 0 }] },
      B1: { status: 'done', doneAt: ago(2), commits: [{ sha: 'b1sha', ts: ago(2), title: 'B1', add: 1, del: 0 }] },
    };
    const r = decide(input({ plan: p, states, sessions: { b: live('b') }, ahead: { a: 1, b: 1, c: 1 } }));
    expect(r.actions[0]).toEqual({ type: 'integrate', track: 'a', ref: 'track/a' });
  });
});
