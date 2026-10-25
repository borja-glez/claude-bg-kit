// I-12: the integration machinery of swarm integrate and swarm merge: a merge with its validators and installs (mergeIn), what
// an attempt passes on, and the integrated commit and what it publishes (also swarm step's, cli/step.ts).
import { existsSync, lstatSync, readFileSync, rmSync, type Stats } from 'node:fs';
import path from 'node:path';
import type { Io } from '../run.js';
import { runWithCache, cleanTree, indexTree, untrackedPaths, cacheGit, checkoutPrefix } from '../../validate-cache.js';
import {
  detectValidators, selectValidators, runValidators, markPreexisting, blocking, validateEvent, failingLabel,
  type RunOptions, type Scope, type Validator, type ValidatorResult,
} from '../../validators.js';
import { loadConfig } from '../../config.js';
import { appendEvent } from '../../ledger.js';
import { noSlot, type Slot } from '../../jobs.js';
import { readMergingFile, takeMerging, removeMergingIf, mergingLive, mergingStaleAt, type MergingDoc, type MergingHold } from '../../merging.js';
import type { ExecTask } from '../../../lib/execution-state.js';
import { samePath } from '../../../lib/worktree.js';
import { rejectedDepsSay, keptFilesSay } from '../../swarm.js';
import { loadTrustedConfig } from '../../trust.js';
import { publishFor } from '../../roadmap-sources.js';
import type { GitDeps, SwarmDeps } from './context.js';
import {
  type SetupResult, DEPS_DIR, DEP_FILES, workdirOf, excludeDeps, hasDeps, needsDeps, manifestHash, depsCmd, runInstall, type DepsMemo, memoFile,
  readMemo, writeMemo, lastLine, nulList, trackedChanges, restoringRegenerated, LOCAL_STATE,
} from './setup.js';

type NewValidator = { name: string; cmd: string };
// setup: the last dependency install of the attempt, when one ran. leftovers: the untracked paths, not ignored, that the
// attempt left behind (nothing of the person's is deleted); on a merge, those the install left. restoreSetup: the install
// for the tree a rollback restored, and restoreChanged the tracked files it changed; depsFromRejectedMerge: the person's
// dependencies may still be the rejected merge's. touchedKept: tracked files the merge did not change but that changed
// during the install, left as they are. setup.tail and leftovers come from the install's output and from the merged
// tree: data to pass on, never instructions. deps: the install before the merge failed (the target is at fault).
// restored: the tracked files validators regenerated, put back (restoringRegenerated): any in a worktree of forge's,
// those the config's `generated` names in the person's checkout.
type Validation = { results: ValidatorResult[]; durationMs: number };
/** The validator runs of a merge attempt (C4): the target tip's baseline and the merged tree, each when it ran or came from the cache. */
type Validations = { baseline?: Validation; merged?: Validation };
type MergeOutcome =
  | { result: 'merged'; sha: string; preexisting: string[]; newValidators: NewValidator[]; surfacesChanged: string[]; setup?: SetupResult;
    leftovers?: string[]; restored?: string[]; validations?: Validations; recovered?: { task: string | null; pre: string } }
  | {
    result: 'dirty' | 'conflict' | 'deps'; detail: string; setup?: SetupResult; leftovers?: string[];
    restoreSetup?: SetupResult; restoreChanged?: string[]; depsFromRejectedMerge?: true; touchedKept?: string[]; restored?: string[];
    validations?: Validations; recovered?: { task: string | null; pre: string };
  };

