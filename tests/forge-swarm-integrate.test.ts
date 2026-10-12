import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, defaultGit, type Io } from '../src/forge/cli/run.js';
import { readExecution } from '../src/forge/execution.js';

let root: string;
let io: Io;
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const git = (...a: string[]) => g(root, ...a);
const commitIn = (cwd: string, file: string, text: string, msg: string) => { writeFileSync(path.join(cwd, file), text); g(cwd, 'add', file); g(cwd, 'commit', '-qm', msg); return g(cwd, 'rev-parse', 'HEAD'); };
const out = (r: { stdout: string }) => JSON.parse(r.stdout);
const runWt = () => path.join(root, '.claude', 'worktrees', 'run');
const RED = 'validators:\n  - name: check\n    cmd: node -e "process.exit(1)"\n';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'forge-integ-'));
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false');
  writeFileSync(path.join(root, '.gitignore'), '.forge/\n.claude/\n');
  git('add', '.gitignore');
  commitIn(root, 'base.txt', 'base\n', 'init');
  mkdirSync(path.join(root, '.forge'), { recursive: true });
  writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
  io = { cwd: root, now: () => new Date('2026-10-12T12:00:00.000Z'), git: defaultGit(root) };
  out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
});
afterEach(() => { try { git('worktree', 'prune'); } catch { /* ignore */ } rmSync(root, { recursive: true, force: true }); });

const accept = (task: string, file: string, text: string) => {
  const w = out(run(['swarm', 'worktree', task], io)).worktree;
  commitIn(w, file, text, `${task}: work`);
  out(run(['swarm', 'task', task, '--stage', 'verdict', '--status', 'accepted'], io));
  return w;
};

describe('forge swarm integrate (into the run branch)', () => {
  it('merges an accepted task into the run branch in its worktree, never in the main checkout', () => {
    accept('T1', 'a.txt', 'a\n');
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'integrated' });
    expect(g(runWt(), 'log', '-1', '--format=%s')).toBe('forge: integrate T1');
    expect(git('log', '-1', '--format=%s')).toBe('init');
    expect(readExecution(root)!.tasks.T1).toMatchObject({ status: 'integrated', stage: 'integrate' });
  });
  it('refuses a task that is not accepted', () => {
    out(run(['swarm', 'worktree', 'T1'], io));
    expect(run(['swarm', 'integrate', 'T1'], io).code).toBe(2);
  });
  it('rolls back a conflict and marks the task in conflict', () => {
    accept('T1', 'base.txt', 'from T1\n');
    commitIn(runWt(), 'base.txt', 'from run\n', 'run change');
    const before = g(runWt(), 'rev-parse', 'HEAD');
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'conflict' });
    expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(before);
    expect(g(runWt(), 'status', '--porcelain')).toBe('');
    expect(readExecution(root)!.tasks.T1.status).toBe('conflict');
  });
  it('rolls back when the validators fail after the merge', () => {
    accept('T1', 'a.txt', 'a\n');
    writeFileSync(path.join(root, '.forge', 'config.yaml'), RED);
    // Validators run in the run worktree: its own .forge/config.yaml is read from there.
    mkdirSync(path.join(runWt(), '.forge'), { recursive: true });
    writeFileSync(path.join(runWt(), '.forge', 'config.yaml'), RED);
    const before = g(runWt(), 'rev-parse', 'HEAD');
    expect(out(run(['swarm', 'integrate', 'T1'], io)).detail).toContain('validators failed');
    expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(before);
    expect(() => g(runWt(), 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).toThrow();
    expect(g(runWt(), 'status', '--porcelain')).toBe('');
  });
  it('rolls back when the validators cannot run (invalid config brought by the task)', () => {
    const w = accept('T1', 'a.txt', 'a\n');
    mkdirSync(path.join(w, '.forge'), { recursive: true });
    writeFileSync(path.join(w, '.forge', 'config.yaml'), 'swarm: [nope\n');
    g(w, 'add', '-f', '.forge/config.yaml'); g(w, 'commit', '-qm', 'bad config');
    const before = g(runWt(), 'rev-parse', 'HEAD');
    const r = out(run(['swarm', 'integrate', 'T1'], io));
    expect(r).toMatchObject({ result: 'conflict' });
    expect(r.detail).toContain('validators could not run');
    expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(before);
    expect(() => g(runWt(), 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).toThrow();
    expect(g(runWt(), 'status', '--porcelain')).toBe('');
  });
  it('does nothing when a merge is already in progress in the run worktree', () => {
    accept('T1', 'base.txt', 'from T1\n');
    commitIn(runWt(), 'base.txt', 'from run\n', 'run change');
    expect(() => g(runWt(), 'merge', '--no-ff', '--no-commit', 'task/T1')).toThrow();
    const head = g(runWt(), 'rev-parse', 'HEAD');
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'run-dirty' });
    expect(g(runWt(), 'rev-parse', 'MERGE_HEAD')).toBe(g(root, 'rev-parse', 'task/T1'));
    expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(head);
    expect(readExecution(root)!.tasks.T1.status).toBe('accepted');
  });
  it('does nothing when the run worktree is dirty', () => {
    accept('T1', 'a.txt', 'a\n');
    writeFileSync(path.join(runWt(), 'stray.txt'), 'x\n');
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'run-dirty' });
    expect(readExecution(root)!.tasks.T1.status).toBe('accepted');
  });
  it('does nothing when the run worktree is not on the execution branch', () => {
    accept('T1', 'a.txt', 'a\n');
    g(runWt(), 'switch', '-c', 'other');
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'run-dirty' });
    expect(readExecution(root)!.tasks.T1.status).toBe('accepted');
  });
  it('merge: asks without authorization, merges into the base with it, refuses a dirty main checkout', () => {
    accept('T1', 'a.txt', 'a\n');
    out(run(['swarm', 'integrate', 'T1'], io));
    expect(out(run(['swarm', 'merge'], io))).toEqual({ result: 'needs-authorization' });
    writeFileSync(path.join(root, 'dirty.txt'), 'x\n');
    expect(out(run(['swarm', 'merge', '--yes'], io))).toMatchObject({ result: 'main-dirty' });
    rmSync(path.join(root, 'dirty.txt'));
    expect(out(run(['swarm', 'merge', '--yes'], io))).toMatchObject({ result: 'merged' });
    expect(git('log', '-1', '--format=%s')).toBe('forge: merge forge/run-shop');
  });
});
