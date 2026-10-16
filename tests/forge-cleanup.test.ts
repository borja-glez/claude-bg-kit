import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, defaultExec, defaultGit, repoReader, type Io } from '../src/forge/cli/run.js';
import { swarmCommand, type SwarmDeps } from '../src/forge/cli/swarm.js';
import { saveExecution } from '../src/forge/execution.js';
import { forgeBranches, forgeWorktrees } from '../src/forge/cleanup.js';
import { withJob } from '../src/forge/jobs.js';
import type { ExecutionState } from '../src/lib/execution-state.js';

let root: string;
let io: Io;
const NOW = new Date('2026-10-16T12:00:00.000Z');
const at = NOW.toISOString();
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const wt = (name: string) => path.join(root, '.claude', 'worktrees', name);
const forge = (...p: string[]) => path.join(root, '.forge', ...p);
const commitIn = (cwd: string, file: string, msg: string) => { writeFileSync(path.join(cwd, file), `${msg}\n`); g(cwd, 'add', file); g(cwd, 'commit', '-qm', msg); };
const exec = (over: Partial<ExecutionState> = {}): ExecutionState => ({
  runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
  coordinator: 'main', hookSession: 'h1', active: false, stopReason: 'finished', stallReason: null, startedAt: at, lastStepAt: null,
  lastBlockStep: null, sleepUntil: null, tasks: {}, closedAt: at, closedBy: 'merge', ...over,
});
const spyDeps = (calls: string[][]): SwarmDeps => {
  const spy = (git: (a: string[]) => string | null) => (a: string[]) => { calls.push(a); return git(a); };
  return { git: spy(defaultGit(root)), exec: defaultExec(root), repo: repoReader(root), at: dir => ({ git: spy(defaultGit(dir)), exec: defaultExec(dir), repo: repoReader(dir) }) };
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'forge-cleanup-'));
  g(root, 'init', '-q', '-b', 'main'); g(root, 'config', 'user.email', 'a@b.c'); g(root, 'config', 'user.name', 't'); g(root, 'config', 'core.autocrlf', 'false');
  writeFileSync(path.join(root, '.gitignore'), '.forge/\n.claude/\n');
  // Committed, so every worktree ignores .forge/ as the main checkout does.
  g(root, 'add', '.gitignore');
  commitIn(root, 'a.txt', 'init');
  io = { cwd: root, now: () => NOW, git: defaultGit(root), env: {} };
  // T1 integrated, with evidence in its worktree; T2 not integrated; T3 integrated but with an untracked file; task/T4
  // integrated without a worktree; track/ui and feature/x are not forge's.
  g(root, 'worktree', 'add', '-q', '-b', 'task/T1', wt('task-T1'));
  commitIn(wt('task-T1'), 't1.txt', 'T1 work');
  g(root, 'merge', '-q', '--no-ff', 'task/T1', '-m', 'merge T1');
  mkdirSync(path.join(wt('task-T1'), '.forge', 'work', 'shop', 'T1', 'evidence', '1-1'), { recursive: true });
  writeFileSync(path.join(wt('task-T1'), '.forge', 'work', 'shop', 'T1', 'evidence', '1-1', '01.png'), 'png');
  g(root, 'worktree', 'add', '-q', '-b', 'task/T2', wt('task-T2'));
  commitIn(wt('task-T2'), 't2.txt', 'T2 work');
  g(root, 'worktree', 'add', '-q', '-b', 'task/T3', wt('task-T3'));
  writeFileSync(path.join(wt('task-T3'), 'loose.txt'), 'x');
  for (const b of ['task/T4', 'track/ui', 'feature/x']) g(root, 'branch', b);
  for (const d of ['execution/baseline', 'members', 'live', 'work/shop/T1']) mkdirSync(forge(d), { recursive: true });
  saveExecution(root, exec());
  writeFileSync(forge('execution', 'T1.json'), JSON.stringify({ task: 'T1', runId: 'r1', stage: 'integrate', status: 'integrated', agent: null, round: 1, since: at, updatedAt: at, leaseUntil: at, by: 'main', mode: 'subagents' }));
  writeFileSync(forge('execution', 'merging.json'), '{"x":1}');
  writeFileSync(forge('members', 'ui.json'), JSON.stringify({ sessionId: 'ui', role: 'manual', runId: 'r1', task: null, name: null, since: at, hookSession: null }));
  writeFileSync(forge('live', 'h1.json'), JSON.stringify({ sessionId: 'h1', role: 'coordinator', runId: 'r1', task: null, event: 'Stop', ts: at, agents: [], ended: false }));
  writeFileSync(forge('execution', 'baseline', 'old.json'), '[]');
  writeFileSync(forge('execution', 'baseline', 'fresh.json'), '[]');
  const eightDays = new Date(NOW.getTime() - 8 * 86400_000);
  utimesSync(forge('execution', 'baseline', 'old.json'), eightDays, eightDays);
  writeFileSync(forge('work', 'shop', 'T1', 'diff-1.patch'), 'd');
  writeFileSync(forge('work', 'shop', 'T1', 'brief-1.md'), 'b');
});
afterEach(() => { try { g(root, 'worktree', 'prune'); } catch { /* ignore */ } rmSync(root, { recursive: true, force: true }); });

