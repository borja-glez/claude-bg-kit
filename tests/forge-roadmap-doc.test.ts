import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { buildRoadmapData, type DocInput } from '../src/forge/roadmap-doc.js';
import { parseVerifyFile } from '../src/forge/verdict.js';
import { appendEvent, type LedgerEvent } from '../src/forge/ledger.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { deriveStatuses, statusKey, type StatusMap } from '../src/lib/forge-status.js';
import { fitForgeDoc, parseForgeDocV2, STAGE_KEYS, type ForgeDocV2 } from '../src/lib/roadmap-doc.js';
import type { ExecTask, ExecutionState } from '../src/lib/execution-state.js';
import { MEDIUM_T1, ROADMAP_AT, writeVerify } from './fixtures/roadmap-ledger.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

const NOW = new Date(ROADMAP_AT(60));
const statusOf = (events: readonly LedgerEvent[], task = 'T1', project: string | null = 'shop') =>
  events.reduce<StatusMap>((m, e) => deriveStatuses(m, e).map, {})[statusKey(task, project)!] ?? null;
const input = (events: readonly LedgerEvent[], over: Partial<DocInput> = {}): DocInput => ({
  task: 'T1', status: statusOf(events), events, execution: null, execTask: null, publicTask: null, reviews: [], verifies: [], blocking: [], deferred: null,
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
      { brief: 1, n: 1, action: 'fix', note: 'round 1: resume the implementer', findings: { critical: 1, important: 2, minor: 0, deferred: 0 }, reviewers: ['correctness', 'security'], at: ROADMAP_AT(20),
        next: 'resume', score: 0.4 },
      { brief: 1, n: 2, action: 'accept', note: 'accepted', findings: { critical: 0, important: 1, minor: 3, deferred: 2 }, reviewers: ['correctness'], at: ROADMAP_AT(40),
        next: 'done', score: 0.9 },
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
    expect(f).not.toHaveProperty('trail');
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
    // The trail is this run's way too: the earlier run's triage, reviews and done are not.
    expect(held.trail).toEqual([{ s: 'implement', at: ROADMAP_AT(51), b: 1 }]);
    // Without a holding execution, every event of the task counts.
    const all = buildRoadmapData(input(events)).forge;
    expect(all.rounds).toHaveLength(2);
    expect(all.acceptedRound).toBe(2);
  });
  it('C1: deferred.json, review dirs and verifications of an earlier run do not reach the block of the run that restarted the task', () => {
    const startB = ROADMAP_AT(50);
    const runB: LedgerEvent[] = [{ ts: ROADMAP_AT(51), kind: 'phase', task: 'T1', project: 'shop', phase: 'implement', brief: 1, base: 'fff9999' }];
    const e = exec({ T1: task({ stage: 'implement', agent: null, startedAt: startB }) }, startB);
    const file = parseVerifyFile(JSON.stringify({ surfaces: ['web'], result: 'pass', checks: [{ id: 1, surface: 'web', name: 'home', main: true, ok: true, expected: 'e', observed: 'o', shot: null }], unchecked: [] }))!;
    const verify = (atMin: number) => ({ brief: 1, n: 1, file, local: '.forge/x', shotPath: (s: string) => s, at: ROADMAP_AT(atMin) });
    const dirs = (atMin: number) => [{ brief: 1, n: 1, files: ['correctness.json', 'verify.json'], at: ROADMAP_AT(atMin) }];
    const base = { execution: e, execTask: e.tasks.T1 };
    const old = buildRoadmapData(input([...MEDIUM_T1, ...runB], { ...base, deferred: [{ problem: 'old one' }], deferredAt: ROADMAP_AT(40), verifies: [verify(40)], reviews: dirs(40) }));
    expect(old.forge.deferred).toEqual([]);
    expect(old.evidence).toBeNull();
    // An entry with its own timestamp is judged by it, whatever the file's mtime.
    const mixed = buildRoadmapData(input([...MEDIUM_T1, ...runB], { ...base, deferred: [{ problem: 'old', ts: ROADMAP_AT(10) }, { problem: 'new', ts: ROADMAP_AT(55) }], deferredAt: ROADMAP_AT(56) }));
    expect(mixed.forge.deferred).toEqual([{ problem: 'new' }]);
    // This run's own pieces are kept.
    const fresh = buildRoadmapData(input([...MEDIUM_T1, ...runB], { ...base, deferred: [{ problem: 'new one' }], deferredAt: ROADMAP_AT(55), verifies: [verify(55)] }));
    expect(fresh.forge.deferred).toEqual([{ problem: 'new one' }]);
    expect(fresh.evidence).not.toBeNull();
    // Without a holding execution the old pieces count.
    expect(buildRoadmapData(input(MEDIUM_T1, { deferred: [{ problem: 'old one' }], deferredAt: ROADMAP_AT(40), verifies: [verify(40)] })).forge.deferred).toEqual([{ problem: 'old one' }]);
  });
  it('C1: an execution that does not hold the task, or whose startedAt is not a date, filters nothing', () => {
    const other = exec({ T2: task() }, ROADMAP_AT(50));
    expect(buildRoadmapData(input(MEDIUM_T1, { execution: other, execTask: task() })).forge.rounds).toHaveLength(2);
    const bad = exec({ T1: task() }, 'soon');
    expect(buildRoadmapData(input(MEDIUM_T1, { execution: bad, execTask: bad.tasks.T1 })).forge.rounds).toHaveLength(2);
  });
  it('acceptedRound is the accept that closes the brief in progress, never that of an earlier brief', () => {
    const redo: LedgerEvent[] = [...MEDIUM_T1.slice(0, 11), { ts: ROADMAP_AT(41), kind: 'phase', task: 'T1', project: 'shop', phase: 'implement', brief: 2, base: 'abc1234' },
      { ts: ROADMAP_AT(42), kind: 'phase', task: 'T1', project: 'shop', phase: 'review', brief: 2, round: 1, reviewers: [] }];
    const f = buildRoadmapData(input(redo)).forge;
    expect(f.brief).toBe(2);
    expect(f.acceptedRound).toBeNull();
    // A later fix in the same brief leaves no accepted round either.
    const fixAfter: LedgerEvent[] = [...MEDIUM_T1.slice(0, 11), { ts: ROADMAP_AT(43), kind: 'verdict', task: 'T1-1', project: 'shop', dir: '.forge/work/shop/T1/reviews-1-3', action: 'fix', score: 0.3, signature: 's3', critical: 1, important: 0, minor: 0, deferred: 0, reviews: { n: 3, max: 4 } }];
    expect(buildRoadmapData(input(fixAfter)).forge.acceptedRound).toBeNull();
  });
});