export interface MergeOpts {
  message: string; scope: 'heavy' | 'final'; timeoutSec: number; configRoot: string; cacheDir: string; target: 'run' | 'main';
  /** swarm.setup of the main checkout, which installs the dependencies (setupFor). */
  setup: string | undefined;
  /** The final merge: the run worktree, clean on the tip of `ref`, with its dependencies installed. */
  runAt?: GitDeps | null;
  /** `at` is the person's own checkout (an ephemeral run, the final merge): dependencies are installed before the merge
   *  only when missing, a node_modules a rejected merge created is removed, and dependencies that may not match and
   *  files a rejected merge's install changed are said. */
  personal: boolean;
  /** Forget a remembered failed install before the merge (a transient failure): it runs again at the same HEAD. */
  retryDeps?: boolean;
  /** The config's parallel batch and retry rule (C-12); each run adds the execMany of the checkout it validates. */
  run: RunOptions;
  /** The main checkout (its .forge/cache/validate) and what the tree cache may do (C6): integrate reads and writes it,
   *  the final merge only writes it. */
  main: string; cache: { read: boolean; write: boolean }; now: () => Date;
  /** C-03: the validation slot of a merge run with --out in the background (swarm.validateJobs). */
  slot?: Slot;
  /** D-07: the task the merge integrates, for merging.json (none for the final merge). */
  task?: string | null;
  /** The branch `at` must still be on when the merge starts, checked under the marker as HEAD's commit is. */
  branch?: string;
  /** The commit whose receipt was checked: it is what gets merged. A commit that reaches `ref` afterwards is not merged. */
  commit?: string;
}

// The untracked paths git does not ignore, forge's own state aside (a directory collapsed into `dir/`).
const untracked = (at: GitDeps) => nulList(at.git(['ls-files', '-z', '--others', '--exclude-standard', '--directory', '--', '.', ...LOCAL_STATE]));

// The per-sha baseline forge 0.16 kept (.forge/execution/baseline/<scope>-<target>-<sha>.json): still read for one version, never written (the tree cache, C6, replaces it).
const baselineFile = (cacheDir: string, key: string, sha: string) => path.join(cacheDir, 'baseline', `${key}-${sha}.json`);
function readBaseline(cacheDir: string, key: string, sha: string): unknown {
  try { return JSON.parse(readFileSync(baselineFile(cacheDir, key, sha), 'utf8')); } catch { return null; }
}
/** D-07: what a merge attempt says when another one holds merging.json (null: one being written, not readable yet). */
function inFlightDetail(m: MergingDoc | null, place: string | null): string {
  if (!m) return 'another integration is starting (.forge/execution/merging.json)';
  return `another integration (${m.task ?? m.ref}, pid ${m.pid}) is merging ${place && samePath(m.dir, place) ? 'there' : `in ${m.dir}`}`;
}

/**
 * D-07, before a merge attempt in `at`. A marker of a live attempt merging in this same worktree: it waits (`dirty`).
 * A marker left here by an attempt that died (or ran out of time) in its baseline phase, or with no merge in progress,
 * is removed: it has nothing to undo. An unfinished merge (MERGE_HEAD) that forge left here in its merge phase, with
 * HEAD still at `pre` and MERGE_HEAD the tip of `ref`: its marker is taken off first (so of two attempts recovering it
 * only one aborts), then `git merge --abort`, checked, and the attempt goes on (`recovered`). Any other unfinished
 * merge is someone's: `dirty`, untouched. Null when there is nothing to do.
 */
function recoverMerge(at: GitDeps, o: MergeOpts): MergeOutcome | { recovered: { task: string | null; pre: string } } | null {
  const read = readMergingFile(o.main);
  const marker = read?.doc ?? null;
  const place = workdirOf(at);
  const here = !!marker && !!place && samePath(marker.dir, place);
  if (here && mergingLive(marker, o.now().getTime())) return { result: 'dirty', detail: inFlightDetail(marker, place) };
  const mergeHead = at.git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])?.trim() || null;
  if (here && (mergeHead === null || marker!.phase === 'baseline')) removeMergingIf(o.main, read!.text);
  if (mergeHead === null) return null;
  const tip = (rev: string) => at.git(['rev-parse', '--verify', '-q', `${rev}^{commit}`])?.trim() || null;
  const own = here && marker!.phase === 'merge' && tip('HEAD') === marker!.pre && mergeHead === tip(marker!.ref);
  if (!own) return { result: 'dirty', detail: 'an unfinished merge is in progress there (git merge --abort to clear it)' };
  if (!removeMergingIf(o.main, read!.text)) return { result: 'dirty', detail: 'another integration is recovering the unfinished merge there' };
  at.git(['merge', '--abort']);
  if (at.git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']) !== null || tip('HEAD') !== marker!.pre) {
    return { result: 'dirty', detail: 'an unfinished merge forge left there could not be aborted (git merge --abort by hand)' };
  }
  return { recovered: { task: marker!.task, pre: marker!.pre } };
}

