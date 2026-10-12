import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, defaultGit, type Io } from '../src/forge/cli/run.js';
import { readExecution, executionTaskFile } from '../src/forge/execution.js';

const PLAN = `project: shop
locale: es
version: "1"
artifacts: {}
versions: []
tracks:
  - { id: a, name: A, color: blue }
phases:
  - { id: p1, name: P1, plan_status: committed }
tasks:
  - { id: T1, title: T1, track: a, phase: p1, done_when: x, depends_on: [], zones: [src/t1/**] }
  - { id: T2, title: T2, track: a, phase: p1, done_when: x, depends_on: [], zones: [src/t2/**] }
  - { id: T3, title: T3, track: a, phase: p1, done_when: x, depends_on: [T1], zones: [src/t3/**] }
`;
let root: string;
let io: Io;
const NOW = new Date('2026-10-12T12:00:00.000Z');
const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const out = (r: { stdout: string; code: number; stderr: string }) => { if (r.code !== 0) throw new Error(r.stderr); return JSON.parse(r.stdout); };

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'forge-exec-cli-'));
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false');
  writeFileSync(path.join(root, 'plan.yaml'), PLAN);
  writeFileSync(path.join(root, '.gitignore'), '.forge/\n.claude/\n');
  git('add', '.'); git('commit', '-qm', 'init');
  mkdirSync(path.join(root, '.forge'), { recursive: true });
  writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
  io = { cwd: root, now: () => NOW, git: defaultGit(root), sleep: () => undefined };
});
afterEach(() => { try { git('worktree', 'prune'); } catch { /* ignore */ } rmSync(root, { recursive: true, force: true }); });
const writeDocs = (dir: string, docs: Record<string, unknown>) => {
  mkdirSync(dir, { recursive: true });
  for (const [id, d] of Object.entries(docs)) writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(d));
};

describe('forge swarm (execution)', () => {
  it('start creates the run branch in its own worktree and leaves the main checkout alone', () => {
    const e = out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--merge-on-finish'], io));
    expect(e).toMatchObject({ active: true, mode: 'subagents', parallel: 3, base: 'main', branch: 'forge/run-shop', mergeOnFinish: true });
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(existsSync(path.join(root, '.claude', 'worktrees', 'run', 'plan.yaml'))).toBe(true);
    expect(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: path.join(root, '.claude', 'worktrees', 'run'), encoding: 'utf8' }).trim()).toBe('forge/run-shop');
    // A second coordinator is refused while the first stepped less than 15 minutes ago.
    run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'db'], { ...io });
    expect(run(['swarm', 'start', '--project', 'shop', '--session', 'other'], io).code).toBe(2);
  });
  it('propose recommends subagents with the real width, sequential when it is 1', () => {
    expect(out(run(['swarm', 'propose', '--plan', 'plan.yaml'], io))).toMatchObject({ width: 2, recommended: { mode: 'subagents', parallel: 2 }, configured: null });
  });
  it('tick starts tasks, worktree creates each from the run branch, task records the stage', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    writeDocs(path.join(root, 'db', 'state'), {});
    writeDocs(path.join(root, 'db', 'sessions'), {});
    const t = out(run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'db'], io));
    expect(t.actions.filter((a: { type: string }) => a.type === 'start').map((a: { task: string }) => a.task)).toEqual(['T1', 'T2']);
    const w = out(run(['swarm', 'worktree', 'T1'], io));
    expect(w).toMatchObject({ branch: 'task/T1', worktree: path.join(root, '.claude', 'worktrees', 'task-T1') });
    expect(existsSync(path.join(w.worktree, 'plan.yaml'))).toBe(true);
    expect(readExecution(root)!.tasks.T1.worktree).toBe(w.worktree);
    out(run(['swarm', 'task', 'T1', '--stage', 'implement', '--agent', 'forge-impl', '--round', '1'], io));
    expect(readExecution(root)!.tasks.T1).toMatchObject({ stage: 'implement', agent: 'forge-impl', round: 1 });
    expect(JSON.parse(readFileSync(executionTaskFile(root, 'T1'), 'utf8'))).toMatchObject({ task: 'T1', stage: 'implement', agent: 'forge-impl', by: 'main', mode: 'subagents' });
  });
  it('tick refuses without the state and sessions listings', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    expect(run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'nope'], io).code).toBe(2);
  });
  it('retry puts a conflicting task back to implement and revives a stalled execution', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    out(run(['swarm', 'worktree', 'T1'], io));
    out(run(['swarm', 'task', 'T1', '--stage', 'integrate', '--status', 'blocked'], io));
    expect(run(['swarm', 'retry', 'T1'], io).code).toBe(0);
    expect(readExecution(root)!.tasks.T1).toMatchObject({ status: 'running', stage: 'implement', attempts: 1 });
  });
  it('stop marks the execution stopped; sleep --mark records sleepUntil', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    expect(run(['swarm', 'sleep', '300', '--mark'], io).code).toBe(0);
    expect(readExecution(root)!.sleepUntil).toBe('2026-10-12T12:05:00.000Z');
    expect(run(['swarm', 'stop'], io).code).toBe(0);
    expect(readExecution(root)).toMatchObject({ active: false, stopReason: 'stopped' });
  });
});
