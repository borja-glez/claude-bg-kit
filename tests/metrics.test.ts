import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePlan } from '../src/lib/plan.js';
import { computeMetrics } from '../src/lib/metrics.js';
import type { States } from '../src/lib/types.js';

const plan = parsePlan(readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-11T12:00:00Z');

describe('computeMetrics', () => {
  it('handles an untouched plan', () => {
    const m = computeMetrics(plan, {}, NOW);
    expect(m).toMatchObject({ total: 6, done: 0, percent: 0, paceMin: null, startedAt: null, phasesDone: 0, phaseCount: 2 });
    expect(m).not.toHaveProperty('etaIso');
    expect(m.byPhase.F1.status).toBe('committed');
    expect(m.byPhase.F2.status).toBe('provisional');
  });

  it('computes percent, pace and phase status', () => {
    const s: States = {
      T001: { status: 'done', startedAt: '2026-10-11T10:00:00Z', doneAt: '2026-10-11T10:20:00Z' },
      T002: { status: 'done', startedAt: '2026-10-11T10:20:00Z', doneAt: '2026-10-11T11:00:00Z' },
      T003: { status: 'in_progress', owner: 'main', startedAt: '2026-10-11T11:30:00Z' },
    };
    const m = computeMetrics(plan, s, NOW);
    expect(m.done).toBe(2);
    expect(m.percent).toBe(33);
    expect(m.paceMin).toBe(30);
    expect(m.startedAt).toBe('2026-10-11T10:00:00.000Z');
    expect(m.inProgress).toEqual(['T003']);
    expect(m.byPhase.F1).toEqual({ done: 2, total: 3, status: 'in_progress' });
    expect(m.byTrack.backend).toEqual({ done: 2, total: 4 });
  });

  it('ignores negative durations from clock skew', () => {
    const s: States = { T001: { status: 'done', startedAt: '2026-10-11T10:20:00Z', doneAt: '2026-10-11T10:00:00Z' } };
    expect(computeMetrics(plan, s, NOW).paceMin).toBe(0);
  });

  it('does not throw on a junk startedAt or doneAt, and skips that task from the pace', () => {
    const good = { status: 'done', startedAt: '2026-10-11T10:00:00Z', doneAt: '2026-10-11T10:20:00Z' } as const;
    const s = {
      T001: good,
      T002: { status: 'done', startedAt: 'garbage', doneAt: '2026-10-11T11:00:00Z' },
      T003: { status: 'done', startedAt: '2026-10-11T10:20:00Z', doneAt: 'nope' },
    } as States;
    let m!: ReturnType<typeof computeMetrics>;
    expect(() => { m = computeMetrics(plan, s, NOW); }).not.toThrow();
    expect(m.done).toBe(3);
    expect(m.paceMin).toBe(20);
  });

  it('marks a fully done phase as done', () => {
    const s: States = { T001: { status: 'done' }, T002: { status: 'done' }, T003: { status: 'done' } };
    const m = computeMetrics(plan, s, NOW);
    expect(m.byPhase.F1.status).toBe('done');
    expect(m.phasesDone).toBe(1);
  });

  it('by version: the tasks of its phases; the current one is the first with work left (G-11, H-27)', () => {
    const two = { ...plan, versions: [{ id: '0.1', phases: ['F1'] }, { id: '0.2', phases: ['F2'] }] };
    const s: States = { T001: { status: 'done' }, T002: { status: 'done' } };
    const m = computeMetrics(two, s, NOW);
    expect(m.byVersion).toEqual({ '0.1': { done: 2, total: 3, percent: 67 }, '0.2': { done: 0, total: 3, percent: 0 } });
    expect(m.currentVersion).toBe('0.1');
    expect(computeMetrics(two, { ...s, T003: { status: 'done' } }, NOW).currentVersion).toBe('0.2');
    const all: States = Object.fromEntries(two.tasks.map(t => [t.id, { status: 'done' as const }]));
    expect(computeMetrics(two, all, NOW).currentVersion).toBe('0.2');
    expect(computeMetrics({ ...plan, versions: [] }, s, NOW)).toMatchObject({ byVersion: {}, currentVersion: null });
  });

  it('by version: a version with no tasks counts 0 of 0 and is never the current one; a blocked task is work left (carry 3)', () => {
    const three = { ...plan, versions: [{ id: '0.0', phases: ['F9'] }, { id: '0.1', phases: ['F1'] }, { id: '0.2', phases: ['F2'] }] };
    const s: States = { T001: { status: 'done' }, T002: { status: 'done' }, T003: { status: 'blocked', blockedBy: ['external'] } };
    const m = computeMetrics(three, s, NOW);
    expect(m.byVersion['0.0']).toEqual({ done: 0, total: 0, percent: 0 });
    expect(m.byVersion['0.1']).toEqual({ done: 2, total: 3, percent: 67 });
    expect(m.currentVersion).toBe('0.1');
    // Only empty versions: the last one, as when every version is done.
    expect(computeMetrics({ ...plan, versions: [{ id: 'a', phases: [] }, { id: 'b', phases: ['F9'] }] }, s, NOW).currentVersion).toBe('b');
  });
});
