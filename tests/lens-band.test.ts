import { describe, it, expect } from 'vitest';
import { activityTag, bandSubject, lensBand, ownInProgress } from '../src/lens/lens-band.js';
import { joinParts } from '../src/mod/band-fit.js';
import type { PanelModel } from '../src/lens/model.js';

type Row = PanelModel['activities'][number];
const EMPTY: PanelModel = {
  locale: 'en', waypoint: null, superpowers: null, todos: null, subagents: [], tool: null, turnSeconds: null, ccTasks: null,
  forge: null, infinite: null, decisions: null, execution: null, proposals: [], mainModel: null, activities: [], waiting: null, jobs: [], usage: null,
};
const ACT = (over: Partial<Row> = {}): Row => ({
  key: 'T001', kind: 'forge', owner: 'own', dim: false, done: false, slot: false, expanded: false, stopped: false, task: 'T001', project: null, title: null,
  path: 'medium', stage: 'implement', round: null, cap: null, verdict: null, job: null, seconds: 60, agents: [], ...over,
});
const T = { sSubagents: 'Subagents', sNow: 'Now' };

describe("lens's band (F-09)", () => {
  it('two or more tasks of this session in progress: one short part each, «T001 impl · T002 rev r2 · T003 val»', () => {
    const m = { ...EMPTY, activities: [
      ACT(), ACT({ key: 'T002', task: 'T002', stage: 'review', round: 2 }), ACT({ key: 'T003', task: 'T003', stage: 'implement', job: { name: 'review-prep', seconds: 30 } }),
      ACT({ key: 'T009', task: 'T009', owner: 'other', dim: true }), ACT({ key: 'T010', task: 'T010', done: true, stage: null }),
    ] };
    const band = lensBand(m, T, 0);
    expect(joinParts(band.parts)).toBe('T001 impl · T002 rev r2 · T003 val');
    expect(band.parts.map(p => [p.key, p.prio])).toEqual([['slot:T001', 4], ['slot:T002', 4], ['slot:T003', 4]]);
    expect(band.section).toBe('forge');
    expect(ownInProgress(m).map(a => a.task)).toEqual(['T001', 'T002', 'T003']);
  });
  it('one task or none: the headline of today, its count and detail, then the agents, those without a task and the spend', () => {
    const m = { ...EMPTY, todos: { total: 3, done: 1, inProgress: 'Writing tests', next: ['c'], active: ['Writing tests'], cells: 'dap' },
      subagents: [{ id: 'x', type: 'Explore', seconds: 5 }],
      activities: [{ ...ACT({ key: 'adhoc', kind: 'adhoc', task: null, stage: null }), agents: [{ id: 'x', type: 'Explore', description: 'Find the parser', tool: null, seconds: 5, status: 'running' as const, depth: 0 }] }] };
    const band = lensBand(m, T, 0);
    expect(joinParts(band.parts)).toBe('Writing tests · 1/3 · ◎ 1 · Find the parser');
    expect(band.parts.find(p => p.key === 'title')).toMatchObject({ prio: 4, title: 'Writing tests' });
    expect(band).toMatchObject({ section: 'todos', ratio: 1 / 3, spin: true });
    expect(band.cells).toHaveLength(3);
  });
  it('before any model it names the subagents it heard of', () => {
    expect(joinParts(lensBand(null, T, 2).parts)).toBe('Subagents · ◎ 2');
  });
  it('a job in the background, a round and a task with no stage, as a band says them', () => {
    expect(activityTag(ACT({ job: { name: 'integrate', seconds: 5 } }))).toBe('T001 int');
    expect(activityTag(ACT({ stage: 'review', round: 3 }))).toBe('T001 rev r3');
    expect(activityTag(ACT({ stage: null }))).toBe('T001');
  });
});

describe("what lens's band is about, which its × closes it for (final review m-4)", () => {
  const todos = { total: 3, done: 1, inProgress: 'Writing tests', next: ['c'], active: ['Writing tests'], cells: 'dap' };
  it('the tasks it names, the run, the todos, the subagents, or the section and title of its headline', () => {
    expect(bandSubject({ ...EMPTY, activities: [ACT(), ACT({ key: 'T002', task: 'T002' })] })).toBe('tasks:T001 T002');
    expect(bandSubject({ ...EMPTY, todos })).toBe('todos:3');
    expect(bandSubject(null)).toBe('agents:');
    expect(bandSubject({ ...EMPTY, subagents: [{ id: 'x', type: 'Explore', seconds: 5 }] })).toBe('agents:x');
    const sp = { plan: 'docs/plan.md', tasks: 4, done: 1, current: null, stale: false } as unknown as PanelModel['superpowers'];
    expect(bandSubject({ ...EMPTY, superpowers: sp })).toBe('superpowers:docs/plan.md');
  });
  it('stays the same while the todos move on, and changes when the work it is about changes', () => {
    expect(bandSubject({ ...EMPTY, todos: { ...todos, done: 2, inProgress: 'Fixing the parser' } })).toBe(bandSubject({ ...EMPTY, todos }));
    expect(bandSubject({ ...EMPTY, activities: [ACT(), ACT({ key: 'T003', task: 'T003' })] })).not.toBe(bandSubject({ ...EMPTY, activities: [ACT(), ACT({ key: 'T002', task: 'T002' })] }));
  });
  it('the tasks it names, whatever their order: two tasks that swap recency are the same subject (re-review m-3)', () => {
    const t2 = ACT({ key: 'T002', task: 'T002' });
    expect(bandSubject({ ...EMPTY, activities: [ACT(), t2] })).toBe(bandSubject({ ...EMPTY, activities: [t2, ACT()] }));
  });
  it('the todos by their list and the subagents by their ids: a new todo or agent is another subject, a step along the list is not (re-review m-4)', () => {
    const m = { ...EMPTY, todos };
    const list = ['Write tests', 'Fix the parser', 'Ship it'];
    expect(bandSubject(m, { todos: list })).toBe(bandSubject(m, { todos: [...list].reverse() }));
    expect(bandSubject(m, { todos: [...list, 'Write the docs'] })).not.toBe(bandSubject(m, { todos: list }));
    const agents = { ...EMPTY, subagents: [{ id: 'a1', type: 'Explore', seconds: 5 }] };
    expect(bandSubject(agents, { agents: ['a1'] })).not.toBe(bandSubject(agents, { agents: ['a1', 'a2'] }));
    expect(bandSubject(null, { agents: ['a2', 'a1'] })).toBe(bandSubject(null, { agents: ['a1', 'a2'] }));
    expect(bandSubject(null, { agents: ['a1'] })).not.toBe(bandSubject(null, { agents: ['a3'] }));
  });
});
