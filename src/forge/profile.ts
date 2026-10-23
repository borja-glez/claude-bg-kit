// An autonomous profile's branch and worktree (6b-2, spec «Rama y worktree»): `infinite prepare` creates or reuses
// forge/<profile>-<name> in .claude/worktrees/<profile>-<name>, from the branch of the first start, which start.json keeps;
// `infinite start --profile` reads them back into the autonomous block of run.json. The main checkout, its files and its
// branch are never touched: git runs at the main checkout with `-C <dir>` for the checkout it asks about.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PROFILES, isAutonomousName, type AutonomousRun, type Profile } from '../lib/forge-run.js';
import { excludeWorktrees } from '../lib/git-info.js';
import { samePath } from '../lib/worktree.js';
import { UsageError } from './cli/errors.js';
import { defaultGit } from './cli/exec.js';
import { forgeDir } from './ledger.js';
import { autonomousDir } from './resources.js';
import { runMainsOf } from './autonomous.js';
import { confinedIn, isInside } from './guard.js';
import { parseRun, readRunText } from './run.js';

export function profileNames(main: string, profile: Profile, name: string): { runId: string; branch: string; worktree: string } {
  const runId = `${profile}-${name}`;
  return { runId, branch: `forge/${runId}`, worktree: path.join(main, '.claude', 'worktrees', runId) };
}

/** Where prepare keeps the branch a profile started from, `{ startBranch, defaultBranch, at }`, written once. */
export const startFile = (main: string, runId: string): string => path.join(autonomousDir(main, runId), 'start.json');

export interface StartRecord { startBranch: string; defaultBranch: string | null; at: string }

/** start.json as prepare wrote it; null when there is none. One that does not hold a record is refused: a start branch is never guessed. */
export function readStart(main: string, runId: string): StartRecord | null {
  const file = startFile(main, runId);
  if (!existsSync(file)) return null;
  let o: Partial<Record<keyof StartRecord, unknown>> | null = null;
  try { o = JSON.parse(readFileSync(file, 'utf8')); } catch { o = null; }
  if (!o || typeof o !== 'object' || typeof o.startBranch !== 'string' || o.startBranch === '' || typeof o.at !== 'string'
    || (o.defaultBranch !== null && typeof o.defaultBranch !== 'string')) {
    throw new UsageError(`${file} does not hold { startBranch, defaultBranch, at }; fix it, or remove it so the next prepare records the current branch`);
  }
  return { startBranch: o.startBranch, defaultBranch: o.defaultBranch as string | null, at: o.at };
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

/** The checkouts of `git worktree list --porcelain`: each one's path and the branch it holds (null when detached). */
function checkoutsOf(porcelain: string | null): { dir: string; branch: string | null }[] {
  const out: { dir: string; branch: string | null }[] = [];
  for (const line of (porcelain ?? '').split(/\r?\n/)) {
    if (line.startsWith('worktree ')) out.push({ dir: line.slice('worktree '.length).trim(), branch: null });
    else if (line.startsWith('branch refs/heads/') && out.length > 0) out[out.length - 1].branch = line.slice('branch refs/heads/'.length);
  }
  return out;
}

/**
 * Creates or reuses the profile's branch and worktree. The start branch is start.json's when there is one, else the branch
 * `cwd` is on. Each refusal is a UsageError and touches nothing: every check comes first, then info/exclude, the worktree
 * and, last, start.json (L-5).
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
  const checkouts = checkoutsOf(git(['worktree', 'list', '--porcelain']));
  const exists = existsSync(worktree);
  if (exists) {
    const on = checkouts.find(c => samePath(c.dir, worktree));
    if (on?.branch !== branch) {
      const what = on ? `on ${on.branch ?? 'a detached HEAD'}` : 'and is no worktree of this repository';
      throw new UsageError(`infinite prepare: ${worktree} exists ${what}, not on ${branch}; remove it or choose another --name`);
    }
  } else {
    // A checkout whose folder is gone is not in the way: the prune below forgets it.
    const holder = checkouts.find(c => c.branch === branch && existsSync(c.dir));
    if (holder) throw new UsageError(`infinite prepare: ${branch} is checked out in ${holder.dir}; switch that checkout to another branch first`);
  }
  const hasBranch = git(['rev-parse', '--verify', '-q', `refs/heads/${branch}`]) !== null;
  excludeWorktrees(git);
  if (!exists) {
    // A worktree folder deleted by hand stays registered, and git worktree add refuses its path until it is pruned.
    git(['worktree', 'prune']);
    const added = hasBranch ? git(['worktree', 'add', worktree, branch]) : git(['worktree', 'add', '-b', branch, worktree, startBranch]);
    if (added === null) throw new UsageError(`infinite prepare: git could not add the worktree ${worktree} on ${branch}`);
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
