import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, utimesSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanTree, indexTree, untrackedPaths, lockHash, cacheKey, envKey, readCached, writeCached, pruneCache, cacheDir, cacheable, runWithCache, type CachedResult, type CacheCtx } from '../src/forge/validate-cache.js';
import { defaultGit, repoReader } from '../src/forge/cli/run.js';
import type { Validator, ValidatorResult } from '../src/forge/validators.js';

let root: string;
const g = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const v = (name: string, kind = 'test', extra: Partial<Validator> = {}): Validator => ({ name, cmd: `${name}-cmd`, kind, source: 'manual', ...extra });
const pass = (x: Validator, ms = 30): ValidatorResult => ({ validator: x.name, ok: true, flaky: false, durationMs: ms, failures: [], failing: [], failingKnown: true });
const entry = (over: Partial<CachedResult> = {}): CachedResult => ({
  v: 1, name: 'unit', cmd: 'unit-cmd', ok: true, durationMs: 30, failing: [], failingKnown: true, failures: [], flaky: false, tree: 'a'.repeat(40), at: '2026-10-15T10:00:00.000Z', ...over,
});
const KEY = 'b'.repeat(64);
const ctx = (over: Partial<CacheCtx> = {}): CacheCtx => ({
  main: root, git: defaultGit(root), repo: repoReader(root), generated: [], read: true, write: true, now: () => new Date('2026-10-15T10:00:00.000Z'), ...over,
});

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'forge-vcache-'));
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
  mkdirSync(path.join(root, 'dist'));
  writeFileSync(path.join(root, 'a.txt'), 'a\n');
  writeFileSync(path.join(root, 'dist', 'bundle.js'), 'built\n');
  g('add', '-A'); g('commit', '-qm', 'init');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the tree a validator sees (C6)', () => {
  it('is HEAD^{tree} with nothing uncommitted; an untracked or a modified file makes it null', () => {
    expect(cleanTree(defaultGit(root), [])).toBe(g('rev-parse', 'HEAD^{tree}'));
    writeFileSync(path.join(root, 'new.txt'), 'n\n');
    expect(cleanTree(defaultGit(root), [])).toBeNull();
    rmSync(path.join(root, 'new.txt'));
    writeFileSync(path.join(root, 'a.txt'), 'changed\n');
    expect(cleanTree(defaultGit(root), [])).toBeNull();
  });
  it('a change in a generated path, or under .forge, .waypoint or .claude, does not count', () => {
    writeFileSync(path.join(root, 'dist', 'bundle.js'), 'rebuilt\n');
    expect(cleanTree(defaultGit(root), [])).toBeNull();
    expect(cleanTree(defaultGit(root), ['dist/**'])).toBe(g('rev-parse', 'HEAD^{tree}'));
    for (const d of ['.forge', '.waypoint', path.join('.claude', 'worktrees', 'x')]) {
      mkdirSync(path.join(root, d), { recursive: true });
      writeFileSync(path.join(root, d, 'f.json'), '{}');
    }
    expect(cleanTree(defaultGit(root), ['dist/**'])).toBe(g('rev-parse', 'HEAD^{tree}'));
  });
  it('is null outside a git repository', () => {
    const plain = mkdtempSync(path.join(tmpdir(), 'forge-vcache-plain-'));
    try { expect(cleanTree(defaultGit(plain), [])).toBeNull(); } finally { rmSync(plain, { recursive: true, force: true }); }
  });
  it('the index tree: the staged tree while the work tree matches the index and no untracked path appeared', () => {
    writeFileSync(path.join(root, 'a.txt'), 'merged\n');
    g('add', 'a.txt');
    const before = new Set(untrackedPaths(defaultGit(root)));
    const staged = g('write-tree');
    expect(staged).not.toBe(g('rev-parse', 'HEAD^{tree}'));
    expect(indexTree(defaultGit(root), [], before)).toBe(staged);
    writeFileSync(path.join(root, 'b.txt'), 'new\n');
    expect(indexTree(defaultGit(root), [], before)).toBeNull();
    expect(indexTree(defaultGit(root), [], new Set(untrackedPaths(defaultGit(root))))).toBe(staged);
    writeFileSync(path.join(root, 'a.txt'), 'edited after the merge\n');
    expect(indexTree(defaultGit(root), [], new Set(untrackedPaths(defaultGit(root))))).toBeNull();
  });
});

