// The validation cache by tree (C6): a validator's result is kept under the tree it ran on, its resolved command, the
// lockfiles and the platform, so the same tree is never validated twice (prep's baseline, review-prep, validate and
// swarm integrate share it). It lives in the main checkout, shared by every worktree: the key never depends on a path.
// A missing, broken or foreign entry is a miss and a failed write is ignored: the cache never fails a validation.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from './ledger.js';
import type { RepoReader, Validator, ValidatorResult } from './validators.js';

export type Git = (args: string[]) => string | null;
export interface CachedResult {
  v: 1; name: string; cmd: string; ok: boolean; durationMs: number;
  failing: string[]; failingKnown: boolean; failures: string[]; flaky: boolean; skipped?: 'no-tests';
  tree: string; at: string;
}
export interface CacheCtx {
  /** The main checkout: it holds .forge/cache/validate. */
  main: string;
  /** git in the checkout being validated, and its files (the lockfiles are read from there). */
  git: Git; repo: RepoReader;
  /** The config's generated globs: their changes do not make a tree dirty. */
  generated: string[];
  read: boolean; write: boolean;
  /** The tree the validators see: cleanTree(git, generated) by default (swarm integrate passes the index's). */
  tree?: () => string | null;
  now: () => Date;
  /** `<platform>-<node major>`: envKey() by default. */
  env?: string;
}

export const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'Cargo.lock', 'go.sum', 'poetry.lock', 'uv.lock', 'Pipfile.lock', 'packages.lock.json'];
export const MAX_ENTRIES = 500;
// forge's, waypoint's and Claude Code's own state (task worktrees live under .claude/worktrees), as LOCAL_STATE in cli/swarm.ts.
const LOCAL_STATE = [':(exclude).forge', ':(exclude).waypoint', ':(exclude).claude'];
const OBJECT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const KEY = /^[0-9a-f]{64}$/;

export const cacheDir = (main: string) => path.join(main, '.forge', 'cache', 'validate');
const excludes = (generated: string[]) => [...LOCAL_STATE, ...generated.map(g => `:(exclude,glob)${g}`)];

/** HEAD's tree when nothing is uncommitted (untracked files included; generated paths and local state aside), else null. */
export function cleanTree(git: Git, generated: string[]): string | null {
  const status = git(['status', '--porcelain', '-z', '--untracked-files=normal', '--', '.', ...excludes(generated)]);
  if (status !== '') return null;
  const tree = git(['rev-parse', 'HEAD^{tree}'])?.trim() ?? '';
  return OBJECT.test(tree) ? tree : null;
}

/** The untracked paths git does not ignore, local state aside (a directory collapsed into `dir/`). */
export function untrackedPaths(git: Git): string[] {
  return (git(['ls-files', '-z', '--others', '--exclude-standard', '--directory', '--', '.', ...LOCAL_STATE]) ?? '').split('\0').filter(Boolean);
}

/**
 * The index's tree during a merge (`git merge --no-commit`): `git write-tree`, only while the work tree matches the
 * index (generated paths and local state aside) and no untracked path appeared since `untrackedBefore`; else null.
 */
export function indexTree(git: Git, generated: string[], untrackedBefore: ReadonlySet<string>): string | null {
  if (git(['diff', '--quiet', '--', '.', ...excludes(generated)]) === null) return null;
  if (untrackedPaths(git).some(p => !untrackedBefore.has(p))) return null;
  const tree = git(['write-tree'])?.trim() ?? '';
  return OBJECT.test(tree) ? tree : null;
}

/** sha256 of the lockfiles present (name and content), '' with none. */
export function lockHash(repo: RepoReader): string {
  const hash = createHash('sha256');
  let any = false;
  for (const f of LOCKFILES) {
    const text = repo.read(f);
    if (text === null) continue;
    any = true;
    hash.update(f).update('\0').update(text).update('\0');
  }
  return any ? hash.digest('hex') : '';
}

export const envKey = (platform: string = process.platform, version: string = process.versions.node): string => `${platform}-${version.split('.')[0]}`;

/** The key of one validator's result: sha256 of the tree, its resolved command, the lockfiles' hash and the environment. */
export function cacheKey(tree: string, cmd: string, lock: string, env: string): string {
  return createHash('sha256').update([tree, cmd, lock, env].join('\0')).digest('hex');
}

const strings = (a: unknown) => Array.isArray(a) && a.every(s => typeof s === 'string');

