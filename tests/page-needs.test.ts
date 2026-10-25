import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePlan } from '../src/lib/plan.js';
import { buildDocs } from '../src/lib/sync.js';
import { needsYou, RUN_HALTS } from '../src/lib/needs-you.js';
import { DEFERRED_DAYS, HALTS, needsOf, parseSeen, pruneSeen, seenKey } from '../src/page/needs.js';
import { proposalDigest, type ApprovalDoc } from '../src/lib/proposals.js';
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
  it('its questions, proposals and stopped run follow needsYou, the rule lens and the band share (w7 A5)', () => {
    const note = (id: string, o: object = {}) => ({ id, ts: iso(NOW - DAY), type: 'question' as const, author: 'user:a', text: id, ...o });
    const notes = [note('n1'), note('n2', { answer: 'sí' }), note('n3', { answeredByNote: 'e9' })];
    const prop = (id: string, status: string, o: object = {}) => ({ id, ts: iso(NOW - DAY), category: 'perf' as const, risk: 'low' as const, title: id, rationale: 'r', evidence: 'e', pillar: 'x', status, source: 'scout' as const, author: 'session:main', ...o });
    const proposals = [prop('p1', 'proposed'), prop('p2', 'discussing', { parked: { why: 'w', loses: 'l', at: iso(NOW) } }), prop('p3', 'approved')];
    const run = { runId: 'r1', mode: 'subagents' as const, parallel: 2, branch: 'b', mergeOnFinish: false, active: false, stopReason: 'stalled', coordinator: 'main', kind: 'plan' as const, loose: [], slots: [], startedAt: iso(NOW - 7_200_000), lastStepAt: iso(NOW - 3_600_000), stallReason: 'untrusted-commands' };
    const needs = needsOf(model({ notes, proposals: proposals as never, run }));
    expect(needs.map(n => n.kind)).toEqual(['question', 'proposals', 'stalled']);
    expect(needs[0]).toMatchObject({ note: { id: 'n1' } });
    expect(needs[1]).toEqual({ kind: 'proposals', count: 2 });
    expect(needs[2]).toEqual({ kind: 'stalled', runId: 'r1', reason: 'untrusted-commands', stop: 'stalled' });
    const shared = needsYou({ now: NOW, notes: Object.fromEntries(notes.map(n => [n.id, n])), proposals: Object.fromEntries(proposals.map(p => [p.id, p])), run: { runId: 'r1', active: false, stopReason: 'stalled', stallReason: 'untrusted-commands', startedAt: run.startedAt, lastStepAt: run.lastStepAt, closedAt: null, coordinatorOpen: null } });
    expect(shared.map(n => [n.kind, n.id])).toEqual([['question', 'n1'], ['proposal', 'p1'], ['proposal', 'p2'], ['untrusted-commands', 'r1']]);
    expect(HALTS).toBe(RUN_HALTS);
  });
  it('the decisions that changed after the mark go apart by whose mark it was: the owner’s, or forge’s policy (carry 4b-3)', () => {
    const prop = (id: string, title: string) => ({ id, ts: '', category: 'perf' as const, risk: 'low' as const, title, rationale: 'r', evidence: 'e', pillar: 'x', status: 'approved' as const, source: 'scout' as const, author: 'session:main' });
    const mark = (pid: string, by: ApprovalDoc['by']): ApprovalDoc => ({ status: 'approved', decidedAt: iso(NOW), by, digest: proposalDigest(pid, prop(pid, 'antes')) });
    const proposals = [prop('p1', 'después'), prop('p2', 'después'), prop('p3', 'después')];
    const approvals = { p1: mark('p1', 'page'), p2: mark('p2', 'forge:policy'), p3: mark('p3', 'forge:decide') };
    expect(needsOf(model({ isOwner: true, proposals, approvals }))).toEqual([{ kind: 'changed', count: 2, policy: false }, { kind: 'changed', count: 1, policy: true }]);
    expect(needsOf(model({ isOwner: true, proposals: [proposals[1]!], approvals }))).toEqual([{ kind: 'changed', count: 1, policy: true }]);
    expect(needsOf(model({ isOwner: false, proposals, approvals }))).toEqual([]);
  });
  it('the deferred findings of recent, unmerged, done tasks, unless seen with the same doneAt', () => {
    const states = { T001: done(1), T002: done(DEFERRED_DAYS + 1), T003: done(2, true), T004: done(3) };
    expect(needsOf(model({ states }))).toEqual([{ kind: 'deferred', findings: 4, tasks: [{ id: 'T001', doneAt: states.T001.doneAt }, { id: 'T004', doneAt: states.T004.doneAt }] }]);
    expect(needsOf(model({ states, seenDeferred: { T001: states.T001.doneAt } }))).toEqual([{ kind: 'deferred', findings: 2, tasks: [{ id: 'T004', doneAt: states.T004.doneAt }] }]);
    // A mark of an older doneAt (the task was redone) does not hide the new findings.
    expect(needsOf(model({ states: { T001: done(1) }, seenDeferred: { T001: iso(NOW - 5 * DAY) } }))).toHaveLength(1);
  });
  it('the deferred findings: exactly 7 days after doneAt they still show, a moment later not; a doneAt over a day ahead is junk (carry 7)', () => {
    const at = (ms: number) => ({ ...done(0), doneAt: iso(NOW + ms) });
    expect(needsOf(model({ states: { T001: at(-DEFERRED_DAYS * DAY) } }))).toHaveLength(1);
    expect(needsOf(model({ states: { T001: at(-DEFERRED_DAYS * DAY - 1) } }))).toHaveLength(0);
    // Up to a day ahead is clock skew; past that the date is not believed.
    expect(needsOf(model({ states: { T001: at(DAY / 2) } }))).toHaveLength(1);
    expect(needsOf(model({ states: { T001: at(DAY + 1) } }))).toHaveLength(0);
  });
  it('a run that stopped without being closed shows while less than 24 h passed since it last moved, whatever stopped it (carry 7)', () => {
    const H = 3_600_000;
    const run = (movedMsAgo: number, stopReason: string | null = 'stalled', over: object = {}) => ({
      runId: 'r1', mode: 'subagents' as const, parallel: 2, branch: 'forge/run-x', mergeOnFinish: false, active: false, stopReason, coordinator: 'main',
      kind: 'plan' as const, loose: [], slots: [], startedAt: iso(NOW - movedMsAgo - H), lastStepAt: iso(NOW - movedMsAgo), stallReason: 'T2 sigue bloqueada', ...over,
    });
    const kinds = (r: ReturnType<typeof run>) => needsOf(model({ run: r })).map(n => n.kind);
    expect(needsOf(model({ run: run(23 * H) }))).toEqual([{ kind: 'stalled', runId: 'r1', reason: 'T2 sigue bloqueada', stop: 'stalled' }]);
    // C33: the need says what stopped it, for the banner and «Te necesita» to name it.
    expect(needsOf(model({ run: run(H, 'stopped') }))).toMatchObject([{ kind: 'stalled', stop: 'stopped' }]);
    expect(needsOf(model({ run: run(H, 'budget') }))).toMatchObject([{ kind: 'stalled', stop: 'budget' }]);
    expect(kinds(run(24 * H - 1))).toEqual(['stalled']);
    // The TTL itself: deleting the check makes these show.
    expect(kinds(run(24 * H))).toEqual([]);
    expect(kinds(run(25 * H))).toEqual([]);
    expect(kinds(run(H, 'stopped'))).toEqual(['stalled']);
    expect(kinds(run(H, 'budget'))).toEqual(['stalled']);
    expect(kinds(run(H, null))).toEqual([]);
    expect(kinds(run(H, 'stalled', { closedAt: iso(NOW - 60000) }))).toEqual([]);
    expect(kinds(run(H, 'stalled', { active: true }))).toEqual([]);
    // Without lastStepAt, the start decides.
    expect(kinds(run(H, 'stalled', { lastStepAt: undefined, startedAt: iso(NOW - 25 * H) }))).toEqual([]);
    expect(kinds(run(H, 'stalled', { lastStepAt: undefined, startedAt: iso(NOW - 2 * H) }))).toEqual(['stalled']);
  });
  it('an infinite run without its coordinator shows by the same rule: less than 24 h after its lease ended (carry 7)', () => {
    const H = 3_600_000;
    const inf = (leaseMsAgo: number) => ({ active: true, cycle: 1, budget: {}, startedAt: iso(NOW - 2 * DAY), lastCycleAt: null,
      coordinator: { sid: 'main', claude: 'c1', seenAt: iso(NOW - leaseMsAgo - 60000), leaseUntil: iso(NOW - leaseMsAgo) } });
    const kinds = (i: ReturnType<typeof inf>) => needsOf(model({ infinite: i })).map(n => n.kind);
    expect(kinds(inf(23 * H))).toEqual(['infinite']);
    expect(kinds(inf(24 * H - 1))).toEqual(['infinite']);
    expect(kinds(inf(24 * H))).toEqual([]);
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