describe('the cache key and its entries (C6)', () => {
  it('the key changes with the tree, the command, the lockfiles and the environment', () => {
    const k = cacheKey('t', 'npm test', 'l', 'win32-22');
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    for (const other of [cacheKey('u', 'npm test', 'l', 'win32-22'), cacheKey('t', 'npm run test', 'l', 'win32-22'), cacheKey('t', 'npm test', 'm', 'win32-22'), cacheKey('t', 'npm test', 'l', 'linux-22')]) {
      expect(other).not.toBe(k);
    }
    expect(envKey('win32', '22.9.0')).toBe('win32-22');
  });
  it('lockHash is empty without lockfiles and follows their content', () => {
    expect(lockHash(repoReader(root))).toBe('');
    writeFileSync(path.join(root, 'package-lock.json'), '{"v":1}');
    const one = lockHash(repoReader(root));
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    writeFileSync(path.join(root, 'package-lock.json'), '{"v":2}');
    expect(lockHash(repoReader(root))).not.toBe(one);
  });
  it('an entry round-trips; a missing, corrupt, foreign or half-written one is a miss; a write that cannot happen is ignored', () => {
    writeCached(root, KEY, entry());
    expect(readCached(root, KEY)).toEqual(entry());
    expect(readCached(root, 'c'.repeat(64))).toBeNull();
    const file = path.join(cacheDir(root), `${KEY}.json`);
    for (const bad of ['{"v":1,"name":"unit"', JSON.stringify({ ...entry(), v: 2 }), JSON.stringify({ ...entry(), failing: 'x' }), '[]', 'null']) {
      writeFileSync(file, bad);
      expect(readCached(root, KEY), bad).toBeNull();
    }
    expect(readCached(root, '../escape')).toBeNull();
    // A main checkout that is a file: no directory can be made under it, and nothing throws.
    expect(() => writeCached(path.join(root, 'a.txt'), KEY, entry())).not.toThrow();
  });
  it('pruneCache keeps the newest entries by mtime', () => {
    const keys = ['1', '2', '3'].map(c => c.repeat(64));
    keys.forEach((k, i) => {
      writeCached(root, k, entry());
      const t = Date.UTC(2026, 9, 10 + i) / 1000;
      utimesSync(path.join(cacheDir(root), `${k}.json`), t, t);
    });
    pruneCache(root, 2);
    expect(readdirSync(cacheDir(root)).sort()).toEqual([`${keys[1]}.json`, `${keys[2]}.json`]);
  });
  it('what is cacheable: never bench, an e2e only with cache: true, nothing with cache: false', () => {
    expect([v('u', 'test'), v('l', 'lint'), v('t', 'typecheck'), v('b', 'build'), v('o', 'a11y')].map(cacheable)).toEqual([true, true, true, true, true]);
    expect([v('e', 'e2e'), v('e', 'e2e', { cache: true }), v('b', 'bench', { cache: true }), v('u', 'test', { cache: false })].map(cacheable)).toEqual([false, true, false, false]);
  });
});

describe('runWithCache (C6)', () => {
  const unit = v('unit'), lint = v('lint', 'lint');
  it('runs what the cache misses, keeps the list order, and the next call reads it with the original clock', () => {
    const calls: string[][] = [];
    const runner = (ms: number) => (misses: Validator[]) => { calls.push(misses.map(m => m.name)); return misses.map(m => pass(m, ms)); };
    expect(runWithCache([unit, lint], runner(30), ctx()).map(r => [r.validator, r.cached ?? false])).toEqual([['unit', false], ['lint', false]]);
    const again = runWithCache([lint, unit], runner(99), ctx());
    expect(calls).toEqual([['unit', 'lint']]);
    expect(again).toEqual([{ ...pass(lint, 30), cached: true }, { ...pass(unit, 30), cached: true }]);
  });
  it('never caches a timeout, an e2e without cache: true or a bench; an e2e with cache: true is cached', () => {
    const e2e = v('e2e', 'e2e'), kept = v('kept', 'e2e', { cache: true }), bench = v('bench', 'bench', { cache: true }), slow = v('slow');
    const runner = (misses: Validator[]) => misses.map(m => (m.name === 'slow' ? { ...pass(m), ok: false, failures: ['timeout after 600 s'], failingKnown: false } : pass(m)));
    runWithCache([e2e, kept, bench, slow], runner, ctx());
    const calls: string[] = [];
    runWithCache([e2e, kept, bench, slow], misses => { calls.push(...misses.map(m => m.name)); return runner(misses); }, ctx());
    expect(calls).toEqual(['e2e', 'bench', 'slow']);
  });
  it('a dirty tree is neither read nor written, and neither is a run that leaves the tree changed', () => {
    writeFileSync(path.join(root, 'new.txt'), 'n\n');
    runWithCache([unit], misses => misses.map(m => pass(m)), ctx());
    expect(existsSync(cacheDir(root))).toBe(false);
    rmSync(path.join(root, 'new.txt'));
    runWithCache([unit], misses => { writeFileSync(path.join(root, 'left.txt'), 'x'); return misses.map(m => pass(m)); }, ctx());
    expect(existsSync(cacheDir(root))).toBe(false);
  });
  it('read and write are separate (validate --final writes and never reads); an entry of another command is a miss', () => {
    let runs = 0;
    const runner = (misses: Validator[]) => { runs += misses.length; return misses.map(m => pass(m)); };
    runWithCache([unit], runner, ctx({ read: false }));
    runWithCache([unit], runner, ctx({ read: false }));
    expect(runs).toBe(2);
    runWithCache([unit], runner, ctx());
    expect(runs).toBe(2);
    runWithCache([unit], runner, ctx({ read: false, write: false }));
    expect(runs).toBe(3);
    const key = cacheKey(g('rev-parse', 'HEAD^{tree}'), lint.cmd, lockHash(repoReader(root)), envKey());
    writeCached(root, key, entry({ name: 'lint', cmd: 'other-cmd' }));
    runWithCache([lint], runner, ctx());
    expect(runs).toBe(4);
  });
});
