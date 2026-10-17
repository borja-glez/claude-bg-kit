import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, defaultExec, defaultGit, repoReader, type Io } from '../src/forge/cli/run.js';
import { swarmCommand, type SwarmDeps } from '../src/forge/cli/swarm.js';
import { saveExecution } from '../src/forge/execution.js';
import { appendEvent } from '../src/forge/ledger.js';
import { keepEvidence } from '../src/forge/evidence-copy.js';
import type { ExecutionState } from '../src/lib/execution-state.js';

// Carry 3 and its residuals: a new execution of a plan task (run B) restarts brief 1 in the same work folder, and the
// review rounds an earlier one (run A) left there are set aside by B, never read as B's nor lost.
const NOW = new Date('2026-10-16T12:00:00.000Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60000).toISOString();
let root: string;
let wt: string;
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const W = (base: string, ...p: string[]) => path.join(base, '.forge', 'work', 'shop', 'T1', ...p);
const put = (file: string, text: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const read = (file: string) => readFileSync(file, 'utf8');
const task = () => ({ status: 'running', stage: 'brief', round: 0, worktree: wt, branch: 'task/T1', executor: 'sessions', attempts: 0, agent: null, startedAt: at(0), stageSince: at(0), updatedAt: at(0), detail: null });
// Run B, a sessions run of shop that holds T1, started at NOW.
const exec = (over: Partial<ExecutionState> = {}): ExecutionState => ({
  runId: 'shop-B', kind: 'plan', mode: 'sessions', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
  coordinator: 'main', hookSession: 'h-new', active: true, stopReason: null, stallReason: null, startedAt: at(0), lastStepAt: at(0),
  lastBlockStep: null, sleepUntil: null, tasks: { T1: task() } as never, closedAt: null, closedBy: null, ...over,
} as ExecutionState);
const io = (cwd: string, min = 1): Io => ({ cwd, now: () => new Date(NOW.getTime() + min * 60000), git: defaultGit(cwd), sleep: () => undefined, env: {} });
const deps = (): SwarmDeps => ({ git: defaultGit(root), exec: defaultExec(root), repo: repoReader(root), at: dir => ({ git: defaultGit(dir), exec: defaultExec(dir), repo: repoReader(dir) }) });
// Run A, an hour before B: T1's review round 1 with a verification, in its worktree and (keepEvidence's copy) in main.
const runA = () => {
  for (const base of [wt, root]) {
    put(W(base, 'reviews-1-1', 'verify.json'), '"A"');
    put(W(base, 'evidence', '1-1', '01.png'), 'A1');
    put(W(base, 'evidence', '1-1', '02.png'), 'A2');
  }
  appendEvent(root, { ts: at(-60), kind: 'triage', task: 'T1', path: 'large', project: 'shop' });
  appendEvent(root, { ts: at(-60), kind: 'phase', task: 'T1', phase: 'review', brief: 1, round: 1, project: 'shop' });
};
// B's member starts brief 1 in its task worktree.
const prepB = (cwd = wt) => run(['prep', '--task', 'T1-1', '--path', 'large', '--no-baseline', '--project', 'shop'], io(cwd));

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'forge-set-aside-'));
  g(root, 'init', '-q', '-b', 'main'); g(root, 'config', 'user.email', 'a@b.c'); g(root, 'config', 'user.name', 't'); g(root, 'config', 'core.autocrlf', 'false');
  writeFileSync(path.join(root, '.gitignore'), '.forge/\n.claude/\n');
  writeFileSync(path.join(root, 'a.txt'), 'a\n');
  g(root, 'add', '.'); g(root, 'commit', '-qm', 'init');
  mkdirSync(path.join(root, '.forge'), { recursive: true });
  writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
  g(root, 'branch', 'forge/run-shop');
  wt = path.join(root, '.claude', 'worktrees', 'task-T1');
  g(root, 'worktree', 'add', '-q', '-b', 'task/T1', wt, 'forge/run-shop');
  saveExecution(root, exec());
});
afterEach(() => { try { g(root, 'worktree', 'prune'); } catch { /* ignore */ } rmSync(root, { recursive: true, force: true }); });

