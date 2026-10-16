import { describe, it, expect } from 'vitest';
import { schedule, widthOf, widthProfile, relaunchOrBlock, STEP_WAIT_SECONDS, NUDGE_MINUTES, RELAUNCH_CAP, type ScheduleInput } from '../src/forge/schedule.js';
import { proposeSay } from '../src/forge/swarm.js';
import type { ExecutionState } from '../src/lib/execution-state.js';
import type { PlanView, PlanTask, States } from '../src/lib/types.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const at = (min: number) => new Date(NOW + min * 60000).toISOString();
const task = (id: string, deps: string[] = [], zones: string[] = [`src/${id}/**`], phase = 'p1'): PlanTask =>
  ({ id, title: id, track: 'a', phase, includes: '', done_when: 'x', depends_on: deps, zones, estimate_min: 30 } as unknown as PlanTask);
const plan = (tasks: PlanTask[]): PlanView =>
  ({ project: 'shop', locale: 'es', version: '1', tracks: [{ id: 'a', name: 'A', color: 'blue' }], phases: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }], tasks } as unknown as PlanView);
const exec = (over: Partial<ExecutionState> = {}): ExecutionState => ({
  runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
  coordinator: 'main', hookSession: null, active: true, stopReason: null, stallReason: null, startedAt: at(-60), lastStepAt: null,
  lastBlockStep: null, sleepUntil: null, tasks: {}, ...over,
});
const running = (id: string, status: 'running' | 'accepted' | 'conflict' | 'blocked' = 'running') => ({
  [id]: { status, stage: 'implement' as const, round: 1, worktree: `/w/${id}`, branch: `task/${id}`, executor: 'subagents' as const, attempts: 0, agent: null, startedAt: at(-5), stageSince: at(-5), updatedAt: at(-1), detail: null },
});
const input = (over: Partial<ScheduleInput>): ScheduleInput => ({ plan: plan([]), states: {}, sessions: {}, exec: exec(), integrated: [], now: NOW, ...over });
const starts = (r: ReturnType<typeof schedule>) => r.actions.filter(a => a.type === 'start').map(a => (a as { task: string }).task);

