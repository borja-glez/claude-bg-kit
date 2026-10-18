// I-12: a worktree's setup (swarm.setup or its lockfile's install, node_modules and its memo, the union driver of the learned notes)
// and restoringRegenerated, which puts back the tracked files a validator run regenerated.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ExecResult } from '../run.js';
import { globMatch, type RepoReader } from '../../validators.js';
import { appendOnce, gitToplevel, hasLine, infoFile } from '../../../lib/git-info.js';
import { VENV_HINT } from '../../swarm.js';
import { loadTrustedConfig } from '../../trust.js';
import type { GitDeps, SwarmDeps } from './context.js';

export type SetupPlan = { cmd: string } | { cmd: null; hint: string } | null;
export type SetupResult = { cmd: string | null; ok: boolean; tail: string[] } | null;

/** What prepares a worktree: swarm.setup, else the install command of its lockfile, else npm for a bare package.json. */
export function setupFor(repo: RepoReader, configured: string | undefined): SetupPlan {
  if (configured) return { cmd: configured };
  if (repo.exists('.venv')) return { cmd: null, hint: VENV_HINT.en };
  if (repo.exists('package-lock.json') || repo.exists('npm-shrinkwrap.json')) return { cmd: 'npm ci' };
  if (repo.exists('pnpm-lock.yaml')) return { cmd: 'pnpm install --frozen-lockfile' };
  if (repo.exists('yarn.lock')) return { cmd: 'yarn install --frozen-lockfile' };
  if (repo.exists('bun.lock') || repo.exists('bun.lockb')) return { cmd: 'bun install --frozen-lockfile' };
  // No lockfile: an install that writes none, so no untracked lockfile appears in the worktree.
  if (repo.exists('package.json')) return { cmd: 'npm install --no-package-lock' };
  return null;
}

/** The setup's outcome: its last 20 output lines, a timeout said as the last one. */
function setupResult(cmd: string, r: ExecResult, timeoutSec: number): NonNullable<SetupResult> {
  const tail = r.output.split(/\r?\n/).filter(l => l.trim());
  if (r.timedOut) tail.push(`timeout after ${timeoutSec} s`);
  return { cmd, ok: r.code === 0 && !r.timedOut, tail: tail.slice(-20) };
}

/** Runs the setup in a worktree just created; a failure is reported, never thrown. */
export function runSetup(deps: SwarmDeps, dir: string, root: string): SetupResult {
  // I-03: swarm.setup runs only with the person's trust (it throws without it); denied: the lockfile's install.
  const config = loadTrustedConfig(root);
  // Lockfiles are read in the new worktree itself, never in the caller's. A .venv is untracked, so a fresh worktree
  // never has one: that hint looks at the main checkout.
  const wt = deps.at(dir).repo;
  const mainRepo = deps.at(root).repo;
  const repo: RepoReader = { ...wt, exists: rel => rel === '.venv' ? mainRepo.exists(rel) : wt.exists(rel) };
  const plan = setupFor(repo, config.swarm.setup);
  if (!plan) return null;
  if (plan.cmd === null) return { cmd: null, ok: false, tail: [plan.hint] };
  return setupResult(plan.cmd, deps.at(dir).exec(plan.cmd, config.validatorTimeoutSec), config.validatorTimeoutSec);
}

export const DEPS_DIR = 'node_modules';
// The manifests and lockfiles whose change in a merge means the dependencies are installed again.
export const DEP_FILES = [':(glob)**/package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock*'];
const MANIFESTS = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];
const LEARNED_UNION = '/.forge/verify/*.md merge=union';

/** The top level of the worktree `at` runs in; null when git cannot say. */
const toplevel = (at: GitDeps) => gitToplevel(at.git);

/** The directory `at` runs in: its top level plus the prefix git reports there. */
export function workdirOf(at: GitDeps): string | null {
  const [top, prefix] = (at.git(['rev-parse', '--show-toplevel', '--show-prefix']) ?? '').split(/\r?\n/).map(l => l.trim());
  return top ? path.join(top, prefix ?? '') : null;
}

/**
 * node_modules/ goes to info/exclude when nothing ignores it in `at` (a greenfield tree, or a rollback that took the
 * .gitignore away): once, shared by every worktree. A failure leaves it untracked, which the next status reports.
 */
export function excludeDeps(at: GitDeps): void {
  if (at.git(['check-ignore', '-q', DEPS_DIR]) !== null) return;
  try {
    const file = infoFile(at.git, 'exclude');
    if (file) appendOnce(file, `${DEPS_DIR}/`);
  } catch { /* reported as untracked by the next status */ }
}

/**
 * git's union driver for the surfaces (both sides' learned notes stay), in info/attributes: no commit. A merge attribute
 * the person already set for them (.gitattributes, info/attributes, their global file) is theirs: then nothing is
 * written and `skipped` names it.
 */
export function unionLearned(deps: GitDeps): { attributesError?: string; attributesSkipped?: string } {
  try {
    const top = toplevel(deps);
    const file = infoFile(deps.git, 'attributes');
    if (!top || !file) return { attributesError: 'cannot find the git directory' };
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (hasLine(text, LEARNED_UNION)) return {};
    // The surfaces there are now and a name none of them has: a rule for some of them, or for all of them.
    let names: string[] = [];
    try { names = readdirSync(path.join(top, '.forge', 'verify')).filter(f => f.endsWith('.md')).slice(0, 200); } catch { /* none yet */ }
    const attrs = deps.git(['-C', top, 'check-attr', 'merge', '--', ...[...names, 'forge-union-probe.md'].map(n => `.forge/verify/${n}`)]);
    if (attrs === null) return { attributesError: 'git check-attr failed' };
    const chosen = attrs.split(/\r?\n/).map(l => l.trim()).find(l => l && !l.endsWith(': merge: unspecified'));
    if (chosen) return { attributesSkipped: chosen };
    appendOnce(file, LEARNED_UNION);
    return {};
  } catch (e) { return { attributesError: (e as Error).message }; }
}