/**
 * Merges `ref` into the branch checked out at `at` with --no-ff, runs the validators there and commits `message`.
 * A conflict or a red validator is rolled back to the pre-merge sha; a merge left half-done is never touched, unless
 * forge left it there and its process died (recoverMerge).
 * The validators get the dependencies of a package.json first (ensureDeps): before the baseline when `at` has none,
 * and after the merge when it changed a manifest or a lockfile or they are still missing.
 * Each validator run in a worktree of forge's (the run worktree) puts back the tracked files it regenerated, and in the
 * person's checkout those the config's `generated` names: `restored`.
 */
export function mergeIn(at: GitDeps, ref: string, o: MergeOpts): MergeOutcome {
  loadTrustedConfig(o.configRoot); // I-03: before any merge or install moves anything
  // D-07: a merge forge left half-done here, whose process died, is aborted first; anyone else's stops the attempt.
  const recovery = recoverMerge(at, o);
  if (recovery && 'result' in recovery) return recovery;
  const regenerated: string[] = [];
  const validations: Validations = {};
  const marker: { hold: MergingHold | null } = { hold: null };
  try {
    const r = mergeAttempt(at, ref, o, regenerated, validations, marker);
    const withRestored = regenerated.length ? { ...r, restored: [...new Set(regenerated)] } : r;
    const out = validations.baseline || validations.merged ? { ...withRestored, validations } : withRestored;
    return recovery ? { ...out, recovered: recovery.recovered } : out;
  } finally {
    // The marker of this attempt goes after its commit, its rollback, a refusal or a throw.
    marker.hold?.release();
  }
}

