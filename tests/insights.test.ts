import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePlan } from '../src/lib/plan.js';
import { burndown, criticalPath, forecastEnd, forecastSchedule, maxOf, PACE_MAX, PACE_MIN, paceRatioOf, remainingMin, targetMs, versionEnds, zoneDir, zoneHeat } from '../src/lib/insights.js';
import { groupIds, layoutRows, NONE_GROUP, windowAt } from '../src/lib/timeline.js';
import type { PlanView, States } from '../src/lib/types.js';

const plan = parsePlan(readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8'));
const H = 3600000;
const NOW = Date.parse('2026-10-11T12:00:00Z');

describe('critical path and forecast', () => {
  it('follows the longest chain of unfinished tasks by their estimates', () => {
    // T001 (20) -> T002 (30) -> T004 (30 default) -> T005 / T006 (30 default each)
    const cp = criticalPath(plan, {}, NOW);
    expect(cp.ids.slice(0, 3)).toEqual(['T001', 'T002', 'T004']);
    expect(cp.minutes).toBe(20 + 30 + 30 + 30);
  });
  it('skips done tasks and counts what a running one has left', () => {
    const s: States = { T001: { status: 'done' }, T002: { status: 'in_progress', startedAt: new Date(NOW - 20 * 60000).toISOString() } };
    expect(remainingMin(plan, s, 'T002', NOW)).toBe(10);
    expect(remainingMin(plan, s, 'T001', NOW)).toBe(0);
    const cp = criticalPath(plan, s, NOW);
    expect(cp.ids[0]).toBe('T002');
    expect(cp.minutes).toBe(10 + 30 + 30);
  });
});

const MIN = 60000;
/** A plan of one phase and one track whose tasks have the given estimates and dependencies. */
const mini = (tasks: { id: string; est?: number; deps?: string[] }[]): PlanView => ({
  tracks: [{ id: 'a', name: 'A', color: 'blue' }], versions: [], phases: [{ id: 'F1', name: 'F', plan_status: 'committed' }],
  tasks: tasks.map(t => ({ id: t.id, title: t.id, track: 'a', phase: 'F1', done_when: 'x', depends_on: t.deps ?? [], zones: [], ...(t.est !== undefined ? { estimate_min: t.est } : {}) })),
});

describe('forecastEnd: the one forecast of the page (G-12)', () => {
  it('a chain takes its whole length however many work in parallel', () => {
    const chain = mini([{ id: 'A', est: 10 }, { id: 'B', est: 20, deps: ['A'] }, { id: 'C', est: 30, deps: ['B'] }]);
    expect(forecastEnd(chain, {}, NOW, { parallel: 3, paceRatio: 1 })).toEqual({ at: NOW + 60 * MIN, parallel: 3 });
  });
  it('independent tasks take the longest one with enough in parallel, and their sum with one', () => {
    const three = mini([{ id: 'A', est: 10 }, { id: 'B', est: 20 }, { id: 'C', est: 30 }]);
    expect(forecastEnd(three, {}, NOW, { parallel: 3, paceRatio: 1 })!.at).toBe(NOW + 30 * MIN);
    expect(forecastEnd(three, {}, NOW, { parallel: 1, paceRatio: 1 })!.at).toBe(NOW + 60 * MIN);
  });
  it('takes first the task with the most critical path ahead, so two workers end in 60 min and not 70', () => {
    const p = mini([{ id: 'A', est: 10 }, { id: 'B', est: 50, deps: ['A'] }, { id: 'P', est: 30 }, { id: 'Q', est: 30 }]);
    expect(forecastEnd(p, {}, NOW, { parallel: 2, paceRatio: 1 })!.at).toBe(NOW + 60 * MIN);
  });
  it('v3: a version ends with its last pending task in the plan’s one schedule, waiting for the tasks of another version it needs', () => {
    // v1 = F1 (A 10, B 20 after A); v2 = F2 (C 30, which needs B). One worker: A ends at 10, B at 30, C at 60.
    const p: PlanView = { ...mini([{ id: 'A', est: 10 }, { id: 'B', est: 20, deps: ['A'] }]), phases: [{ id: 'F1', name: 'F', plan_status: 'committed' }, { id: 'F2', name: 'G', plan_status: 'committed' }],
      versions: [{ id: '1', phases: ['F1'] }, { id: '2', phases: ['F2'] }, { id: '3', phases: [] }] };
    p.tasks.push({ id: 'C', title: 'C', track: 'a', phase: 'F2', done_when: 'x', depends_on: ['B'], zones: [], estimate_min: 30 });
    const s = forecastSchedule(p, {}, NOW, { parallel: 1, paceRatio: 1 })!;
    expect(s.at).toBe(NOW + 60 * MIN);
    expect(Object.fromEntries(s.ends)).toEqual({ A: NOW + 10 * MIN, B: NOW + 30 * MIN, C: NOW + 60 * MIN });
    expect(forecastEnd(p, {}, NOW, { parallel: 1, paceRatio: 1 })).toEqual({ at: NOW + 60 * MIN, parallel: 1 });
    // A version with nothing pending (v3 holds no phase; v1 once A and B are done) has no end.
    expect(versionEnds(p, s.ends)).toEqual({ '1': NOW + 30 * MIN, '2': NOW + 60 * MIN });
    const done = forecastSchedule(p, { A: { status: 'done' }, B: { status: 'done' } }, NOW, { parallel: 1, paceRatio: 1 })!;
    expect(versionEnds(p, done.ends)).toEqual({ '2': NOW + 30 * MIN });
    expect(versionEnds(p, null)).toEqual({});
  });
  it('the running tasks start now with what they have left, and the pace stretches every task', () => {
    const p = mini([{ id: 'A', est: 30 }, { id: 'B', est: 30 }]);
    const s: States = { A: { status: 'in_progress', startedAt: new Date(NOW - 20 * MIN).toISOString() } };
    // A has 10 min left and goes first; B takes 30 after it.
    expect(forecastEnd(p, s, NOW, { parallel: 1, paceRatio: 1 })!.at).toBe(NOW + 40 * MIN);
    expect(forecastEnd(p, s, NOW, { parallel: 1, paceRatio: 2 })!.at).toBe(NOW + 80 * MIN);
  });
  it('nothing pending gives null; a parallel or a pace out of range is taken within bounds (Review Focus 1, 4)', () => {
    const p = mini([{ id: 'A', est: 10 }]);
    expect(forecastEnd(p, { A: { status: 'done' } }, NOW, { parallel: 2, paceRatio: 1 })).toBeNull();
    expect(forecastEnd(mini([]), {}, NOW, { parallel: 2, paceRatio: 1 })).toBeNull();
    expect(forecastEnd(p, {}, NOW, { parallel: 0, paceRatio: 1 })).toEqual({ at: NOW + 10 * MIN, parallel: 1 });
    expect(forecastEnd(p, {}, NOW, { parallel: 2.7, paceRatio: 100 })).toEqual({ at: NOW + 10 * PACE_MAX * MIN, parallel: 2 });
    expect(forecastEnd(p, {}, NOW, { parallel: 2, paceRatio: Number.NaN })!.at).toBe(NOW + 10 * MIN);
  });
  it('a cycle, a dependency outside the plan, a junk estimate and a junk start still give a finite date (Review Focus 4)', () => {
    const p = mini([{ id: 'A', est: 10, deps: ['B'] }, { id: 'B', est: 10, deps: ['A'] }, { id: 'C', deps: ['Z9'] }, { id: 'D', est: Number.NaN }]);
    const s: States = { D: { status: 'in_progress', startedAt: 'garbage' } };
    const f = forecastEnd(p, s, NOW, { parallel: 1, paceRatio: 1 })!;
    expect(Number.isFinite(f.at)).toBe(true);
    // A 10 + B 10 + C 30 (the default estimate) + D 30 (a junk estimate and a junk start: the default).
    expect(f.at).toBe(NOW + 80 * MIN);
  });
  it('paceRatioOf: the median of real / estimate over the done tasks that have both, within [0.25, 4]; 1 without any', () => {
    const p = mini([{ id: 'A', est: 10 }, { id: 'B', est: 10 }, { id: 'C', est: 10 }, { id: 'D' }]);
    const done = (min: number) => ({ status: 'done' as const, startedAt: new Date(NOW - min * MIN).toISOString(), doneAt: new Date(NOW).toISOString() });
    expect(paceRatioOf(p, { A: done(10), B: done(20), C: done(40), D: done(5) })).toBe(2);
    expect(paceRatioOf(p, { A: done(100), B: done(200) })).toBe(PACE_MAX);
    expect(paceRatioOf(p, { A: done(1) })).toBe(PACE_MIN);
    expect(paceRatioOf(p, {})).toBe(1);
    expect(paceRatioOf(p, { A: { status: 'done', startedAt: 'x', doneAt: 'y' } })).toBe(1);
  });
});

describe('maxOf (final carry 1)', () => {
  it('the largest of any number of values, past what a spread into Math.max takes; 0 for none', () => {
    const many = Array.from({ length: 600_000 }, (_, i) => (i * 7919) % 600_000);
    expect(() => Math.max(...many)).toThrow(RangeError);
    expect(maxOf(many)).toBe(599_999);
    expect(maxOf(new Map([['a', 3], ['b', 9]]).values())).toBe(9);
    expect(maxOf([])).toBe(0);
  });
});

describe('burndown (H-26)', () => {
  const s: States = {
    T001: { status: 'done', startedAt: '2026-10-11T08:00:00Z', doneAt: '2026-10-11T09:00:00Z' },
    T002: { status: 'done', startedAt: '2026-10-11T09:00:00Z', doneAt: '2026-10-11T10:00:00Z' },
  };
  const ids = plan.tasks.filter(t => t.phase === 'F1').map(t => t.id);
  it('steps down at each doneAt and ends at what is left now; without a target there is no ideal line', () => {
    const b = burndown(plan, s, ids, NOW, { forecast: NOW + 2 * H, target: null })!;
    expect(b.total).toBe(3);
    expect(b.actual.map(p => p.left)).toEqual([3, 2, 1, 1]);
    expect(b.ideal).toBeNull();
    expect(b.end).toBe(NOW + 2 * H);
    expect(burndown(plan, s, [], NOW, { forecast: null, target: null })).toBeNull();
  });
  it('with a target the ideal line goes from the first start to zero on it, and the chart reaches it', () => {
    const target = targetMs('2026-10-13')!;
    const b = burndown(plan, s, ids, NOW, { forecast: NOW + 2 * H, target })!;
    expect(b.ideal).toEqual([{ t: Date.parse('2026-10-11T08:00:00Z'), left: 3 }, { t: target, left: 0 }]);
    expect(b.target).toBe(target);
    expect(b.end).toBe(target);
  });
  it('targetMs is the end of the target day, local time; anything else is null', () => {
    expect(targetMs('2026-10-13')).toBe(Date.parse('2026-10-13T23:59:59'));
    expect(targetMs('soon')).toBeNull();
    expect(targetMs(undefined)).toBeNull();
  });
});

describe('zone heat by directory (G-27)', () => {
  it('zoneDir keeps the first two segments before any glob', () => {
    expect(zoneDir('src/a/b/**')).toBe('src/a');
    expect(zoneDir('src/a/b/c.ts')).toBe('src/a');
    expect(zoneDir('web/cart/**')).toBe('web/cart');
    expect(zoneDir('README.md')).toBe('README.md');
    expect(zoneDir('**/*.ts')).toBe('**/*.ts');
    expect(zoneDir('src\\a\\b\\c.ts')).toBe('src/a');
    // Final carry 3: an absolute path keeps its leading «/».
    expect(zoneDir('/abs/x/y/**')).toBe('/abs/x');
    expect(zoneDir('/etc')).toBe('/etc');
  });
  it('counts planned, done, running and touched tasks per directory, and marks first one that two running tasks share', () => {
    const p = { ...plan, tasks: plan.tasks.map(t => (t.id === 'T003' ? { ...t, zones: ['src/api/cart/**'] } : t)) };
    const s: States = { T001: { status: 'done', zonesTouched: ['src/db/**', 'src/extra/x.ts'] }, T002: { status: 'in_progress' }, T003: { status: 'claimed' } };
    const z = zoneHeat(p, s);
    expect(z[0]).toEqual({ zone: 'src/api', tasks: 2, done: 0, active: 2, touched: 0, shared: true });
    expect(z.find(x => x.zone === 'src/db')).toEqual({ zone: 'src/db', tasks: 1, done: 1, active: 0, touched: 1, shared: false });
    expect(z.find(x => x.zone === 'src/extra')).toMatchObject({ tasks: 0, touched: 1, shared: false });
  });
});

describe('timeline groups and status filter', () => {
  const s: States = { T001: { status: 'done', owner: 'S1', startedAt: '2026-10-11T08:00:00Z', doneAt: '2026-10-11T09:00:00Z' }, T003: { status: 'in_progress', owner: 'S2', startedAt: '2026-10-11T11:00:00Z' } };
  const win = windowAt(24 * H, NOW);
  it('groups by the sessions that own tasks, then the unowned', () => {
    expect(groupIds(plan, s, 'session')).toEqual(['S1', 'S2', NONE_GROUP]);
    const rows = layoutRows(plan, s, NOW, win, new Set([NONE_GROUP]), { groupBy: 'session', unassigned: 'sin asignar' });
    expect(rows.find(r => r.id === NONE_GROUP)?.label).toBe('sin asignar');
  });
  it('groups by category, uncategorized last', () => {
    const ids = groupIds(plan, s, 'category');
    expect(ids.at(-1)).toBe(NONE_GROUP);
  });
  it('filters task rows by status and keeps the group rows', () => {
    const rows = layoutRows(plan, s, NOW, win, new Set(['F1', 'F2']), { statuses: ['in_progress'] });
    expect(rows.filter(r => r.kind === 'task').map(r => r.id)).toEqual(['T003']);
    expect(rows.filter(r => r.kind === 'phase').map(r => r.id)).toEqual(['F1', 'F2']);
  });
});
