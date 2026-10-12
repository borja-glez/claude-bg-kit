import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePlan } from '../src/lib/plan.js';
import { burndown, criticalPath, forecast, remainingMin, zoneHeat } from '../src/lib/insights.js';
import { groupIds, layoutRows, NONE_GROUP, windowAt } from '../src/lib/timeline.js';
import type { States } from '../src/lib/types.js';

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
  it('gives a range from the critical path to the serial work, and nothing when all is done', () => {
    const f = forecast(plan, {}, NOW, { sessions: 1 })!;
    expect(f.from).toBe(NOW + 110 * 60000);
    expect(f.to).toBeGreaterThan(f.from);
    const all: States = Object.fromEntries(plan.tasks.map(t => [t.id, { status: 'done' as const }]));
    expect(forecast(plan, all, NOW)).toBeNull();
  });
});

describe('burndown', () => {
  it('steps down at each doneAt and ends at what is left now', () => {
    const s: States = {
      T001: { status: 'done', startedAt: '2026-10-11T08:00:00Z', doneAt: '2026-10-11T09:00:00Z' },
      T002: { status: 'done', startedAt: '2026-10-11T09:00:00Z', doneAt: '2026-10-11T10:00:00Z' },
    };
    const ids = plan.tasks.filter(t => t.phase === 'F1').map(t => t.id);
    const b = burndown(plan, s, ids, NOW, NOW + 2 * H)!;
    expect(b.total).toBe(3);
    expect(b.actual.map(p => p.left)).toEqual([3, 2, 1, 1]);
    expect(b.ideal).toEqual([{ t: Date.parse('2026-10-11T08:00:00Z'), left: 3 }, { t: NOW + 2 * H, left: 0 }]);
    expect(burndown(plan, s, [], NOW, null)).toBeNull();
  });
});

describe('zone heat', () => {
  it('counts planned, done, running and touched tasks per zone', () => {
    const s: States = { T001: { status: 'done', zonesTouched: ['src/db/**', 'src/extra/**'] }, T002: { status: 'in_progress' } };
    const z = zoneHeat(plan, s);
    expect(z.find(x => x.zone === 'src/db/**')).toEqual({ zone: 'src/db/**', tasks: 1, done: 1, active: 0, touched: 1 });
    expect(z.find(x => x.zone === 'src/api/orders/**')?.active).toBe(1);
    expect(z.find(x => x.zone === 'src/extra/**')).toMatchObject({ tasks: 0, touched: 1 });
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
