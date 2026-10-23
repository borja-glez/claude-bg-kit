// An autonomous profile's branch and worktree (6b-2, spec «Rama y worktree»): `infinite prepare` creates or reuses
// forge/<profile>-<name> in .claude/worktrees/<profile>-<name>, from the branch of the first start, which start.json keeps;
// `infinite start --profile` reads them back into the autonomous block of run.json. The main checkout, its files and its
// branch are never touched: git runs at the main checkout with `-C <dir>` for the checkout it asks about.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PROFILES, isAutonomousName, type AutonomousRun, type Profile } from '../lib/forge-run.js';
import { excludeWorktrees } from '../lib/git-info.js';
import { BRANCH_RE, samePath } from '../lib/worktree.js';
import { UsageError } from './cli/errors.js';
import { defaultGit } from './cli/exec.js';
import { forgeDir } from './ledger.js';
import { autonomousDir } from './resources.js';
import { runMainsOf } from './autonomous.js';
import { confinedIn, isInside } from './guard.js';
import { parseRun, readRunText, runFile, type RunState } from './run.js';

export function profileNames(main: string, profile: Profile, name: string): { runId: string; branch: string; worktree: string } {
  const runId = `${profile}-${name}`;
  return { runId, branch: `forge/${runId}`, worktree: path.join(main, '.claude', 'worktrees', runId) };
}

/** Where prepare keeps the branch a profile started from, `{ startBranch, defaultBranch, at }`, written once. */
export const startFile = (main: string, runId: string): string => path.join(autonomousDir(main, runId), 'start.json');

export interface StartRecord { startBranch: string; defaultBranch: string | null; at: string }

/**
 * start.json as prepare wrote it; null when there is none. One that does not hold a record, or whose start branch BRANCH_RE
 * refuses (m-5: it reaches git as an argument), is refused: a start branch is never guessed.
 */
export function readStart(main: string, runId: string): StartRecord | null {
  const file = startFile(main, runId);
  if (!existsSync(file)) return null;
  let o: Partial<Record<keyof StartRecord, unknown>> | null = null;
  try { o = JSON.parse(readFileSync(file, 'utf8')); } catch { o = null; }
  if (!o || typeof o !== 'object' || typeof o.startBranch !== 'string' || !BRANCH_RE.test(o.startBranch) || typeof o.at !== 'string'
    || (o.defaultBranch !== null && typeof o.defaultBranch !== 'string')) {
    throw new UsageError(`${file} does not hold { startBranch, defaultBranch, at } with a start branch of letters, digits and _ - . / ~ : @ +; `
      + 'fix it, or remove it so the next prepare records the current branch');
  }
  return { startBranch: o.startBranch, defaultBranch: o.defaultBranch as string | null, at: o.at };
}

/**
 * m-3: run.json's run, null when there is none. A run.json that is there and does not read or parse is refused, naming the
 * file: the guard holds its sessions closed, and a profile replacing it would free them.
 */
export function readableRun(root: string, cmd: string): RunState | null {
  const run = parseRun(readRunText(root));
  if (run === null && existsSync(runFile(root))) {
    throw new UsageError(`${cmd}: ${runFile(root)} does not read as a run, and the guard keeps its sessions closed; fix it or remove it from a conversation outside the run`);
  }
  return run;
}

/** The branches a profile never touches: the start branch, main and the repository's default branch, once each, in that order. */
export function protectedBranchesOf(startBranch: string, defaultBranch: string | null): string[] {
  return [startBranch, 'main', defaultBranch].filter((b, i, all): b is string => b !== null && all.indexOf(b) === i);
}

/** --profile and --name as `cmd` got them: a profile of PROFILES and a name isAutonomousName takes (M-5); a UsageError otherwise. */
export function profileArgs(cmd: string, profile: unknown, name: unknown): { profile: Profile; name: string } {
  if (!PROFILES.includes(profile as Profile)) throw new UsageError(`${cmd}: --profile must be ${PROFILES.join(' or ')}`);
  if (!isAutonomousName(name)) throw new UsageError(`${cmd}: --name must be lowercase letters and digits joined by single hyphens, 40 characters at most`);
  return { profile: profile as Profile, name };
}

interface Checkout { dir: string; branch: string | null; locked: boolean }

/** The checkouts of `git worktree list --porcelain`: each one's path, the branch it holds (null when detached) and whether it is locked. */
function checkoutsOf(porcelain: string | null): Checkout[] {
  const out: Checkout[] = [];
  for (const line of (porcelain ?? '').split(/\r?\n/)) {
    const last = out[out.length - 1];
    if (line.startsWith('worktree ')) out.push({ dir: line.slice('worktree '.length).trim(), branch: null, locked: false });
    else if (line.startsWith('branch refs/heads/') && last) last.branch = line.slice('branch refs/heads/'.length);
    else if ((line === 'locked' || line.startsWith('locked ')) && last) last.locked = true;
  }
  return out;
}

/**
 * Creates or reuses the profile's branch and worktree. The start branch is start.json's when there is one, else the branch
 * `cwd` is on. Each refusal is a UsageError that names its cause and touches nothing: every check comes first (m-1), then
 * info/exclude, the clearing of the profile's own stale entry, the worktree and, last, start.json (L-5).
 */
