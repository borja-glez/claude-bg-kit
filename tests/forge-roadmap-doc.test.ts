import { describe, it, expect } from 'vitest';
import { buildRoadmapData, type DocInput } from '../src/forge/roadmap-doc.js';
import { parseVerifyFile } from '../src/forge/verdict.js';
import { deriveStatuses, statusKey, type StatusMap } from '../src/lib/forge-status.js';
import { parseForgeDocV2, STAGE_KEYS } from '../src/lib/roadmap-doc.js';
import type { ExecTask, ExecutionState } from '../src/lib/execution-state.js';
import type { LedgerEvent } from '../src/forge/ledger.js';
import { MEDIUM_T1, ROADMAP_AT } from './fixtures/roadmap-ledger.js';

const NOW = new Date(ROADMAP_AT(60));
const statusOf = (events: readonly LedgerEvent[], task = 'T1', project: string | null = 'shop') =>
  events.reduce<StatusMap>((m, e) => deriveStatuses(m, e).map, {})[statusKey(task, project)!] ?? null;
const input = (events: readonly LedgerEvent[], over: Partial<DocInput> = {}): DocInput => ({
  task: 'T1', status: statusOf(events), events, execution: null, execTask: null, publicTask: null, reviews: [], verifies: [], deferred: null,
  integration: null, assets: [], evidenceMode: 'upload', now: NOW, ...over,
});
const at = ROADMAP_AT(0);
const exec = (tasks: Record<string, ExecTask>, startedAt = at): ExecutionState => ({
  runId: 'shop-r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false, coordinator: 'main',
  hookSession: 'h1', active: true, stopReason: null, stallReason: null, startedAt, lastStepAt: null, lastBlockStep: null, sleepUntil: null, tasks, closedAt: null, closedBy: null,
});
const task = (over: Partial<ExecTask> = {}): ExecTask => ({
  status: 'running', stage: 'review', round: 1, worktree: '/w', branch: 'task/T1', executor: 'subagents', attempts: 0, agent: 'forge-review-correctness',
  startedAt: at, stageSince: at, updatedAt: at, detail: null, ...over,
});

