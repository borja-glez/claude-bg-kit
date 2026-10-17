import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildRoadmapData, type DocInput } from '../src/forge/roadmap-doc.js';
import { parseVerifyFile } from '../src/forge/verdict.js';
import { appendEvent, type LedgerEvent } from '../src/forge/ledger.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { deriveStatuses, statusKey, type StatusMap } from '../src/lib/forge-status.js';
import { parseForgeDocV2, STAGE_KEYS } from '../src/lib/roadmap-doc.js';
import type { ExecTask, ExecutionState } from '../src/lib/execution-state.js';
import { MEDIUM_T1, ROADMAP_AT, writeVerify } from './fixtures/roadmap-ledger.js';

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

describe('FORGE roadmap-doc (G-03, G-06)', () => {
  let root: string;
  let io: Io;
  const WORK = '.forge/work/shop/T1';
  const g = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  const cli = (...a: string[]) => run(a, io);
  const out = (r: { code: number; stdout: string; stderr: string }) => { if (r.code !== 0) throw new Error(r.stderr); return JSON.parse(r.stdout); };
  const data = () => JSON.parse(readFileSync(path.join(root, WORK, 'roadmap-doc.json'), 'utf8'));
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'forge-roadmap-doc-'));
    g('init', '-q', '-b', 'main'); g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
    writeFileSync(path.join(root, '.gitignore'), '.forge/\n');
    g('add', '.'); g('commit', '-qm', 'init');
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
    io = { cwd: root, now: () => NOW, env: {} };
    for (const e of MEDIUM_T1) appendEvent(root, e);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

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
    // The upload is kept: a later generation (a swarm task, say) still carries it.
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
    expect(forge.rounds).toEqual([{ brief: 1, n: 1, action: 'accept', note: 'accepted', findings: { critical: 0, important: 0, minor: 0, deferred: 0 }, reviewers: ['correctness', 'security'], at: ROADMAP_AT(73) }]);
    expect(forge.validators).toEqual([{ name: 'test', ok: true }]);
    expect(parseForgeDocV2(forge)).toEqual(forge);
  });
  it('shop T1, web T1 and a loose T1 in one ledger each produce only their own block', () => {
    const web = MEDIUM_T1.map(e => ({ ...e, project: 'web', ...(e.dir ? { dir: String(e.dir).replace('/shop/', '/web/') } : {}) }));
    const loose = [
      { ts: ROADMAP_AT(80), kind: 'triage', task: 'T1', path: 'small', reasons: [] },
      { ts: ROADMAP_AT(81), kind: 'phase', task: 'T1', phase: 'implement', brief: 1 },
    ] as LedgerEvent[];
    for (const e of web) appendEvent(root, e);
    for (const e of loose) appendEvent(root, e);
    const forge = (...a: string[]) => JSON.parse(readFileSync(out(cli('roadmap-doc', 'T1', ...a)).file, 'utf8')).forge;
    expect(forge('--project', 'shop')).toMatchObject({ path: 'medium', rounds: [{ at: ROADMAP_AT(20) }, { at: ROADMAP_AT(40) }] });
    expect(forge('--project', 'web')).toMatchObject({ path: 'medium' });
    expect(forge('--project', 'web').rounds).toHaveLength(2);
    const l = out(cli('roadmap-doc', 'T1'));
    expect(l.project).toBeNull();
    expect(l.file).toBe(path.join(root, '.forge', 'work', 'T1', 'roadmap-doc.json'));
    const lf = JSON.parse(readFileSync(l.file, 'utf8')).forge;
    expect(lf.path).toBe('small');
    expect(lf.rounds ?? []).toEqual([]);
  });
  it('never reads the earlier-* folders prep sets aside', () => {
    const old = path.join(root, WORK, 'earlier-r0', 'reviews-1-9');
    mkdirSync(old, { recursive: true });
    for (const f of ['security.json', 'review-plan.json']) writeFileSync(path.join(old, f), '{}');
    out(cli('roadmap-doc', 'T1', '--project', 'shop'));
    expect(JSON.stringify(data())).not.toContain('reviews-1-9');
    expect(data().forge.rounds.some((r: { n: number }) => r.n === 9)).toBe(false);
  });
});
