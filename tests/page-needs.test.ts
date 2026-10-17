import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePlan } from '../src/lib/plan.js';
import { buildDocs } from '../src/lib/sync.js';
import { DEFERRED_DAYS, needsOf, parseSeen, pruneSeen, seenKey } from '../src/page/needs.js';
import type { Model } from '../src/page/render.js';

const plan = parsePlan(readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-11T12:00:00Z');
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const done = (daysAgo: number, merged = false) => ({
  status: 'done' as const, doneAt: iso(NOW - daysAgo * DAY),
  forge: { v: 2 as const, path: 'medium' as const, phase: 'done', validators: [], brief: 1, stage: 'done' as const, rounds: [], verify: null, stages: {},
    integration: { branch: 'forge/run-x', sha: 'abc1234', merged, target: 'main' }, deferred: [{ problem: 'no index' }, { problem: 'n+1' }],
    acceptedRound: 1, overCap: false, updatedAt: iso(NOW - daysAgo * DAY) },
});
const model = (over: Partial<Model> = {}): Model => ({
  meta: buildDocs(plan, '2026-10-11T09:00:00Z').meta, plan, states: {}, sessions: {}, events: [], messages: [], notes: [], proposals: [],
  me: null, profiles: {}, readOnly: false, now: NOW, offline: false, connecting: false, ...over,
});

describe('needsOf (G-24)', () => {
  it('the deferred findings of recent, unmerged, done tasks, unless seen with the same doneAt', () => {
    const states = { T001: done(1), T002: done(DEFERRED_DAYS + 1), T003: done(2, true), T004: done(3) };
    expect(needsOf(model({ states }))).toEqual([{ kind: 'deferred', findings: 4, tasks: [{ id: 'T001', doneAt: states.T001.doneAt }, { id: 'T004', doneAt: states.T004.doneAt }] }]);
    expect(needsOf(model({ states, seenDeferred: { T001: states.T001.doneAt } }))).toEqual([{ kind: 'deferred', findings: 2, tasks: [{ id: 'T004', doneAt: states.T004.doneAt }] }]);
    // A mark of an older doneAt (the task was redone) does not hide the new findings.
    expect(needsOf(model({ states: { T001: done(1) }, seenDeferred: { T001: iso(NOW - 5 * DAY) } }))).toHaveLength(1);
  });
  it('the page is stale only when the plan was synced by a newer waypoint (G-13)', () => {
    const meta = (v?: string) => ({ ...buildDocs(plan, '2026-10-11T09:00:00Z').meta, waypointVersion: v });
    expect(needsOf(model({ meta: meta('0.29.0') }), '0.28.0')).toEqual([{ kind: 'stale-page', page: '0.28.0', plan: '0.29.0' }]);
    expect(needsOf(model({ meta: meta('0.28.0') }), '0.28.0')).toEqual([]);
    expect(needsOf(model({ meta: meta('0.27.3') }), '0.28.0')).toEqual([]);
    expect(needsOf(model({ meta: meta(undefined) }), '0.28.0')).toEqual([]);
  });
});

describe('the seen marks (G-24)', () => {
  it('parseSeen keeps task → date and nothing else (Review Focus 4)', () => {
    expect(parseSeen(null)).toEqual({});
    expect(parseSeen('{not json')).toEqual({});
    expect(parseSeen('[1, 2]')).toEqual({});
    expect(parseSeen('"T001"')).toEqual({});
    expect(parseSeen(JSON.stringify({ T001: '2026-10-10T10:00:00.000Z', 'bad/id': '2026-10-10T10:00:00.000Z', T002: 'soon', T003: 7 }))).toEqual({ T001: '2026-10-10T10:00:00.000Z' });
    expect(seenKey('demo-shop')).toBe('wp-seen-deferred:demo-shop');
  });
  it('pruneSeen drops the marks of a merged task, an old one, one redone since, and one the plan lost', () => {
    const states = { T001: done(1), T002: done(1, true), T003: done(DEFERRED_DAYS + 1), T004: done(2) };
    const seen = { T001: states.T001.doneAt, T002: states.T002.doneAt, T003: states.T003.doneAt, T004: iso(NOW - 6 * DAY), T099: iso(NOW - DAY) };
    expect(pruneSeen(seen, model({ states }))).toEqual({ T001: states.T001.doneAt });
  });
});
