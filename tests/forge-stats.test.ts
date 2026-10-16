import { describe, it, expect } from 'vitest';
import { briefStats, computeStats, estimateOf, quantiles, renderStats, type PlanStates } from '../src/forge/stats.js';
import type { LedgerEvent } from '../src/forge/ledger.js';
import type { PlanTask } from '../src/lib/types.js';

const MIN = 60000;
const T = (min: number) => new Date(Date.UTC(2026, 9, 15, 10, 0, 0) + min * MIN).toISOString();
const ev = (min: number, kind: string, extra: Record<string, unknown>) => ({ ts: T(min), kind, ...extra }) as LedgerEvent;
const res = (cached: boolean) => [{ validator: 'test', ok: true, flaky: false, durationMs: 1, cached, failing: [], failingKnown: true }];

// A-1 accepted at its first review; A-2 after a fix round; B-1 never accepted; C-1 written by forge 0.16 (no clocks, no
// phases but implement, no triage).
const EVENTS: LedgerEvent[] = [
  ev(0, 'triage', { task: 'A', path: 'medium' }),
  ev(1, 'validate', { task: 'A-1', baseline: true, ok: true, scope: 'heavy', durationMs: 60000, cached: false, results: res(false) }),
  ev(1, 'phase', { task: 'A', phase: 'implement', brief: 1, base: 'x' }),
  ev(6, 'validate', { task: 'A-1', ok: true, scope: 'affected', durationMs: 30000, cached: false, results: res(false) }),
  ev(8, 'phase', { task: 'A', phase: 'validate', brief: 1, round: 1 }),
  ev(9.5, 'validate', { task: 'A-1', ok: true, scope: 'heavy', durationMs: 90000, cached: false, results: res(false) }),
  ev(9.5, 'phase', { task: 'A', phase: 'review', brief: 1, round: 1, reviewers: [] }),
  ev(14, 'phase', { task: 'A', phase: 'verdict', brief: 1, round: 1 }),
  ev(14, 'verdict', { task: 'A-1', dir: 'r-1-1', action: 'accept', score: 0.9 }),
  ev(20, 'validate', { task: 'A-2', baseline: true, ok: true, scope: 'heavy', durationMs: 50, cached: true, results: res(true) }),
  ev(20, 'phase', { task: 'A', phase: 'implement', brief: 2, base: 'y' }),
  ev(25, 'phase', { task: 'A', phase: 'validate', brief: 2, round: 1 }),
  ev(26, 'validate', { task: 'A-2', ok: true, scope: 'heavy', durationMs: 60000, cached: false, results: res(false) }),
  ev(26, 'phase', { task: 'A', phase: 'review', brief: 2, round: 1 }),
  ev(30, 'phase', { task: 'A', phase: 'verdict', brief: 2, round: 1 }),
  ev(30, 'verdict', { task: 'A-2', dir: 'r-2-1', action: 'fix', score: 0.6 }),
  ev(30, 'phase', { task: 'A', phase: 'fix', brief: 2, round: 1 }),
  ev(34, 'phase', { task: 'A', phase: 'validate', brief: 2, round: 2 }),
  ev(35, 'validate', { task: 'A-2', ok: true, scope: 'heavy', durationMs: 60000, cached: false, results: res(false) }),
  ev(35, 'phase', { task: 'A', phase: 'review', brief: 2, round: 2 }),
  ev(38, 'phase', { task: 'A', phase: 'verdict', brief: 2, round: 2 }),
  ev(38, 'verdict', { task: 'A-2', dir: 'r-2-2', action: 'accept', score: 0.8 }),
  ev(40, 'phase', { task: 'B', phase: 'implement', brief: 1, base: 'z' }),
  ev(50, 'validate', { task: 'C-1', baseline: true, ok: true, results: [{ validator: 'test', ok: true, flaky: false }] }),
  ev(50, 'phase', { task: 'C', phase: 'implement', brief: 1, base: 'w' }),
  ev(55, 'validate', { task: 'C-1', ok: true, results: [{ validator: 'test', ok: true, flaky: false }] }),
  ev(60, 'verdict', { task: 'C-1', dir: 'c', action: 'accept', score: 1 }),
];

