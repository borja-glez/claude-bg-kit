import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePlan } from '../src/lib/plan.js';
import { autoTicks, clipBar, layoutRows, MIN_SPAN, phaseLabel, phaseName, planRange, stepFor, taskSpan, ticks, windowAt, windowFor, zoomAround } from '../src/lib/timeline.js';
import type { States } from '../src/lib/types.js';

const plan = parsePlan(readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8'));
const H = 3600000;
const NOW = Date.parse('2026-10-11T12:00:00Z');

describe('windowFor / ticks', () => {
  it('puts now at 75% of the window and shifts by whole spans', () => {
    expect(windowFor('1d', NOW)).toEqual({ from: NOW - 18 * H, to: NOW + 6 * H });
    expect(windowFor('1d', NOW, -1)).toEqual({ from: NOW - 42 * H, to: NOW - 18 * H });
  });
  it('produces aligned ticks inside the window', () => {
    const t = ticks(windowFor('6h', NOW), '6h');
    expect(t.every(x => x % H === 0)).toBe(true);
    expect(t).toHaveLength(6);
  });
});

describe('clipBar', () => {
  const win = { from: 0, to: 100 };
  it('clips to 0..100 and keeps a minimum visible width', () => {
    expect(clipBar(-50, 50, 'done', win)).toEqual({ left: 0, width: 50, kind: 'done' });
    expect(clipBar(90, 150, 'done', win)).toEqual({ left: 90, width: 10, kind: 'done' });
    expect(clipBar(40, 40, 'done', win)).toEqual({ left: 40, width: 0.4, kind: 'done' });
  });
  it('drops bars outside the window and repairs end < start', () => {
    expect(clipBar(120, 130, 'done', win)).toBeNull();
    expect(clipBar(60, 10, 'done', win)).toEqual({ left: 60, width: 0.4, kind: 'done' });
  });
});

describe('taskSpan', () => {
  it('covers done, current, blocked and missing timestamps', () => {
    expect(taskSpan({ status: 'done', startedAt: '2026-10-11T10:00:00Z', doneAt: '2026-10-11T11:00:00Z' }, NOW))
      .toEqual({ start: NOW - 2 * H, end: NOW - H, kind: 'done' });
    expect(taskSpan({ status: 'in_progress', startedAt: '2026-10-11T11:00:00Z' }, NOW)).toEqual({ start: NOW - H, end: NOW, kind: 'current' });
    expect(taskSpan({ status: 'blocked', claimedAt: '2026-10-11T11:00:00Z' }, NOW)?.kind).toBe('blocked');
    expect(taskSpan({ status: 'done' }, NOW)).toBeNull();
    expect(taskSpan({ status: 'free' }, NOW)).toBeNull();
  });
});

describe('layoutRows', () => {
  const s: States = {
    T001: { status: 'done', startedAt: '2026-10-11T08:00:00Z', doneAt: '2026-10-11T09:00:00Z' },
    T002: { status: 'in_progress', startedAt: '2026-10-11T11:00:00Z' },
  };
  const win = windowFor('1d', NOW);

  it('renders one row per phase with counters when collapsed', () => {
    const rows = layoutRows(plan, s, NOW, win, new Set());
    expect(rows.map(r => [r.id, r.counter])).toEqual([['F1', '1/3'], ['F2', '0/3']]);
    expect(rows[0].bars.map(b => b.kind)).toEqual(['current', 'estimate']);
    expect(rows[1].bars.map(b => b.kind)).toEqual(['estimate']);
  });

  it('expands a phase into task rows with per-track sequential estimates', () => {
    const rows = layoutRows(plan, s, NOW, win, new Set(['F1']));
    expect(rows.map(r => r.id)).toEqual(['F1', 'T001', 'T002', 'T003', 'F2']);
    const t1 = rows[1];
    expect(t1).toMatchObject({ kind: 'task', trackId: 'backend', durationMin: 60 });
    expect(t1.bars[0].kind).toBe('done');
    const t3 = rows[3];
    expect(t3.bars[0]).toMatchObject({ kind: 'estimate', left: 75 }); // ui track starts its estimates at now
  });

  it('never yields negative or overflowing geometry', () => {
    const weird: States = { T001: { status: 'done', startedAt: '2030-01-01T00:00:00Z', doneAt: '2020-01-01T00:00:00Z' } };
    for (const r of layoutRows(plan, weird, NOW, win, new Set(['F1', 'F2']))) {
      for (const b of r.bars) {
        expect(b.left).toBeGreaterThanOrEqual(0);
        expect(b.width).toBeGreaterThan(0);
        expect(b.left + b.width).toBeLessThanOrEqual(100.4);
      }
    }
  });
});

describe('layoutRows groupBy track', () => {
  const states: States = {
    T001: { status: 'done', startedAt: new Date(NOW - 5 * H).toISOString(), doneAt: new Date(NOW - 4 * H).toISOString() },
  };
  const win = windowFor('1d', NOW);
  it('keeps phase grouping without opts', () => {
    expect(layoutRows(plan, states, NOW, win, new Set()).map(r => r.id)).toEqual(['F1', 'F2']);
  });
  it('groups by track with done/total counters and phase-ordered tasks', () => {
    const rows = layoutRows(plan, states, NOW, win, new Set(['backend']), { groupBy: 'track' });
    expect(rows.map(r => r.id)).toEqual(['backend', 'T001', 'T002', 'T004', 'T006', 'ui']);
    expect(rows[0]).toMatchObject({ kind: 'phase', label: 'Backend', counter: '1/4' });
    expect(rows[5]).toMatchObject({ kind: 'phase', label: 'Interfaz', counter: '0/2' });
    expect(rows[1]).toMatchObject({ kind: 'task', trackId: 'backend' });
    expect(rows[0].bars.some(b => b.kind === 'done')).toBe(true);
  });
});

describe('continuous zoom and pan', () => {
  it('builds windows from a span and a pan, clamped', () => {
    expect(windowAt(24 * H, NOW)).toEqual({ from: NOW - 18 * H, to: NOW + 6 * H });
    expect(windowAt(24 * H, NOW, -24 * H)).toEqual(windowFor('1d', NOW, -1));
    expect(windowAt(1, NOW).to - windowAt(1, NOW).from).toBe(MIN_SPAN);
    expect(windowAt(Infinity, NOW).to - windowAt(Infinity, NOW).from).toBe(24 * H);
  });
  it('zooms around the pointer, keeping the instant under it in place', () => {
    const win = windowAt(24 * H, NOW);
    const { span, pan } = zoomAround(win, 0.5, 0.25, NOW);
    const next = windowAt(span, NOW, pan);
    const pivot = win.from + 0.25 * (win.to - win.from);
    expect(next.from + 0.25 * (next.to - next.from)).toBeCloseTo(pivot, -1);
    expect(span).toBe(12 * H);
  });
  it('picks a tick step that keeps the axis readable', () => {
    expect(stepFor(windowAt(6 * H, NOW))).toBe(H);
    expect(stepFor(windowAt(24 * H, NOW))).toBe(3 * H);
    expect(stepFor(windowAt(30 * 24 * H, NOW))).toBe(168 * H);
    const t = autoTicks(windowAt(9 * 24 * H, NOW), 10, -120);
    expect(t.length).toBeGreaterThan(0);
    expect(t.every(x => (x + 120 * 60000) % (24 * H) === 0)).toBe(true);
  });
  it('covers the whole plan with a margin', () => {
    const s: States = { T001: { status: 'done', startedAt: '2026-10-10T08:00:00Z', doneAt: '2026-10-10T09:00:00Z' } };
    const r = planRange(plan, s, NOW);
    expect(r.from).toBeLessThan(Date.parse('2026-10-10T08:00:00Z'));
    expect(r.to).toBeGreaterThan(NOW);
  });
});

describe('phaseName and phaseLabel (G-21)', () => {
  it('drop a leading copy of the id, case apart, with its separators', () => {
    expect(phaseName('H0', 'H0 · Base')).toBe('Base');
    expect(phaseName('p1', 'P1: Setup')).toBe('Setup');
    expect(phaseName('F2', 'f2 — Pago')).toBe('Pago');
    expect(phaseName('H1', 'H10 x')).toBe('H10 x');
    expect(phaseName('F1', 'Base')).toBe('Base');
    expect(phaseLabel('H0', 'H0 · Base')).toBe('H0 · Base');
    expect(phaseLabel('H0', 'H0')).toBe('H0');
  });
  it('the timeline groups by phase with that label', () => {
    const p = { ...plan, phases: plan.phases.map(x => ({ ...x, name: `${x.id} · ${x.name}` })) };
    expect(layoutRows(p, {}, NOW, windowFor('1d', NOW), new Set()).filter(r => r.kind === 'phase').map(r => r.label)).toEqual(['F1 · Base', 'F2 · Checkout']);
  });
});