describe('schedule', () => {
  it('records the title of each task it starts and the planned count', () => {
    const p = plan([task('T1'), task('T2'), task('T3'), task('T4')]);
    p.tasks[0].title = 'Login form';
    const r = schedule(input({ plan: p, exec: exec({ parallel: 1 }) }));
    expect(r.next.tasks.T1.title).toBe('Login form');
    expect(r.next.planned).toBe(4);
  });
  it('fills the title of a task started before titles existed', () => {
    const p = plan([task('T1'), task('T2')]);
    const r = schedule(input({ plan: p, exec: exec({ tasks: running('T1') }), states: { T1: { status: 'in_progress', owner: 'main' } } }));
    expect(r.next.tasks.T1.title).toBe('T1');
  });
  it('starts independent tasks up to parallel, in plan order', () => {
    const r = schedule(input({ plan: plan([task('T1'), task('T2'), task('T3'), task('T4')]), exec: exec({ parallel: 2 }) }));
    expect(starts(r)).toEqual(['T1', 'T2']);
    expect(r.next.tasks.T1).toMatchObject({ status: 'running', stage: 'brief', branch: 'task/T1', executor: 'subagents' });
    expect(r.actions.at(-1)).toEqual({ type: 'wait', seconds: STEP_WAIT_SECONDS });
  });
  it('counts running tasks against the slots and never restarts them', () => {
    const r = schedule(input({ plan: plan([task('T1'), task('T2'), task('T3')]), exec: exec({ parallel: 2, tasks: running('T1') }), states: { T1: { status: 'in_progress', owner: 'main' } } }));
    expect(starts(r)).toEqual(['T2']);
  });
  it('waits for a dependency that is done but not integrated into the run branch', () => {
    const states: States = { T1: { status: 'done', commits: [{ sha: 'aaa1111', ts: at(-3), title: 't', add: 1, del: 0 }] } };
    expect(starts(schedule(input({ plan: plan([task('T1'), task('T2', ['T1'])]), states })))).toEqual([]);
    expect(starts(schedule(input({ plan: plan([task('T1'), task('T2', ['T1'])]), states, integrated: ['aaa1111'] })))).toEqual(['T2']);
  });
  it('never starts two tasks whose zones overlap, nor one overlapping a running task', () => {
    const p = plan([task('T1', [], ['src/shared/**']), task('T2', [], ['src/shared/money.ts']), task('T3')]);
    expect(starts(schedule(input({ plan: p })))).toEqual(['T1', 'T3']);
    expect(starts(schedule(input({ plan: p, exec: exec({ tasks: running('T1') }), states: { T1: { status: 'in_progress', owner: 'main' } } })))).toEqual(['T3']);
  });
  it('respects a claim by a live or silent session, and takes over one whose owner is stopped', () => {
    const p = plan([task('T1')]);
    const claimed = (leaseUntil: string): Partial<ScheduleInput> => ({
      plan: p, states: { T1: { status: 'in_progress', owner: 'manual-1' } },
      sessions: { 'manual-1': { name: 'm', status: 'active', heartbeatAt: at(-1), leaseUntil, role: 'manual' } },
    });
    expect(starts(schedule(input(claimed(at(5)))))).toEqual([]);
    expect(starts(schedule(input(claimed(at(-2)))))).toEqual([]);
    expect(starts(schedule(input(claimed(at(-6)))))).toEqual(['T1']);
  });
  it("re-adopts the coordinator's own active task that is missing from the execution", () => {
    const r = schedule(input({ plan: plan([task('T1')]), states: { T1: { status: 'in_progress', owner: 'main' } } }));
    expect(starts(r)).toEqual(['T1']);
    expect(r.next.tasks.T1).toMatchObject({ status: 'running', stage: 'brief' });
  });
  it('integrates one accepted task per tick and then ticks again at once', () => {
    const r = schedule(input({ plan: plan([task('T1'), task('T2')]), exec: exec({ tasks: { ...running('T1', 'accepted'), ...running('T2', 'accepted') } }), states: { T1: { status: 'in_progress', owner: 'main' }, T2: { status: 'in_progress', owner: 'main' } } }));
    expect(r.actions[0]).toEqual({ type: 'integrate', task: 'T1', ref: 'task/T1' });
    expect(r.actions.filter(a => a.type === 'integrate')).toHaveLength(1);
    expect(r.actions.at(-1)).toEqual({ type: 'wait', seconds: 0 });
  });
  it('with a merge in flight (merging.json) it emits no integrate and waits instead of stalling (D-07)', () => {
    const p = plan([task('T1')]);
    const base = { plan: p, exec: exec({ tasks: running('T1', 'accepted') }), states: { T1: { status: 'in_progress' as const, owner: 'main' } } };
    const busy = schedule(input({ ...base, merging: true }));
    expect(busy.actions).toEqual([{ type: 'wait', seconds: STEP_WAIT_SECONDS }]);
    expect(busy.next).toMatchObject({ active: true, stopReason: null });
    expect(schedule(input(base)).actions).toEqual([{ type: 'integrate', task: 'T1', ref: 'task/T1' }, { type: 'wait', seconds: 0 }]);
  });
  it('finishes when every task is done and nothing waits to be integrated', () => {
    const r = schedule(input({ plan: plan([task('T1')]), states: { T1: { status: 'done' } }, exec: exec({ tasks: running('T1', 'integrated' as never) }) }));
    expect(r.actions).toEqual([{ type: 'finish' }]);
    expect(r.next).toMatchObject({ active: false, stopReason: 'finished' });
  });
  it('stalls with a reason per task when nothing can move', () => {
    const p = plan([task('T1'), task('T2'), task('T3', ['T9']), task('T9')]);
    // No live claim here: a task claimed by another live session makes the run wait instead (see below).
    const states: States = { T1: { status: 'blocked', blockedBy: ['external'] }, T9: { status: 'blocked', blockedBy: ['external'] } };
    const r = schedule(input({ plan: p, states, exec: exec({ tasks: running('T2', 'conflict') }) }));
    expect(r.actions).toEqual([{ type: 'stalled', reason: 'blocked: T1, T9; conflict: T2; waits for T9 (not done): T3' }]);
    expect(r.next).toMatchObject({ active: false, stopReason: 'stalled' });
  });
  it('widthOf: the most tasks that can run at once, by dependencies and zones', () => {
    expect(widthOf(plan([task('T1'), task('T2', ['T1']), task('T3', ['T2'])]))).toBe(1);
    expect(widthOf(plan([task('T1'), task('T2', ['T1']), task('T3', ['T1']), task('T4', ['T1'])]))).toBe(3);
    expect(widthOf(plan([task('T1', [], ['src/x/**']), task('T2', [], ['src/x/a.ts'])]))).toBe(1);
  });
  it('widthProfile: the waves, the longest chain, the zones that serialize and a mostly serial plan (D-19)', () => {
    // Six tasks that all add tests to one shared file: one at a time, as forge-cost's plan ran.
    const shared = (id: string) => task(id, [], [`src/${id}/**`, 'tests/plugin.test.ts']);
    expect(widthProfile(plan(['T1', 'T2', 'T3', 'T4', 'T5', 'T6'].map(shared)))).toEqual({
      waves: [['T1'], ['T2'], ['T3'], ['T4'], ['T5'], ['T6']], profile: [1, 1, 1, 1, 1, 1], chain: { length: 1, tasks: ['T1'] },
      serializing: [{ zone: 'tests/plugin.test.ts', tasks: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'] }], mostlySerial: true,
    });
    const wide = widthProfile(plan([task('T1'), task('T2', ['T1']), task('T3', ['T2']), task('T4'), task('T5', ['T1']), task('T6')]));
    expect(wide).toEqual({
      waves: [['T1', 'T4', 'T6'], ['T2', 'T5'], ['T3']], profile: [3, 2, 1], chain: { length: 3, tasks: ['T1', 'T2', 'T3'] }, serializing: [], mostlySerial: false,
    });
    // Two zones of three tasks or more, most shared first.
    const two = widthProfile(plan([
      task('A1', [], ['a.ts', 'b.ts']), task('A2', ['A1'], ['a.ts', 'b.ts']), task('A3', ['A2'], ['a.ts', 'b.ts']), task('A4', ['A3'], ['a.ts']),
    ]));
    expect(two.serializing).toEqual([{ zone: 'a.ts', tasks: ['A1', 'A2', 'A3', 'A4'] }, { zone: 'b.ts', tasks: ['A1', 'A2', 'A3'] }]);
    expect(two.chain).toEqual({ length: 4, tasks: ['A1', 'A2', 'A3', 'A4'] });
    expect(widthProfile(plan([])).profile).toEqual([]);
    expect(widthOf(plan([]))).toBe(0);
  });
  it('proposeSay: singular for one task and one wave, only the count for an empty plan', () => {
    const one = widthProfile(plan([task('T1')]));
    expect(proposeSay(false, 1, one)).toBe('1 task in 1 wave: 1. Longest chain: T1 (1).');
    expect(proposeSay(true, 1, one)).toBe('1 tarea en 1 tanda: 1. Cadena más larga: T1 (1).');
    const none = widthProfile(plan([]));
    expect(proposeSay(false, 0, none)).toBe('0 tasks.');
    expect(proposeSay(true, 0, none)).toBe('0 tareas.');
  });

  const sess = (id: string, status: 'running' | 'accepted' = 'running', over: object = {}) => ({
    [id]: { ...running(id, status)[id], executor: 'sessions' as const, ...over },
  });
  const live = (leaseUntil: string) => ({ name: 'x', status: 'active' as const, heartbeatAt: at(-1), leaseUntil, role: 'executor' as const });
  const pubT = (task: string, over: object = {}) => ({ task, runId: 'r1', stage: 'review' as const, status: 'running' as const, agent: 'forge-review-correctness', round: 2, since: at(-2), updatedAt: at(-1), leaseUntil: at(8), by: 'S2', mode: 'sessions' as const, ...over });

  it("copies a member's public stage into the execution", () => {
    const r = schedule(input({ plan: plan([task('T1')]), exec: exec({ mode: 'sessions', tasks: sess('T1') }), states: { T1: { status: 'in_progress', owner: 'S2' } },
      sessions: { S2: live(at(5)) }, publicTasks: { T1: pubT('T1') } }));
    expect(r.next.tasks.T1).toMatchObject({ stage: 'review', round: 2, agent: 'forge-review-correctness', stageSince: at(-2) });
  });
  it("ignores a public stage of another run or written by the coordinator", () => {
    const base = { plan: plan([task('T1')]), exec: exec({ mode: 'sessions', tasks: sess('T1') }), states: { T1: { status: 'in_progress' as const, owner: 'S2' } }, sessions: { S2: live(at(5)) } };
    expect(schedule(input({ ...base, publicTasks: { T1: pubT('T1', { runId: 'r0' }) } })).next.tasks.T1).toMatchObject({ stage: 'implement', round: 1 });
    expect(schedule(input({ ...base, publicTasks: { T1: pubT('T1', { by: 'main' }) } })).next.tasks.T1).toMatchObject({ stage: 'implement', round: 1 });
  });
  it('a sessions task its member reported blocked becomes blocked, frees its slot and is neither nudged nor relaunched', () => {
    // Its owner stopped long ago and it sits idle in the listing: running, it would be relaunched or nudged.
    const quiet = { startedAt: at(-30), stageSince: at(-30) };
    const base = { plan: plan([task('T1'), task('T2')]), states: { T1: { status: 'in_progress' as const, owner: 'S2' } }, sessions: { S2: live(at(-30)) },
      agents: [{ name: 'wp-shop-T1', state: 'idle' as const }] };
    const r = schedule(input({ ...base, exec: exec({ mode: 'sessions', parallel: 1, tasks: sess('T1', 'running', quiet) }), publicTasks: { T1: pubT('T1', { status: 'blocked' }) } }));
    expect(r.next.tasks.T1).toMatchObject({ status: 'blocked', detail: 'blocked by its session', finishedAt: new Date(NOW).toISOString() });
    expect(r.actions.some(a => a.type === 'relaunch' || a.type === 'nudge' || a.type === 'block')).toBe(false);
    expect(starts(r)).toEqual(['T2']);
    // A blocked public file of another run, or written by the coordinator, is not this member's word.
    const other = schedule(input({ ...base, agents: [{ name: 'wp-shop-T1', state: 'working' as const }], exec: exec({ mode: 'sessions', parallel: 1, tasks: sess('T1') }), publicTasks: { T1: pubT('T1', { status: 'blocked', runId: 'r0' }) } }));
    expect(other.next.tasks.T1.status).toBe('running');
  });
  it('a member task blocked on the roadmap stalls the run in the blocked group when nothing else can move', () => {
    const r = schedule(input({ plan: plan([task('T1')]), states: { T1: { status: 'blocked', owner: 'M1' } }, sessions: { M1: { ...live(at(5)), role: 'manual' } },
      exec: exec({ mode: 'sessions', tasks: sess('T1') }) }));
    expect(r.next.tasks.T1).toMatchObject({ status: 'blocked', detail: 'blocked by its session' });
    expect(r.actions).toEqual([{ type: 'stalled', reason: 'blocked: T1' }]);
    expect(r.next).toMatchObject({ active: false, stopReason: 'stalled' });
  });
  it('accepts a sessions task its session marked done and integrates it', () => {
    const r = schedule(input({ plan: plan([task('T1')]), exec: exec({ mode: 'sessions', tasks: sess('T1') }), states: { T1: { status: 'done', owner: 'S2', commits: [{ sha: 'bbb2222', ts: at(-1), title: 't', add: 1, del: 0 }] } } }));
    expect(r.next.tasks.T1).toMatchObject({ status: 'accepted', stage: 'integrate' });
    expect(r.actions[0]).toEqual({ type: 'integrate', task: 'T1', ref: 'task/T1' });
  });
  it('a member task marked done on the roadmap is accepted without a finishedAt', () => {
    const acc = schedule(input({ plan: plan([task('T1')]), states: { T1: { status: 'done' as const, owner: 'S2' } }, sessions: { S2: live(at(5)) },
      exec: exec({ mode: 'sessions', parallel: 1, tasks: sess('T1') }) }));
    expect(acc.next.tasks.T1.status).toBe('accepted');
    expect(acc.next.tasks.T1.finishedAt ?? null).toBeNull();
  });
  it('adopts a task a manual session finished with commits not yet on the run branch', () => {
    const states: States = { T1: { status: 'done', owner: 'M1', commits: [{ sha: 'ccc3333', ts: at(-1), title: 't', add: 1, del: 0 }] } };
    const r = schedule(input({ plan: plan([task('T1')]), states }));
    expect(r.next.tasks.T1).toMatchObject({ status: 'accepted', executor: 'manual', branch: 'task/T1' });
    expect(r.actions[0]).toEqual({ type: 'integrate', task: 'T1', ref: 'task/T1' });
    const done = schedule(input({ plan: plan([task('T1')]), states, integrated: ['ccc3333'] }));
    expect(done.next.tasks.T1).toBeUndefined();
    expect(done.actions.at(-1)).toEqual({ type: 'finish' });
  });
  it('waits instead of stalling while the last task is claimed by another live session', () => {
    const r = schedule(input({ plan: plan([task('T1')]), states: { T1: { status: 'in_progress', owner: 'M1' } }, sessions: { M1: { ...live(at(5)), role: 'manual' } } }));
    expect(r.actions).toEqual([{ type: 'wait', seconds: STEP_WAIT_SECONDS }]);
    expect(r.next).toMatchObject({ active: true, stopReason: null });
  });
  it('relaunches a sessions task whose owner stopped and is not listed, then blocks at the cap', () => {
    const base = { plan: plan([task('T1')]), states: { T1: { status: 'in_progress' as const, owner: 'S2' } }, sessions: { S2: live(at(-30)) } };
    const old = { startedAt: at(-11) };
    expect(schedule(input({ ...base, exec: exec({ mode: 'sessions', tasks: sess('T1', 'running', old) }), agents: [] })).actions)
      .toContainEqual({ type: 'relaunch', task: 'T1', attempt: 1 });
    expect(schedule(input({ ...base, exec: exec({ mode: 'sessions', tasks: sess('T1', 'running', old) }), agents: [{ name: 'wp-shop-T1', state: 'working' }] })).actions
      .some(a => a.type === 'relaunch')).toBe(false);
    const capped = schedule(input({ ...base, exec: exec({ mode: 'sessions', tasks: sess('T1', 'running', { ...old, attempts: RELAUNCH_CAP }) }), agents: [] }));
    expect(capped.next.tasks.T1).toMatchObject({ status: 'blocked', detail: 'the session of T1 stopped 3 times', finishedAt: new Date(NOW).toISOString() });
    expect(capped.actions).toContainEqual({ type: 'block', task: 'T1', reason: 'the session of T1 stopped 3 times' });
  });
  it('gives a relaunched front a lease window before its stopped old owner can trigger another relaunch', () => {
    const base = { plan: plan([task('T1')]), states: { T1: { status: 'in_progress' as const, owner: 'S2' } }, sessions: { S2: live(at(-30)) }, agents: null };
    expect(schedule(input({ ...base, exec: exec({ mode: 'sessions', tasks: sess('T1', 'running', { attempts: 1, startedAt: at(-1) }) }) })).actions
      .some(a => a.type === 'relaunch')).toBe(false);
    expect(schedule(input({ ...base, exec: exec({ mode: 'sessions', tasks: sess('T1', 'running', { attempts: 1, startedAt: at(-11) }) }) })).actions)
      .toContainEqual({ type: 'relaunch', task: 'T1', attempt: 2 });
  });
  it('without agents (null) relaunches on a stopped owner and never nudges', () => {
    const r = schedule(input({ plan: plan([task('T1')]), states: { T1: { status: 'in_progress', owner: 'S2' } }, sessions: { S2: live(at(-30)) }, agents: null,
      exec: exec({ mode: 'sessions', tasks: sess('T1', 'running', { startedAt: at(-30), stageSince: at(-30) }) }) }));
    expect(r.actions).toContainEqual({ type: 'relaunch', task: 'T1', attempt: 1 });
    expect(r.actions.some(a => a.type === 'nudge')).toBe(false);
  });
  it('boundaries: quiet at exactly 15 minutes nudges; unclaimed at exactly 10 minutes is not relaunched yet', () => {
    const r = schedule(input({ plan: plan([task('T1')]), states: { T1: { status: 'in_progress', owner: 'S2' } }, sessions: { S2: live(at(5)) },
      agents: [{ name: 'wp-shop-T1', state: 'idle' }], exec: exec({ mode: 'sessions', tasks: sess('T1', 'running', { stageSince: at(-NUDGE_MINUTES) }) }) }));
    expect(r.actions).toContainEqual({ type: 'nudge', task: 'T1', stage: 'implement' });
    const ten = schedule(input({ plan: plan([task('T1')]), exec: exec({ mode: 'sessions', tasks: sess('T1', 'running', { startedAt: at(-10) }) }) }));
    expect(ten.actions.some(a => a.type === 'relaunch')).toBe(false);
  });
  it('relaunchOrBlock: relaunches below the cap and blocks with the reason at it', () => {
    expect(RELAUNCH_CAP).toBe(2);
    expect(relaunchOrBlock('T1', 0)).toEqual({ type: 'relaunch', task: 'T1', attempt: 1 });
    expect(relaunchOrBlock('T1', 1)).toEqual({ type: 'relaunch', task: 'T1', attempt: 2 });
    expect(relaunchOrBlock('T1', 2)).toEqual({ type: 'block', task: 'T1', reason: 'the session of T1 stopped 3 times' });
  });
  it('relaunches a session that never claimed its task within the lease', () => {
    const r = schedule(input({ plan: plan([task('T1')]), exec: exec({ mode: 'sessions', tasks: sess('T1', 'running', { startedAt: at(-11) }) }) }));
    expect(r.actions).toContainEqual({ type: 'relaunch', task: 'T1', attempt: 1 });
    const fresh = schedule(input({ plan: plan([task('T1')]), exec: exec({ mode: 'sessions', tasks: sess('T1', 'running', { startedAt: at(-9) }) }) }));
    expect(fresh.actions.some(a => a.type === 'relaunch')).toBe(false);
  });
  it('a blocked sessions task frees its slot in the same step', () => {
    const r = schedule(input({ plan: plan([task('T1'), task('T2')]), states: { T1: { status: 'in_progress', owner: 'S2' } }, sessions: { S2: live(at(-30)) },
      exec: exec({ mode: 'sessions', parallel: 1, tasks: sess('T1', 'running', { attempts: RELAUNCH_CAP, startedAt: at(-11) }) }), agents: [] }));
    expect(starts(r)).toEqual(['T2']);
  });
  it('nudges a live idle session with no stage change in 15 minutes, once per window', () => {
    const quiet = { stageSince: at(-NUDGE_MINUTES - 1) };
    const base = { plan: plan([task('T1')]), states: { T1: { status: 'in_progress' as const, owner: 'S2' } }, sessions: { S2: live(at(5)) } };
    const idle = [{ name: 'wp-shop-T1', state: 'idle' as const }];
    expect(schedule(input({ ...base, exec: exec({ mode: 'sessions', tasks: sess('T1', 'running', quiet) }), agents: idle })).actions)
      .toContainEqual({ type: 'nudge', task: 'T1', stage: 'implement' });
    expect(schedule(input({ ...base, exec: exec({ mode: 'sessions', tasks: sess('T1', 'running', { ...quiet, nudgedAt: at(-5) }) }), agents: idle })).actions
      .some(a => a.type === 'nudge')).toBe(false);
    expect(schedule(input({ ...base, exec: exec({ mode: 'sessions', tasks: sess('T1', 'running', quiet) }), agents: [{ name: 'wp-shop-T1', state: 'working' }] })).actions
      .some(a => a.type === 'nudge')).toBe(false);
    expect(schedule(input({ ...base, exec: exec({ mode: 'sessions', tasks: sess('T1', 'running', quiet) }), agents: null })).actions
      .some(a => a.type === 'nudge')).toBe(false);
  });
});