// Yarn Plug'n'Play installs without node_modules: its loader says the dependencies are there.
export const hasDeps = (at: GitDeps) => at.repo.exists(DEPS_DIR) || at.repo.exists('.pnp.cjs');
export const needsDeps = (at: GitDeps) => at.repo.exists('package.json') && !hasDeps(at);

/** What the root manifests and lockfiles say, as one hash. */
export function manifestHash(at: GitDeps): string {
  const h = createHash('sha1');
  for (const f of MANIFESTS) { const t = at.repo.read(f); if (t !== null) h.update(`${f}\0${t}\0`); }
  return h.digest('hex');
}

/** The install command for the package.json at the root of `at` (swarm.setup wins); null without one. */
export function depsCmd(at: GitDeps, configured: string | undefined): string | null {
  // A .venv says nothing about a node manifest: swarm.setup or the node lockfiles choose.
  const plan = setupFor({ ...at.repo, exists: rel => rel !== '.venv' && at.repo.exists(rel) }, configured);
  return plan && plan.cmd !== null ? plan.cmd : null;
}

/** Runs the install in `at`; a node_modules/ it creates is excluded when nothing ignores it. Reported, never thrown. */
export function runInstall(at: GitDeps, cmd: string, timeoutSec: number): { setup: NonNullable<SetupResult>; created: boolean } {
  const had = at.repo.exists(DEPS_DIR);
  const setup = setupResult(cmd, at.exec(cmd, timeoutSec), timeoutSec);
  const created = !had && at.repo.exists(DEPS_DIR);
  if (created) excludeDeps(at);
  return { setup, created };
}

// What forge last learned installing in one directory (.forge/execution/deps/<hash of the directory>.json): the
// manifests its last successful install was for, and whether that left dependencies (a manifest without any installs
// nothing, and is not installed again); lastFailed when its last install failed instead (what that left matches no
// manifests); and a failed install before a merge, with the HEAD it failed at.
export interface DepsMemo {
  ok?: { manifests: string; cmd: string; deps: boolean };
  lastFailed?: true;
  failed?: { head: string; manifests: string; cmd: string; setup: NonNullable<SetupResult> };
}
export const memoFile = (cacheDir: string, dir: string) => path.join(cacheDir, 'deps', `${createHash('sha1').update(path.resolve(dir)).digest('hex').slice(0, 16)}.json`);
export function readMemo(file: string): DepsMemo {
  try {
    const o = JSON.parse(readFileSync(file, 'utf8')) as DepsMemo;
    if (!o || typeof o !== 'object') return {};
    const s = o.failed?.setup;
    // A remembered failure is shown again: only a well-formed one.
    const failedOk = !!s && typeof s.cmd === 'string' && typeof s.ok === 'boolean' && Array.isArray(s.tail) && s.tail.every(l => typeof l === 'string');
    return { ...(o.ok ? { ok: o.ok } : {}), ...(o.lastFailed === true ? { lastFailed: true } : {}), ...(o.failed && failedOk ? { failed: o.failed } : {}) };
  } catch { return {}; }
}
export function writeMemo(file: string, m: DepsMemo): void {
  try { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(m)); } catch { /* only costs a rerun */ }
}

export const lastLine = (s: NonNullable<SetupResult>) => s.tail[s.tail.length - 1] ?? 'no output';

// A NUL-separated (-z) list of paths: git writes each name as it is, so a name it would quote (a quote, a backslash, a
// control character) stays the exact literal path.
export const nulList = (s: string | null) => (s ?? '').split('\0').filter(Boolean);

// Changed tracked files, forge's own state aside; paths from the top level.
export const trackedChanges = (at: Pick<GitDeps, 'git'>) => nulList(at.git(['diff', '--name-only', '-z', '--', '.', ...LOCAL_STATE]));

/**
 * Runs `fn` (a validator run) in one of forge's own worktrees, then puts back to their index state the tracked files it
 * modified or deleted that had no unstaged change right before it, and adds their paths to `into`. Untracked files
 * are never touched. With `only` (globs, the config's `generated`), only those of the paths that match one of them are
 * put back: how a checkout that is not forge's (the person's) is restored.
 */
export function restoringRegenerated<T>(at: Pick<GitDeps, 'git'>, fn: () => T, into: string[], only?: string[]): T {
  // Generated, tracked build output (a bundle a `build` validator rewrites) must not leave forge's run worktree dirty.
  const listed = at.git(['diff', '--name-only', '-z', '--', '.', ...LOCAL_STATE]);
  const before = new Set(nulList(listed));
  try { return fn(); } finally {
    // Without the "before" list, a change of someone's could not be told from the validators': nothing is restored.
    const back = listed === null ? [] : trackedChanges(at).filter(p => !before.has(p) && (!only || only.some(g => globMatch(g, p))));
    if (back.length && at.git(['checkout', '--', ...back.map(p => `:(top,literal)${p}`)]) !== null) into.push(...back);
  }
}

export const LOCAL_STATE = [':!.forge', ':!.waypoint', ':!.claude'];
