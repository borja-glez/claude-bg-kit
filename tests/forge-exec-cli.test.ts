import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, defaultGit, type Io } from '../src/forge/cli/run.js';
import { readExecution, saveExecution, executionTaskFile } from '../src/forge/execution.js';
import { normalizeExecution } from '../src/lib/execution-state.js';
import { setupFor } from '../src/forge/cli/swarm.js';

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
  it('start refuses the base branch, a branch checked out elsewhere and a branch that starts with a dash', () => {
    const base = run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--branch', 'main'], io);
    expect(base.code).toBe(2);
    expect(base.stderr).toMatch(/main is the base branch/);
    git('branch', 'busy');
    git('worktree', 'add', path.join(root, '.claude', 'worktrees', 'other'), 'busy');
    const busy = run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--branch', 'busy'], io);
    expect(busy.code).toBe(2);
    expect(busy.stderr).toMatch(/busy is checked out in another worktree/);
    expect(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--branch', '-x'], io).code).toBe(2);
    expect(readExecution(root)).toBeNull();
  });
  it('start from a non-main base creates forge/run-<project> from it', () => {
    git('checkout', '-q', '-b', 'forge/infinite');
    writeFileSync(path.join(root, 'inf.txt'), 'x');
    git('add', 'inf.txt'); git('commit', '-qm', 'infinite work');
    const e = out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--merge-on-finish'], io));
    expect(e).toMatchObject({ base: 'forge/infinite', branch: 'forge/run-shop', mergeOnFinish: true });
    expect(git('rev-parse', 'forge/run-shop')).toBe(git('rev-parse', 'forge/infinite'));
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('forge/infinite');
  });
  it('start refuses an existing run worktree that is on another branch, naming it', () => {
    git('branch', 'stray');
    git('worktree', 'add', path.join(root, '.claude', 'worktrees', 'run'), 'stray');
    const r = run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/is on stray, not forge\/run-shop/);
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
  it('worktree runs swarm.setup in a new task worktree once and reports it', () => {
    writeFileSync(path.join(root, '.forge', 'config.yaml'), `validators: []\nswarm:\n  setup: node -e "require('fs').writeFileSync('setup-ran','1')"\n`);
    const s = out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], { ...io, exec: undefined }));
    expect(existsSync(path.join(root, '.claude', 'worktrees', 'run', 'setup-ran'))).toBe(true);
    expect(s.setup).toMatchObject({ ok: true });
    const w = out(run(['swarm', 'worktree', 'T1'], { ...io, exec: undefined }));
    expect(existsSync(path.join(w.worktree, 'setup-ran'))).toBe(true);
    expect(w.setup).toMatchObject({ cmd: `node -e "require('fs').writeFileSync('setup-ran','1')"`, ok: true });
    expect(Array.isArray(w.setup.tail)).toBe(true);
    rmSync(path.join(w.worktree, 'setup-ran'));
    const again = out(run(['swarm', 'worktree', 'T1'], { ...io, exec: undefined }));
    expect(again.setup).toBeNull();
    expect(existsSync(path.join(w.worktree, 'setup-ran'))).toBe(false);
  });
  it('setup: a lockfile picks the install command, a failure is reported, a .venv without setup asks for one', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\nswarm:\n  setup: node -e "process.exit(3)"\n');
    const failed = out(run(['swarm', 'worktree', 'T1'], { ...io, exec: undefined }));
    expect(failed.setup).toMatchObject({ ok: false });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
    mkdirSync(path.join(root, '.venv'));
    const venv = out(run(['swarm', 'worktree', 'T2'], io));
    expect(venv.setup).toEqual({ cmd: null, ok: false, tail: ['python project: set swarm.setup in .forge/config.yaml to create the venv in each worktree'] });
    const files = (names: string[]) => ({ exists: (f: string) => names.includes(f), read: () => null, list: () => [] });
    expect(setupFor(files(['package-lock.json']), undefined)).toEqual({ cmd: 'npm ci' });
    expect(setupFor(files(['pnpm-lock.yaml']), undefined)).toEqual({ cmd: 'pnpm install --frozen-lockfile' });
    expect(setupFor(files(['yarn.lock']), undefined)).toEqual({ cmd: 'yarn install --frozen-lockfile' });
    expect(setupFor(files([]), undefined)).toBeNull();
    expect(setupFor(files(['package-lock.json', '.venv']), 'make deps')).toEqual({ cmd: 'make deps' });
  });
  it('task --drop forgets a task lost in a claim race, so the next tick leaves it to its owner', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    writeDocs(path.join(root, 'db', 'state'), {});
    writeDocs(path.join(root, 'db', 'sessions'), {});
    out(run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'db'], io));
    out(run(['swarm', 'task', 'T1', '--stage', 'brief'], io));
    expect(existsSync(executionTaskFile(root, 'T1'))).toBe(true);
    expect(run(['swarm', 'task', 'T1', '--drop'], io).code).toBe(0);
    expect(readExecution(root)!.tasks.T1).toBeUndefined();
    expect(existsSync(executionTaskFile(root, 'T1'))).toBe(false);
    writeDocs(path.join(root, 'db', 'state'), { T1: { status: 'in_progress', owner: 'other', claimedAt: NOW.toISOString() } });
    writeDocs(path.join(root, 'db', 'sessions'), { other: { status: 'active', heartbeatAt: NOW.toISOString(), leaseUntil: new Date(NOW.getTime() + 600000).toISOString() } });
    const t = out(run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'db'], io));
    expect(t.actions.filter((a: { type: string }) => a.type === 'start').map((a: { task: string }) => a.task)).not.toContain('T1');
    expect(readExecution(root)!.tasks.T1).toBeUndefined();
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
  it('sleep clears sleepUntil only when a newer sleep did not replace it', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    const newer = '2026-10-12T13:00:00.000Z';
    const overlap = () => { const e = readExecution(root)!; saveExecution(root, { ...e, sleepUntil: newer }); };
    expect(run(['swarm', 'sleep', '60'], { ...io, sleep: overlap }).code).toBe(0);
    expect(readExecution(root)!.sleepUntil).toBe(newer);
    expect(run(['swarm', 'sleep', '60'], io).code).toBe(0);
    expect(readExecution(root)!.sleepUntil).toBeNull();
  });
  it('propose caps the recommendation with swarm.parallel', () => {
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\nswarm:\n  parallel: 1\n');
    expect(out(run(['swarm', 'propose', '--plan', 'plan.yaml'], io))).toMatchObject({ width: 2, recommended: { parallel: 1 } });
  });
  it('task ids follow the plan id rule', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    for (const bad of ['a:b', '..', 'a/b', 'x'.repeat(65)]) expect(run(['swarm', 'worktree', bad], io).code).toBe(2);
    for (const sub of ['task', 'retry', 'integrate']) expect(run(['swarm', sub, 'a:b'], io).code).toBe(2);
    expect(normalizeExecution({ ...readExecution(root)!, tasks: { 'a:b': { status: 'running', stage: 'brief', executor: 'subagents', worktree: '', branch: 'task/x', startedAt: NOW.toISOString() } } })!.tasks).toEqual({});
  });
  it('top-level forge stop ends an active execution and leaves the stop file', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    expect(run(['stop'], io).code).toBe(0);
    expect(readExecution(root)).toMatchObject({ active: false, stopReason: 'stopped' });
    expect(existsSync(path.join(root, '.forge', 'stop'))).toBe(true);
  });
});