describe('readers keyed by a round folder see only this execution (R3, M3)', () => {
  it("FORGE last in run B does not return A's verdict and round on reviews-1-1; B's own are", () => {
    runA();
    const dir = '.forge/work/shop/T1/reviews-1-1';
    appendEvent(root, { ts: at(-59), kind: 'verdict', task: 'T1-1', dir, action: 'fix', score: 0.4, project: 'shop' });
    appendEvent(root, { ts: at(-59), kind: 'round', task: 'T1-1', next: 'resume', project: 'shop' });
    const last = () => JSON.parse(run(['last', '--task', 'T1-1'], io(root)).stdout);
    expect(last()).toMatchObject({ verdict: null, round: null });
    appendEvent(root, { ts: at(2), kind: 'verdict', task: 'T1-1', dir, action: 'accept', score: 0.9, project: 'shop' });
    expect(last().verdict).toMatchObject({ ts: at(2), action: 'accept' });
    // Outside the execution that holds the task, the whole ledger counts, as before.
    saveExecution(root, exec({ tasks: {} }));
    expect(last()).toMatchObject({ round: { ts: at(-59) } });
  });
  it("prep sets aside the root-level files of the rounds it moves: B's round never overwrites A's findings", () => {
    runA();
    put(W(root, 'reviews-1-2', 'head.txt'), 'x');
    const files = ['findings-1-1.json', 'fix-1-2.patch', 'handover-1-2.md', 'validators-fix-1-1-1.json', 'validators-fix-1-2-2.json'];
    for (const f of [...files, 'brief-1.md', 'findings-2-1.json']) put(W(root, f), 'A');
    expect(prepB(root).code).toBe(0);
    for (const f of files) {
      expect(existsSync(W(root, f)), f).toBe(false);
      expect(read(W(root, 'earlier-shop-B', f)), f).toBe('A');
    }
    // The brief's own files and another brief's stay.
    for (const f of ['brief-1.md', 'findings-2-1.json']) expect(existsSync(W(root, f)), f).toBe(true);
  });
});

describe('a set-aside that fails stops prep (R2, M2)', () => {
  it('exits 2 naming the folder it could not move, and prints earlier only when something moved', () => {
    runA();
    // The destination already holds a folder of that name, not empty: no OS renames a folder onto it.
    put(W(root, 'earlier-shop-B', 'reviews-1-1', 'other.json'), '{}');
    const r = prepB(root);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('.forge/work/shop/T1/reviews-1-1');
    expect(r.stderr).toContain('close what holds it and run prep again');
    expect(read(W(root, 'reviews-1-1', 'verify.json'))).toBe('"A"');
    // Nothing earlier to set aside: no `earlier`.
    rmSync(W(root, 'reviews-1-1'), { recursive: true });
    const again = prepB(root);
    expect(again.code, again.stderr).toBe(0);
    expect(JSON.parse(again.stdout)).not.toHaveProperty('earlier');
  });
});

describe('a partial set-aside is finished by the next prep (R6, I1)', () => {
  it("the round folders moved but findings-1-1.json and the index did not: once what held them is gone, prep moves them", () => {
    runA();
    for (const f of ['findings-1-1.json', 'findings-index-1.json', 'validators-head-1.json']) put(W(root, f), 'A');
    // What holds them: a non-empty folder where each would go.
    for (const f of ['findings-1-1.json', 'findings-index-1.json']) put(W(root, 'earlier-shop-B', f, 'held'), 'x');
    const first = prepB(root);
    expect(first.code).toBe(2);
    for (const f of ['findings-1-1.json', 'findings-index-1.json']) expect(first.stderr, f).toContain(f);
    expect(existsSync(W(root, 'reviews-1-1'))).toBe(false);
    expect(existsSync(W(root, 'findings-1-1.json'))).toBe(true);
    // The person closes what held them and runs prep again: no round folder is left, and the rest still goes.
    rmSync(W(root, 'earlier-shop-B', 'findings-1-1.json'), { recursive: true });
    rmSync(W(root, 'earlier-shop-B', 'findings-index-1.json'), { recursive: true });
    const again = prepB(root);
    expect(again.code, again.stderr).toBe(0);
    expect(JSON.parse(again.stdout).earlier).toBe('.forge/work/shop/T1/earlier-shop-B');
    for (const f of ['findings-1-1.json', 'findings-index-1.json']) {
      expect(existsSync(W(root, f)), f).toBe(false);
      expect(read(W(root, 'earlier-shop-B', f)), f).toBe('A');
    }
  });
  it("an earlier run's round left only as evidence, or as root files, still goes; this run's own index and validators-head stay", () => {
    put(W(root, 'evidence', '1-2', '01.png'), 'A');
    put(W(root, 'handover-1-3.md'), 'A');
    // This run (shop-B) already reviewed round 1: its files are its own.
    appendEvent(root, { ts: at(1), kind: 'phase', task: 'T1', phase: 'validate', brief: 1, round: 1, project: 'shop' });
    put(W(root, 'findings-1-1.json'), 'B');
    put(W(root, 'findings-index-1.json'), 'B');
    put(W(root, 'validators-head-1.json'), JSON.stringify({ round: 2, head: 'a'.repeat(40), runId: 'shop-B' }));
    expect(prepB(root).code).toBe(0);
    for (const f of ['evidence/1-2/01.png', 'handover-1-3.md']) expect(read(W(root, 'earlier-shop-B', ...f.split('/'))), f).toBe('A');
    for (const f of ['findings-1-1.json', 'findings-index-1.json', 'validators-head-1.json']) expect(existsSync(W(root, f)), f).toBe(true);
    // Another run's validators-head goes, even when this run has rounds.
    put(W(root, 'validators-head-1.json'), JSON.stringify({ round: 2, head: 'a'.repeat(40), runId: 'shop-A' }));
    expect(prepB(root).code).toBe(0);
    expect(existsSync(W(root, 'validators-head-1.json'))).toBe(false);
  });
});