describe('forge swarm cleanup (D-03, D-18)', () => {
  it('--dry-run says what would go and changes nothing', () => {
    const r = JSON.parse(swarmCommand(['cleanup', '--dry-run'], io, spyDeps([])).stdout);
    expect(r.dryRun).toBe(true);
    expect(r.removed.worktrees).toEqual(['.claude/worktrees/task-T1']);
    expect([...r.removed.branches].sort()).toEqual(['task/T1', 'task/T4']);
    expect(r.removed.files).toBeGreaterThan(0);
    expect(r.kept).toEqual(expect.arrayContaining([
      { path: '.claude/worktrees/task-T2', branch: 'task/T2', reason: 'not merged into main' },
      { path: '.claude/worktrees/task-T3', branch: 'task/T3', reason: 'has uncommitted changes or untracked files' },
    ]));
    expect(existsSync(wt('task-T1'))).toBe(true);
    expect(g(root, 'branch', '--list', 'task/T4')).not.toBe('');
    expect(existsSync(forge('members', 'ui.json'))).toBe(true);
  });
  it('removes the integrated worktree and branches, keeps the rest with their reason, prunes the state and never forces git', () => {
    const calls: string[][] = [];
    const r = JSON.parse(swarmCommand(['cleanup'], io, spyDeps(calls)).stdout);
    expect(r).toMatchObject({ dryRun: false, removed: { worktrees: ['.claude/worktrees/task-T1'] } });
    expect([...r.removed.branches].sort()).toEqual(['task/T1', 'task/T4']);
    expect(existsSync(wt('task-T1'))).toBe(false);
    expect(existsSync(wt('task-T2')) && existsSync(wt('task-T3'))).toBe(true);
    expect(g(root, 'branch', '--format=%(refname:short)').split('\n').sort()).toEqual(['feature/x', 'main', 'task/T2', 'task/T3', 'track/ui']);
    // The evidence of T1 reached the main checkout before its worktree went (K2-04).
    expect(readFileSync(forge('work', 'shop', 'T1', 'evidence', '1-1', '01.png'), 'utf8')).toBe('png');
    for (const f of ['execution/T1.json', 'members/ui.json', 'live/h1.json', 'execution/baseline/old.json', 'work/shop/T1/diff-1.patch']) expect(existsSync(forge(f)), f).toBe(false);
    for (const f of ['execution/merging.json', 'execution/baseline/fresh.json', 'work/shop/T1/brief-1.md', 'execution.json']) expect(existsSync(forge(f)), f).toBe(true);
    expect(calls.flat().filter(a => a === '-D' || a === '--force' || a === '-f' || a === 'reset')).toEqual([]);
  });
  it('refuses while the execution is active', () => {
    saveExecution(root, exec({ active: true, stopReason: null, closedAt: null, closedBy: null }));
    const r = run(['swarm', 'cleanup'], io);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('swarm cleanup: the execution r1 is active; stop or close it first');
  });
  it('an ended execution that is still open keeps its own state', () => {
    saveExecution(root, exec({ stopReason: 'stalled', closedAt: null, closedBy: null }));
    swarmCommand(['cleanup'], io, spyDeps([]));
    expect(existsSync(forge('members', 'ui.json'))).toBe(true);
    expect(existsSync(forge('execution', 'T1.json'))).toBe(true);
  });
  it("reads forge's own worktrees and branches only", () => {
    const porcelain = ['worktree /r', 'HEAD a', 'branch refs/heads/main', '', 'worktree /r/.claude/worktrees/task-T1', 'HEAD b', 'branch refs/heads/task/T1', '',
      'worktree /r/.claude/worktrees/run', 'HEAD c', 'detached', '', 'worktree /r/.claude/worktrees/ui', 'HEAD d', 'branch refs/heads/track/ui', ''].join('\n');
    expect(forgeWorktrees(porcelain, path.resolve('/r'))).toEqual([
      { path: path.resolve('/r/.claude/worktrees/task-T1'), name: 'task-T1', branch: 'task/T1' },
      { path: path.resolve('/r/.claude/worktrees/run'), name: 'run', branch: null },
    ]);
    expect(forgeBranches('refs/heads/task/T1\nrefs/heads/forge/run-shop\nrefs/heads/forge/other\nrefs/heads/track/ui\n')).toEqual(['task/T1', 'forge/run-shop']);
  });
});