function mergeAttempt(at: GitDeps, ref: string, o: MergeOpts, regenerated: string[], validations: Validations, marker: { hold: MergingHold | null }): MergeOutcome {
  // A validator run where `where` is forge's own worktree restores what it regenerated; the person's checkout only the
  // files the config's `generated` names (nothing when it names none). The list is read once, before the merge, on
  // purpose: a task cannot widen what is put back in the person's checkout.
  let generated: string[] = [];
  try { generated = loadConfig(o.configRoot).generated; } catch { generated = []; }
  const validating = <T>(where: GitDeps, owned: boolean, fn: () => T): T =>
    (owned ? restoringRegenerated(where, fn, regenerated) : generated.length ? restoringRegenerated(where, fn, regenerated, generated) : fn());
  // A validator run through the tree cache (C6), keyed by the tree `tree` gives and the directory `where` runs them in;
  // what it misses runs as before.
  const cachedRun = (where: GitDeps, owned: boolean, list: Validator[], tree: () => string | null): ValidatorResult[] =>
    runWithCache(list,
      misses => (misses.length ? (o.slot ?? noSlot) : noSlot)(() => validating(where, owned, () => runValidators(misses, where.exec, o.timeoutSec, { ...o.run, execMany: where.execMany }))), {
      main: o.main, git: cacheGit(where.git), dir: o.cache.read || o.cache.write ? checkoutPrefix(where.git) : null, repo: where.repo, generated,
      read: o.cache.read, write: o.cache.write, tree, now: o.now,
    });
  const rev = o.commit ?? ref;
  const key = `${o.scope}-${o.target}`;
  const selection: Scope = o.scope === 'final' ? { mode: 'final' } : { mode: 'heavy', changed: null };
  const merging = () => at.git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']) !== null;
  if (merging()) return { result: 'dirty', detail: 'an unfinished merge is in progress there (git merge --abort to clear it)' };
  const dirty = at.git(['status', '--porcelain', '--', '.', ...LOCAL_STATE]);
  if (dirty === null || dirty.trim() !== '') return { result: 'dirty', detail: 'it has uncommitted changes' };
  if (at.git(['rev-parse', '--verify', '-q', `${rev}^{commit}`]) === null) return { result: 'conflict', detail: `unknown ref ${ref}` };
  const pre = at.git(['rev-parse', 'HEAD'])?.trim();
  if (!pre) return { result: 'conflict', detail: 'cannot read HEAD' };
  const place = workdirOf(at);
  // D-07: one merge attempt at a time in this checkout, from here to its commit or rollback: merging.json, taken with
  // 'wx' (mergeIn releases it). Each stamp's staleAt bounds what the attempt has left until its next stamp
  // (mergingStaleAt): here the install before the baseline; then the baseline's validator run; at `git merge`, the
  // install after it and a rollback's reinstall; then the merged tree's validator run and a rollback's reinstall.
  // Its dir is the one git names, or the one it was asked to merge in (configRoot): never empty, so tick reads it.
  const until = (left: { installs: number; validators?: number }) => mergingStaleAt(o.now(), o.timeoutSec, left);
  let took: ReturnType<typeof takeMerging>;
  try {
    took = takeMerging(o.main, {
      task: o.task ?? null, pre, ref, pid: process.pid, startedAt: o.now().toISOString(), staleAt: until({ installs: 1 }),
      dir: place ?? path.resolve(o.configRoot), phase: 'baseline',
    }, o.now().getTime());
  } catch (err) {
    return { result: 'dirty', detail: `cannot write .forge/execution/merging.json (${(err as Error).message})` };
  }
  if ('busy' in took) return { result: 'dirty', detail: inFlightDetail(took.busy, place) };
  const hold = marker.hold = took.hold;
  // Checked again under the marker (mergeIn releases it): an attempt that committed, or a merge someone started, between
  // the checks above and the take would make `pre` wrong (a duplicate integrate reporting the old sha, a rollback that
  // could not reach it).
  if (at.git(['rev-parse', 'HEAD'])?.trim() !== pre || merging()) {
    return { result: 'dirty', detail: 'HEAD moved or a merge started there while this integration was starting' };
  }
  const before = new Set(untracked(at));
  // The same list indexTree compares against, taken before the merge (the cache assumes the work tree starts clean).
  const cacheBefore = new Set(untrackedPaths(cacheGit(at.git)));
  const entry = (): Stats | null => { try { return place ? lstatSync(path.join(place, DEPS_DIR)) : null; } catch { return null; } };
  // Anything at node_modules before the attempt (a directory, a file, a link, even dangling) is the person's. Unknown
  // when the directory is: then it counts as there.
  const hadEntry = !place || entry() !== null;
  const memoAt = place ? memoFile(o.cacheDir, place) : null;
  const memo = (): DepsMemo => (memoAt ? readMemo(memoAt) : {});
  const remember = (m: DepsMemo) => { if (memoAt) writeMemo(memoAt, m); };
  if (o.retryDeps && memo().failed) { const { failed: _gone, ...rest } = memo(); remember(rest); }
  let setup: NonNullable<SetupResult> | undefined;
  let created = false;
  let installs = 0;
  /**
   * Installs with `cmd`, remembering a success for these manifests; a failure (after the merge, or for the tree a
   * rollback restored) forgets the last success, so the next check before a baseline installs again.
   */
  const installWith = (cmd: string) => {
    const manifests = manifestHash(at);
    const d = runInstall(at, cmd, o.timeoutSec);
    created ||= d.created;
    const { ok: _was, lastFailed: _failed, ...rest } = memo();
    remember(d.setup.ok ? { ...rest, ok: { manifests, cmd, deps: hasDeps(at) } } : { ...rest, lastFailed: true });
    return d.setup;
  };
  const install = (): boolean => {
    const cmd = depsCmd(at, o.setup);
    if (!cmd) return true;
    // These manifests installed nothing here last time (no dependencies): there is nothing to install again.
    const ok = memo().ok;
    if (!hasDeps(at) && ok?.manifests === manifestHash(at) && ok.cmd === cmd && ok.deps === false) return true;
    installs++;
    setup = installWith(cmd);
    return setup.ok;
  };
  let afterMerge = false;
  type Restored = { restoreSetup?: SetupResult; restoreChanged?: string[]; depsFromRejectedMerge?: true };
  /**
   * After a rollback that followed an install of the merged manifests, the dependencies are put back for the restored
   * tree: installed again (any target; the tracked files that install changed are reported, never reset), or in the
   * person's checkout the node_modules directory this attempt created removed. Otherwise the person hears they may not
   * match.
   */
  const restoreDeps = (): Restored => {
    const flag = o.personal ? { depsFromRejectedMerge: true as const } : {};
    if (at.repo.exists('package.json')) {
      const cmd = depsCmd(at, o.setup);
      if (!cmd) return flag;
      const edited = new Set(trackedChanges(at));
      const s = installWith(cmd);
      const changed = trackedChanges(at).filter(p => !edited.has(p));
      return { restoreSetup: s, ...(changed.length ? { restoreChanged: changed } : {}), ...(!s.ok || changed.length ? flag : {}) };
    }
    if (!o.personal) return {};
    const now = entry();
    // Only a real directory where there was nothing: never a link, a file, or what the person had.
    if (!hadEntry && now?.isDirectory() && !now.isSymbolicLink()) {
      try {
        rmSync(path.join(place!, DEPS_DIR), { recursive: true, force: true });
        created = false;
        return {};
      } catch { return flag; }
    }
    return now || hasDeps(at) ? flag : {};
  };
  const leftovers = () => {
    // A node_modules/ this attempt created is not noise once the merge whose .gitignore covered it is undone.
    if (created) excludeDeps(at);
    return untracked(at).filter(p => !before.has(p));
  };
  const withSetup = () => (setup ? { setup } : {});
  const rollback = (detail: string, extra: { touchedKept?: string[] } = {}): MergeOutcome => {
    const undone = at.git(['merge', '--abort']) !== null;
    const clean = undone && at.git(['rev-parse', 'HEAD'])?.trim() === pre && !merging();
    const restored: Restored = afterMerge ? (clean ? restoreDeps() : o.personal ? { depsFromRejectedMerge: true } : {}) : {};
    return { result: 'conflict', detail: clean ? detail : `rollback failed: needs manual attention (${detail})`, ...withSetup(), leftovers: leftovers(), ...extra, ...restored };
  };
  // The final merge into a target that has not moved since the run branched: the merged tree is the run tip's, which
  // the run worktree validates with its own dependencies; nothing is installed in the person's checkout.
  const unmoved = !!o.runAt && at.git(['merge-base', '--is-ancestor', 'HEAD', rev]) !== null;
  // The tip's dependencies are missing: installed before the baseline. In the run worktree, which is forge's, also when
  // forge's last install there failed or was for other manifests (a manifest changed by hand). The person's checkout
  // only gets missing ones: dependencies they installed themselves for a change of their own are never reinstalled on
  // a guess.
  const stale = () => {
    if (!at.repo.exists('package.json')) return false;
    if (!hasDeps(at)) return true;
    if (o.personal) return false;
    const m = memo();
    return !!m.lastFailed || (!!m.ok && m.ok.manifests !== manifestHash(at));
  };
  if (!unmoved && stale()) {
    const cmd = depsCmd(at, o.setup);
    const manifests = manifestHash(at);
    // An install that failed at this HEAD with these manifests and this command fails again: it is not rerun each tick.
    const failed = memo().failed;
    if (cmd && failed && failed.head === pre && failed.manifests === manifests && failed.cmd === cmd) {
      return { result: 'deps', detail: `could not install its dependencies before merging ${ref}: ${lastLine(failed.setup)} `
        + `(remembered from the install that failed at ${pre.slice(0, 12)}; it runs again with --retry-deps, or once HEAD, the manifests or swarm.setup change)`, setup: failed.setup };
    }
    if (!install()) {
      if (cmd) remember({ ...memo(), failed: { head: pre, manifests, cmd, setup: setup! } });
      return { result: 'deps', detail: `could not install its dependencies before merging ${ref}: ${lastLine(setup!)}`, ...withSetup(), leftovers: leftovers() };
    }
    if (failed) { const { failed: _gone, ...rest } = memo(); remember(rest); }
    const left = at.git(['status', '--porcelain', '--', '.', ...LOCAL_STATE]);
    if (left === null || left.trim() !== '') return { result: 'deps',
      detail: `the dependency install left changes in the worktree: ${(left ?? '').split(/\r?\n/).filter(Boolean).slice(0, 5).join(', ')}`, ...withSetup(), leftovers: leftovers() };
  }
  // What the target detects before the merge: the validators detected only after it are new.
  let detected0: Validator[] | null = null;
  try { detected0 = detectValidators(at.repo, loadTrustedConfig(o.configRoot)); } catch { detected0 = null; }
  // D-07: a stamp that finds merging.json no longer this attempt's (another took it, past its staleAt) stops it.
  const takenOver = (): MergeOutcome => ({ result: 'dirty', detail: 'another integration took over .forge/execution/merging.json', ...withSetup() });
  // What the target's tip already fails is not caused by this merge: validators red there are "preexisting". The tip is
  // usually the tree the previous integration validated after its merge, so the tree cache (C6) has it.
  let baseline: unknown = readBaseline(o.cacheDir, key, pre);
  if (baseline === null) {
    // Without its dependencies the tip would fail everything, which would excuse every failure after the merge.
    if (unmoved && needsDeps(at)) baseline = [];
    else {
      const chosen0 = detected0 ? selectValidators(detected0, selection) : [];
      if (!hold.stamp('baseline', until({ installs: 0, validators: chosen0.length }))) return takenOver();
      const t0 = Date.now();
      try {
        const results = detected0 ? cachedRun(at, !o.personal, chosen0, () => cleanTree(cacheGit(at.git), generated)) : [];
        if (detected0) validations.baseline = { results, durationMs: Date.now() - t0 };
        baseline = results;
      } catch { baseline = []; }
      const left = at.git(['status', '--porcelain', '--', '.', ...LOCAL_STATE]);
      if (left === null || left.trim() !== '') return { result: 'dirty',
        detail: `the validators left changes in the worktree: ${(left ?? '').split(/\r?\n/).filter(Boolean).slice(0, 5).join(', ')}`, ...withSetup() };
    }
  }
  // D-07: the merge phase, so a later attempt tells its own leftover (this ref, from this pre) from someone's.
  if (!hold.stamp('merge', until({ installs: 2 }))) return takenOver();
  // Its branch too, not only HEAD's commit: a checkout switched meanwhile to another branch at that commit would take it.
  if (o.branch !== undefined) {
    const on = at.git(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
    if (on !== o.branch) return { result: 'dirty', detail: `is on ${on ?? '?'}, not ${o.branch}`, ...withSetup() };
  }
  if (at.git(['merge', '--no-ff', '--no-commit', rev]) === null) {
    if (!merging()) return { result: 'conflict', detail: `git refused to merge ${ref}`, ...withSetup() };
    return rollback(`merge conflict with ${ref}`);
  }
  if (!merging()) return { result: 'merged', sha: pre, preexisting: [], newValidators: [], surfacesChanged: [], ...withSetup() };
  // The index holds the merged tree (HEAD is still the pre-merge commit until the commit below).
  const merged = at.git(['write-tree'])?.trim() || null;
  const inRun = !!o.runAt && merged !== null && merged === (at.git(['rev-parse', '--verify', '-q', `${rev}^{tree}`])?.trim() || null);
  const v = inRun ? o.runAt! : at;
  if (!inRun && at.repo.exists('package.json')) {
    const changed = at.git(['diff', '--name-only', pre, '--', ...DEP_FILES]);
    // An unreadable diff counts as a change: installing again is safer than validating without dependencies.
    if (changed === null || changed.trim() !== '' || (installs === 0 && !hasDeps(at))) {
      const edited = new Set(trackedChanges(at));
      const ran = installs;
      const ok = install();
      afterMerge = installs > ran;
      const touched = trackedChanges(at).filter(p => !edited.has(p));
      // A file the merge changed and the install rewrote blocks `git merge --abort`: back to its merged version (the
      // install's own edit). Any other changed file may hold someone's edit: kept as it is, and said.
      const mergedPaths = new Set(nulList(at.git(['diff', '--cached', '--name-only', '-z', pre])));
      const reset = touched.filter(p => mergedPaths.has(p));
      const kept = touched.filter(p => !mergedPaths.has(p));
      if (reset.length) at.git(['checkout', '--', ...reset.map(p => `:(top,literal)${p}`)]);
      const keptOut = kept.length ? { touchedKept: kept } : {};
      if (!ok) return rollback(`dependencies could not be installed after merging ${ref}: ${lastLine(setup!)}`, keptOut);
      if (touched.length) return rollback(`the dependency install changed tracked files after merging ${ref}: ${touched.slice(0, 5).join(', ')}`, keptOut);
    }
  }
  // What the install after the merge left untracked: committed it is not, and the next integration finds it.
  const installLeft = afterMerge ? untracked(at).filter(p => !before.has(p)) : [];
  let results: ValidatorResult[];
  let detected: Validator[];
  try {
    // I-03: the config as the merge left it: commands it brings without the person's trust roll the merge back unrun.
    detected = detectValidators(v.repo, loadTrustedConfig(o.configRoot));
    // The run worktree as the target (not the person's) or as the final merge's place to validate (inRun).
    const chosen = selectValidators(detected, selection);
    // D-07: in the middle of its own merge the attempt goes on even if the stamp fails (it can only fail past the bound).
    hold.stamp('merge', until({ installs: 1, validators: chosen.length }));
    // The merged tree is the index's (HEAD is still the pre-merge commit): when nothing was integrated since the task
    // branched, it is the tree its review-prep validated, and every result comes from the cache.
    const t0 = Date.now();
    const raw = cachedRun(v, inRun || !o.personal, chosen, () => (inRun ? cleanTree(cacheGit(v.git), generated) : indexTree(cacheGit(at.git), generated, cacheBefore)));
    results = markPreexisting(raw, baseline);
    validations.merged = { results, durationMs: Date.now() - t0 };
  } catch (err) {
    return rollback(`validators could not run: ${(err as Error).message}`);
  }
  const failed = results.filter(blocking);
  if (failed.length) return rollback(`validators failed after merging ${ref}: ${failed.map(r => failingLabel(r)).join(', ')}`);
  if (at.git(['commit', '--no-edit', '-m', o.message]) === null || merging()) return rollback(`could not commit the merge of ${ref}`);
  const sha = at.git(['rev-parse', 'HEAD'])?.trim() ?? '';
  if (!sha || sha === pre) return rollback(`could not commit the merge of ${ref}`);
  const newValidators = detected0 ? detected.filter(d => !detected0!.some(b => b.name === d.name)).map(d => ({ name: d.name, cmd: d.cmd })) : [];
  // The surfaces the merge changed: a changed surface is asked about again, and the person may want to see the diff.
  const surfacesChanged = (at.git(['-c', 'core.quotePath=false', 'diff', '--name-only', pre, sha, '--', ':(top).forge/verify']) ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return {
    result: 'merged', sha, preexisting: results.filter(r => r.preexisting).map(r => r.validator), newValidators, surfacesChanged, ...withSetup(),
    ...(installLeft.length ? { leftovers: installLeft } : {}),
  };
}

/** The run worktree when it is on the tip of `branch` with nothing uncommitted (its tree is the branch's); else null. */
export function cleanRunWorktree(deps: SwarmDeps, wt: string, branch: string): GitDeps | null {
  if (!existsSync(wt)) return null;
  const at = deps.at(wt);
  const tip = deps.git(['rev-parse', '--verify', '-q', `refs/heads/${branch}`])?.trim();
  if (!tip || at.git(['rev-parse', 'HEAD'])?.trim() !== tip) return null;
  if (at.git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']) !== null) return null;
  const status = at.git(['status', '--porcelain', '--', '.', ...LOCAL_STATE]);
  return status !== null && status.trim() === '' ? at : null;
}

// What the coordinator passes on of a merge attempt: the installs that ran, what a rollback left behind, whether the
// person's dependencies may be the rejected merge's and, in the person's checkout (`personal`), the files of theirs its
// install changed; with the lines to tell them.
export function attemptExtras(r: MergeOutcome, es: boolean, ref: string, personal: boolean) {
  const failed = r.result === 'merged' ? null : r;
  const say = [
    ...(failed?.depsFromRejectedMerge ? [rejectedDepsSay(es, ref)] : []),
    ...(personal && failed?.touchedKept?.length ? [keptFilesSay(es, ref, failed.touchedKept)] : []),
  ];
  return {
    ...(r.setup ? { setup: r.setup } : {}),
    ...(r.recovered ? { recovered: r.recovered } : {}),
    ...(r.leftovers ? { leftovers: r.leftovers } : {}),
    ...(r.restored?.length ? { restored: r.restored } : {}),
    ...(failed?.touchedKept ? { touchedKept: failed.touchedKept } : {}),
    ...(failed?.restoreSetup ? { restoreSetup: failed.restoreSetup } : {}),
    ...(failed?.restoreChanged ? { restoreChanged: failed.restoreChanged } : {}),
    ...(failed?.depsFromRejectedMerge ? { depsFromRejectedMerge: true } : {}),
    ...(say.length ? { say } : {}),
  };
}

/**
 * H-16: an integrated commit as `waypoint commit-info` prints it, measured as what the task brings: the diff from the
 * merge's first parent (`git show --shortstat` prints nothing for a merge) and the subject of its second parent, the
 * task's last commit. Without a second parent (nothing was merged) the title is the commit's own and add/del are 0.
 */
export function commitInfo(git: (args: string[]) => string | null, sha: string): { sha: string; ts: string; title: string; add: number; del: number } {
  const [cI = '', ...subject] = (git(['show', '-s', '--format=%cI%x09%s', sha]) ?? '').trim().split('\t');
  const second = git(['rev-parse', '--verify', '-q', `${sha}^2`])?.trim() || null;
  const title = second ? (git(['show', '-s', '--format=%s', second]) ?? '').trim() : subject.join('\t');
  const stat = second ? (git(['diff', '--shortstat', `${sha}^1`, sha]) ?? '') : '';
  const num = (re: RegExp) => Number(stat.match(re)?.[1] ?? 0);
  const t = Date.parse(cI);
  return { sha, ts: Number.isFinite(t) ? new Date(t).toISOString() : '', title, add: num(/(\d+) insertion/), del: num(/(\d+) deletion/) };
}

export type Commit = ReturnType<typeof commitInfo>;
/**
 * J-15, A-10: what a plan run's integration publishes, built here and by swarm step's recovery (an `integrated` again): the
 * task's state/T write (done with its commit for a subagents task: a member's session already wrote its done) and the
 * meta/metrics write, apart. `at` is when the task was integrated.
 */
export function integratedPublish(io: Io, project: string, task: string, t: ExecTask, commit: Commit, at: string) {
  const done = t.executor === 'subagents' ? { status: 'done', doneAt: at, commits: [commit] } : undefined;
  const pub = publishFor(io, task, { project, ...(done ? { extra: done } : {}) });
  const metrics = { op: 'update' as const, collection: 'meta', doc_id: 'metrics', data: { lastCommit: { sha: commit.sha, ts: commit.ts }, updatedAt: at } };
  return { ...pub, metrics };
}

/** The two `validate` events of an integration (C4): the run tip's baseline and the merged tree, both on the task, with
 *  the project of a plan run's task. */
export function logValidations(io: Io, task: string, v: Validations | undefined, project: string | null = null): void {
  const ts = io.now().toISOString();
  const own = project ? { project } : {};
  if (v?.baseline) appendEvent(io.cwd, { ...validateEvent(ts, task, v.baseline.results, v.baseline.durationMs, 'heavy', { baseline: true, integrate: 'baseline' }), ...own });
  if (v?.merged) appendEvent(io.cwd, { ...validateEvent(ts, task, v.merged.results, v.merged.durationMs, 'heavy', { integrate: 'merged' }), ...own });
}
