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