describe('swarm cleanup leaves what is still in use, or not yet kept anywhere else', () => {
  const nothingMoved = () => {
    expect(existsSync(wt('task-T1'))).toBe(true);
    expect(g(root, 'branch', '--list', 'task/T4')).not.toBe('');
    expect(existsSync(forge('members', 'ui.json'))).toBe(true);
  };
  it('refuses while an integration is merging (the merging.json of a live attempt)', () => {
    const staleAt = new Date(NOW.getTime() + 3600_000).toISOString();
    writeFileSync(forge('execution', 'merging.json'), JSON.stringify({ task: 'T2', pre: g(root, 'rev-parse', 'HEAD'), ref: 'task/T2', pid: process.ppid, startedAt: at, staleAt, dir: root, phase: 'merge' }));
    for (const argv of [['swarm', 'cleanup'], ['swarm', 'cleanup', '--dry-run']]) {
      const r = run(argv, io);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('swarm cleanup: an integration is merging');
    }
    nothingMoved();
  });
  it('refuses while a background forge command runs (.forge/jobs)', () => {
    const r = withJob(root, { cmd: 'integrate', task: 'T2', out: 'o.json', session: null, startedAt: at }, () => run(['swarm', 'cleanup'], io));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('swarm cleanup: a background forge command is running (integrate T2, .forge/jobs/integrate-T2-');
    nothingMoved();
  });
  it('refuses while a swarm step holds .forge/jobs/step.lock', () => {
    mkdirSync(forge('jobs'), { recursive: true });
    writeFileSync(forge('jobs', 'step.lock'), JSON.stringify({ pid: process.ppid, startedAt: at }) + '\n');
    const r = run(['swarm', 'cleanup'], io);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('swarm cleanup: a swarm step is running');
    nothingMoved();
  });
  it('a marker, a job or a step.lock whose process died does not stop it', () => {
    const dead = spawnSync(process.execPath, ['-e', '']).pid!;
    const staleAt = new Date(NOW.getTime() + 3600_000).toISOString();
    writeFileSync(forge('execution', 'merging.json'), JSON.stringify({ task: 'T2', pre: g(root, 'rev-parse', 'HEAD'), ref: 'task/T2', pid: dead, startedAt: at, staleAt, dir: root, phase: 'merge' }));
    mkdirSync(forge('jobs'), { recursive: true });
    writeFileSync(forge('jobs', 'step.lock'), JSON.stringify({ pid: dead, startedAt: at }) + '\n');
    writeFileSync(forge('jobs', 'integrate-T2-1.json'), JSON.stringify({ name: 'integrate-T2-1', cmd: 'integrate', task: 'T2', pid: dead, startedAt: at, out: 'o.json', session: null }));
    const r = run(['swarm', 'cleanup'], io);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).removed.worktrees).toEqual(['.claude/worktrees/task-T1']);
  });
  it('keeps a task worktree whose own ledger holds events the main ledger lacks, and removes it once they are there (Task 9)', () => {
    const line = JSON.stringify({ ts: at, kind: 'phase', task: 'T1', phase: 'implement' });
    mkdirSync(path.join(wt('task-T1'), '.forge'), { recursive: true });
    // Two copies of one event and a half-written line: the main ledger's one copy covers only one of them (readEvents'
    // rule), and the half line is no event.
    writeFileSync(path.join(wt('task-T1'), '.forge', 'ledger.jsonl'), `${line}\n${line}\n{"ts":"2026`);
    writeFileSync(forge('ledger.jsonl'), `${line}\n`);
    const first = JSON.parse(swarmCommand(['cleanup'], io, spyDeps([])).stdout);
    expect(first.kept).toContainEqual({ path: '.claude/worktrees/task-T1', branch: 'task/T1', reason: 'unmerged ledger' });
    expect(first.removed.worktrees).toEqual([]);
    expect(existsSync(wt('task-T1'))).toBe(true);
    expect(g(root, 'branch', '--list', 'task/T1')).not.toBe('');
    // The main ledger is never written by cleanup.
    expect(readFileSync(forge('ledger.jsonl'), 'utf8')).toBe(`${line}\n`);
    appendFileSync(forge('ledger.jsonl'), `${line}\n`);
    const second = JSON.parse(swarmCommand(['cleanup'], io, spyDeps([])).stdout);
    expect(second.removed).toMatchObject({ worktrees: ['.claude/worktrees/task-T1'], branches: ['task/T1'] });
    expect(existsSync(wt('task-T1'))).toBe(false);
  });
  it('keeps a task worktree whose evidence cannot reach the main checkout', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'forge-cleanup-out-'));
    try {
      symlinkSync(outside, forge('work', 'shop', 'T1', 'evidence'), 'junction');
      const r = JSON.parse(swarmCommand(['cleanup'], io, spyDeps([])).stdout);
      expect(r.kept).toContainEqual({ path: '.claude/worktrees/task-T1', branch: 'task/T1', reason: 'its evidence could not be copied to the main checkout (1 file); run swarm cleanup again once it can' });
      expect(r.removed.worktrees).toEqual([]);
      expect(existsSync(wt('task-T1'))).toBe(true);
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(forge('work', 'shop', 'T1', 'evidence'), { force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
  it('keeps the branch the main checkout is on, a forge branch another worktree holds and the waypoint tracks, each with its reason', () => {
    g(root, 'worktree', 'add', '-q', '-b', 'task/T6', wt('ui'));
    g(root, 'checkout', '-q', '-b', 'task/T9');
    const r = JSON.parse(swarmCommand(['cleanup', '--dry-run'], io, spyDeps([])).stdout);
    expect(r.kept).toEqual(expect.arrayContaining([
      { branch: 'task/T9', reason: 'checked out in the main checkout' },
      { branch: 'task/T6', reason: 'checked out in .claude/worktrees/ui' },
      { branch: 'track/ui', reason: "a waypoint track, not forge's" },
      { path: '.claude/worktrees/task-T2', branch: 'task/T2', reason: 'not merged into task/T9' },
    ]));
    expect(r.removed.branches).not.toContain('task/T9');
    expect(JSON.stringify(r)).not.toContain('feature/x');
  });
  it("removes forge's run worktree once merged, and leaves a run branch the person named", () => {
    g(root, 'worktree', 'add', '-q', '-b', 'feature/run', wt('run'));
    const r = JSON.parse(swarmCommand(['cleanup'], io, spyDeps([])).stdout);
    expect(r.removed.worktrees).toContain('.claude/worktrees/run');
    expect(r.kept).toContainEqual({ branch: 'feature/run', reason: "not a forge branch (task/* or forge/run-*)" });
    expect(existsSync(wt('run'))).toBe(false);
    expect(g(root, 'branch', '--list', 'feature/run')).not.toBe('');
  });
});