describe('FORGE stats (C-09)', () => {
  it('splits each accepted brief into its stages, with the baseline counted in validate and the implementer passes apart', () => {
    const b = briefStats(EVENTS);
    expect(b.map(x => x.task)).toEqual(['A-1', 'A-2', 'C-1']);
    expect(b[0]).toMatchObject({
      path: 'medium', startedAt: T(0), acceptedAt: T(14), totalMs: 14 * MIN,
      stages: { implement: 7 * MIN, validate: 2.5 * MIN, review: 4.5 * MIN, verdict: 0, fix: 0 },
      validators: { runs: 2, cached: 0, ms: 150000 }, implementValidateMs: 30000, reviews: 1, express: false,
    });
    expect(b[1]).toMatchObject({
      reviews: 2, totalMs: 18 * MIN + 50,
      stages: { implement: 5 * MIN, validate: 2 * MIN + 50, review: 7 * MIN, verdict: 0, fix: 4 * MIN },
      validators: { runs: 2, cached: 1, ms: 120050 },
    });
  });
  it('tolerates a ledger of forge 0.16: no clocks, only the implement phase, no triage', () => {
    expect(briefStats(EVENTS)[2]).toMatchObject({
      task: 'C-1', path: 'unknown', totalMs: 10 * MIN, stages: { implement: 10 * MIN, validate: 0, review: 0, verdict: 0, fix: 0 },
      validators: { runs: 2, cached: 0, ms: 0 }, reviews: 1,
    });
    expect(briefStats([ev(0, 'phase', { task: 'X', phase: 'implement', brief: '1' }), ev(5, 'verdict', { task: 'X-1', action: 'accept' })])).toEqual([]);
  });
  it('aggregates: first pass, reviews, the clock and the fixed cost of a brief accepted at once, validators and cache', () => {
    const s = computeStats({ events: EVENTS, plans: [], from: null });
    expect(s).toMatchObject({
      briefs: 3, firstPass: 0.67, reviewsMean: 1.33, briefMin: { p50: 10, p80: 14 }, overheadMin: { p50: 0, p80: 7 },
      validatorShare: 0.11, cacheHits: 0.14, estimate: null,
    });
    expect(s.byPath.medium).toMatchObject({ briefs: 2, briefMin: { p50: 14, p80: 14 }, stages: { implement: 6 * MIN, fix: 2 * MIN }, cacheHits: 0.2 });
    expect(s.byPath.unknown).toMatchObject({ briefs: 1 });
    expect(computeStats({ events: EVENTS, plans: [], from: Date.parse(T(19)) }).byBrief.map(b => b.task)).toEqual(['A-2', 'C-1']);
    expect(computeStats({ events: [], plans: [], from: null })).toMatchObject({ briefs: 0, firstPass: 0, briefMin: null, overheadMin: null, byPath: {} });
  });
  it('quantiles are nearest-rank, in minutes with one decimal', () => {
    expect(quantiles([])).toBeNull();
    expect(quantiles([3])).toEqual({ p50: 3, p80: 3 });
    expect(quantiles([5, 1, 4, 2, 3])).toEqual({ p50: 3, p80: 4 });
  });
  it('estimate: real over estimated minutes of the plan tasks that started and finished; null with fewer than 5', () => {
    const task = (id: string, estimate_min?: number) => ({ id, title: id, track: 't', phase: 'p', done_when: 'x', depends_on: [], zones: [], ...(estimate_min ? { estimate_min } : {}) }) as unknown as PlanTask;
    const state = { status: 'done', startedAt: T(0), doneAt: T(15) };
    const plan = (n: number): PlanStates => ({
      project: 'p', tasks: [...Array.from({ length: n }, (_, i) => task(`T${i}`, 60)), task('NOEST'), task('OPEN', 60)],
      states: { ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`T${i}`, state])), NOEST: state, OPEN: { status: 'in_progress', startedAt: T(0) } },
    });
    expect(estimateOf([plan(4)], null)).toBeNull();
    expect(estimateOf([plan(5)], null)).toEqual({ tasks: 5, ratio: 0.25 });
    expect(estimateOf([plan(5)], Date.parse(T(16)))).toBeNull();
  });
  it('renders a table per path in both languages', () => {
    const s = computeStats({ events: EVENTS, plans: [], from: null });
    for (const locale of ['es', 'en'] as const) {
      const text = renderStats(s, locale);
      expect(text).toContain('| medium | 2 | 14.0 | 6.0 | 2.3 | 5.8 | 0.0 | 2.0 |');
      expect(text).toContain('| unknown | 1 | 10.0 | 10.0 | 0.0 | 0.0 | 0.0 | 0.0 |');
    }
  });
});