export function readCached(main: string, key: string): CachedResult | null {
  if (!KEY.test(key)) return null;
  let x: unknown;
  try { x = JSON.parse(readFileSync(path.join(cacheDir(main), `${key}.json`), 'utf8')); } catch { return null; }
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  if (r.v !== 1 || typeof r.name !== 'string' || typeof r.cmd !== 'string' || typeof r.ok !== 'boolean' || typeof r.durationMs !== 'number'
    || !strings(r.failing) || typeof r.failingKnown !== 'boolean' || !strings(r.failures) || typeof r.flaky !== 'boolean'
    || typeof r.tree !== 'string' || typeof r.at !== 'string' || (r.skipped !== undefined && r.skipped !== 'no-tests')) return null;
  return r as unknown as CachedResult;
}

/** Writes an entry through a temporary file and a rename; any failure is ignored (a missing entry only costs a run). */
export function writeCached(main: string, key: string, r: CachedResult): void {
  if (!KEY.test(key)) return;
  const file = path.join(cacheDir(main), `${key}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    forgeDir(main);
    mkdirSync(cacheDir(main), { recursive: true });
    writeFileSync(tmp, JSON.stringify(r) + '\n');
    renameSync(tmp, file);
  } catch {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
  }
}

/** Keeps the `max` newest entries (by mtime). */
export function pruneCache(main: string, max = MAX_ENTRIES): void {
  const dir = cacheDir(main);
  let files: { f: string; t: number }[];
  try { files = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => ({ f, t: statSync(path.join(dir, f)).mtimeMs })); } catch { return; }
  if (files.length <= max) return;
  files.sort((a, b) => a.t - b.t);
  for (const { f } of files.slice(0, files.length - max)) { try { rmSync(path.join(dir, f), { force: true }); } catch { /* ignore */ } }
}

/** Never bench (it measures the machine); an e2e only with `cache: true` (it may depend on services); nothing with `cache: false`. */
export const cacheable = (v: Validator): boolean => v.cache !== false && v.kind !== 'bench' && (v.kind !== 'e2e' || v.cache === true);
const timedOut = (r: ValidatorResult) => r.failures.some(f => /^timeout after \d+ s$/.test(f));

const fromCached = (c: CachedResult): ValidatorResult => ({
  validator: c.name, ok: c.ok, flaky: c.flaky, durationMs: c.durationMs, failures: c.failures, failing: c.failing, failingKnown: c.failingKnown,
  ...(c.skipped ? { skipped: c.skipped } : {}), cached: true,
});
const toCached = (v: Validator, r: ValidatorResult, tree: string, at: string): CachedResult => ({
  v: 1, name: v.name, cmd: v.cmd, ok: r.ok, durationMs: r.durationMs, failing: r.failing ?? [], failingKnown: r.failingKnown ?? false,
  failures: r.failures, flaky: r.flaky, ...(r.skipped === 'no-tests' ? { skipped: 'no-tests' as const } : {}), tree, at,
});

/**
 * Runs `list` through the cache: each cacheable validator found under the current tree comes back with `cached: true`
 * and the clock of the run that produced it; the rest go to `run` (in the list's order) and, when the tree is still
 * the same after it, every cacheable result that is not a timeout is written. A dirty tree is neither read nor written.
 * The results keep the list's order and are raw: no baseline marks (markPreexisting runs on them after).
 */
export function runWithCache(list: Validator[], run: (misses: Validator[]) => ValidatorResult[], ctx: CacheCtx): ValidatorResult[] {
  const treeOf = ctx.tree ?? (() => cleanTree(ctx.git, ctx.generated));
  const tree = ctx.read || ctx.write ? treeOf() : null;
  if (tree === null) return run(list);
  const lock = lockHash(ctx.repo);
  const env = ctx.env ?? envKey();
  const keyOf = (v: Validator) => cacheKey(tree, v.cmd, lock, env);
  const hits = new Map<number, ValidatorResult>();
  if (ctx.read) {
    list.forEach((v, i) => {
      if (!cacheable(v)) return;
      const c = readCached(ctx.main, keyOf(v));
      if (c && c.name === v.name && c.cmd === v.cmd) hits.set(i, fromCached(c));
    });
  }
  const misses = list.filter((_, i) => !hits.has(i));
  const fresh = misses.length ? run(misses) : [];
  if (ctx.write && fresh.length && treeOf() === tree) {
    const at = ctx.now().toISOString();
    misses.forEach((v, k) => {
      const r = fresh[k];
      if (r && cacheable(v) && !timedOut(r)) writeCached(ctx.main, keyOf(v), toCached(v, r, tree, at));
    });
    pruneCache(ctx.main);
  }
  let k = 0;
  return list.map((_, i) => hits.get(i) ?? fresh[k++]);
}