describe("a failed set-aside in the main checkout names what the worktree's already moved (R8)", () => {
  it('exits 2 with both: what could not move in the main checkout, and what moved from this worktree and where', () => {
    runA();
    put(W(root, 'earlier-shop-B', 'reviews-1-1', 'held'), 'x');
    const r = prepB();
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`${W(root, 'reviews-1-1').split(path.sep).join('/')} could not be moved aside`);
    expect(r.stderr).toContain("already moved this worktree's reviews-1-1, evidence/1-1 to .forge/work/shop/T1/earlier-shop-B");
    expect(existsSync(W(wt, 'earlier-shop-B', 'reviews-1-1', 'verify.json'))).toBe(true);
  });
});

describe('an earlier run\'s evidence is never overwritten nor lost (R1, M1)', () => {
  it("prep in a member's worktree sets aside the main checkout's copy too, and swarm cleanup copies the set-aside rounds before it removes the worktree", () => {
    runA();
    const r = prepB();
    expect(r.code, r.stderr).toBe(0);
    for (const base of [wt, root]) {
      expect(existsSync(W(base, 'reviews-1-1')), base).toBe(false);
      expect(read(W(base, 'earlier-shop-B', 'reviews-1-1', 'verify.json')), base).toBe('"A"');
      expect(read(W(base, 'earlier-shop-B', 'evidence', '1-1', '02.png')), base).toBe('A2');
    }
    // B's round 1 with its verification: keepEvidence copies it to main, beside A's, never over it.
    put(W(wt, 'reviews-1-1', 'verify.json'), '"B"');
    put(W(wt, 'evidence', '1-1', '01.png'), 'B1');
    expect(keepEvidence(wt, W(wt, 'reviews-1-1'))).toEqual({ skipped: [] });
    expect(read(W(root, 'reviews-1-1', 'verify.json'))).toBe('"B"');
    expect(readdirSync(W(root, 'evidence', '1-1'))).toEqual(['01.png']);
    expect(read(W(root, 'earlier-shop-B', 'reviews-1-1', 'verify.json'))).toBe('"A"');
    // Once B ended, cleanup copies what the worktree holds, its set-aside rounds included, before it removes it.
    rmSync(W(root, 'earlier-shop-B'), { recursive: true });
    saveExecution(root, exec({ active: false, stopReason: 'finished', closedAt: at(5), closedBy: 'merge' }));
    const out = JSON.parse(swarmCommand(['cleanup'], io(root, 10), deps()).stdout);
    expect(out.removed.worktrees).toContain('.claude/worktrees/task-T1');
    expect(existsSync(wt)).toBe(false);
    expect(read(W(root, 'earlier-shop-B', 'reviews-1-1', 'verify.json'))).toBe('"A"');
    expect(read(W(root, 'earlier-shop-B', 'evidence', '1-1', '02.png'))).toBe('A2');
  });
});
