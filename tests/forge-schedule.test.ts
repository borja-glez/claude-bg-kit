import { describe, it, expect } from 'vitest';
import { schedule, widthOf, STEP_WAIT_SECONDS, type ScheduleInput } from '../src/forge/schedule.js';
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
  [id]: { status, stage: 'implement' as const, round: 1, worktree: `/w/${id}`, branch: `task/${id}`, executor: 'subagents' as const, attempts: 0, agent: null, startedAt: at(-5), updatedAt: at(-1), detail: null },
});
const input = (over: Partial<ScheduleInput>): ScheduleInput => ({ plan: plan([]), states: {}, sessions: {}, exec: exec(), integrated: [], now: NOW, ...over });
const starts = (r: ReturnType<typeof schedule>) => r.actions.filter(a => a.type === 'start').map(a => (a as { task: string }).task);

describe('schedule', () => {
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
  it('integrates one accepted task per tick and then ticks again at once', () => {
    const r = schedule(input({ plan: plan([task('T1'), task('T2')]), exec: exec({ tasks: { ...running('T1', 'accepted'), ...running('T2', 'accepted') } }), states: { T1: { status: 'in_progress', owner: 'main' }, T2: { status: 'in_progress', owner: 'main' } } }));
    expect(r.actions[0]).toEqual({ type: 'integrate', task: 'T1', ref: 'task/T1' });
    expect(r.actions.filter(a => a.type === 'integrate')).toHaveLength(1);
    expect(r.actions.at(-1)).toEqual({ type: 'wait', seconds: 0 });
  });
  it('finishes when every task is done and nothing waits to be integrated', () => {
    const r = schedule(input({ plan: plan([task('T1')]), states: { T1: { status: 'done' } }, exec: exec({ tasks: running('T1', 'integrated' as never) }) }));
    expect(r.actions).toEqual([{ type: 'finish' }]);
    expect(r.next).toMatchObject({ active: false, stopReason: 'finished' });
  });
  it('stalls with a reason per task when nothing can move', () => {
    const p = plan([task('T1'), task('T2'), task('T3', ['T9']), task('T9')]);
    const states: States = { T1: { status: 'blocked', blockedBy: ['external'] }, T9: { status: 'in_progress', owner: 'manual-1' } };
    const sessions = { 'manual-1': { name: 'm', status: 'active' as const, heartbeatAt: at(-1), leaseUntil: at(5) } };
    const r = schedule(input({ plan: p, states, sessions, exec: exec({ tasks: running('T2', 'conflict') }) }));
    expect(r.actions).toEqual([{ type: 'stalled', reason: expect.stringContaining('blocked: T1') }]);
    expect(r.next.stallReason).toContain('conflict: T2');
    expect(r.next.stallReason).toContain('claimed by manual-1: T9');
    expect(r.next).toMatchObject({ active: false, stopReason: 'stalled' });
  });
  it('widthOf: the most tasks that can run at once, by dependencies and zones', () => {
    expect(widthOf(plan([task('T1'), task('T2', ['T1']), task('T3', ['T2'])]))).toBe(1);
    expect(widthOf(plan([task('T1'), task('T2', ['T1']), task('T3', ['T1']), task('T4', ['T1'])]))).toBe(3);
    expect(widthOf(plan([task('T1', [], ['src/x/**']), task('T2', [], ['src/x/a.ts'])]))).toBe(1);
  });
});