describe('buildRoadmapData: why a round went back and the trail (v3, waypoint 0.39)', () => {
  const finding = (severity: string, problem: string, over: object = {}) => ({ severity, problem, ...over });
  /** review-close's findings-1-<n>.json of a fix, as roadmap-sources reads it. */
  const findingsFile = (n: number, findings: object[], validators: unknown[] = [], over: object = {}) =>
    ({ brief: 1, n, at: ROADMAP_AT(20), file: { task: 'T1-1', round: n, action: 'fix', findings, validators, ...over } });
  const RLO = String.fromCharCode(0x202e);

  it('next, impl and score of a round come from its verdict and the round event logged right after it', () => {
    const events = MEDIUM_T1.map(e => (e.kind === 'round' && e.next === 'resume' ? { ...e, implementer: { role: 'impl', agent: 'forge-impl' } } : e));
    const [r1, r2] = buildRoadmapData(input(events)).forge.rounds;
    expect(r1).toMatchObject({ next: 'resume', impl: 'forge-impl', score: 0.4, note: 'round 1: resume the implementer' });
    // An accept starts no attempt: roundDecision's implementer is null.
    expect(r2).toMatchObject({ next: 'done', score: 0.9 });
    expect(r2).not.toHaveProperty('impl');
  });
  it('an unknown next, an implementer without an agent, a null or out-of-range score are left out, never the round', () => {
    const odd = MEDIUM_T1.map(e => (e.kind === 'round' && e.next === 'resume' ? { ...e, next: 'later', implementer: { role: 'impl' } }
      : e.kind === 'round' ? { ...e, implementer: null }
        : e.kind === 'verdict' && e.action === 'fix' ? { ...e, score: null } : e.kind === 'verdict' ? { ...e, score: 1.5 } : e));
    const rounds = buildRoadmapData(input(odd)).forge.rounds;
    expect(rounds.map(r => r.action)).toEqual(['fix', 'accept']);
    for (const k of ['next', 'impl', 'score']) expect(rounds[0]).not.toHaveProperty(k);
    expect(rounds[1]).not.toHaveProperty('score');
    expect(rounds[1]).not.toHaveProperty('impl');
    // A long agent name is clipped as the page clips names.
    const long = MEDIUM_T1.map(e => (e.kind === 'round' && e.next === 'resume' ? { ...e, implementer: { role: 'impl', agent: `forge-${'x'.repeat(200)}` } } : e));
    expect(buildRoadmapData(input(long)).forge.rounds[0].impl).toHaveLength(80);
  });
  it('why and red of a review that did not accept: critical before important, the first three, one line each with where and who; the red validators by name, at most four', () => {
    const blocking = [findingsFile(1, [
      finding('important', 'the total skips the discount', { file: 'src/cart.ts', line: 40, reviewer: 'correctness', id: 'F2', origin: 'fix' }),
      finding('important', `two\nlines${RLO} and a ${'long '.repeat(40)}tail`, { reviewer: 'perf', line: 0 }),
      finding('critical', 'an order can be paid twice', { file: 'src/pay.ts', line: 7, reviewer: 'security' }),
      finding('minor', 'a minor one never blocks'),
      finding('important', '   '),
      finding('important', 'a fourth blocking one, past the cap'),
    ], [
      { validator: 'test', failures: ['2 failed'], failing: ['cart > adds'] }, { validator: 'lint', failures: [] }, 'e2e', { validator: 'test' },
      { validator: 'types' }, { validator: 'build' }, { failures: [] },
    ])];
    const [r1, r2] = buildRoadmapData(input(MEDIUM_T1, { blocking })).forge.rounds;
    expect(r1.why).toEqual([
      { sev: 'critical', problem: 'an order can be paid twice', file: 'src/pay.ts', line: 7, by: 'security' },
      { sev: 'important', problem: 'the total skips the discount', file: 'src/cart.ts', line: 40, by: 'correctness' },
      { sev: 'important', problem: `two lines and a ${'long '.repeat(40)}`.slice(0, 100).trimEnd(), by: 'perf' },
    ]);
    expect(r1.red).toEqual(['test', 'lint', 'e2e', 'types']);
    // The note stays forge's reason: an older page shows it, and the new one falls back to it.
    expect(r1.note).toBe('round 1: resume the implementer');
    expect(r2).not.toHaveProperty('why');
    expect(r2).not.toHaveProperty('red');
    const forge = buildRoadmapData(input(MEDIUM_T1, { blocking })).forge;
    expect(parseForgeDocV2(forge)).toEqual(forge);
  });
  it('no why nor red for an accept, from a file another close wrote, from a file that says nothing, nor from one older than the execution (C1)', () => {
    // An accept's close removes its file: one left for the round anyway is not read.
    const accepted = buildRoadmapData(input(MEDIUM_T1, { blocking: [findingsFile(2, [finding('critical', 'stale')], ['test'])] })).forge.rounds[1];
    expect(accepted).not.toHaveProperty('why');
    expect(accepted).not.toHaveProperty('red');
    // The file of a close whose action is not the round's (a verdict logged without review-close).
    const other = buildRoadmapData(input(MEDIUM_T1, { blocking: [findingsFile(1, [finding('critical', 'x')], ['test'], { action: 'redo' })] })).forge.rounds[0];
    expect(other).not.toHaveProperty('why');
    expect(other).not.toHaveProperty('red');
    for (const file of [null, [], 'text', { findings: 'x', validators: {} }]) {
      const r = buildRoadmapData(input(MEDIUM_T1, { blocking: [{ brief: 1, n: 1, file, at: ROADMAP_AT(20) }] })).forge.rounds[0];
      expect(r, JSON.stringify(file)).not.toHaveProperty('why');
      expect(r, JSON.stringify(file)).not.toHaveProperty('red');
    }
    // C1: a findings file from before the execution that holds the task is an earlier run's.
    const e = exec({ T1: task() }, ROADMAP_AT(0));
    const held = (atMin: number) => buildRoadmapData(input(MEDIUM_T1, { execution: e, execTask: e.tasks.T1,
      blocking: [{ ...findingsFile(1, [finding('critical', 'paid twice')], ['test']), at: ROADMAP_AT(atMin) }] })).forge.rounds[0];
    expect(held(-5)).not.toHaveProperty('why');
    expect(held(-5)).not.toHaveProperty('red');
    expect(held(20)).toMatchObject({ why: [{ sev: 'critical', problem: 'paid twice' }], red: ['test'] });
    // Without a holding execution it counts.
    const loose = buildRoadmapData(input(MEDIUM_T1, { blocking: [{ ...findingsFile(1, [finding('critical', 'paid twice')]), at: ROADMAP_AT(-5) }] })).forge.rounds[0];
    expect(loose.why).toHaveLength(1);
  });
  it('the trail: the triage first, then each phase lowercased with its brief and round, oldest first', () => {
    expect(buildRoadmapData(input(MEDIUM_T1)).forge.trail).toEqual([
      { s: 'triage', at: ROADMAP_AT(0) },
      { s: 'implement', at: ROADMAP_AT(1), b: 1 },
      { s: 'validate', at: ROADMAP_AT(10), b: 1, r: 1 },
      { s: 'review', at: ROADMAP_AT(12), b: 1, r: 1 },
      { s: 'review', at: ROADMAP_AT(30), b: 1, r: 2 },
      { s: 'done', at: ROADMAP_AT(45) },
    ]);
  });
  it('the trail drops unknown phases and bad numbers, collapses a step that repeats the one before it, and keeps the newest 16', () => {
    const p = (min: number, phase: string, over: object = {}): LedgerEvent => ({ ts: ROADMAP_AT(min), kind: 'phase', task: 'T1', project: 'shop', phase, ...over });
    const events: LedgerEvent[] = [
      { ts: ROADMAP_AT(0), kind: 'triage', task: 'T1', project: 'shop', path: 'medium', reasons: [], brief: 4 },
      p(1, 'Implement', { brief: 1 }), p(2, 'nap', { brief: 1 }), p(3, 'implement', { brief: 1 }),
      p(4, ' VALIDATE ', { brief: '1', round: 0 }), p(5, 'review', { brief: 1, round: 1 }), p(6, 'review', { brief: 1, round: 1 }),
      { ts: 'later', kind: 'phase', task: 'T1', project: 'shop', phase: 'verdict', brief: 1, round: 1 },
      p(7, 'fix', { brief: 1, round: 1, validators: true }), p(8, 'stopped'),
    ];
    expect(buildRoadmapData(input(events)).forge.trail).toEqual([
      { s: 'triage', at: ROADMAP_AT(0) },
      { s: 'implement', at: ROADMAP_AT(1), b: 1 },
      { s: 'validate', at: ROADMAP_AT(4) },
      { s: 'review', at: ROADMAP_AT(5), b: 1, r: 1 },
      { s: 'fix', at: ROADMAP_AT(7), b: 1, r: 1 },
      { s: 'stopped', at: ROADMAP_AT(8) },
    ]);
    // Ten rounds of review, verdict and fix: the newest 16 steps, so the triage and the first rounds go.
    const long: LedgerEvent[] = [events[0], p(1, 'implement', { brief: 1 }), ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap(n =>
      ['review', 'verdict', 'fix'].map((phase, k) => p(10 * n + k, phase, { brief: 1, round: n })))];
    const trail = buildRoadmapData(input(long)).forge.trail!;
    expect(trail).toHaveLength(16);
    expect(trail[0]).toEqual({ s: 'fix', at: ROADMAP_AT(52), b: 1, r: 5 });
    expect(trail.at(-1)).toEqual({ s: 'fix', at: ROADMAP_AT(102), b: 1, r: 10 });
    const forge = buildRoadmapData(input(long)).forge;
    expect(parseForgeDocV2(forge)).toEqual(forge);
  });
  it('a Large at its limit with v3 everywhere still fits in 4096 bytes: the v3 cuts go first and the rounds of its brief stay', () => {
    const W = '.forge/work/shop/T1';
    const events: LedgerEvent[] = [
      { ts: ROADMAP_AT(0), kind: 'triage', task: 'T1', project: 'shop', path: 'large', reasons: [] },
      { ts: ROADMAP_AT(1), kind: 'phase', task: 'T1', project: 'shop', phase: 'implement', brief: 1, base: 'abc1234' },
      { ts: ROADMAP_AT(2), kind: 'validate', task: 'T1-1', project: 'shop', ok: false, scope: 'heavy', durationMs: 1, cached: false,
        results: Array.from({ length: 10 }, (_, k) => ({ validator: `validator-${k}`, ok: k % 2 === 0, durationMs: 1234, cached: true, failing: ['a', 'b', 'c'], failingKnown: true })) },
      ...[1, 2, 3, 4, 5].flatMap((n): LedgerEvent[] => [
        { ts: ROADMAP_AT(10 * n), kind: 'phase', task: 'T1', project: 'shop', phase: 'review', brief: 1, round: n, reviewers: ['correctness', 'security', 'perf'] },
        { ts: ROADMAP_AT(10 * n + 1), kind: 'phase', task: 'T1', project: 'shop', phase: 'verdict', brief: 1, round: n },
        { ts: ROADMAP_AT(10 * n + 1), kind: 'verdict', task: 'T1-1', project: 'shop', dir: `${W}/reviews-1-${n}`, action: 'fix', score: 0.55, signature: `s${n}`,
          critical: 1, important: 3, minor: 0, deferred: 0, reviews: { n, max: 5 } },
        { ts: ROADMAP_AT(10 * n + 1), kind: 'round', task: 'T1-1', project: 'shop', round: n, cap: 4, next: 'fresh-stronger', reason: 'r'.repeat(120),
          implementer: { role: 'impl-strong', agent: 'forge-impl-strong' }, reviews: { n, max: 5 } },
        { ts: ROADMAP_AT(10 * n + 2), kind: 'phase', task: 'T1', project: 'shop', phase: 'fix', brief: 1, round: n },
      ]),
    ];
    const blocking = [1, 2, 3, 4, 5].map(n => findingsFile(n, [
      ...[1, 2, 3].map(k => finding('important', `${k}`.repeat(100), { file: `src/module-${n}/a-file-with-a-long-name-${k}.ts`, line: 1000 + k, reviewer: 'correctness' })),
      finding('critical', 'c'.repeat(160), { file: `src/module-${n}/core.ts`, line: 1, reviewer: 'security' }),
    ], ['validator-1', 'validator-3', 'validator-5', 'validator-7', 'validator-9']));
    const deferred = (n: number) => Array.from({ length: n }, (_, k) => ({ file: `src/module-${k}/file.ts`, line: 100 + k, problem: 'y'.repeat(160) }));
    // The same block as a forge before v3 built it: no trail, and rounds without what v3 adds.
    const preV3 = (d: ForgeDocV2): ForgeDocV2 => {
      const { trail: _t, ...rest } = d;
      return { ...rest, rounds: d.rounds.map(({ next: _n, impl: _i, score: _s, why: _w, red: _r, ...r }) => r) };
    };
    for (const n of [10, 5]) {
      const forge = buildRoadmapData(input(events, { blocking, deferred: deferred(n) })).forge;
      expect(forge.trail).toHaveLength(16);
      expect(forge.rounds).toHaveLength(5);
      expect(forge.rounds.every(r => r.why?.length === 3 && r.why[0].sev === 'critical' && r.red?.length === 4 && r.impl === 'forge-impl-strong')).toBe(true);
      const fit = fitForgeDoc(forge);
      expect(fit.fits, `${n} deferred`).toBe(true);
      expect(fit.bytes).toBeLessThanOrEqual(4096);
      // The v3 cuts first, then what the block without v3 needed (10 deferred of 160 were over 4 KB before v3 too).
      const before = fitForgeDoc(preV3(forge));
      expect(before.dropped, `${n} deferred`).toEqual(n === 10 ? ['deferred>5'] : []);
      // Every v3 field may go (rounds.next last of them), never before a cut the block of before did not need: once they
      // are all gone, what is left is that block, cut exactly as before.
      const v3 = fit.dropped.slice(0, fit.dropped.length - before.dropped.length);
      expect(v3.slice(0, 4), `${n} deferred`).toEqual(['trail>8', 'rounds.why>1', 'trail', 'rounds.why']);
      expect(v3.length === 4 || (v3.length === 5 && v3[4] === 'rounds.next'), `${n} deferred: ${v3.join(', ')}`).toBe(true);
      expect(fit.dropped.slice(v3.length), `${n} deferred`).toEqual(before.dropped);
      if (n === 10) expect(fit.doc).toEqual(before.doc);
      expect(fit.doc.deferred).toHaveLength(5);
      expect(fit.doc.rounds.map(r => [r.brief, r.n])).toEqual([[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]]);
      expect(fit.doc.rounds.every(r => r.note.length === 120)).toBe(true);
      if (v3.length === 4) expect(fit.doc.rounds.every(r => r.next === 'fresh-stronger' && r.impl === 'forge-impl-strong' && r.score === 0.55)).toBe(true);
      let drops = 0;
      expect(parseForgeDocV2(fit.doc, () => { drops++; })).toEqual(fit.doc);
      expect(drops).toBe(0);
    }
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
    const assets = [{ path: `${evidenceDir}/01-home.png`, id: 'a1', url: 'https://claude.ai/_blob/a1', runId: null, round: '1-2' }, { path: `${evidenceDir}/02-cart.png`, id: 'a2', url: 'https://claude.ai/_blob/a2', runId: null, round: '1-2' }];
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
  it('an upload is scoped to its run and round: an earlier run\'s upload of the same path never matches a new screenshot (final review M5)', () => {
    const v = round([check(1, 'home', true, '01-home.png')]);
    const upload = (runId: string | null, r = '1-2') => [{ path: `${evidenceDir}/01-home.png`, id: 'a1', url: 'https://claude.ai/_blob/a1', runId, round: r }];
    const e = exec({ T1: task() }, ROADMAP_AT(0));
    const held = { execution: e, execTask: e.tasks.T1, verifies: [{ ...v, at: ROADMAP_AT(30) }] };
    expect(buildRoadmapData(input(MEDIUM_T1, { ...held, assets: upload('shop-r0') })).evidence).toMatchObject({ pending: true, shots: [{ check: 'home' }] });
    expect(buildRoadmapData(input(MEDIUM_T1, { ...held, assets: upload('shop-r0') })).evidence!.shots[0]).not.toHaveProperty('url');
    expect(buildRoadmapData(input(MEDIUM_T1, { ...held, assets: upload('shop-r1') })).evidence!.shots[0]).toMatchObject({ url: 'https://claude.ai/_blob/a1', id: 'a1' });
    // Another round's upload, or one made outside the run, does not match either.
    expect(buildRoadmapData(input(MEDIUM_T1, { ...held, assets: upload('shop-r1', '1-1') })).evidence!.shots[0]).not.toHaveProperty('url');
    expect(buildRoadmapData(input(MEDIUM_T1, { ...held, assets: upload(null) })).evidence!.shots[0]).not.toHaveProperty('url');
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

describe('FORGE roadmap-doc (G-03, G-06)', () => {
  let root: string;
  let io: Io;
  const WORK = '.forge/work/shop/T1';
  const g = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  const cli = (...a: string[]) => run(a, io);
  const out = (r: { code: number; stdout: string; stderr: string }) => { if (r.code !== 0) throw new Error(r.stderr); return JSON.parse(r.stdout); };
  const data = () => JSON.parse(readFileSync(path.join(root, WORK, 'roadmap-doc.json'), 'utf8'));
  const initRepo = (): string => {
    root = tmp('forge-roadmap-doc-');
    g('init', '-q', '-b', 'main'); g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
    writeFileSync(path.join(root, '.gitignore'), '.forge/\n');
    g('add', '.'); g('commit', '-qm', 'init');
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
    return root;
  };
  beforeEach(() => {
    initRepo();
    io ={ cwd: root, now: () => NOW, env: {} };
    for (const e of MEDIUM_T1) appendEvent(root, e);
  });

  it('writes the data of update state/T to <WORK>/roadmap-doc.json and prints the write; outside a run the integration is HEAD on the default branch', () => {
    const r = out(cli('roadmap-doc', 'T1', '--project', 'shop'));
    const file = path.join(root, WORK, 'roadmap-doc.json');
    expect(r).toMatchObject({ task: 'T1', project: 'shop', file, write: { op: 'update', collection: 'state', doc_id: 'T1', file_path: file }, dropped: [] });
    expect(r.bytes).toBeLessThanOrEqual(4096);
    expect(data().forge).toMatchObject({ v: 2, path: 'medium', stage: 'done', round: 2, cap: 4, acceptedRound: 2,
      integration: { branch: 'main', sha: g('rev-parse', 'HEAD'), merged: true, target: 'main' } });
    expect(data()).not.toHaveProperty('exec');
    expect(data()).not.toHaveProperty('evidence');
    expect(out(cli('roadmap-doc', 'T1', '--project', 'shop', '--out', 'elsewhere.json')).file).toBe(path.join(root, 'elsewhere.json'));
  });
  it('--plan names the project, and a task the plan does not have is exit 2', () => {
    writeFileSync(path.join(root, 'plan.yaml'), 'project: shop\nlocale: en\nversion: "1"\ntracks:\n  - { id: a, name: A, color: blue }\nphases:\n  - { id: p1, name: P1 }\ntasks:\n  - { id: T1, title: T1, track: a, phase: p1, done_when: x }\n');
    expect(out(cli('roadmap-doc', 'T1', '--plan', 'plan.yaml')).project).toBe('shop');
    expect(cli('roadmap-doc', 'T7', '--plan', 'plan.yaml').code).toBe(2);
  });
  it('exit 2 for a task forge knows nothing of, an unsafe id, and --assets that cannot be read or is not a list', () => {
    expect(cli('roadmap-doc', 'T9', '--project', 'shop').code).toBe(2);
    expect(cli('roadmap-doc', '../x').code).toBe(2);
    expect(cli('roadmap-doc').code).toBe(2);
    expect(cli('roadmap-doc', 'T1', '--project', 'shop', '--assets', 'nope.json').code).toBe(2);
    writeFileSync(path.join(root, 'obj.json'), '{"path": "x"}');
    expect(cli('roadmap-doc', 'T1', '--project', 'shop', '--assets', 'obj.json').code).toBe(2);
  });
  it('--assets puts each upload on its check, ignores a hostile entry, is kept for the next generation, and evidence.local is relative (Review Focus 3)', () => {
    writeVerify(root, WORK, 1, 2, { surfaces: ['web'], result: 'fail', checks: [
      { id: 1, surface: 'web', name: 'home', main: true, ok: true, expected: 'the home page', observed: 'it loads', shot: '01-home.png' },
      { id: 2, surface: 'web', name: 'cart', main: false, ok: false, expected: '3 items', observed: '2 items', shot: '02-cart.png' },
    ] }, ['01-home.png', '02-cart.png']);
    const shot = (n: string) => `${WORK}/evidence/1-2/${n}`;
    writeFileSync(path.join(root, 'up.json'), JSON.stringify([
      { path: shot('01-home.png'), id: 'a1', url: 'https://claude.ai/_blob/a1' },
      { path: shot('02-cart.png'), id: 'a2', url: 'javascript:alert(1)' },
      { path: shot('02-cart.png'), id: '../a3', url: 'https://claude.ai/_blob/a3' },
      { id: 'a4', url: 'https://claude.ai/_blob/a4' },
    ]));
    out(cli('roadmap-doc', 'T1', '--project', 'shop', '--assets', 'up.json'));
    const ev = data().evidence;
    expect(ev).toMatchObject({ v: 2, result: 'fail', passed: 1, total: 2, local: `${WORK}/evidence/1-2`, pending: true });
    expect(ev.shots).toEqual([
      { surface: 'web', check: 'home', ok: true, expected: 'the home page', observed: 'it loads', round: 2, url: 'https://claude.ai/_blob/a1', id: 'a1' },
      { surface: 'web', check: 'cart', ok: false, expected: '3 items', observed: '2 items', round: 2 },
    ]);
    expect(path.isAbsolute(ev.local)).toBe(false);
    expect(ev.local).not.toContain('\\');
    // The upload is kept, with its run (none here) and its round: a later generation (a swarm task, say) still carries it.
    expect(JSON.parse(readFileSync(path.join(root, WORK, 'assets.json'), 'utf8'))).toEqual([
      { path: path.join(root, shot('01-home.png')), id: 'a1', url: 'https://claude.ai/_blob/a1', runId: null, round: '1-2' },
    ]);
    out(cli('roadmap-doc', 'T1', '--project', 'shop'));
    expect(data().evidence.shots[0]).toMatchObject({ url: 'https://claude.ai/_blob/a1', id: 'a1' });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\nevidence: local\n');
    out(cli('roadmap-doc', 'T1', '--project', 'shop'));
    expect(data().evidence).not.toHaveProperty('pending');
  });
  it('a ledger from before waves 1 to 3, with only the status alias: reviewers from the files, no round nor cap, validators without time (Review Focus 4)', () => {
    const old: LedgerEvent[] = [
      { ts: ROADMAP_AT(70), kind: 'triage', task: 'T2', project: 'shop', path: 'medium', reasons: [] },
      { ts: ROADMAP_AT(71), kind: 'phase', task: 'T2', phase: 'implement', brief: 1 },
      { ts: ROADMAP_AT(72), kind: 'validate', task: 'T2-1', ok: true, results: [{ validator: 'test', ok: true, flaky: false, failures: [] }] },
      { ts: ROADMAP_AT(73), kind: 'verdict', task: 'T2-1', dir: '.forge/work/shop/T2/reviews-1-1', action: 'accept', score: 0.9, signature: 's' },
      { ts: ROADMAP_AT(73), kind: 'round', task: 'T2-1', round: 0, cap: 3, next: 'done', reason: 'accepted' },
    ];
    for (const e of old) appendEvent(root, e);
    rmSync(path.join(root, '.forge', 'status'), { recursive: true, force: true });
    const dir = path.join(root, '.forge', 'work', 'shop', 'T2', 'reviews-1-1');
    mkdirSync(dir, { recursive: true });
    for (const f of ['security.json', 'correctness.json', 'review-plan.json']) writeFileSync(path.join(dir, f), '{}');
    const forge = JSON.parse(readFileSync(out(cli('roadmap-doc', 'T2', '--project', 'shop')).file, 'utf8')).forge;
    expect(forge).not.toHaveProperty('round');
    expect(forge).not.toHaveProperty('cap');
    expect(forge.rounds).toEqual([{ brief: 1, n: 1, action: 'accept', note: 'accepted', findings: { critical: 0, important: 0, minor: 0, deferred: 0 }, reviewers: ['correctness', 'security'], at: ROADMAP_AT(73),
      next: 'done', score: 0.9 }]);
    expect(forge.validators).toEqual([{ name: 'test', ok: true }]);
    expect(parseForgeDocV2(forge)).toEqual(forge);
  });
  it('shop T1, web T1 and a loose T1 in one ledger each produce only their own block, whatever the order of the triages', () => {
    const web = MEDIUM_T1.map(e => ({ ...e, project: 'web', ...(e.dir ? { dir: String(e.dir).replace('/shop/', '/web/') } : {}) }));
    const loose = [
      { ts: ROADMAP_AT(80), kind: 'triage', task: 'T1', path: 'small', reasons: [] },
      { ts: ROADMAP_AT(81), kind: 'phase', task: 'T1', phase: 'implement', brief: 1 },
    ] as LedgerEvent[];
    const forge = (...a: string[]) => JSON.parse(readFileSync(out(cli('roadmap-doc', 'T1', ...a)).file, 'utf8')).forge;
    const check = () => {
      expect(forge('--project', 'shop')).toMatchObject({ path: 'medium', rounds: [{ at: ROADMAP_AT(20) }, { at: ROADMAP_AT(40) }] });
      expect(forge('--project', 'web')).toMatchObject({ path: 'medium' });
      expect(forge('--project', 'web').rounds).toHaveLength(2);
    };
    // The loose task last: the last triage is its, so T1 without --project is the loose one.
    for (const e of web) appendEvent(root, e);
    for (const e of loose) appendEvent(root, e);
    check();
    const l = out(cli('roadmap-doc', 'T1'));
    expect(l.project).toBeNull();
    expect(l.file).toBe(path.join(root, '.forge', 'work', 'T1', 'roadmap-doc.json'));
    const lf = JSON.parse(readFileSync(l.file, 'utf8')).forge;
    expect(lf.path).toBe('small');
    expect(lf.rounds ?? []).toEqual([]);
    // The loose task first: the shop and web blocks are the same, and the loose events never reach them.
    rmSync(root, { recursive: true, force: true });
    root = initRepo();
    io = { cwd: root, now: () => NOW, env: {} };
    for (const e of loose) appendEvent(root, e);
    for (const e of MEDIUM_T1) appendEvent(root, e);
    for (const e of web) appendEvent(root, e);
    check();
    expect(out(cli('roadmap-doc', 'T1')).project).toBe('web');
  });
  it('a task past its review cap (r5/4) still publishes: exit 0, with round 5, cap 4 and overCap (final review I1)', () => {
    const over: LedgerEvent[] = [5, 6, 7].map(n => ({ ts: ROADMAP_AT(46 + n), kind: 'verdict', task: 'T1-1', project: 'shop', dir: `${WORK}/reviews-1-${n}`,
      action: 'fix', score: 0.4, signature: `o${n}`, critical: 1, important: 0, minor: 0, deferred: 0, reviews: { n: n - 2, max: 4 } }));
    for (const e of over) appendEvent(root, e);
    const r = cli('roadmap-doc', 'T1', '--project', 'shop');
    expect(r.code, r.stderr).toBe(0);
    expect(data().forge).toMatchObject({ round: 5, cap: 4, overCap: true });
    expect(parseForgeDocV2(data().forge)).toEqual(data().forge);
  });
  it('never reads the earlier-* folders prep sets aside', () => {
    const old = path.join(root, WORK, 'earlier-r0', 'reviews-1-9');
    mkdirSync(old, { recursive: true });
    for (const f of ['security.json', 'review-plan.json']) writeFileSync(path.join(old, f), '{}');
    out(cli('roadmap-doc', 'T1', '--project', 'shop'));
    expect(JSON.stringify(data())).not.toContain('reviews-1-9');
    expect(data().forge.rounds.some((r: { n: number }) => r.n === 9)).toBe(false);
  });
  it('v3: the findings file review-close left for a fix gives its round why and red; an accept\'s, an unreadable one or one set aside gives none', () => {
    const work = path.join(root, WORK);
    mkdirSync(path.join(work, 'earlier-r0'), { recursive: true });
    writeFileSync(path.join(work, 'findings-1-1.json'), JSON.stringify({ task: 'T1-1', round: 1, action: 'fix', findings: [
      { severity: 'important', problem: 'the total skips the discount', file: 'src/cart.ts', line: 40, reviewer: 'correctness', id: 'F2' },
      { severity: 'critical', problem: 'an order can be paid twice', file: 'src/pay.ts', line: 7, reviewer: 'security', id: 'F1' },
    ], validators: [{ validator: 'test', failures: ['2 failed'], failing: ['cart > adds'] }] }));
    writeFileSync(path.join(work, 'findings-1-2.json'), JSON.stringify({ task: 'T1-1', round: 2, action: 'accept', findings: [{ severity: 'critical', problem: 'stale' }], validators: [] }));
    writeFileSync(path.join(work, 'findings-1-3.json'), 'not json');
    writeFileSync(path.join(work, 'findings-index-1.json'), '{}');
    writeFileSync(path.join(work, 'earlier-r0', 'findings-1-2.json'), JSON.stringify({ action: 'fix', findings: [{ severity: 'critical', problem: 'an earlier run' }] }));
    const r = out(cli('roadmap-doc', 'T1', '--project', 'shop'));
    expect(r.dropped).toEqual([]);
    const forge = data().forge;
    expect(forge.rounds[0]).toMatchObject({ next: 'resume', score: 0.4, red: ['test'], why: [
      { sev: 'critical', problem: 'an order can be paid twice', file: 'src/pay.ts', line: 7, by: 'security' },
      { sev: 'important', problem: 'the total skips the discount', file: 'src/cart.ts', line: 40, by: 'correctness' },
    ] });
    expect(forge.rounds[1]).not.toHaveProperty('why');
    expect(forge.trail.map((t: { s: string }) => t.s)).toEqual(['triage', 'implement', 'validate', 'review', 'review', 'done']);
    expect(JSON.stringify(forge)).not.toContain('an earlier run');
    expect(parseForgeDocV2(forge)).toEqual(forge);
  });
  // A status file the CLI reads is normalized, so a damaged one cannot reach the parse: the fit is the seam (Io.roadmapFit).
  it('exit 3 when the block is over the cap or does not validate: nothing is written, not even the uploads (C7)', () => {
    const file = path.join(root, WORK, 'roadmap-doc.json');
    const assets = path.join(root, WORK, 'assets.json');
    writeFileSync(path.join(root, 'up.json'), JSON.stringify([{ path: `${WORK}/evidence/1-2/x.png`, id: 'a1', url: 'https://claude.ai/_blob/a1' }]));
    const args = ['roadmap-doc', 'T1', '--project', 'shop', '--assets', 'up.json'];
    io = { ...io, roadmapFit: d => ({ ...fitForgeDoc(d), fits: false, bytes: 5000 }) };
    const over = cli(...args);
    expect(over.code).toBe(3);
    expect(over.stdout).toBe('');
    expect(over.stderr).toContain('4096');
    io = { ...io, roadmapFit: d => ({ ...fitForgeDoc(d), doc: { ...fitForgeDoc(d).doc, brief: 0 } }) };
    expect(cli(...args).code).toBe(3);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(assets)).toBe(false);
    // Without the seam the same call works and keeps the upload.
    io = { cwd: root, now: () => NOW, env: {} };
    out(cli(...args));
    expect(existsSync(file)).toBe(true);
    expect(existsSync(assets)).toBe(true);
  });
  it('deferred.json is looked up where the review dirs are: here, the caller and the main checkout', () => {
    const wt = path.join(path.dirname(root), `${path.basename(root)}-wt`);
    const elsewhere = tmp('forge-roadmap-here-');
    try {
      g('worktree', 'add', '-q', '-b', 'wt', wt);
      mkdirSync(path.join(wt, WORK), { recursive: true });
      writeFileSync(path.join(wt, WORK, 'deferred.json'), JSON.stringify([{ severity: 'important', problem: 'found in the caller folder' }]));
      const r = run(['roadmap-doc', 'T1', '--project', 'shop'], { cwd: wt, workdir: elsewhere, now: () => NOW, env: {} });
      expect(r.code).toBe(0);
      expect(JSON.stringify(JSON.parse(readFileSync(JSON.parse(r.stdout).file, 'utf8')).forge.deferred)).toContain('found in the caller folder');
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
      try { g('worktree', 'remove', '--force', wt); } catch { rmSync(wt, { recursive: true, force: true }); }
    }
  });
  it('a review dir both the caller and the main checkout hold: the verify.json of the one that has it is read', () => {
    const wt = path.join(path.dirname(root), `${path.basename(root)}-wt2`);
    try {
      g('worktree', 'add', '-q', '-b', 'wt2', wt);
      // The caller's copy has the review files but no verify.json; the main checkout's has it.
      const dir = path.join(wt, WORK, 'reviews-1-2');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'correctness.json'), '{}');
      writeVerify(root, WORK, 1, 2, { surfaces: ['web'], result: 'pass', checks: [{ id: 1, surface: 'web', name: 'home', main: true, ok: true, expected: 'e', observed: 'o', shot: null }] });
      const r = run(['roadmap-doc', 'T1', '--project', 'shop'], { cwd: wt, now: () => NOW, env: {} });
      expect(r.code).toBe(0);
      const doc = JSON.parse(readFileSync(JSON.parse(r.stdout).file, 'utf8'));
      expect(doc.evidence).toMatchObject({ result: 'pass', total: 1 });
    } finally {
      try { g('worktree', 'remove', '--force', wt); } catch { rmSync(wt, { recursive: true, force: true }); }
    }
  });
});