describe('buildRoadmapData: the forge block v2 (G-02, G-05, K4-05)', () => {
  it('a Medium with a fix and an accept gives its rounds, findings, reviewers, validators, verification, stages, deferred and accepted round', () => {
    const { forge, evidence, exec: e } = buildRoadmapData(input(MEDIUM_T1));
    expect(forge).toMatchObject({ v: 2, path: 'medium', brief: 1, stage: 'done', phase: 'done', round: 2, cap: 4, acceptedRound: 2, overCap: false, updatedAt: NOW.toISOString(),
      verdict: { action: 'accept', score: 0.9 }, integration: null });
    expect(forge.rounds).toEqual([
      { brief: 1, n: 1, action: 'fix', note: 'round 1: resume the implementer', findings: { critical: 1, important: 2, minor: 0, deferred: 0 }, reviewers: ['correctness', 'security'], at: ROADMAP_AT(20) },
      { brief: 1, n: 2, action: 'accept', note: 'accepted', findings: { critical: 0, important: 1, minor: 3, deferred: 2 }, reviewers: ['correctness'], at: ROADMAP_AT(40) },
    ]);
    expect(forge.validators).toEqual([
      { name: 'test', ok: false, ms: 1000, failing: 2 },
      { name: 'lint', ok: true, flaky: true, ms: 200, cached: true },
      { name: 'e2e', ok: true, skipped: 'not-affected', ms: 0 },
    ]);
    expect(forge.verify).toEqual({ planned: true, result: null, passed: null, total: null, skipped: 'docs only', surfaces: ['web'] });
    expect(forge.deferred).toEqual([{ file: 'src/cart.ts', line: 12, problem: 'a slow loop over the items' }, { problem: 'no index on orders' }]);
    expect(forge.stages.implement).toBeGreaterThan(0);
    expect(Object.keys(forge.stages).every(k => STAGE_KEYS.includes(k))).toBe(true);
    expect(evidence).toBeNull();
    expect(e).toBeNull();
    expect(parseForgeDocV2(forge)).toEqual(forge);
  });
  it('a later baseline, an integration baseline or an --affected pass does not change the validators; failing comes from the event, not from a cache', () => {
    const later: LedgerEvent[] = [
      { ts: ROADMAP_AT(50), kind: 'validate', task: 'T1-1', project: 'shop', baseline: true, ok: true, scope: 'heavy', durationMs: 1, cached: true, results: [{ validator: 'x', ok: true }] },
      { ts: ROADMAP_AT(51), kind: 'validate', task: 'T1', project: 'shop', baseline: true, integrate: 'baseline', ok: true, scope: 'heavy', durationMs: 1, cached: true, results: [{ validator: 'y', ok: true }] },
      { ts: ROADMAP_AT(52), kind: 'validate', task: 'T1-1', project: 'shop', ok: true, scope: 'affected', durationMs: 1, cached: false, results: [{ validator: 'z', ok: true }] },
    ];
    expect(buildRoadmapData(input([...MEDIUM_T1, ...later])).forge.validators.map(v => v.name)).toEqual(['test', 'lint', 'e2e']);
  });
  it('round and cap are the reviews of the verdict, never the counter of the round event; a ledger without reviews leaves them out (G-05)', () => {
    const one: LedgerEvent[] = [
      ...MEDIUM_T1.slice(0, 6),
      { ts: ROADMAP_AT(20), kind: 'verdict', task: 'T1-1', project: 'shop', dir: '.forge/work/shop/T1/reviews-1-1', action: 'accept', score: 0.9, signature: 's', critical: 0, important: 0, minor: 0, deferred: 0, reviews: { n: 1, max: 4 } },
      { ts: ROADMAP_AT(20), kind: 'round', task: 'T1-1', project: 'shop', round: 0, cap: 3, next: 'done', reason: 'accepted' },
      { ts: ROADMAP_AT(21), kind: 'phase', task: 'T1', project: 'shop', phase: 'done' },
    ];
    expect(buildRoadmapData(input(one)).forge).toMatchObject({ brief: 1, round: 1, cap: 4, stage: 'done', acceptedRound: 1 });
    const old = one.map(e => { const { reviews: _r, ...rest } = e; return rest as LedgerEvent; });
    const f = buildRoadmapData(input(old, { status: { ...statusOf(old)!, reviews: null } })).forge;
    expect(f).not.toHaveProperty('round');
    expect(f).not.toHaveProperty('cap');
  });
  it('a brief opened again (a redo of a forge before 1b) gives brief 2 and keeps the rounds of brief 1', () => {
    const redo: LedgerEvent[] = [...MEDIUM_T1.slice(0, 8), { ts: ROADMAP_AT(25), kind: 'phase', task: 'T1', project: 'shop', phase: 'implement', brief: 2, base: 'abc1234' }];
    const f = buildRoadmapData(input(redo)).forge;
    expect(f.brief).toBe(2);
    expect(f.rounds.map(r => r.brief)).toEqual([1]);
  });
  it('the rounds of the brief in progress past the cap mark overCap', () => {
    const over: LedgerEvent[] = [...MEDIUM_T1.slice(0, 1), ...[1, 2, 3, 4, 5].flatMap(n => [
      { ts: ROADMAP_AT(10 + n), kind: 'verdict', task: 'T1-1', project: 'shop', dir: `.forge/work/shop/T1/reviews-1-${n}`, action: 'fix', score: 0.4, signature: `s${n}`, critical: 1, important: 0, minor: 0, deferred: 0, reviews: { n, max: 4 } },
    ] as LedgerEvent[])];
    expect(buildRoadmapData(input(over)).forge).toMatchObject({ round: 5, cap: 4, overCap: true, acceptedRound: null });
  });
  it('in an execution: the stage of the task, stopped and blocked from its status, done once integrated; exec from its public file, deleted when it leaves', () => {
    const e = exec({ T1: task() });
    const publicTask = { task: 'T1', runId: 'shop-r1', stage: 'review' as const, status: 'running' as const, agent: 'forge-review-correctness', round: 1, since: at, updatedAt: at, leaseUntil: ROADMAP_AT(90), by: 'main', mode: 'subagents' as const };
    const running = buildRoadmapData(input(MEDIUM_T1.slice(0, 6), { execution: e, execTask: e.tasks.T1, publicTask }));
    expect(running.forge).toMatchObject({ stage: 'review', phase: 'review', agent: 'forge-review-correctness' });
    expect(running.exec).toEqual({ runId: 'shop-r1', mode: 'subagents', by: 'main', agent: 'forge-review-correctness', stage: 'review', round: 1, since: at, leaseUntil: ROADMAP_AT(90) });
    for (const [status, stage] of [['stopped', 'stopped'], ['blocked', 'blocked'], ['integrated', 'done']] as const) {
      const r = buildRoadmapData(input(MEDIUM_T1.slice(0, 6), { execution: e, execTask: task({ status }), publicTask }));
      expect(r.forge.stage, status).toBe(stage);
      expect(r.exec, status).toEqual({ __delete__: true });
    }
    // A member's public file is fresher than execution.json: its stage and status win.
    const member = { ...publicTask, mode: 'sessions' as const, by: 'ui', stage: 'verify' as const, status: 'blocked' as const };
    const m = buildRoadmapData(input(MEDIUM_T1.slice(0, 6), { execution: e, execTask: task({ executor: 'sessions' }), publicTask: member }));
    expect(m.forge.stage).toBe('blocked');
    expect(m.exec).toEqual({ __delete__: true });
  });
  it('a task with nothing in the ledger yet, in an execution, still gives a valid block (Large by default)', () => {
    const e = exec({ T9: task({ stage: 'brief', agent: null }) });
    const f = buildRoadmapData(input([], { task: 'T9', status: null, execution: e, execTask: e.tasks.T9 })).forge;
    expect(f).toMatchObject({ path: 'large', brief: 1, stage: 'brief', rounds: [], validators: [], verify: null });
    expect(parseForgeDocV2(f)).toEqual(f);
  });
  it('C1: a task the execution holds counts only the events since the execution started; an earlier run is not published as this one', () => {
    // Run A: the whole of MEDIUM_T1 (two rounds, an accept, deferred findings). Run B starts T1 later, in the same work folder.
    const startB = ROADMAP_AT(50);
    const runB: LedgerEvent[] = [
      { ts: ROADMAP_AT(51), kind: 'phase', task: 'T1', project: 'shop', phase: 'implement', brief: 1, base: 'fff9999' },
    ];
    const events = [...MEDIUM_T1, ...runB];
    const e = exec({ T1: task({ stage: 'implement', agent: null, startedAt: startB }) }, startB);
    const held = buildRoadmapData(input(events, { execution: e, execTask: e.tasks.T1 })).forge;
    expect(held).toMatchObject({ rounds: [], deferred: [], validators: [], acceptedRound: null, overCap: false, verify: null, stage: 'implement' });
    expect(held).not.toHaveProperty('verdict');
    expect(held).not.toHaveProperty('round');
    expect(held).not.toHaveProperty('cap');
    // Without a holding execution, every event of the task counts.
    const all = buildRoadmapData(input(events)).forge;
    expect(all.rounds).toHaveLength(2);
    expect(all.acceptedRound).toBe(2);
  });
});

