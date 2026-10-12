import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseLooseTasks, planOfLoose, statesOfLoose, writeLoose, readLoose, looseFile, LOOSE_MAX_TASKS, type LooseTask } from '../src/forge/loose.js';
import { schedule } from '../src/forge/schedule.js';
import type { ExecutionState, ExecTask } from '../src/lib/execution-state.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const T = (id: string, over: Partial<LooseTask> = {}) => ({ id, title: `do ${id}`, path: 'small', zones: [`src/${id}.ts`], depends_on: [], ...over });
const ok = (x: unknown) => { const r = parseLooseTasks(x); if ('error' in r) throw new Error(r.error); return r.tasks; };
const err = (x: unknown) => { const r = parseLooseTasks(x); return 'error' in r ? r.error : null; };
const exec = (tasks: Record<string, ExecTask> = {}): ExecutionState => ({
  runId: 'loose-1', kind: 'ephemeral', mode: 'subagents', parallel: 3, project: 'loose', base: 'main', branch: 'main', mergeOnFinish: false,
  coordinator: 'main', hookSession: null, active: true, stopReason: null, stallReason: null, startedAt: new Date(NOW - 60000).toISOString(),
  lastStepAt: null, lastBlockStep: null, sleepUntil: null, tasks,
});
const done = (status: ExecTask['status']): ExecTask => ({ status, stage: 'integrate', round: 1, worktree: '/w', branch: 'task/x', executor: 'subagents', attempts: 0, agent: null, startedAt: new Date(NOW).toISOString(), stageSince: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(), detail: null });
const starts = (r: ReturnType<typeof schedule>) => r.actions.filter(a => a.type === 'start').map(a => (a as { task: string }).task);

describe('loose tasks', () => {
  it('parses a batch, clips titles and gives a task without zones the whole repo', () => {
    const tasks = ok([T('fix-cart'), T('docs-typo', { path: 'trivial', zones: [], title: 'x'.repeat(300) })]);
    expect(tasks[0]).toEqual({ id: 'fix-cart', title: 'do fix-cart', path: 'small', zones: ['src/fix-cart.ts'], depends_on: [] });
    expect(tasks[1].zones).toEqual(['**']);
    expect(tasks[1].title).toHaveLength(200);
  });
  it('refuses one task, too many, duplicates, bad ids, a large path, unknown or own dependencies, cycles and escaping zones', () => {
    expect(err([T('a')])).toMatch(/at least 2/);
    expect(err(Array.from({ length: LOOSE_MAX_TASKS + 1 }, (_, i) => T(`t${i}`)))).toMatch(/at most 20/);
    expect(err([T('a'), T('a')])).toMatch(/duplicate id a/);
    expect(err([T('a'), T('../b')])).toMatch(/invalid id/);
    // 'large' is outside LoosePath: a raw object, as the JSON file would hold it.
    expect(err([T('a'), { ...T('b'), path: 'large' }])).toMatch(/b: a Large request follows its own path/);
    expect(err([T('a'), T('b', { depends_on: ['zz'] })])).toMatch(/b depends on unknown zz/);
    expect(err([T('a', { depends_on: ['a'] }), T('b')])).toMatch(/a depends on itself/);
    expect(err([T('a', { depends_on: ['b'] }), T('b', { depends_on: ['a'] })])).toMatch(/cycle/);
    expect(err([T('a', { zones: ['../outside/**'] }), T('b')])).toMatch(/a: invalid zone/);
    expect(err([T('a', { zones: ['C:/x'] }), T('b')])).toMatch(/a: invalid zone/);
    expect(err('nope')).toMatch(/array/);
  });
  it('schedules independent tasks together, a dependent one after its dependency is integrated, and a zoneless one alone', () => {
    const tasks = ok([T('a'), T('b'), T('c', { depends_on: ['a'] }), T('d', { zones: [] })]);
    const plan = planOfLoose(tasks);
    const first = schedule({ plan, states: statesOfLoose(exec()), sessions: {}, exec: exec(), integrated: [], now: NOW });
    expect(starts(first)).toEqual(['a', 'b']);
    const afterA = exec({ a: done('integrated'), b: done('running') });
    expect(starts(schedule({ plan, states: statesOfLoose(afterA), sessions: {}, exec: afterA, integrated: [], now: NOW }))).toEqual(['c']);
    const accepted = exec({ a: done('accepted') });
    expect(starts(schedule({ plan, states: statesOfLoose(accepted), sessions: {}, exec: accepted, integrated: [], now: NOW }))).not.toContain('c');
  });
  it('finishes when every loose task is integrated and stalls with the reason when one is blocked', () => {
    const tasks = ok([T('a'), T('b')]);
    const all = exec({ a: done('integrated'), b: done('integrated') });
    expect(schedule({ plan: planOfLoose(tasks), states: statesOfLoose(all), sessions: {}, exec: all, integrated: [], now: NOW }).actions).toContainEqual({ type: 'finish' });
    const stuck = exec({ a: done('integrated'), b: done('blocked') });
    const r = schedule({ plan: planOfLoose(tasks), states: statesOfLoose(stuck), sessions: {}, exec: stuck, integrated: [], now: NOW });
    expect(r.actions.at(-1)).toMatchObject({ type: 'stalled' });
    expect(r.next.stallReason).toContain('blocked: b');
  });
  describe('file', () => {
    let root: string;
    beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'forge-loose-')); });
    afterEach(() => rmSync(root, { recursive: true, force: true }));
    it('writes and reads back only for its own run', () => {
      writeLoose(root, { runId: 'loose-1', tasks: ok([T('a'), T('b')]) });
      expect(looseFile(root)).toBe(path.join(root, '.forge', 'loose.json'));
      expect(readLoose(root, 'loose-1')?.tasks.map(t => t.id)).toEqual(['a', 'b']);
      expect(readLoose(root, 'other')).toBeNull();
    });
  });
});
