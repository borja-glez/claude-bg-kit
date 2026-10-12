import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, defaultGit, defaultExec, repoReader, type Io } from '../src/forge/cli/run.js';
import { swarmCommand } from '../src/forge/cli/swarm.js';
import { readSwarm } from '../src/forge/swarm.js';

let root: string;
let io: Io;
const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const commit = (file: string, text: string, msg: string) => { writeFileSync(path.join(root, file), text); git('add', file); git('commit', '-qm', msg); return git('rev-parse', 'HEAD'); };

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'forge-integ-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'a@b.c');
  git('config', 'user.name', 't');
  git('config', 'core.autocrlf', 'false');
  commit('base.txt', 'base\n', 'init');
  mkdirSync(path.join(root, '.forge'), { recursive: true });
  // No validators: an empty list means none.
  writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
  // .forge/ is local state: it must never count as a dirty checkout.
  io = { cwd: root, now: () => new Date('2026-10-11T12:00:00.000Z'), git: defaultGit(root) };
  run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--merge'], io);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
const RED = 'validators:\n  - name: check\n    cmd: node -e "process.exit(1)"\n';
const mergeHead = () => { try { git('rev-parse', '-q', '--verify', 'MERGE_HEAD'); return true; } catch { return false; } };
const integrate =(ref: string) => JSON.parse(run(['swarm', 'integrate', 'a', '--ref', ref], io).stdout);

describe('forge swarm integrate', () => {
  it('merges the ref with --no-ff into the base branch', () => {
    git('checkout', '-qb', 'track/a');
    commit('a.txt', 'a\n', 'A1');
    git('checkout', '-q', 'main');
    expect(integrate('track/a')).toEqual({ result: 'integrated', detail: null });
    expect(git('log', '-1', '--format=%s')).toBe('swarm: integrate a');
    expect(git('rev-list', '--count', 'main..track/a')).toBe('0');
  });
  it('merges only up to the given commit, leaving later work out', () => {
    git('checkout', '-qb', 'track/a');
    const done = commit('a.txt', 'a\n', 'A1');
    commit('a2.txt', 'wip\n', 'A2 wip');
    git('checkout', '-q', 'main');
    expect(integrate(done).result).toBe('integrated');
    expect(git('rev-list', '--count', 'main..track/a')).toBe('1');
  });
  it('aborts a conflicting merge and marks the front in conflict', () => {
    git('checkout', '-qb', 'track/a');
    commit('base.txt', 'from a\n', 'A1');
    git('checkout', '-q', 'main');
    commit('base.txt', 'from main\n', 'main change');
    const r = integrate('track/a');
    expect(r.result).toBe('conflict');
    expect(git('status', '--porcelain', '--', '.', ':!.forge')).toBe('');
    expect(readSwarm(root)!.fronts.a).toMatchObject({ status: 'conflict' });
    expect(readSwarm(root)!.notice).toMatchObject({ kind: 'conflict', track: 'a' });
  });
  it('undoes the merge when a validator fails', () => {
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators:\n  - name: check\n    cmd: node -e "process.exit(1)"\n');
    git('checkout', '-qb', 'track/a');
    commit('a.txt', 'a\n', 'A1');
    git('checkout', '-q', 'main');
    const before = git('rev-parse', 'HEAD');
    const r = integrate('track/a');
    expect(r).toMatchObject({ result: 'conflict', detail: expect.stringContaining('check') });
    expect(git('rev-parse', 'HEAD')).toBe(before);
    expect(mergeHead()).toBe(false);
    expect(git('status', '--porcelain', '--', '.', ':!.forge')).toBe('');
  });
  it('keeps uncommitted edits to ignored local state when rolling back a red validator', () => {
    mkdirSync(path.join(root, '.claude'), { recursive: true });
    writeFileSync(path.join(root, '.claude', 'y'), 'y\n');
    git('add', '-f', '.claude/y'); // a global gitignore may hide .claude
    git('commit', '-qm', 'track local file');
    writeFileSync(path.join(root, '.forge', 'config.yaml'), RED);
    git('checkout', '-qb', 'track/a');
    commit('a.txt', 'a\n', 'A1');
    git('checkout', '-q', 'main');
    const before = git('rev-parse', 'HEAD');
    writeFileSync(path.join(root, '.claude', 'y'), 'edited\n');
    expect(integrate('track/a').result).toBe('conflict');
    expect(git('rev-parse', 'HEAD')).toBe(before);
    expect(readFileSync(path.join(root, '.claude', 'y'), 'utf8')).toBe('edited\n');
  });
  it('reports a failed rollback as needing manual attention', () => {
    writeFileSync(path.join(root, '.forge', 'config.yaml'), RED);
    git('checkout', '-qb', 'track/a');
    commit('a.txt', 'a\n', 'A1');
    git('checkout', '-q', 'main');
    const real = defaultGit(root);
    // The validator fails and `merge --abort` does not run: the merge stays half-done.
    const deps = { git: (a: string[]) => (a[0] === 'merge' && a[1] === '--abort' ? null : real(a)), exec: defaultExec(root), repo: repoReader(root) };
    const out = JSON.parse(swarmCommand(['integrate', 'a', '--ref', 'track/a'], io, deps).stdout);
    expect(out.result).toBe('conflict');
    expect(out.detail).toMatch(/^rollback failed: the main checkout needs manual attention/);
    expect(readSwarm(root)!.fronts.a).toMatchObject({ status: 'conflict' });
  });
  it('never commits before the validators pass: the merge commit appears only after them', () => {
    git('checkout', '-qb', 'track/a');
    commit('a.txt', 'a\n', 'A1');
    git('checkout', '-q', 'main');
    const before = git('rev-parse', 'HEAD');
    let headDuring = '';
    let mergingDuring = false;
    const exec = (cmd: string, t: number) => { headDuring = git('rev-parse', 'HEAD'); mergingDuring = mergeHead(); return defaultExec(root)(cmd, t); };
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators:\n  - name: check\n    cmd: node -e "process.exit(0)"\n');
    const out = JSON.parse(swarmCommand(['integrate', 'a', '--ref', 'track/a'], io, { git: defaultGit(root), exec, repo: repoReader(root) }).stdout);
    expect(out).toEqual({ result: 'integrated', detail: null });
    expect(headDuring).toBe(before);
    expect(mergingDuring).toBe(true);
    expect(git('log', '-1', '--format=%s')).toBe('swarm: integrate a');
    expect(git('rev-parse', 'HEAD^1')).toBe(before);
    expect(mergeHead()).toBe(false);
  });
  it('refuses to start while an earlier integration is unfinished (MERGE_HEAD)', () => {
    git('checkout', '-qb', 'track/a');
    commit('a.txt', 'a\n', 'A1');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '--no-commit', 'track/a');
    expect(integrate('track/a')).toEqual({ result: 'conflict', detail: 'rollback failed: an unfinished integration is in progress in the main checkout (run git merge --abort to clear it)' });
    expect(mergeHead()).toBe(true);
  });
  it('reports an unknown ref as a plain conflict, not a failed rollback', () => {
    const before = git('rev-parse', 'HEAD');
    expect(integrate('track/zzz')).toEqual({ result: 'conflict', detail: 'unknown ref track/zzz' });
    expect(git('rev-parse', 'HEAD')).toBe(before);
  });
  it('reports a merge git refuses before starting as a plain conflict', () => {
    mkdirSync(path.join(root, '.claude'), { recursive: true });
    writeFileSync(path.join(root, '.claude', 'y'), 'y\n');
    git('add', '-f', '.claude/y');
    git('commit', '-qm', 'track local file');
    git('checkout', '-qb', 'track/a');
    writeFileSync(path.join(root, '.claude', 'y'), 'from a\n');
    git('add', '-f', '.claude/y');
    git('commit', '-qm', 'A1 touches y');
    git('checkout', '-q', 'main');
    // A local edit to the same ignored-state file: the merge would overwrite it, so git refuses to start.
    writeFileSync(path.join(root, '.claude', 'y'), 'edited\n');
    const r = integrate('track/a');
    expect(r.result).toBe('conflict');
    expect(r.detail).not.toMatch(/^rollback failed/);
    expect(readFileSync(path.join(root, '.claude', 'y'), 'utf8')).toBe('edited\n');
    expect(mergeHead()).toBe(false);
  });
  it('reports main-dirty for real changes, once, but ignores .forge, .waypoint and .claude', () => {
    git('checkout', '-qb', 'track/a');
    commit('a.txt', 'a\n', 'A1');
    git('checkout', '-q', 'main');
    mkdirSync(path.join(root, '.waypoint'), { recursive: true });
    writeFileSync(path.join(root, '.waypoint', 'x.json'), '{}');
    mkdirSync(path.join(root, '.claude'), { recursive: true });
    writeFileSync(path.join(root, '.claude', 'y'), 'y');
    writeFileSync(path.join(root, 'base.txt'), 'edited\n');
    expect(integrate('track/a')).toMatchObject({ result: 'main-dirty', first: true });
    expect(integrate('track/a')).toMatchObject({ result: 'main-dirty', first: false });
    git('checkout', '--', 'base.txt');
    expect(integrate('track/a').result).toBe('integrated');
    expect(readSwarm(root)!.notice).toBeNull();
  });
  it('refuses without merge authorization', () => {
    run(['swarm', 'stop'], io);
    run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io);
    expect(readSwarm(root)!.mergeAuthorized).toBe(false);
    expect(run(['swarm', 'integrate', 'a', '--ref', 'track/a'], io).stderr).toContain('authorization');
  });
});

