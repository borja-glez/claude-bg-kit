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
    expect(m).toMatchObject({ total: 6, done: 0, percent: 0, paceMin: null, etaIso: null, startedAt: null, phasesDone: 0, phaseCount: 2 });
    expect(m.byPhase.F1.status).toBe('committed');
    expect(m.byPhase.F2.status).toBe('provisional');
  });

  it('computes percent, pace, eta and phase status', () => {
    const s: States = {
      T001: { status: 'done', startedAt: '2026-10-11T10:00:00Z', doneAt: '2026-10-11T10:20:00Z' },
      T002: { status: 'done', startedAt: '2026-10-11T10:20:00Z', doneAt: '2026-10-11T11:00:00Z' },
      T003: { status: 'in_progress', owner: 'main', startedAt: '2026-10-11T11:30:00Z' },
    };
    const m = computeMetrics(plan, s, NOW);
    expect(m.done).toBe(2);
    expect(m.percent).toBe(33);
    expect(m.paceMin).toBe(30);
    expect(m.etaIso).toBe('2026-10-11T14:00:00.000Z'); // 4 remaining × 30 min
    expect(m.startedAt).toBe('2026-10-11T10:00:00.000Z');
    expect(m.inProgress).toEqual(['T003']);
    expect(m.byPhase.F1).toEqual({ done: 2, total: 3, status: 'in_progress' });
    expect(m.byTrack.backend).toEqual({ done: 2, total: 4 });
    expect(computeMetrics(plan, s, NOW, 2).etaIso).toBe('2026-10-11T13:00:00.000Z');
  });

  it('ignores negative durations from clock skew', () => {
    const s: States = { T001: { status: 'done', startedAt: '2026-10-11T10:20:00Z', doneAt: '2026-10-11T10:00:00Z' } };
    expect(computeMetrics(plan, s, NOW).paceMin).toBe(0);
  });

  it('marks a fully done phase as done', () => {
    const s: States = { T001: { status: 'done' }, T002: { status: 'done' }, T003: { status: 'done' } };
    const m = computeMetrics(plan, s, NOW);
    expect(m.byPhase.F1.status).toBe('done');
    expect(m.phasesDone).toBe(1);
  });
});