export function prepareProfile(main: string, cwd: string, profile: Profile, name: string, at: string): { runId: string; worktree: string; branch: string; startBranch: string; created: boolean } {
  const args = profileArgs('infinite prepare', profile, name);
  const { runId, branch, worktree } = profileNames(main, args.profile, args.name);
  const git = defaultGit(main);
  const recorded = readStart(main, runId);
  const startBranch = recorded?.startBranch ?? git(['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
  if (!startBranch) throw new UsageError(`infinite prepare: git cannot say which branch ${cwd} is on`);
  if (startBranch === 'HEAD') throw new UsageError('infinite prepare: the checkout is detached (HEAD); switch to the branch the profile should start from');
  if (startBranch === branch) throw new UsageError(`infinite prepare: ${branch} is the profile's own branch; run this from the branch it should start from`);
  // m-5: the rule readStart applies to start.json, so prepare never records a start branch the next prepare refuses.
  if (!BRANCH_RE.test(startBranch)) throw new UsageError(`infinite prepare: the start branch ${startBranch} is outside forge's branch rule (letters, digits and _ - . / ~ : @ +)`);
  const checkouts = checkoutsOf(git(['worktree', 'list', '--porcelain']));
  const exists = existsSync(worktree);
  const own = checkouts.find(c => samePath(c.dir, worktree));
  if (exists && own?.branch !== branch) {
    const what = own ? `on ${own.branch ?? 'a detached HEAD'}` : 'and is no worktree of this repository';
    throw new UsageError(`infinite prepare: ${worktree} exists ${what}, not on ${branch}; remove it or choose another --name`);
  }
  // L-5-AMEND: the profile's own entry whose folder is gone is cleared below; no other entry of the repository is touched.
  const stale = exists ? null : own ?? null;
  if (stale?.locked) {
    throw new UsageError(`infinite prepare: ${worktree} is registered and locked, but its folder is missing; bring the folder back, or unlock it (git worktree unlock) and run this again`);
  }
  // n-1: an entry on another branch is someone's work whose folder may only have moved; clearing it would wire that folder to this worktree.
  if (stale && stale.branch !== null && stale.branch !== branch) {
    throw new UsageError(`infinite prepare: ${worktree} is registered on ${stale.branch}, not ${branch}, and its folder is missing; `
      + 'bring the folder back (git worktree repair), or remove that entry (git worktree remove --force) if it is gone for good');
  }
  const holder = exists ? null : checkouts.find(c => c.branch === branch && !samePath(c.dir, worktree));
  if (holder && existsSync(holder.dir)) throw new UsageError(`infinite prepare: ${branch} is checked out in ${holder.dir}; switch that checkout to another branch first`);
  if (holder) {
    throw new UsageError(`infinite prepare: ${branch} is held by the worktree ${holder.dir}, whose folder is missing; bring it back, or remove that entry (git worktree remove --force)`);
  }
  const hasBranch = git(['rev-parse', '--verify', '-q', `refs/heads/${branch}`]) !== null;
  if (!exists && !hasBranch && git(['rev-parse', '--verify', '-q', `${startBranch}^{commit}`]) === null) {
    throw new UsageError(`infinite prepare: the start branch ${startBranch} no longer exists, and neither does ${branch}; restore one of them, or remove ${startFile(main, runId)}`);
  }
  excludeWorktrees(git);
  if (stale && git(['worktree', 'remove', '--force', worktree]) === null) {
    throw new UsageError(`infinite prepare: git could not clear the entry of ${worktree}, whose folder is missing (git worktree remove --force)`);
  }
  if (!exists) {
    const added = hasBranch ? git(['worktree', 'add', worktree, branch]) : git(['worktree', 'add', '-b', branch, worktree, startBranch]);
    if (added === null) throw new UsageError(`infinite prepare: git could not add the worktree ${worktree} on ${branch}${hasBranch ? '' : ` from ${startBranch}`}`);
  }
  if (!recorded) {
    const defaultBranch = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.trim().replace(/^origin\//, '') || null;
    forgeDir(main);
    mkdirSync(autonomousDir(main, runId), { recursive: true });
    writeFileSync(startFile(main, runId), JSON.stringify({ startBranch, defaultBranch, at }, null, 2) + '\n');
  }
  return { runId, worktree, branch, startBranch, created: !exists };
}

/**
 * The autonomous block `infinite start --profile` writes, once its checks pass: prepare recorded the start branch, and `cwd`
 * is inside the profile's worktree (confinedIn, H-2: a spelling never folds toward inside) with HEAD on its branch.
 */
export function profileBlock(main: string, cwd: string, profile: Profile, name: string): AutonomousRun {
  const { runId, branch, worktree } = profileNames(main, profile, name);
  const recorded = readStart(main, runId);
  if (!recorded) throw new UsageError(`infinite start: ${runId} has no start branch recorded; run infinite prepare --profile ${profile} --name ${name} first`);
  if (!confinedIn(cwd, worktree)) {
    throw new UsageError(`infinite start: --profile ${profile} --name ${name} starts only from its worktree, ${worktree}; enter it (EnterWorktree with that path) and run this again`);
  }
  const on = defaultGit(main)(['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
  if (on !== branch) throw new UsageError(`infinite start: ${worktree} is on ${on || 'no branch git can name'}, not ${branch}; switch it back to ${branch}`);
  return { profile, name, runId, worktree, branch, startBranch: recorded.startBranch, protectedBranches: protectedBranchesOf(recorded.startBranch, recorded.defaultBranch) };
}

/** T6B2-NO-EXECUTION: why `swarm start` does not run inside a profile in this version. */
export const NO_EXECUTION = 'an execution inside an autonomous profile comes in a later version; run one task per cycle';

/**
 * The active autonomous run whose worktree holds `cwd`, found as the guard finds it (runMainsOf, no git); null when none.
 * isInside, not confinedIn: this answer refuses, so a spelling of the worktree counts as inside it.
 */
export function activeProfileAt(cwd: string): AutonomousRun | null {
  for (const main of runMainsOf([cwd])) {
    const run = parseRun(readRunText(main));
    if (run?.active && run.autonomous && isInside(cwd, run.autonomous.worktree)) return run.autonomous;
  }
  return null;
}