describe('buildRoadmapData: the evidence v2 (K2-14)', () => {
  const evidenceDir = '/repo/.forge/work/shop/T1/evidence/1-2';
  const round = (checks: object[], extra: object = {}) => ({
    brief: 1, n: 2, local: '.forge/work/shop/T1/evidence/1-2', shotPath: (s: string) => `${evidenceDir}/${s}`,
    file: parseVerifyFile(JSON.stringify({ surfaces: ['web'], result: 'fail', checks, unchecked: [], ...extra }))!,
  });
  const check = (id: number, name: string, ok: boolean, shot: string | null) => ({ id, surface: 'web', name, main: id === 1, ok, expected: `e${id}`, observed: `o${id}`, shot });
  it('a blocked verification keeps its reason, its unchecked checks and every check, with or without a screenshot', () => {
    const v = round([check(1, 'home', true, '01-home.png'), check(2, 'cart', false, '02-cart.png'), check(3, 'logs', true, null)],
      { result: 'blocked', reason: 'the server did not start', unchecked: ['checkout', 'refund'] });
    const assets = [{ path: `${evidenceDir}/01-home.png`, id: 'a1', url: 'https://claude.ai/_blob/a1' }, { path: `${evidenceDir}/02-cart.png`, id: 'a2', url: 'https://claude.ai/_blob/a2' }];
    const ev = buildRoadmapData(input(MEDIUM_T1, { verifies: [v], assets })).evidence!;
    expect(ev).toEqual({
      v: 2, surfaces: ['web'], result: 'blocked', passed: 2, total: 3, reason: 'the server did not start', unchecked: ['checkout', 'refund'], local: '.forge/work/shop/T1/evidence/1-2',
      shots: [
        { surface: 'web', check: 'home', ok: true, expected: 'e1', observed: 'o1', round: 2, url: 'https://claude.ai/_blob/a1', id: 'a1' },
        { surface: 'web', check: 'cart', ok: false, expected: 'e2', observed: 'o2', round: 2, url: 'https://claude.ai/_blob/a2', id: 'a2' },
        { surface: 'web', check: 'logs', ok: true, expected: 'e3', observed: 'o3', round: 2 },
      ],
    });
  });
  it('a screenshot of the last round not uploaded yet is pending with evidence: upload, never with evidence: local', () => {
    const v = round([check(1, 'home', true, '01-home.png')]);
    expect(buildRoadmapData(input(MEDIUM_T1, { verifies: [v] })).evidence).toMatchObject({ pending: true });
    expect(buildRoadmapData(input(MEDIUM_T1, { verifies: [v], evidenceMode: 'local' })).evidence).not.toHaveProperty('pending');
  });
  it('only the verifications of the brief in progress, at most 30 checks, the newest', () => {
    const many = Array.from({ length: 20 }, (_, i) => check(i + 1, `c${i + 1}`, true, null));
    const r1 = { ...round(many), n: 1 };
    const r2 = round(many);
    const old = { ...round([check(1, 'gone', true, null)]), brief: 0 };
    const ev = buildRoadmapData(input(MEDIUM_T1, { verifies: [old, r1, r2] })).evidence!;
    expect(ev.shots).toHaveLength(30);
    expect(ev.shots.at(-1)).toMatchObject({ check: 'c20', round: 2 });
    expect(ev.shots.some(s => s.check === 'gone')).toBe(false);
  });
});