describe('forge swarm outside the main checkout', () => {
  it('start, tick, integrate, sleep, mark and retry refuse inside a worktree; status and stop still work', () => {
    const wt = path.join(root, '.claude', 'worktrees', 'a');
    git('worktree', 'add', '-q', wt, '-b', 'track/a');
    // The worktree has its own .forge, as a coordinator that cd'ed into it would see.
    mkdirSync(path.join(wt, '.forge'), { recursive: true });
    writeFileSync(path.join(wt, '.forge', 'swarm.json'), readFileSync(path.join(root, '.forge', 'swarm.json'), 'utf8'));
    const inner: Io = { ...io, cwd: wt, git: defaultGit(wt), sleep: () => undefined };
    const r = (...a: string[]) => run(['swarm', ...a], inner);
    expect(r('tick', '--plan', 'plan.yaml', '--db', 'db', '--agents', 'agents.json')).toMatchObject({ code: 2, stderr: expect.stringContaining('main checkout') });
    expect(r('start', '--project', 'shop', '--session', 'main').code).toBe(2);
    expect(r('integrate', 'a', '--ref', 'track/a').code).toBe(2);
    expect(r('sleep', '5').code).toBe(2);
    expect(r('mark', 'a', '--status', 'launch-failed').code).toBe(2);
    expect(r('retry', 'a').code).toBe(2);
    expect(r('status').code).toBe(0);
    expect(r('stop').code).toBe(0);
  });
});
